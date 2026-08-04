'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createWorkflowService } = require('../workflows/service');
const { getWorkflow } = require('../workflows/registry');

function marketingRows(profile, periods, empty = false) {
    return {
        business: profile,
        retrievedAt: '2026-08-03T10:00:00Z',
        periods,
        summary: empty ? [] : [
            { period_key: 'current', orders: 2, revenue_minor: '5000', purchasing_customers: 2, new_customers: 1, returning_customers: 1, profit_minor: '2000', profit_item_records: 1 },
            { period_key: 'previous', orders: 1, revenue_minor: '2000', purchasing_customers: 1, new_customers: 1, returning_customers: 0, profit_minor: '700', profit_item_records: 1 },
            { period_key: 'year_ago', orders: 1, revenue_minor: '1800', purchasing_customers: 1, new_customers: 1, returning_customers: 0, profit_minor: '600', profit_item_records: 1 }
        ],
        standardComparisons: empty ? [] : [
            { period_key: 'today_current', from_at: '2026-08-03T00:00:00Z', to_at: '2026-08-04T00:00:00Z', orders: 2, revenue_minor: '5000', purchasing_customers: 2, profit_minor: '2000', profit_item_records: 1 },
            { period_key: 'today_previous', from_at: '2026-08-02T00:00:00Z', to_at: '2026-08-03T00:00:00Z', orders: 1, revenue_minor: '2000', purchasing_customers: 1, profit_minor: '700', profit_item_records: 1 },
            { period_key: 'week_current', from_at: '2026-08-03T00:00:00Z', to_at: '2026-08-04T00:00:00Z', orders: 2, revenue_minor: '5000', purchasing_customers: 2, profit_minor: '2000', profit_item_records: 1 },
            { period_key: 'week_previous', from_at: '2026-07-27T00:00:00Z', to_at: '2026-07-28T00:00:00Z', orders: 1, revenue_minor: '2000', purchasing_customers: 1, profit_minor: '700', profit_item_records: 1 },
            { period_key: 'month_current', from_at: '2026-08-01T00:00:00Z', to_at: '2026-08-04T00:00:00Z', orders: 2, revenue_minor: '5000', purchasing_customers: 2, profit_minor: '2000', profit_item_records: 1 },
            { period_key: 'month_previous', from_at: '2026-07-29T00:00:00Z', to_at: '2026-08-01T00:00:00Z', orders: 1, revenue_minor: '2000', purchasing_customers: 1, profit_minor: '700', profit_item_records: 1 },
            { period_key: 'quarter_current', from_at: '2026-07-01T00:00:00Z', to_at: '2026-08-04T00:00:00Z', orders: 2, revenue_minor: '5000', purchasing_customers: 2, profit_minor: '2000', profit_item_records: 1 },
            { period_key: 'quarter_previous', from_at: '2026-05-28T00:00:00Z', to_at: '2026-07-01T00:00:00Z', orders: 1, revenue_minor: '2000', purchasing_customers: 1, profit_minor: '700', profit_item_records: 1 },
            { period_key: 'year_current', from_at: '2026-01-01T00:00:00Z', to_at: '2026-08-04T00:00:00Z', orders: 2, revenue_minor: '5000', purchasing_customers: 2, profit_minor: '2000', profit_item_records: 1 },
            { period_key: 'year_ago', from_at: '2025-01-01T00:00:00Z', to_at: '2025-08-04T00:00:00Z', orders: 1, revenue_minor: '1800', purchasing_customers: 1, profit_minor: '600', profit_item_records: 1 }
        ],
        daily: empty ? [] : [{ day: '2026-08-03', orders: 2, customers: 2, revenue_minor: '5000', units: '3', profit_minor: '2000' }],
        products: empty ? [] : [{ product_id: 1, product_name: 'Real Product', sku: 'RP', category_name: 'Storage', price_minor: '2000', cost_minor: '1000', current_stock: '20', lead_time_days: '3', reorder_buffer_days: '2', units_sold: '3', revenue_minor: '5000', previous_units_sold: '1', previous_revenue_minor: '2000', profit_minor: '2000', order_count: 2, last_sold_at: '2026-08-03T09:00:00Z' }],
        categories: empty ? [] : [{ category_name: 'Storage', products: 1, units_sold: '3', revenue_minor: '5000', profit_minor: '2000', orders: 2 }],
        customers: empty ? {} : { total_customers: 2, purchasing_customers: 2, repeat_customers: 1, customer_lifetime_revenue_minor: '7000', average_customer_lifetime_value_minor: '3500', new_customer_records: 1, active_customer_records: 2 },
        customerSegments: empty ? [] : [{ segment: 'repeat-buyer', customers: 1, revenue_minor: '4000', average_lifetime_value_minor: '4000' }, { segment: 'new-buyer', customers: 1, revenue_minor: '3000', average_lifetime_value_minor: '3000' }],
        campaigns: empty ? [] : [{ campaign_name: 'Search', source_name: 'google', spend_minor: '1000', attributed_revenue_minor: '3000', impressions: '10000', clicks: '500', visitors: '400', leads: '40', conversions: '10', retrieved_at: '2026-08-03T09:00:00Z' }],
        trafficSources: empty ? [] : [{ source_name: 'google', medium_name: 'cpc', sessions: '500', users: '450', new_users: '300', product_views: '350', add_to_carts: '80', checkout_starts: '40', purchases: '10', revenue_minor: '3000', retrieved_at: '2026-08-03T09:00:00Z' }],
        carts: empty ? {} : { carts: 20, abandoned_carts: 8, converted_carts: 12, abandoned_value_minor: '12000', recovered_value_minor: '3000' },
        geography: empty ? [] : [{ country_code: 'US', orders: 2, customers: 2, revenue_minor: '5000' }],
        coupons: empty ? [] : [{ coupon_code: 'WELCOME', orders: 1, customers: 1, revenue_minor: '2000' }],
        inventory: empty ? [] : [{ product_id: 1, product_name: 'Real Product', sku: 'RP', category_name: 'Storage', current_stock: '20', lead_time_days: '3', reorder_buffer_days: '2', units_sold: '3', order_records: 2 }],
        freshness: empty ? { order_records: 0, order_item_records: 0, customer_records: 0, product_records: 0, campaign_records: 0, traffic_records: 0, cart_records: 0, competitor_records: 0 }
            : { order_records: 2, order_item_records: 1, customer_records: 2, product_records: 1, campaign_records: 1, traffic_records: 1, cart_records: 20, competitor_records: 0, orders_updated_at: '2026-08-03T10:00:00Z' }
    };
}

