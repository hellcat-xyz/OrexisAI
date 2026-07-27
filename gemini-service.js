'use strict';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_FALLBACK_MODELS = Object.freeze(['gemini-2.5-flash']);
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_HISTORY_MESSAGES = 40;
const MAX_STORED_MESSAGE_CHARACTERS = 4000;
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULT_SYSTEM_INSTRUCTION = [
    'You are OrexisAI, a practical AI operations agent for small businesses.',
    'Turn the user\'s command into a useful business outcome, plan, draft, analysis, or set of next actions.',
    'Be specific and concise, use clear headings when they improve readability, and ask for missing information only when it is required.',
    'Never claim that you sent an email, published content, changed a CRM record, charged a payment, or completed any external action unless an integrated tool actually confirmed it.',
    'Do not discuss model routing unless the user explicitly asks about it.'
].join(' ');

function createGeminiService({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim();
    const model = normalizeModel(env.GEMINI_MODEL || DEFAULT_MODEL);
    const fallbackModels = parseFallbackModels(env.GEMINI_FALLBACK_MODELS, model);
    const timeoutMs = parseBoundedInteger(env.GEMINI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 120_000, 'GEMINI_TIMEOUT_MS');
    const maxHistoryMessages = parseBoundedInteger(
        env.GEMINI_MAX_HISTORY_MESSAGES,
        DEFAULT_MAX_HISTORY_MESSAGES,
        2,
        100,
        'GEMINI_MAX_HISTORY_MESSAGES'
    );
    const systemInstruction = String(env.GEMINI_SYSTEM_INSTRUCTION || DEFAULT_SYSTEM_INSTRUCTION).trim();

    return {
        getPublicConfiguration() {
            return {
                isConfigured: Boolean(apiKey),
                model,
                fallbackModels: [...fallbackModels]
            };
        },

        async generateReply(messages) {
            if (!apiKey) {
                throw createServiceError(
                    'GEMINI_NOT_CONFIGURED',
                    'GEMINI_API_KEY is not configured.',
                    'Gemini is not configured yet. Add GEMINI_API_KEY to your .env file and restart the server.',
                    503
                );
            }
            if (typeof fetchImpl !== 'function') {
                throw createServiceError(
                    'GEMINI_FETCH_UNAVAILABLE',
                    'A Fetch API implementation is required.',
                    'Gemini cannot be reached by this server runtime.',
                    500
                );
            }

            const contents = buildConversationContents(messages, maxHistoryMessages);
            if (contents.length === 0 || contents.at(-1)?.role !== 'user') {
                throw createServiceError(
                    'GEMINI_INVALID_HISTORY',
                    'Gemini conversation history must end with a user message.',
                    'The AI conversation could not be prepared. Please send the command again.',
                    400
                );
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            timeout.unref?.();

            const candidateModels = [model, ...fallbackModels];
            let lastError;

            try {
                for (const candidateModel of candidateModels) {
                    try {
                        const responseBody = await requestGeminiModel({
                            apiKey,
                            contents,
                            fetchImpl,
                            model: candidateModel,
                            signal: controller.signal,
                            systemInstruction
                        });
                        const content = extractResponseText(responseBody);
                        if (!content) {
                            const blockReason = responseBody?.promptFeedback?.blockReason;
                            throw createServiceError(
                                'GEMINI_EMPTY_RESPONSE',
                                blockReason ? `Gemini blocked the request: ${blockReason}` : 'Gemini returned no text.',
                                blockReason
                                    ? 'Gemini could not answer that request. Try rephrasing it.'
                                    : 'Gemini returned an empty reply. Please try again.',
                                502
                            );
                        }

                        return {
                            content: truncateForStorage(content),
                            model: candidateModel,
                            finishReason: responseBody?.candidates?.[0]?.finishReason || ''
                        };
                    } catch (error) {
                        lastError = error;
                        if (!error.canTryFallback || candidateModel === candidateModels.at(-1)) {
                            throw error;
                        }
                    }
                }
            } catch (error) {
                if (error?.name === 'AbortError') {
                    throw createServiceError(
                        'GEMINI_TIMEOUT',
                        `Gemini request exceeded ${timeoutMs}ms.`,
                        'Gemini took too long to respond. Please try again.',
                        504
                    );
                }
                if (error?.code?.startsWith('GEMINI_')) throw error;
                throw createServiceError(
                    'GEMINI_NETWORK_ERROR',
                    error?.message || 'Gemini network request failed.',
                    'Gemini could not be reached. Please try again in a moment.',
                    502
                );
            } finally {
                clearTimeout(timeout);
            }

            throw lastError || createServiceError(
                'GEMINI_API_ERROR',
                'Gemini did not return a response.',
                'Gemini could not generate a reply. Please try again.',
                502
            );
        }
    };
}

async function requestGeminiModel({ apiKey, contents, fetchImpl, model, signal, systemInstruction }) {
    const response = await fetchImpl(
        `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                contents,
                // Gemini 3.6+ rejects the old temperature/topP/topK fields.
                generationConfig: {
                    maxOutputTokens: 1200
                }
            }),
            signal
        }
    );
    const responseBody = await readJsonResponse(response);
    if (!response.ok) {
        throw createApiError(response.status, responseBody, model);
    }
    return responseBody;
}

function buildConversationContents(messages, maxHistoryMessages) {
    const normalized = [];
    const source = Array.isArray(messages) ? messages.slice(-maxHistoryMessages) : [];

    for (const message of source) {
        const text = String(message?.content || '').trim();
        if (!text) continue;

        const role = message.role === 'assistant' || message.role === 'model' ? 'model'
            : message.role === 'user' ? 'user'
                : null;
        if (!role) continue;

        const previous = normalized.at(-1);
        if (previous?.role === role) {
            previous.parts[0].text += `\n\n${text}`;
        } else {
            normalized.push({ role, parts: [{ text }] });
        }
    }

    while (normalized[0]?.role === 'model') normalized.shift();
    return normalized;
}

function extractResponseText(value) {
    const parts = value?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
        .map((part) => typeof part?.text === 'string' ? part.text : '')
        .filter(Boolean)
        .join('')
        .trim();
}

async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw createServiceError(
            'GEMINI_INVALID_RESPONSE',
            `Gemini returned invalid JSON with HTTP ${response.status}.`,
            'Gemini returned an invalid response. Please try again.',
            502
        );
    }
}

function createApiError(status, value, model = '') {
    const providerMessage = String(value?.error?.message || `Gemini API request failed with HTTP ${status}.`);
    const providerCode = String(value?.error?.status || '');
    let publicMessage = 'Gemini could not generate a reply. Please try again.';
    let statusCode = 502;

    if (status === 400 || status === 401 || status === 403) {
        publicMessage = 'Gemini rejected the API key or model configuration. Check your .env settings.';
    } else if (status === 429) {
        publicMessage = 'Gemini quota is currently exhausted. Wait a moment or check your Google AI quota.';
        statusCode = 503;
    } else if (status >= 500) {
        publicMessage = 'Gemini is temporarily unavailable. Please try again shortly.';
        statusCode = 503;
    }

    const error = createServiceError('GEMINI_API_ERROR', providerMessage, publicMessage, statusCode);
    error.providerStatus = providerCode;
    error.model = model;
    error.canTryFallback = isModelAvailabilityError(status, providerCode, providerMessage);
    return error;
}

function isModelAvailabilityError(status, providerCode, providerMessage) {
    if (status !== 400 && status !== 404) return false;
    const message = `${providerCode} ${providerMessage}`.toLowerCase();
    return message.includes('model')
        && (message.includes('not found')
            || message.includes('not supported')
            || message.includes('not available')
            || message.includes('unsupported'));
}

function parseFallbackModels(value, primaryModel) {
    const configured = String(value ?? DEFAULT_FALLBACK_MODELS.join(','))
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(normalizeModel);
    return [...new Set(configured)].filter((entry) => entry !== primaryModel);
}

function createServiceError(code, message, publicMessage, statusCode) {
    const error = new Error(message);
    error.code = code;
    error.publicMessage = publicMessage;
    error.statusCode = statusCode;
    return error;
}

function truncateForStorage(value) {
    const characters = Array.from(String(value).trim());
    if (characters.length <= MAX_STORED_MESSAGE_CHARACTERS) return characters.join('');
    return `${characters.slice(0, MAX_STORED_MESSAGE_CHARACTERS - 1).join('').trimEnd()}…`;
}

function normalizeModel(value) {
    const model = String(value || '').trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
        throw new Error('GEMINI_MODEL may only contain letters, numbers, dots, underscores, and hyphens.');
    }
    return model;
}

function parseBoundedInteger(value, fallback, minimum, maximum, name) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${name} must be a number between ${minimum} and ${maximum}.`);
    }
    return parsed;
}

module.exports = {
    DEFAULT_MODEL,
    buildConversationContents,
    createGeminiService,
    extractResponseText,
    parseFallbackModels,
    truncateForStorage
};
