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
const { PLANS, getPlanById } = require('./plans');
const { createPaymentService } = require('./payment-service');
const { createGeminiService } = require('./gemini-service');

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
const CHAT_WINDOW_MS = 60 * 1000;
const MAX_CHAT_REQUESTS = 20;
const MAX_BODY_BYTES = 32 * 1024;
const OAUTH_STATE_MS = 10 * 60 * 1000;
const OAUTH_REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_OAUTH_STATES = 10_000;
const APP_BASE_URL = normalizeBaseUrl(process.env.APP_BASE_URL || `http://localhost:${PORT}`);

const OAUTH_ENDPOINTS = Object.freeze({
    google: {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        callbackPath: '/auth/google/callback',
        scope: 'openid email profile'
    },
    discord: {
        authorizationUrl: 'https://discord.com/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/v10/oauth2/token',
        profileUrl: 'https://discord.com/api/v10/users/@me',
        callbackPath: '/auth/discord/callback',
        scope: 'identify email'
    }
});

const database = createDatabaseFromEnvironment();
const paymentService = createPaymentService({ database });
const geminiService = createGeminiService();
const sessions = new Map();
const oauthStates = new Map();
const loginAttempts = new Map();
const registerAttempts = new Map();
const chatRequests = new Map();
const publicFiles = new Map([
    ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
    ['/login.css', { file: 'login.css', type: 'text/css; charset=utf-8' }],
    ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
    ['/hyperspeed.js', { file: 'hyperspeed.js', type: 'text/javascript; charset=utf-8' }],
    ['/hyperspeed.css', { file: 'hyperspeed.css', type: 'text/css; charset=utf-8' }],
    ['/orb.js', { file: 'orb.js', type: 'text/javascript; charset=utf-8' }],
    ['/orb.css', { file: 'orb.css', type: 'text/css; charset=utf-8' }],
    ['/login.js', { file: 'login.js', type: 'text/javascript; charset=utf-8' }],
    ['/register.js', { file: 'register.js', type: 'text/javascript; charset=utf-8' }]
]);
const oauthProviders = createOAuthProviderConfiguration(process.env);

let dummyPasswordHash;
let shuttingDown = false;

