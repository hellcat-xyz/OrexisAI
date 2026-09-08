'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('review responder exposes data setup and saves real review records through the authenticated API', () => {
    assert.match(dashboard, /data-review-setup/);
    assert.match(app, /fetch\('\/api\/business\/reviews'/);
    assert.match(app, /skipReviewPreflight/);
    assert.match(app, /Save &amp; generate drafts/);
    assert.match(server, /pathname === '\/api\/business\/reviews'/);
    assert.match(server, /validateBusinessImportPayload\(\{ reviews \}\)/);
    assert.match(style, /\.review-setup-row/);
});

test('inventory predictor preflights data and can load the existing marked demo dataset before running', () => {
    assert.match(dashboard, /data-inventory-setup/);
    assert.match(app, /loadInventorySummary/);
    assert.match(app, /inventorySummaryCanRun/);
    assert.match(app, /\/api\/business\/inventory-data\/demo/);
    assert.match(app, /skipInventoryPreflight/);
    assert.match(app, /Load demo data &amp; run/);
    assert.match(app, /businessDataImport/);
});
