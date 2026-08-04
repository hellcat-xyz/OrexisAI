'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalyticsDemoPayload, DEMO_DATASET_VERSION } = require('../workflows/analytics-demo-data');
const { validateBusinessImportPayload } = require('../business-data');

test('analytics demo data is deterministic, realistic, marked, and accepted by the production importer', () => {
    const options = { businessId: 42, currency: 'USD', timezone: 'UTC', now: new Date('2026-08-04T00:00:00Z') };
    const first = validateBusinessImportPayload(createAnalyticsDemoPayload(options));
    const second = validateBusinessImportPayload(createAnalyticsDemoPayload(options));
    assert.equal(first.orders.length, second.orders.length);
    assert.equal(first.orders[0].externalId, second.orders[0].externalId);
    assert.ok(first.orders.length > 500);
    assert.ok(first.orderItems.length > first.orders.length);
    assert.equal(first.products.length, 12);
    assert.equal(first.trafficDailyMetrics.length, 720);
    assert.equal(first.orders.every((order) => order.metadata.orexis_demo === DEMO_DATASET_VERSION), true);
    assert.equal(first.products.every((product) => product.metadata.orexis_demo === DEMO_DATASET_VERSION), true);
    assert.ok(new Set(first.orders.map((order) => order.sourceName)).size >= 4);
    assert.ok(new Set(first.orders.map((order) => order.shippingCountryCode)).size >= 4);
});
