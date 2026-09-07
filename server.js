'use strict';

const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsNative = require('node:fs');
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
const { createEmailService } = require('./email-service');
const { createHcaptchaService } = require('./hcaptcha-service');
const { createPromptLimitConfiguration } = require('./prompt-limits');
const { renderForgotPasswordPage, renderResetPasswordPage } = require('./views/password-recovery');
const { createWorkflowService } = require('./workflows/service');
const { createAgentService } = require('./agent/service');
const { validateBusinessImportPayload } = require('./business-data');
const { createMarketingEventBroker } = require('./workflows/realtime');
const { createMarketingScheduler } = require('./workflows/marketing-services');

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
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;
const MAX_PASSWORD_RESET_ATTEMPTS = 5;
const PASSWORD_RESET_TOKEN_MINUTES = parseBoundedInteger(
    process.env.PASSWORD_RESET_TOKEN_MINUTES || '30',
    30,
    10,
    120,
    'PASSWORD_RESET_TOKEN_MINUTES'
);
const CHAT_WINDOW_MS = 60 * 1000;
const MAX_CHAT_REQUESTS = 20;
const VOICE_WINDOW_MS = 5 * 60 * 1000;
const MAX_VOICE_REQUESTS = 30;
const MAX_VOICE_AUDIO_BYTES = 5 * 1024 * 1024;
const WORKFLOW_WINDOW_MS = 60 * 1000;
const MAX_WORKFLOW_REQUESTS = 10;
const BUSINESS_IMPORT_WINDOW_MS = 60 * 60 * 1000;
const MAX_BUSINESS_IMPORT_REQUESTS = 5;
const MAX_FORM_BODY_BYTES = 64 * 1024;
const MAX_API_JSON_BODY_BYTES = 8 * 1024 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BATCH_BYTES = 250 * 1024 * 1024;
const MAX_UPLOAD_BATCH_FILES = 250;
const MAX_UPLOAD_PATH_BYTES = 500;
const OAUTH_STATE_MS = 10 * 60 * 1000;
const OAUTH_REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_OAUTH_STATES = 10_000;
const APP_BASE_URL = normalizeBaseUrl(process.env.APP_BASE_URL || `http://localhost:${PORT}`);
const UPLOAD_ROOT = path.join(__dirname, 'data', 'uploads');

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
const emailService = createEmailService();
const hcaptchaService = createHcaptchaService();
const promptLimits = createPromptLimitConfiguration({ model: geminiService.getPublicConfiguration().model });
const workflowService = createWorkflowService({ database, geminiService, emailService });
const agentService = createAgentService({ geminiService, workflowService });
const marketingEventBroker = createMarketingEventBroker();
const marketingScheduler = createMarketingScheduler({ database, workflowService, eventBroker: marketingEventBroker });
const sessions = new Map();
const sessionStreams = new Map();
const oauthStates = new Map();
const loginAttempts = new Map();
const registerAttempts = new Map();
const passwordResetAttempts = new Map();
const chatRequests = new Map();
const voiceRequests = new Map();
const workflowRequests = new Map();
const businessImportRequests = new Map();
const publicFiles = new Map([
    ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
    ['/login.css', { file: 'login.css', type: 'text/css; charset=utf-8' }],
    ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
    ['/marketing-hooks.js', { file: 'marketing-hooks.js', type: 'text/javascript; charset=utf-8' }],
    ['/marketing-components.js', { file: 'marketing-components.js', type: 'text/javascript; charset=utf-8' }],
    ['/marketing-workspace.js', { file: 'marketing-workspace.js', type: 'text/javascript; charset=utf-8' }],
    ['/analytics-workspace.js', { file: 'analytics-workspace.js', type: 'text/javascript; charset=utf-8' }],
    ['/hyperspeed.js', { file: 'hyperspeed.js', type: 'text/javascript; charset=utf-8' }],
    ['/hyperspeed.css', { file: 'hyperspeed.css', type: 'text/css; charset=utf-8' }],
    ['/orb.js', { file: 'orb.js', type: 'text/javascript; charset=utf-8' }],
    ['/orb.css', { file: 'orb.css', type: 'text/css; charset=utf-8' }],
    ['/auth-hcaptcha.js', { file: 'auth-hcaptcha.js', type: 'text/javascript; charset=utf-8' }],
    ['/login.js', { file: 'login.js', type: 'text/javascript; charset=utf-8' }],
    ['/password-recovery.js', { file: 'password-recovery.js', type: 'text/javascript; charset=utf-8' }],
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
            return await handleHealthCheck(res);
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/webhook') {
            return await handleRazorpayWebhookRequest(req, res);
        }

        const session = await getSession(req);

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
            return await handleLogin(req, res);
        }

        if (req.method === 'GET' && pathname === '/forgot-password') {
            if (session) return redirect(res, '/dashboard');
            return sendHtml(res, 200, forgotPasswordPage());
        }

        if (req.method === 'POST' && pathname === '/forgot-password') {
            if (session) return redirect(res, '/dashboard');
            return await handleForgotPassword(req, res);
        }

        if (req.method === 'GET' && pathname === '/reset-password') {
            if (session) return redirect(res, '/dashboard');
            return await handleResetPasswordPage(res, requestUrl.searchParams.get('token') || '');
        }

        if (req.method === 'POST' && pathname === '/reset-password') {
            if (session) return redirect(res, '/dashboard');
            return await handleResetPassword(req, res);
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
            return await handleOAuthCallback(res, requestUrl, providerName);
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
            return await handleRegister(req, res);
        }

        if (req.method === 'POST' && pathname === '/api/uploads') {
            return await handleUploadRequest(req, res, session);
        }

        const uploadRoute = matchUploadApiRoute(pathname);
        if (req.method === 'GET' && uploadRoute) {
            return await handleUploadedFileRequest(res, session, uploadRoute);
        }

        if (req.method === 'POST' && pathname === '/api/agent/voice/transcribe') {
            return await handleVoiceTranscriptionRequest(req, res, session);
        }

        const workflowRoute = matchWorkflowApiRoute(pathname);
        if (workflowRoute) {
            return await handleWorkflowApiRequest(req, res, session, requestUrl, workflowRoute);
        }

        const chatRoute = matchChatApiRoute(pathname);
        if (chatRoute) {
            return await handleChatApiRequest(req, res, session, chatRoute);
        }

        if (req.method === 'GET' && pathname === '/api/billing/profile') {
            return await handleBillingProfileRequest(res, session);
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/order') {
            return await handlePaymentRequest(req, res, session, 'createRazorpayOrder');
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/verify') {
            return await handlePaymentRequest(req, res, session, 'verifyRazorpayPayment');
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/status') {
            return await handlePaymentRequest(req, res, session, 'getRazorpayOrderStatus');
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/cancel') {
            return await handlePaymentRequest(req, res, session, 'cancelRazorpayOrder');
        }

        if (req.method === 'POST' && pathname === '/api/payments/razorpay/failure') {
            return await handlePaymentRequest(req, res, session, 'recordRazorpayCheckoutFailure');
        }

        if (req.method === 'POST' && pathname === '/api/payments/paypal/order') {
            return await handlePaymentRequest(req, res, session, 'createPayPalOrder');
        }

        if (req.method === 'POST' && pathname === '/api/payments/paypal/capture') {
            return await handlePaymentRequest(req, res, session, 'capturePayPalOrder');
        }

        if (req.method === 'GET' && pathname === '/dashboard') {
            if (!session) {
                return redirect(res, '/login');
            }
            const billingProfile = await database.getBillingProfile(session.userId);
            const promptUsage = await database.getAiAgentPromptUsage(session.userId);
            const currentPlan = getPlanById(billingProfile.current_plan) || PLANS[0];
            const showLoginIntro = session.showLoginIntro === true;
            session.showLoginIntro = false;
            if (showLoginIntro) {
                await database.markAuthSessionIntroShown(hashSessionToken(session.token));
            }
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
                aiConfiguration: {
                    ...geminiService.getPublicConfiguration(),
                    promptUsage
                },
                showLoginIntro,
                cspNonce
            }));
        }

        if (req.method === 'POST' && pathname === '/logout') {
            assertSameOrigin(req);
            if (session) {
                closeSessionStreams(session.token);
                sessions.delete(session.token);
                await database.deleteAuthSession(hashSessionToken(session.token));
            }
            clearSessionCookie(res);
            return redirect(res, '/login');
        }

        return sendText(res, 404, 'Not found');
    } catch (error) {
        if (isExpectedClientDisconnect(error, req)) {
            return;
        }
        console.error(error);
        if (res.destroyed || res.writableEnded) {
            return;
        }
        if (!res.headersSent) {
            return sendText(res, error.statusCode || 500, error.publicMessage || 'Something went wrong. Please try again.');
        }
        return res.end();
    }
});

