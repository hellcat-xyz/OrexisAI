'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

function sourceBetween(startToken, endToken) {
    const start = app.indexOf(startToken);
    const end = app.indexOf(endToken, start + startToken.length);
    assert.ok(start >= 0, `Missing ${startToken}`);
    assert.ok(end > start, `Missing ${endToken}`);
    return app.slice(start, end);
}

test('weekly marketing v3 renders user-facing result components instead of raw JSON blocks', () => {
    const renderer = sourceBetween('function renderMarketingOperatingWorkflowOutput', 'function createMarketingPolishedSection');
    assert.doesNotMatch(renderer, /appendStructuredResultSection/);
    assert.doesNotMatch(renderer, /JSON\.stringify/);
    for (const helper of [
        'appendMarketingNarrativeSection',
        'appendMarketingFindings',
        'appendMarketingOpportunities',
        'appendMarketingCustomerStrategy',
        'appendMarketingProductStrategy',
        'appendMarketingNextActions',
        'appendMarketingProductPerformance',
        'appendMarketingCampaigns',
        'appendMarketingSeoPlan',
        'appendMarketingRecommendations'
    ]) assert.match(renderer, new RegExp(`${helper}\\(`));
});

test('weekly marketing hides internal evidence ids behind readable collapsible evidence labels', () => {
    assert.match(app, /details\.className = 'workflow-evidence-details'/);
    assert.match(app, /summary\.textContent = `Evidence · \$\{values\.length\}`/);
    assert.match(app, /if \(raw === 'business_identity'\) return 'Business profile'/);
    assert.match(app, /product:\s*'Product'/);
    assert.match(app, /segment:\s*'Customer segment'/);
});

test('weekly marketing polished cards are responsive and campaign content is presented as previews', () => {
    assert.match(css, /\.workflow-insight-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.workflow-campaign-preview\s*\{[\s\S]*?white-space:\s*pre-wrap;/);
    assert.match(css, /\.workflow-evidence-details\s*\{/);
    assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.workflow-insight-grid,[\s\S]*?grid-template-columns:\s*1fr;/);
});
