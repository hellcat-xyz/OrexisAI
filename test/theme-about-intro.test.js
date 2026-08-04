'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderDashboardPage } = require('../views/dashboard');

const projectRoot = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
const orbSource = fs.readFileSync(path.join(projectRoot, 'public', 'orb.js'), 'utf8');

function render() {
    return renderDashboardPage({
        user: { email: 'owner@example.com', displayName: 'Demo Owner', initials: 'DO' },
        plans: [{ id: 'free', name: 'Free', tagline: 'Core access', usdCents: 0, inrPaise: 0, features: ['Core'], featured: false }],
        billing: { currentPlanId: 'free', planExpiresAt: null },
        paymentConfiguration: {
            razorpay: { keyId: '', isConfigured: false },
            paypal: { clientId: '', isConfigured: false, mode: 'sandbox' }
        },
        aiConfiguration: { isConfigured: true, model: 'gemini-3.6-flash' },
        cspNonce: 'theme-test'
    });
}

test('top bar renders the persistent theme control and places About OrexisAI directly before workspace search', () => {
    const html = render();

    assert.match(html, /id="themeToggleButton"/);
    assert.match(html, /id="aboutOrexisButton"[\s\S]*id="workspaceSearch"/);
    assert.match(html, /localStorage\.getItem\('outcomeai\.workspaceSettings'\)/);
    assert.match(html, /nonce="theme-test"/);
});

test('AI Agent header keeps Gemini status and removes the PostgreSQL badge', () => {
    const html = render();

    assert.match(html, /class="gemini-status-badge connected"/);
    assert.match(html, /Gemini · gemini-3\.6-flash/);
    assert.doesNotMatch(html, /class="database-saved-badge"/);
    assert.doesNotMatch(styleSource, /\.database-saved-badge\s*\{/);
});

test('theme switching persists, synchronizes settings, and updates the Orb background without rebuilding chat', () => {
    assert.match(appSource, /function initializeThemeToggle\(/);
    assert.match(appSource, /JSON\.stringify\(\{ \.\.\.settings, theme: nextTheme \}\)/);
    assert.match(appSource, /document\.dispatchEvent\(new CustomEvent\('outcomeai:theme-changed'/);
    assert.match(orbSource, /function getOrbBackgroundColor\(/);
    assert.match(orbSource, /theme === 'light'/);
    assert.match(orbSource, /outcomeai:theme-changed/);

    const finalLightChatRule = styleSource.lastIndexOf('html[data-theme="light"] .agent-chat-shell');
    assert.ok(finalLightChatRule >= 0);
    assert.match(styleSource.slice(finalLightChatRule, finalLightChatRule + 240), /background: #f8fafc/);
    assert.match(styleSource, /html\[data-theme="light"\] \.agent-message-content pre/);
    assert.match(styleSource, /html\[data-theme="light"\] \.agent-command-composer/);
});

test('About OrexisAI opens an accessible cinematic sequence and returns focus safely', () => {
    const html = render();

    assert.match(html, /id="orexisIntro"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /id="orexisIntroClose"/);
    assert.match(html, /class="orexis-intro-orb"/);
    assert.match(appSource, /'Hello, you!'/);
    assert.match(appSource, /'I’m OrexisAI\.'/);
    assert.match(appSource, /'Your intelligent AI agent\.'/);
    assert.match(appSource, /'Let’s get things done together\.'/);
    assert.match(appSource, /appContainer\.setAttribute\('inert', ''\)/);
    assert.match(appSource, /returnFocus\?\.focus/);
    assert.match(styleSource, /@keyframes orexis-intro-orb-float/);
    assert.match(styleSource, /@keyframes orexis-intro-particle/);
});

test('sidebar icon hover motion remains transform-driven and reduced-motion safe', () => {
    assert.match(styleSource, /\.sidebar \.nav-item:hover \.nav-icon[\s\S]*translate3d\(0, -1\.5px, 0\) scale\(1\.055\)/);
    assert.match(styleSource, /\.sidebar \.nav-item:active[\s\S]*scale\(0\.985\)/);
    assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.orexis-intro-orb/);
});