function matchWorkflowApiRoute(pathname) {
    if (pathname === '/api/workflows') return { type: 'definitions' };
    if (pathname === '/api/workflow-runs') return { type: 'runs' };
    if (pathname === '/api/business/overview') return { type: 'overview' };
    if (pathname === '/api/business/competitors') return { type: 'competitor-sources' };
    if (pathname === '/api/business/profile') return { type: 'business-profile' };
    if (pathname === '/api/business/data/import') return { type: 'import' };
    if (pathname === '/api/business/inventory-data/summary') return { type: 'inventory-data-summary' };
    if (pathname === '/api/business/inventory-data/demo') return { type: 'inventory-data-demo' };
    if (pathname === '/api/marketing/workspace') return { type: 'marketing-workspace' };
    if (pathname === '/api/marketing/campaigns') return { type: 'marketing-campaigns' };
    if (pathname === '/api/marketing/schedules') return { type: 'marketing-schedules' };
    if (pathname === '/api/marketing/events') return { type: 'marketing-events' };
    if (pathname === '/api/analytics/workspace') return { type: 'analytics-workspace' };
    if (pathname === '/api/analytics/export') return { type: 'analytics-export' };
    if (pathname === '/api/analytics/email') return { type: 'analytics-email' };
    if (pathname === '/api/analytics/demo-data') return { type: 'analytics-demo-data' };

    const scheduleMatch = pathname.match(/^\/api\/marketing\/schedules\/(\d+)$/);
    if (scheduleMatch) return { type: 'marketing-schedule', scheduleId: Number(scheduleMatch[1]) };

    const executeMatch = pathname.match(/^\/api\/workflows\/([a-z0-9-]+)\/runs$/);
    if (executeMatch) return { type: 'execute', slug: executeMatch[1] };

    const artifactsMatch = pathname.match(/^\/api\/workflow-runs\/(\d+)\/artifacts$/);
    if (artifactsMatch) return { type: 'artifacts', runId: Number(artifactsMatch[1]) };

    const regenerateMatch = pathname.match(/^\/api\/workflow-runs\/(\d+)\/sections\/([A-Za-z0-9_-]+)\/regenerate$/);
    if (regenerateMatch) return { type: 'regenerate-section', runId: Number(regenerateMatch[1]), sectionKey: regenerateMatch[2] };

    const artifactMatch = pathname.match(/^\/api\/workflow-artifacts\/(\d+)\/download$/);
    if (artifactMatch) return { type: 'artifact-download', artifactId: Number(artifactMatch[1]) };

    const runEventsMatch = pathname.match(/^\/api\/workflow-runs\/(\d+)\/events$/);
    if (runEventsMatch) return { type: 'run-events', runId: Number(runEventsMatch[1]) };

    const retryMatch = pathname.match(/^\/api\/workflow-runs\/(\d+)\/retry$/);
    if (retryMatch) return { type: 'retry-run', runId: Number(retryMatch[1]) };

    const runMatch = pathname.match(/^\/api\/workflow-runs\/(\d+)$/);
    if (runMatch) return { type: 'run', runId: Number(runMatch[1]) };

    const reviewMatch = pathname.match(/^\/api\/reviews\/(\d+)\/response$/);
    if (reviewMatch) return { type: 'review-response', reviewId: Number(reviewMatch[1]) };

    return null;
}

