'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
const robotDirectory = path.join(projectRoot, 'public', 'orexis-robot');
const robotAssets = [
    'robot.png',
    'antenna.png',
    'head.png',
    'body.png',
    'arm-left.png',
    'arm-right.png',
    'leg-left.png',
    'leg-right.png'
];

test('assistant messages mount one articulated OrexisAI mascot while user messages keep the existing avatar', () => {
    assert.match(appSource, /function createAssistantRobot\(/);
    assert.match(appSource, /article\.append\(createAssistantRobot\(robotState, pending\), body\)/);
    assert.match(appSource, /avatar\.innerHTML = '<i class="fa-solid fa-user"/);
    assert.doesNotMatch(appSource, /\? '<i class="fa-solid fa-wand-magic-sparkles"/);
});

test('robot lifecycle follows thinking, speaking, celebration, idle, and error states without replacing the pending assistant node', () => {
    assert.match(appSource, /finalizeMessageArticle\(pendingReply, result\.assistantMessage, \{ animateAssistantResponse: true \}\)/);
    assert.match(appSource, /applyAssistantRobotState\(dock, 'celebrating'\)/);
    assert.match(appSource, /applyAssistantRobotState\(dock, 'idle'\)/);
    assert.match(appSource, /message\.transientError \? 'error' : animateAssistantResponse \? 'speaking' : 'idle'/);
    assert.match(appSource, /pending \? 'thinking' : 'idle'/);
});

test('robot animation is GPU-oriented, stateful, responsive, and reduced-motion safe', () => {
    assert.match(styleSource, /\.orexis-robot-stage[\s\S]*translate3d\(0, 0, 0\)/);
    assert.match(styleSource, /will-change: transform/);
    assert.match(styleSource, /data-robot-state="thinking"/);
    assert.match(styleSource, /data-robot-state="speaking"/);
    assert.match(styleSource, /data-robot-state="celebrating"/);
    assert.match(styleSource, /data-robot-arrival="true"/);
    assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.orexis-robot-fallback/);
});

test('exact mascot layers are shipped as local transparent PNG assets', () => {
    for (const asset of robotAssets) {
        const assetPath = path.join(robotDirectory, asset);
        const bytes = fs.readFileSync(assetPath);
        assert.ok(bytes.length > 1000, `${asset} should contain real image data`);
        assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    }
});
