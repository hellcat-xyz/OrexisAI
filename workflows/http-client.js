'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function createHttpClient({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch API implementation is required.');

    return {
        async json(url, options = {}) {
            const response = await request(url, { ...options, expect: 'json' });
            return response.body;
        },
        async text(url, options = {}) {
            const response = await request(url, { ...options, expect: 'text' });
            return response.body;
        },
        async request(url, options = {}) {
            return request(url, options);
        }
    };

    async function request(rawUrl, options = {}) {
        const safeUrl = await assertPublicHttpUrl(rawUrl);
        const attempts = Math.max(1, Number(options.retries ?? retries) + 1);
        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const controller = new AbortController();
            const effectiveTimeout = clampInteger(options.timeoutMs, timeoutMs, 1_000, 60_000);
            const timer = setTimeout(() => controller.abort(), effectiveTimeout);
            timer.unref?.();
            try {
                const response = await fetchImpl(safeUrl, {
                    method: options.method || 'GET',
                    headers: {
                        Accept: options.expect === 'text' ? 'text/html, text/plain;q=0.9, */*;q=0.1' : 'application/json',
                        'User-Agent': 'OrexisAI-Workflow/1.0 (+https://orexis.ai)',
                        ...(options.headers || {})
                    },
                    body: options.body,
                    redirect: 'manual',
                    signal: controller.signal
                });

                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('location');
                    if (!location) throw createHttpError('HTTP_REDIRECT_INVALID', 'The upstream service returned an invalid redirect.', response.status);
                    const redirected = new URL(location, safeUrl).toString();
                    clearTimeout(timer);
                    return request(redirected, { ...options, retries: Math.max(0, attempts - attempt - 1) });
                }

                if (!response.ok) {
                    const message = await readLimitedBody(response, 'text', 32 * 1024).catch(() => '');
                    const error = createHttpError(
                        'HTTP_UPSTREAM_ERROR',
                        `Upstream request failed with HTTP ${response.status}.`,
                        response.status,
                        message.slice(0, 500)
                    );
                    error.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
                    if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) throw error;
                    lastError = error;
                    await sleep(error.retryAfterMs || backoffMs(attempt));
                    continue;
                }

                const body = await readLimitedBody(
                    response,
                    options.expect || 'json',
                    clampInteger(options.maxBytes, MAX_RESPONSE_BYTES, 1_024, 10 * 1024 * 1024)
                );
                return {
                    body,
                    status: response.status,
                    headers: response.headers,
                    url: safeUrl
                };
            } catch (error) {
                if (error?.name === 'AbortError') {
                    lastError = createHttpError('HTTP_TIMEOUT', `Upstream request exceeded ${effectiveTimeout}ms.`, 504);
                } else {
                    lastError = error;
                }
                if (attempt === attempts || !isRetryableError(lastError)) throw lastError;
                await sleep(backoffMs(attempt));
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastError || createHttpError('HTTP_FAILED', 'The upstream request failed.', 502);
    }
}

async function assertPublicHttpUrl(rawUrl) {
    let url;
    try {
        url = new URL(String(rawUrl || '').trim());
    } catch {
        throw createHttpError('INVALID_URL', 'A valid HTTPS URL is required.', 400);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw createHttpError('INVALID_URL_PROTOCOL', 'Only HTTP and HTTPS URLs are supported.', 400);
    }
    if (url.username || url.password) throw createHttpError('INVALID_URL_CREDENTIALS', 'URLs containing credentials are not allowed.', 400);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw createHttpError('PRIVATE_NETWORK_BLOCKED', 'Private network URLs are not allowed.', 400);
    }
    const addresses = net.isIP(hostname)
        ? [{ address: hostname }]
        : await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    if (addresses.length === 0) throw createHttpError('DNS_LOOKUP_FAILED', 'The hostname could not be resolved.', 502);
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
        throw createHttpError('PRIVATE_NETWORK_BLOCKED', 'Private network URLs are not allowed.', 400);
    }
    return url.toString();
}

function isPrivateAddress(address) {
    if (net.isIPv4(address)) {
        const parts = address.split('.').map(Number);
        return parts[0] === 10
            || parts[0] === 127
            || (parts[0] === 169 && parts[1] === 254)
            || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            || (parts[0] === 192 && parts[1] === 168)
            || parts[0] === 0
            || parts[0] >= 224;
    }
    if (net.isIPv6(address)) {
        const normalized = address.toLowerCase();
        return normalized === '::1'
            || normalized === '::'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || normalized.startsWith('fe8')
            || normalized.startsWith('fe9')
            || normalized.startsWith('fea')
            || normalized.startsWith('feb');
    }
    return true;
}

async function readLimitedBody(response, mode, maxBytes) {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw createHttpError('HTTP_BODY_TOO_LARGE', 'The upstream response was too large.', 413);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw createHttpError('HTTP_BODY_TOO_LARGE', 'The upstream response was too large.', 413);
    const text = Buffer.from(arrayBuffer).toString('utf8');
    if (mode === 'text') return text;
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        throw createHttpError('HTTP_INVALID_JSON', 'The upstream service returned invalid JSON.', 502);
    }
}

function isRetryableError(error) {
    return error?.code === 'HTTP_TIMEOUT'
        || error?.code === 'ECONNRESET'
        || error?.code === 'ENOTFOUND'
        || error?.code === 'EAI_AGAIN'
        || RETRYABLE_STATUS.has(Number(error?.statusCode));
}

function parseRetryAfter(value) {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 60_000)) : 0;
}

function backoffMs(attempt) {
    return Math.min(8_000, 400 * (2 ** Math.max(0, attempt - 1))) + Math.floor(Math.random() * 150);
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clampInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function createHttpError(code, message, statusCode = 502, upstreamBody = '') {
    const error = new Error(message);
    error.code = code;
    error.publicMessage = message;
    error.statusCode = statusCode;
    error.upstreamBody = upstreamBody;
    return error;
}

module.exports = {
    assertPublicHttpUrl,
    createHttpClient,
    isPrivateAddress
};
