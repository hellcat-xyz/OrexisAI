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

    for (const view of ['hub', 'agent', 'marketing', 'analytics', 'crm', 'settings']) {
        assert.match(html, new RegExp(`data-view="${view}"`));
    }
    for (const navTarget of ['hub', 'agent', 'marketing', 'analytics', 'crm']) {
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
    assert.match(html, /Run Weekly Marketing/);
    assert.match(html, /Analytics &amp; Decisions|Analytics workspace/);
    assert.match(html, /Priority customers/);
    assert.match(html, /data-workflow="weekly-marketing"/);
    assert.match(html, /data-workflow="competitor-audit"/);
    assert.match(html, /data-workflow="review-responder"/);
    assert.match(html, /data-workflow="inventory-predictor"/);
    assert.match(html, /id="analyticsDateForm"/);
    assert.match(html, /id="marketingLiveMetricsGrid"/);
    assert.match(html, /id="crmCustomerTable"/);
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

test('settings include searchable user and site customization controls', () => {
    const html = render();

    assert.match(html, /id="settingsSearchResults"/);
    assert.match(html, /id="settingsSearchResultsList"/);
    assert.match(html, /data-setting-title="Theme"/);
    assert.match(html, /data-setting-title="Accent color"/);
    assert.match(html, /name="displayName"/);
    assert.match(html, /name="timezone"/);
    assert.match(html, /name="density"/);
    assert.match(html, /name="browserNotifications"/);
    assert.match(html, /name="personalizedRecommendations"/);
    assert.match(html, /id="resetSettingsButton"/);
    assert.match(html, /id="clearLocalDataButton"/);
});


test('settings expose an account-backed business profile editor for AI grounding', () => {
    const html = render();

    assert.match(html, /id="settings-business-profile"/);
    assert.match(html, /id="businessProfileName"/);
    assert.match(html, /id="businessProfileIndustry"/);
    assert.match(html, /id="businessProfileCurrency"/);
    assert.match(html, /id="businessProfileTimezone"/);
    assert.match(html, /id="businessProfileProducts"/);
    assert.match(html, /id="businessProfileAudience"/);
    assert.match(html, /id="businessProfileBrandVoice"/);
    assert.match(html, /id="businessProfileGoals"/);
    assert.match(html, /id="businessProfileSaveButton"/);
});


test('login logo reveal renders only when requested by the authenticated session', () => {
    const normalHtml = render();
    const loginHtml = render({ showLoginIntro: true });

    assert.doesNotMatch(normalHtml, /id="loginBrandIntro"/);
    assert.match(loginHtml, /id="loginBrandIntro"/);
    assert.match(loginHtml, /Welcome to OrexisAI/);
    assert.match(loginHtml, /class="outcome-brand-o">O<\/span>/);
    assert.match(loginHtml, /outcome-brand-word">rexis/);
    assert.match(loginHtml, /id="loginBrandSkip"/);
});

test('sidebar uses the persistent OrexisAI O lockup', () => {
    const html = render();

    assert.match(html, /class="logo outcome-brand-lockup"/);
    assert.match(html, /class="outcome-brand-o"[^>]*>O<\/span>/);
    assert.match(html, /class="outcome-brand-ai">AI<\/span>/);
    assert.doesNotMatch(html, /fa-layer-group/);
});


test('hub hero mounts the official ReactBits Hyperspeed preset-three component', () => {
    const html = render();

    assert.match(html, /id="outcomeHyperspeed"/);
    assert.match(html, /href="\/hyperspeed\.css"/);
    assert.match(html, /src="\/hyperspeed\.js"/);
    assert.doesNotMatch(html, /class="hyperspeed-canvas"/);
});


test('AI agent mounts the official ReactBits Orb with unchanged defaults', () => {
    const html = render();

    assert.match(html, /id="outcomeAgentOrb"/);
    assert.match(html, /href="\/orb\.css"/);
    assert.match(html, /src="\/orb\.js"/);
});


test('Orb runtime is shipped with the app and does not depend on a postinstall download', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const packageJson = require('../package.json');
    const orbRuntime = fs.readFileSync(path.join(__dirname, '..', 'public', 'orb.js'), 'utf8');

    assert.equal(packageJson.scripts['build:orb'], undefined);
    assert.equal(packageJson.dependencies.ogl, undefined);
    assert.match(orbRuntime, /const hue = 0;/);
    assert.match(orbRuntime, /const hoverIntensity = 0\.2;/);
    assert.match(orbRuntime, /baseColor1 = vec3\(0\.611765, 0\.262745, 0\.996078\)/);
    assert.match(orbRuntime, /data-orb-ready|orbReady/);
});


test('sidebar renders animated semantic SVG icons and shared active-state layers', () => {
    const html = render();

    assert.match(html, /class="nav-active-pill"/);
    assert.match(html, /class="nav-active-indicator"/);
    for (const icon of ['hub', 'agent', 'marketing', 'analytics', 'crm']) {
        assert.match(html, new RegExp(`class="nav-icon nav-icon-${icon}"`));
    }
    assert.doesNotMatch(html, /fa-border-all|fa-message" aria-hidden="true"><\/i>\s*<span class="nav-label">AI Agent/);
});


test('hub weekly marketing uses the canonical production workflow and exposes the v3 result renderer', () => {
    const html = render();
    const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'app.js'), 'utf8');

    assert.match(html, /Run weekly marketing[\s\S]*data-workflow="weekly-marketing"|data-workflow="weekly-marketing"[\s\S]*Run weekly marketing/i);
    assert.match(html, /26-stage operating workflow/);
    assert.doesNotMatch(html, /data-workflow="marketing"/);
    assert.match(app, /renderMarketingOperatingWorkflowOutput/);
    assert.match(app, /output\.aiReasoning\?\.executiveSummary/);
    assert.match(app, /output\.generatedImages/);
    assert.match(app, /output\.reports \|\| output\.growthPlan\?\.reports/);
});

test('weekly marketing launchers use one canonical run button contract', () => {
    const html = render();
    assert.match(html, /id="marketingRunBtn"[^>]*data-workflow="weekly-marketing"/);
    assert.match(html, /marketing-run-button run-btn/);
});
