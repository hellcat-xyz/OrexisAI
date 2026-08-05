'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { createHcaptchaService } = require('../hcaptcha-service');
const { renderLoginPage } = require('../views/login');
const { renderRegisterPage } = require('../views/register');

const projectRoot = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
const loginClientSource = fs.readFileSync(path.join(projectRoot, 'public', 'login.js'), 'utf8');
const registerClientSource = fs.readFileSync(path.join(projectRoot, 'public', 'register.js'), 'utf8');
const captchaClientSource = fs.readFileSync(path.join(projectRoot, 'public', 'auth-hcaptcha.js'), 'utf8');
const envExample = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');

const SERVER_HARNESS = String.raw`
'use strict';
const Module = require('node:module');
const originalLoad = Module._load;
const serverPath = process.argv[1];
const authSessions = new Map();
const users = new Map([['existing@example.com', {
    id: 1, username: 'Existing User', email: 'existing@example.com', password_hash: 'test-hash'
}]]);
let nextUserId = 2;
let captchaVerified = false;

const database = {
    async initialize() {},
    async close() {},
    async healthCheck() {},
    async deleteExpiredPasswordResetTokens() {},
    async deleteExpiredAuthSessions() {},
    async deleteExpiredAiAgentPromptReservations() {},
    async createAuthSession({ tokenHash, userId, expiresAt, rememberMe, showLoginIntro }) {
        const user = [...users.values()].find((entry) => String(entry.id) === String(userId));
        authSessions.set(tokenHash, {
            user_id: String(userId), username: user.username, email: user.email,
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
        if (!captchaVerified) throw new Error('Credential lookup occurred before hCaptcha verification.');
        captchaVerified = false;
        return users.get(email) || null;
    },
    async createUser({ username, email, passwordHash }) {
        if (!captchaVerified) throw new Error('User creation occurred before hCaptcha verification.');
        captchaVerified = false;
        if (users.has(email)) {
            const error = new Error('duplicate');
            error.code = '23505';
            error.constraint = 'users_email_lower_unique';
            throw error;
        }
        const user = { id: nextUserId++, username, email, password_hash: passwordHash };
        users.set(email, user);
        return user;
    },
    async getBillingProfile() { return { current_plan: 'free', plan_expires_at: null }; },
    async getAiAgentPromptUsage() {
        return { planId: 'free', planName: 'Free', limit: 5, used: 0, remaining: 5,
            exhausted: false, periodKind: 'calendar_month',
            periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z' };
    },
    async getOrCreateBusinessForUser() { return { id: 71 }; },
    async claimDueScheduledWorkflows() { return []; },
    async completeScheduledWorkflow() {}
};
const hcaptchaService = {
    isConfigured: true,
    siteKey: '10000000-ffff-ffff-ffff-000000000001',
    async verify({ token }) {
        captchaVerified = token === 'valid-token';
        if (token === 'valid-token') return { success: true, reason: 'verified', errorCodes: [] };
        if (token === 'service-error') return { success: false, reason: 'unavailable', errorCodes: ['network-error'] };
        return { success: false, reason: 'invalid', errorCodes: ['invalid-input-response'] };
    }
};
const paymentService = { getPublicConfiguration() { return { razorpay: { isConfigured: false }, paypal: { isConfigured: false } }; } };
const geminiService = { getPublicConfiguration() { return { isConfigured: true, model: 'test-model' }; } };
const emailService = { isConfigured: false };
const workflowService = { listDefinitions() { return []; }, getConnectorConfiguration() { return {}; } };
const scheduler = { start() {}, async stop() {} };

process.on('message', (message) => { if (message === 'shutdown') process.emit('SIGTERM'); });

Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'bcrypt') {
        return {
            async hash() { return 'created-hash'; },
            async compare(password) { return password === 'Password123'; }
        };
    }
    if (parent?.filename === serverPath) {
        if (request === './database') return { createDatabaseFromEnvironment: () => database };
        if (request === './payment-service') return { createPaymentService: () => paymentService };
        if (request === './gemini-service') return { createGeminiService: () => geminiService };
        if (request === './email-service') return { createEmailService: () => emailService };
        if (request === './hcaptcha-service') return { createHcaptchaService: () => hcaptchaService };
        if (request === './workflows/service') return { createWorkflowService: () => workflowService };
        if (request === './workflows/marketing-services') return { createMarketingScheduler: () => scheduler };
    }
    return originalLoad.apply(this, arguments);
};

require(serverPath);
`;

