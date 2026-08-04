'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderDashboardPage } = require('../views/dashboard');

function renderDashboard() {
    return renderDashboardPage({
        user: { email: 'owner@example.com', displayName: 'Demo Owner', initials: 'DO' },
        plans: [{
            id: 'free', name: 'Free', tagline: 'Try core outcomes', usdCents: 0,
            inrPaise: 0, features: ['2 workflows'], featured: false
        }],
        billing: { currentPlanId: 'free', planExpiresAt: null },
        paymentConfiguration: {
            razorpay: { keyId: '', isConfigured: false },
            paypal: { clientId: '', isConfigured: false, mode: 'sandbox' }
        },
        aiConfiguration: { isConfigured: true, model: 'gemini-3.6-flash' },
        cspNonce: 'test-nonce'
    });
}

test('dashboard exposes a ChatGPT-style agent workspace and sidebar history controls', () => {
    const html = renderDashboard();

    assert.match(html, /data-view-target="agent"/);
    assert.match(html, /data-view="agent"/);
    assert.match(html, /id="newChatButton"/);
    assert.match(html, /id="recentChatsButton"/);
    assert.match(html, /aria-controls="recentChatsModal"/);
    assert.match(html, /id="recentChatsModal"/);
    assert.match(html, /id="closeRecentChatsModal"/);
    assert.match(html, /id="chatHistoryList"/);
    assert.match(html, /id="agentMessageList"/);
    assert.match(html, /id="agentCommandForm"/);
    assert.match(html, /id="renameChatButton"/);
    assert.match(html, /id="deleteChatButton"/);
    assert.match(html, /Gemini · gemini-3\.6-flash/);
    assert.doesNotMatch(html, /class="database-saved-badge"/);
});

test('database schema persists user-owned conversations and messages with cascading cleanup', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');

    assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_conversations/);
    assert.match(schema, /user_id BIGINT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_messages/);
    assert.match(schema, /conversation_id BIGINT NOT NULL REFERENCES chat_conversations\(id\) ON DELETE CASCADE/);
    assert.match(schema, /CHECK \(role IN \('user', 'assistant', 'system'\)\)/);
    assert.match(schema, /chat_conversations_user_updated_index/);
    assert.match(schema, /chat_messages_conversation_created_index/);
});

test('server provides authenticated CRUD routes for chat history', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    assert.match(source, /pathname === '\/api\/chats'/);
    assert.match(source, /listChatConversations\(session\.userId\)/);
    assert.match(source, /createChatConversation/);
    assert.match(source, /getChatMessages/);
    assert.match(source, /addChatCommand/);
    assert.match(source, /getChatContext/);
    assert.match(source, /geminiService\.generateReply/);
    assert.match(source, /addChatAssistantResponse/);
    assert.match(source, /renameChatConversation/);
    assert.match(source, /deleteChatConversation/);
    assert.match(source, /assertSameOrigin\(req\)/);
});


test('recent chats button opens an accessible history window and keeps chat selection behavior', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    assert.match(source, /recentChatsButton\.addEventListener\('click', openHistoryModal\)/);
    assert.match(source, /openModal\(historyModal\)/);
    assert.match(source, /closeModalElement\(historyModal\)/);
    assert.match(source, /closeHistoryModal\(false\);\s*openConversation/);
    assert.match(source, /recentChatsCount\.textContent/);
});
