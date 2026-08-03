'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createEmailService } = require('../email-service');
const {
    countUnicodeCharacters,
    createPromptLimitConfiguration,
    estimateTokens
} = require('../prompt-limits');
const { renderDashboardPage } = require('../views/dashboard');
const { renderForgotPasswordPage, renderResetPasswordPage } = require('../views/password-recovery');

const projectFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('prompt limits count visible Unicode characters and use conservative token estimates', () => {
    assert.equal(countUnicodeCharacters('A😀e\u0301\n'), 4);
    assert.equal(countUnicodeCharacters('👨‍👩‍👧‍👦'), 1);
    assert.ok(estimateTokens('😀'.repeat(100)) >= 134);
});

test('prompt limits are centrally configurable with selected-model overrides', () => {
    const limits = createPromptLimitConfiguration({
        model: 'gemini-test',
        env: {
            PROMPT_MAX_CHARACTERS: '2000',
            PROMPT_MAX_TOKENS: '5000',
            PROMPT_WARNING_RATIO: '0.8',
            AI_MODEL_PROMPT_LIMITS_JSON: JSON.stringify({
                'gemini-test': { maxCharacters: 1000, maxTokens: 2000 }
            })
        }
    });

    assert.deepEqual(limits.getPublicConfiguration(), {
        model: 'gemini-test',
        maxCharacters: 1000,
        maxTokens: 2000,
        warningRatio: 0.8
    });
    assert.equal(limits.inspectPrompt('a'.repeat(800)).nearLimit, true);
    assert.equal(limits.inspectPrompt('a'.repeat(1001)).exceeded, true);
});

test('password recovery views match the existing auth shell and escape submitted values', () => {
    const forgotHtml = renderForgotPasswordPage({ email: '\"><script>alert(1)</script>' });
    const resetHtml = renderResetPasswordPage({ token: 'safe-token', state: 'ready' });
    const successHtml = renderResetPasswordPage({
        state: 'success',
        success: 'Your password has been updated.'
    });

    assert.match(forgotHtml, /class="auth-panel glass-panel"/);
    assert.match(forgotHtml, /action="\/forgot-password"/);
    assert.doesNotMatch(forgotHtml, /<script>alert\(1\)<\/script>/);
    assert.match(forgotHtml, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(resetHtml, /action="\/reset-password"/);
    assert.match(resetHtml, /autocomplete="new-password"/);
    assert.match(resetHtml, /Use 10\+ characters/);
    assert.match(successHtml, /Return to Login/);
});

test('password reset email delivery uses the configured HTTPS provider without exposing the API key', async () => {
    let request;
    const emailService = createEmailService({
        env: {
            EMAIL_PROVIDER: 'resend',
            RESEND_API_KEY: 're_test_secret',
            EMAIL_FROM: 'OrexisAI <no-reply@example.com>',
            EMAIL_TIMEOUT_MS: '2000'
        },
        fetchImpl: async (url, options) => {
            request = { url, options };
            return {
                ok: true,
                status: 200,
                async text() { return '{"id":"email_123"}'; }
            };
        }
    });

    const result = await emailService.sendPasswordReset({
        to: 'owner@example.com',
        resetUrl: 'https://example.com/reset-password?token=one-time-token',
        expiresMinutes: 30
    });
    const payload = JSON.parse(request.options.body);

    assert.equal(emailService.isConfigured, true);
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.options.headers.Authorization, 'Bearer re_test_secret');
    assert.deepEqual(payload.to, ['owner@example.com']);
    assert.match(payload.html, /one-time-token/);
    assert.equal(result.id, 'email_123');
    assert.doesNotMatch(request.options.body, /re_test_secret/);
});

test('schema and database flow store only hashed, expiring, one-time reset tokens', () => {
    const schema = projectFile('database', 'schema.sql');
    const databaseSource = projectFile('database.js');

    assert.match(schema, /CREATE TABLE IF NOT EXISTS password_reset_tokens/);
    assert.match(schema, /token_hash CHAR\(64\) NOT NULL UNIQUE/);
    assert.match(schema, /expires_at TIMESTAMPTZ NOT NULL/);
    assert.match(schema, /used_at TIMESTAMPTZ/);
    assert.match(databaseSource, /createPasswordResetToken/);
    assert.match(databaseSource, /consumePasswordResetToken/);
    assert.match(databaseSource, /FOR UPDATE/);
    assert.match(databaseSource, /UPDATE users SET password_hash/);
    assert.match(databaseSource, /WHERE user_id = \$1 AND used_at IS NULL/);
});

test('server validates reset links and oversized prompts before protected work', () => {
    const serverSource = projectFile('server.js');
    const promptCheck = serverSource.indexOf('const promptInspection = promptLimits.inspectPrompt(content);');
    const databaseWrite = serverSource.indexOf('commandResult = await database.addChatCommand');
    const aiRequest = serverSource.indexOf('geminiService.generateReply');

    assert.match(serverSource, /pathname === '\/forgot-password'/);
    assert.match(serverSource, /pathname === '\/reset-password'/);
    assert.match(serverSource, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
    assert.match(serverSource, /crypto\.createHash\('sha256'\)/);
    assert.match(serverSource, /If an account exists for that email/);
    assert.match(serverSource, /PROMPT_LIMIT_EXCEEDED/);
    assert.ok(promptCheck !== -1 && promptCheck < databaseWrite);
    assert.ok(promptCheck < aiRequest);
});

test('dashboard exposes a responsive live counter without silently truncating input', () => {
    const html = renderDashboardPage({
        user: { email: 'owner@example.com', displayName: 'Owner', initials: 'O' },
        plans: [{
            id: 'free', name: 'Free', tagline: 'Try core outcomes', usdCents: 0,
            inrPaise: 0, features: ['2 workflows'], featured: false
        }],
        billing: { currentPlanId: 'free', planExpiresAt: null },
        paymentConfiguration: {
            razorpay: { keyId: '', isConfigured: false },
            paypal: { clientId: '', isConfigured: false, mode: 'sandbox' }
        },
        aiConfiguration: {
            isConfigured: true,
            model: 'gemini-test',
            promptLimit: { maxCharacters: 131072, maxTokens: 32768, warningRatio: 0.85 }
        },
        cspNonce: 'test-nonce'
    });
    const appSource = projectFile('public', 'app.js');

    assert.match(html, /data-prompt-max-characters="131072"/);
    assert.match(html, /id="agentPromptLimitStatus"/);
    assert.doesNotMatch(html, /maxlength="4000"/);
    assert.match(appSource, /commandInput\.addEventListener\('input'/);
    assert.match(appSource, /promptInspection\.exceeded/);
    assert.match(appSource, /Nothing was sent\./);
    assert.doesNotMatch(appSource, /\.slice\(0,\s*PROMPT_MAX_CHARACTERS\)/);
});
