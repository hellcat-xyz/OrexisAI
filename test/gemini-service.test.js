'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildConversationContents,
    buildGenerationConfig,
    createGeminiService,
    inferThinkingLevel,
    parseThinkingMode,
    truncateForStorage
} = require('../gemini-service');

test('Gemini service sends server-side chat history and extracts the model reply', async () => {
    let capturedUrl;
    let capturedOptions;
    const service = createGeminiService({
        env: {
            GEMINI_API_KEY: 'server-only-test-key',
            GEMINI_MODEL: 'gemini-3.6-flash'
        },
        fetchImpl: async (url, options) => {
            capturedUrl = url;
            capturedOptions = options;
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        candidates: [{
                            finishReason: 'STOP',
                            content: { parts: [{ text: 'Here is your finished marketing plan.' }] }
                        }]
                    });
                }
            };
        }
    });

    const result = await service.generateReply([
        { role: 'user', content: 'Plan my campaign.' },
        { role: 'assistant', content: 'What is the goal?' },
        { role: 'user', content: 'Increase repeat orders.' }
    ]);

    assert.equal(result.content, 'Here is your finished marketing plan.');
    assert.equal(result.model, 'gemini-3.6-flash');
    assert.match(capturedUrl, /models\/gemini-3\.6-flash:generateContent$/);
    assert.equal(capturedOptions.headers['x-goog-api-key'], 'server-only-test-key');
    const payload = JSON.parse(capturedOptions.body);
    assert.equal(payload.contents.length, 3);
    assert.equal(payload.contents[1].role, 'model');
    assert.match(payload.systemInstruction.parts[0].text, /OrexisAI/);
    assert.match(payload.systemInstruction.parts[0].text, /Accuracy is mandatory/);
    assert.deepEqual(payload.generationConfig, {
        maxOutputTokens: 1200,
        thinkingConfig: { thinkingLevel: 'minimal' }
    });
    assert.equal('temperature' in payload.generationConfig, false);
    assert.equal('topP' in payload.generationConfig, false);
});

test('Gemini service never exposes a missing key and returns a setup error', async () => {
    const service = createGeminiService({ env: {}, fetchImpl: async () => assert.fail('fetch should not run') });
    assert.deepEqual(service.getPublicConfiguration(), {
        isConfigured: false,
        imageGenerationConfigured: false,
        model: 'gemini-2.5-flash',
        imageModel: 'gemini-3.1-flash-image',
        fallbackModels: []
    });

    await assert.rejects(
        service.generateReply([{ role: 'user', content: 'Hello' }]),
        (error) => error.code === 'GEMINI_NOT_CONFIGURED'
            && error.statusCode === 503
            && !error.publicMessage.includes('undefined')
    );
});

test('conversation normalization removes system rows and combines adjacent roles', () => {
    assert.deepEqual(buildConversationContents([
        { role: 'system', content: 'hidden' },
        { role: 'assistant', content: 'orphan model turn' },
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'answer' }
    ], 40), [
        { role: 'user', parts: [{ text: 'first\n\nsecond' }] },
        { role: 'model', parts: [{ text: 'answer' }] }
    ]);
});

test('Gemini replies are trimmed to the database message limit', () => {
    const value = truncateForStorage('x'.repeat(5000));
    assert.equal(Array.from(value).length, 4000);
    assert.match(value, /…$/);
});


test('Gemini service falls back when the configured model is unavailable', async () => {
    const requestedModels = [];
    const service = createGeminiService({
        env: {
            GEMINI_API_KEY: 'server-only-test-key',
            GEMINI_MODEL: 'gemini-3.6-flash',
            GEMINI_FALLBACK_MODELS: 'gemini-2.5-flash'
        },
        fetchImpl: async (url) => {
            requestedModels.push(url);
            if (url.includes('gemini-3.6-flash')) {
                return {
                    ok: false,
                    status: 404,
                    async text() {
                        return JSON.stringify({
                            error: {
                                status: 'NOT_FOUND',
                                message: 'models/gemini-3.6-flash is not found for API version v1beta'
                            }
                        });
                    }
                };
            }
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        candidates: [{ content: { parts: [{ text: 'Fallback worked.' }] } }]
                    });
                }
            };
        }
    });

    const result = await service.generateReply([{ role: 'user', content: 'Hello' }]);
    assert.equal(result.content, 'Fallback worked.');
    assert.equal(result.model, 'gemini-2.5-flash');
    assert.equal(requestedModels.length, 2);
});

test('Gemini service does not hide invalid API key errors behind fallback attempts', async () => {
    let calls = 0;
    const service = createGeminiService({
        env: {
            GEMINI_API_KEY: 'invalid-key',
            GEMINI_MODEL: 'gemini-3.6-flash',
            GEMINI_FALLBACK_MODELS: 'gemini-2.5-flash'
        },
        fetchImpl: async () => {
            calls += 1;
            return {
                ok: false,
                status: 403,
                async text() {
                    return JSON.stringify({
                        error: { status: 'PERMISSION_DENIED', message: 'API key not valid.' }
                    });
                }
            };
        }
    });

    await assert.rejects(
        service.generateReply([{ role: 'user', content: 'Hello' }]),
        (error) => error.code === 'GEMINI_API_ERROR' && error.statusCode === 502
    );
    assert.equal(calls, 1);
});

