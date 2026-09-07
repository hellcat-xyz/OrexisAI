'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createWorkflowService } = require('../workflows/service');

function business() {
    return { id: '7', name: 'Verified Business', currency: 'USD', timezone: 'UTC' };
}

function baseCompetitors() {
    return [
        {
            competitor_id: '1',
            name: 'Alpha Co',
            external_id: 'alpha',
            configured_source_name: 'website',
            configured_source_url: 'https://alpha.example/products',
            snapshot_id: '10',
            retrieved_at: '2026-09-01T10:00:00.000Z',
            source_name: 'import',
            source_url: 'https://alpha.example/products',
            currency: 'USD',
            products: [{ name: 'Starter Plan', priceMinor: 9900, currency: 'USD' }],
            offers: [{ name: 'Old promo', price: '99', currency: 'USD' }],
            positioning: 'Simple starter offer',
            previous_snapshot_id: null,
            previous_retrieved_at: null,
            previous_currency: null,
            previous_products: [],
            previous_offers: [],
            previous_positioning: null
        },
        {
            competitor_id: '2',
            name: 'Beta Labs',
            external_id: 'beta',
            configured_source_name: 'website',
            configured_source_url: 'https://beta.example/pricing',
            snapshot_id: '20',
            retrieved_at: '2026-09-02T10:00:00.000Z',
            source_name: 'import',
            source_url: 'https://beta.example/pricing',
            currency: 'USD',
            products: [{ name: 'Starter Plan', priceMinor: 11900, currency: 'USD' }],
            offers: [],
            positioning: 'Premium support included',
            previous_snapshot_id: null,
            previous_retrieved_at: null,
            previous_currency: null,
            previous_products: [],
            previous_offers: [],
            previous_positioning: null
        }
    ];
}

function createDatabase({ fallbackOnly = false, noSnapshots = false } = {}) {
    const calls = [];
    let saved = false;
    let runId = 40;
    const profile = business();
    const initial = baseCompetitors().map((row) => noSnapshots ? {
        ...row,
        snapshot_id: null,
        retrieved_at: null,
        source_name: null,
        source_url: null,
        currency: null,
        products: [],
        offers: [],
        positioning: null,
        previous_snapshot_id: null,
        previous_retrieved_at: null,
        previous_currency: null,
        previous_products: [],
        previous_offers: [],
        previous_positioning: null
    } : row);

    const currentRows = () => initial.map((row) => {
        if (!saved) return { ...row };
        if (Number(row.competitor_id) === 1) {
            return {
                ...row,
                snapshot_id: '11',
                retrieved_at: '2026-09-07T12:00:00.000Z',
                source_name: 'public-website',
                products: [
                    { name: 'Starter Plan', priceMinor: 10900, currency: 'USD' },
                    { name: 'Growth Plan', priceMinor: 16900, currency: 'USD' }
                ],
                offers: [{ name: 'Launch promo', price: '109', currency: 'USD' }],
                positioning: 'Starter plus growth automation',
                previous_snapshot_id: row.snapshot_id,
                previous_retrieved_at: row.retrieved_at,
                previous_source_name: row.source_name,
                previous_source_url: row.source_url,
                previous_currency: row.currency,
                previous_products: row.products,
                previous_offers: row.offers,
                previous_positioning: row.positioning
            };
        }
        return {
            ...row,
            snapshot_id: '21',
            retrieved_at: '2026-09-07T12:00:00.000Z',
            source_name: 'public-website',
            products: [{ name: 'Starter Plan', priceMinor: 12900, currency: 'USD' }],
            offers: [],
            positioning: row.positioning,
            previous_snapshot_id: row.snapshot_id,
            previous_retrieved_at: row.retrieved_at,
            previous_source_name: row.source_name,
            previous_source_url: row.source_url,
            previous_currency: row.currency,
            previous_products: row.products,
            previous_offers: row.offers,
            previous_positioning: row.positioning
        };
    });

    return {
        calls,
        async getOrCreateBusinessForUser() { return profile; },
        async getBusinessForUser() { return profile; },
        async createWorkflowRun({ workflow, input }) {
            runId += 1;
            return {
                id: String(runId), business_id: profile.id, workflow_slug: workflow.slug, workflow_name: workflow.name,
                status: 'queued', input, output: null, error_message: null, records_analyzed: 0,
                progress_percentage: 0, current_step: null, created_at: '2026-09-07T12:00:00.000Z'
            };
        },
        async updateWorkflowRun(input) {
            calls.push(['update-run', input.status]);
            return {
                id: String(input.runId), business_id: profile.id, workflow_slug: 'competitor-audit', workflow_name: 'Competitor Audit',
                status: input.status, input: {}, output: input.output || null, error_message: input.errorMessage || null,
                data_period_start: input.periodStart || null, data_period_end: input.periodEnd || null,
                data_retrieved_at: input.dataRetrievedAt || null, records_analyzed: input.recordsAnalyzed || 0,
                duration_ms: input.durationMs ?? null, progress_percentage: input.progressPercentage || 0,
                current_step: input.currentStep || null, estimated_completion_at: input.estimatedCompletionAt || null,
                created_at: '2026-09-07T12:00:00.000Z', started_at: '2026-09-07T12:00:00.000Z',
                completed_at: input.status === 'completed' ? '2026-09-07T12:00:01.000Z' : null
            };
        },
        async touchWorkflowRun() { return true; },
        async finalizeActiveWorkflowSteps() { return true; },
        async updateWorkflowStep(input) { calls.push(['step', input.stepKey, input.status]); return input; },
        async updateWorkflowProgress(input) { calls.push(['progress', input.currentStep]); return input; },
        async appendWorkflowLog(input) { return { ...input, created_at: '2026-09-07T12:00:00.000Z' }; },
        async getCompetitorAuditData() {
            const rows = fallbackOnly ? [initial[0]] : currentRows();
            return { business: profile, retrievedAt: '2026-09-07T12:00:00.000Z', competitors: rows.map((row) => ({ ...row })) };
        },
        async saveCompetitorLiveSnapshots({ snapshots }) {
            calls.push(['save-snapshots', snapshots.length]);
            if (fallbackOnly) return [];
            saved = true;
            return snapshots.map((item, index) => ({ id: String(100 + index), competitor_id: String(item.id) }));
        }
    };
}