test('hCaptcha siteverify uses a form POST with the secret, token, sitekey, and valid remote IP', async () => {
    let request;
    const service = createHcaptchaService({
        siteKey: 'public-site-key',
        secretKey: 'server-secret-key',
        timeoutMs: 2_000,
        async fetchImpl(url, options) {
            request = { url, options };
            return { ok: true, async json() { return { success: true, hostname: 'app.example.com' }; } };
        }
    });

    const result = await service.verify({ token: 'verified-response', remoteIp: '203.0.113.10' });
    assert.equal(result.success, true);
    assert.equal(request.url, 'https://api.hcaptcha.com/siteverify');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(request.options.body.get('secret'), 'server-secret-key');
    assert.equal(request.options.body.get('response'), 'verified-response');
    assert.equal(request.options.body.get('sitekey'), 'public-site-key');
    assert.equal(request.options.body.get('remoteip'), '203.0.113.10');
    assert.equal(service.siteKey, 'public-site-key');
    assert.equal(Object.values(service).includes('server-secret-key'), false);
});

test('hCaptcha rejects missing/invalid tokens and fails closed when verification is unavailable', async () => {
    let calls = 0;
    const invalidService = createHcaptchaService({
        siteKey: 'site-key', secretKey: 'secret-key', timeoutMs: 2_000,
        async fetchImpl() {
            calls += 1;
            return { ok: true, async json() { return { success: false, 'error-codes': ['expired-input-response'] }; } };
        }
    });
    assert.deepEqual(await invalidService.verify({ token: '' }), {
        success: false, reason: 'invalid', errorCodes: ['missing-or-malformed-response']
    });
    assert.equal(calls, 0);
    const invalid = await invalidService.verify({ token: 'expired-token' });
    assert.equal(invalid.success, false);
    assert.equal(invalid.reason, 'invalid');
    assert.deepEqual(invalid.errorCodes, ['expired-input-response']);

    const unavailableService = createHcaptchaService({
        siteKey: 'site-key', secretKey: 'secret-key', timeoutMs: 2_000,
        async fetchImpl() { throw new Error('network unavailable'); }
    });
    const unavailable = await unavailableService.verify({ token: 'token' });
    assert.equal(unavailable.success, false);
    assert.equal(unavailable.reason, 'unavailable');

    const unconfigured = createHcaptchaService({ siteKey: '', secretKey: '', fetchImpl: async () => {} });
    const unconfiguredResult = await unconfigured.verify({ token: 'token' });
    assert.equal(unconfiguredResult.reason, 'unavailable');
});

test('login and registration render the official widget without exposing the hCaptcha secret', () => {
    for (const html of [
        renderLoginPage({ hcaptchaSiteKey: 'public-site-key' }),
        renderRegisterPage({ hcaptchaSiteKey: 'public-site-key' })
    ]) {
        assert.match(html, /data-auth-hcaptcha/);
        assert.match(html, /data-sitekey="public-site-key"/);
        assert.match(html, /https:\/\/js\.hcaptcha\.com\/1\/api\.js/);
        assert.match(html, /auth-hcaptcha\.js/);
        assert.doesNotMatch(html, /HCAPTCHA_SECRET_KEY|server-secret-key/);
    }

    const unavailable = renderLoginPage();
    assert.match(unavailable, /Security verification is temporarily unavailable/);
    assert.doesNotMatch(unavailable, /js\.hcaptcha\.com/);
});

test('auth forms require the official response and server handlers verify it before credentials or user creation', () => {
    assert.match(loginClientSource, /OrexisAuthCaptcha\?\.validate\(\)/);
    assert.match(registerClientSource, /OrexisAuthCaptcha\?\.validate\(\)/);
    assert.match(captchaClientSource, /hcaptcha\.getResponse/);
    assert.match(captchaClientSource, /hcaptcha\.render/);
    assert.doesNotMatch(captchaClientSource, /localStorage|sessionStorage/);

    const loginHandler = serverSource.slice(
        serverSource.indexOf('async function handleLogin'),
        serverSource.indexOf('async function handleForgotPassword')
    );
    const registerHandler = serverSource.slice(
        serverSource.indexOf('async function handleRegister'),
        serverSource.indexOf('function validateRegistration')
    );
    assert.ok(loginHandler.indexOf('verifyAuthCaptcha') < loginHandler.indexOf('database.findUserByEmail'));
    assert.ok(registerHandler.indexOf('verifyAuthCaptcha') < registerHandler.indexOf('database.createUser'));
    assert.match(serverSource, /body\.get\('h-captcha-response'\)/);
    assert.match(serverSource, /https:\/\/hcaptcha\.com https:\/\/\*\.hcaptcha\.com/);
    assert.match(envExample, /^HCAPTCHA_SITE_KEY=$/m);
    assert.match(envExample, /^HCAPTCHA_SECRET_KEY=$/m);
    assert.doesNotMatch(loginClientSource + registerClientSource + captchaClientSource, /HCAPTCHA_SECRET_KEY/);
});

