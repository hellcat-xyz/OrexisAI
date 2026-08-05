'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function mockPg(request) {
    if (request === 'pg') return { Pool: class MockPool {} };
    return originalLoad.apply(this, arguments);
};
const { createUserStore } = require('../database');
Module._load = originalLoad;
const { createGeminiService } = require('../gemini-service');
const { PLANS } = require('../plans');

const projectFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const EXPECTED_LIMITS = Object.freeze({
    free: 5,
    starter: 100,
    pro: 500,
    business: 2000
});

test('AI Agent prompt limits match the four existing subscription plans', () => {
    assert.deepEqual(
        Object.fromEntries(PLANS.map((plan) => [plan.id, plan.aiAgentPromptLimit])),
        EXPECTED_LIMITS
    );
});

test('PostgreSQL schema persists hashed sessions and per-period AI Agent counters', () => {
    const schema = projectFile('database', 'schema.sql');
    const databaseSource = projectFile('database.js');

    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_sessions/);
    assert.match(schema, /token_hash CHAR\(64\) PRIMARY KEY/);
    assert.doesNotMatch(schema, /session_token\s+TEXT/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_agent_prompt_usage/);
    assert.match(schema, /PRIMARY KEY \(user_id, plan_id, period_start\)/);
    assert.match(databaseSource, /ON CONFLICT \(user_id, plan_id, period_start\) DO UPDATE/);
    assert.match(databaseSource, /WHERE ai_agent_prompt_usage\.used_count < \$5/);
    assert.match(databaseSource, /FOR UPDATE/);
    assert.match(databaseSource, /DATE_TRUNC\('month', NOW\(\)/);
    assert.match(databaseSource, /access_starts_at <= NOW\(\)/);
    assert.match(databaseSource, /access_expires_at > NOW\(\)/);
});

test('the PostgreSQL quota reservation allows exactly 5, 100, 500, and 2,000 accepted prompts', async () => {
    const fixture = createQuotaPoolFixture();
    const store = createUserStore(fixture.pool);

    for (const [planId, limit] of Object.entries(EXPECTED_LIMITS)) {
        const userId = fixture.addUser(planId);
        let allowed = 0;
        let finalUsage;
        for (let index = 0; index < limit + 1; index += 1) {
            const reservation = await store.reserveAiAgentPromptUsage(userId);
            if (reservation.allowed) allowed += 1;
            finalUsage = reservation.usage;
        }

        assert.equal(allowed, limit, `${planId} accepted count`);
        assert.equal(finalUsage.used, limit, `${planId} persisted usage`);
        assert.equal(finalUsage.remaining, 0, `${planId} remaining usage`);
        assert.equal(finalUsage.exhausted, true, `${planId} exhausted state`);
        assert.equal((await store.getAiAgentPromptUsage(userId)).used, limit);
        const restartedStore = createUserStore(fixture.pool);
        assert.equal((await restartedStore.getAiAgentPromptUsage(userId)).used, limit, `${planId} restart persistence`);
    }
});


test('paid activation starts a separate 30-day quota and expiry falls back to the existing Free month', async () => {
    const fixture = createQuotaPoolFixture();
    const store = createUserStore(fixture.pool);
    const userId = fixture.addUser('free');

    await store.reserveAiAgentPromptUsage(userId);
    await store.reserveAiAgentPromptUsage(userId);
    assert.equal((await store.getAiAgentPromptUsage(userId)).used, 2);

    fixture.activatePlan(userId, 'pro', '2026-08-15T12:00:00.000Z', '2026-09-14T12:00:00.000Z');
    const paidUsage = await store.getAiAgentPromptUsage(userId);
    assert.equal(paidUsage.planId, 'pro');
    assert.equal(paidUsage.limit, 500);
    assert.equal(paidUsage.used, 0);
    assert.equal(paidUsage.periodKind, 'subscription');

    await store.reserveAiAgentPromptUsage(userId);
    fixture.expirePlan(userId);
    const fallbackUsage = await store.getAiAgentPromptUsage(userId);
    assert.equal(fallbackUsage.planId, 'free');
    assert.equal(fallbackUsage.limit, 5);
    assert.equal(fallbackUsage.used, 2);
    assert.equal(fallbackUsage.periodKind, 'calendar_month');
});

test('concurrent submissions cannot exceed quota and a pre-provider rollback restores one use', async () => {
    const fixture = createQuotaPoolFixture();
    const store = createUserStore(fixture.pool);
    const userId = fixture.addUser('free');

    const attempts = await Promise.all(
        Array.from({ length: 30 }, () => store.reserveAiAgentPromptUsage(userId))
    );
    assert.equal(attempts.filter((attempt) => attempt.allowed).length, 5);
    assert.equal((await store.getAiAgentPromptUsage(userId)).used, 5);

    const accepted = attempts.find((attempt) => attempt.allowed);
    const rolledBack = await store.releaseAiAgentPromptUsage({
        userId,
        planId: accepted.usage.planId,
        periodStart: accepted.usage.periodStart
    });
    assert.equal(rolledBack.used, 4);

    const retry = await store.reserveAiAgentPromptUsage(userId);
    assert.equal(retry.allowed, true);
    assert.equal(retry.usage.used, 5);
});

