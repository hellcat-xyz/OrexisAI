'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    calculateInventoryForecast,
    growthPercentage,
    resolveComparablePeriod,
    safeDivide,
    startOfIsoWeek
} = require('../workflows/calculations');

test('workflow calculations handle division by zero and comparable growth correctly', () => {
    assert.equal(safeDivide(100, 4), 25);
    assert.equal(safeDivide(100, 0), null);
    assert.equal(safeDivide(null, 4), null);
    assert.equal(growthPercentage(120, 100), 20);
    assert.equal(growthPercentage(80, 100), -20);
    assert.equal(growthPercentage(80, 0), null);
});

test('current week periods use ISO Monday boundaries and an equal previous duration', () => {
    const now = new Date('2026-08-05T12:00:00.000Z');
    assert.equal(startOfIsoWeek(now).toISOString(), '2026-08-03T00:00:00.000Z');
    const period = resolveComparablePeriod({ now });
    assert.equal(period.current.from.toISOString(), '2026-08-03T00:00:00.000Z');
    assert.equal(period.current.to.toISOString(), now.toISOString());
    assert.equal(period.previous.to.toISOString(), period.current.from.toISOString());
    assert.equal(period.previous.to - period.previous.from, period.current.to - period.current.from);
});

test('inventory predictions never invent missing stock or reorder settings', () => {
    const missingStock = calculateInventoryForecast({
        product_id: '1',
        product_name: 'Example',
        current_stock: null,
        units_sold: '28',
        previous_units_sold: '14',
        lead_time_days: '7',
        reorder_buffer_days: '2'
    }, 28);
    assert.equal(missingStock.currentStock, null);
    assert.equal(missingStock.estimatedDaysOfStock, null);
    assert.equal(missingStock.reorderRecommendation, 'insufficient_data');

    const calculated = calculateInventoryForecast({
        product_id: '2',
        product_name: 'Verified product',
        current_stock: '5',
        units_sold: '28',
        previous_units_sold: '14',
        lead_time_days: '7',
        reorder_buffer_days: '2'
    }, 28);
    assert.equal(calculated.averageDailyDemand, 0.85);
    assert.equal(calculated.projectedDemand, 5.95);
    assert.ok(Math.abs(calculated.estimatedDaysOfStock - 5.882352941176471) < 1e-9);
    assert.ok(Math.abs(calculated.reorderPoint - 7.65) < 1e-9);
    assert.equal(calculated.recommendedReorderQuantity, 9);
    assert.equal(calculated.reorderRecommendation, 'reorder');
    assert.equal(calculated.risk, 'critical');
    assert.equal(calculated.demandTrendPercentage, 100);
});
