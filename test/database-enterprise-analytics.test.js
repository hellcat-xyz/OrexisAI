'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'pg') return { Pool: class Pool {} };
    return originalLoad.call(this, request, parent, isMain);
};
const { createUserStore } = require('../database');
Module._load = originalLoad;

test('enterprise analytics uses sequential client queries with compact PostgreSQL parameters', async () => {
    let activeQueries = 0;
    let released = false;
    let analyticsQueryCount = 0;
    let cohortQueryChecked = false;

    const client = {
        async query(text, values = []) {
            activeQueries += 1;
            try {
                assert.equal(activeQueries, 1, 'a pg Client must not execute concurrent queries');
                await new Promise((resolve) => setImmediate(resolve));

                const parameterIndexes = [...new Set(
                    [...String(text).matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))
                )].sort((left, right) => left - right);
                assert.deepEqual(
                    parameterIndexes,
                    Array.from({ length: values.length }, (_, index) => index + 1),
                    'query parameters must be contiguous so PostgreSQL can infer every supplied type'
                );

                if (String(text).includes("DATE_TRUNC('month', orders.ordered_at")) {
                    assert.match(
                        String(text),
                        /orders\.ordered_at >= \$3::TIMESTAMPTZ - INTERVAL '12 months'/,
                        'cohort lower bound must cast the date parameter before interval arithmetic'
                    );
                    cohortQueryChecked = true;
                }

                if (String(text).includes('FROM business_memberships')) {
                    return {
                        rows: [{
                            id: 71,
                            currency: 'USD',
                            timezone: 'UTC',
                            role: 'owner'
                        }]
                    };
                }

                analyticsQueryCount += 1;
                return { rows: [] };
            } finally {
                activeQueries -= 1;
            }
        },
        release() {
            released = true;
        }
    };
    const pool = {
        async connect() {
            return client;
        }
    };
    const database = createUserStore(pool);

    const result = await database.getEnterpriseAnalyticsData({
        userId: 1,
        businessId: 71,
        periods: {
            current: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
            previous: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
            yearAgo: { from: '2025-07-01T00:00:00.000Z', to: '2025-08-01T00:00:00.000Z' }
        },
        filters: { channel: '', location: '', businessHours: 'all' }
    });

    assert.equal(analyticsQueryCount, 17);
    assert.equal(cohortQueryChecked, true);
    assert.equal(released, true);
    assert.equal(result.business.id, 71);
    assert.deepEqual(result.daily, []);
});


test('marketing workspace does not issue concurrent queries on one pg Client', async () => {
    let activeQueries = 0;
    let workspaceQueryCount = 0;
    let released = false;

    const client = {
        async query(text) {
            activeQueries += 1;
            try {
                assert.equal(activeQueries, 1, 'a pg Client must not execute concurrent queries');
                await new Promise((resolve) => setImmediate(resolve));

                if (String(text).includes('FROM business_memberships')) {
                    return {
                        rows: [{
                            id: 71,
                            name: 'Test Business',
                            currency: 'USD',
                            timezone: 'UTC',
                            role: 'owner'
                        }]
                    };
                }

                workspaceQueryCount += 1;
                return { rows: [] };
            } finally {
                activeQueries -= 1;
            }
        },
        release() {
            released = true;
        }
    };
    const pool = {
        async connect() {
            return client;
        }
    };
    const database = createUserStore(pool);

    const result = await database.getMarketingWorkspaceData({
        userId: 1,
        businessId: 71,
        periods: {
            current: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
            previous: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
            yearAgo: { from: '2025-07-01T00:00:00.000Z', to: '2025-08-01T00:00:00.000Z' }
        }
    });

    assert.equal(workspaceQueryCount, 14);
    assert.equal(released, true);
    assert.equal(result.business.id, 71);
    assert.deepEqual(result.daily, []);
});
