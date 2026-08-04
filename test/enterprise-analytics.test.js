'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnterpriseDashboard, normalizeEnterpriseFilters } = require('../workflows/enterprise-analytics');

function metric(value, sourceRecords = 40) {
    return { value, sourceRecords, available: value !== null };
}

test('enterprise analytics builds grounded decisions, confidence, forecasts, and useful empty-state metadata', () => {
    const base = {
        business: { id: 7, name: 'Acme', currency: 'USD', timezone: 'UTC' },
        dataPeriod: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
        previousPeriod: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
        recordsAnalyzed: 180,
        metrics: {
            returningCustomerPercentage: metric(18),
            conversionRatePercentage: metric(1.5),
            profit: metric(122000),
            profitMarginPercentage: metric(24),
            customerLifetimeValue: metric(24500),
            repeatPurchaseRatePercentage: metric(17),
            marketingRoiPercentage: metric(-8)
        },
        products: {
            all: [{ productId: 1, productName: 'Starter Kit', currentStock: 4, reorderPoint: 12, daysOfCover: 3, stockRisk: 'critical', inventoryVelocity: 2, unitsSold: 30, revenueMinor: 120000 }],
            demandForecast: { available: true }
        },
        categories: [],
        trafficSources: [{ sourceName: 'Google Ads', sessions: 100 }],
        campaigns: { rows: [{ campaignName: 'Search', sourceName: 'Google Ads', spendMinor: 50000, attributedRevenueMinor: 35000, visitors: 100, roas: 0.7 }], totals: {} },
        funnel: { available: true, sessions: 1000, productViews: 550, addToCarts: 110, checkoutStarts: 70, purchases: 15 },
        customers: { segments: [] },
        geography: [],
        opportunities: [],
        trends: { revenueForecast: { available: true, confidence: 0.82, points: [{ date: '2026-08-01', value: 5000 }] } },
        freshness: { orderRecords: 40, orderItemRecords: 55, customerRecords: 35, productRecords: 1, trafficRecords: 31, campaignRecords: 31, cartRecords: 20, ordersUpdatedAt: '2026-08-01T12:00:00Z' },
        limitations: []
    };
    const raw = {
        business: base.business,
        summary: [
            { period_key: 'current', orders: 40, revenue_minor: 300000, gross_revenue_minor: 315000, refunds_minor: 15000, purchasing_customers: 31, new_customers: 18, returning_customers: 13, units: 55, profit_minor: 122000 },
            { period_key: 'previous', orders: 52, revenue_minor: 390000, gross_revenue_minor: 400000, refunds_minor: 10000, purchasing_customers: 42, new_customers: 25, returning_customers: 17, units: 70, profit_minor: 160000 },
            { period_key: 'year_ago', orders: 20, revenue_minor: 130000, gross_revenue_minor: 132000, refunds_minor: 2000, purchasing_customers: 18, units: 24 }
        ],
        daily: Array.from({ length: 14 }, (_, index) => ({ day: `2026-07-${String(index + 1).padStart(2, '0')}`, orders: 2 + index % 3, customers: 2, units: 3, gross_revenue_minor: 22000, refunds_minor: index === 5 ? 5000 : 0, revenue_minor: index === 5 ? 17000 : 22000, profit_minor: 9000 })),
        previousDaily: [], hourly: [], weekday: [],
        refunds: { orders: 40, refunded_orders: 3, gross_revenue_minor: 315000, refunded_amount_minor: 15000, previous_gross_revenue_minor: 400000, previous_refunded_amount_minor: 10000 },
        channelPerformance: [{ channel: 'Google Ads', orders: 20, customers: 18, revenue_minor: 150000, refunds_minor: 1000 }],
        customerAnalytics: { purchasing_customers: 31, repeat_customers: 6, average_lifetime_value_minor: 24500, retained_customers: 4, eligible_previous_customers: 20, churn_risk_customers: 5 },
        customerTimeline: [], cohorts: [],
        productPerformance: [{ product_id: 1, product_name: 'Starter Kit', category_name: 'Core', units_sold: 30, revenue_minor: 120000, previous_revenue_minor: 150000, profit_minor: 50000, order_count: 25, current_stock: 4, stock_risk: 'critical' }],
        categoryPerformance: [{ category_name: 'Core', products: 1, units_sold: 30, revenue_minor: 120000, profit_minor: 50000, orders: 25 }],
        cashFlowDaily: [],
        filterOptions: { channels: [{ value: 'Google Ads', label: 'Google Ads', records: 20 }], locations: [] },
        dataQuality: { filtered_order_records: 40, total_order_records: 40 },
        demoState: { demo_order_records: 0, real_order_records: 40 }
    };

    const dashboard = buildEnterpriseDashboard({ base, raw, filters: { compare: 'previous-period' } });
    assert.equal(dashboard.trustworthy, true);
    assert.equal(dashboard.decisionEngine.grounded, true);
    assert.ok(dashboard.executive.metrics.length >= 10);
    assert.ok(dashboard.decisionEngine.recommendations.some((item) => item.id === 'recover-revenue'));
    assert.ok(dashboard.decisionEngine.recommendations.some((item) => item.id === 'restock-risk'));
    assert.equal(dashboard.revenue.forecast.available, true);
    assert.equal(dashboard.products.top[0].productName, 'Starter Kit');
    assert.equal(dashboard.onboarding.realDataPresent, true);
    assert.doesNotMatch(JSON.stringify(dashboard), /Insufficient data/i);
});

test('enterprise filters are allowlisted and normalize location without accepting arbitrary control values', () => {
    assert.deepEqual(normalizeEnterpriseFilters({ compare: 'invalid', businessHours: 'overnight', channel: '  Email  ', location: 'in' }), {
        compare: 'previous-period', businessHours: 'all', channel: 'Email', location: 'IN'
    });
});
