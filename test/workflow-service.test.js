'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createWorkflowService } = require('../workflows/service');
const { getWorkflow } = require('../workflows/registry');

function createMockDatabase(overrides = {}) {
    const calls = [];
    const workflow = getWorkflow('weekly-marketing');
    const database = {
        calls,
        async getOrCreateBusinessForUser() {
            return { id: '7', name: 'Verified Business', currency: 'USD', timezone: 'UTC', role: 'owner' };
        },
        async createWorkflowRun({ businessId, workflow: definition, input }) {
            calls.push(['create-run', businessId, definition.slug, input]);
            return {
                id: '99',
                business_id: businessId,
                workflow_slug: definition.slug,
                workflow_name: definition.name,
                status: 'queued',
                input,
                records_analyzed: 0,
                created_at: '2026-08-03T10:00:00Z',
                steps: definition.steps.map((step, order) => ({
                    step_key: step.key,
                    step_title: step.title,
                    step_order: order,
                    status: 'queued'
                }))
            };
        },
        async updateWorkflowRun(input) {
            calls.push(['update-run', input.status]);
            return {
                id: String(input.runId),
                business_id: String(input.businessId || 7),
                workflow_slug: workflow.slug,
                workflow_name: workflow.name,
                status: input.status,
                output: input.output || null,
                error_message: input.errorMessage || null,
                data_period_start: input.periodStart || null,
                data_period_end: input.periodEnd || null,
                data_retrieved_at: input.dataRetrievedAt || null,
                records_analyzed: input.recordsAnalyzed || 0,
                duration_ms: input.durationMs ?? null,
                created_at: '2026-08-03T10:00:00Z',
                started_at: '2026-08-03T10:00:00Z',
                completed_at: input.status === 'completed' ? '2026-08-03T10:00:01Z' : null
            };
        },
        async updateWorkflowStep(input) {
            calls.push(['step', input.stepKey, input.status]);
            return input;
        },
        async getWeeklyMarketingData() {
            return {
                business: { id: '7', name: 'Verified Business', currency: 'USD', timezone: 'UTC' },
                retrievedAt: '2026-08-03T10:00:00Z',
                current: { total_orders: 2, total_revenue_minor: '5000', unique_customers: 2 },
                previous: { total_orders: 1, total_revenue_minor: '2000', unique_customers: 1 },
                topProducts: [{ product_id: '1', product_name: 'Real Product', sku: 'RP', units_sold: '3', revenue_minor: '5000', order_count: 2 }],
                daily: [{ day: '2026-08-03', orders: 2, revenue_minor: '5000' }],
                customerTrend: { new_customers: 1, active_customers: 2, previous_new_customers: 1 },
                campaign: { records: 0, spend_minor: '0', attributed_revenue_minor: '0', impressions: '0', clicks: '0', visitors: '0', leads: '0', conversions: '0', retrieved_at: null },
                recordCounts: { order_records: 2, item_records: 1, campaign_records: 0 }
            };
        },
        ...overrides
    };
    return database;
}

const unconfiguredAi = {
    getPublicConfiguration() { return { isConfigured: false, model: 'gemini-2.5-flash' }; },
    async generateReply() { throw new Error('should not be called'); }
};

test('weekly marketing executes real backend steps, persists the run, and separates facts from calculations', async () => {
    const database = createMockDatabase();
    const events = [];
    const service = createWorkflowService({ database, geminiService: unconfiguredAi });
    const result = await service.execute({
        userId: '5',
        slug: 'weekly-marketing',
        input: { from: '2026-08-03', to: '2026-08-03' },
        onEvent: (event) => events.push(event)
    });

    assert.equal(result.run.status, 'completed');
    assert.equal(result.output.factualResults.totalRevenueMinor, 5000);
    assert.equal(result.output.calculatedMetrics.averageOrderValueMinor, 2500);
    assert.equal(result.output.calculatedMetrics.revenueGrowthPercentage, 150);
    assert.equal(result.output.aiInsights.status, 'unavailable');
    assert.equal(result.output.recordsAnalyzed, 3);
    assert.ok(events.some((event) => event.type === 'step' && event.stepKey === 'fetch-business-data' && event.status === 'running'));
    assert.ok(events.some((event) => event.type === 'completed'));
    assert.deepEqual(database.calls.filter((call) => call[0] === 'update-run').map((call) => call[1]), ['running', 'completed']);
});

test('weekly marketing fails without valid orders instead of fabricating output', async () => {
    const database = createMockDatabase({
        async getWeeklyMarketingData() {
            const data = await createMockDatabase().getWeeklyMarketingData();
            data.current.total_orders = 0;
            data.current.total_revenue_minor = '0';
            data.recordCounts.order_records = 0;
            return data;
        }
    });
    const events = [];
    const service = createWorkflowService({ database, geminiService: unconfiguredAi });

    await assert.rejects(
        () => service.execute({ userId: '5', slug: 'weekly-marketing', input: {}, onEvent: (event) => events.push(event) }),
        /No valid paid, completed, or fulfilled orders/
    );
    assert.ok(events.some((event) => event.type === 'failed' && event.code === 'INSUFFICIENT_SALES_DATA'));
    assert.ok(database.calls.some((call) => call[0] === 'update-run' && call[1] === 'failed'));
});

test('server and client expose authenticated streamed workflow APIs without simulated random timers', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    assert.match(server, /application\/x-ndjson/);
    assert.match(server, /validateBusinessImportPayload/);
    assert.match(server, /\/api\/business\/overview/);
    assert.match(server, /assertSameOrigin\(req\)/);
    assert.match(app, /readNdjsonResponse/);
    assert.match(app, /Fetching fresh data from the authenticated business account/);
    assert.doesNotMatch(app, /Math\.random\(\) \* 350/);
});
