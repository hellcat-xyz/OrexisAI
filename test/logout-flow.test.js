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
const database = {
    async initialize() {},
    async close() {},
    async healthCheck() {},
    async deleteExpiredPasswordResetTokens() {},
    async findUserByEmail(email) {
        return { id: 1, username: 'Logout Test', email, password_hash: 'test-hash' };
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
    getPublicConfiguration() { return { model: 'test-model' }; }
};
const emailService = { isConfigured: false };
const workflowService = {
    listDefinitions() { return []; },
    getConnectorConfiguration() { return {}; },
    async getEnterpriseAnalytics() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const error = new Error('could not determine data type of parameter $5');
        error.code = '42P18';
        throw error;
    }
};
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

test('logout closes authenticated realtime streams without terminating the server', { timeout: 15_000 }, async (t) => {
    const projectRoot = path.resolve(__dirname, '..');
    const serverPath = path.join(projectRoot, 'server.js');
    const child = spawn(process.execPath, ['-e', SERVER_HARNESS, serverPath], {
        cwd: projectRoot,
        env: {
            ...process.env,
            PORT: '0',
            NODE_ENV: 'test',
            APP_BASE_URL: 'http://localhost:3000'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    });

    const port = await waitForServerPort(child, stderrRef);
    const loginBody = 'email=logout%40example.com&password=Password123';

    const firstLogin = await request(port, {
        method: 'POST',
        path: '/login',
        headers: formHeaders(loginBody),
        body: loginBody
    });
    assert.equal(firstLogin.status, 303);
    assert.equal(firstLogin.headers.location, '/dashboard');
    const firstCookie = extractCookie(firstLogin);
    assert.ok(firstCookie);

    const realtime = await openEventStream(port, firstCookie);
    assert.match(realtime.firstChunk, /event: connected/);

    const analyticsRequest = request(port, {
        path: '/api/analytics/workspace',
        headers: { cookie: firstCookie }
    });

    const logout = await request(port, {
        method: 'POST',
        path: '/logout',
        headers: {
            cookie: firstCookie,
            'content-length': '0',
            origin: 'null',
            'sec-fetch-site': 'same-origin'
        }
    });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.location, '/login');
    assert.match(logout.headers['set-cookie']?.[0] || '', /Max-Age=0/);
    await withTimeout(realtime.closed, 1_500, 'authenticated SSE response did not close during logout');

    const analyticsFailure = await analyticsRequest;
    assert.equal(analyticsFailure.status, 500);
    assert.match(analyticsFailure.body, /Something went wrong/);
    assert.equal(child.exitCode, null, stderr);

    const protectedResult = await request(port, {
        path: '/api/billing/profile',
        headers: { cookie: firstCookie }
    });
    assert.equal(protectedResult.status, 401);

    const health = await request(port, { path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(child.exitCode, null, stderr);

    const crossSiteLogout = await request(port, {
        method: 'POST',
        path: '/logout',
        headers: {
            cookie: firstCookie,
            'content-length': '0',
            origin: 'https://attacker.example',
            'sec-fetch-site': 'cross-site'
        }
    });
    assert.equal(crossSiteLogout.status, 403);
    assert.match(crossSiteLogout.body, /This request was rejected/);

    const secondLogin = await request(port, {
        method: 'POST',
        path: '/login',
        headers: formHeaders(loginBody),
        body: loginBody
    });
    assert.equal(secondLogin.status, 303);
    const secondCookie = extractCookie(secondLogin);
    assert.ok(secondCookie);
    assert.notEqual(secondCookie, firstCookie);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const logoutResult = await request(port, {
            method: 'POST',
            path: '/logout',
            headers: { cookie: attempt === 0 ? secondCookie : firstCookie, 'content-length': '0' }
        });
        assert.equal(logoutResult.status, 303);
        assert.equal(logoutResult.headers.location, '/login');
    }

    assert.equal(child.exitCode, null, stderr);
    child.kill('SIGTERM');
    const exit = await waitForExit(child);
    assert.equal(exit.code, 0, stderr);

    function stderrRef() {
        return stderr;
    }
});

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

function openEventStream(port, cookie) {
    return new Promise((resolve, reject) => {
        const req = http.get({
            host: '127.0.0.1',
            port,
            path: '/api/marketing/events',
            headers: { cookie, accept: 'text/event-stream' }
        });
        req.once('error', reject);
        req.once('response', (res) => {
            res.setEncoding('utf8');
            const closed = new Promise((resolveClosed) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    resolveClosed();
                };
                res.once('end', finish);
                res.once('close', finish);
            });
            let initialData = '';
            const onData = (chunk) => {
                initialData += chunk;
                if (!initialData.includes('event: connected')) return;
                res.off('data', onData);
                resolve({ firstChunk: initialData, closed });
            };
            res.on('data', onData);
        });
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

function waitForExit(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
    }
    return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}
