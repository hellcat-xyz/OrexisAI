'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getWorkflow, listWorkflows } = require('../workflows/registry');

test('workflow registry exposes the three first OutcomeAI workflows', () => {
    const workflows = listWorkflows();

    assert.deepEqual(
        workflows.map((workflow) => workflow.slug),
        ['social-pack', 'competitor-watch', 'win-back']
    );

    for (const workflow of workflows) {
        assert.ok(workflow.name);
        assert.ok(workflow.description);
        assert.ok(workflow.resultView);
        assert.ok(Array.isArray(workflow.steps));
        assert.ok(workflow.steps.length > 0);
        assert.equal(new Set(workflow.steps.map((step) => step.key)).size, workflow.steps.length);
    }
});

test('getWorkflow safely resolves known slugs and rejects unknown values', () => {
    assert.equal(getWorkflow(' social-pack ').name, 'Social Content Pack');
    assert.equal(getWorkflow('WIN-BACK').name, 'Customer Win-Back');
    assert.equal(getWorkflow('does-not-exist'), null);
    assert.equal(getWorkflow(null), null);
});

test('database schema includes user-owned workflow runs and cascading step records', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');

    assert.match(schema, /CREATE TABLE IF NOT EXISTS workflow_runs/);
    assert.match(schema, /user_id BIGINT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(schema, /workflow_slug VARCHAR\(80\) NOT NULL/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS workflow_step_runs/);
    assert.match(schema, /run_id BIGINT NOT NULL REFERENCES workflow_runs\(id\) ON DELETE CASCADE/);
    assert.match(schema, /workflow_step_runs_order_unique UNIQUE \(run_id, step_order\)/);
    assert.match(schema, /workflow_step_runs_key_unique UNIQUE \(run_id, step_key\)/);
});
