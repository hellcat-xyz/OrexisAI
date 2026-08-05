'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const SERVER_HARNESS = String.raw`
'use strict';
const Module = require('node:module');
const originalLoad = Module._load;
const serverPath = process.argv[1];
const authSessions = new Map();
const conversations = new Map();
const messages = new Map();
let nextConversationId = 1;
let nextMessageId = 1;
let usedPrompts = 0;
let nextReservationId = 1;
const promptReservations = new Set();

function promptUsage() {
    return {
        planId: 'free', planName: 'Free', limit: 5, used: usedPrompts,
        remaining: Math.max(0, 5 - usedPrompts), exhausted: usedPrompts >= 5,
        periodKind: 'calendar_month',
        periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z'
    };
}
function conversationRecord(id) {
    const conversation = conversations.get(Number(id));
    const rows = messages.get(Number(id)) || [];
    return {
        ...conversation,
        message_count: rows.length,
        last_message: rows.at(-1)?.content || ''
    };
}
const database = {
    async initialize() {},
    async close() {},
    async healthCheck() {},
    async deleteExpiredPasswordResetTokens() {},
    async deleteExpiredAuthSessions() {},
    async deleteExpiredAiAgentPromptReservations() {},
    async createAuthSession({ tokenHash, userId, expiresAt, rememberMe, showLoginIntro }) {
        authSessions.set(tokenHash, {
            user_id: String(userId), username: 'Quota Test', email: 'quota@example.com',
            expires_at: expiresAt, remember_me: rememberMe, show_login_intro: showLoginIntro
        });
    },
    async findAuthSession(tokenHash) { return authSessions.get(tokenHash) || null; },
    async markAuthSessionIntroShown(tokenHash) {
        const session = authSessions.get(tokenHash);
        if (session) session.show_login_intro = false;
    },
    async deleteAuthSession(tokenHash) { authSessions.delete(tokenHash); },
    async deleteAuthSessionsForUser(userId) {
        for (const [tokenHash, session] of authSessions) {
            if (String(session.user_id) === String(userId)) authSessions.delete(tokenHash);
        }
    },
    async findUserByEmail(email) {
        return { id: 1, username: 'Quota Test', email, password_hash: 'test-hash' };
    },
    async getBillingProfile() { return { current_plan: 'free', plan_expires_at: null }; },
    async getAiAgentPromptUsage() { return promptUsage(); },
    async reserveAiAgentPromptUsage() {
        if (usedPrompts + promptReservations.size >= 5) return { allowed: false, usage: promptUsage() };
        const reservationId = 'reservation-' + nextReservationId++;
        promptReservations.add(reservationId);
        return { allowed: true, reservationId, usage: promptUsage() };
    },
    async commitAiAgentPromptUsage({ reservationId }) {
        if (!promptReservations.delete(reservationId)) throw new Error('Missing prompt reservation.');
        usedPrompts += 1;
        return promptUsage();
    },
    async cancelAiAgentPromptUsageReservation({ reservationId }) {
        promptReservations.delete(reservationId);
        return promptUsage();
    },
    async listChatConversations() { return Array.from(conversations.keys()).map(conversationRecord); },
    async createChatConversation({ title }) {
        const id = nextConversationId++;
        const now = new Date().toISOString();
        const row = { id, title, created_at: now, updated_at: now };
        conversations.set(id, row);
        messages.set(id, []);
        return conversationRecord(id);
    },
    async addChatCommand({ conversationId, content, generatedTitle }) {
        const conversation = conversations.get(Number(conversationId));
        if (!conversation) {
            const error = new Error('Chat not found');
            error.code = 'CHAT_NOT_FOUND';
            throw error;
        }
        if (conversation.title === 'New chat') conversation.title = generatedTitle;
        conversation.updated_at = new Date().toISOString();
        const message = {
            id: nextMessageId++, role: 'user', content, created_at: conversation.updated_at
        };
        messages.get(Number(conversationId)).push(message);
        return { conversation: conversationRecord(conversationId), message };
    },
    async getChatContext({ conversationId }) { return [...(messages.get(Number(conversationId)) || [])]; },
    async addChatAssistantResponse({ conversationId, content }) {
        const conversation = conversations.get(Number(conversationId));
        conversation.updated_at = new Date().toISOString();
        const message = {
            id: nextMessageId++, role: 'assistant', content, created_at: conversation.updated_at
        };
        messages.get(Number(conversationId)).push(message);
        return { conversation: conversationRecord(conversationId), message };
    },
    async getOrCreateBusinessForUser() { return { id: 71 }; },
    async claimDueScheduledWorkflows() { return []; },
    async completeScheduledWorkflow() {}
};
const paymentService = {
    getPublicConfiguration() {
        return { razorpay: { isConfigured: false }, paypal: { isConfigured: false } };
    }
};
const geminiService = {
    getPublicConfiguration() { return { isConfigured: true, model: 'test-model' }; },
    async generateReply(context) {
        const content = context.at(-1)?.content || '';
        if (content === 'reject-before-provider') {
            const error = new Error('Provider configuration rejected the request before dispatch.');
            error.code = 'PRE_PROVIDER_REJECTION';
            error.statusCode = 503;
            error.publicMessage = 'The request was not sent.';
            throw error;
        }
        if (content === 'provider-quota') {
            const error = new Error('Quota exceeded for provider metric.');
            error.code = 'GEMINI_API_ERROR';
            error.statusCode = 503;
            error.providerHttpStatus = 429;
            error.publicMessage = 'Gemini quota is currently exhausted.';
            throw error;
        }
        return { content: 'Completed.', model: 'test-model' };
    }
};
const emailService = { isConfigured: false };
const workflowService = { listDefinitions() { return []; }, getConnectorConfiguration() { return {}; } };
const scheduler = { start() {}, async stop() {} };

Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'bcrypt') {
        return {
            async hash() { return 'dummy-hash'; },
            async compare(password) { return password === 'Password123'; }
        };
    }
    if (parent?.filename === serverPath) {
        if (request === './database') return { createDatabaseFromEnvironment: () => database };
        if (request === './payment-service') return { createPaymentService: () => paymentService };
        if (request === './gemini-service') return { createGeminiService: () => geminiService };
        if (request === './email-service') return { createEmailService: () => emailService };
        if (request === './workflows/service') return { createWorkflowService: () => workflowService };
        if (request === './workflows/marketing-services') return { createMarketingScheduler: () => scheduler };
    }
    return originalLoad.apply(this, arguments);
};