test('Gemini marks a prompt submitted only after provider dispatch begins', async () => {
    let submitted = 0;
    const service = createGeminiService({
        env: { GEMINI_API_KEY: 'server-only-key', GEMINI_MODEL: 'gemini-test' },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    candidates: [{
                        finishReason: 'STOP',
                        content: { parts: [{ text: 'Completed.' }] }
                    }]
                });
            }
        })
    });

    await service.generateReply([{ role: 'user', content: 'Run the task.' }], {
        onRequestSubmitted() { submitted += 1; }
    });
    assert.equal(submitted, 1);

    let rejectedSubmission = 0;
    const unconfigured = createGeminiService({
        env: {},
        fetchImpl: async () => assert.fail('provider fetch must not run')
    });
    await assert.rejects(
        unconfigured.generateReply([{ role: 'user', content: 'Run the task.' }], {
            onRequestSubmitted() { rejectedSubmission += 1; }
        }),
        (error) => error.code === 'GEMINI_NOT_CONFIGURED'
    );
    assert.equal(rejectedSubmission, 0);
});

test('composer preserves the existing camera/folder controls and uses Enter without blocking normal text', () => {
    const appSource = projectFile('public', 'app.js');
    const dashboardSource = projectFile('views', 'dashboard.js');

    assert.match(appSource, /cameraButton\.addEventListener\('click', openCamera\)/);
    assert.match(appSource, /folderButton\.addEventListener\('click', chooseFolder\)/);
    assert.match(appSource, /folderInput\.addEventListener\('change', handleFolderSelection\)/);
    assert.match(appSource, /compositionstart/);
    assert.match(appSource, /compositionend/);
    assert.match(appSource, /event\.key === 'Enter' && !event\.shiftKey/);
    assert.match(appSource, /commandForm\.requestSubmit\(sendButton\)/);
    assert.match(appSource, /const draft = commandInput\.value/);
    assert.match(appSource, /commandInput\.value = draft/);
    assert.match(dashboardSource, /Enter to send · Shift\+Enter for a new line/);
});

function createQuotaPoolFixture() {
    const now = new Date('2026-08-15T12:00:00.000Z');
    const monthStart = new Date('2026-08-01T00:00:00.000Z');
    const monthEnd = new Date('2026-09-01T00:00:00.000Z');
    const users = new Map();
    const payments = new Map();
    const usage = new Map();
    let nextUserId = 1;

    const pool = {
        async connect() {
            return {
                query,
                release() {}
            };
        },
        query
    };

    return {
        pool,
        addUser(planId) {
            const userId = String(nextUserId++);
            const paid = planId !== 'free';
            users.set(userId, {
                current_plan: planId,
                plan_expires_at: paid ? new Date('2026-09-10T12:00:00.000Z') : null,
                updated_at: new Date('2026-08-11T12:00:00.000Z')
            });
            if (paid) {
                payments.set(`${userId}:${planId}`, {
                    period_start: new Date('2026-08-11T12:00:00.000Z'),
                    period_end: new Date('2026-09-10T12:00:00.000Z')
                });
            }
            return userId;
        },
        activatePlan(userId, planId, startsAt, expiresAt) {
            const user = users.get(String(userId));
            user.current_plan = planId;
            user.plan_expires_at = new Date(expiresAt);
            user.updated_at = new Date(startsAt);
            payments.set(`${userId}:${planId}`, {
                period_start: new Date(startsAt),
                period_end: new Date(expiresAt)
            });
        },
        expirePlan(userId) {
            const user = users.get(String(userId));
            payments.delete(`${userId}:${user.current_plan}`);
            user.plan_expires_at = new Date('2026-08-14T12:00:00.000Z');
        }
    };

    async function query(sql, values = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
            return { rows: [] };
        }

        if (normalized.startsWith("UPDATE users SET current_plan = 'free'")) {
            const user = users.get(String(values[0]));
            if (user?.plan_expires_at && user.plan_expires_at <= now) {
                user.current_plan = 'free';
                user.plan_expires_at = null;
                user.updated_at = now;
            }
            return { rows: [] };
        }

        if (normalized.startsWith('SELECT current_plan, plan_expires_at, updated_at FROM users')) {
            const user = users.get(String(values[0]));
            return { rows: user ? [{ ...user }] : [] };
        }

        if (normalized.startsWith("SELECT DATE_TRUNC('month', NOW())")) {
            return { rows: [{ period_start: monthStart, period_end: monthEnd }] };
        }

        if (normalized.startsWith('SELECT access_starts_at AS period_start')) {
            const payment = payments.get(`${values[0]}:${values[1]}`);
            return { rows: payment ? [{ ...payment }] : [] };
        }

        if (normalized.startsWith('SELECT COALESCE($1::TIMESTAMPTZ')) {
            const periodEnd = values[0] ? new Date(values[0]) : new Date(new Date(values[1]).getTime() + 30 * 86400000);
            return { rows: [{ period_start: new Date(periodEnd.getTime() - 30 * 86400000), period_end: periodEnd }] };
        }

        if (normalized.startsWith('INSERT INTO ai_agent_prompt_usage')) {
            const [userId, planId, periodStart, periodEnd, limit] = values;
            const key = usageKey(userId, planId, periodStart);
            const row = usage.get(key) || { used_count: 0, period_end: periodEnd };
            if (row.used_count >= Number(limit)) return { rows: [] };
            row.used_count += 1;
            row.period_end = periodEnd;
            usage.set(key, row);
            return { rows: [{ used_count: row.used_count }] };
        }

        if (normalized.startsWith('SELECT used_count FROM ai_agent_prompt_usage')) {
            const row = usage.get(usageKey(values[0], values[1], values[2]));
            return { rows: row ? [{ used_count: row.used_count }] : [] };
        }

        if (normalized.startsWith('UPDATE ai_agent_prompt_usage SET used_count = GREATEST')) {
            const row = usage.get(usageKey(values[0], values[1], values[2]));
            if (row) row.used_count = Math.max(0, row.used_count - 1);
            return { rows: [] };
        }

        throw new Error(`Unhandled quota test SQL: ${normalized}`);
    }

    function usageKey(userId, planId, periodStart) {
        return `${userId}:${planId}:${new Date(periodStart).toISOString()}`;
    }
}
