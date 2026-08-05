'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SERVER_HARNESS = String.raw`
'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const originalLoad = Module._load;
const serverPath = process.argv[1];
const storePath = process.env.TEST_SESSION_STORE;

function readSessions() {
    try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); }
    catch { return {}; }
}
function writeSessions(value) {
    fs.writeFileSync(storePath, JSON.stringify(value), 'utf8');
}
const database = {
    async initialize() {},
    async close() {},
    async healthCheck() {},
    async deleteExpiredPasswordResetTokens() {},
    async deleteExpiredAuthSessions() {
        const sessions = readSessions();
        const now = Date.now();
        for (const [tokenHash, session] of Object.entries(sessions)) {
            if (new Date(session.expires_at).getTime() <= now) delete sessions[tokenHash];
        }
        writeSessions(sessions);
    },
    async createAuthSession({ tokenHash, userId, expiresAt, rememberMe, showLoginIntro }) {
        const sessions = readSessions();
        sessions[tokenHash] = {
            user_id: String(userId),
            username: 'Persistent User',
            email: 'persistent@example.com',
            expires_at: new Date(expiresAt).toISOString(),
            remember_me: rememberMe,
            show_login_intro: showLoginIntro
        };
        writeSessions(sessions);
    },
    async findAuthSession(tokenHash) {
        const sessions = readSessions();
        const session = sessions[tokenHash];
        if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
        return { ...session };
    },
    async markAuthSessionIntroShown(tokenHash) {
        const sessions = readSessions();
        if (sessions[tokenHash]) sessions[tokenHash].show_login_intro = false;
        writeSessions(sessions);
    },
    async deleteAuthSession(tokenHash) {
        const sessions = readSessions();
        delete sessions[tokenHash];
        writeSessions(sessions);
    },
    async deleteAuthSessionsForUser(userId) {
        const sessions = readSessions();
        for (const [tokenHash, session] of Object.entries(sessions)) {
            if (String(session.user_id) === String(userId)) delete sessions[tokenHash];
        }
        writeSessions(sessions);
    },
    async findUserByEmail(email) {
        return { id: 9, username: 'Persistent User', email, password_hash: 'test-hash' };
    },
    async getBillingProfile() { return { current_plan: 'free', plan_expires_at: null }; },
    async getAiAgentPromptUsage() {
        return {
            planId: 'free', planName: 'Free', limit: 5, used: 0, remaining: 5,
            exhausted: false, periodKind: 'calendar_month',
            periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z'
        };
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
    getPublicConfiguration() { return { isConfigured: true, model: 'test-model' }; }
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

test('authenticated sessions survive a server restart and logout deletes the persisted record', { timeout: 15_000 }, async (t) => {
    const projectRoot = path.resolve(__dirname, '..');
    const serverPath = path.join(projectRoot, 'server.js');
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'orexisai-session-test-'));
    const sessionStore = path.join(tempDirectory, 'sessions.json');
    await fs.writeFile(sessionStore, '{}', 'utf8');
    t.after(() => fs.rm(tempDirectory, { recursive: true, force: true }));

    const first = await startServer(projectRoot, serverPath, sessionStore);
    t.after(() => stopServer(first));
    const loginBody = 'email=persistent%40example.com&password=Password123&remember=on';
    const login = await request(first.port, {
        method: 'POST',
        path: '/login',
        headers: formHeaders(loginBody),
        body: loginBody
    });
    assert.equal(login.status, 303);
    const cookie = extractCookie(login);
    assert.ok(cookie);
    await stopServer(first);

    const second = await startServer(projectRoot, serverPath, sessionStore);
    t.after(() => stopServer(second));
    const dashboard = await request(second.port, { path: '/dashboard', headers: { cookie } });
    assert.equal(dashboard.status, 200, second.getStderr());
    assert.match(dashboard.body, /data-user-email="persistent@example.com"/);

    const logout = await request(second.port, {
        method: 'POST',
        path: '/logout',
        headers: { cookie, 'content-length': '0', 'sec-fetch-site': 'same-origin' }
    });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.location, '/login');
    await stopServer(second);

    const third = await startServer(projectRoot, serverPath, sessionStore);
    t.after(() => stopServer(third));
    const afterLogout = await request(third.port, { path: '/dashboard', headers: { cookie } });
    assert.equal(afterLogout.status, 303, third.getStderr());
    assert.equal(afterLogout.headers.location, '/login');
});

async function startServer(projectRoot, serverPath, sessionStore) {
    const child = spawn(process.execPath, ['-e', SERVER_HARNESS, serverPath], {
        cwd: projectRoot,
        env: {
            ...process.env,
            PORT: '0',
            NODE_ENV: 'test',
            APP_BASE_URL: 'http://localhost:3000',
            TEST_SESSION_STORE: sessionStore
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const port = await waitForServerPort(child, () => stderr);
    return { child, port, getStderr: () => stderr };
}

async function stopServer(server) {
    if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
    server.child.kill('SIGTERM');
    const exit = await new Promise((resolve) => server.child.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.code, 0, server.getStderr());
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