require(serverPath);
`;

test('Free AI Agent quota counts only provider-submitted prompts and survives chat/login changes', { timeout: 15_000 }, async (t) => {
    const projectRoot = path.resolve(__dirname, '..');
    const serverPath = path.join(projectRoot, 'server.js');
    const child = spawn(process.execPath, ['-e', SERVER_HARNESS, serverPath], {
        cwd: projectRoot,
        env: { ...process.env, PORT: '0', NODE_ENV: 'test', APP_BASE_URL: 'http://localhost:3000' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    });

    const port = await waitForServerPort(child, () => stderr);
    const loginBody = 'email=quota%40example.com&password=Password123';
    const login = await request(port, {
        method: 'POST', path: '/login', headers: formHeaders(loginBody), body: loginBody
    });
    assert.equal(login.status, 303);
    let cookie = extractCookie(login);

    const firstChat = await createChat(port, cookie);
    const preProviderFailure = await sendPrompt(port, cookie, firstChat, 'reject-before-provider');
    assert.equal(preProviderFailure.status, 503);
    assert.equal(preProviderFailure.json.commandSaved, true);
    assert.equal(preProviderFailure.json.promptUsage.used, 0);

    const providerQuotaFailure = await sendPrompt(port, cookie, firstChat, 'provider-quota');
    assert.equal(providerQuotaFailure.status, 503);
    assert.equal(providerQuotaFailure.json.commandSaved, true);
    assert.equal(providerQuotaFailure.json.promptUsage.used, 0);
    assert.match(providerQuotaFailure.json.error, /Gemini quota/);

    for (let index = 1; index <= 5; index += 1) {
        const response = await sendPrompt(port, cookie, firstChat, `accepted-${index}`);
        assert.equal(response.status, 201, stderr);
        assert.equal(response.json.promptUsage.used, index);
        assert.equal(response.json.promptUsage.remaining, 5 - index);
    }

    const sixth = await sendPrompt(port, cookie, firstChat, 'blocked-sixth');
    assert.equal(sixth.status, 429);
    assert.equal(sixth.json.code, 'AI_AGENT_PROMPT_LIMIT_REACHED');
    assert.equal(sixth.json.promptUsage.used, 5);
    assert.match(sixth.json.error, /monthly limit of 5 AI Agent prompts/);

    const secondChat = await createChat(port, cookie);
    const newChatAttempt = await sendPrompt(port, cookie, secondChat, 'new-chat-bypass');
    assert.equal(newChatAttempt.status, 429);
    assert.equal(newChatAttempt.json.promptUsage.used, 5);

    const logout = await request(port, {
        method: 'POST', path: '/logout',
        headers: { cookie, 'content-length': '0', 'sec-fetch-site': 'same-origin' }
    });
    assert.equal(logout.status, 303);

    const secondLogin = await request(port, {
        method: 'POST', path: '/login', headers: formHeaders(loginBody), body: loginBody
    });
    assert.equal(secondLogin.status, 303);
    cookie = extractCookie(secondLogin);
    const reloginAttempt = await sendPrompt(port, cookie, secondChat, 'login-bypass');
    assert.equal(reloginAttempt.status, 429);
    assert.equal(reloginAttempt.json.promptUsage.used, 5);
    assert.equal(child.exitCode, null, stderr);
});

async function createChat(port, cookie) {
    const response = await requestJson(port, {
        method: 'POST', path: '/api/chats', headers: { cookie, 'sec-fetch-site': 'same-origin' },
        body: { title: 'New chat' }
    });
    assert.equal(response.status, 201);
    return response.json.conversation.id;
}

function sendPrompt(port, cookie, conversationId, content) {
    return requestJson(port, {
        method: 'POST', path: `/api/chats/${conversationId}/messages`,
        headers: { cookie, 'sec-fetch-site': 'same-origin' }, body: { content }
    });
}

function requestJson(port, { method, path: requestPath, headers = {}, body }) {
    const encoded = JSON.stringify(body);
    return request(port, {
        method,
        path: requestPath,
        headers: {
            ...headers,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(encoded)
        },
        body: encoded
    }).then((response) => ({ ...response, json: JSON.parse(response.body) }));
}

function formHeaders(body) {
    return {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body)
    };
}

function extractCookie(response) {
    return response.headers['set-cookie']?.[0]?.split(';', 1)[0] || '';
}

function request(port, { method = 'GET', path: requestPath = '/', headers = {}, body = '' }) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (res) => {
            let responseBody = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { responseBody += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function waitForServerPort(child, getStderr) {
    return new Promise((resolve, reject) => {
        let stdout = '';
        const timeout = setTimeout(() => reject(new Error(`Server did not start. ${getStderr()}`)), 5_000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            const match = stdout.match(/OrexisAI is running at http:\/\/localhost:(\d+)/);
            if (!match) return;
            clearTimeout(timeout);
            resolve(Number(match[1]));
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timeout);
            reject(new Error(`Server exited before startup (${code ?? signal}). ${getStderr()}`));
        });
    });
}
