'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

test('AI insight output renders markdown structure instead of exposing raw markdown tokens', () => {
    assert.match(app, /function renderInsightMarkdown\(container, markdown\)/);
    assert.match(app, /function appendInsightInline\(parent, value\)/);
    assert.match(app, /renderInsightMarkdown\(content, ai\.content\)/);
    assert.doesNotMatch(app, /content\.textContent\s*=\s*ai\.content/);
    assert.match(app, /document\.createElement\('strong'\)/);
    assert.match(app, /document\.createElement\(listType\)/);
    assert.match(app, /document\.createElement\(heading\[1\]\.length <= 2 \? 'h5' : 'h6'\)/);
});

test('AI insight markdown styling provides readable headings, lists, emphasis and code', () => {
    assert.match(style, /\.ai-output-content \.ai-insight-heading/);
    assert.match(style, /\.ai-output-content \.ai-insight-list/);
    assert.match(style, /\.ai-output-content strong/);
    assert.match(style, /\.ai-output-content code/);
    assert.match(style, /overflow-wrap:\s*anywhere/);
});
