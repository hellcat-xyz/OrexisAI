'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(projectRoot, 'views', 'dashboard.js'), 'utf8');

test('AI Agent messages use the existing compact avatars without mounting robot artwork', () => {
    assert.doesNotMatch(appSource, /createAssistantRobot/);
    assert.doesNotMatch(appSource, /\/orexis-robot\//);
    assert.doesNotMatch(appSource, /orexis-assistant-robot/);
    assert.match(appSource, /isAssistant\s*\? '<i class="fa-solid fa-wand-magic-sparkles"/);
    assert.match(appSource, /: '<i class="fa-solid fa-user"/);
});

test('AI Agent layout does not contain a robot layer above the composer', () => {
    assert.doesNotMatch(dashboardSource, /agentWorkspaceRobotLayer/);
    assert.doesNotMatch(dashboardSource, /agent-workspace-robot-layer/);
});
