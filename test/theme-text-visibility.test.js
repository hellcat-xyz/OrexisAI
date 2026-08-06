'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderLoginPage } = require('../views/login');
const { renderRegisterPage } = require('../views/register');
const { renderForgotPasswordPage } = require('../views/password-recovery');

const projectRoot = path.join(__dirname, '..');
const styleSource = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
const loginStyleSource = fs.readFileSync(path.join(projectRoot, 'public', 'login.css'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(projectRoot, 'public', 'theme-bootstrap.js'), 'utf8');

function luminance(hex) {
    const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
    const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (bright + 0.05) / (dark + 0.05);
}

function executeBootstrap(settingsValue) {
    const document = { documentElement: { dataset: {}, style: {} } };
    const window = {
        localStorage: {
            getItem(key) {
                assert.equal(key, 'outcomeai.workspaceSettings');
                return settingsValue;
            }
        }
    };

    vm.runInNewContext(bootstrapSource, { document, window });
    return document.documentElement;
}

test('semantic foreground tokens provide readable dark and light palettes', () => {
    const requiredTokens = [
        '--text-primary',
        '--text-heading',
        '--text-secondary',
        '--text-button',
        '--text-button-muted',
        '--text-muted',
        '--text-placeholder',
        '--text-disabled',
        '--text-accent',
        '--text-link',
        '--text-success',
        '--text-warning',
        '--text-danger',
        '--text-info',
        '--text-on-accent',
        '--icon-primary',
        '--icon-secondary',
        '--icon-muted',
        '--interactive-surface',
        '--interactive-hover-surface',
        '--interactive-hover-border',
        '--accent-badge-surface',
        '--chart-track',
        '--chart-point-outline'
    ];

    for (const token of requiredTokens) {
        assert.match(styleSource, new RegExp(`${token.replaceAll('-', '\\-')}\\s*:`));
    }

    assert.ok(contrast('#f3f4f6', '#0d0f14') >= 7);
    assert.ok(contrast('#cbd5e1', '#0d0f14') >= 4.5);
    assert.ok(contrast('#9ca3af', '#0d0f14') >= 4.5);
    assert.ok(contrast('#152033', '#f4f7fb') >= 7);
    assert.ok(contrast('#0f172a', '#f4f7fb') >= 7);
    assert.ok(contrast('#475569', '#f4f7fb') >= 4.5);
    assert.ok(contrast('#5f6f85', '#f4f7fb') >= 4.5);
    assert.ok(contrast('#5b21b6', '#ffffff') >= 7);
    assert.ok(contrast('#047857', '#ffffff') >= 4.5);
    assert.ok(contrast('#a16207', '#ffffff') >= 4.5);
    assert.ok(contrast('#b91c1c', '#ffffff') >= 4.5);
    assert.ok(contrast('#1d4ed8', '#ffffff') >= 4.5);
});

test('forms, placeholders, disabled controls, icons, chat, marketing, and analytics inherit semantic colors', () => {
    assert.match(styleSource, /input::placeholder,[\s\S]*color: var\(--text-placeholder\)/);
    assert.match(styleSource, /button:disabled,[\s\S]*color: var\(--text-disabled\)/);
    assert.match(styleSource, /svg,[\s\S]*color: inherit/);
    assert.match(styleSource, /\.agent-message-content\s*\{[\s\S]*color: var\(--text-secondary\)/);
    assert.match(styleSource, /\.marketing-kpi-card strong \{ color: var\(--text-primary\)/);
    assert.match(styleSource, /\.enterprise-kpi-card > strong[\s\S]*color: var\(--text-main\)/);
    assert.match(styleSource, /\.enterprise-tabs button[^\n]*color: var\(--text-accent\)/);
    assert.match(loginStyleSource, /\.form-error[\s\S]*color: var\(--text-danger\)/);
    assert.match(loginStyleSource, /\.form-success[\s\S]*color: var\(--text-success\)/);
    assert.match(loginStyleSource, /\.auth-submit-btn[\s\S]*color: var\(--text-on-accent\)/);
});

test('OrexisAI wordmark uses the active theme foreground and stays light on dark intro overlays', () => {
    assert.match(styleSource, /\.outcome-brand-lockup \{[\s\S]*--brand-word-color: var\(--text-primary\)/);
    assert.match(styleSource, /\.outcome-brand-word \{[\s\S]*color: var\(--brand-word-color\)/);
    assert.match(styleSource, /\.login-brand-intro,[\s\S]*\.orexis-intro \{[\s\S]*--brand-word-color: var\(--text-on-dark\)/);
    assert.ok(contrast('#152033', '#ffffff') >= 7);
    assert.ok(contrast('#f8fafc', '#090b10') >= 7);
});

test('cinematic overlays keep an explicit light foreground even while the site is in light mode', () => {
    assert.match(styleSource, /\.login-brand-intro,[\s\S]*\.orexis-intro \{[\s\S]*--text-primary: var\(--text-on-dark\)/);
    assert.match(styleSource, /\.login-brand-intro \.outcome-brand-word \{[\s\S]*color: var\(--brand-word-color\)/);
    assert.match(styleSource, /\.orexis-intro \.orexis-intro-message,[\s\S]*color: inherit/);
    assert.match(styleSource, /\.orexis-intro \.orexis-intro-close[\s\S]*color: var\(--text-on-dark-muted\)/);
});

test('authentication routes bootstrap the saved theme before styles are loaded', () => {
    for (const html of [renderLoginPage(), renderRegisterPage(), renderForgotPasswordPage()]) {
        const scriptIndex = html.indexOf('<script src="/theme-bootstrap.js"></script>');
        const styleIndex = html.indexOf('<link rel="stylesheet" href="/style.css">');
        assert.ok(scriptIndex > 0);
        assert.ok(styleIndex > scriptIndex);
    }

    const light = executeBootstrap('{"theme":"light"}');
    assert.equal(light.dataset.theme, 'light');
    assert.equal(light.style.colorScheme, 'light');

    const midnight = executeBootstrap('{"theme":"midnight"}');
    assert.equal(midnight.dataset.theme, 'midnight');
    assert.equal(midnight.style.colorScheme, 'dark');

    const invalid = executeBootstrap('{broken');
    assert.equal(invalid.dataset.theme, 'dark');
    assert.equal(invalid.style.colorScheme, 'dark');
});

test('light theme supplies readable OAuth, select, sidebar, AI chat, and enterprise foreground states', () => {
    assert.match(styleSource, /html\[data-theme="light"\] \.oauth-button \{[\s\S]*color: var\(--text-primary\)/);
    assert.match(styleSource, /html\[data-theme="light"\] select option,[\s\S]*color: var\(--text-primary\)/);
    assert.match(styleSource, /html\[data-theme="light"\] \.agent-message-content,[\s\S]*color: var\(--text-primary\)/);
    assert.match(styleSource, /html\[data-theme="light"\] \.nav-item:not\(\.active\),[\s\S]*color: var\(--icon-secondary\)/);
    assert.match(styleSource, /html\[data-theme="light"\] \.enterprise-filter-fields select[^\n]*color: var\(--text-primary\)/);
});


test('interactive, selected, disabled, placeholder, and chart states use theme-aware semantic foregrounds', () => {
    assert.match(styleSource, /\.upgrade-nav-item:hover\s*\{[\s\S]*color: var\(--text-primary\)/);
    assert.match(styleSource, /\.upgrade-pill\s*\{[\s\S]*background: var\(--accent-badge-surface\)[\s\S]*color: var\(--text-accent\)/);
    assert.match(styleSource, /\.profile-menu-item:hover\s*\{[\s\S]*background: var\(--interactive-hover-surface\)[\s\S]*color: var\(--text-primary\)/);
    assert.match(styleSource, /\.integration-connect-btn:hover\s*\{[\s\S]*border-color: var\(--interactive-hover-border\)[\s\S]*color: var\(--text-primary\)/);
    assert.match(styleSource, /\.auth-submit-btn:disabled,[\s\S]*\.agent-send-button:disabled,[\s\S]*color: var\(--text-on-accent\)/);
    assert.match(loginStyleSource, /\.input-wrapper input::placeholder\s*\{[\s\S]*color: var\(--text-placeholder\)[\s\S]*opacity: 1/);
    assert.match(loginStyleSource, /\.forgot-link\s*\{[\s\S]*color: var\(--text-link\)/);
    assert.match(loginStyleSource, /\.auth-footer a\s*\{[\s\S]*color: var\(--text-link\)/);
    assert.match(styleSource, /\.enterprise-health-orbit \.health-track \{ stroke: var\(--chart-track\); \}/);
    assert.match(styleSource, /\.enterprise-line-chart \.chart-point \{[^\n]*stroke: var\(--chart-point-outline\)/);
});

test('text and icon accents use the contrast-safe semantic accent instead of the raw background accent', () => {
    const semanticSelectors = [
        '.nav-item.active',
        '.step.active .step-icon',
        '.search-empty-state i',
        '.settings-result-count',
        '.settings-search-result > i',
        '.settings-search-result-copy small',
        '.outcome-brand-ai',
        '.new-chat-button > i',
        '.chat-history-item.active > i'
    ];

    for (const selector of semanticSelectors) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(styleSource, new RegExp(`${escaped}[\\s\\S]*?color: var\\(--text-accent\\)`));
    }
});

test('ordinary cards, modals, menus, tables, and the AI workspace inherit the active primary foreground', () => {
    assert.match(styleSource, /\/\* Every ordinary surface inherits the active semantic foreground palette\. \*\/[\s\S]*\.sidebar,[\s\S]*\.modal-content,[\s\S]*\.agent-chat-shell,[\s\S]*\.settings-card,[\s\S]*table \{[\s\S]*color: var\(--text-primary\)/);
    assert.match(styleSource, /html\[data-theme="light"\] \{[\s\S]*--text-heading: #0f172a[\s\S]*--interactive-hover-surface: rgba\(15, 23, 42, 0\.065\)/);
});


test('fixed dark hero keeps light semantic text while the surrounding light theme stays dark-on-light', () => {
    assert.match(styleSource, /\.outcome-hero \{[\s\S]*--text-main: var\(--text-on-dark\)[\s\S]*--text-heading: var\(--text-on-dark\)[\s\S]*--text-secondary: var\(--text-on-dark-secondary\)[\s\S]*color: var\(--text-on-dark\)/);
    assert.match(styleSource, /\.outcome-hero h2 \{[\s\S]*font-size:/);
    assert.match(styleSource, /\.outcome-hero p \{[\s\S]*color: var\(--text-secondary\)/);
    assert.match(styleSource, /\.route-node \{[\s\S]*color: var\(--text-secondary\)/);
    assert.ok(contrast('#f8fafc', '#05060c') >= 7);
    assert.ok(contrast('#cbd5e1', '#05060c') >= 4.5);
});
