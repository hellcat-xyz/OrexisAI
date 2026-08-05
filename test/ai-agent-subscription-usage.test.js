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
const { PLANS, getPlanById } = require('../plans');

const projectFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const EXPECTED_LIMITS = Object.freeze({
    free: 5,
    starter: 100,
    pro: 500,
    business: 2000
});

test('AI Agent prompt limits and stored plan formats resolve to the four existing plans', () => {
    assert.deepEqual(
        Object.fromEntries(PLANS.map((plan) => [plan.id, plan.aiAgentPromptLimit])),
        EXPECTED_LIMITS
    );
    assert.equal(getPlanById(' FREE ')?.id, 'free');
    assert.equal(getPlanById('Starter Plan')?.id, 'starter');
    assert.equal(getPlanById('PRO_MONTHLY')?.id, 'pro');
    assert.equal(getPlanById('business-30-day')?.id, 'business');
    assert.equal(getPlanById('unknown-plan'), null);
});

test('PostgreSQL schema persists hashed sessions, committed usage, and short-lived reservations', () => {
    const schema = projectFile('database', 'schema.sql');
    const databaseSource = projectFile('database.js');

    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_sessions/);
    assert.match(schema, /token_hash CHAR\(64\) PRIMARY KEY/);
    assert.doesNotMatch(schema, /session_token\s+TEXT/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_agent_prompt_usage/);
    assert.match(schema, /PRIMARY KEY \(user_id, plan_id, period_start\)/);
    assert.match(schema, /accounting_version SMALLINT NOT NULL DEFAULT 2/);
    assert.match(schema, /WHERE accounting_version IS NULL OR accounting_version < 2/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_agent_prompt_reservations/);
    assert.match(schema, /reservation_id UUID PRIMARY KEY/);
    assert.match(databaseSource, /SELECT COUNT\(\*\)::INTEGER AS pending_count/);
    assert.match(databaseSource, /FOR UPDATE/);
    assert.match(databaseSource, /commitAiAgentPromptUsage/);
    assert.match(databaseSource, /cancelAiAgentPromptUsageReservation/);
    assert.match(databaseSource, /DATE_TRUNC\('month', NOW\(\)/);
    assert.match(databaseSource, /access_starts_at <= NOW\(\)/);
    assert.match(databaseSource, /access_expires_at > NOW\(\)/);
});

test('successful prompts allow exactly 5, 100, 500, and 2,000 committed uses', async () => {
    const fixture = createQuotaPoolFixture();
    const store = createUserStore(fixture.pool);

    for (const [storedPlan, planId, limit] of [
        ['FREE', 'free', 5],
        ['Starter Plan', 'starter', 100],
        ['PRO_MONTHLY', 'pro', 500],
        ['business-30-day', 'business', 2000]
    ]) {
        const userId = fixture.addUser(storedPlan, planId);
        for (let index = 1; index <= limit; index += 1) {
            const reservation = await store.reserveAiAgentPromptUsage(userId);
            assert.equal(reservation.allowed, true, `${planId} prompt ${index}`);
            const usage = await store.commitAiAgentPromptUsage({
                userId,
                reservationId: reservation.reservationId
            });
            assert.equal(usage.used, index, `${planId} committed usage`);
        }

        const blocked = await store.reserveAiAgentPromptUsage(userId);
        assert.equal(blocked.allowed, false, `${planId} prompt ${limit + 1}`);
        assert.equal(blocked.usage.used, limit);
        assert.equal(blocked.usage.limit, limit);
        assert.equal(blocked.usage.exhausted, true);
        const restartedStore = createUserStore(fixture.pool);
        assert.equal((await restartedStore.getAiAgentPromptUsage(userId)).used, limit);
    }
});

test('paid activation starts its own 30-day period and expiry returns to the persisted Free month', async () => {
    const fixture = createQuotaPoolFixture();
    const store = createUserStore(fixture.pool);
    const userId = fixture.addUser('free', 'free');

    await commitOne(store, userId);
    await commitOne(store, userId);
    assert.equal((await store.getAiAgentPromptUsage(userId)).used, 2);

    fixture.activatePlan(userId, 'Pro Plan', 'pro', '2026-08-15T12:00:00.000Z', '2026-09-14T12:00:00.000Z');
    const paidUsage = await store.getAiAgentPromptUsage(userId);
    assert.equal(paidUsage.planId, 'pro');
    assert.equal(paidUsage.limit, 500);
    assert.equal(paidUsage.used, 0);
    assert.equal(paidUsage.periodKind, 'subscription');

    await commitOne(store, userId);
    fixture.expirePlan(userId);
    const fallbackUsage = await store.getAiAgentPromptUsage(userId);
    assert.equal(fallbackUsage.planId, 'free');
    assert.equal(fallbackUsage.limit, 5);
    assert.equal(fallbackUsage.used, 2);
    assert.equal(fallbackUsage.periodKind, 'calendar_month');
});

