'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getWorkflow, listWorkflows } = require('../workflows/registry');

test('workflow registry exposes the four production business workflows', () => {
    const workflows = listWorkflows();

    assert.deepEqual(
        workflows.map((workflow) => workflow.slug),
        ['weekly-marketing', 'competitor-audit', 'review-responder', 'inventory-predictor']
    );

    for (const workflow of workflows) {
        assert.ok(workflow.name);
        assert.ok(workflow.description);
        assert.ok(workflow.resultView);
        assert.ok(Array.isArray(workflow.steps));
        assert.ok(workflow.steps.length >= 5);
        assert.equal(new Set(workflow.steps.map((step) => step.key)).size, workflow.steps.length);
        assert.equal(workflow.steps.at(-1).key, 'save-result');
    }
});

test('getWorkflow resolves canonical and legacy UI slugs without broadening unknown values', () => {
    assert.equal(getWorkflow(' weekly-marketing ').name, 'Weekly Marketing');
    assert.equal(getWorkflow('MARKETING').slug, 'weekly-marketing');
    assert.equal(getWorkflow('audit').slug, 'competitor-audit');
    assert.equal(getWorkflow('reviews').slug, 'review-responder');
    assert.equal(getWorkflow('inventory').slug, 'inventory-predictor');
    assert.equal(getWorkflow('does-not-exist'), null);
    assert.equal(getWorkflow(null), null);
});

test('database schema includes tenant data, sourced records, and persisted workflow execution metadata', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');

    assert.match(schema, /CREATE TABLE IF NOT EXISTS businesses/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_memberships/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_customers/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_products/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_orders/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_order_items/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_campaign_daily_metrics/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_reviews/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_competitors/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS business_competitor_snapshots/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS workflow_runs/);
    assert.match(schema, /business_id BIGINT REFERENCES businesses\(id\) ON DELETE SET NULL/);
    assert.match(schema, /records_analyzed INTEGER NOT NULL DEFAULT 0/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS workflow_step_runs/);
    assert.match(schema, /workflow_step_runs_order_unique UNIQUE \(run_id, step_order\)/);
});
