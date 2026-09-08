'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const databaseSource = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'service.js'), 'utf8');
const registrySource = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'registry.js'), 'utf8');

test('review draft persistence gives PostgreSQL explicit parameter types', () => {
    const start = databaseSource.indexOf('async function saveReviewDrafts');
    const end = databaseSource.indexOf('async function updateReviewResponse', start);
    const source = databaseSource.slice(start, end);
    assert.match(source, /response_draft = \$4::TEXT/);
    assert.match(source, /BTRIM\(\$4::TEXT\)/);
    assert.match(source, /id = \$1::BIGINT/);
    assert.match(source, /business_id = \$2::BIGINT/);
    assert.match(source, /external_id = \$3::VARCHAR\(160\)/);
});

test('review response updates cast status and response parameters consistently', () => {
    const start = databaseSource.indexOf('async function updateReviewResponse');
    const end = databaseSource.indexOf('async function getInventoryDataSummary', start);
    const source = databaseSource.slice(start, end);
    assert.match(source, /response_draft = \$3::TEXT/);
    assert.match(source, /response_status = \$4::VARCHAR\(32\)/);
    assert.match(source, /CASE WHEN \$4::VARCHAR\(32\) = 'sent'/);
});

test('review responder records draft persistence as an explicit workflow stage', () => {
    const serviceStart = serviceSource.indexOf('async function executeReviewResponder');
    const serviceEnd = serviceSource.indexOf('async function executeInventoryPredictor', serviceStart);
    const service = serviceSource.slice(serviceStart, serviceEnd);
    assert.match(service, /step\('save-response-drafts'/);

    const registryStart = registrySource.indexOf("'review-responder':");
    const registryEnd = registrySource.indexOf("'inventory-predictor':", registryStart);
    const registry = registrySource.slice(registryStart, registryEnd);
    assert.match(registry, /key: 'save-response-drafts'/);
});