test('concurrent tabs cannot exceed quota and a failed provider reservation consumes nothing', async () => {
    const fixture = createQuotaPoolFixture();
    const store = createUserStore(fixture.pool);
    const userId = fixture.addUser('free', 'free');

    const attempts = await Promise.all(
        Array.from({ length: 30 }, () => store.reserveAiAgentPromptUsage(userId))
    );
    const accepted = attempts.filter((attempt) => attempt.allowed);
    assert.equal(accepted.length, 5);
    assert.equal((await store.getAiAgentPromptUsage(userId)).used, 0, 'pending work is not successful usage');

    const cancelledUsage = await store.cancelAiAgentPromptUsageReservation({
        userId,
        reservationId: accepted[0].reservationId
    });
    assert.equal(cancelledUsage.used, 0);

    const replacement = await store.reserveAiAgentPromptUsage(userId);
    assert.equal(replacement.allowed, true);
    const toCommit = [...accepted.slice(1), replacement];
    for (const reservation of toCommit) {
        await store.commitAiAgentPromptUsage({ userId, reservationId: reservation.reservationId });
    }
    assert.equal((await store.getAiAgentPromptUsage(userId)).used, 5);
    assert.equal((await store.reserveAiAgentPromptUsage(userId)).allowed, false);
});

test('Gemini provider quota remains a provider error rather than an application plan error', async () => {
    const service = createGeminiService({
        env: { GEMINI_API_KEY: 'server-only-key', GEMINI_MODEL: 'gemini-test', GEMINI_RETRIES: '0' },
        fetchImpl: async () => ({
            ok: false,
            status: 429,
            headers: { get() { return null; } },
            async text() {
                return JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Provider quota exceeded.' } });
            }
        })
    });

    await assert.rejects(
        service.generateReply([{ role: 'user', content: 'Run the task.' }]),
        (error) => error.providerHttpStatus === 429
            && error.code === 'GEMINI_API_ERROR'
            && /Gemini quota/.test(error.publicMessage)
    );
});

test('composer keeps existing controls, permits typing, and clears only after a successful response', () => {
    const appSource = projectFile('public', 'app.js');
    const dashboardSource = projectFile('views', 'dashboard.js');

    assert.match(appSource, /cameraButton\.addEventListener\('click', openCamera\)/);
    assert.match(appSource, /folderButton\.addEventListener\('click', chooseFolder\)/);
    assert.match(appSource, /folderInput\.addEventListener\('change', handleFolderSelection\)/);
    assert.match(appSource, /compositionstart/);
    assert.match(appSource, /compositionend/);
    assert.match(appSource, /event\.key === 'Enter' && !event\.shiftKey/);
    assert.match(appSource, /commandForm\.requestSubmit\(sendButton\)/);
    assert.match(appSource, /let commandSubmissionInFlight = false/);
    assert.match(appSource, /if \(commandInput\.value === draft\) commandInput\.value = ''/);
    assert.doesNotMatch(appSource, /sendButton\.disabled = [^;]*promptUsage\.exhausted/);
    assert.match(dashboardSource, /Enter to send · Shift\+Enter for a new line/);
});

async function commitOne(store, userId) {
    const reservation = await store.reserveAiAgentPromptUsage(userId);
    assert.equal(reservation.allowed, true);
    return store.commitAiAgentPromptUsage({ userId, reservationId: reservation.reservationId });
}