function createMockDatabase({ empty = false } = {}) {
    const calls = [];
    const artifacts = [];
    let artifactId = 10;
    let campaignId = 100;
    const workflow = getWorkflow('weekly-marketing');
    const profile = {
        id: '7', name: 'Verified Business', business_type: 'Retail', industry: 'Home goods',
        products_services: ['Storage products'], website_url: null, location: {}, country_code: null,
        latitude: null, longitude: null, target_audience: 'Urban renters', brand_voice: 'Practical',
        social_media_accounts: {}, marketing_goals: ['Increase qualified weekly sales'], google_place_id: null,
        currency: 'USD', timezone: 'UTC', role: 'owner'
    };
    return {
        calls,
        async getOrCreateBusinessForUser() { return profile; },
        async createWorkflowRun({ businessId, workflow: definition, input }) {
            calls.push(['create-run', businessId, definition.slug, input]);
            return { id: '99', business_id: businessId, workflow_slug: definition.slug, workflow_name: definition.name, status: 'queued', input, records_analyzed: 0, progress_percentage: 0, created_at: '2026-08-03T10:00:00Z', steps: definition.steps.map((step, order) => ({ step_key: step.key, step_title: step.title, step_order: order, status: 'queued' })) };
        },
        async updateWorkflowRun(input) {
            calls.push(['update-run', input.status]);
            return { id: String(input.runId), business_id: '7', workflow_slug: workflow.slug, workflow_name: workflow.name, status: input.status, output: input.output || null, error_message: input.errorMessage || null, data_period_start: input.periodStart || null, data_period_end: input.periodEnd || null, data_retrieved_at: input.dataRetrievedAt || null, records_analyzed: input.recordsAnalyzed || 0, duration_ms: input.durationMs ?? null, progress_percentage: input.progressPercentage || 0, current_step: input.currentStep || null, estimated_completion_at: input.estimatedCompletionAt || null, created_at: '2026-08-03T10:00:00Z', started_at: '2026-08-03T10:00:00Z', completed_at: input.status === 'completed' ? '2026-08-03T10:00:01Z' : null };
        },
        async updateWorkflowStep(input) { calls.push(['step', input.stepKey, input.status]); return input; },
        async updateWorkflowProgress(input) { calls.push(['progress', input.percentage, input.currentStep]); return input; },
        async appendWorkflowLog(input) { calls.push(['log', input.level, input.message]); return { id: calls.length, ...input, created_at: new Date().toISOString() }; },
        async getMarketingWorkspaceCache() { return null; },
        async saveMarketingWorkspaceCache(input) { calls.push(['cache', input.cacheKey]); return input; },
        async getMarketingWorkspaceData({ periods }) { return marketingRows(profile, periods, empty); },
        async getWeeklyMarketingContext() { return { business: profile, competitors: [], reviews: [], retrievedAt: '2026-08-03T10:00:00Z' }; },
        async saveWorkflowSourceSnapshots({ snapshots }) { calls.push(['sources', snapshots.length]); return snapshots; },
        async saveCompetitorLiveSnapshots() { return []; },
        async saveWorkflowAiExecution(input) { calls.push(['ai-audit', input.contextHash]); return { id: 1 }; },
        async saveMarketingCampaignAssets({ campaigns }) {
            return campaigns.map((campaign) => ({ id: String(campaignId++), run_id: '99', channel: campaign.channel, title: campaign.title, content: campaign.content, rationale: campaign.rationale, verified_facts: campaign.verifiedFacts, status: 'draft', created_at: new Date().toISOString() }));
        },
        async saveWorkflowArtifact(input) {
            const binary = input.binary ? Buffer.from(input.binary) : Buffer.from(input.contentText || '');
            const row = { id: String(artifactId++), run_id: '99', section_key: input.sectionKey, artifact_type: input.artifactType, title: input.title, filename: input.filename, mime_type: input.mimeType, metadata: input.metadata || {}, sha256: 'a'.repeat(64), size_bytes: binary.length, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            artifacts.push(row);
            return row;
        },
        async listWorkflowArtifacts() { return artifacts; }
    };
}

function createMockAi() {
    const channels = ['email', 'whatsapp', 'instagram', 'facebook', 'google-ads', 'seo', 'landing-page', 'pricing', 'growth'];
    const contentFor = (channel) => {
        if (channel === 'email') return { subject: 'Verified Business product update', previewText: 'Learn about Real Product.', body: 'Real Product is available from Verified Business.', cta: 'View Real Product' };
        if (channel === 'whatsapp') return { message: 'Explore Real Product from Verified Business. Reply STOP to opt out.' };
        if (channel === 'google-ads') return { headlines: ['Verified Business Real Product'], descriptions: ['Explore Real Product from Verified Business.'], landingPageIntent: 'Real Product detail page' };
        return { copy: `Promote Real Product for Verified Business on ${channel}.` };
    };
    return {
        getPublicConfiguration() { return { isConfigured: true, model: 'test-model' }; },
        async generateJson() {
            return {
                model: 'test-model',
                data: {
                    executiveSummary: 'Verified Business should prioritize Real Product using verified sales and inventory data.',
                    findings: [{ title: 'Real Product leads sales', severity: 'high', evidence: ['product_real-product_1'], implication: 'Use it as the primary campaign subject.' }],
                    opportunities: [{ title: 'Scale proven product messaging', priority: 'high', rationale: 'The product has verified orders.', evidence: ['product_real-product_1'], action: 'Build channel-specific drafts around Real Product.', expectedOutcome: 'Improve qualified campaign focus.' }],
                    customerStrategy: [{ segment: 'repeat-buyer', goal: 'Increase repeat purchases for Verified Business', offerApproach: 'Product education', channel: 'email', evidence: ['segment_repeat-buyer'] }],
                    productStrategy: [{ productName: 'Real Product', action: 'Feature practical benefits', pricingRecommendation: 'Keep the current verified price while measuring conversion.', discountRecommendation: 'Use the existing WELCOME coupon only where valid.', inventoryConstraint: null, evidence: ['product_real-product_1'] }],
                    campaignPlan: channels.map((channel) => ({ channel, title: `Verified Business ${channel} campaign`, content: contentFor(channel), rationale: 'Based on verified product sales.', verifiedFacts: ['product_real-product_1'], status: 'draft' })),
                    seoPlan: { keywords: [{ keyword: 'real product storage', intent: 'commercial', targetPage: '/products/real-product', evidence: ['product_real-product_1'] }], blogIdeas: [{ title: 'How to use Real Product', angle: 'Practical storage guidance', evidence: ['business_identity'] }], landingPageImprovements: [{ section: 'Hero', change: 'Feature Real Product benefits.', reason: 'It is the verified top seller.', evidence: ['product_real-product_1'] }] },
                    nextActions: [{ order: 1, action: 'Review and approve the email draft.', ownerRole: 'Marketing manager', dependency: null, successMetric: 'Attributed conversions' }],
                    dataLimitations: ['No configured competitor source returned data.']
                }
            };
        }
    };
}

test('weekly marketing runs the production operating workflow, persists audits and streams all stages', async () => {
    const database = createMockDatabase();
    const events = [];
    const service = createWorkflowService({ database, geminiService: createMockAi(), env: {} });
    const result = await service.execute({ userId: '5', slug: 'weekly-marketing', input: { from: '2026-08-03', to: '2026-08-03' }, onEvent: (event) => events.push(event) });

    assert.equal(result.run.status, 'completed');
    assert.equal(result.output.internalPerformance.factualResults.totalRevenueMinor, 5000);
    assert.equal(result.output.internalPerformance.calculatedMetrics.averageOrderValue.value, 2500);
    assert.match(result.output.aiReasoning.executiveSummary, /Verified Business/);
    assert.equal(result.output.campaigns.all.length, 9);
    assert.equal(result.output.growthPlan.reports.length, 2);
    assert.ok(database.calls.some((call) => call[0] === 'ai-audit'));
    assert.ok(events.some((event) => event.type === 'progress' && event.currentStep === 'collect-database-data'));
    assert.ok(events.some((event) => event.type === 'step' && event.stepKey === 'assemble-growth-plan'));
    assert.ok(events.some((event) => event.type === 'completed'));
    assert.deepEqual(database.calls.filter((call) => call[0] === 'update-run').map((call) => call[1]), ['running', 'completed']);
});

test('weekly marketing rejects an empty source dataset instead of fabricating metrics', async () => {
    const database = createMockDatabase({ empty: true });
    const service = createWorkflowService({ database, geminiService: createMockAi(), env: {} });
    await assert.rejects(() => service.execute({ userId: '5', slug: 'weekly-marketing', input: {} }), (error) => {
        assert.equal(error.code, 'MARKETING_DATA_REQUIRED');
        return true;
    });
    assert.equal(database.calls.some((call) => call[0] === 'ai-audit'), false);
});

test('server and client expose authenticated streamed marketing APIs without simulated random timers', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'marketing-workspace.js'), 'utf8');
    assert.match(server, /application\/x-ndjson/);
    assert.match(server, /marketing-workspace/);
    assert.match(server, /marketing-events/);
    assert.match(server, /retry-run/);
    assert.match(server, /assertSameOrigin\(req\)/);
    assert.match(app, /streamNdjson/);
    assert.match(app, /marketingProgressBar/);
    assert.match(app, /EventSource|subscribe/);
    assert.doesNotMatch(app, /Math\.random/);
});
