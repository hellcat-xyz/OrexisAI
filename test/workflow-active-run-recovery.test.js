'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const databaseSource = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
const schemaSource = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

test('workflow leases use independent heartbeat and absolute runtime limits', () => {
    assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ/);
    assert.match(schemaSource, /workflow_runs_active_heartbeat_index/);
    assert.match(databaseSource, /Execution heartbeat expired before completion/);
    assert.match(databaseSource, /Execution exceeded the maximum allowed runtime/);
    assert.match(databaseSource, /finalizeActiveWorkflowSteps/);
    assert.match(databaseSource, /AND status IN \('queued', 'running'\)/);
});

test('an existing active run is returned to the browser instead of being shown as a failed duplicate', () => {
    assert.match(databaseSource, /conflict\.activeRunId/);
    assert.match(serverSource, /type: 'active-run'/);
    assert.match(serverSource, /serializeWorkflowRunForApi\(activeRun\)/);
    assert.match(appSource, /resumeActiveWorkflowRun/);
    assert.match(appSource, /pollActiveWorkflowRun/);
    assert.match(appSource, /Reconnected to the active run/);
});

test('closing the workflow dialog no longer aborts a server-side run that continues in the background', () => {
    const start = appSource.indexOf('function closeWorkflowModal()');
    const end = appSource.indexOf('function setButtonsBusy', start);
    const closeFunction = appSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(closeFunction, /activeController\?\.abort/);
    assert.match(appSource, /if \(activeController \|\| activeRunPollTimer\)/);
    assert.match(appSource, /View Running…/);
});

test('polling an orphaned run also performs stale-run recovery', () => {
    const start = databaseSource.indexOf('async function getWorkflowRun');
    const end = databaseSource.indexOf('async function listWorkflowRuns', start);
    const getRunSource = databaseSource.slice(start, end);
    assert.match(getRunSource, /UPDATE workflow_runs/);
    assert.match(getRunSource, /heartbeat_at/);
    assert.match(getRunSource, /finalizeActiveWorkflowSteps/);
});