function createQuotaPoolFixture() {
    const now = new Date('2026-08-15T12:00:00.000Z');
    const monthStart = new Date('2026-08-01T00:00:00.000Z');
    const monthEnd = new Date('2026-09-01T00:00:00.000Z');
    const users = new Map();
    const payments = new Map();
    const usage = new Map();
    const reservations = new Map();
    const lockTails = new Map();
    let nextUserId = 1;

    const pool = {
        async connect() {
            let releaseUserLock = null;
            return {
                async query(sql, values = []) {
                    const normalized = normalizeSql(sql);
                    if (normalized.startsWith('SELECT current_plan, plan_expires_at, updated_at FROM users')
                        && normalized.endsWith('FOR UPDATE')) {
                        releaseUserLock = await acquireLock(String(values[0]));
                    }
                    if (normalized === 'COMMIT' || normalized === 'ROLLBACK') {
                        releaseUserLock?.();
                        releaseUserLock = null;
                        return { rows: [] };
                    }
                    return queryCore(normalized, values);
                },
                release() { releaseUserLock?.(); }
            };
        },
        async query(sql, values = []) { return queryCore(normalizeSql(sql), values); }
    };

    return {
        pool,
        addUser(storedPlan, canonicalPlan) {
            const userId = String(nextUserId++);
            const paid = canonicalPlan !== 'free';
            users.set(userId, {
                current_plan: storedPlan,
                plan_expires_at: paid ? new Date('2026-09-10T12:00:00.000Z') : null,
                updated_at: new Date('2026-08-11T12:00:00.000Z')
            });
            if (paid) addPayment(userId, storedPlan, '2026-08-11T12:00:00.000Z', '2026-09-10T12:00:00.000Z');
            return userId;
        },
        activatePlan(userId, storedPlan, canonicalPlan, startsAt, expiresAt) {
            const user = users.get(String(userId));
            user.current_plan = storedPlan;
            user.plan_expires_at = new Date(expiresAt);
            user.updated_at = new Date(startsAt);
            addPayment(userId, storedPlan, startsAt, expiresAt);
            assert.equal(getPlanById(storedPlan)?.id, canonicalPlan);
        },
        expirePlan(userId) {
            const user = users.get(String(userId));
            payments.delete(String(userId));
            user.plan_expires_at = new Date('2026-08-14T12:00:00.000Z');
        }
    };

    async function acquireLock(userId) {
        const previous = lockTails.get(userId) || Promise.resolve();
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        lockTails.set(userId, previous.then(() => current));
        await previous;
        return release;
    }

    function addPayment(userId, planId, startsAt, expiresAt) {
        const rows = payments.get(String(userId)) || [];
        rows.unshift({
            plan_id: planId,
            period_start: new Date(startsAt),
            period_end: new Date(expiresAt)
        });
        payments.set(String(userId), rows);
    }

    async function queryCore(normalized, values) {
        if (normalized === 'BEGIN') return { rows: [] };

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

        if (normalized.startsWith('SELECT plan_id, access_starts_at AS period_start')) {
            return { rows: [...(payments.get(String(values[0])) || [])] };
        }

        if (normalized.startsWith('SELECT COALESCE($1::TIMESTAMPTZ')) {
            const periodEnd = values[0] ? new Date(values[0]) : new Date(new Date(values[1]).getTime() + 30 * 86400000);
            return { rows: [{ period_start: new Date(periodEnd.getTime() - 30 * 86400000), period_end: periodEnd }] };
        }

        if (normalized.startsWith('INSERT INTO ai_agent_prompt_usage')) {
            const [userId, planId, periodStart, periodEnd] = values;
            const key = usageKey(userId, planId, periodStart);
            const row = usage.get(key) || { used_count: 0, period_end: periodEnd };
            row.period_end = periodEnd;
            usage.set(key, row);
            return { rows: [] };
        }

        if (normalized.startsWith('DELETE FROM ai_agent_prompt_reservations WHERE user_id = $1 AND expires_at <= NOW()')) {
            for (const [id, row] of reservations) {
                if (row.user_id === String(values[0]) && row.expires_at <= now) reservations.delete(id);
            }
            return { rows: [] };
        }

        if (normalized === 'DELETE FROM ai_agent_prompt_reservations WHERE expires_at <= NOW()') {
            for (const [id, row] of reservations) if (row.expires_at <= now) reservations.delete(id);
            return { rows: [] };
        }

        if (normalized.startsWith('SELECT used_count FROM ai_agent_prompt_usage')) {
            const row = usage.get(usageKey(values[0], values[1], values[2]));
            return { rows: row ? [{ used_count: row.used_count }] : [] };
        }

        if (normalized.startsWith('SELECT COUNT(*)::INTEGER AS pending_count')) {
            const count = [...reservations.values()].filter((row) => row.user_id === String(values[0])
                && row.plan_id === values[1]
                && sameDate(row.period_start, values[2])
                && row.expires_at > now).length;
            return { rows: [{ pending_count: count }] };
        }

        if (normalized.startsWith('INSERT INTO ai_agent_prompt_reservations')) {
            reservations.set(String(values[0]), {
                reservation_id: String(values[0]),
                user_id: String(values[1]),
                plan_id: values[2],
                period_start: new Date(values[3]),
                expires_at: new Date(now.getTime() + 10 * 60000)
            });
            return { rows: [] };
        }

        if (normalized.startsWith('SELECT reservations.plan_id, reservations.period_start, usage.used_count')) {
            const row = reservations.get(String(values[0]));
            if (!row || row.user_id !== String(values[1]) || row.expires_at <= now) return { rows: [] };
            const usageRow = usage.get(usageKey(row.user_id, row.plan_id, row.period_start));
            return { rows: [{ plan_id: row.plan_id, period_start: row.period_start, used_count: usageRow?.used_count || 0 }] };
        }

        if (normalized.startsWith('UPDATE ai_agent_prompt_usage SET used_count = used_count + 1')) {
            const row = usage.get(usageKey(values[0], values[1], values[2]));
            if (!row || row.used_count >= Number(values[3])) return { rows: [] };
            row.used_count += 1;
            return { rows: [{ used_count: row.used_count }] };
        }

        if (normalized.startsWith('DELETE FROM ai_agent_prompt_reservations WHERE reservation_id = $1 AND user_id = $2')) {
            const row = reservations.get(String(values[0]));
            if (row?.user_id === String(values[1])) reservations.delete(String(values[0]));
            return { rows: [] };
        }

        throw new Error(`Unhandled quota test SQL: ${normalized}`);
    }

    function usageKey(userId, planId, periodStart) {
        return `${userId}:${planId}:${new Date(periodStart).toISOString()}`;
    }

    function sameDate(left, right) {
        return new Date(left).getTime() === new Date(right).getTime();
    }

    function normalizeSql(sql) {
        return String(sql).replace(/\s+/g, ' ').trim();
    }
}
