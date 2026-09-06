'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createWorkflowService } = require('../workflows/service');

function createDatabase(products) {
    const calls = [];
    return {
        calls,
        async getOrCreateBusinessForUser() {
            return { id: '7', name: 'Verified Store', currency: 'USD', timezone: 'UTC', role: 'owner' };
        },
        async createWorkflowRun({ workflow, input, staleAfterSeconds, maxRunSeconds }) {
            calls.push(['create-run', workflow.slug, staleAfterSeconds, maxRunSeconds]);
            return {
                id: '101',
                business_id: '7',
                workflow_slug: workflow.slug,
                workflow_name: workflow.name,
                status: 'queued',
                input,
                records_analyzed: 0,
                progress_percentage: 0,
                created_at: new Date().toISOString(),
                steps: workflow.steps.map((step, index) => ({
                    step_key: step.key,
                    step_title: step.title,
                    step_order: index,
                    status: 'queued'
                }))
            };
        },
        async updateWorkflowRun(input) {
            calls.push(['run', input.status]);
            return {
                id: String(input.runId),
                business_id: '7',
                workflow_slug: 'inventory-predictor',
                workflow_name: 'Inventory Predictor',
                status: input.status,
                output: input.output || null,
                error_message: input.errorMessage || null,
                records_analyzed: input.recordsAnalyzed || 0,
                progress_percentage: input.progressPercentage || 0,
                current_step: input.currentStep || null,
                created_at: new Date().toISOString(),
                started_at: new Date().toISOString(),
                completed_at: ['completed', 'failed'].includes(input.status) ? new Date().toISOString() : null
            };
        },
        async updateWorkflowStep(input) {
            calls.push(['step', input.stepKey, input.status]);
            return input;
        },
        async updateWorkflowProgress(input) {
            calls.push(['progress', input.currentStep]);
            return input;
        },
        async appendWorkflowLog(input) {
            return { id: 1, ...input, created_at: new Date().toISOString() };
        },
        async touchWorkflowRun() {
            calls.push(['heartbeat']);
        },
        async getInventoryData() {
            return {
                business: { id: '7', name: 'Verified Store', currency: 'USD', timezone: 'UTC' },
                retrievedAt: new Date().toISOString(),
                products,
                recordsAnalyzed: products.length + 2
            };
        }
    };
}

const ai = {
    getPublicConfiguration() {
        return { isConfigured: true, model: 'test-model' };
    },
    async generateReply() {
        return {
            model: 'test-model',
            content: 'Prioritize only products marked high or critical risk.'
        };
    }
};

test('inventory predictor uses verified stock and order-item demand to produce a reorder quantity', async () => {
    const database = createDatabase([{
        product_id: '1',
        product_name: 'Real SKU',
        sku: 'REAL-1',
        current_stock: '4',
        lead_time_days: '5',
        reorder_buffer_days: '2',
        units_sold: '28',
        previous_units_sold: '14',
        order_records: 6
    }]);
    const service = createWorkflowService({ database, geminiService: ai, env: { WORKFLOW_STALE_RUN_SECONDS: '600' } });
    const result = await service.execute({ userId: '5', slug: 'inventory-predictor', input: {} });
    const forecast = result.output.calculatedMetrics[0];

    assert.equal(result.run.status, 'completed');
    assert.equal(forecast.productName, 'Real SKU');
    assert.equal(forecast.forecastDays, 7);
    assert.equal(forecast.recommendedReorderQuantity, 8);
    assert.equal(forecast.risk, 'critical');
    assert.deepEqual(
        database.calls.filter((call) => call[0] === 'run').map((call) => call[1]),
        ['running', 'completed']
    );
    assert.deepEqual(database.calls.find((call) => call[0] === 'create-run'), ['create-run', 'inventory-predictor', 600, 900]);
});

test('inventory predictor rejects stock-only records without real sales history', async () => {
    const database = createDatabase([{
        product_id: '1',
        product_name: 'Unsold SKU',
        current_stock: '10',
        lead_time_days: '5',
        reorder_buffer_days: '2',
        units_sold: '0',
        previous_units_sold: '0',
        order_records: 0
    }]);
    const service = createWorkflowService({ database, geminiService: ai, env: {} });

    await assert.rejects(
        () => service.execute({ userId: '5', slug: 'inventory-predictor', input: {} }),
        (error) => error.code === 'INSUFFICIENT_INVENTORY_HISTORY'
    );
    assert.deepEqual(
        database.calls.filter((call) => call[0] === 'run').map((call) => call[1]),
        ['running', 'failed']
    );
});

test('current workflow lease handling releases stale runs while keeping active-run protection', () => {
    const databaseSource = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'service.js'), 'utf8');

    assert.match(databaseSource, /staleAfterSeconds = 300/);
    assert.match(databaseSource, /maxRunSeconds = 900/);
    assert.match(databaseSource, /COALESCE\(heartbeat_at, updated_at, created_at\)/);
    assert.match(databaseSource, /COALESCE\(started_at, created_at\)/);
    assert.match(databaseSource, /workflow_runs_one_active_per_business/);
    assert.match(databaseSource, /conflict\.activeRunId/);
    assert.match(serviceSource, /WORKFLOW_MAX_RUN_SECONDS/);
    assert.match(serviceSource, /withWorkflowExecutionTimeout/);
    assert.match(serviceSource, /startWorkflowHeartbeat/);
    assert.match(serviceSource, /clearInterval\(heartbeat\)/);
});