test('adaptive thinking uses more reasoning only for complex requests', () => {
    assert.equal(inferThinkingLevel([
        { role: 'user', parts: [{ text: 'What is gross margin?' }] }
    ]), 'minimal');

    assert.equal(inferThinkingLevel([
        {
            role: 'user',
            parts: [{
                text: [
                    'Debug this production-ready migration and find the root cause without breaking existing architecture.',
                    '- Review multiple files',
                    '- Handle edge cases',
                    '- Explain the trade-offs',
                    '```js',
                    'async function migrate() { throw new Error("failed"); }',
                    '```'
                ].join('\n')
            }]
        }
    ]), 'high');
});

test('generation config supports Gemini 3 thinking levels and Gemini 2.5 budgets', () => {
    const simpleContents = [{ role: 'user', parts: [{ text: 'Hello' }] }];
    const complexContents = [{
        role: 'user',
        parts: [{ text: 'Analyze this production security architecture, debug the root cause, and explain all trade-offs and edge cases.' }]
    }];

    assert.deepEqual(buildGenerationConfig({
        contents: simpleContents,
        model: 'gemini-3.6-flash',
        thinkingMode: 'adaptive'
    }), {
        maxOutputTokens: 1200,
        thinkingConfig: { thinkingLevel: 'minimal' }
    });

    assert.deepEqual(buildGenerationConfig({
        contents: complexContents,
        model: 'gemini-2.5-flash',
        thinkingMode: 'adaptive'
    }), {
        maxOutputTokens: 1200,
        thinkingConfig: { thinkingBudget: 8192 }
    });

    assert.deepEqual(buildGenerationConfig({
        contents: simpleContents,
        model: 'custom-model',
        thinkingMode: 'adaptive'
    }), { maxOutputTokens: 1200 });
});

test('generation config preserves structured output settings', () => {
    const contents = [{ role: 'user', parts: [{ text: 'Generate a structured marketing report.' }] }];
    assert.deepEqual(buildGenerationConfig({
        contents,
        model: 'gemini-2.5-flash',
        thinkingMode: 'high',
        baseConfig: {
            maxOutputTokens: 16384,
            responseMimeType: 'application/json'
        }
    }), {
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: -1 }
    });
});

test('thinking mode validation rejects unsupported values', () => {
    assert.equal(parseThinkingMode(' ADAPTIVE '), 'adaptive');
    assert.throws(
        () => parseThinkingMode('fastest'),
        /GEMINI_THINKING_LEVEL must be adaptive, minimal, low, medium, or high/
    );
});

test('Gemini agent executes function calls and returns the grounded final reply', async () => {
    const requests = [];
    let providerCall = 0;
    const service = createGeminiService({
        env: {
            GEMINI_API_KEY: 'server-only-test-key',
            GEMINI_MODEL: 'gemini-2.5-flash',
            GEMINI_RETRIES: '0'
        },
        fetchImpl: async (url, options) => {
            requests.push({ url, payload: JSON.parse(options.body) });
            providerCall += 1;
            if (providerCall === 1) {
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return JSON.stringify({
                            candidates: [{
                                finishReason: 'STOP',
                                content: {
                                    role: 'model',
                                    parts: [{
                                        functionCall: {
                                            id: 'call-1',
                                            name: 'get_business_overview',
                                            args: { from: '2026-09-01', to: '2026-09-06' }
                                        }
                                    }]
                                }
                            }]
                        });
                    }
                };
            }
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        candidates: [{
                            finishReason: 'STOP',
                            content: { role: 'model', parts: [{ text: 'Revenue is down 12% this period.' }] }
                        }]
                    });
                }
            };
        }
    });
    const executed = [];
    const result = await service.generateAgentReply(
        [{ role: 'user', content: 'Why are my sales down?' }],
        {
            toolDeclarations: [{
                name: 'get_business_overview',
                description: 'Get sales facts.',
                parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }
            }],
            executeTool: async (call) => {
                executed.push(call);
                return { revenueChangePercentage: -12 };
            }
        }
    );

    assert.equal(result.content, 'Revenue is down 12% this period.');
    assert.equal(result.toolCalls, 1);
    assert.deepEqual(executed, [{
        id: 'call-1',
        name: 'get_business_overview',
        args: { from: '2026-09-01', to: '2026-09-06' }
    }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].payload.tools[0].functionDeclarations[0].name, 'get_business_overview');
    assert.deepEqual(requests[1].payload.contents.at(-2).parts[0].functionCall, {
        id: 'call-1',
        name: 'get_business_overview',
        args: { from: '2026-09-01', to: '2026-09-06' }
    });
    assert.deepEqual(requests[1].payload.contents.at(-1).parts[0].functionResponse, {
        id: 'call-1',
        name: 'get_business_overview',
        response: { result: { revenueChangePercentage: -12 } }
    });
});
