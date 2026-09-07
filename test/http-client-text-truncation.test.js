'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHttpClient } = require('../workflows/http-client');

test('HTTP client can safely keep a bounded HTML prefix when a public page is larger than the workflow parser limit', async () => {
    const prefix = '<!doctype html><html><head><title>Adidas</title><meta name="description" content="Public competitor page"></head><body>';
    const html = `${prefix}${'x'.repeat(8 * 1024)}</body></html>`;
    let requestHeaders = null;
    const client = createHttpClient({
        retries: 0,
        dnsLookup: async () => [{ address: '93.184.216.34' }],
        fetchImpl: async (_url, options) => {
            requestHeaders = options.headers;
            return new Response(html, {
                status: 200,
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'content-length': String(Buffer.byteLength(html, 'utf8'))
                }
            });
        }
    });

    const body = await client.text('https://competitor.example/', { maxBytes: 1024, truncate: true });
    assert.ok(Buffer.byteLength(body, 'utf8') <= 1024);
    assert.match(body, /<title>Adidas<\/title>/);
    assert.match(requestHeaders['User-Agent'], /OrexisAI-Workflow/);
});

test('HTTP client still rejects oversized non-truncated responses', async () => {
    const html = 'x'.repeat(4096);
    const client = createHttpClient({
        retries: 0,
        dnsLookup: async () => [{ address: '93.184.216.34' }],
        fetchImpl: async () => new Response(html, {
            status: 200,
            headers: { 'content-length': String(Buffer.byteLength(html, 'utf8')) }
        })
    });

    await assert.rejects(
        () => client.text('https://competitor.example/', { maxBytes: 1024 }),
        (error) => error?.code === 'HTTP_BODY_TOO_LARGE'
    );
});
