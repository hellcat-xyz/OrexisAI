'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createGeminiService } = require('../gemini-service');
const { renderDashboardPage } = require('../views/dashboard');

const projectRoot = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
const envExample = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');

function dashboardHtml() {
    return renderDashboardPage({
        user: { email: 'voice@example.com', displayName: 'Voice User', initials: 'VU' },
        plans: [{
            id: 'free', name: 'Free', tagline: 'Try OrexisAI', usdCents: 0, inrPaise: 0,
            aiAgentPromptLimit: 5, features: [], featured: false
        }],
        billing: { currentPlanId: 'free', planExpiresAt: null },
        paymentConfiguration: {
            razorpay: { keyId: '', isConfigured: false },
            paypal: { clientId: '', isConfigured: false, mode: 'sandbox' }
        },
        aiConfiguration: {
            isConfigured: true,
            promptUsage: {
                planId: 'free', planName: 'Free', limit: 5, used: 0, remaining: 5,
                exhausted: false, periodKind: 'calendar_month', periodStart: '', periodEnd: ''
            }
        },
        showLoginIntro: false,
        cspNonce: 'voice-test-nonce'
    });
}

test('AI Agent keeps its existing composer controls and adds the minimum voice controls', () => {
    const html = dashboardHtml();
    assert.match(html, /id="agentCameraButton"/);
    assert.match(html, /id="agentFolderButton"/);
    assert.match(html, /id="agentCommandInput"/);
    assert.match(html, /id="agentSendButton"/);
    assert.match(html, /id="agentVoiceButton"[^>]*aria-pressed="false"/);
    assert.match(html, /id="agentVoiceEndButton"[^>]*hidden/);
    assert.match(html, /id="agentVoiceStatus"[^>]*aria-live="polite"/);
    assert.match(styleSource, /\.agent-voice-button\[data-state="listening"\]/);
});

test('voice capture is permission-gated, records one high-quality stream, and cleans every resource', () => {
    assert.match(appSource, /agentVoiceButton[\s\S]*addEventListener\('click', handleVoiceButtonClick\)/);
    assert.match(appSource, /navigator\.mediaDevices\.getUserMedia\(\{[\s\S]*echoCancellation: true[\s\S]*noiseSuppression: true[\s\S]*autoGainControl: true/);
    assert.match(appSource, /new MediaRecorder\(voiceStream,[\s\S]*audioBitsPerSecond: 128000/);
    assert.match(appSource, /voiceStream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
    assert.match(appSource, /window\.speechSynthesis\?\.cancel\(\)/);
    assert.match(appSource, /window\.addEventListener\('beforeunload', cleanupVoiceResources\)/);
});

test('voice transcription is authenticated, same-origin protected, rate-limited, and server-side', () => {
    assert.match(serverSource, /pathname === '\/api\/agent\/voice\/transcribe'/);
    assert.match(serverSource, /if \(!session\)[\s\S]*Sign in to use voice input/);
    assert.match(serverSource, /handleVoiceTranscriptionRequest[\s\S]*assertSameOrigin\(req\)/);
    assert.match(serverSource, /getRateState\(voiceRequests/);
    assert.match(serverSource, /geminiService\.transcribeAudio/);
    assert.match(serverSource, /Permissions-Policy', 'camera=\(self\), microphone=\(self\), geolocation=\(\)'/);
    assert.doesNotMatch(appSource, /GEMINI_API_KEY|GOOGLE_API_KEY/);
    assert.match(envExample, /GEMINI_VOICE_TRANSCRIPTION_MODEL=gemini-2\.5-flash/);
});

test('Gemini transcribes multilingual audio without translating it', async () => {
    let requestPayload;
    const service = createGeminiService({
        env: {
            GEMINI_API_KEY: 'server-only-key',
            GEMINI_MODEL: 'gemini-2.5-flash',
            GEMINI_VOICE_TRANSCRIPTION_MODEL: 'gemini-2.5-flash'
        },
        fetchImpl: async (_url, options) => {
            requestPayload = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                headers: { get() { return null; } },
                async text() {
                    return JSON.stringify({
                        candidates: [{ content: { parts: [{ text: '{"transcript":"வணக்கம் OrexisAI","language":"ta-IN","confidence":0.94}' }] } }]
                    });
                }
            };
        }
    });

    const result = await service.transcribeAudio({
        data: Buffer.from('test-audio').toString('base64'),
        mimeType: 'audio/webm'
    });
    assert.equal(result.transcript, 'வணக்கம் OrexisAI');
    assert.equal(result.language, 'ta-IN');
    assert.equal(result.confidence, 0.94);
    const parts = requestPayload.contents[0].parts;
    assert.equal(parts[1].inlineData.mimeType, 'audio/webm');
    assert.match(parts[0].text, /Preserve the original language and script/);
    assert.match(parts[0].text, /Do not translate/);
});

test('voice prompts reuse the normal chat endpoint and normal prompt quota path', () => {
    assert.match(appSource, /commandForm\.requestSubmit\(\)/);
    assert.match(appSource, /requestJson\(`\/api\/chats\/\$\{conversationId\}\/messages`/);
    assert.match(appSource, /body: \{ content, voiceLanguage:/);
    assert.match(serverSource, /reserveAiAgentPromptUsage/);
    assert.match(serverSource, /generateReply\(context, \{ preferredLanguage: voiceLanguage \}\)/);
    assert.match(appSource, /speakVoiceResponse\(result\.assistantMessage\?\.content/);
    assert.match(appSource, /utterance\.addEventListener\('end'[\s\S]*scheduleVoiceRestart/);
});
