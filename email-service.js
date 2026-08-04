'use strict';

const RESEND_API_URL = 'https://api.resend.com/emails';

function createEmailService({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const provider = String(env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
    const apiKey = String(env.RESEND_API_KEY || '').trim();
    const from = String(env.EMAIL_FROM || '').trim();
    const replyTo = String(env.EMAIL_REPLY_TO || '').trim();
    const timeoutMs = parseTimeout(env.EMAIL_TIMEOUT_MS || '10000');
    const isConfigured = provider === 'resend' && Boolean(apiKey && from);

    async function send({ to, subject, text, html, purpose }) {
        if (!isConfigured) {
            throw createEmailError(
                'EMAIL_NOT_CONFIGURED',
                `${purpose} email is not configured. Set EMAIL_PROVIDER, RESEND_API_KEY, and EMAIL_FROM.`,
                503
            );
        }
        if (typeof fetchImpl !== 'function') {
            throw createEmailError('EMAIL_FETCH_UNAVAILABLE', 'Fetch API is unavailable.', 500);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        timeout.unref?.();
        try {
            const response = await fetchImpl(RESEND_API_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from,
                    to: [to],
                    ...(replyTo ? { reply_to: replyTo } : {}),
                    subject,
                    text,
                    html
                }),
                signal: controller.signal
            });
            const body = await readResponseBody(response);
            if (!response.ok) {
                throw createEmailError(
                    'EMAIL_PROVIDER_ERROR',
                    body?.message || `Email provider returned HTTP ${response.status}.`,
                    response.status >= 500 ? 503 : 502
                );
            }
            return { id: String(body?.id || '') };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw createEmailError('EMAIL_TIMEOUT', `${purpose} email request timed out.`, 504);
            }
            if (error?.code?.startsWith('EMAIL_')) throw error;
            throw createEmailError('EMAIL_NETWORK_ERROR', error?.message || 'Email request failed.', 503);
        } finally {
            clearTimeout(timeout);
        }
    }

    return Object.freeze({
        isConfigured,
        async sendPasswordReset({ to, resetUrl, expiresMinutes }) {
            return send({
                to,
                subject: 'Reset your OrexisAI password',
                text: buildTextEmail(resetUrl, expiresMinutes),
                html: buildHtmlEmail(resetUrl, expiresMinutes),
                purpose: 'Password reset'
            });
        },
        async sendAnalyticsReport({ to, subject, text, html }) {
            return send({
                to,
                subject: String(subject || 'OrexisAI analytics report').slice(0, 200),
                text: String(text || ''),
                html: String(html || ''),
                purpose: 'Analytics report'
            });
        }
    });
}

function buildTextEmail(resetUrl, expiresMinutes) {
    return [
        'Reset your OrexisAI password',
        '',
        `Open this secure link to choose a new password: ${resetUrl}`,
        '',
        `This link expires in ${expiresMinutes} minutes and can only be used once.`,
        'If you did not request this reset, you can safely ignore this email.'
    ].join('\n');
}

function buildHtmlEmail(resetUrl, expiresMinutes) {
    const safeUrl = escapeHtml(resetUrl);
    return `<!doctype html>
<html lang="en">
<body style="margin:0;background:#090a0f;color:#f8fafc;font-family:Arial,sans-serif;padding:32px 16px">
  <div style="max-width:560px;margin:0 auto;background:#12141c;border:1px solid #2a2f3d;border-radius:20px;padding:32px">
    <div style="font-size:28px;font-weight:700;margin-bottom:22px">Orexis<span style="color:#818cf8">AI</span></div>
    <h1 style="font-size:24px;margin:0 0 12px">Reset your password</h1>
    <p style="color:#a5adbd;line-height:1.6;margin:0 0 24px">Use the secure button below to choose a new password for your account.</p>
    <a href="${safeUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px">Reset password</a>
    <p style="color:#a5adbd;line-height:1.6;margin:24px 0 0">This link expires in ${expiresMinutes} minutes and works only once. If you did not request it, ignore this email.</p>
  </div>
</body>
</html>`;
}

async function readResponseBody(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { message: text.slice(0, 500) };
    }
}

function createEmailError(code, message, statusCode) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function parseTimeout(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 2_000 || parsed > 60_000) {
        throw new Error('EMAIL_TIMEOUT_MS must be between 2000 and 60000.');
    }
    return parsed;
}

module.exports = { createEmailService };