const server = http.createServer(async (req, res) => {
    try {
        const cspNonce = crypto.randomBytes(16).toString('base64');
        applySecurityHeaders(res, cspNonce);
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
                    : '',
                error: oauthErrorMessage(requestUrl.searchParams.get('oauth_error'))
            }));
        }

        if (req.method === 'POST' && pathname === '/login') {
            if (session) {
                return redirect(res, '/dashboard');
            }
            return handleLogin(req, res);
        }

        if (req.method === 'GET' && (pathname === '/auth/google' || pathname === '/auth/discord')) {
            if (session) {
                return redirect(res, '/dashboard');
            }
            const providerName = pathname.endsWith('/google') ? 'google' : 'discord';
            return handleOAuthStart(req, res, requestUrl, providerName);
        }

        if (req.method === 'GET'
            && (pathname === '/auth/google/callback' || pathname === '/auth/discord/callback')) {
            if (session) {
                return redirect(res, '/dashboard');
            }
            const providerName = pathname.includes('/google/') ? 'google' : 'discord';
            return handleOAuthCallback(res, requestUrl, providerName);
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

        const chatRoute = matchChatApiRoute(pathname);
        if (chatRoute) {
            return handleChatApiRequest(req, res, session, chatRoute);
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/order') {
            return handlePaymentRequest(req, res, session, 'createRazorpayOrder');
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/verify') {
            return handlePaymentRequest(req, res, session, 'verifyRazorpayPayment');
        }

        if (req.method === 'POST' && pathname === '/api/payments/paypal/order') {
            return handlePaymentRequest(req, res, session, 'createPayPalOrder');
        }

        if (req.method === 'POST' && pathname === '/api/payments/paypal/capture') {
            return handlePaymentRequest(req, res, session, 'capturePayPalOrder');
        }

        if (req.method === 'GET' && pathname === '/dashboard') {
            if (!session) {
                return redirect(res, '/login');
            }
            const billingProfile = await database.getBillingProfile(session.userId);
            const currentPlan = getPlanById(billingProfile.current_plan) || PLANS[0];
            const showLoginIntro = session.showLoginIntro === true;
            session.showLoginIntro = false;
            return sendHtml(res, 200, renderDashboardPage({
                user: {
                    email: session.email,
                    displayName: session.username,
                    initials: initialsFromUsername(session.username)
                },
                plans: PLANS,
                billing: {
                    currentPlanId: currentPlan.id,
                    planExpiresAt: billingProfile.plan_expires_at
                },
                paymentConfiguration: paymentService.getPublicConfiguration(),
                aiConfiguration: geminiService.getPublicConfiguration(),
                showLoginIntro,
                cspNonce
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

function matchChatApiRoute(pathname) {
    if (pathname === '/api/chats') {
        return { type: 'collection' };
    }

    const messagesMatch = pathname.match(/^\/api\/chats\/(\d+)\/messages$/);
    if (messagesMatch) {
        return { type: 'messages', conversationId: Number(messagesMatch[1]) };
    }

    const conversationMatch = pathname.match(/^\/api\/chats\/(\d+)$/);
    if (conversationMatch) {
        return { type: 'conversation', conversationId: Number(conversationMatch[1]) };
    }

    return null;
}

async function handleChatApiRequest(req, res, session, route) {
    if (!session) {
        return sendJson(res, 401, { error: 'Sign in to access chat history.' });
    }

    if (route.type === 'collection' && req.method === 'GET') {
        const conversations = await database.listChatConversations(session.userId);
        return sendJson(res, 200, { conversations: conversations.map(serializeChatConversation) });
    }

    if (route.type === 'collection' && req.method === 'POST') {
        assertSameOrigin(req);
        const body = await readJsonBody(req);
        const title = normalizeChatTitle(body.title || 'New chat');
        const conversation = await database.createChatConversation({ userId: session.userId, title });
        return sendJson(res, 201, { conversation: serializeChatConversation(conversation) });
    }

    if (route.type === 'messages' && req.method === 'GET') {
        const record = await database.getChatMessages({
            userId: session.userId,
            conversationId: route.conversationId
        });
        if (!record) return sendJson(res, 404, { error: 'Chat was not found.' });
        return sendJson(res, 200, {
            conversation: serializeChatConversation(record.conversation),
            messages: record.messages.map(serializeChatMessage)
        });
    }

    if (route.type === 'messages' && req.method === 'POST') {
        assertSameOrigin(req);
        const rateState = getRateState(chatRequests, String(session.userId), CHAT_WINDOW_MS);
        if (rateState.count >= MAX_CHAT_REQUESTS) {
            res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
            return sendJson(res, 429, { error: 'Too many AI requests. Please wait a moment and try again.' });
        }
        rateState.count += 1;
        const body = await readJsonBody(req);
        const content = normalizeChatContent(body.content);
        let commandResult;

        try {
            commandResult = await database.addChatCommand({
                userId: session.userId,
                conversationId: route.conversationId,
                content,
                generatedTitle: titleFromCommand(content)
            });
        } catch (error) {
            if (error.code === 'CHAT_NOT_FOUND') {
                return sendJson(res, 404, { error: 'Chat was not found.' });
            }
            throw error;
        }

        try {
            const context = await database.getChatContext({
                userId: session.userId,
                conversationId: route.conversationId,
                throughMessageId: commandResult.message.id,
                limit: 40
            });
            const generatedReply = await geminiService.generateReply(context);
            const assistantResult = await database.addChatAssistantResponse({
                userId: session.userId,
                conversationId: route.conversationId,
                content: generatedReply.content
            });

            return sendJson(res, 201, {
                conversation: serializeChatConversation(assistantResult.conversation),
                userMessage: serializeChatMessage(commandResult.message),
                assistantMessage: serializeChatMessage(assistantResult.message),
                model: generatedReply.model
            });
        } catch (error) {
            console.error('AI agent reply failed:', error.message);
            const errorPayload = {
                error: error.publicMessage || 'Your command was saved, but the AI agent could not create a reply.',
                commandSaved: true,
                conversation: serializeChatConversation(commandResult.conversation),
                userMessage: serializeChatMessage(commandResult.message)
            };
            if (!isProduction) {
                errorPayload.errorCode = error.code || 'GEMINI_UNKNOWN_ERROR';
                errorPayload.details = error.message;
                if (error.model) errorPayload.model = error.model;
            }
            return sendJson(res, error.statusCode || 500, errorPayload);
        }
    }

    if (route.type === 'conversation' && req.method === 'PATCH') {
        assertSameOrigin(req);
        const body = await readJsonBody(req);
        const conversation = await database.renameChatConversation({
            userId: session.userId,
            conversationId: route.conversationId,
            title: normalizeChatTitle(body.title)
        });
        if (!conversation) return sendJson(res, 404, { error: 'Chat was not found.' });
        return sendJson(res, 200, { conversation: serializeChatConversation(conversation) });
    }

    if (route.type === 'conversation' && req.method === 'DELETE') {
        assertSameOrigin(req);
        const deleted = await database.deleteChatConversation({
            userId: session.userId,
            conversationId: route.conversationId
        });
        if (!deleted) return sendJson(res, 404, { error: 'Chat was not found.' });
        return sendJson(res, 200, { deleted: true });
    }

    res.setHeader('Allow', route.type === 'messages' ? 'GET, POST' : route.type === 'collection' ? 'GET, POST' : 'PATCH, DELETE');
    return sendJson(res, 405, { error: 'Method not allowed.' });
}

function normalizeChatContent(value) {
    const content = String(value || '').trim();
    if (!content) {
        const error = new Error('Chat command is required.');
        error.statusCode = 400;
        error.publicMessage = 'Type a command before sending.';
        throw error;
    }
    if (content.length > 4000) {
        const error = new Error('Chat command exceeds 4000 characters.');
        error.statusCode = 400;
        error.publicMessage = 'Commands can be up to 4000 characters.';
        throw error;
    }
    return content;
}

function normalizeChatTitle(value) {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    if (!title) return 'New chat';
    return title.slice(0, 80);
}

function titleFromCommand(content) {
    const compact = String(content).replace(/\s+/g, ' ').trim();
    if (compact.length <= 52) return compact;
    return `${compact.slice(0, 51).trimEnd()}…`;
}

function serializeChatConversation(conversation) {
    return {
        id: Number(conversation.id),
        title: conversation.title,
        messageCount: Number(conversation.message_count || 0),
        lastMessage: conversation.last_message || '',
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at
    };
}

function serializeChatMessage(message) {
    return {
        id: Number(message.id),
        role: message.role,
        content: message.content,
        createdAt: message.created_at
    };
}

async function handlePaymentRequest(req, res, session, operation) {
    if (!session) {
        return sendJson(res, 401, { error: 'Sign in to continue with payment.' });
    }

    assertSameOrigin(req);
    const body = await readJsonBody(req);
    const input = {
        userId: session.userId,
        planId: body.planId,
        orderId: body.orderId || body.razorpay_order_id,
        paymentId: body.paymentId || body.razorpay_payment_id,
        signature: body.signature || body.razorpay_signature
    };

    try {
        const result = await paymentService[operation](input);
        return sendJson(res, 200, result);
    } catch (error) {
        console.error(`${operation} failed:`, error.message);
        return sendJson(res, error.statusCode || 500, {
            error: error.publicMessage || 'Payment could not be completed. Please try again.'
        });
    }
}

function assertSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) {
        return;
    }
    const requestOrigin = new URL(`http://${req.headers.host || 'localhost'}`).origin;
    const allowedOrigins = new Set([requestOrigin, new URL(APP_BASE_URL).origin]);
    if (!allowedOrigins.has(origin)) {
        const error = new Error('Cross-origin request rejected.');
        error.statusCode = 403;
        error.publicMessage = 'This request was rejected.';
        throw error;
    }
}

function handleOAuthStart(req, res, requestUrl, providerName) {
    const provider = oauthProviders[providerName];
    if (!provider?.isConfigured) {
        return redirectToOAuthError(res, 'not_configured');
    }

    if (oauthStates.size >= MAX_OAUTH_STATES) {
        cleanExpiredOAuthStates();
        if (oauthStates.size >= MAX_OAUTH_STATES) {
            return redirectToOAuthError(res, 'temporarily_unavailable');
        }
    }

    const state = crypto.randomBytes(32).toString('base64url');
    oauthStates.set(state, {
        provider: providerName,
        rememberMe: requestUrl.searchParams.get('remember') === '1',
        expiresAt: Date.now() + OAUTH_STATE_MS
    });

    const authorizationUrl = new URL(provider.authorizationUrl);
    authorizationUrl.searchParams.set('client_id', provider.clientId);
    authorizationUrl.searchParams.set('redirect_uri', provider.redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', provider.scope);
    authorizationUrl.searchParams.set('state', state);

    if (providerName === 'google') {
        authorizationUrl.searchParams.set('prompt', 'select_account');
    }

    return redirect(res, authorizationUrl.toString(), 302);
}

async function handleOAuthCallback(res, requestUrl, providerName) {
    const state = requestUrl.searchParams.get('state') || '';
    const stateRecord = consumeOAuthState(state, providerName);
    if (!stateRecord) {
        return redirectToOAuthError(res, 'invalid_state');
    }

    const providerError = requestUrl.searchParams.get('error');
    if (providerError) {
        return redirectToOAuthError(res, providerError === 'access_denied' ? 'access_denied' : 'provider_error');
    }

    const code = requestUrl.searchParams.get('code');
    if (!code) {
        return redirectToOAuthError(res, 'missing_code');
    }

    try {
        const identity = await fetchOAuthIdentity(providerName, code);
        const user = await database.createOrFindOAuthUser(identity);
        createSession(res, user, stateRecord.rememberMe);
        return redirect(res, '/dashboard');
    } catch (error) {
        console.error(`${providerName} OAuth callback failed:`, error.message);
        if (error.code === 'OAUTH_ACCOUNT_CONFLICT') {
            return redirectToOAuthError(res, 'account_conflict');
        }
        if (error.code === 'OAUTH_EMAIL_UNVERIFIED') {
            return redirectToOAuthError(res, 'email_unverified');
        }
        return redirectToOAuthError(res, 'provider_error');
    }
}

async function fetchOAuthIdentity(providerName, code) {
    const provider = oauthProviders[providerName];
    if (!provider?.isConfigured) {
        throw new Error(`${providerName} OAuth is not configured.`);
    }

    const tokenBody = new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: provider.redirectUri
    });

    const tokenResponse = await fetchJson(provider.tokenUrl, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenBody.toString()
    }, `${providerName} token exchange`);

    if (!tokenResponse.access_token || typeof tokenResponse.access_token !== 'string') {
        throw new Error(`${providerName} did not return an access token.`);
    }

    const profile = await fetchJson(provider.profileUrl, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${tokenResponse.access_token}`
        }
    }, `${providerName} profile request`);

    return normalizeOAuthIdentity(providerName, profile);
}

function normalizeOAuthIdentity(providerName, profile) {
    if (providerName === 'google') {
        assertVerifiedOAuthEmail(profile.email, profile.email_verified === true);
        if (!profile.sub) {
            throw new Error('Google profile did not contain a stable user ID.');
        }
        return {
            provider: 'google',
            providerUserId: String(profile.sub),
            email: normalizeEmail(profile.email),
            preferredUsername: profile.name || String(profile.email).split('@')[0]
        };
    }

    assertVerifiedOAuthEmail(profile.email, profile.verified === true);
    if (!profile.id) {
        throw new Error('Discord profile did not contain a stable user ID.');
    }
    return {
        provider: 'discord',
        providerUserId: String(profile.id),
        email: normalizeEmail(profile.email),
        preferredUsername: profile.global_name || profile.username || String(profile.email).split('@')[0]
    };
}

function assertVerifiedOAuthEmail(email, isVerified) {
    if (!isValidEmail(normalizeEmail(email || '')) || !isVerified) {
        const error = new Error('OAuth provider did not return a verified email address.');
        error.code = 'OAUTH_EMAIL_UNVERIFIED';
        throw error;
    }
}

async function fetchJson(url, options, operationName) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OAUTH_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        let value = {};
        if (text) {
            try {
                value = JSON.parse(text);
            } catch {
                throw new Error(`${operationName} returned invalid JSON.`);
            }
        }

        if (!response.ok) {
            const providerMessage = typeof value.error_description === 'string'
                ? value.error_description
                : typeof value.message === 'string'
                    ? value.message
                    : `HTTP ${response.status}`;
            throw new Error(`${operationName} failed: ${providerMessage}`);
        }
        return value;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`${operationName} timed out.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function consumeOAuthState(state, providerName) {
    if (!state) {
        return null;
    }
    const record = oauthStates.get(state);
    oauthStates.delete(state);
    if (!record || record.provider !== providerName || record.expiresAt <= Date.now()) {
        return null;
    }
    return record;
}

function redirectToOAuthError(res, code) {
    return redirect(res, `/login?oauth_error=${encodeURIComponent(code)}`);
}

function oauthErrorMessage(code) {
    const messages = {
        not_configured: 'This social sign-in provider has not been configured yet.',
        temporarily_unavailable: 'Social sign-in is temporarily unavailable. Please try again.',
        invalid_state: 'The social sign-in request expired or could not be verified. Please try again.',
        access_denied: 'Social sign-in was cancelled.',
        missing_code: 'The social sign-in provider did not return an authorization code.',
        email_unverified: 'A verified email address is required to sign in with Google or Discord.',
        account_conflict: 'That provider is already linked to a different identity for this account.',
        provider_error: 'Social sign-in could not be completed. Please try again.'
    };
    return messages[code] || '';
}

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
        expiresAt: Date.now() + sessionLifetime,
        showLoginIntro: true
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

async function readJsonBody(req) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
        const error = new Error('Unsupported content type');
        error.statusCode = 415;
        error.publicMessage = 'API requests must use JSON.';
        throw error;
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            const error = new Error('Request body too large');
            error.statusCode = 413;
            error.publicMessage = 'API request is too large.';
            throw error;
        }
        chunks.push(chunk);
    }

    try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('JSON body must be an object.');
        }
        return parsed;
    } catch {
        const error = new Error('Invalid JSON body');
        error.statusCode = 400;
        error.publicMessage = 'API request contains invalid JSON.';
        throw error;
    }
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