async function handleWorkflowApiRequest(req, res, session, requestUrl, route) {
    if (!session) return sendJson(res, 401, { error: 'Sign in to access business workflows.' });

    if (route.type === 'definitions' && req.method === 'GET') {
        return sendJson(res, 200, {
            workflows: workflowService.listDefinitions(),
            connectors: workflowService.getConnectorConfiguration()
        });
    }

    if (route.type === 'marketing-workspace' && req.method === 'GET') {
        const workspace = await workflowService.getMarketingWorkspace({
            userId: session.userId,
            from: requestUrl.searchParams.get('from') || '',
            to: requestUrl.searchParams.get('to') || '',
            bypassCache: requestUrl.searchParams.get('refresh') === '1'
        });
        return sendJson(res, 200, { workspace });
    }

    if (route.type === 'analytics-workspace' && req.method === 'GET') {
        const dashboard = await workflowService.getEnterpriseAnalytics({
            userId: session.userId,
            from: requestUrl.searchParams.get('from') || '',
            to: requestUrl.searchParams.get('to') || '',
            filters: analyticsFiltersFromSearchParams(requestUrl.searchParams),
            bypassCache: requestUrl.searchParams.get('refresh') === '1'
        });
        return sendJson(res, 200, { dashboard });
    }

    if (route.type === 'analytics-export' && req.method === 'GET') {
        const report = await workflowService.exportEnterpriseAnalytics({
            userId: session.userId,
            from: requestUrl.searchParams.get('from') || '',
            to: requestUrl.searchParams.get('to') || '',
            filters: analyticsFiltersFromSearchParams(requestUrl.searchParams),
            format: requestUrl.searchParams.get('format') || ''
        });
        const encodedName = encodeURIComponent(sanitizeDownloadFilename(report.filename)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200, {
            'Content-Type': report.contentType,
            'Content-Length': report.body.length,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(report.body);
        return;
    }

    if (route.type === 'analytics-email' && req.method === 'POST') {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, `analytics-email:${session.userId}`)) return;
        const body = await readJsonBody(req);
        const result = await workflowService.emailEnterpriseAnalytics({
            userId: session.userId,
            email: session.email,
            from: body?.from || '',
            to: body?.to || '',
            filters: body?.filters || {}
        });
        return sendJson(res, 200, { report: result });
    }

    if (route.type === 'analytics-demo-data' && req.method === 'POST') {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, `analytics-demo:${session.userId}`)) return;
        const result = await workflowService.loadAnalyticsDemoData({ userId: session.userId });
        const business = await database.getOrCreateBusinessForUser(session.userId);
        marketingEventBroker.publishBusiness(business.id, { type: 'analytics-data-changed', reason: 'demo-loaded', timestamp: new Date().toISOString() });
        return sendJson(res, result.alreadyLoaded ? 200 : 201, { demo: result });
    }

    if (route.type === 'analytics-demo-data' && req.method === 'DELETE') {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, `analytics-demo:${session.userId}`)) return;
        const result = await workflowService.removeAnalyticsDemoData({ userId: session.userId });
        const business = await database.getOrCreateBusinessForUser(session.userId);
        marketingEventBroker.publishBusiness(business.id, { type: 'analytics-data-changed', reason: 'demo-removed', timestamp: new Date().toISOString() });
        return sendJson(res, 200, { demo: result });
    }

    if (route.type === 'marketing-campaigns' && req.method === 'GET') {
        const runId = requestUrl.searchParams.get('runId');
        const campaigns = await workflowService.listMarketingCampaigns({
            userId: session.userId,
            runId: runId ? Number(runId) : null,
            limit: parseApiLimit(requestUrl.searchParams.get('limit'), 100, 250)
        });
        return sendJson(res, 200, { campaigns });
    }

    if (route.type === 'marketing-schedules' && req.method === 'GET') {
        return sendJson(res, 200, { schedules: await workflowService.listSchedules({ userId: session.userId }) });
    }

    if (route.type === 'marketing-schedules' && (req.method === 'PUT' || req.method === 'POST')) {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, `schedule:${session.userId}`)) return;
        const payload = await readJsonBody(req);
        return sendJson(res, 200, { schedule: await workflowService.upsertSchedule({ userId: session.userId, payload }) });
    }

    if (route.type === 'marketing-schedule' && req.method === 'DELETE') {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, `schedule:${session.userId}`)) return;
        const deleted = await workflowService.deleteSchedule({ userId: session.userId, scheduleId: route.scheduleId });
        if (!deleted) return sendJson(res, 404, { error: 'Marketing schedule was not found.' });
        return sendJson(res, 200, { deleted: true });
    }

    if (route.type === 'marketing-events' && req.method === 'GET') {
        const business = await database.getOrCreateBusinessForUser(session.userId);
        registerSessionStream(session.token, res);
        return marketingEventBroker.openSse(res, (listener) => marketingEventBroker.subscribeBusiness(business.id, listener), {
            initialEvent: { type: 'connected', businessId: Number(business.id) }
        });
    }

    if (route.type === 'run-events' && req.method === 'GET') {
        const run = await database.getWorkflowRun({ userId: session.userId, runId: route.runId });
        if (!run) return sendJson(res, 404, { error: 'Workflow run was not found.' });
        registerSessionStream(session.token, res);
        return marketingEventBroker.openSse(res, (listener) => marketingEventBroker.subscribeRun(route.runId, listener), {
            initialEvent: { type: 'snapshot', run: serializeWorkflowRunForApi(run) }
        });
    }

    if (route.type === 'retry-run' && req.method === 'POST') {
        assertSameOrigin(req);
        const previousRun = await database.getWorkflowRun({ userId: session.userId, runId: route.runId });
        if (!previousRun) return sendJson(res, 404, { error: 'Workflow run was not found.' });
        if (!['failed', 'cancelled', 'completed'].includes(previousRun.status)) return sendJson(res, 409, { error: 'Only finished workflow runs can be retried.' });
        registerSessionStream(session.token, res);
        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            'X-Content-Type-Options': 'nosniff',
            'Transfer-Encoding': 'chunked'
        });
        let retryRunId = null;
        const retryBusinessId = Number(previousRun.business_id);
        const writeRetryEvent = (event) => {
            retryRunId = Number(event.run?.id || event.runId || retryRunId || 0) || null;
            const broadcastEvent = retryRunId && !event.run?.id && !event.runId ? { ...event, runId: retryRunId } : event;
            marketingEventBroker.publishBusiness(retryBusinessId, broadcastEvent);
            if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(broadcastEvent)}\n`);
        };
        try {
            await workflowService.execute({ userId: session.userId, businessId: Number(previousRun.business_id), slug: previousRun.workflow_slug, input: previousRun.input || {}, onEvent: writeRetryEvent });
        } catch (error) {
            const activeRun = error.code === 'WORKFLOW_ALREADY_RUNNING' && error.activeRunId
                ? await database.getWorkflowRun({ userId: session.userId, runId: error.activeRunId }).catch(() => null)
                : null;
            if (activeRun) {
                writeRetryEvent({
                    type: 'active-run',
                    run: serializeWorkflowRunForApi(activeRun),
                    message: error.publicMessage,
                    timestamp: new Date().toISOString()
                });
            } else {
                writeRetryEvent({ type: 'failed', code: error.code || 'WORKFLOW_FAILED', error: error.publicMessage || 'The workflow could not be retried.', timestamp: new Date().toISOString() });
            }
        }
        if (!res.writableEnded && !res.destroyed) res.end();
        return;
    }

    if (route.type === 'execute' && req.method === 'POST') {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, String(session.userId))) return;
        const body = await readJsonBody(req);
        registerSessionStream(session.token, res);
        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            'X-Content-Type-Options': 'nosniff',
            'Transfer-Encoding': 'chunked'
        });
        let lastEventType = '';
        let activeRunId = null;
        let activeBusinessId = null;
        const writeEvent = (event) => {
            lastEventType = event.type;
            activeRunId = Number(event.run?.id || event.runId || activeRunId || 0) || null;
            activeBusinessId = Number(event.run?.businessId || event.businessId || activeBusinessId || 0) || null;
            const broadcastEvent = activeRunId && !event.run?.id && !event.runId ? { ...event, runId: activeRunId } : event;
            if (activeBusinessId) marketingEventBroker.publishBusiness(activeBusinessId, broadcastEvent);
            else if (activeRunId) marketingEventBroker.publishRun(activeRunId, broadcastEvent);
            if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(broadcastEvent)}\n`);
        };
        try {
            await workflowService.execute({
                userId: session.userId,
                slug: route.slug,
                input: body && typeof body === 'object' ? body : {},
                onEvent: writeEvent
            });
        } catch (error) {
            const activeRun = error.code === 'WORKFLOW_ALREADY_RUNNING' && error.activeRunId
                ? await database.getWorkflowRun({ userId: session.userId, runId: error.activeRunId }).catch(() => null)
                : null;
            if (activeRun) {
                writeEvent({
                    type: 'active-run',
                    run: serializeWorkflowRunForApi(activeRun),
                    message: error.publicMessage,
                    timestamp: new Date().toISOString()
                });
            } else if (lastEventType !== 'failed') {
                const code = error.code || 'WORKFLOW_FAILED';
                const diagnosticMessage = String(error.message || '').trim().replace(/\s+/g, ' ').slice(0, 700);
                const diagnostic = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
                    ? String(code)
                    : (diagnosticMessage ? `${code}: ${diagnosticMessage}` : String(code));
                console.error(`[workflow:start] ${route.slug} failed before a run could be established:`, error);
                writeEvent({
                    type: 'failed',
                    code,
                    error: error.publicMessage || 'The workflow could not be started.',
                    failedStage: 'workflow-startup',
                    diagnostic,
                    timestamp: new Date().toISOString()
                });
            }
        }
        if (!res.writableEnded && !res.destroyed) res.end();
        return;
    }

    if (route.type === 'runs' && req.method === 'GET') {
        const slug = requestUrl.searchParams.get('workflow') || null;
        const limit = parseApiLimit(requestUrl.searchParams.get('limit'), 20, 100);
        const runs = await database.listWorkflowRuns({ userId: session.userId, workflowSlug: slug, limit });
        return sendJson(res, 200, { runs: runs.map(serializeWorkflowRunForApi) });
    }

    if (route.type === 'run' && req.method === 'GET') {
        const run = await database.getWorkflowRun({ userId: session.userId, runId: route.runId });
        if (!run) return sendJson(res, 404, { error: 'Workflow run was not found.' });
        return sendJson(res, 200, { run: serializeWorkflowRunForApi(run) });
    }

    if (route.type === 'artifacts' && req.method === 'GET') {
        const artifacts = await workflowService.listArtifacts({ userId: session.userId, runId: route.runId });
        return sendJson(res, 200, { artifacts });
    }

    if (route.type === 'artifact-download' && req.method === 'GET') {
        const artifact = await workflowService.getArtifact({ userId: session.userId, artifactId: route.artifactId });
        const body = artifact.binary_data || Buffer.from(artifact.content_text || '', 'utf8');
        const filename = sanitizeDownloadFilename(artifact.filename || `${artifact.title || 'workflow-artifact'}.${extensionForMimeType(artifact.mime_type)}`);
        const encodedName = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200, {
            'Content-Type': artifact.mime_type || 'application/octet-stream',
            'Content-Length': body.length,
            'Content-Disposition': `${String(artifact.mime_type || '').startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin'
        });
        res.end(body);
        return;
    }

    if (route.type === 'regenerate-section' && req.method === 'POST') {
        assertSameOrigin(req);
        const rateKey = `regenerate:${session.userId}`;
        const rateState = getRateState(workflowRequests, rateKey, WORKFLOW_WINDOW_MS);
        if (rateState.count >= MAX_WORKFLOW_REQUESTS) {
            res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
            return sendJson(res, 429, { error: 'Too many regeneration requests. Try again shortly.' });
        }
        recordFailedAttempt(workflowRequests, rateKey, WORKFLOW_WINDOW_MS);
        const result = await workflowService.regenerateSection({
            userId: session.userId,
            runId: route.runId,
            sectionKey: route.sectionKey
        });
        return sendJson(res, 200, { regeneration: result });
    }

    if (route.type === 'overview' && req.method === 'GET') {
        const overview = await workflowService.getOverview({
            userId: session.userId,
            from: requestUrl.searchParams.get('from') || '',
            to: requestUrl.searchParams.get('to') || ''
        });
        return sendJson(res, 200, { overview });
    }

    if (route.type === 'competitor-sources' && req.method === 'GET') {
        const business = await database.getOrCreateBusinessForUser(session.userId);
        const data = await database.getCompetitorAuditData({
            userId: session.userId,
            businessId: business.id
        });
        return sendJson(res, 200, {
            competitors: data.competitors.map((item) => ({
                id: Number(item.competitor_id),
                externalId: item.external_id,
                name: item.name,
                sourceName: item.configured_source_name || null,
                sourceUrl: item.configured_source_url || null,
                active: true,
                latestSnapshotAt: item.retrieved_at || null
            }))
        });
    }

    if (route.type === 'competitor-sources' && req.method === 'POST') {
        assertSameOrigin(req);
        const body = await readJsonBody(req);
        const competitors = Array.isArray(body?.competitors) ? body.competitors : null;
        if (!competitors || competitors.length < 1 || competitors.length > 20) {
            return sendJson(res, 400, { error: 'Provide between 1 and 20 competitor source records.' });
        }
        const payload = validateBusinessImportPayload({ competitors });
        const business = await database.getOrCreateBusinessForUser(session.userId);
        const result = await database.importBusinessData({
            userId: session.userId,
            businessId: business.id,
            payload
        });
        marketingEventBroker.publishBusiness(business.id, { type: 'analytics-data-changed', reason: 'competitor-sources-updated', timestamp: new Date().toISOString() });
        return sendJson(res, 200, { competitors: result });
    }

    if (route.type === 'business-profile' && req.method === 'GET') {
        const business = await workflowService.getBusinessProfile({ userId: session.userId });
        return sendJson(res, 200, { business });
    }

    if (route.type === 'business-profile' && req.method === 'PUT') {
        assertSameOrigin(req);
        const body = await readJsonBody(req);
        const payload = validateBusinessImportPayload({ business: body.business || body });
        const profile = payload.business;
        if (!profile?.name || !profile.currency || !profile.timezone) {
            const error = new Error('Business name, currency, and timezone are required.');
            error.statusCode = 400;
            error.publicMessage = 'Business name, currency, and timezone are required.';
            throw error;
        }
        const membership = await database.getOrCreateBusinessForUser(session.userId);
        await database.updateBusinessProfile({
            userId: session.userId,
            businessId: membership.id,
            profile
        });
        const business = await workflowService.getBusinessProfile({ userId: session.userId });
        marketingEventBroker.publishBusiness(membership.id, { type: 'analytics-data-changed', reason: 'business-profile', timestamp: new Date().toISOString() });
        return sendJson(res, 200, { business });
    }

    if (route.type === 'inventory-data-summary' && req.method === 'GET') {
        const summary = await workflowService.getInventoryDataSummary({ userId: session.userId });
        return sendJson(res, 200, { summary });
    }

    if (route.type === 'inventory-data-demo' && req.method === 'POST') {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, `inventory-demo:${session.userId}`)) return;
        const result = await workflowService.loadInventoryDemoData({ userId: session.userId });
        const business = await database.getOrCreateBusinessForUser(session.userId);
        marketingEventBroker.publishBusiness(business.id, { type: 'analytics-data-changed', reason: 'inventory-demo-loaded', timestamp: new Date().toISOString() });
        return sendJson(res, result.alreadyLoaded ? 200 : 201, { demo: result });
    }

    if (route.type === 'inventory-data-demo' && req.method === 'DELETE') {
        assertSameOrigin(req);
        if (!consumeWorkflowQuota(res, `inventory-demo:${session.userId}`)) return;
        const result = await workflowService.removeInventoryDemoData({ userId: session.userId });
        const business = await database.getOrCreateBusinessForUser(session.userId);
        marketingEventBroker.publishBusiness(business.id, { type: 'analytics-data-changed', reason: 'inventory-demo-removed', timestamp: new Date().toISOString() });
        return sendJson(res, 200, { demo: result });
    }

    if (route.type === 'import' && req.method === 'POST') {
        assertSameOrigin(req);
        const rateKey = String(session.userId);
        const rateState = getRateState(businessImportRequests, rateKey, BUSINESS_IMPORT_WINDOW_MS);
        if (rateState.count >= MAX_BUSINESS_IMPORT_REQUESTS) {
            res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
            return sendJson(res, 429, { error: 'Too many business-data imports. Try again later.' });
        }
        recordFailedAttempt(businessImportRequests, rateKey, BUSINESS_IMPORT_WINDOW_MS);
        const body = await readJsonBody(req);
        const payload = validateBusinessImportPayload(body);
        const business = await database.getOrCreateBusinessForUser(session.userId);
        const result = await database.importBusinessData({
            userId: session.userId,
            businessId: business.id,
            payload
        });
        marketingEventBroker.publishBusiness(business.id, { type: 'analytics-data-changed', reason: 'business-import', timestamp: new Date().toISOString() });
        return sendJson(res, 200, { import: result });
    }

    if (route.type === 'review-response' && req.method === 'PATCH') {
        assertSameOrigin(req);
        const body = await readJsonBody(req);
        const review = await workflowService.updateReviewResponse({
            userId: session.userId,
            reviewId: route.reviewId,
            response: body.response,
            action: String(body.action || 'save').toLowerCase()
        });
        return sendJson(res, 200, { review });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
}


function analyticsFiltersFromSearchParams(searchParams) {
    return {
        compare: searchParams.get('compare') || 'previous-period',
        channel: searchParams.get('channel') || '',
        location: searchParams.get('location') || '',
        businessHours: searchParams.get('businessHours') || 'all'
    };
}

function serializeWorkflowRunForApi(run) {
    return {
        id: Number(run.id),
        businessId: run.business_id === null || run.business_id === undefined ? null : Number(run.business_id),
        workflowSlug: run.workflow_slug,
        workflowName: run.workflow_name,
        status: run.status,
        output: run.output || null,
        error: run.error_message || null,
        dataPeriodStart: run.data_period_start || null,
        dataPeriodEnd: run.data_period_end || null,
        dataRetrievedAt: run.data_retrieved_at || null,
        recordsAnalyzed: Number(run.records_analyzed || 0),
        durationMs: run.duration_ms === null || run.duration_ms === undefined ? null : Number(run.duration_ms),
        progressPercentage: Number(run.progress_percentage || 0),
        currentStep: run.current_step || null,
        estimatedCompletionAt: run.estimated_completion_at || null,
        createdAt: run.created_at,
        startedAt: run.started_at || null,
        completedAt: run.completed_at || null,
        updatedAt: run.updated_at || null,
        heartbeatAt: run.heartbeat_at || null,
        steps: Array.isArray(run.steps) ? run.steps.map((step) => ({
            key: step.step_key,
            title: step.step_title,
            order: Number(step.step_order),
            status: step.status,
            error: step.error_message || null
        })) : undefined,
        logs: Array.isArray(run.logs) ? run.logs.map((entry) => ({
            id: Number(entry.id), level: entry.level, stepKey: entry.step_key || null,
            message: entry.message, metadata: entry.metadata || {}, createdAt: entry.created_at
        })) : undefined,
        artifacts: Array.isArray(run.artifacts) ? run.artifacts.map((artifact) => ({
            id: Number(artifact.id), runId: Number(artifact.run_id), sectionKey: artifact.section_key,
            artifactType: artifact.artifact_type, title: artifact.title, filename: artifact.filename || null,
            mimeType: artifact.mime_type, sizeBytes: Number(artifact.size_bytes || 0), sha256: artifact.sha256,
            metadata: artifact.metadata || {}, createdAt: artifact.created_at,
            downloadUrl: `/api/workflow-artifacts/${Number(artifact.id)}/download`
        })) : undefined
    };
}

function sanitizeDownloadFilename(value) {
    return String(value || 'workflow-artifact')
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) || 'workflow-artifact';
}

function extensionForMimeType(mimeType) {
    const value = String(mimeType || '').toLowerCase();
    if (value === 'application/pdf') return 'pdf';
    if (value.includes('wordprocessingml')) return 'docx';
    if (value.includes('json')) return 'json';
    if (value.includes('png')) return 'png';
    if (value.includes('jpeg')) return 'jpg';
    return 'bin';
}

function parseApiLimit(value, fallback, maximum) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function matchUploadApiRoute(pathname) {
    const match = pathname.match(/^\/api\/uploads\/([A-Za-z0-9_-]{16,64})\/(.+)$/);
    if (!match) return null;
    let relativePath;
    try {
        relativePath = decodeURIComponent(match[2]);
    } catch {
        return null;
    }
    return { batchId: match[1], relativePath };
}

async function handleUploadRequest(req, res, session) {
    if (!session) return sendJson(res, 401, { error: 'Sign in to upload files.' });
    assertSameOrigin(req);

    const batchId = String(req.headers['x-upload-batch'] || '').trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(batchId)) {
        return sendJson(res, 400, { error: 'The upload batch identifier is invalid.' });
    }

    const source = String(req.headers['x-upload-source'] || 'folder').toLowerCase();
    if (!['camera', 'folder'].includes(source)) {
        return sendJson(res, 400, { error: 'The upload source is invalid.' });
    }

    let relativePath;
    try {
        relativePath = normalizeUploadPath(decodeUploadHeader(req.headers['x-upload-path']));
    } catch (error) {
        return sendJson(res, error.statusCode || 400, { error: error.publicMessage || 'The upload path is invalid.' });
    }

    const contentType = normalizeUploadContentType(req.headers['content-type']);
    if (source === 'camera' && !contentType.startsWith('image/')) {
        return sendJson(res, 415, { error: 'Camera uploads must be image files.' });
    }

    let expectedFiles;
    let expectedBytes;
    let contentLength;
    try {
        expectedFiles = parseUploadInteger(req.headers['x-upload-batch-files'], 1, 1, MAX_UPLOAD_BATCH_FILES, 'file count');
        contentLength = parseUploadInteger(req.headers['content-length'], 0, 0, MAX_UPLOAD_FILE_BYTES, 'file size');
        expectedBytes = parseUploadInteger(
            req.headers['x-upload-batch-bytes'],
            contentLength,
            0,
            MAX_UPLOAD_BATCH_BYTES,
            'batch size'
        );
    } catch (error) {
        return sendJson(res, error.statusCode || 400, { error: error.publicMessage || 'The upload metadata is invalid.' });
    }

    if (source === 'camera' && expectedFiles !== 1) {
        return sendJson(res, 400, { error: 'A camera upload must contain exactly one image.' });
    }
    if (contentLength > MAX_UPLOAD_FILE_BYTES) {
        return sendJson(res, 413, { error: 'Each uploaded file must be 25 MB or smaller.' });
    }

    const batchRoot = path.join(UPLOAD_ROOT, String(session.userId), batchId);
    const manifestPath = path.join(batchRoot, '.manifest.json');
    const { directoryPath, filePath } = resolveUploadFilePath(session.userId, batchId, relativePath);
    let temporaryPath = '';
    let committedFilePath = '';

    try {
        await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
        let manifest = await readUploadManifest(manifestPath);
        if (manifest) {
            if (manifest.source !== source
                || manifest.expectedFiles !== expectedFiles
                || manifest.expectedBytes !== expectedBytes) {
                return sendJson(res, 409, { error: 'This upload batch is already in use with different metadata.' });
            }
            const existing = manifest.files.find((file) => file.path === relativePath);
            if (existing) return sendJson(res, 200, { batchId, file: existing, duplicate: true });
            if (manifest.files.length >= manifest.expectedFiles || manifest.files.length >= MAX_UPLOAD_BATCH_FILES) {
                return sendJson(res, 413, { error: 'This upload batch already contains the expected number of files.' });
            }
        } else {
            manifest = {
                batchId,
                source,
                expectedFiles,
                expectedBytes,
                totalBytes: 0,
                createdAt: new Date().toISOString(),
                files: []
            };
        }

        if (manifest.totalBytes + contentLength > MAX_UPLOAD_BATCH_BYTES
            || (manifest.expectedBytes > 0 && manifest.totalBytes + contentLength > manifest.expectedBytes)) {
            return sendJson(res, 413, { error: 'The upload batch exceeds its declared size.' });
        }
        if (await pathExists(filePath)) {
            return sendJson(res, 409, { error: 'A file with this folder path already exists in the upload batch.' });
        }

        temporaryPath = path.join(directoryPath, `.upload-${crypto.randomBytes(12).toString('hex')}`);
        const actualSize = await writeUploadBody(req, temporaryPath);
        if (manifest.totalBytes + actualSize > MAX_UPLOAD_BATCH_BYTES
            || (manifest.expectedBytes > 0 && manifest.totalBytes + actualSize > manifest.expectedBytes)) {
            throw createUploadError(413, 'The upload batch exceeds its declared size.');
        }
        await fs.rename(temporaryPath, filePath);
        temporaryPath = '';
        committedFilePath = filePath;

        const fileRecord = {
            name: path.basename(relativePath),
            path: relativePath,
            size: actualSize,
            contentType,
            source,
            url: buildUploadUrl(batchId, relativePath),
            uploadedAt: new Date().toISOString()
        };
        manifest.files.push(fileRecord);
        manifest.totalBytes += actualSize;
        manifest.updatedAt = new Date().toISOString();
        await writeUploadManifest(manifestPath, manifest);
        committedFilePath = '';
        return sendJson(res, 201, { batchId, file: fileRecord });
    } catch (error) {
        if (temporaryPath) await fs.unlink(temporaryPath).catch(() => {});
        if (committedFilePath) await fs.unlink(committedFilePath).catch(() => {});
        console.error('File upload failed:', error.message);
        return sendJson(res, error.statusCode || 500, {
            error: error.publicMessage || 'The file could not be uploaded. Please try again.'
        });
    }
}

async function handleUploadedFileRequest(res, session, route) {
    if (!session) return sendJson(res, 401, { error: 'Sign in to access uploaded files.' });

    let relativePath;
    try {
        relativePath = normalizeUploadPath(route.relativePath);
    } catch {
        return sendJson(res, 404, { error: 'Uploaded file was not found.' });
    }

    const { filePath } = resolveUploadFilePath(session.userId, route.batchId, relativePath);
    let stats;
    try {
        stats = await fs.stat(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'Uploaded file was not found.' });
        throw error;
    }
    if (!stats.isFile()) return sendJson(res, 404, { error: 'Uploaded file was not found.' });

    const contentType = inferUploadContentType(filePath);
    const inline = contentType.startsWith('image/') && contentType !== 'image/svg+xml';
    const encodedName = encodeURIComponent(path.basename(relativePath)).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, max-age=3600',
        'Cross-Origin-Resource-Policy': 'same-origin'
    });
    const stream = fsNative.createReadStream(filePath);
    stream.on('error', () => {
        if (!res.headersSent) sendJson(res, 500, { error: 'The uploaded file could not be read.' });
        else res.destroy();
    });
    stream.pipe(res);
}

function decodeUploadHeader(value) {
    if (typeof value !== 'string' || !value) throw createUploadError(400, 'The upload path is missing.');
    try {
        return decodeURIComponent(value);
    } catch {
        throw createUploadError(400, 'The upload path is invalid.');
    }
}

function normalizeUploadPath(value) {
    const normalized = String(value || '').replace(/\\/g, '/');
    const segments = normalized.split('/').filter((segment) => segment && segment !== '.');
    if (segments.length === 0 || segments.some((segment) => segment === '..')) {
        throw createUploadError(400, 'The upload path is invalid.');
    }
    for (const segment of segments) {
        if (/[\u0000-\u001f\u007f]/.test(segment) || Buffer.byteLength(segment, 'utf8') > 255) {
            throw createUploadError(400, 'A file or folder name is invalid or too long.');
        }
    }
    const result = segments.join('/');
    if (Buffer.byteLength(result, 'utf8') > MAX_UPLOAD_PATH_BYTES) {
        throw createUploadError(400, 'The upload folder path is too long.');
    }
    return result;
}

function resolveUploadFilePath(userId, batchId, relativePath) {
    const filesRoot = path.resolve(UPLOAD_ROOT, String(userId), batchId, 'files');
    const filePath = path.resolve(filesRoot, ...relativePath.split('/'));
    if (filePath === filesRoot || !filePath.startsWith(`${filesRoot}${path.sep}`)) {
        throw createUploadError(400, 'The upload path is invalid.');
    }
    return { directoryPath: path.dirname(filePath), filePath };
}

async function writeUploadBody(req, temporaryPath) {
    const fileHandle = await fs.open(temporaryPath, 'wx', 0o600);
    let size = 0;
    try {
        for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_UPLOAD_FILE_BYTES) {
                throw createUploadError(413, 'Each uploaded file must be 25 MB or smaller.');
            }
            let offset = 0;
            while (offset < chunk.length) {
                const { bytesWritten } = await fileHandle.write(chunk, offset, chunk.length - offset, size - chunk.length + offset);
                if (bytesWritten <= 0) throw createUploadError(500, 'The uploaded file could not be saved.');
                offset += bytesWritten;
            }
        }
        await fileHandle.sync();
        return size;
    } finally {
        await fileHandle.close().catch(() => {});
    }
}

async function readUploadManifest(manifestPath) {
    try {
        const value = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        if (!value || !Array.isArray(value.files)) throw new Error('Upload manifest is invalid.');
        return value;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function writeUploadManifest(manifestPath, manifest) {
    const temporaryPath = `${manifestPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    await fs.mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
    try {
        await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await fs.rename(temporaryPath, manifestPath);
    } finally {
        await fs.unlink(temporaryPath).catch(() => {});
    }
}

function buildUploadUrl(batchId, relativePath) {
    return `/api/uploads/${batchId}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function normalizeUploadContentType(value) {
    const contentType = String(value || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();
    return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
        ? contentType
        : 'application/octet-stream';
}

function inferUploadContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return ({
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.avif': 'image/avif',
        '.bmp': 'image/bmp'
    })[extension] || 'application/octet-stream';
}

function parseUploadInteger(value, fallback, minimum, maximum, label) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw createUploadError(400, `The upload ${label} is invalid.`);
    }
    return parsed;
}

function createUploadError(statusCode, publicMessage) {
    const error = new Error(publicMessage);
    error.statusCode = statusCode;
    error.publicMessage = publicMessage;
    return error;
}

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

async function handleVoiceTranscriptionRequest(req, res, session) {
    if (!session) {
        return sendJson(res, 401, { error: 'Sign in to use voice input.' });
    }
    assertSameOrigin(req);
    const rateState = getRateState(voiceRequests, String(session.userId), VOICE_WINDOW_MS);
    if (rateState.count >= MAX_VOICE_REQUESTS) {
        res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
        return sendJson(res, 429, { error: 'Too many voice transcription requests. Please wait a moment and try again.' });
    }
    rateState.count += 1;

    const body = await readJsonBody(req);
    const audio = decodeVoiceAudio(body.audio);
    const mimeType = normalizeVoiceMimeType(body.mimeType);
    if (!audio || !mimeType) {
        return sendJson(res, 400, { error: 'A supported voice recording is required.' });
    }
    if (audio.length > MAX_VOICE_AUDIO_BYTES) {
        return sendJson(res, 413, { error: 'The voice recording is too large. Record a shorter message and try again.' });
    }

    try {
        const result = await geminiService.transcribeAudio({
            data: audio.toString('base64'),
            mimeType
        });
        if (!result.transcript) {
            return sendJson(res, 422, { error: 'No clear speech was detected. Please try again closer to the microphone.' });
        }
        return sendJson(res, 200, {
            transcript: result.transcript,
            language: result.language,
            confidence: result.confidence,
            model: result.model
        });
    } catch (error) {
        console.error('Voice transcription failed:', error.message);
        return sendJson(res, error.statusCode || 502, {
            code: error.code || 'VOICE_TRANSCRIPTION_FAILED',
            error: error.publicMessage || 'Voice transcription is temporarily unavailable. Please try again.'
        });
    }
}

function decodeVoiceAudio(value) {
    const encoded = String(value || '').trim();
    if (!encoded || encoded.length > Math.ceil(MAX_VOICE_AUDIO_BYTES * 4 / 3) + 8) return null;
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    try {
        const decoded = Buffer.from(encoded, 'base64');
        if (!decoded.length || decoded.toString('base64') !== encoded) return null;
        return decoded;
    } catch {
        return null;
    }
}

function normalizeVoiceMimeType(value) {
    const mimeType = String(value || '').trim().toLowerCase().split(';')[0];
    return new Set([
        'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3',
        'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac'
    ]).has(mimeType) ? mimeType : '';
}

function normalizeVoiceLanguage(value) {
    const language = String(value || '').trim().replace(/_/g, '-');
    return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/i.test(language) ? language : '';
}

function matchChatApiRoute(pathname) {
    if (pathname === '/api/chats') {
        return { type: 'collection' };
    }

    const messageMatch = pathname.match(/^\/api\/chats\/(\d+)\/messages\/(\d+)$/);
    if (messageMatch) {
        return {
            type: 'message',
            conversationId: Number(messageMatch[1]),
            messageId: Number(messageMatch[2])
        };
    }

    const messagesMatch = pathname.match(/^\/api\/chats\/(\d+)\/messages$/);
    if (messagesMatch) {
        return { type: 'messages', conversationId: Number(messagesMatch[1]) };
    }

    const branchMatch = pathname.match(/^\/api\/chats\/(\d+)\/branch$/);
    if (branchMatch) {
        return { type: 'branch', conversationId: Number(branchMatch[1]) };
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

    if (route.type === 'branch' && req.method === 'POST') {
        assertSameOrigin(req);
        const body = await readJsonBody(req);
        const throughMessageId = normalizeChatMessageId(body.messageId);
        const conversation = await database.branchChatConversation({
            userId: session.userId,
            conversationId: route.conversationId,
            throughMessageId
        });
        if (!conversation) {
            return sendJson(res, 404, { error: 'The saved AI response could not be branched.' });
        }
        return sendJson(res, 201, {
            conversation: serializeChatConversation(conversation),
            sourceMessageId: throughMessageId
        });
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
        const voiceLanguage = normalizeVoiceLanguage(body.voiceLanguage);
        const promptInspection = promptLimits.inspectPrompt(content);
        if (promptInspection.exceeded) {
            return sendJson(res, 413, {
                code: 'PROMPT_TOO_LARGE',
                error: promptLimitErrorMessage(promptInspection),
                limit: {
                    maxCharacters: promptInspection.maxCharacters,
                    maxTokens: promptInspection.maxTokens,
                    characters: promptInspection.characters,
                    estimatedTokens: promptInspection.estimatedTokens,
                    model: promptInspection.model
                }
            });
        }
        const promptReservation = await database.reserveAiAgentPromptUsage(session.userId);
        if (!promptReservation.allowed) {
            return sendJson(res, 429, {
                code: 'AI_AGENT_PROMPT_LIMIT_REACHED',
                error: promptQuotaErrorMessage(promptReservation.usage),
                promptUsage: serializePromptUsage(promptReservation.usage)
            });
        }
        let commandResult;

        try {
            commandResult = await database.addChatCommand({
                userId: session.userId,
                conversationId: route.conversationId,
                content,
                generatedTitle: titleFromCommand(content)
            });
        } catch (error) {
            await database.cancelAiAgentPromptUsageReservation({
                userId: session.userId,
                reservationId: promptReservation.reservationId
            }).catch((releaseError) => {
                console.error('AI prompt reservation cancellation failed:', releaseError.message);
            });
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
            const generatedReply = typeof geminiService.generateAgentReply === 'function'
                ? await agentService.generateReply({
                    userId: session.userId,
                    messages: context,
                    preferredLanguage: voiceLanguage
                })
                : await geminiService.generateReply(context, { preferredLanguage: voiceLanguage });
            const assistantResult = await database.addChatAssistantResponse({
                userId: session.userId,
                conversationId: route.conversationId,
                content: generatedReply.content
            });
            const promptUsage = await database.commitAiAgentPromptUsage({
                userId: session.userId,
                reservationId: promptReservation.reservationId
            });

            return sendJson(res, 201, {
                conversation: serializeChatConversation(assistantResult.conversation),
                userMessage: serializeChatMessage(commandResult.message),
                assistantMessage: serializeChatMessage(assistantResult.message),
                model: generatedReply.model,
                promptUsage: serializePromptUsage(promptUsage)
            });
        } catch (error) {
            console.error('AI agent reply failed:', error.message);
            const promptUsage = await database.cancelAiAgentPromptUsageReservation({
                userId: session.userId,
                reservationId: promptReservation.reservationId
            }).catch((releaseError) => {
                console.error('AI prompt reservation cancellation failed:', releaseError.message);
                return promptReservation.usage;
            });
            const errorPayload = {
                error: error.publicMessage || 'Your command was saved, but the AI agent could not create a reply.',
                commandSaved: true,
                conversation: serializeChatConversation(commandResult.conversation),
                userMessage: serializeChatMessage(commandResult.message),
                promptUsage: serializePromptUsage(promptUsage)
            };
            if (!isProduction) {
                errorPayload.errorCode = error.code || 'GEMINI_UNKNOWN_ERROR';
                errorPayload.details = error.message;
                if (error.model) errorPayload.model = error.model;
            }
            return sendJson(res, error.statusCode || 500, errorPayload);
        }
    }

    if (route.type === 'message' && req.method === 'PATCH') {
        assertSameOrigin(req);
        const rateState = getRateState(chatRequests, String(session.userId), CHAT_WINDOW_MS);
        if (rateState.count >= MAX_CHAT_REQUESTS) {
            res.setHeader('Retry-After', String(Math.ceil((rateState.resetAt - Date.now()) / 1000)));
            return sendJson(res, 429, { error: 'Too many AI requests. Please wait a moment and try again.' });
        }
        rateState.count += 1;
        const body = await readJsonBody(req);
        const content = normalizeChatContent(body.content);
        const voiceLanguage = normalizeVoiceLanguage(body.voiceLanguage);
        const promptInspection = promptLimits.inspectPrompt(content);
        if (promptInspection.exceeded) {
            return sendJson(res, 413, {
                code: 'PROMPT_TOO_LARGE',
                error: promptLimitErrorMessage(promptInspection),
                limit: {
                    maxCharacters: promptInspection.maxCharacters,
                    maxTokens: promptInspection.maxTokens,
                    characters: promptInspection.characters,
                    estimatedTokens: promptInspection.estimatedTokens,
                    model: promptInspection.model
                }
            });
        }

        const promptReservation = await database.reserveAiAgentPromptUsage(session.userId);
        if (!promptReservation.allowed) {
            return sendJson(res, 429, {
                code: 'AI_AGENT_PROMPT_LIMIT_REACHED',
                error: promptQuotaErrorMessage(promptReservation.usage),
                promptUsage: serializePromptUsage(promptReservation.usage)
            });
        }

        let editResult;
        try {
            editResult = await database.replaceChatUserMessage({
                userId: session.userId,
                conversationId: route.conversationId,
                messageId: route.messageId,
                content
            });
            if (!editResult) {
                await database.cancelAiAgentPromptUsageReservation({
                    userId: session.userId,
                    reservationId: promptReservation.reservationId
                });
                return sendJson(res, 404, { error: 'The saved user message could not be edited.' });
            }
        } catch (error) {
            await database.cancelAiAgentPromptUsageReservation({
                userId: session.userId,
                reservationId: promptReservation.reservationId
            }).catch((releaseError) => {
                console.error('AI prompt reservation cancellation failed:', releaseError.message);
            });
            throw error;
        }

        try {
            const context = await database.getChatContext({
                userId: session.userId,
                conversationId: route.conversationId,
                throughMessageId: editResult.message.id,
                limit: 40
            });
            const generatedReply = typeof geminiService.generateAgentReply === 'function'
                ? await agentService.generateReply({
                    userId: session.userId,
                    messages: context,
                    preferredLanguage: voiceLanguage
                })
                : await geminiService.generateReply(context, { preferredLanguage: voiceLanguage });
            const assistantResult = await database.addChatAssistantResponse({
                userId: session.userId,
                conversationId: route.conversationId,
                content: generatedReply.content
            });
            const promptUsage = await database.commitAiAgentPromptUsage({
                userId: session.userId,
                reservationId: promptReservation.reservationId
            });
            const record = await database.getChatMessages({
                userId: session.userId,
                conversationId: route.conversationId
            });

            return sendJson(res, 200, {
                conversation: serializeChatConversation(assistantResult.conversation),
                userMessage: serializeChatMessage(editResult.message),
                assistantMessage: serializeChatMessage(assistantResult.message),
                messages: record.messages.map(serializeChatMessage),
                model: generatedReply.model,
                promptUsage: serializePromptUsage(promptUsage)
            });
        } catch (error) {
            console.error('AI agent reply after message edit failed:', error.message);
            const promptUsage = await database.cancelAiAgentPromptUsageReservation({
                userId: session.userId,
                reservationId: promptReservation.reservationId
            }).catch((releaseError) => {
                console.error('AI prompt reservation cancellation failed:', releaseError.message);
                return promptReservation.usage;
            });
            const record = await database.getChatMessages({
                userId: session.userId,
                conversationId: route.conversationId
            });
            const errorPayload = {
                error: error.publicMessage || 'Your message was updated, but the AI agent could not create a new reply.',
                messageEdited: true,
                conversation: serializeChatConversation(editResult.conversation),
                userMessage: serializeChatMessage(editResult.message),
                messages: record?.messages?.map(serializeChatMessage) || [serializeChatMessage(editResult.message)],
                promptUsage: serializePromptUsage(promptUsage)
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

    res.setHeader('Allow', route.type === 'messages' || route.type === 'collection'
        ? 'GET, POST'
        : route.type === 'branch'
            ? 'POST'
            : route.type === 'message'
                ? 'PATCH'
                : 'PATCH, DELETE');
    return sendJson(res, 405, { error: 'Method not allowed.' });
}

function normalizeChatMessageId(value) {
    const messageId = Number(value);
    if (!Number.isSafeInteger(messageId) || messageId < 1) {
        const error = new Error('A valid saved AI response is required.');
        error.statusCode = 400;
        error.publicMessage = 'A valid saved AI response is required.';
        throw error;
    }
    return messageId;
}

function normalizeChatContent(value) {
    const content = String(value ?? '');
    if (!content.trim()) {
        const error = new Error('Chat command is required.');
        error.statusCode = 400;
        error.publicMessage = 'Type a command before sending.';
        throw error;
    }
    return content;
}

function promptLimitErrorMessage(inspection) {
    const characterLimit = inspection.maxCharacters.toLocaleString('en-US');
    const tokenLimit = inspection.maxTokens.toLocaleString('en-US');
    return `This prompt is too large for ${inspection.model || 'the selected model'}. `
        + `Use no more than ${characterLimit} characters or approximately ${tokenLimit} tokens.`;
}

function promptQuotaErrorMessage(usage) {
    if (usage.periodKind === 'calendar_month') {
        return `The Free plan monthly limit of ${usage.limit.toLocaleString('en-US')} AI Agent prompts has been reached.`;
    }
    return `The ${usage.planName} plan limit of ${usage.limit.toLocaleString('en-US')} AI Agent prompts `
        + 'for the current 30-day subscription period has been reached.';
}

function serializePromptUsage(usage) {
    return {
        planId: usage.planId,
        planName: usage.planName,
        limit: Number(usage.limit),
        used: Number(usage.used),
        remaining: Number(usage.remaining),
        exhausted: usage.exhausted === true,
        periodKind: usage.periodKind,
        periodStart: usage.periodStart,
        periodEnd: usage.periodEnd
    };
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

async function handleBillingProfileRequest(res, session) {
    if (!session) {
        return sendJson(res, 401, { error: 'Sign in to view billing details.' });
    }
    try {
        const [billing, promptUsage] = await Promise.all([
            paymentService.getBillingProfile({ userId: session.userId }),
            database.getAiAgentPromptUsage(session.userId)
        ]);
        session.billing = billing;
        return sendJson(res, 200, { billing, promptUsage: serializePromptUsage(promptUsage) });
    } catch (error) {
        console.error('Billing profile lookup failed:', error.message);
        return sendJson(res, error.statusCode || 500, {
            error: error.publicMessage || 'Billing details could not be loaded.',
            code: error.code || 'BILLING_PROFILE_ERROR'
        });
    }
}

async function handleRazorpayWebhookRequest(req, res) {
    try {
        const rawBody = await readRawJsonBody(req, MAX_WEBHOOK_BODY_BYTES, 'Webhook payload is too large.');
        const result = await paymentService.handleRazorpayWebhook({
            rawBody,
            signature: req.headers['x-razorpay-signature'],
            eventId: req.headers['x-razorpay-event-id']
        });
        return sendJson(res, 200, result);
    } catch (error) {
        console.error('Razorpay webhook failed:', error.message);
        return sendJson(res, error.statusCode || 500, {
            error: error.publicMessage || 'Razorpay webhook could not be processed.'
        });
    }
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
        if (result?.billing) {
            session.billing = result.billing;
            const promptUsage = await database.getAiAgentPromptUsage(session.userId);
            result.promptUsage = serializePromptUsage(promptUsage);
        }
        return sendJson(res, 200, result);
    } catch (error) {
        console.error(`${operation} failed:`, error.message);
        return sendJson(res, error.statusCode || 500, {
            error: error.publicMessage || 'Payment could not be completed. Please try again.',
            code: error.code || 'PAYMENT_ERROR'
        });
    }
}

function assertSameOrigin(req) {
    const fetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
    if (fetchSite === 'same-origin') {
        return;
    }
    if (fetchSite === 'cross-site') {
        throwCrossOriginRequestError();
    }

    const requestOrigin = getRequestOrigin(req);
    const allowedOrigins = new Set([requestOrigin, new URL(APP_BASE_URL).origin]);
    const origin = String(req.headers.origin || '').trim();

    if (origin && origin !== 'null') {
        if (!allowedOrigins.has(origin)) {
            throwCrossOriginRequestError();
        }
        return;
    }

    const referer = String(req.headers.referer || '').trim();
    if (!referer) {
        return;
    }

    try {
        if (!allowedOrigins.has(new URL(referer).origin)) {
            throwCrossOriginRequestError();
        }
    } catch (error) {
        if (error?.statusCode === 403) {
            throw error;
        }
        throwCrossOriginRequestError();
    }
}

function getRequestOrigin(req) {
    let protocol = req.socket?.encrypted ? 'https' : 'http';
    let host = String(req.headers.host || 'localhost').trim();

    if (process.env.TRUST_PROXY === 'true') {
        const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',', 1)[0].trim().toLowerCase();
        const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',', 1)[0].trim();
        if (forwardedProtocol === 'http' || forwardedProtocol === 'https') {
            protocol = forwardedProtocol;
        }
        if (forwardedHost) {
            host = forwardedHost;
        }
    }

    return new URL(`${protocol}://${host}`).origin;
}

function throwCrossOriginRequestError() {
    const error = new Error('Cross-origin request rejected.');
    error.statusCode = 403;
    error.publicMessage = 'This request was rejected.';
    throw error;
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
        await createSession(res, user, stateRecord.rememberMe);
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

async function verifyAuthCaptcha(body, clientIp) {
    const token = String(body.get('h-captcha-response') || '').trim();
    const result = await hcaptchaService.verify({ token, remoteIp: clientIp });

    if (result.success) return null;

    if (result.reason === 'unavailable') {
        console.error('hCaptcha verification unavailable:', result.errorCodes.join(', ') || 'unknown error');
        return {
            statusCode: 503,
            message: 'Security verification is temporarily unavailable. Please try again.',
            recordAttempt: false
        };
    }

    if (result.errorCodes.length) {
        console.warn('hCaptcha verification rejected:', result.errorCodes.join(', '));
    }
    return {
        statusCode: token ? 403 : 400,
        message: 'Please complete the security verification and try again.',
        recordAttempt: true
    };
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
    const captchaFailure = await verifyAuthCaptcha(body, clientIp);

    if (captchaFailure) {
        if (captchaFailure.recordAttempt) recordFailedAttempt(loginAttempts, clientIp, LOGIN_WINDOW_MS);
        return sendHtml(res, captchaFailure.statusCode, loginPage({ error: captchaFailure.message, email }));
    }

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
    await createSession(res, user, rememberMe);
    return redirect(res, '/dashboard');
}

async function handleForgotPassword(req, res) {
    const clientIp = getClientIp(req);
    const ipRateState = getRateState(passwordResetAttempts, `ip:${clientIp}`, PASSWORD_RESET_WINDOW_MS);
    if (ipRateState.count >= MAX_PASSWORD_RESET_ATTEMPTS) {
        res.setHeader('Retry-After', String(Math.ceil((ipRateState.resetAt - Date.now()) / 1000)));
        return sendHtml(res, 429, forgotPasswordPage({ error: 'Too many reset requests. Please try again later.' }));
    }

    const body = await readFormBody(req);
    const email = normalizeEmail(body.get('email') || '');
    if (!isValidEmail(email)) {
        recordFailedAttempt(passwordResetAttempts, `ip:${clientIp}`, PASSWORD_RESET_WINDOW_MS);
        return sendHtml(res, 400, forgotPasswordPage({ error: 'Enter a valid email address.', email }));
    }

    const emailRateState = getRateState(passwordResetAttempts, `email:${email}`, PASSWORD_RESET_WINDOW_MS);
    if (emailRateState.count >= MAX_PASSWORD_RESET_ATTEMPTS) {
        res.setHeader('Retry-After', String(Math.ceil((emailRateState.resetAt - Date.now()) / 1000)));
        return sendHtml(res, 429, forgotPasswordPage({ error: 'Too many reset requests. Please try again later.', email }));
    }
    ipRateState.count += 1;
    emailRateState.count += 1;

    if (!emailService.isConfigured) {
        return sendHtml(res, 503, forgotPasswordPage({
            error: 'Password reset email is temporarily unavailable. Please contact support.',
            email
        }));
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_MINUTES * 60 * 1000);
    const user = await database.createPasswordResetToken({ email, tokenHash, expiresAt, requestedIp: clientIp });

    if (user) {
        const resetUrl = new URL('/reset-password', `${APP_BASE_URL}/`);
        resetUrl.searchParams.set('token', rawToken);
        try {
            await emailService.sendPasswordReset({
                to: user.email,
                resetUrl: resetUrl.toString(),
                expiresMinutes: PASSWORD_RESET_TOKEN_MINUTES
            });
        } catch (error) {
            console.error('Password reset email failed:', error.message);
            return sendHtml(res, error.statusCode || 503, forgotPasswordPage({
                error: 'The reset email could not be sent right now. Please try again later.',
                email
            }));
        }
    }

    return sendHtml(res, 200, forgotPasswordPage({
        success: 'If an account exists for that email, a secure reset link has been sent.'
    }));
}

async function handleResetPasswordPage(res, rawToken) {
    if (!isValidPasswordResetToken(rawToken)) {
        return sendHtml(res, 400, resetPasswordPage({ state: 'invalid', error: resetLinkError('invalid') }));
    }
    const status = await database.getPasswordResetTokenStatus(hashPasswordResetToken(rawToken));
    if (status !== 'ready') {
        return sendHtml(res, status === 'expired' ? 410 : 400, resetPasswordPage({
            state: status,
            error: resetLinkError(status)
        }));
    }
    return sendHtml(res, 200, resetPasswordPage({ token: rawToken, state: 'ready' }));
}

async function handleResetPassword(req, res) {
    const body = await readFormBody(req);
    const rawToken = String(body.get('token') || '');
    const password = String(body.get('password') || '');
    const confirmPassword = String(body.get('confirmPassword') || '');

    if (!isValidPasswordResetToken(rawToken)) {
        return sendHtml(res, 400, resetPasswordPage({ state: 'invalid', error: resetLinkError('invalid') }));
    }
    const passwordError = validateResetPassword(password, confirmPassword);
    if (passwordError) {
        return sendHtml(res, 400, resetPasswordPage({ token: rawToken, state: 'ready', error: passwordError }));
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await database.consumePasswordResetToken({
        tokenHash: hashPasswordResetToken(rawToken),
        passwordHash
    });
    if (result.status !== 'success') {
        return sendHtml(res, result.status === 'expired' ? 410 : 400, resetPasswordPage({
            state: result.status,
            error: resetLinkError(result.status)
        }));
    }

    await database.deleteAuthSessionsForUser(result.userId);
    for (const [sessionToken, activeSession] of sessions) {
        if (String(activeSession.userId) === result.userId) {
            closeSessionStreams(sessionToken);
            sessions.delete(sessionToken);
        }
    }
    return sendHtml(res, 200, resetPasswordPage({
        state: 'success',
        success: 'Your password has been updated. You can now sign in with the new password.'
    }));
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
    const captchaFailure = await verifyAuthCaptcha(body, clientIp);

    if (captchaFailure) {
        if (captchaFailure.recordAttempt) recordFailedAttempt(registerAttempts, clientIp, REGISTER_WINDOW_MS);
        return sendHtml(res, captchaFailure.statusCode, registerPage({
            error: captchaFailure.message,
            username,
            email
        }));
    }

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

function validateResetPassword(password, confirmPassword) {
    if (typeof password !== 'string' || Array.from(password).length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
        return 'Password must be at least 10 characters and no more than 72 UTF-8 bytes.';
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        return 'Use a stronger password with uppercase, lowercase, and at least one number.';
    }
    if (password !== confirmPassword) return 'Passwords do not match.';
    return '';
}

function isValidPasswordResetToken(value) {
    return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function hashPasswordResetToken(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function resetLinkError(status) {
    if (status === 'expired') return 'This password reset link has expired.';
    if (status === 'used') return 'This password reset link has already been used.';
    return 'This password reset link is invalid.';
}

async function createSession(res, user, rememberMe) {
    const token = crypto.randomBytes(32).toString('base64url');
    const sessionLifetime = rememberMe ? REMEMBER_ME_MS : NORMAL_SESSION_MS;
    const session = {
        token,
        userId: String(user.id),
        username: user.username,
        email: user.email,
        expiresAt: Date.now() + sessionLifetime,
        showLoginIntro: true
    };
    await database.createAuthSession({
        tokenHash: hashSessionToken(token),
        userId: session.userId,
        expiresAt: new Date(session.expiresAt),
        rememberMe,
        showLoginIntro: true
    });
    sessions.set(token, session);
    setSessionCookie(res, token, rememberMe ? REMEMBER_ME_MS : null);
}

function loginPage(overrides = {}) {
    return renderLoginPage({
        error: '',
        success: '',
        email: '',
        hcaptchaSiteKey: hcaptchaService.siteKey,
        ...overrides
    });
}

function registerPage(overrides = {}) {
    return renderRegisterPage({
        error: '',
        username: '',
        email: '',
        hcaptchaSiteKey: hcaptchaService.siteKey,
        ...overrides
    });
}

function forgotPasswordPage(overrides = {}) {
    return renderForgotPasswordPage({ error: '', success: '', email: '', ...overrides });
}

function resetPasswordPage(overrides = {}) {
    return renderResetPasswordPage({ token: '', error: '', success: '', state: 'ready', ...overrides });
}

async function getSession(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) {
        return null;
    }

    const record = await database.findAuthSession(hashSessionToken(token));
    if (!record) {
        closeSessionStreams(token);
        sessions.delete(token);
        return null;
    }

    const session = {
        token,
        userId: String(record.user_id),
        username: record.username,
        email: record.email,
        expiresAt: new Date(record.expires_at).getTime(),
        showLoginIntro: record.show_login_intro === true
    };
    sessions.set(token, session);
    return session;
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
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

function registerSessionStream(sessionToken, res) {
    if (!sessionToken || res.destroyed || res.writableEnded) return;
    let streams = sessionStreams.get(sessionToken);
    if (!streams) {
        streams = new Set();
        sessionStreams.set(sessionToken, streams);
    }
    streams.add(res);

    const release = () => {
        const activeStreams = sessionStreams.get(sessionToken);
        if (!activeStreams) return;
        activeStreams.delete(res);
        if (activeStreams.size === 0) sessionStreams.delete(sessionToken);
    };
    res.once('close', release);
    res.once('error', (error) => {
        release();
        if (!isExpectedStreamError(error)) {
            console.error('Authenticated stream failed:', error);
        }
    });
}

function closeSessionStreams(sessionToken) {
    const streams = sessionStreams.get(sessionToken);
    if (!streams) return;
    sessionStreams.delete(sessionToken);
    for (const stream of streams) {
        if (stream.destroyed || stream.writableEnded) continue;
        try {
            stream.end();
        } catch (error) {
            console.error('Authenticated stream cleanup failed:', error.message);
            stream.destroy();
        }
    }
}

function isExpectedClientDisconnect(error, req) {
    if (isExpectedStreamError(error)) return true;
    return req.aborted === true && (error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
}

function isExpectedStreamError(error) {
    return ['ECONNRESET', 'EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(error?.code);
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

function consumeWorkflowQuota(res, key) {
    const rateState = getRateState(workflowRequests, key, WORKFLOW_WINDOW_MS);
    if (rateState.count >= MAX_WORKFLOW_REQUESTS) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rateState.resetAt - Date.now()) / 1000))));
        sendJson(res, 429, { error: 'Too many workflow requests. Try again shortly.' });
        return false;
    }
    recordFailedAttempt(workflowRequests, key, WORKFLOW_WINDOW_MS);
    return true;
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
        if (size > MAX_FORM_BODY_BYTES) {
            const error = new Error('Request body too large');
            error.statusCode = 413;
            error.publicMessage = 'Form submission is too large.';
            throw error;
        }
        chunks.push(chunk);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function readRawJsonBody(req, maxBytes, tooLargeMessage) {
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
        if (size > maxBytes) {
            const error = new Error('Request body too large');
            error.statusCode = 413;
            error.publicMessage = tooLargeMessage;
            throw error;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function readJsonBody(req) {
    const rawBody = await readRawJsonBody(req, MAX_API_JSON_BODY_BYTES, 'API request is too large.');
    try {
        const parsed = JSON.parse(rawBody.toString('utf8') || '{}');
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
        `script-src 'self' 'nonce-${cspNonce}' https://hcaptcha.com https://*.hcaptcha.com https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com`,
        "style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com https://fonts.googleapis.com https://cdnjs.cloudflare.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com https://*.paypalobjects.com data:",
        "img-src 'self' data: blob: https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "media-src 'self' blob:",
        "connect-src 'self' https://hcaptcha.com https://*.hcaptcha.com https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "child-src 'self' https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "frame-src 'self' https://hcaptcha.com https://*.hcaptcha.com https://*.razorpay.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://*.razorpay.com https://*.paypal.com",
        "frame-ancestors 'none'"
    ].join('; '));
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
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

function parseBoundedInteger(value, fallback, minimum, maximum, name) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${name} must be a number between ${minimum} and ${maximum}.`);
    }
    return parsed;
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
            closeSessionStreams(token);
            sessions.delete(token);
        }
    }
    cleanExpiredOAuthStates();
    database.deleteExpiredPasswordResetTokens().catch((error) => {
        console.error('Password reset token cleanup failed:', error.message);
    });
    database.deleteExpiredAuthSessions().catch((error) => {
        console.error('Authentication session cleanup failed:', error.message);
    });
    database.deleteExpiredAiAgentPromptReservations().catch((error) => {
        console.error('AI prompt reservation cleanup failed:', error.message);
    });
    for (const store of [loginAttempts, registerAttempts, passwordResetAttempts, chatRequests, workflowRequests, businessImportRequests]) {
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
    for (const token of sessionStreams.keys()) closeSessionStreams(token);
    server.close(async () => {
        try {
            await marketingScheduler.stop();
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
            console.log(`OrexisAI is running at http://localhost:${activePort}`);
            console.log('PostgreSQL users table is ready.');
            marketingScheduler.start();
        });
    })
    .catch(async (error) => {
        console.error('Unable to start server:', error.message);
        await database.close().catch(() => {});
        process.exit(1);
    });
