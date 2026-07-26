'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildConversationContents,
    createGeminiService,
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
    assert.match(payload.systemInstruction.parts[0].text, /OutcomeAI/);
    assert.deepEqual(payload.generationConfig, { maxOutputTokens: 1200 });
    assert.equal('temperature' in payload.generationConfig, false);
    assert.equal('topP' in payload.generationConfig, false);
});

test('Gemini service never exposes a missing key and returns a setup error', async () => {
    const service = createGeminiService({ env: {}, fetchImpl: async () => assert.fail('fetch should not run') });
    assert.deepEqual(service.getPublicConfiguration(), {
        isConfigured: false,
        model: 'gemini-2.5-flash',
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