function applySecurityHeaders(res, cspNonce) {
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        `script-src 'self' 'nonce-${cspNonce}' https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com https://*.paypalobjects.com data:",
        "img-src 'self' data: https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "connect-src 'self' https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "child-src 'self' https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "frame-src 'self' https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://*.razorpay.com https://*.paypal.com",
        "frame-ancestors 'none'"
    ].join('; '));
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
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

function redirect(res, location, statusCode = 303) {
    res.writeHead(statusCode, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
}

function createOAuthProviderConfiguration(env) {
    return Object.fromEntries(Object.entries(OAUTH_ENDPOINTS).map(([name, endpoints]) => {
        const prefix = name.toUpperCase();
        const clientId = String(env[`${prefix}_CLIENT_ID`] || '').trim();
        const clientSecret = String(env[`${prefix}_CLIENT_SECRET`] || '').trim();
        return [name, {
            ...endpoints,
            clientId,
            clientSecret,
            redirectUri: new URL(endpoints.callbackPath, `${APP_BASE_URL}/`).toString(),
            isConfigured: Boolean(clientId && clientSecret)
        }];
    }));
}

function normalizeBaseUrl(value) {
    let parsed;
    try {
        parsed = new URL(String(value));
    } catch {
        throw new Error('APP_BASE_URL must be a valid absolute URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('APP_BASE_URL must use http or https.');
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
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

function cleanExpiredOAuthStates() {
    const now = Date.now();
    for (const [state, record] of oauthStates) {
        if (record.expiresAt <= now) {
            oauthStates.delete(state);
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
    cleanExpiredOAuthStates();
    for (const store of [loginAttempts, registerAttempts, chatRequests]) {
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
