'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const { URL } = require('node:url');
const { renderLoginPage } = require('./views/login');
const { renderDashboardPage } = require('./views/dashboard');

loadEnvironmentFile(path.join(__dirname, '.env'));

const scrypt = promisify(crypto.scrypt);
const PORT = parsePort(process.env.PORT || '3000');
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_NAME = 'outcomeai_session';
const NORMAL_SESSION_MS = 12 * 60 * 60 * 1000;
const REMEMBER_ME_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_BODY_BYTES = 10 * 1024;
const DEFAULT_EMAIL = 'demo@outcomeai.local';
const DEFAULT_PASSWORD = 'OutcomeAI123!';

const authEmail = normalizeEmail(process.env.AUTH_EMAIL || DEFAULT_EMAIL);
const usingDefaultCredentials = !process.env.AUTH_EMAIL && !process.env.AUTH_PASSWORD && !process.env.AUTH_PASSWORD_HASH;
const sessions = new Map();
const loginAttempts = new Map();
const publicFiles = new Map([
    ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
    ['/login.css', { file: 'login.css', type: 'text/css; charset=utf-8' }],
    ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
    ['/login.js', { file: 'login.js', type: 'text/javascript; charset=utf-8' }]
]);

let configuredPassword;

if (isProduction && usingDefaultCredentials) {
    throw new Error('Configure AUTH_EMAIL and AUTH_PASSWORD_HASH before running in production.');
}

const server = http.createServer(async (req, res) => {
    try {
        applySecurityHeaders(res);
        const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = requestUrl.pathname;

        if (req.method === 'GET' && publicFiles.has(pathname)) {
            return servePublicFile(res, publicFiles.get(pathname));
        }

        if (req.method === 'GET' && pathname === '/health') {
            return sendJson(res, 200, { status: 'ok' });
        }

        const session = getSession(req);

        if (req.method === 'GET' && pathname === '/') {
            return redirect(res, session ? '/dashboard' : '/login');
        }

        if (req.method === 'GET' && pathname === '/login') {
            if (session) {
                return redirect(res, '/dashboard');
            }
            return sendHtml(res, 200, loginPage());
        }

        if (req.method === 'POST' && pathname === '/login') {
            if (session) {
                return redirect(res, '/dashboard');
            }
            return handleLogin(req, res);
        }

        if (req.method === 'GET' && pathname === '/dashboard') {
            if (!session) {
                return redirect(res, '/login');
            }
            return sendHtml(res, 200, renderDashboardPage({
                user: {
                    email: session.email,
                    displayName: displayNameFromEmail(session.email),
                    initials: initialsFromEmail(session.email)
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

async function handleLogin(req, res) {
    const clientIp = getClientIp(req);
    const rateState = getRateState(clientIp);

    if (rateState.count >= MAX_LOGIN_ATTEMPTS) {
        res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
        return sendHtml(res, 429, loginPage({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' }));
    }

    const body = await readFormBody(req);
    const email = normalizeEmail(body.get('email') || '');
    const password = body.get('password') || '';
    const rememberMe = body.get('rememberMe') === 'on';

    if (!isValidEmail(email) || password.length < 8 || password.length > 256) {
        recordFailedAttempt(clientIp);
        return sendHtml(res, 401, loginPage({ error: 'Invalid email or password.', email }));
    }

    const emailMatches = safeStringEqual(email, authEmail);
    const passwordMatches = await verifyPassword(password);

    if (!emailMatches || !passwordMatches) {
        recordFailedAttempt(clientIp);
        return sendHtml(res, 401, loginPage({ error: 'Invalid email or password.', email }));
    }

    loginAttempts.delete(clientIp);
    const token = crypto.randomBytes(32).toString('base64url');
    const sessionLifetime = rememberMe ? REMEMBER_ME_MS : NORMAL_SESSION_MS;
    sessions.set(token, {
        token,
        email: authEmail,
        expiresAt: Date.now() + sessionLifetime
    });
    setSessionCookie(res, token, rememberMe ? REMEMBER_ME_MS : null);
    return redirect(res, '/dashboard');
}

function loginPage(overrides = {}) {
    return renderLoginPage({
        error: '',
        email: '',
        showDemoCredentials: usingDefaultCredentials && !isProduction,
        demoEmail: DEFAULT_EMAIL,
        demoPassword: DEFAULT_PASSWORD,
        ...overrides
    });
}

async function preparePasswordVerifier() {
    const hashFromEnvironment = process.env.AUTH_PASSWORD_HASH?.trim();

    if (hashFromEnvironment) {
        const parts = hashFromEnvironment.split('$');
        if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]+$/i.test(parts[1]) || !/^[a-f0-9]+$/i.test(parts[2])) {
            throw new Error('AUTH_PASSWORD_HASH must use the format scrypt$<salt>$<hex digest>.');
        }

        const digest = Buffer.from(parts[2], 'hex');
        if (digest.length !== 64) {
            throw new Error('AUTH_PASSWORD_HASH digest must be 64 bytes (128 hexadecimal characters).');
        }

        configuredPassword = { salt: parts[1], digest };
        return;
    }

    const password = process.env.AUTH_PASSWORD || DEFAULT_PASSWORD;
    const salt = 'outcomeai-local-development';
    configuredPassword = {
        salt,
        digest: await scrypt(password, salt, 64)
    };
}

async function verifyPassword(candidate) {
    const candidateDigest = await scrypt(candidate, configuredPassword.salt, configuredPassword.digest.length);
    return crypto.timingSafeEqual(candidateDigest, configuredPassword.digest);
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

function getRateState(clientIp) {
    const now = Date.now();
    const current = loginAttempts.get(clientIp);
    if (!current || current.resetAt <= now) {
        const fresh = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
        loginAttempts.set(clientIp, fresh);
        return fresh;
    }
    return current;
}

function recordFailedAttempt(clientIp) {
    const state = getRateState(clientIp);
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

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function safeStringEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function displayNameFromEmail(email) {
    return email
        .split('@')[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'OutcomeAI User';
}

function initialsFromEmail(email) {
    const words = displayNameFromEmail(email).split(' ').filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'OA';
}

function parsePort(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error('PORT must be a number between 0 and 65535.');
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

setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (session.expiresAt <= now) {
            sessions.delete(token);
        }
    }
    for (const [clientIp, state] of loginAttempts) {
        if (state.resetAt <= now) {
            loginAttempts.delete(clientIp);
        }
    }
}, 10 * 60 * 1000).unref();

preparePasswordVerifier()
    .then(() => {
        server.listen(PORT, () => {
            const address = server.address();
            const activePort = typeof address === 'object' && address ? address.port : PORT;
            console.log(`OutcomeAI is running at http://localhost:${activePort}`);
            if (usingDefaultCredentials && !isProduction) {
                console.log(`Demo login: ${DEFAULT_EMAIL} / ${DEFAULT_PASSWORD}`);
            }
        });
    })
    .catch((error) => {
        console.error('Unable to start server:', error.message);
        process.exit(1);
    });