function createAi({ configured = true, groundedResult = null } = {}) {
    const prompts = [];
    return {
        prompts,
        getPublicConfiguration() { return { isConfigured: configured, model: 'test-model' }; },
        async generateGroundedWebJson({ prompt }) {
            prompts.push(prompt);
            if (!groundedResult) {
                const error = new Error('No grounded result configured for this test.');
                error.code = 'TEST_GROUNDED_RESULT_MISSING';
                throw error;
            }
            return groundedResult;
        },
        async generateReply(messages) {
            const prompt = messages.map((message) => message.content).join('\n');
            prompts.push(prompt);
            return {
                model: 'test-model',
                content: 'Alpha Co increased Starter Plan pricing and launched Growth Plan. Beta Labs remains more expensive on the exact Starter Plan match.'
            };
        }
    };
}

test('competitor audit refreshes live sources, persists snapshots, detects changes and compares exact product prices', async () => {
    const database = createDatabase();
    const ai = createAi();
    const liveDataCollector = {
        async collectCompetitors() {
            return {
                retrievedAt: '2026-09-07T12:00:00.000Z',
                status: 'available',
                provider: 'public-websites',
                reason: null,
                results: [
                    {
                        id: 1, name: 'Alpha Co', sourceName: 'public-website', sourceUrl: 'https://alpha.example/products', status: 'available',
                        currency: 'USD', products: [
                            { name: 'Starter Plan', priceMinor: 10900, currency: 'USD' },
                            { name: 'Growth Plan', priceMinor: 16900, currency: 'USD' }
                        ], offers: [{ name: 'Launch promo', price: '109', currency: 'USD' }], positioning: 'Starter plus growth automation', text: 'verified alpha text'
                    },
                    {
                        id: 2, name: 'Beta Labs', sourceName: 'public-website', sourceUrl: 'https://beta.example/pricing', status: 'available',
                        currency: 'USD', products: [{ name: 'Starter Plan', priceMinor: 12900, currency: 'USD' }], offers: [], positioning: 'Premium support included', text: 'verified beta text'
                    }
                ]
            };
        }
    };

    const service = createWorkflowService({ database, geminiService: ai, liveDataCollector, env: {} });
    const result = await service.execute({ userId: '5', slug: 'competitor-audit', input: {} });

    assert.equal(result.run.status, 'completed');
    assert.equal(result.output.workflow, 'competitor-audit');
    assert.equal(result.output.workflowVersion, 2);
    assert.equal(result.output.partial, false);
    assert.equal(result.output.refresh.liveSnapshotsUsed, 2);
    assert.equal(result.output.refresh.persisted, 2);
    assert.equal(result.output.calculatedMetrics.competitorsWithCurrentSnapshots, 2);
    assert.equal(result.output.calculatedMetrics.comparableProductGroups.length, 1);
    assert.equal(result.output.calculatedMetrics.comparableProductGroups[0].priceRangeMinor, 2000);

    const alphaChanges = result.output.detectedChanges.find((item) => item.competitorName === 'Alpha Co');
    assert.equal(alphaChanges.hasBaseline, true);
    assert.equal(alphaChanges.productLaunches[0].name, 'Growth Plan');
    assert.equal(alphaChanges.pricingChanges[0].previousPriceMinor, 9900);
    assert.equal(alphaChanges.pricingChanges[0].currentPriceMinor, 10900);
    assert.equal(alphaChanges.positioningChanged, true);
    assert.ok(database.calls.some((call) => call[0] === 'save-snapshots' && call[1] === 2));
    assert.ok(ai.prompts[0].includes('Alpha Co'));
    assert.ok(ai.prompts[0].includes('Beta Labs'));
});

