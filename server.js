'use strict';

const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { createDatabaseFromEnvironment } = require('./database');
const { renderLoginPage } = require('./views/login');
const { renderRegisterPage } = require('./views/register');
const { renderDashboardPage } = require('./views/dashboard');

loadEnvironmentFile(path.join(__dirname, '.env'));

const PORT = parsePort(process.env.PORT || '3000');
const isProduction = process.env.NODE_ENV === 'production';
const BCRYPT_ROUNDS = parseBcryptRounds(process.env.BCRYPT_ROUNDS || '12');
const SESSION_COOKIE_NAME = 'outcomeai_session';
const NORMAL_SESSION_MS = 12 * 60 * 60 * 1000;
const REMEMBER_ME_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_REGISTER_ATTEMPTS = 5;
const MAX_BODY_BYTES = 10 * 1024;

const database = createDatabaseFromEnvironment();
const sessions = new Map();
const loginAttempts = new Map();
const registerAttempts = new Map();
const publicFiles = new Map([
    ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
    ['/login.css', { file: 'login.css', type: 'text/css; charset=utf-8' }],
    ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
    ['/login.js', { file: 'login.js', type: 'text/javascript; charset=utf-8' }],
    ['/register.js', { file: 'register.js', type: 'text/javascript; charset=utf-8' }]
]);

let dummyPasswordHash;
let shuttingDown = false;

const server = http.createServer(async (req, res) => {
    try {
        applySecurityHeaders(res);
        const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = requestUrl.pathname;

        if (req.method === 'GET' && publicFiles.has(pathname)) {
            return servePublicFile(res, publicFiles.get(pathname));
        }

        if (req.method === 'GET' && pathname === '/health') {
            return handleHealthCheck(res);
        }

        const session = getSession(req);

        if (req.method === 'GET' && pathname === '/') {
            return redirect(res, session ? '/dashboard' : '/login');
        }

        if (req.method === 'GET' && pathname === '/login') {
            if (session) {
                return redirect(res, '/dashboard');
            }
            return sendHtml(res, 200, loginPage({
                success: requestUrl.searchParams.get('registered') === '1'
                    ? 'Account created. Sign in with your new credentials.'
                    : ''
            }));
        }

        if (req.method === 'POST' && pathname === '/login') {
            if (session) {
                return redirect(res, '/dashboard');
            }
            return handleLogin(req, res);
        }

        if (req.method === 'GET' && pathname === '/register') {
            if (session) {
                return redirect(res, '/dashboard');
            }
            return sendHtml(res, 200, registerPage());
        }

        if (req.method === 'POST' && pathname === '/register') {
            if (session) {
                return redirect(res, '/dashboard');
            }
            return handleRegister(req, res);
        }

        if (req.method === 'GET' && pathname === '/dashboard') {
            if (!session) {
                return redirect(res, '/login');
            }
            return sendHtml(res, 200, renderDashboardPage({
                user: {
                    email: session.email,
                    displayName: session.username,
                    initials: initialsFromUsername(session.username)
                }
            }));
        }

        if (req.method === 'POST' && pathname === '/logout') {
            if (session) {
                sessions.delete(session.token);
            }
            clearSessionCookie(res);
            return redirect(res, '/login');
        }

        return sendText(res, 404, 'Not found');
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            return sendText(res, error.statusCode || 500, error.publicMessage || 'Something went wrong. Please try again.');
        }
        return res.end();
    }
});

async function handleHealthCheck(res) {
    try {
        await database.healthCheck();
        return sendJson(res, 200, { status: 'ok', database: 'connected' });
    } catch (error) {
        console.error('Database health check failed:', error.message);
        return sendJson(res, 503, { status: 'error', database: 'unavailable' });
    }
}

