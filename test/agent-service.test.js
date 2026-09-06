'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    AGENT_SYSTEM_INSTRUCTION,
    createAgentService,
    executeReadOnlyTool,
    normalizeDateRange,
    normalizeFinancialValues,
    prepareToolResult
} = require('../agent/service');

test('agent service exposes read-only business tools and binds every tool to the authenticated user', async () => {
    const calls = [];
    const workflowService = {
        async getOverview(input) {
            calls.push({ name: 'overview', input });
            return {
                business: { id: 7, name: 'Test Store' },
                crm: { customers: [{ name: 'Alice Example', email: 'alice@example.com', lifetimeValueMinor: 12500 }] }
            };
        },
        async getMarketingWorkspace(input) { calls.push({ name: 'marketing', input }); return { ok: true }; },
        async getEnterpriseAnalytics(input) { calls.push({ name: 'analytics', input }); return { ok: true }; },
        async getInventoryDataSummary(input) { calls.push({ name: 'inventory', input }); return { ok: true }; }
    };
    let captured;
    const geminiService = {
        async generateAgentReply(messages, options) {
            captured = { messages, options };
            const result = await options.executeTool({
                name: 'get_business_overview',
                args: { from: '2026-09-01', to: '2026-09-06', userId: 999999 }
            });
            return { content: JSON.stringify(result), model: 'test-model', toolCalls: 1 };
        }
    };
    const service = createAgentService({ geminiService, workflowService, env: {} });
    const result = await service.generateReply({
        userId: 42,
        messages: [{ role: 'user', content: 'How is my business doing?' }]
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
        name: 'overview',
        input: { userId: 42, from: '2026-09-01', to: '2026-09-06' }
    });
    assert.equal(captured.options.toolDeclarations.some((tool) => tool.name === 'get_business_overview'), true);
    assert.equal(captured.options.toolDeclarations.some((tool) => JSON.stringify(tool).includes('userId')), false);
    assert.match(captured.options.instruction, /read-only tools/);
    assert.doesNotMatch(result.content, /alice@example\.com/);
    assert.doesNotMatch(result.content, /Alice Example/);
    assert.doesNotMatch(result.content, /\"email\"|\"name\":\"Alice/);
});

test('agent tool date ranges reject invalid model-generated arguments', () => {
    assert.deepEqual(normalizeDateRange({ from: '2026-09-01', to: '' }), { from: '2026-09-01', to: '' });
    assert.throws(
        () => normalizeDateRange({ from: 'definitely-not-a-date' }),
        (error) => error.code === 'AGENT_INVALID_TOOL_ARGUMENT' && error.statusCode === 400
    );
});

test('agent tool results are redacted and bounded before they reach Gemini', () => {
    const prepared = prepareToolResult({
        email: 'owner@example.com',
        token: 'super-secret-token-value',
        rows: Array.from({ length: 500 }, (_, index) => ({ index, description: 'x'.repeat(4000) }))
    }, 16 * 1024);
    const serialized = JSON.stringify(prepared);
    assert.doesNotMatch(serialized, /owner@example\.com/);
    assert.doesNotMatch(serialized, /super-secret-token-value/);
    assert.equal(prepared.truncated, true);
    assert.ok(Buffer.byteLength(serialized, 'utf8') < 32 * 1024);
});


test('agent financial grounding converts minor units deterministically before Gemini sees them', () => {
    const normalized = normalizeFinancialValues({
        business: { currency: 'INR' },
        marketing: { totalRevenueMinor: 399600, averageOrderValueMinor: 133200 },
        crm: { customers: [{ lifetimeValueMinor: 699600 }] }
    });

    assert.equal(normalized.convertedCount, 3);
    assert.equal(normalized.data.marketing.totalRevenueMinor, undefined);
    assert.equal(normalized.data.marketing.totalRevenueMinorUnits, 399600);
    assert.equal(normalized.data.marketing.totalRevenue, 3996);
    assert.equal(normalized.data.marketing.totalRevenueFormatted, '₹3,996.00');
    assert.equal(normalized.data.marketing.averageOrderValueFormatted, '₹1,332.00');
    assert.equal(normalized.data.crm.customers[0].lifetimeValueFormatted, '₹6,996.00');

    const metric = normalizeFinancialValues({
        business: { currency: 'INR' },
        metrics: { averageOrderValue: { value: 133200, previousValue: 249900, unit: 'minor-currency', sparkline: [99900, 199800] } }
    });
    assert.equal(metric.data.metrics.averageOrderValue.value, 1332);
    assert.equal(metric.data.metrics.averageOrderValue.valueFormatted, '₹1,332.00');
    assert.equal(metric.data.metrics.averageOrderValue.previousValue, 2499);
    assert.deepEqual(metric.data.metrics.averageOrderValue.sparkline, [999, 1998]);
    assert.equal(metric.data.metrics.averageOrderValue.sparklineUnit, 'major-currency');
});

test('agent financial grounding respects currency-specific fraction digits and labels raw units explicitly', () => {
    const prepared = prepareToolResult({
        business: { currency: 'JPY' },
        marketing: { totalRevenueMinor: 3996 }
    });

    assert.equal(prepared.data.marketing.totalRevenue, 3996);
    assert.match(prepared.data.marketing.totalRevenueFormatted, /3,996/);
    assert.equal(prepared.data.marketing.totalRevenueMinorUnits, 3996);
    assert.match(prepared.financialConvention, /never display or reinterpret/i);
    assert.match(AGENT_SYSTEM_INSTRUCTION, /\*Formatted/);
});

test('agent falls back to ordinary chat for older custom Gemini service implementations', async () => {
    let usedFallback = false;
    const service = createAgentService({
        geminiService: {
            async generateReply(messages) {
                usedFallback = true;
                return { content: messages.at(-1).content, model: 'legacy-test' };
            }
        },
        workflowService: {},
        env: {}
    });
    const result = await service.generateReply({
        userId: 1,
        messages: [{ role: 'user', content: 'hello' }]
    });
    assert.equal(usedFallback, true);
    assert.equal(result.content, 'hello');
    assert.match(AGENT_SYSTEM_INSTRUCTION, /source of truth/);
});

test('Agent V2 exposes granular analyst tools without exposing tenant selectors', () => {
    const service = createAgentService({
        geminiService: { async generateReply() { return { content: 'ok' }; } },
        workflowService: {},
        env: {}
    });
    const declarations = service.getToolDeclarations();
    const names = new Set(declarations.map((tool) => tool.name));
    for (const name of [
        'get_revenue_comparison',
        'get_sales_breakdown',
        'get_product_performance',
        'get_declining_products',
        'get_customer_retention',
        'get_inventory_risk',
        'get_campaign_performance'
    ]) {
        assert.equal(names.has(name), true, `${name} should be available`);
    }
    assert.equal(declarations.length, 11);
    assert.equal(declarations.some((tool) => JSON.stringify(tool).includes('userId')), false);
    assert.match(AGENT_SYSTEM_INSTRUCTION, /diagnose rather than merely summarize/i);
    assert.match(AGENT_SYSTEM_INSTRUCTION, /correlation as proven causation/i);
});

test('Agent V2 revenue comparison deterministically detects AOV pressure and product-mix decline', async () => {
    const calls = [];
    const workspace = agentV2WorkspaceFixture();
    const result = await executeReadOnlyTool({
        name: 'get_revenue_comparison',
        args: { from: '2026-08-31', to: '2026-09-06', userId: 999 },
        userId: 42,
        workflowService: {
            async getMarketingWorkspace(input) {
                calls.push(input);
                return workspace;
            }
        }
    });

    assert.deepEqual(calls, [{ userId: 42, from: '2026-08-31', to: '2026-09-06' }]);
    assert.equal(result.averageOrderValue.currentMinor, 133200);
    assert.equal(result.averageOrderValue.previousMinor, 424800);
    assert.ok(Math.abs(result.averageOrderValue.changePercentage - (-68.6441)) < 0.001);
    assert.equal(result.diagnosticSignals.some((signal) => signal.type === 'aov-pressure' && signal.strength === 'high'), true);
    assert.equal(result.productMovers.biggestDecliners[0].productName, 'Premium Hoodie');
    assert.equal(result.productMovers.biggestDecliners[0].revenueDeltaMinor, -749700);

    const prepared = prepareToolResult(result);
    assert.equal(prepared.data.revenue.currentFormatted, '₹3,996.00');
    assert.equal(prepared.data.averageOrderValue.currentFormatted, '₹1,332.00');
    assert.equal(prepared.data.productMovers.biggestDecliners[0].revenueDeltaFormatted, '-₹7,497.00');
});

test('Agent V2 product, retention, inventory, and campaign tools return compact deterministic slices', async () => {
    const workspace = agentV2WorkspaceFixture();
    const workflowService = { async getMarketingWorkspace() { return workspace; } };
    const context = { userId: 7, workflowService };

    const product = await executeReadOnlyTool({ ...context, name: 'get_product_performance', args: { productQuery: 'hoodie', limit: 5 } });
    assert.equal(product.matchCount, 1);
    assert.equal(product.products[0].productName, 'Premium Hoodie');
    assert.equal(product.products[0].revenueDeltaMinor, -749700);

    const retention = await executeReadOnlyTool({ ...context, name: 'get_customer_retention', args: {} });
    assert.equal(retention.repeatPurchaseRatePercentage, 66.67);
    assert.equal(retention.segments[0].segment, 'repeat');
    assert.equal(JSON.stringify(retention).includes('Alice'), false);

    const inventory = await executeReadOnlyTool({ ...context, name: 'get_inventory_risk', args: { limit: 3 } });
    assert.equal(inventory.atRiskProductCount, 1);
    assert.equal(inventory.risks[0].stockRisk, 'critical');
    assert.match(inventory.risks[0].recommendedAction, /immediately/i);

    const campaign = await executeReadOnlyTool({ ...context, name: 'get_campaign_performance', args: {} });
    assert.equal(campaign.campaignsAvailable, true);
    assert.equal(campaign.campaigns[0].campaignName, 'Weak Search');
    assert.equal(campaign.metricSignals.campaignReturnOnSpend.value, 0.6);
});

test('Agent V2 rejects invalid granular tool limits and oversized product searches', async () => {
    const workflowService = { async getMarketingWorkspace() { return agentV2WorkspaceFixture(); } };
    await assert.rejects(
        executeReadOnlyTool({ name: 'get_sales_breakdown', args: { limit: 99 }, userId: 1, workflowService }),
        (error) => error.code === 'AGENT_INVALID_TOOL_ARGUMENT'
    );
    await assert.rejects(
        executeReadOnlyTool({ name: 'get_product_performance', args: { productQuery: 'x'.repeat(121) }, userId: 1, workflowService }),
        (error) => error.code === 'AGENT_INVALID_TOOL_ARGUMENT'
    );
});

function agentV2WorkspaceFixture() {
    return {
        business: { id: 1, name: 'Nova Clothing', currency: 'INR', timezone: 'Asia/Kolkata' },
        dataPeriod: { from: '2026-08-31T00:00:00.000Z', to: '2026-09-06T23:59:59.999Z' },
        previousPeriod: { from: '2026-08-24T00:00:00.000Z', to: '2026-08-30T23:59:59.999Z' },
        recordsAnalyzed: 20,
        freshness: { orderRecords: 5, orderItemRecords: 7, customerRecords: 3, productRecords: 2, campaignRecords: 1 },
        metrics: {
            revenue: { value: 399600, previousValue: 849600, changePercentage: -52.9661, unit: 'minor-currency', available: true, sourceRecords: 3 },
            orders: { value: 3, previousValue: 2, changePercentage: 50, unit: 'count', available: true, sourceRecords: 3 },
            averageOrderValue: { value: 133200, unit: 'minor-currency', available: true, sourceRecords: 3 },
            newCustomers: { value: 1, unit: 'count', available: true },
            returningCustomers: { value: 2, unit: 'count', available: true },
            returningCustomerPercentage: { value: 66.6667, unit: 'percentage', available: true },
            repeatPurchaseRatePercentage: { value: 66.6667, unit: 'percentage', available: true },
            campaignReturnOnSpend: { value: 0.6, unit: 'ratio', available: true },
            customerAcquisitionCost: { value: 50000, unit: 'minor-currency', available: true },
            conversionRatePercentage: { value: 2.5, unit: 'percentage', available: true },
            profit: { value: 120000, unit: 'minor-currency', available: true }
        },
        trends: {
            daily: [{ date: '2026-09-01', revenueMinor: 199800, orders: 1 }, { date: '2026-09-05', revenueMinor: 199800, orders: 2 }],
            demandForecast: { available: true, points: [{ date: '2026-09-07', value: 2 }] }
        },
        products: {
            top: [
                { productId: 2, productName: 'Essential T-Shirt', sku: 'TSHIRT-001', unitsSold: 4, previousUnitsSold: 1, revenueMinor: 399600, previousRevenueMinor: 99900, revenueChangePercentage: 300, currentStock: 85, stockRisk: 'healthy' }
            ],
            declining: [
                { productId: 1, productName: 'Premium Hoodie', sku: 'HOODIE-001', unitsSold: 0, previousUnitsSold: 3, revenueMinor: 0, previousRevenueMinor: 749700, revenueChangePercentage: -100, currentStock: 8, daysOfCover: 2.5, reorderPoint: 12, stockRisk: 'critical' }
            ],
            all: [
                { productId: 1, productName: 'Premium Hoodie', sku: 'HOODIE-001', unitsSold: 0, previousUnitsSold: 3, revenueMinor: 0, previousRevenueMinor: 749700, revenueChangePercentage: -100, currentStock: 8, daysOfCover: 2.5, reorderPoint: 12, stockRisk: 'critical' },
                { productId: 2, productName: 'Essential T-Shirt', sku: 'TSHIRT-001', unitsSold: 4, previousUnitsSold: 1, revenueMinor: 399600, previousRevenueMinor: 99900, revenueChangePercentage: 300, currentStock: 85, stockRisk: 'healthy' }
            ],
            stockAlerts: [
                { productId: 1, productName: 'Premium Hoodie', sku: 'HOODIE-001', unitsSold: 0, previousUnitsSold: 3, revenueMinor: 0, previousRevenueMinor: 749700, revenueChangePercentage: -100, currentStock: 8, inventoryVelocity: 1.4, daysOfCover: 2.5, reorderPoint: 12, stockRisk: 'critical' }
            ]
        },
        customers: {
            totalCustomers: 3,
            purchasingCustomers: 3,
            repeatCustomers: 2,
            customerLifetimeRevenueMinor: 1249500,
            averageCustomerLifetimeValueMinor: 416500,
            newCustomerRecords: 1,
            activeCustomerRecords: 3,
            segments: [{ segment: 'repeat', customers: 2, revenueMinor: 999600, averageLifetimeValueMinor: 499800, sharePercentage: 66.67 }]
        },
        campaigns: {
            totals: { records: 1, spendMinor: 100000, attributedRevenueMinor: 60000, roas: 0.6 },
            rows: [{ campaignName: 'Weak Search', sourceName: 'Google Ads', spendMinor: 100000, attributedRevenueMinor: 60000, impressions: 10000, clicks: 300, visitors: 200, conversions: 5, roas: 0.6, ctrPercentage: 3, conversionRatePercentage: 2.5, cacMinor: 20000 }]
        },
        categories: [{ categoryName: 'T-Shirts', revenueMinor: 399600, unitsSold: 4 }],
        trafficSources: [{ sourceName: 'Instagram', revenueMinor: 299700, sessions: 100 }],
        geography: [{ countryCode: 'IN', revenueMinor: 399600, orders: 3 }],
        coupons: [{ couponCode: 'WELCOME', revenueMinor: 99900, orders: 1 }],
        funnel: { sessions: 200, purchases: 5, conversionRatePercentage: 2.5 },
        limitations: ['More campaign history improves ROAS confidence.', 'Supplier lead-time data is incomplete.']
    };
}
