'use strict';

const DEFAULT_MAX_CHARACTERS = 131_072;
const DEFAULT_MAX_TOKENS = 32_768;
const DEFAULT_WARNING_RATIO = 0.85;

function createPromptLimitConfiguration({ env = process.env, model = '' } = {}) {
    const globalLimit = {
        maxCharacters: parsePositiveInteger(
            env.PROMPT_MAX_CHARACTERS,
            DEFAULT_MAX_CHARACTERS,
            1_000,
            1_000_000,
            'PROMPT_MAX_CHARACTERS'
        ),
        maxTokens: parsePositiveInteger(
            env.PROMPT_MAX_TOKENS,
            DEFAULT_MAX_TOKENS,
            256,
            1_000_000,
            'PROMPT_MAX_TOKENS'
        )
    };
    const warningRatio = parseRatio(env.PROMPT_WARNING_RATIO, DEFAULT_WARNING_RATIO);
    const modelLimits = parseModelLimits(env.AI_MODEL_PROMPT_LIMITS_JSON);

    function getLimitForModel(selectedModel = model) {
        const override = modelLimits.get(String(selectedModel || '').trim());
        return Object.freeze({
            model: String(selectedModel || '').trim(),
            maxCharacters: Math.min(globalLimit.maxCharacters, override?.maxCharacters || globalLimit.maxCharacters),
            maxTokens: Math.min(globalLimit.maxTokens, override?.maxTokens || globalLimit.maxTokens),
            warningRatio
        });
    }

    function inspectPrompt(value, selectedModel = model) {
        const content = String(value ?? '');
        const limit = getLimitForModel(selectedModel);
        const characters = countUnicodeCharacters(content);
        const estimatedTokens = estimateTokens(content);
        const exceeded = characters > limit.maxCharacters || estimatedTokens > limit.maxTokens;
        const nearLimit = !exceeded && (
            characters >= Math.floor(limit.maxCharacters * limit.warningRatio)
            || estimatedTokens >= Math.floor(limit.maxTokens * limit.warningRatio)
        );
        return { content, characters, estimatedTokens, exceeded, nearLimit, ...limit };
    }

    return Object.freeze({
        getLimitForModel,
        inspectPrompt,
        getPublicConfiguration(selectedModel = model) {
            return getLimitForModel(selectedModel);
        }
    });
}

function countUnicodeCharacters(value) {
    const text = String(value ?? '');
    if (typeof globalThis.Intl?.Segmenter === 'function') {
        const segmenter = new globalThis.Intl.Segmenter(undefined, { granularity: 'grapheme' });
        let count = 0;
        for (const _segment of segmenter.segment(text)) count += 1;
        return count;
    }
    return Array.from(text).length;
}

function estimateTokens(value) {
    const text = String(value ?? '');
    if (!text) return 0;

    // Provider tokenizers differ. This intentionally errs slightly high for
    // mixed Unicode text so the server rejects before making an AI API call.
    const utf8Bytes = Buffer.byteLength(text, 'utf8');
    const graphemes = countUnicodeCharacters(text);
    const wordLikePieces = text.trim() ? text.trim().split(/\s+/u).length : 0;
    return Math.max(1, Math.ceil(Math.max(utf8Bytes / 3, graphemes / 2, wordLikePieces * 1.3)));
}

function parseModelLimits(value) {
    const result = new Map();
    if (!String(value || '').trim()) return result;

    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error('AI_MODEL_PROMPT_LIMITS_JSON must be valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('AI_MODEL_PROMPT_LIMITS_JSON must be an object keyed by model name.');
    }

    for (const [model, limit] of Object.entries(parsed)) {
        if (!model.trim() || !limit || typeof limit !== 'object' || Array.isArray(limit)) {
            throw new Error('Each AI model prompt limit must be an object.');
        }
        result.set(model.trim(), {
            maxCharacters: parsePositiveInteger(
                limit.maxCharacters,
                DEFAULT_MAX_CHARACTERS,
                1_000,
                1_000_000,
                `${model}.maxCharacters`
            ),
            maxTokens: parsePositiveInteger(
                limit.maxTokens,
                DEFAULT_MAX_TOKENS,
                256,
                1_000_000,
                `${model}.maxTokens`
            )
        });
    }
    return result;
}

function parsePositiveInteger(value, fallback, minimum, maximum, name) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    }
    return parsed;
}

function parseRatio(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0.5 || parsed >= 1) {
        throw new Error('PROMPT_WARNING_RATIO must be at least 0.5 and less than 1.');
    }
    return parsed;
}

module.exports = {
    DEFAULT_MAX_CHARACTERS,
    DEFAULT_MAX_TOKENS,
    countUnicodeCharacters,
    createPromptLimitConfiguration,
    estimateTokens
};