test('competitor audit falls back to the newest stored sourced snapshot when live refresh is unavailable', async () => {
    const database = createDatabase({ fallbackOnly: true });
    const ai = createAi({ configured: false });
    const liveDataCollector = {
        async collectCompetitors() {
            return {
                retrievedAt: '2026-09-07T12:00:00.000Z',
                status: 'unavailable',
                provider: 'competitors',
                results: [],
                reason: 'Configured competitor websites could not be retrieved.'
            };
        }
    };

    const service = createWorkflowService({ database, geminiService: ai, liveDataCollector, env: {} });
    const result = await service.execute({ userId: '5', slug: 'competitor-audit', input: {} });

    assert.equal(result.run.status, 'completed');
    assert.equal(result.output.partial, true);
    assert.equal(result.output.refresh.liveSnapshotsUsed, 0);
    assert.equal(result.output.refresh.storedSnapshotsUsed, 1);
    assert.equal(result.output.factualResults[0].sourceMode, 'stored');
    assert.ok(result.output.dataLimitations.some((item) => /could not be retrieved/i.test(item)));
    assert.equal(result.output.aiInsights.status, 'unavailable');
});


test('competitor audit reports the exact configured source failure when no snapshot exists yet', async () => {
    const database = createDatabase({ noSnapshots: true });
    const liveDataCollector = {
        async collectCompetitors() {
            return {
                retrievedAt: '2026-09-07T12:00:00.000Z',
                status: 'unavailable',
                provider: 'public-websites',
                reason: 'Configured competitor websites could not be retrieved.',
                results: [{
                    id: 1,
                    name: 'Adidas',
                    sourceUrl: 'https://www.adidas.com/',
                    status: 'unavailable',
                    errorCode: 'HTTP_UPSTREAM_ERROR',
                    statusCode: 403,
                    error: 'Upstream request failed with HTTP 403.'
                }]
            };
        }
    };

    const service = createWorkflowService({ database, geminiService: createAi({ configured: false }), liveDataCollector, env: {} });
    await assert.rejects(
        () => service.execute({ userId: '5', slug: 'competitor-audit', input: {} }),
        (error) => {
            assert.equal(error.code, 'COMPETITOR_DATA_UNAVAILABLE');
            assert.match(error.publicMessage, /Adidas/);
            assert.match(error.publicMessage, /HTTP_UPSTREAM_ERROR/);
            assert.match(error.publicMessage, /HTTP 403/);
            return true;
        }
    );
});


test('competitor audit recovers an HTTP 403 source with Gemini Google Search grounding', async () => {
    const database = createDatabase({ fallbackOnly: true, noSnapshots: true });
    const ai = createAi({
        groundedResult: {
            model: 'gemini-3.5-flash-lite',
            data: {
                title: 'Alpha Co',
                description: 'Official public pricing and product information.',
                positioning: 'Performance products sold through the official storefront.',
                currency: 'USD',
                products: [{
                    name: 'Starter Plan',
                    priceMinor: 10900,
                    currency: 'USD',
                    availability: 'Available',
                    url: 'https://alpha.example/products'
                }],
                offers: [],
                observations: ['The official public storefront lists Starter Plan at USD 109.00.']
            },
            groundingSources: [{
                url: 'https://alpha.example/products',
                title: 'Alpha Co Products',
                kind: 'google-search'
            }]
        }
    });
    const liveDataCollector = {
        async collectCompetitors() {
            return {
                retrievedAt: '2026-09-07T12:00:00.000Z',
                status: 'unavailable',
                provider: 'public-websites',
                reason: 'Configured competitor websites could not be retrieved.',
                results: [{
                    id: 1,
                    name: 'Alpha Co',
                    sourceUrl: 'https://alpha.example/products',
                    status: 'unavailable',
                    errorCode: 'HTTP_UPSTREAM_ERROR',
                    statusCode: 403,
                    error: 'Upstream request failed with HTTP 403.'
                }]
            };
        }
    };

    const service = createWorkflowService({ database, geminiService: ai, liveDataCollector, env: {} });
    const result = await service.execute({ userId: '5', slug: 'competitor-audit', input: {} });

    assert.equal(result.run.status, 'completed');
    assert.equal(result.output.refresh.groundedRecovered, 1);
    assert.equal(result.output.refresh.liveSnapshotsUsed, 1);
    assert.equal(result.output.factualResults[0].sourceMode, 'live');
    assert.equal(result.output.factualResults[0].sourceName, 'gemini-google-search');
    assert.equal(result.output.factualResults[0].products[0].priceMinor, 10900);
    assert.ok(ai.prompts.some((prompt) => /Google Search grounding/.test(prompt)));
});