async function handleLogin(req, res) {
    const clientIp = getClientIp(req);
    const rateState = getRateState(loginAttempts, clientIp, LOGIN_WINDOW_MS);

    if (rateState.count >= MAX_LOGIN_ATTEMPTS) {
        res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
        return sendHtml(res, 429, loginPage({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' }));
    }

    const body = await readFormBody(req);
    const email = normalizeEmail(body.get('email') || '');
    const password = body.get('password') || '';
    const rememberMe = body.get('rememberMe') === 'on';

    if (!isValidEmail(email) || !isValidPassword(password)) {
        recordFailedAttempt(loginAttempts, clientIp, LOGIN_WINDOW_MS);
        return sendHtml(res, 401, loginPage({ error: 'Invalid email or password.', email }));
    }

    const user = await database.findUserByEmail(email);
    const passwordHash = user?.password_hash || dummyPasswordHash;
    let passwordMatches = false;

    try {
        passwordMatches = await bcrypt.compare(password, passwordHash);
    } catch (error) {
        console.error('Unable to compare password hash:', error.message);
    }

    if (!user || !passwordMatches) {
        recordFailedAttempt(loginAttempts, clientIp, LOGIN_WINDOW_MS);
        return sendHtml(res, 401, loginPage({ error: 'Invalid email or password.', email }));
    }

    loginAttempts.delete(clientIp);
    createSession(res, user, rememberMe);
    return redirect(res, '/dashboard');
}

async function handleRegister(req, res) {
    const clientIp = getClientIp(req);
    const rateState = getRateState(registerAttempts, clientIp, REGISTER_WINDOW_MS);

    if (rateState.count >= MAX_REGISTER_ATTEMPTS) {
        res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
        return sendHtml(res, 429, registerPage({ error: 'Too many registration attempts. Please try again later.' }));
    }

    const body = await readFormBody(req);
    const username = normalizeUsername(body.get('username') || '');
    const email = normalizeEmail(body.get('email') || '');
    const password = body.get('password') || '';
    const confirmPassword = body.get('confirmPassword') || '';

    const validationError = validateRegistration({ username, email, password, confirmPassword });
    if (validationError) {
        recordFailedAttempt(registerAttempts, clientIp, REGISTER_WINDOW_MS);
        return sendHtml(res, 400, registerPage({ error: validationError, username, email }));
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    try {
        await database.createUser({ username, email, passwordHash });
        registerAttempts.delete(clientIp);
        return redirect(res, '/login?registered=1');
    } catch (error) {
        if (error.code === '23505') {
            recordFailedAttempt(registerAttempts, clientIp, REGISTER_WINDOW_MS);
            const duplicateMessage = error.constraint === 'users_username_lower_unique'
                ? 'That username is already taken.'
                : 'An account with that email already exists.';
            return sendHtml(res, 409, registerPage({ error: duplicateMessage, username, email }));
        }
        throw error;
    }
}

function validateRegistration({ username, email, password, confirmPassword }) {
    if (!isValidUsername(username)) {
        return 'Username must be 3-32 characters and contain only letters, numbers, or underscores.';
    }
    if (!isValidEmail(email)) {
        return 'Enter a valid email address.';
    }
    if (!isValidPassword(password)) {
        return 'Password must be at least 8 characters and no more than 72 UTF-8 bytes.';
    }
    if (password !== confirmPassword) {
        return 'Passwords do not match.';
    }
    return '';
}

function createSession(res, user, rememberMe) {
    const token = crypto.randomBytes(32).toString('base64url');
    const sessionLifetime = rememberMe ? REMEMBER_ME_MS : NORMAL_SESSION_MS;
    sessions.set(token, {
        token,
        userId: String(user.id),
        username: user.username,
        email: user.email,
        expiresAt: Date.now() + sessionLifetime
    });
    setSessionCookie(res, token, rememberMe ? REMEMBER_ME_MS : null);
}

function loginPage(overrides = {}) {
    return renderLoginPage({ error: '', success: '', email: '', ...overrides });
}

function registerPage(overrides = {}) {
    return renderRegisterPage({ error: '', username: '', email: '', ...overrides });
}

function getSession(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) {
        return null;
    }

    const session = sessions.get(token);
    if (!session) {
        return null;
    }

    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    return session;
}

function setSessionCookie(res, token, maxAgeMs) {
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/'
    ];

    if (isProduction) {
        parts.push('Secure');
    }

    if (maxAgeMs !== null) {
        parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
    }

    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
    const parts = [
        `${SESSION_COOKIE_NAME}=`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0'
    ];
    if (isProduction) {
        parts.push('Secure');
    }
    res.setHeader('Set-Cookie', parts.join('; '));
}

function parseCookies(header) {
    return header.split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator === -1) {
            return cookies;
        }
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (!key) {
            return cookies;
        }
        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
        return cookies;
    }, {});
}

