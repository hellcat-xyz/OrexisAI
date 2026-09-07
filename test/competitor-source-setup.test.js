'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderDashboardPage } = require('../views/dashboard');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function render() {
    return renderDashboardPage({
        user: { email: 'owner@example.com', displayName: 'Owner', initials: 'O' },
        plans: [{ id: 'free', name: 'Free', tagline: 'Free', usdCents: 0, inrPaise: 0, features: ['Core workflows'], featured: false }],
        billing: { currentPlanId: 'free', planExpiresAt: null },
        paymentConfiguration: {
            razorpay: { keyId: '', isConfigured: false },
            paypal: { clientId: '', isConfigured: false, mode: 'sandbox' }
        },
        cspNonce: 'test-nonce'
    });
}

test('competitor audit exposes an in-product source configuration entry point and preflight', () => {
    const html = render();
    assert.match(html, /data-competitor-setup/);
    assert.match(html, /Configure competitor sources/);
    assert.match(appSource, /loadCompetitorSources/);
    assert.match(appSource, /slug === 'competitor-audit'/);
    assert.match(appSource, /Save &amp; run audit/);
    assert.match(appSource, /COMPETITOR_INTEGRATION_REQUIRED/);
});

test('competitor source API lists tenant-bound configuration and saves only validated competitor records', () => {
    assert.match(serverSource, /pathname === '\/api\/business\/competitors'/);
    assert.match(serverSource, /route\.type === 'competitor-sources' && req\.method === 'GET'/);
    assert.match(serverSource, /getCompetitorAuditData\(\{/);
    assert.match(serverSource, /route\.type === 'competitor-sources' && req\.method === 'POST'/);
    assert.match(serverSource, /assertSameOrigin\(req\)/);
    assert.match(serverSource, /validateBusinessImportPayload\(\{ competitors \}\)/);
    assert.match(appSource, /fetch\('\/api\/business\/competitors'/);
});
