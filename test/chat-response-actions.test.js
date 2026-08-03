'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadForDatabaseTests(request, parent, isMain) {
    if (request === 'pg') return { Pool: class Pool {} };
    return originalLoad.call(this, request, parent, isMain);
};
const { createUserStore } = require('../database');
Module._load = originalLoad;

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('AI responses keep Copy and expose branch, download, and share actions', () => {
    const app = source('public/app.js');

    assert.match(app, /label: 'Copy'/);
    assert.match(app, /label: 'Branch'/);
    assert.match(app, /label: 'Download'/);
    assert.match(app, /label: 'Share'/);
    assert.match(app, /navigator\.share\(payload\)/);
    assert.match(app, /navigator\.canShare\(\{ files: \[file\] \}\)/);
    assert.match(app, /new Blob\(\[responseDocument\.markdown\]/);
    assert.match(app, /https:\/\/wa\.me\/\?text=/);
    assert.match(app, /https:\/\/mail\.google\.com\/mail\/\?view=cm/);
    assert.match(app, /https:\/\/www\.facebook\.com\/sharer\/sharer\.php/);
    assert.match(app, /https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true/);
    assert.match(app, /Instagram, Snapchat, Chrome, and other apps/);
});

test('shared response content is isolated and redacts common secret formats', () => {
    const app = source('public/app.js');

    assert.match(app, /const title = 'OrexisAI response'/);
    assert.match(app, /sanitizeSharedResponse\(responseText\)/);
    assert.match(app, /REDACTED PRIVATE KEY/);
    assert.match(app, /REDACTED API KEY/);
    assert.match(app, /REDACTED ACCESS TOKEN/);
    assert.doesNotMatch(app, /systemPrompt|hiddenInstructions|apiKeyFromServer/);
});

test('branch route is authenticated, same-origin protected, and requires a saved assistant response', () => {
    const server = source('server.js');

    assert.match(server, /\/api\\\/chats\\\/\(\\d\+\)\\\/branch\$/);
    assert.match(server, /route\.type === 'branch' && req\.method === 'POST'/);
    assert.match(server, /assertSameOrigin\(req\)/);
    assert.match(server, /normalizeChatMessageId\(body\.messageId\)/);
    assert.match(server, /database\.branchChatConversation/);
    assert.match(server, /saved AI response could not be branched/);
});

test('database branching copies only the owned conversation through the selected assistant message', async () => {
    const calls = [];
    const client = {
        async query(sql, values) {
            calls.push({ sql, values });
            if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
            if (/SELECT conversations\.id/.test(sql)) {
                return {
                    rows: [{ id: 7, title: 'Quarterly plan', through_message_id: 42, last_message: 'Saved response' }],
                    rowCount: 1
                };
            }
            if (/INSERT INTO chat_conversations/.test(sql)) {
                return {
                    rows: [{ id: 9, title: 'Quarterly plan · branch', created_at: new Date(), updated_at: new Date() }],
                    rowCount: 1
                };
            }
            if (/INSERT INTO chat_messages/.test(sql)) return { rows: [{ id: 50 }], rowCount: 6 };
            if (/UPDATE chat_conversations/.test(sql)) {
                return {
                    rows: [{ id: 9, title: 'Quarterly plan · branch', created_at: new Date(), updated_at: new Date() }],
                    rowCount: 1
                };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {}
    };
    const pool = {
        async connect() { return client; },
        async query() { throw new Error('Direct pool query was not expected.'); }
    };
    const store = createUserStore(pool);

    const result = await store.branchChatConversation({
        userId: 3,
        conversationId: 7,
        throughMessageId: 42
    });

    assert.equal(result.id, 9);
    assert.equal(result.message_count, 6);
    assert.equal(result.last_message, 'Saved response');
    assert.match(calls[1].sql, /conversations\.user_id = \$2/);
    assert.match(calls[1].sql, /messages\.role = 'assistant'/);
    assert.deepEqual(calls[1].values, [7, 3, 42]);
    assert.match(calls[3].sql, /source_messages\.id <= \$3/);
    assert.deepEqual(calls[3].values, [9, 7, 42]);
    assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('response action controls and fallback share sheet have responsive styling', () => {
    const css = source('public/style.css');

    assert.match(css, /\.agent-response-actions/);
    assert.match(css, /\.agent-response-action-button/);
    assert.match(css, /\.agent-response-share-menu/);
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.match(css, /env\(safe-area-inset-bottom\)/);
});