test('login and signup cannot bypass server-side hCaptcha verification', { timeout: 15_000 }, async (t) => {
    const serverPath = path.join(projectRoot, 'server.js');
    const child = spawn(process.execPath, ['-e', SERVER_HARNESS, serverPath], {
        cwd: projectRoot,
        env: { ...process.env, PORT: '0', NODE_ENV: 'test', APP_BASE_URL: 'http://localhost:3000' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            await sendShutdown(child);
            await waitForExit(child);
        }
    });

    const port = await waitForServerPort(child, () => stderr);
    const loginPage = await request(port, { path: '/login' });
    assert.equal(loginPage.status, 200);
    assert.match(loginPage.body, /10000000-ffff-ffff-ffff-000000000001/);
    assert.doesNotMatch(loginPage.body, /server-secret/);

    const missingLogin = await postForm(port, '/login', {
        email: 'existing@example.com', password: 'Password123'
    });
    assert.equal(missingLogin.status, 400, stderr);
    assert.match(missingLogin.body, /Please complete the security verification/);

    const invalidLogin = await postForm(port, '/login', {
        email: 'existing@example.com', password: 'Password123', 'h-captcha-response': 'invalid-token'
    });
    assert.equal(invalidLogin.status, 403, stderr);

    const unavailableLogin = await postForm(port, '/login', {
        email: 'existing@example.com', password: 'Password123', 'h-captcha-response': 'service-error'
    });
    assert.equal(unavailableLogin.status, 503, stderr);
    assert.match(unavailableLogin.body, /temporarily unavailable/);

    const badCredentials = await postForm(port, '/login', {
        email: 'existing@example.com', password: 'WrongPassword', 'h-captcha-response': 'valid-token'
    });
    assert.equal(badCredentials.status, 401, stderr);
    assert.match(badCredentials.body, /Invalid email or password/);

    const successfulLogin = await postForm(port, '/login', {
        email: 'existing@example.com', password: 'Password123', 'h-captcha-response': 'valid-token'
    });
    assert.equal(successfulLogin.status, 303, stderr);
    assert.equal(successfulLogin.headers.location, '/dashboard');
    const cookie = extractCookie(successfulLogin);
    assert.ok(cookie);
    const dashboard = await request(port, { path: '/dashboard', headers: { cookie } });
    assert.equal(dashboard.status, 200, stderr);

    const missingSignup = await postForm(port, '/register', registrationFields());
    assert.equal(missingSignup.status, 400, stderr);

    const invalidSignup = await postForm(port, '/register', {
        ...registrationFields(), 'h-captcha-response': 'invalid-token'
    });
    assert.equal(invalidSignup.status, 403, stderr);

    const unavailableSignup = await postForm(port, '/register', {
        ...registrationFields(), 'h-captcha-response': 'service-error'
    });
    assert.equal(unavailableSignup.status, 503, stderr);

    const invalidRegistration = await postForm(port, '/register', {
        ...registrationFields(), username: 'x', 'h-captcha-response': 'valid-token'
    });
    assert.equal(invalidRegistration.status, 400, stderr);
    assert.match(invalidRegistration.body, /Username must be 3-32/);

    const successfulSignup = await postForm(port, '/register', {
        ...registrationFields(), 'h-captcha-response': 'valid-token'
    });
    assert.equal(successfulSignup.status, 303, stderr);
    assert.equal(successfulSignup.headers.location, '/login?registered=1');

    await sendShutdown(child);
    const exit = await waitForExit(child);
    assert.equal(exit.code, 0, stderr);
});

function registrationFields() {
    return {
        username: 'new_user', email: 'new@example.com',
        password: 'Password123', confirmPassword: 'Password123'
    };
}

function postForm(port, requestPath, fields) {
    const body = new URLSearchParams(fields).toString();
    return request(port, {
        method: 'POST', path: requestPath,
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': Buffer.byteLength(body)
        },
        body
    });
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

function sendShutdown(child) {
    return new Promise((resolve, reject) => {
        child.send('shutdown', (error) => error ? reject(error) : resolve());
    });
}

function waitForExit(child) {
    return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
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
