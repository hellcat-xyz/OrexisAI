'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('workflow modal is constrained to the viewport and scrolls the execution timeline internally', () => {
    assert.match(css, /#executionModal\s*\{[\s\S]*?inset:\s*0;[\s\S]*?overflow:\s*hidden;/);
    assert.match(css, /#executionModal \.modal-content\s*\{[\s\S]*?display:\s*flex;[\s\S]*?max-height:\s*calc\(100dvh - 20px\);[\s\S]*?overflow:\s*hidden;/);
    assert.match(css, /#executionModal \.execution-steps\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/);
});

test('workflow result keeps its actions visible while only the result body scrolls', () => {
    assert.match(css, /#executionModal \.execution-result:not\(\.hidden\)\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow:\s*hidden;/);
    assert.match(css, /#executionModal \.workflow-result-body\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*auto;/);
    assert.match(css, /#executionModal \.workflow-result-actions\s*\{[\s\S]*?flex:\s*0 0 auto;/);
});
