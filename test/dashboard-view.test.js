'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renderDashboardPage } = require('../views/dashboard');

function render(overrides = {}) {
    return renderDashboardPage({
        user: {
            email: 'owner@example.com',
            displayName: 'Demo Owner',
            initials: 'DO'
        },
        plans: [
            {
                id: 'free',
                name: 'Free',
                tagline: 'Try core outcomes',
                usdCents: 0,
                inrPaise: 0,
                features: ['2 workflows'],
                featured: false
            },
            {
                id: 'pro',
                name: 'Pro',
                tagline: 'Run more outcomes',
                usdCents: 2900,
                inrPaise: 249900,
                features: ['Unlimited workflows'],
                featured: true
            }
        ],
        billing: { currentPlanId: 'free', planExpiresAt: null },
        paymentConfiguration: {
            razorpay: { keyId: '', isConfigured: false },
            paypal: { clientId: '', isConfigured: false, mode: 'sandbox' }
        },
        cspNonce: 'test-nonce',
        ...overrides
    });
}

test('dashboard renders functional workspace navigation and profile settings entry', () => {
    const html = render();

    for (const view of ['hub', 'marketing', 'analytics', 'crm', 'settings']) {
        assert.match(html, new RegExp(`data-view="${view}"`));
    }
    for (const navTarget of ['hub', 'marketing', 'analytics', 'crm']) {
        assert.match(html, new RegExp(`data-view-target="${navTarget}"`));
    }

    assert.match(html, /id="sidebarToggle"/);
    assert.match(html, /id="profileButton"/);
    assert.match(html, /id="profileMenu"/);
    assert.match(html, /data-view-target="settings"/);
    assert.match(html, /id="workspaceSettingsForm"/);
    assert.match(html, /id="settingsUpgradeButton"/);
    assert.doesNotMatch(html, /class="nav-item"[^>]*data-view-target="settings"/);
});

test('dashboard includes outcome-based content in each business workspace', () => {
    const html = render();

    assert.match(html, /Workflow-as-a-Service/);
    assert.match(html, /Run this week’s marketing/);
    assert.match(html, /Analytics &amp; Decisions|Analytics workspace/);
    assert.match(html, /Priority customers/);
    assert.match(html, /data-workflow="social-pack"/);
    assert.match(html, /data-workflow="analytics-report"/);
    assert.match(html, /data-workflow="crm-followups"/);
});

test('dashboard escapes profile values in the sidebar and settings view', () => {
    const html = render({
        user: {
            email: 'owner+test@example.com',
            displayName: '<script>alert(1)</script>',
            initials: '<>'
        }
    });

    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;&gt;/);
});
