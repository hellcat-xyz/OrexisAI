'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalyticsExport, buildAnalyticsEmail } = require('../workflows/analytics-export');

const dashboard = {
    generatedAt: '2026-08-04T10:00:00Z',
    business: { name: 'Acme / Store', currency: 'USD' },
    period: { label: 'Jul 1 – Jul 31' },
    executive: { metrics: [{ key: 'revenue', label: 'Revenue', value: 123456, previousValue: 100000, changePercentage: 23.456, confidence: 92, unit: 'minor-currency', source: 'orders' }] },
    products: { top: [{ productName: 'Starter', revenueMinor: 70000, unitsSold: 20, orderCount: 18, revenueChangePercentage: 10 }] },
    inventory: { risks: [{ productName: 'Starter', currentStock: 2, daysOfCover: 3, stockRisk: 'critical', reorderPoint: 10, confidence: 90 }] },
    decisionEngine: { recommendations: [{ priority: 'high', title: 'Restock Starter', reason: 'Three days of cover remain.', confidence: 90, actionLabel: 'Run inventory', workflowSlug: 'inventory-predictor' }] },
    businessHealth: { score: 65, signals: [] },
    dataQuality: { checks: [] }
};

test('analytics exports produce downloadable CSV, Excel-compatible XML, and valid PDF bytes', () => {
    const csv = createAnalyticsExport({ format: 'csv', dashboard });
    assert.match(csv.contentType, /text\/csv/);
    assert.match(csv.body.toString('utf8'), /Revenue/);
    assert.match(csv.filename, /\.csv$/);

    const excel = createAnalyticsExport({ format: 'excel', dashboard });
    assert.match(excel.body.toString('utf8'), /<Workbook/);
    assert.match(excel.filename, /\.xls$/);

    const pdf = createAnalyticsExport({ format: 'pdf', dashboard });
    assert.equal(pdf.body.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(pdf.filename, /\.pdf$/);
});

test('analytics report email escapes business data and includes grounded actions', () => {
    const report = buildAnalyticsEmail({ ...dashboard, business: { name: '<Acme>', currency: 'USD' } });
    assert.match(report.subject, /analytics report/i);
    assert.match(report.text, /Restock Starter/);
    assert.doesNotMatch(report.html, /<Acme>/);
    assert.match(report.html, /&lt;Acme&gt;/);
});
