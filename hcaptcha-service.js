'use strict';

const net = require('node:net');

const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TOKEN_LENGTH = 16_384;

function createHcaptchaService({
    siteKey = process.env.HCAPTCHA_SITE_KEY,
    secretKey = process.env.HCAPTCHA_SECRET_KEY,
    timeoutMs = process.env.HCAPTCHA_TIMEOUT_MS,
    fetchImpl = globalThis.fetch
} = {}) {
    const publicSiteKey = String(siteKey || '').trim();
    const privateSecretKey = String(secretKey || '').trim();
    const requestTimeoutMs = parseTimeout(timeoutMs);
    const isConfigured = Boolean(publicSiteKey && privateSecretKey && typeof fetchImpl === 'function');

    async function verify({ token, remoteIp } = {}) {
        const responseToken = String(token || '').trim();
        if (!responseToken || responseToken.length > MAX_TOKEN_LENGTH) {
            return { success: false, reason: 'invalid', errorCodes: ['missing-or-malformed-response'] };
        }
        if (!isConfigured) {
            return { success: false, reason: 'unavailable', errorCodes: ['not-configured'] };
        }

        const form = new URLSearchParams({
            secret: privateSecretKey,
            response: responseToken,
            sitekey: publicSiteKey
        });
        const normalizedIp = normalizeRemoteIp(remoteIp);
        if (normalizedIp) form.set('remoteip', normalizedIp);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        timeout.unref?.();

        try {
            const response = await fetchImpl(HCAPTCHA_VERIFY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form,
                signal: controller.signal
            });

            if (!response?.ok) {
                return { success: false, reason: 'unavailable', errorCodes: ['verification-http-error'] };
            }

            let payload;
            try {
                payload = await response.json();
            } catch {
                return { success: false, reason: 'unavailable', errorCodes: ['verification-invalid-response'] };
            }

            if (payload?.success === true) {
                return {
                    success: true,
                    reason: 'verified',
                    errorCodes: [],
                    hostname: typeof payload.hostname === 'string' ? payload.hostname : ''
                };
            }

            return {
                success: false,
                reason: 'invalid',
                errorCodes: normalizeErrorCodes(payload?.['error-codes'])
            };
        } catch (error) {
            return {
                success: false,
                reason: 'unavailable',
                errorCodes: [error?.name === 'AbortError' ? 'verification-timeout' : 'verification-network-error']
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    return Object.freeze({
        isConfigured,
        siteKey: publicSiteKey,
        verify
    });
}

function normalizeRemoteIp(value) {
    const remoteIp = String(value || '').trim();
    return net.isIP(remoteIp) ? remoteIp : '';
}

function normalizeErrorCodes(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.slice(0, 100))
        .slice(0, 10);
}

function parseTimeout(value) {
    if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_TIMEOUT_MS;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 30_000) {
        throw new Error('HCAPTCHA_TIMEOUT_MS must be a number between 1000 and 30000.');
    }
    return parsed;
}

module.exports = { createHcaptchaService };