function getRateState(store, clientIp, windowMs) {
    const now = Date.now();
    const current = store.get(clientIp);
    if (!current || current.resetAt <= now) {
        const fresh = { count: 0, resetAt: now + windowMs };
        store.set(clientIp, fresh);
        return fresh;
    }
    return current;
}

function recordFailedAttempt(store, clientIp, windowMs) {
    const state = getRateState(store, clientIp, windowMs);
    state.count += 1;
}

function getClientIp(req) {
    if (process.env.TRUST_PROXY === 'true') {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string' && forwarded.trim()) {
            return forwarded.split(',')[0].trim();
        }
    }
    return req.socket.remoteAddress || 'unknown';
}

async function readFormBody(req) {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
        const error = new Error('Unsupported content type');
        error.statusCode = 415;
        error.publicMessage = 'Unsupported form submission.';
        throw error;
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            const error = new Error('Request body too large');
            error.statusCode = 413;
            error.publicMessage = 'Form submission is too large.';
            throw error;
        }
        chunks.push(chunk);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function servePublicFile(res, asset) {
    const filePath = path.join(__dirname, 'public', asset.file);
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Length': content.length,
        'Cache-Control': isProduction ? 'public, max-age=86400' : 'no-cache'
    });
    res.end(content);
}

function applySecurityHeaders(res) {
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ].join('; '));
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
}

function sendHtml(res, statusCode, html) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
}

function sendJson(res, statusCode, value) {
    const body = JSON.stringify(value);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function sendText(res, statusCode, text) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(text)
    });
    res.end(text);
}

function redirect(res, location) {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
}

function normalizeEmail(value) {
    return String(value).trim().toLowerCase();
}

function normalizeUsername(value) {
    return String(value).trim();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function isValidUsername(value) {
    return /^[A-Za-z0-9_]{3,32}$/.test(value);
}

function isValidPassword(value) {
    return typeof value === 'string'
        && value.length >= 8
        && Buffer.byteLength(value, 'utf8') <= 72;
}

function initialsFromUsername(username) {
    const words = String(username).split(/[\s._-]+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'OA';
}

function parsePort(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error('PORT must be a number between 0 and 65535.');
    }
    return parsed;
}

function parseBcryptRounds(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 10 || parsed > 14) {
        throw new Error('BCRYPT_ROUNDS must be a number between 10 and 14.');
    }
    return parsed;
}

function loadEnvironmentFile(filePath) {
    let content;
    try {
        content = require('node:fs').readFileSync(filePath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return;
        }
        throw error;
    }

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const separator = line.indexOf('=');
        if (separator === -1) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

function cleanExpiredState() {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (session.expiresAt <= now) {
            sessions.delete(token);
        }
    }
    for (const store of [loginAttempts, registerAttempts]) {
        for (const [clientIp, state] of store) {
            if (state.resetAt <= now) {
                store.delete(clientIp);
            }
        }
    }
}

async function shutDown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    console.log(`${signal} received. Shutting down...`);
    server.close(async () => {
        try {
            await database.close();
        } finally {
            process.exit(0);
        }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}

setInterval(cleanExpiredState, 10 * 60 * 1000).unref();
process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));

Promise.all([
    database.initialize(),
    bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS)
])
    .then(([, generatedDummyHash]) => {
        dummyPasswordHash = generatedDummyHash;
        server.listen(PORT, () => {
            const address = server.address();
            const activePort = typeof address === 'object' && address ? address.port : PORT;
            console.log(`OutcomeAI is running at http://localhost:${activePort}`);
            console.log('PostgreSQL users table is ready.');
        });
    })
    .catch(async (error) => {
        console.error('Unable to start server:', error.message);
        await database.close().catch(() => {});
        process.exit(1);
    });
