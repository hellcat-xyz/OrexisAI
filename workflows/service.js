'use strict';

const { getWorkflow, listWorkflows } = require('./registry');
const { createLiveMarketingDataCollector } = require('./live-marketing-data');
const { createMarketingReportService } = require('./report-service');
const { regenerateWeeklyMarketingSection, serializeArtifact } = require('./weekly-marketing');
const { createMarketingAnalyticsEngine } = require('./analytics-engine');
const { createMarketingAiService } = require('./marketing-ai');
const { createCompetitorIntelligenceService, computeNextRun } = require('./marketing-services');
const { executeMarketingOperatingWorkflow } = require('./marketing-orchestrator');
const { validateSchedulePayload } = require('./security');
const { createEnterpriseAnalyticsService } = require('./enterprise-analytics');
const { createAnalyticsDemoPayload, DEMO_DATASET_VERSION } = require('./analytics-demo-data');
const { createInventoryDemoPayload, INVENTORY_DEMO_VERSION } = require('./inventory-demo-data');
const { createAnalyticsExport, buildAnalyticsEmail } = require('./analytics-export');
const { validateBusinessImportPayload } = require('../business-data');
const {
    calculateInventoryForecast,
    growthPercentage,
    resolveComparablePeriod,
    safeDivide
} = require('./calculations');

const MAX_AI_FACT_BYTES = 96 * 1024;
const MAX_REVIEW_BATCH = 20;

function createWorkflowService({ database, geminiService, emailService = null, env = process.env, fetchImpl = globalThis.fetch, liveDataCollector: liveDataCollectorOverride = null }) {
    if (!database) throw new TypeError('A database service is required.');
    if (!geminiService) throw new TypeError('An AI service is required.');

    const reviewResponseConnector = createReviewResponseConnector({ env, fetchImpl });
    const liveDataCollector = liveDataCollectorOverride || createLiveMarketingDataCollector({ env, fetchImpl });
    const reportService = createMarketingReportService();
    const analyticsEngine = createMarketingAnalyticsEngine({
        database,
        cacheTtlSeconds: parseBoundedInteger(env.MARKETING_DASHBOARD_CACHE_SECONDS, 30, 5, 300)
    });
    const marketingAiService = createMarketingAiService({ geminiService });
    const competitorIntelligenceService = createCompetitorIntelligenceService({ database });
    const enterpriseAnalyticsService = createEnterpriseAnalyticsService({ database, analyticsEngine });

    return {
        listDefinitions() {
            return listWorkflows().map(serializeWorkflowDefinition);
        },

        async execute({ userId, businessId = null, slug, input = {}, onEvent = () => {} }) {
            const workflow = getWorkflow(slug);
            if (!workflow) throw createWorkflowError('WORKFLOW_NOT_FOUND', 'That workflow does not exist.', 404);

            const business = businessId === null || businessId === undefined
                ? await database.getOrCreateBusinessForUser(userId)
                : await database.getBusinessForUser({ userId, businessId });
            const staleAfterSeconds = parseBoundedInteger(env.WORKFLOW_STALE_RUN_SECONDS, 300, 60, 3600);
            const configuredMaxRunSeconds = parseBoundedInteger(env.WORKFLOW_MAX_RUN_SECONDS, 900, 300, 7200);
            const maxRunSeconds = Math.max(configuredMaxRunSeconds, staleAfterSeconds + 60);
            const run = await database.createWorkflowRun({
                userId,
                businessId: business.id,
                workflow,
                input,
                staleAfterSeconds,
                maxRunSeconds
            });
            emit(onEvent, 'run', { run: serializeRun(run) });
            const startedAt = Date.now();
            const deadlineAt = startedAt + maxRunSeconds * 1000;
            let heartbeat = null;
            let execution;
            try {
                const running = await database.updateWorkflowRun({
                    runId: run.id,
                    status: 'running',
                    businessId: business.id
                });
                if (!running) {
                    throw createWorkflowError(
                        'WORKFLOW_LEASE_LOST',
                        'The workflow execution lease could not be activated. Run the workflow again.',
                        409
                    );
                }
                emit(onEvent, 'status', { status: 'running', runId: Number(run.id) });

                heartbeat = startWorkflowHeartbeat({
                    database,
                    runId: run.id,
                    businessId: business.id,
                    staleAfterSeconds
                });
                const { step, log } = createStepExecutor({
                    database, onEvent, runId: run.id, workflow, startedAt, deadlineAt
                });
                execution = await withWorkflowExecutionTimeout(() => executeBySlug({
                    workflow,
                    userId,
                    business,
                    input,
                    step,
                    database,
                    geminiService,
                    liveDataCollector,
                    reportService,
                    analyticsEngine,
                    marketingAiService,
                    competitorIntelligenceService,
                    runId: run.id,
                    log
                }), maxRunSeconds);
                const durationMs = Date.now() - startedAt;
                const completed = await step('save-result', async () => ({ persisted: true }));
                void completed;
                const saved = await database.updateWorkflowRun({
                    runId: run.id,
                    status: 'completed',
                    output: execution.output,
                    businessId: business.id,
                    periodStart: execution.period?.from || null,
                    periodEnd: execution.period?.to || null,
                    dataRetrievedAt: execution.dataRetrievedAt || new Date().toISOString(),
                    recordsAnalyzed: execution.recordsAnalyzed || 0,
                    durationMs,
                    progressPercentage: 100,
                    currentStep: 'completed',
                    estimatedCompletionAt: new Date().toISOString()
                });
                if (!saved) {
                    throw createWorkflowError(
                        'WORKFLOW_LEASE_LOST',
                        'The workflow execution lease expired before the result could be saved. Run it again.',
                        409
                    );
                }
                const result = { ...serializeRun(saved), steps: undefined };
                emit(onEvent, 'completed', { run: result, output: execution.output });
                return { run: result, output: execution.output };
            } catch (error) {
                const durationMs = Date.now() - startedAt;
                const publicMessage = error.publicMessage || 'The workflow could not produce a trustworthy result.';
                const failedStage = error.workflowStepKey || null;
                const diagnostic = buildWorkflowDiagnostic(error, env);
                console.error(`[workflow:${Number(run.id)}] ${workflow.slug} failed${failedStage ? ` at ${failedStage}` : ''}:`, error);
                await database.finalizeActiveWorkflowSteps?.({
                    runId: run.id,
                    errorMessage: publicMessage
                }).catch(() => {});
                await database.updateWorkflowRun({
                    runId: run.id,
                    status: 'failed',
                    output: execution?.output || null,
                    errorMessage: publicMessage,
                    businessId: business.id,
                    periodStart: execution?.period?.from || null,
                    periodEnd: execution?.period?.to || null,
                    dataRetrievedAt: execution?.dataRetrievedAt || new Date().toISOString(),
                    recordsAnalyzed: execution?.recordsAnalyzed || 0,
                    durationMs,
                    currentStep: failedStage || 'failed',
                    estimatedCompletionAt: null
                }).catch((persistenceError) => {
                    console.error(`[workflow:${Number(run.id)}] failed to persist terminal workflow state:`, persistenceError);
                });
                emit(onEvent, 'failed', {
                    code: error.code || 'WORKFLOW_FAILED',
                    error: publicMessage,
                    failedStage,
                    diagnostic,
                    runId: Number(run.id)
                });
                throw error;
            } finally {
                if (heartbeat) clearInterval(heartbeat);
            }
        },

        async getOverview({ userId, from, to }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const period = resolveComparablePeriod({ from, to });
            const data = await database.getBusinessOverview({
                userId,
                businessId: business.id,
                current: period.current,
                previous: period.previous
            });
            return buildOverview(data, period);
        },

        async getBusinessProfile({ userId }) {
            const membership = await database.getOrCreateBusinessForUser(userId);
            const business = await database.getBusinessForUser({ userId, businessId: membership.id });
            return serializeBusinessProfile(business);
        },

        async getMarketingWorkspace({ userId, from = '', to = '', bypassCache = false }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            return analyticsEngine.buildWorkspace({ userId, businessId: business.id, from, to, timezone: business.timezone || 'UTC', bypassCache });
        },

        async getEnterpriseAnalytics({ userId, from = '', to = '', filters = {}, bypassCache = false }) {
            return enterpriseAnalyticsService.buildDashboard({ userId, from, to, filters, bypassCache });
        },

        async getInventoryDataSummary({ userId }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const summary = await database.getInventoryDataSummary({ userId, businessId: business.id });
            return { business: serializeBusiness(business), ...summary };
        },

        async loadInventoryDemoData({ userId }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const state = await database.getInventoryDatasetState({ userId, businessId: business.id });
            if (Number(state.real_order_records || 0) > 0) {
                throw createWorkflowError('INVENTORY_DEMO_REAL_DATA_PRESENT', 'Demo inventory data cannot be loaded because this business already has real order records.', 409);
            }
            if (Number(state.demo_order_records || 0) > 0) {
                return { loaded: false, alreadyLoaded: true, datasetVersion: INVENTORY_DEMO_VERSION };
            }
            const payload = validateBusinessImportPayload(createInventoryDemoPayload({
                businessId: business.id,
                currency: business.currency || 'USD',
                timezone: business.timezone || 'UTC',
                countryCode: business.country_code || 'IN'
            }));
            const imported = await database.importBusinessData({ userId, businessId: business.id, payload });
            return { loaded: true, alreadyLoaded: false, datasetVersion: INVENTORY_DEMO_VERSION, import: imported };
        },

        async removeInventoryDemoData({ userId }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            return database.deleteInventoryDemoData({ userId, businessId: business.id });
        },

        async exportEnterpriseAnalytics({ userId, from = '', to = '', filters = {}, format }) {
            const dashboard = await enterpriseAnalyticsService.buildDashboard({ userId, from, to, filters, bypassCache: true });
            return createAnalyticsExport({ format, dashboard });
        },

        async emailEnterpriseAnalytics({ userId, email, from = '', to = '', filters = {} }) {
            if (!emailService?.isConfigured || typeof emailService.sendAnalyticsReport !== 'function') {
                throw createWorkflowError('ANALYTICS_EMAIL_NOT_CONFIGURED', 'Report email is not configured. Set EMAIL_PROVIDER, RESEND_API_KEY, and EMAIL_FROM.', 503);
            }
            const dashboard = await enterpriseAnalyticsService.buildDashboard({ userId, from, to, filters, bypassCache: true });
            const report = buildAnalyticsEmail(dashboard);
            const sent = await emailService.sendAnalyticsReport({ to: email, ...report });
            return { sent: true, id: sent.id || '', generatedAt: dashboard.generatedAt };
        },

        async loadAnalyticsDemoData({ userId }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const state = await database.getAnalyticsDatasetState({ userId, businessId: business.id });
            if (Number(state.real_order_records || 0) > 0) {
                throw createWorkflowError('ANALYTICS_DEMO_REAL_DATA_PRESENT', 'Demo data cannot be loaded because this business already has real order records.', 409);
            }
            if (Number(state.demo_order_records || 0) > 0) {
                return { loaded: false, alreadyLoaded: true, datasetVersion: DEMO_DATASET_VERSION };
            }
            const payload = validateBusinessImportPayload(createAnalyticsDemoPayload({
                businessId: business.id,
                currency: business.currency || 'USD',
                timezone: business.timezone || 'UTC'
            }));
            const imported = await database.importBusinessData({ userId, businessId: business.id, payload });
            return { loaded: true, alreadyLoaded: false, datasetVersion: DEMO_DATASET_VERSION, import: imported };
        },

        async removeAnalyticsDemoData({ userId }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            return database.deleteAnalyticsDemoData({ userId, businessId: business.id });
        },

        async listMarketingCampaigns({ userId, runId = null, limit = 100 }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const rows = await database.listMarketingCampaignAssets({ userId, businessId: business.id, runId, limit });
            return rows.map((row) => ({
                id: Number(row.id), runId: Number(row.run_id), channel: row.channel, title: row.title,
                content: row.content, rationale: row.rationale || null, verifiedFacts: row.verified_facts || [],
                status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
            }));
        },

        async listSchedules({ userId }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const rows = await database.listScheduledWorkflows({ userId, businessId: business.id });
            return rows.map(serializeSchedule);
        },

        async upsertSchedule({ userId, payload }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const schedule = validateSchedulePayload(payload, business.timezone);
            schedule.nextRunAt = computeNextRun(schedule, new Date());
            const saved = await database.upsertScheduledWorkflow({ userId, businessId: business.id, schedule });
            return serializeSchedule(saved);
        },

        async deleteSchedule({ userId, scheduleId }) {
            const business = await database.getOrCreateBusinessForUser(userId);
            return database.deleteScheduledWorkflow({ userId, businessId: business.id, scheduleId });
        },

        async updateReviewResponse({ userId, reviewId, response, action }) {
            const cleanResponse = String(response || '').trim();
            if (!cleanResponse || cleanResponse.length > 5000) {
                throw createWorkflowError('INVALID_REVIEW_RESPONSE', 'Enter a response between 1 and 5,000 characters.', 400);
            }
            if (!['save', 'approve', 'send'].includes(action)) {
                throw createWorkflowError('INVALID_REVIEW_ACTION', 'Choose a valid review response action.', 400);
            }

            if (action === 'send') {
                const existing = await database.updateReviewResponse({
                    userId,
                    reviewId,
                    response: cleanResponse,
                    status: 'approved'
                });
                if (!existing) throw createWorkflowError('REVIEW_NOT_FOUND', 'That review was not found.', 404);
                await reviewResponseConnector.send({
                    provider: existing.provider,
                    externalReviewId: existing.external_id,
                    response: cleanResponse,
                    businessId: existing.business_id
                });
                return database.updateReviewResponse({
                    userId,
                    reviewId,
                    response: cleanResponse,
                    status: 'sent'
                });
            }

            const updated = await database.updateReviewResponse({
                userId,
                reviewId,
                response: cleanResponse,
                status: action === 'approve' ? 'approved' : 'draft'
            });
            if (!updated) throw createWorkflowError('REVIEW_NOT_FOUND', 'That review was not found.', 404);
            return updated;
        },

        async getRun({ userId, runId }) {
            return database.getWorkflowRun({ userId, runId });
        },

        async listArtifacts({ userId, runId }) {
            const run = await database.getWorkflowRun({ userId, runId });
            if (!run) throw createWorkflowError('WORKFLOW_RUN_NOT_FOUND', 'That workflow run was not found.', 404);
            return (await database.listWorkflowArtifacts({ userId, runId })).map(serializeArtifact);
        },

        async getArtifact({ userId, artifactId }) {
            const artifact = await database.getWorkflowArtifact({ userId, artifactId });
            if (!artifact) throw createWorkflowError('WORKFLOW_ARTIFACT_NOT_FOUND', 'That workflow artifact was not found.', 404);
            return artifact;
        },

        async regenerateSection({ userId, runId, sectionKey }) {
            const run = await database.getWorkflowRun({ userId, runId });
            if (!run) throw createWorkflowError('WORKFLOW_RUN_NOT_FOUND', 'That workflow run was not found.', 404);
            return regenerateWeeklyMarketingSection({ userId, run, sectionKey, database, geminiService, reportService });
        },

        getConnectorConfiguration() {
            return {
                reviewResponsesConfigured: reviewResponseConnector.isConfigured,
                liveMarketing: liveDataCollector.configuration(),
                ai: geminiService.getPublicConfiguration()
            };
        }
    };
}

async function executeBySlug(context) {
    switch (context.workflow.slug) {
        case 'weekly-marketing':
            return executeMarketingOperatingWorkflow({
                ...context,
                analyticsEngine: context.analyticsEngine,
                marketingAiService: context.marketingAiService,
                competitorIntelligenceService: context.competitorIntelligenceService
            });
        case 'competitor-audit':
            return executeCompetitorAudit(context);
        case 'review-responder':
            return executeReviewResponder(context);
        case 'inventory-predictor':
            return executeInventoryPredictor(context);
        default:
            throw createWorkflowError('WORKFLOW_NOT_IMPLEMENTED', 'That workflow is not implemented.', 501);
    }
}

async function executeWeeklyMarketingLegacy({ userId, business, input, step, database, geminiService }) {
    const period = resolveComparablePeriod({ from: input.from, to: input.to });
    await step('resolve-business', async () => ({ businessId: Number(business.id), businessName: business.name }));
    const data = await step('fetch-business-data', () => database.getWeeklyMarketingData({
        userId,
        businessId: business.id,
        current: period.current,
        previous: period.previous
    }));
    await step('validate-data', async () => {
        if (Number(data.current.total_orders || 0) === 0) {
            throw createWorkflowError(
                'INSUFFICIENT_SALES_DATA',
                'No valid paid, completed, or fulfilled orders exist in the selected period. Import or connect order data and run the workflow again.',
                422
            );
        }
        return { validOrders: Number(data.current.total_orders), currency: data.business.currency };
    });
    const calculated = await step('calculate-metrics', async () => buildMarketingResult(data, period));
    const ai = await step('generate-insights', async () => generateGroundedInsights({
        geminiService,
        workflowName: 'Weekly Marketing',
        facts: calculated,
        instruction: [
            'Create practical marketing recommendations and a seven-day marketing plan.',
            'Use only the supplied factual results and calculated metrics.',
            'Clearly state when campaign, conversion, retention, or acquisition data is unavailable.',
            'Do not invent audience demographics, channels, budgets, competitors, prices, products, or performance.'
        ].join(' ')
    }));
    const recordsAnalyzed = sumRecordCounts(data.recordCounts);
    return {
        period: period.current,
        dataRetrievedAt: data.retrievedAt,
        recordsAnalyzed,
        output: {
            workflow: 'weekly-marketing',
            trustworthy: true,
            business: serializeBusinessProfile(data.business),
            dataPeriod: serializePeriod(period.current),
            previousPeriod: serializePeriod(period.previous),
            recordsAnalyzed,
            factualResults: calculated.factualResults,
            calculatedMetrics: calculated.calculatedMetrics,
            aiInsights: ai
        }
    };
}

async function executeCompetitorAudit({
    userId,
    business,
    input,
    step,
    log,
    database,
    geminiService,
    liveDataCollector,
    competitorIntelligenceService
}) {
    await step('resolve-business', async () => ({ businessId: Number(business.id), businessName: business.name }));

    const initial = await step('load-competitors', () => database.getCompetitorAuditData({
        userId,
        businessId: business.id
    }));
    if (initial.competitors.length === 0) {
        throw createWorkflowError(
            'COMPETITOR_INTEGRATION_REQUIRED',
            'No competitors are configured. Add competitor records with legitimate public source URLs, then run the audit again.',
            422
        );
    }

    const refreshRequested = input?.refresh !== false;
    const configuredSources = initial.competitors.filter((item) => item.configured_source_url);
    const refresh = await step('refresh-sources', async () => {
        if (!refreshRequested) {
            return { retrievedAt: new Date().toISOString(), status: 'skipped', provider: null, results: [], reason: 'Live refresh was disabled for this run.' };
        }
        if (configuredSources.length === 0) {
            return { retrievedAt: new Date().toISOString(), status: 'unavailable', provider: null, results: [], reason: 'No competitor public source URLs are configured.' };
        }
        if (typeof liveDataCollector?.collectCompetitors !== 'function') {
            return { retrievedAt: new Date().toISOString(), status: 'unavailable', provider: null, results: [], reason: 'The competitor source collector is unavailable.' };
        }
        return liveDataCollector.collectCompetitors({
            competitors: initial.competitors.map((item) => ({
                id: Number(item.competitor_id),
                name: item.name,
                source_url: item.configured_source_url,
                active: true
            })),
            onLog: (level, message) => { void log?.(level, message); }
        });
    });

    const liveResults = Array.isArray(refresh.results) ? refresh.results : [];
    const directAvailable = liveResults.filter((item) => item?.status === 'available' && item.id);
    const directFailures = liveResults.filter((item) => item?.status !== 'available');
    const groundedRecovery = await step('recover-blocked-sources', async () => recoverBlockedCompetitorSources({
        failures: directFailures,
        competitors: initial.competitors,
        geminiService,
        log
    }));
    const recoveredIds = new Set(groundedRecovery.available.map((item) => Number(item.id)).filter(Number.isFinite));
    const groundedAttemptedIds = new Set((groundedRecovery.attemptedIds || []).map(Number).filter(Number.isFinite));
    const liveAvailable = [
        ...directAvailable,
        ...groundedRecovery.available.filter((item) => !directAvailable.some((direct) => Number(direct.id) === Number(item.id)))
    ];
    const liveFailures = [
        ...directFailures.filter((item) => !recoveredIds.has(Number(item?.id)) && !groundedAttemptedIds.has(Number(item?.id))),
        ...groundedRecovery.failures
    ];
    let persisted = [];
    let persistenceFailure = null;

    await step('persist-snapshots', async () => {
        if (liveAvailable.length === 0) return { saved: 0, skipped: true };
        try {
            persisted = await competitorIntelligenceService.persistLiveFindings({
                userId,
                businessId: business.id,
                liveData: {
                    retrievedAt: refresh.retrievedAt || new Date().toISOString(),
                    available: { competitors: liveAvailable }
                }
            });
            return { saved: persisted.length };
        } catch (error) {
            persistenceFailure = error;
            await log?.('warning', 'Live competitor data was retrieved but snapshot persistence failed; this run will use the verified live response without adding it to history.', {
                code: error.code || null
            });
            return { saved: 0, degraded: true };
        }
    });

    let currentData = initial;
    if (persisted.length > 0) {
        currentData = await database.getCompetitorAuditData({ userId, businessId: business.id });
    }

    const persistedIds = new Set(persisted.map((item) => Number(item.competitor_id)).filter(Number.isFinite));
    const effectiveRows = overlayUnpersistedLiveSnapshots({
        storedRows: currentData.competitors,
        initialRows: initial.competitors,
        liveRows: liveAvailable,
        persistedIds,
        retrievedAt: refresh.retrievedAt || new Date().toISOString()
    });

    const sourced = await step('validate-data', async () => {
        const available = effectiveRows.filter((item) => item.snapshot_id && item.retrieved_at);
        if (available.length === 0) {
            const hasConfiguredUrl = initial.competitors.some((item) => item.configured_source_url);
            const failureSummary = summarizeCompetitorSourceFailures(liveFailures);
            throw createWorkflowError(
                'COMPETITOR_DATA_UNAVAILABLE',
                hasConfiguredUrl
                    ? `Competitor sources are configured, but no live source or stored snapshot produced usable data.${failureSummary ? ` Source diagnostics: ${failureSummary}` : ' Check the source URLs and run the audit again.'}`
                    : 'Competitors are configured, but no public source URLs or stored snapshots are available. Add legitimate source URLs or import sourced snapshots before running this audit.',
                422
            );
        }
        return available;
    });

    const comparison = await step('compare-competitors', async () => buildCompetitorComparison(sourced));
    const dataLimitations = buildCompetitorLimitations({
        refreshRequested,
        refresh,
        liveFailures,
        persistenceFailure,
        configuredSources,
        effectiveRows: sourced
    });

    const ai = await step('generate-insights', async () => generateGroundedInsights({
        geminiService,
        workflowName: 'Competitor Audit',
        facts: {
            business: serializeBusiness(initial.business),
            competitors: comparison.factualResults,
            calculatedMetrics: comparison.calculatedMetrics,
            detectedChanges: comparison.changes,
            dataLimitations
        },
        instruction: [
            'Produce a concise competitor audit for the business using only the verified competitor snapshots supplied.',
            'Prioritize concrete pricing differences, product launches or removals, offer changes, and positioning changes when the evidence exists.',
            'Separate observed facts from recommendations.',
            'Reference competitor names and retrieval timestamps when discussing evidence.',
            'Do not infer market share, customer sentiment, product quality, demand, revenue, traffic, or hidden discounts.',
            'When exact product matching is unavailable, state that direct price comparison is not possible rather than guessing equivalence.'
        ].join(' ')
    }));

    const dates = sourced.map((item) => new Date(item.retrieved_at)).filter((date) => !Number.isNaN(date.getTime()));
    const period = dates.length > 0
        ? { from: new Date(Math.min(...dates)), to: new Date(Math.max(...dates)) }
        : null;
    const liveIds = new Set(liveAvailable.map((item) => Number(item.id)).filter(Number.isFinite));
    const liveSnapshotsUsed = sourced.filter((item) => liveIds.has(Number(item.competitor_id)) && item._source_mode === 'live').length;
    const storedSnapshotsUsed = sourced.length - liveSnapshotsUsed;

    return {
        period,
        dataRetrievedAt: refresh.retrievedAt || currentData.retrievedAt || initial.retrievedAt,
        recordsAnalyzed: sourced.length,
        output: {
            workflow: 'competitor-audit',
            workflowVersion: 2,
            trustworthy: true,
            partial: dataLimitations.length > 0,
            business: serializeBusiness(initial.business),
            dataPeriod: period ? serializePeriod(period) : null,
            recordsAnalyzed: sourced.length,
            refresh: {
                requested: refreshRequested,
                configuredSources: configuredSources.length,
                attempted: refreshRequested ? configuredSources.length : 0,
                available: liveAvailable.length,
                failed: liveFailures.length,
                persisted: persisted.length,
                groundedRecovered: groundedRecovery.available.length,
                liveSnapshotsUsed,
                storedSnapshotsUsed
            },
            factualResults: comparison.factualResults,
            calculatedMetrics: comparison.calculatedMetrics,
            detectedChanges: comparison.changes,
            sourceSummary: comparison.sourceSummary,
            dataLimitations,
            aiInsights: ai
        }
    };
}

async function executeReviewResponder({ userId, business, step, database, geminiService }) {
    await step('resolve-business', async () => ({ businessId: Number(business.id), businessName: business.name }));
    const data = await step('fetch-reviews', () => database.getReviewResponderData({
        userId,
        businessId: business.id,
        limit: MAX_REVIEW_BATCH
    }));
    await step('validate-data', async () => {
        if (data.reviews.length === 0) {
            throw createWorkflowError(
                'REVIEW_DATA_UNAVAILABLE',
                'No unanswered published reviews are available. Connect a review provider or import real review records, then run the workflow again.',
                422
            );
        }
        return { reviewCount: data.reviews.length };
    });
    const analyses = await step('analyze-reviews', async () => data.reviews.map(analyzeReview));
    const generated = await step('generate-responses', async () => generateReviewDrafts({
        geminiService,
        reviews: data.reviews,
        analyses,
        businessName: data.business.name
    }));
    const draftsToSave = generated.drafts
        .filter((draft) => draft.response)
        .map((draft) => ({
            id: draft.id,
            externalId: draft.externalId,
            response: draft.response
        }));
    if (draftsToSave.length > 0) {
        await database.saveReviewDrafts({ userId, businessId: business.id, drafts: draftsToSave });
    }
    const publishedDates = data.reviews.map((review) => new Date(review.published_at));
    const period = {
        from: new Date(Math.min(...publishedDates)),
        to: new Date(Math.max(...publishedDates))
    };
    return {
        period,
        dataRetrievedAt: data.retrievedAt,
        recordsAnalyzed: data.reviews.length,
        output: {
            workflow: 'review-responder',
            trustworthy: true,
            business: serializeBusiness(data.business),
            dataPeriod: serializePeriod(period),
            recordsAnalyzed: data.reviews.length,
            factualResults: data.reviews.map((review) => ({
                id: Number(review.id),
                externalId: review.external_id,
                provider: review.provider,
                rating: review.rating === null ? null : Number(review.rating),
                reviewText: review.review_text,
                customerName: review.customer_name || null,
                publishedAt: review.published_at,
                sourceUrl: review.source_url || null
            })),
            calculatedMetrics: analyses,
            aiInsights: generated.ai,
            responseDrafts: generated.drafts
        }
    };
}

async function executeInventoryPredictor({ userId, business, input, step, database, geminiService }) {
    const period = resolveInventoryPeriod(input);
    await step('resolve-business', async () => ({ businessId: Number(business.id), businessName: business.name }));
    const data = await step('fetch-inventory-data', () => database.getInventoryData({
        userId,
        businessId: business.id,
        current: period.current,
        previous: period.previous
    }));
    await step('validate-data', async () => {
        if (data.products.length === 0) {
            throw createWorkflowError(
                'INVENTORY_DATA_UNAVAILABLE',
                'No active products are available. Import product inventory and historical order items before running this prediction.',
                422
            );
        }
        const productsWithStock = data.products.filter((product) => product.current_stock !== null);
        if (productsWithStock.length === 0) {
            throw createWorkflowError(
                'CURRENT_STOCK_UNAVAILABLE',
                'Product records exist, but current stock is missing. Import current inventory values before running this prediction.',
                422
            );
        }
        const productsWithDemandHistory = productsWithStock.filter((product) =>
            Number(product.order_records || 0) > 0
            || Number(product.units_sold || 0) > 0
            || Number(product.previous_units_sold || 0) > 0);
        if (productsWithDemandHistory.length === 0) {
            throw createWorkflowError(
                'INSUFFICIENT_INVENTORY_HISTORY',
                'Inventory records exist, but no valid paid, completed, or fulfilled order-item history is available for forecasting. Import historical sales tied to products and run the workflow again.',
                422
            );
        }
        return {
            products: data.products.length,
            productsWithStock: productsWithStock.length,
            productsWithDemandHistory: productsWithDemandHistory.length
        };
    });
    const forecasts = await step('calculate-forecast', async () => data.products.map((product) =>
        calculateInventoryForecast(product, period.days, 7)));
    const demoProducts = data.products.filter((product) => product.metadata?.orexis_inventory_demo === INVENTORY_DEMO_VERSION).length;
    const dataMode = demoProducts === data.products.length && data.products.length > 0 ? 'demo' : demoProducts > 0 ? 'mixed' : 'production';
    const ai = await step('generate-insights', async () => generateGroundedInsights({
        geminiService,
        workflowName: 'Inventory Predictor',
        facts: { periodDays: period.days, forecasts },
        instruction: [
            'Explain stock risks and prioritize products using only the verified calculated forecast.',
            'Use the calculated recommendedReorderQuantity when it is available; never invent quantities or business facts.',
            'Do not create reorder quantities when lead time, demand history, or current stock is unavailable.',
            'State confidence and limitations explicitly.'
        ].join(' ')
    }));
    return {
        period: period.current,
        dataRetrievedAt: data.retrievedAt,
        recordsAnalyzed: data.recordsAnalyzed,
        output: {
            workflow: 'inventory-predictor',
            trustworthy: true,
            business: serializeBusiness(data.business),
            dataPeriod: serializePeriod(period.current),
            previousPeriod: serializePeriod(period.previous),
            recordsAnalyzed: data.recordsAnalyzed,
            dataMode,
            sourceCoverage: data.sources,
            methodology: {
                baselineDemand: '55% recent 28-day demand + 25% previous 28-day demand + 20% same-period demand one year earlier when available',
                demandSignals: 'Verified promotion, seasonal-event, online-intent, and imported forecast-weather factors are applied only when present',
                availableStock: 'Warehouse current stock minus reserved and damaged stock plus returned stock',
                projectedDemand: 'Grounded projected daily demand × 7-day forecast horizon',
                reorderPoint: 'Maximum of configured reorder point and lead-time demand plus safety stock',
                recommendedReorderQuantity: 'Target stock minus available and incoming stock, rounded to the configured reorder lot size'
            },
            factualResults: data.products.map((product) => ({
                productId: Number(product.product_id),
                productName: product.product_name,
                sku: product.sku || null,
                currentStock: product.current_stock === null ? null : Number(product.current_stock),
                reservedStock: Number(product.reserved_stock || 0),
                incomingStock: Number(product.incoming_stock || 0),
                supplierName: product.supplier_name || null,
                supplierReliabilityScore: product.supplier_reliability_score === null ? null : Number(product.supplier_reliability_score),
                unitsSold: Number(product.units_sold || 0),
                previousUnitsSold: Number(product.previous_units_sold || 0),
                yearAgoUnitsSold: Number(product.year_ago_units_sold || 0),
                activePromotions: product.active_promotions || null,
                seasonalEvents: product.seasonal_events || null
            })),
            calculatedMetrics: forecasts,
            aiInsights: ai
        }
    };
}


function buildWorkflowDiagnostic(error, env = {}) {
    const code = String(error?.code || 'WORKFLOW_FAILED').trim();
    const isProduction = String(env.NODE_ENV || process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    if (isProduction) return code;
    const message = String(error?.message || '').trim().replace(/\s+/g, ' ').slice(0, 700);
    return message ? `${code}: ${message}` : code;
}

function createStepExecutor({ database, onEvent, runId, workflow, startedAt, deadlineAt }) {
    const stepIndex = new Map(workflow.steps.map((definition, index) => [definition.key, index]));
    let activeStep = null;
    const log = async (level, message, metadata = {}) => {
        const entry = await database.appendWorkflowLog?.({ runId, level, stepKey: activeStep, message, metadata }).catch(() => null);
        emit(onEvent, 'log', {
            runId: Number(runId), level, stepKey: activeStep, message,
            metadata, createdAt: entry?.created_at || new Date().toISOString()
        });
        return entry;
    };
    const updateProgress = async (stepKey, status) => {
        const index = stepIndex.get(stepKey) ?? 0;
        const completedUnits = status === 'completed' ? index + 1 : index;
        const percentage = Math.max(0, Math.min(99, Math.round((completedUnits / workflow.steps.length) * 100)));
        const elapsed = Math.max(1000, Date.now() - startedAt);
        const unitsDone = Math.max(1, completedUnits || index + 0.35);
        const remainingMs = Math.max(0, Math.round((elapsed / unitsDone) * (workflow.steps.length - completedUnits)));
        const estimatedCompletionAt = new Date(Date.now() + remainingMs).toISOString();
        await database.updateWorkflowProgress?.({ runId, percentage, currentStep: stepKey, estimatedCompletionAt }).catch(() => {});
        emit(onEvent, 'progress', { runId: Number(runId), currentStep: stepKey, percentage, estimatedCompletionAt });
    };
    const step = async function executeStep(stepKey, operation) {
        assertWorkflowDeadline(deadlineAt);
        activeStep = stepKey;
        await updateProgress(stepKey, 'running');
        await database.updateWorkflowStep({ runId, stepKey, status: 'running' });
        await log('info', `${workflow.steps.find((item) => item.key === stepKey)?.title || stepKey} started.`);
        emit(onEvent, 'step', { runId: Number(runId), stepKey, status: 'running' });
        try {
            const output = await operation();
            assertWorkflowDeadline(deadlineAt);
            await database.updateWorkflowStep({ runId, stepKey, status: 'completed', output: summarizeStepOutput(output) });
            await updateProgress(stepKey, 'completed');
            await log('info', `${workflow.steps.find((item) => item.key === stepKey)?.title || stepKey} completed.`);
            emit(onEvent, 'step', { runId: Number(runId), stepKey, status: 'completed' });
            return output;
        } catch (error) {
            const stepTitle = workflow.steps.find((item) => item.key === stepKey)?.title || stepKey;
            const hadPublicMessage = Boolean(error.publicMessage);
            const publicMessage = error.publicMessage || `${stepTitle} could not be completed. Check the server terminal for the underlying error.`;
            if (!error.publicMessage) error.publicMessage = publicMessage;
            if (!error.code) error.code = 'WORKFLOW_STEP_FAILED';
            error.workflowStepKey = error.workflowStepKey || stepKey;
            if (!hadPublicMessage) console.error(`[workflow:${Number(runId)}] ${stepKey} failed:`, error);
            await database.updateWorkflowStep({ runId, stepKey, status: 'failed', errorMessage: publicMessage }).catch(() => {});
            await log('error', publicMessage, { code: error.code || null });
            emit(onEvent, 'step', { runId: Number(runId), stepKey, status: 'failed', error: publicMessage });
            throw error;
        }
    };
    return { step, log };
}

function buildMarketingResult(data, period) {
    const currentRevenue = Number(data.current.total_revenue_minor || 0);
    const previousRevenue = Number(data.previous.total_revenue_minor || 0);
    const currentOrders = Number(data.current.total_orders || 0);
    const previousOrders = Number(data.previous.total_orders || 0);
    const uniqueCustomers = Number(data.current.unique_customers || 0);
    const campaignRecords = Number(data.campaign.records || 0);
    const conversions = campaignRecords > 0 ? Number(data.campaign.conversions || 0) : null;
    const visitors = campaignRecords > 0 ? Number(data.campaign.visitors || 0) : null;
    const campaignSpend = campaignRecords > 0 ? Number(data.campaign.spend_minor || 0) : null;
    const campaignRevenue = campaignRecords > 0 ? Number(data.campaign.attributed_revenue_minor || 0) : null;

    return {
        factualResults: {
            currency: data.business.currency,
            totalRevenueMinor: currentRevenue,
            totalOrders: currentOrders,
            uniqueCustomers,
            topProducts: data.topProducts.map((product) => ({
                productId: Number(product.product_id),
                productName: product.product_name,
                sku: product.sku || null,
                unitsSold: Number(product.units_sold || 0),
                revenueMinor: Number(product.revenue_minor || 0),
                orderCount: Number(product.order_count || 0)
            })),
            productSalesVolume: data.topProducts.reduce((sum, product) => sum + Number(product.units_sold || 0), 0),
            dailyTrend: data.daily.map((row) => ({
                date: row.day,
                orders: Number(row.orders || 0),
                revenueMinor: Number(row.revenue_minor || 0)
            })),
            customerTrend: {
                newCustomers: Number(data.customerTrend.new_customers || 0),
                activeCustomers: Number(data.customerTrend.active_customers || 0),
                previousNewCustomers: Number(data.customerTrend.previous_new_customers || 0)
            },
            campaignDataAvailable: campaignRecords > 0,
            campaign: campaignRecords > 0 ? {
                records: campaignRecords,
                spendMinor: campaignSpend,
                attributedRevenueMinor: campaignRevenue,
                impressions: Number(data.campaign.impressions || 0),
                clicks: Number(data.campaign.clicks || 0),
                visitors,
                leads: Number(data.campaign.leads || 0),
                conversions,
                retrievedAt: data.campaign.retrieved_at
            } : null,
            periodDays: period.days
        },
        calculatedMetrics: {
            averageOrderValueMinor: safeDivide(currentRevenue, currentOrders),
            revenuePerCustomerMinor: safeDivide(currentRevenue, uniqueCustomers),
            revenueGrowthPercentage: growthPercentage(currentRevenue, previousRevenue),
            orderGrowthPercentage: growthPercentage(currentOrders, previousOrders),
            customerGrowthPercentage: growthPercentage(uniqueCustomers, Number(data.previous.unique_customers || 0)),
            conversionRatePercentage: conversions === null || visitors === null ? null : safeDivide(conversions * 100, visitors),
            campaignReturnOnSpend: campaignSpend && campaignSpend > 0 ? safeDivide(campaignRevenue, campaignSpend) : null
        }
    };
}

function buildOverview(data, period) {
    const marketing = buildMarketingResult(data, period);
    const crm = data.crm;
    const purchasingCustomers = Number(crm.purchasing_customers || 0);
    const repeatCustomers = Number(crm.repeat_customers || 0);
    return {
        business: serializeBusinessProfile(data.business),
        dataPeriod: serializePeriod(period.current),
        previousPeriod: serializePeriod(period.previous),
        dataRetrievedAt: data.retrievedAt,
        recordsAnalyzed: sumRecordCounts(data.recordCounts),
        dataAvailability: {
            orderRecords: Number(data.recordCounts.order_records || 0),
            orderItemRecords: Number(data.recordCounts.item_records || 0),
            campaignRecords: Number(data.recordCounts.campaign_records || 0),
            customerRecords: Number(data.crm.total_customers || 0)
        },
        marketing: marketing.factualResults,
        analytics: marketing.calculatedMetrics,
        crm: {
            totalCustomers: Number(crm.total_customers || 0),
            activeCustomers: Number(crm.active_customers || 0),
            inactive30Days: Number(crm.inactive_30_days || 0),
            followupsDue: Number(crm.followups_due || 0),
            repeatPurchaseRatePercentage: purchasingCustomers > 0
                ? safeDivide(repeatCustomers * 100, purchasingCustomers)
                : null,
            customers: data.customers.map((customer) => ({
                id: Number(customer.id),
                externalId: customer.external_id,
                name: customer.name || null,
                email: customer.email || null,
                status: customer.status,
                firstSeenAt: customer.first_seen_at,
                lastActivityAt: customer.last_activity_at,
                orderCount: Number(customer.order_count || 0),
                lifetimeValueMinor: Number(customer.lifetime_value_minor || 0),
                lastOrderAt: customer.last_order_at,
                needsReviewFollowup: Boolean(customer.needs_review_followup)
            }))
        }
    };
}

function buildCompetitorComparison(rows) {
    const factualResults = rows.map((row) => ({
        competitorId: Number(row.competitor_id),
        competitorName: row.name,
        retrievedAt: row.retrieved_at,
        previousRetrievedAt: row.previous_retrieved_at || null,
        sourceName: row.source_name || row.configured_source_name || null,
        sourceUrl: row.source_url || row.configured_source_url || null,
        sourceMode: row._source_mode || 'stored',
        currency: normalizeCurrency(row.currency),
        products: normalizeCompetitorProducts(row.products, row.currency),
        offers: normalizeCompetitorOffers(row.offers),
        positioning: cleanWorkflowText(row.positioning, 2000) || null
    }));

    const previousById = new Map(rows.map((row) => [Number(row.competitor_id), {
        retrievedAt: row.previous_retrieved_at || null,
        currency: normalizeCurrency(row.previous_currency),
        products: normalizeCompetitorProducts(row.previous_products, row.previous_currency),
        offers: normalizeCompetitorOffers(row.previous_offers),
        positioning: cleanWorkflowText(row.previous_positioning, 2000) || null
    }]));

    const priceGroups = new Map();
    for (const competitor of factualResults) {
        for (const product of competitor.products) {
            if (!product.name || product.priceMinor === null || !product.currency) continue;
            const key = normalizeComparableName(product.name);
            if (!key) continue;
            const entries = priceGroups.get(key) || [];
            entries.push({
                competitorId: competitor.competitorId,
                competitorName: competitor.competitorName,
                productName: product.name,
                priceMinor: product.priceMinor,
                currency: product.currency,
                sourceUrl: competitor.sourceUrl
            });
            priceGroups.set(key, entries);
        }
    }

    const comparablePrices = [...priceGroups.values()]
        .filter((entries) => entries.length >= 2 && new Set(entries.map((entry) => entry.currency)).size === 1)
        .map((entries) => {
            const prices = entries.map((entry) => entry.priceMinor);
            const lowestPriceMinor = Math.min(...prices);
            const highestPriceMinor = Math.max(...prices);
            return {
                productName: entries[0].productName,
                currency: entries[0].currency,
                lowestPriceMinor,
                highestPriceMinor,
                priceRangeMinor: highestPriceMinor - lowestPriceMinor,
                competitors: entries.sort((left, right) => left.priceMinor - right.priceMinor)
            };
        })
        .sort((left, right) => right.priceRangeMinor - left.priceRangeMinor);

    const changes = factualResults.map((current) => {
        const previous = previousById.get(current.competitorId);
        if (!previous?.retrievedAt) {
            return {
                competitorId: current.competitorId,
                competitorName: current.competitorName,
                hasBaseline: false,
                previousRetrievedAt: null,
                productLaunches: [],
                removedProducts: [],
                pricingChanges: [],
                offerChanges: { added: [], removed: [] },
                positioningChanged: false,
                changeCount: 0
            };
        }
        const productLaunches = current.products.filter((item) => !previous.products.some((candidate) => sameCompetitorProduct(item, candidate)));
        const removedProducts = previous.products.filter((item) => !current.products.some((candidate) => sameCompetitorProduct(item, candidate)));
        const pricingChanges = compareCompetitorPrices(current.products, previous.products);
        const offerChanges = compareCompetitorOffers(current.offers, previous.offers);
        const positioningChanged = normalizeComparisonText(current.positioning) !== normalizeComparisonText(previous.positioning);
        return {
            competitorId: current.competitorId,
            competitorName: current.competitorName,
            hasBaseline: true,
            previousRetrievedAt: previous.retrievedAt,
            productLaunches,
            removedProducts,
            pricingChanges,
            offerChanges,
            positioningChanged,
            changeCount: productLaunches.length
                + removedProducts.length
                + pricingChanges.length
                + offerChanges.added.length
                + offerChanges.removed.length
                + (positioningChanged ? 1 : 0)
        };
    });

    const productEntries = factualResults.reduce((sum, item) => sum + item.products.length, 0);
    const offerEntries = factualResults.reduce((sum, item) => sum + item.offers.length, 0);
    const totalDetectedChanges = changes.reduce((sum, item) => sum + item.changeCount, 0);

    return {
        factualResults,
        changes,
        sourceSummary: factualResults.map((item) => ({
            competitorId: item.competitorId,
            competitorName: item.competitorName,
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
            retrievedAt: item.retrievedAt,
            previousRetrievedAt: item.previousRetrievedAt,
            sourceMode: item.sourceMode
        })),
        calculatedMetrics: {
            competitorsWithCurrentSnapshots: factualResults.length,
            productEntries,
            offerEntries,
            comparableProductGroups: comparablePrices,
            competitorsWithBaselines: changes.filter((item) => item.hasBaseline).length,
            competitorsWithDetectedChanges: changes.filter((item) => item.changeCount > 0).length,
            totalDetectedChanges
        }
    };
}

function overlayUnpersistedLiveSnapshots({ storedRows, initialRows, liveRows, persistedIds, retrievedAt }) {
    const storedById = new Map((Array.isArray(storedRows) ? storedRows : []).map((row) => [Number(row.competitor_id), { ...row }]));
    const initialById = new Map((Array.isArray(initialRows) ? initialRows : []).map((row) => [Number(row.competitor_id), row]));
    const liveById = new Map((Array.isArray(liveRows) ? liveRows : []).map((row) => [Number(row.id), row]));

    for (const [competitorId, live] of liveById) {
        const stored = storedById.get(competitorId) || initialById.get(competitorId);
        if (!stored) continue;
        if (persistedIds.has(competitorId)) {
            const current = storedById.get(competitorId);
            if (current) current._source_mode = 'live';
            continue;
        }
        const initial = initialById.get(competitorId) || stored;
        storedById.set(competitorId, {
            ...stored,
            snapshot_id: `live:${competitorId}:${retrievedAt}`,
            retrieved_at: retrievedAt,
            source_name: live.sourceName || 'public-website',
            source_url: live.sourceUrl || stored.configured_source_url || null,
            currency: live.currency || null,
            products: Array.isArray(live.products) ? live.products : [],
            offers: Array.isArray(live.offers) ? live.offers : [],
            positioning: live.positioning || live.description || null,
            raw_metadata: live.rawMetadata || {},
            previous_snapshot_id: initial.snapshot_id || null,
            previous_retrieved_at: initial.retrieved_at || null,
            previous_source_name: initial.source_name || null,
            previous_source_url: initial.source_url || null,
            previous_currency: initial.currency || null,
            previous_products: Array.isArray(initial.products) ? initial.products : [],
            previous_offers: Array.isArray(initial.offers) ? initial.offers : [],
            previous_positioning: initial.positioning || null,
            previous_raw_metadata: initial.raw_metadata || {},
            _source_mode: 'live'
        });
    }

    for (const row of storedById.values()) {
        if (!row._source_mode) row._source_mode = 'stored';
    }
    return [...storedById.values()].sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')) || Number(left.competitor_id) - Number(right.competitor_id));
}

async function recoverBlockedCompetitorSources({ failures, competitors, geminiService, log }) {
    const available = [];
    const failed = [];
    const attemptedIds = [];
    const aiConfigured = Boolean(geminiService?.getPublicConfiguration?.().isConfigured);
    if (!aiConfigured || typeof geminiService?.generateGroundedWebJson !== 'function') return { available, failures: failed, attemptedIds };

    const competitorById = new Map((Array.isArray(competitors) ? competitors : []).map((item) => [Number(item.competitor_id), item]));
    for (const failure of Array.isArray(failures) ? failures : []) {
        if (!shouldGroundCompetitorFailure(failure)) continue;
        const competitor = competitorById.get(Number(failure?.id));
        if (!competitor?.configured_source_url) continue;
        attemptedIds.push(Number(competitor.competitor_id));
        try {
            const recovered = await buildGroundedCompetitorSnapshot({ competitor, failure, geminiService });
            if (recovered) {
                available.push(recovered);
                await log?.('info', `Recovered ${recovered.name} with Gemini Google Search grounding after the configured website rejected the server request.`, {
                    competitorId: recovered.id,
                    provider: recovered.sourceName,
                    directErrorCode: failure?.errorCode || null,
                    directStatusCode: Number(failure?.statusCode) || null
                });
            }
        } catch (error) {
            failed.push({
                ...failure,
                errorCode: error.code || failure?.errorCode || 'GROUNDED_WEB_FALLBACK_FAILED',
                error: `Direct source failed and grounded public-web fallback was unavailable: ${error.publicMessage || error.message || 'Unknown grounded fallback error.'}`
            });
            await log?.('warning', `Grounded public-web recovery failed for ${competitor.name}.`, {
                competitorId: Number(competitor.competitor_id),
                code: error.code || null
            });
        }
    }
    return { available, failures: failed, attemptedIds };
}

function shouldGroundCompetitorFailure(failure) {
    const code = String(failure?.errorCode || '').trim().toUpperCase();
    const status = Number(failure?.statusCode);
    if (['PRIVATE_NETWORK_BLOCKED', 'INVALID_URL', 'INVALID_URL_PROTOCOL', 'INVALID_URL_CREDENTIALS'].includes(code)) return false;
    if (Number.isFinite(status) && [401, 403, 406, 409, 423, 425, 429, 500, 502, 503, 504].includes(status)) return true;
    return ['HTTP_TIMEOUT', 'HTTP_BODY_TOO_LARGE', 'HTTP_UPSTREAM_ERROR', 'ECONNRESET', 'ENOTFOUND', 'DNS_LOOKUP_FAILED'].includes(code);
}

async function buildGroundedCompetitorSnapshot({ competitor, failure, geminiService }) {
    const name = cleanWorkflowText(competitor?.name, 240) || 'Competitor';
    const configuredUrl = safeWorkflowUrl(competitor?.configured_source_url);
    if (!configuredUrl) return null;
    const prompt = [
        `Research the competitor ${JSON.stringify(name)} using current public web evidence.`,
        `The configured official source is ${configuredUrl}. The OrexisAI server could not fetch it directly (${cleanWorkflowText(failure?.errorCode, 80) || 'request failure'}${Number(failure?.statusCode) ? `, HTTP ${Number(failure.statusCode)}` : ''}).`,
        'Use Google Search grounding. If URL Context is available, also use the configured official URL.',
        'Prefer the competitor\'s official pages. Secondary public pages may be used only when they clearly describe the named competitor and the exact claim.',
        'Return only JSON with this shape:',
        '{"title":string|null,"description":string|null,"positioning":string|null,"currency":string|null,"products":[{"name":string,"priceMinor":integer|null,"currency":string|null,"availability":string|null,"url":string|null}],"offers":[{"name":string,"price":string|null,"currency":string|null,"description":string|null,"availability":string|null,"url":string|null}],"observations":[string]}',
        'For products, include only products or plans whose names are explicitly supported by retrieved evidence. Include priceMinor only when an exact current public price is supported; convert the displayed major-unit price into the currency\'s minor units (for example USD 129.00 => 12900).',
        'For offers, include only explicitly advertised public offers. Do not infer discounts, market share, demand, sentiment, quality, revenue, traffic, or hidden promotions.',
        'If a field is not supported, use null or an empty array. Keep at most 20 products and 20 offers.'
    ].join('\n');

    const grounded = await geminiService.generateGroundedWebJson({
        prompt,
        maxOutputTokens: 8_192,
        instruction: 'You are the sourced-data retrieval stage for a competitor intelligence workflow. Accuracy and source grounding are more important than completeness.'
    });
    const data = grounded?.data && typeof grounded.data === 'object' ? grounded.data : {};
    const groundingSources = normalizeGroundingSources(grounded?.groundingSources);
    if (groundingSources.length === 0) return null;

    const products = normalizeGroundedCompetitorProducts(data.products);
    const offers = normalizeGroundedCompetitorOffers(data.offers);
    const positioning = cleanWorkflowText(data.positioning || data.description || data.title, 2000) || null;
    const observations = (Array.isArray(data.observations) ? data.observations : [])
        .map((item) => cleanWorkflowText(item, 600))
        .filter(Boolean)
        .slice(0, 20);
    if (!positioning && products.length === 0 && offers.length === 0 && observations.length === 0) return null;

    const primarySource = chooseGroundedPrimarySource(groundingSources, configuredUrl) || configuredUrl;
    return {
        id: Number(competitor.competitor_id),
        name,
        sourceName: 'gemini-google-search',
        sourceUrl: primarySource,
        status: 'available',
        title: cleanWorkflowText(data.title, 500) || null,
        description: cleanWorkflowText(data.description, 2000) || null,
        positioning: positioning || observations.join(' '),
        text: [data.title, data.description, data.positioning, ...observations].map((item) => cleanWorkflowText(item, 2000)).filter(Boolean).join('\n').slice(0, 20_000),
        currency: normalizeCurrency(data.currency) || singleGroundedCurrency(products),
        products,
        offers,
        rawMetadata: {
            recoveryMode: 'gemini-google-search-grounding',
            configuredSourceUrl: configuredUrl,
            directFailure: {
                code: cleanWorkflowText(failure?.errorCode, 80) || null,
                statusCode: Number(failure?.statusCode) || null
            },
            model: cleanWorkflowText(grounded?.model, 120) || null,
            groundingSources,
            observations
        }
    };
}

function normalizeGroundedCompetitorProducts(value) {
    return (Array.isArray(value) ? value : []).slice(0, 20).map((item) => {
        const currency = normalizeCurrency(item?.currency);
        const explicitMinor = Number(item?.priceMinor ?? item?.price_minor);
        return {
            name: cleanWorkflowText(item?.name, 240) || null,
            priceMinor: Number.isSafeInteger(explicitMinor) && explicitMinor >= 0 ? explicitMinor : null,
            currency,
            availability: cleanWorkflowText(item?.availability, 240) || null,
            url: safeWorkflowUrl(item?.url)
        };
    }).filter((item) => item.name && (item.priceMinor === null || item.currency));
}

function normalizeGroundedCompetitorOffers(value) {
    return (Array.isArray(value) ? value : []).slice(0, 20).map((item) => ({
        name: cleanWorkflowText(item?.name, 240) || null,
        price: cleanWorkflowText(item?.price, 80) || null,
        currency: normalizeCurrency(item?.currency),
        description: cleanWorkflowText(item?.description, 500) || null,
        availability: cleanWorkflowText(item?.availability, 240) || null,
        url: safeWorkflowUrl(item?.url)
    })).filter((item) => item.name || item.price || item.description);
}

function normalizeGroundingSources(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map((item) => ({
        url: safeWorkflowUrl(item?.url),
        title: cleanWorkflowText(item?.title, 300) || null,
        kind: cleanWorkflowText(item?.kind, 80) || 'web'
    })).filter((item) => item.url && !seen.has(item.url) && seen.add(item.url)).slice(0, 20);
}

function chooseGroundedPrimarySource(sources, configuredUrl) {
    let configuredHost = '';
    try { configuredHost = new URL(configuredUrl).hostname.replace(/^www\./i, '').toLowerCase(); } catch {}
    const sameHost = (Array.isArray(sources) ? sources : []).find((item) => {
        try { return new URL(item.url).hostname.replace(/^www\./i, '').toLowerCase() === configuredHost; } catch { return false; }
    });
    return sameHost?.url || sources?.[0]?.url || null;
}

function singleGroundedCurrency(products) {
    const currencies = [...new Set((Array.isArray(products) ? products : []).map((item) => item.currency).filter(Boolean))];
    return currencies.length === 1 ? currencies[0] : null;
}

function summarizeCompetitorSourceFailures(failures) {
    return (Array.isArray(failures) ? failures : [])
        .slice(0, 4)
        .map((failure) => {
            const name = cleanWorkflowText(failure?.name, 120) || 'Competitor';
            const code = cleanWorkflowText(failure?.errorCode, 80);
            const status = Number(failure?.statusCode);
            const reason = cleanWorkflowText(failure?.error, 240) || 'The configured public source could not be retrieved.';
            const detail = [code, Number.isFinite(status) && status > 0 ? `HTTP ${status}` : null].filter(Boolean).join('/');
            return `${name}: ${detail ? `${detail} — ` : ''}${reason}`;
        })
        .join(' | ');
}

function buildCompetitorLimitations({ refreshRequested, refresh, liveFailures, persistenceFailure, configuredSources, effectiveRows }) {
    const limitations = [];
    if (!refreshRequested) limitations.push('Live competitor refresh was disabled for this run; the audit used stored sourced snapshots.');
    if (refreshRequested && configuredSources.length === 0) limitations.push('No competitor public source URLs are configured; only stored sourced snapshots could be used.');
    if (refreshRequested && refresh?.status === 'unavailable' && refresh?.reason) limitations.push(`Live competitor refresh: ${String(refresh.reason).slice(0, 500)}`);
    for (const failure of Array.isArray(liveFailures) ? liveFailures : []) {
        limitations.push(`${cleanWorkflowText(failure?.name, 160) || 'Competitor source'}: ${cleanWorkflowText(failure?.error, 500) || 'The configured public source could not be retrieved.'}`);
    }
    if (persistenceFailure) limitations.push('One or more live competitor responses could not be added to snapshot history; the verified live response was still used for this run.');
    for (const row of Array.isArray(effectiveRows) ? effectiveRows : []) {
        if (row._source_mode === 'stored' && row.configured_source_url) {
            limitations.push(`${cleanWorkflowText(row.name, 160) || 'Competitor'} used its latest stored snapshot because no verified live refresh was saved for this run.`);
        }
    }
    return [...new Set(limitations.filter(Boolean))];
}

function normalizeCompetitorProducts(value, fallbackCurrency) {
    const products = Array.isArray(value) ? value : [];
    return products.slice(0, 100).map((item) => {
        const currency = normalizeCurrency(item?.currency || fallbackCurrency);
        return {
            name: cleanWorkflowText(item?.name || item?.product, 240) || null,
            priceMinor: competitorPriceMinor(item, currency),
            currency,
            availability: cleanWorkflowText(item?.availability, 240) || null,
            url: safeWorkflowUrl(item?.url)
        };
    }).filter((item) => item.name || item.priceMinor !== null);
}

function normalizeCompetitorOffers(value) {
    return (Array.isArray(value) ? value : []).slice(0, 100).map((item) => ({
        name: cleanWorkflowText(item?.name || item?.title || item?.description, 240) || null,
        price: cleanWorkflowText(item?.price, 80) || null,
        currency: normalizeCurrency(item?.currency),
        availability: cleanWorkflowText(item?.availability, 240) || null,
        url: safeWorkflowUrl(item?.url),
        description: cleanWorkflowText(item?.description, 500) || null
    })).filter((item) => item.name || item.price || item.description);
}

function competitorPriceMinor(item, currency) {
    const explicitMinor = Number(item?.priceMinor ?? item?.price_minor);
    if (Number.isFinite(explicitMinor) && explicitMinor >= 0) return Math.round(explicitMinor);
    const amount = Number(item?.price);
    if (!Number.isFinite(amount) || amount < 0 || !currency) return null;
    let digits = 2;
    try {
        digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    } catch {}
    return Math.round(amount * (10 ** digits));
}

function compareCompetitorPrices(currentProducts, previousProducts) {
    const changes = [];
    for (const current of currentProducts) {
        const previous = previousProducts.find((item) => sameCompetitorProduct(current, item));
        if (!previous || current.priceMinor === null || previous.priceMinor === null) continue;
        if (!current.currency || !previous.currency || current.currency !== previous.currency) continue;
        if (current.priceMinor === previous.priceMinor) continue;
        changes.push({
            productName: current.name,
            currency: current.currency,
            previousPriceMinor: previous.priceMinor,
            currentPriceMinor: current.priceMinor,
            changeMinor: current.priceMinor - previous.priceMinor,
            changePercentage: previous.priceMinor === 0 ? null : ((current.priceMinor - previous.priceMinor) / previous.priceMinor) * 100
        });
    }
    return changes;
}

function compareCompetitorOffers(currentOffers, previousOffers) {
    const previousKeys = new Set(previousOffers.map(competitorOfferKey));
    const currentKeys = new Set(currentOffers.map(competitorOfferKey));
    return {
        added: currentOffers.filter((item) => !previousKeys.has(competitorOfferKey(item))),
        removed: previousOffers.filter((item) => !currentKeys.has(competitorOfferKey(item)))
    };
}

function competitorOfferKey(item) {
    return [item?.name, item?.price, item?.currency, item?.description, item?.availability]
        .map(normalizeComparisonText)
        .join('|');
}

function sameCompetitorProduct(left, right) {
    const leftName = normalizeComparableName(left?.name || left?.product);
    const rightName = normalizeComparableName(right?.name || right?.product);
    return Boolean(leftName && rightName && leftName === rightName);
}

function normalizeComparableName(value) {
    return cleanWorkflowText(value, 240).toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function normalizeComparisonText(value) {
    return cleanWorkflowText(value, 1000).toLocaleLowerCase('en-US');
}

function normalizeCurrency(value) {
    const currency = String(value || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function safeWorkflowUrl(value) {
    const url = String(value || '').trim();
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString().slice(0, 2000) : null;
    } catch {
        return null;
    }
}

function cleanWorkflowText(value, maxLength = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function analyzeReview(review) {
    const text = String(review.review_text || '');
    const normalized = text.toLocaleLowerCase('en-US');
    const positiveWords = ['great', 'excellent', 'amazing', 'love', 'helpful', 'fast', 'perfect', 'good', 'happy', 'recommend'];
    const negativeWords = ['bad', 'poor', 'slow', 'broken', 'late', 'refund', 'problem', 'issue', 'disappointed', 'worst', 'missing'];
    const positiveScore = positiveWords.filter((word) => normalized.includes(word)).length;
    const negativeScore = negativeWords.filter((word) => normalized.includes(word)).length;
    const rating = review.rating === null ? null : Number(review.rating);
    let sentiment = 'neutral';
    if ((rating !== null && rating >= 4) || positiveScore > negativeScore) sentiment = 'positive';
    if ((rating !== null && rating <= 2) || negativeScore > positiveScore) sentiment = 'negative';
    const concerns = [];
    for (const [label, terms] of Object.entries({
        delivery: ['late', 'delivery', 'shipping', 'arrived'],
        product: ['broken', 'quality', 'missing', 'damaged', 'product'],
        billing: ['refund', 'charged', 'payment', 'price'],
        support: ['support', 'reply', 'response', 'service', 'staff']
    })) {
        if (terms.some((term) => normalized.includes(term))) concerns.push(label);
    }
    return {
        reviewId: Number(review.id),
        externalId: review.external_id,
        sentiment,
        concerns,
        rating
    };
}

async function generateReviewDrafts({ geminiService, reviews, analyses, businessName }) {
    const factualPayload = reviews.map((review) => ({
        id: Number(review.id),
        externalId: review.external_id,
        provider: review.provider,
        rating: review.rating === null ? null : Number(review.rating),
        reviewText: review.review_text,
        analysis: analyses.find((item) => item.reviewId === Number(review.id))
    }));
    const ai = await generateGroundedInsights({
        geminiService,
        workflowName: 'Review Responder',
        facts: { businessName, reviews: factualPayload },
        instruction: [
            'Return only valid JSON with this shape: {"drafts":[{"id":number,"externalId":string,"response":string}]}.',
            'Draft one concise professional response for every supplied review.',
            'Use only facts in each review. Do not promise refunds, replacements, contact, investigation, or actions that are not confirmed.',
            'Do not include private data. Keep each response under 1,000 characters.'
        ].join(' '),
        expectJson: true
    });
    if (ai.status !== 'generated' || !ai.data || !Array.isArray(ai.data.drafts)) {
        return { ai, drafts: factualPayload.map((review) => ({ id: review.id, externalId: review.externalId, response: null })) };
    }
    const allowed = new Map(factualPayload.map((review) => [`${review.id}:${review.externalId}`, review]));
    const drafts = ai.data.drafts
        .map((draft) => ({
            id: Number(draft?.id),
            externalId: String(draft?.externalId || ''),
            response: String(draft?.response || '').trim().slice(0, 1000)
        }))
        .filter((draft) => draft.response && allowed.has(`${draft.id}:${draft.externalId}`));
    const byKey = new Map(drafts.map((draft) => [`${draft.id}:${draft.externalId}`, draft]));
    return {
        ai,
        drafts: factualPayload.map((review) => byKey.get(`${review.id}:${review.externalId}`) || {
            id: review.id,
            externalId: review.externalId,
            response: null
        })
    };
}

async function generateGroundedInsights({ geminiService, workflowName, facts, instruction, expectJson = false }) {
    const configuration = geminiService.getPublicConfiguration();
    if (!configuration.isConfigured) {
        return {
            status: 'unavailable',
            reason: 'GEMINI_API_KEY is not configured. Factual and calculated results remain available without AI recommendations.'
        };
    }
    const serialized = JSON.stringify(facts);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_AI_FACT_BYTES) {
        return {
            status: 'unavailable',
            reason: 'The verified fact payload is too large for safe AI analysis. Narrow the date range and run again.'
        };
    }
    const prompt = [
        `Workflow: ${workflowName}`,
        'The JSON below contains the only verified facts you may use.',
        'Keep factual database results, calculated metrics, and recommendations clearly separated.',
        'Never invent or infer missing business facts.',
        instruction,
        'VERIFIED_JSON:',
        serialized
    ].join('\n\n');
    try {
        const response = await geminiService.generateReply([{ role: 'user', content: prompt }]);
        if (!expectJson) {
            return { status: 'generated', model: response.model, content: response.content };
        }
        const data = parseJsonResponse(response.content);
        if (!data) {
            return {
                status: 'unavailable',
                reason: 'The AI provider returned an invalid structured response, so no draft was saved.'
            };
        }
        return { status: 'generated', model: response.model, data };
    } catch (error) {
        return {
            status: 'unavailable',
            code: error.code || 'AI_PROVIDER_ERROR',
            reason: error.publicMessage || 'AI analysis is temporarily unavailable.'
        };
    }
}

function resolveInventoryPeriod(input) {
    if (input?.from || input?.to) return resolveComparablePeriod({ from: input.from, to: input.to });
    const to = new Date();
    const from = new Date(to.getTime() - (28 * 24 * 60 * 60 * 1000));
    const previousFrom = new Date(from.getTime() - (28 * 24 * 60 * 60 * 1000));
    return {
        current: { from, to },
        previous: { from: previousFrom, to: from },
        days: 28
    };
}

function createReviewResponseConnector({ env, fetchImpl }) {
    const endpoint = String(env.REVIEW_RESPONSE_API_URL || '').trim();
    const token = String(env.REVIEW_RESPONSE_API_TOKEN || '').trim();
    const timeoutMs = parseBoundedInteger(env.REVIEW_RESPONSE_TIMEOUT_MS, 10_000, 1_000, 30_000);
    return {
        isConfigured: Boolean(endpoint),
        async send(payload) {
            if (!endpoint) {
                throw createWorkflowError(
                    'REVIEW_RESPONSE_INTEGRATION_REQUIRED',
                    'The response is approved, but sending requires REVIEW_RESPONSE_API_URL to be connected to your review provider.',
                    409
                );
            }
            if (typeof fetchImpl !== 'function') {
                throw createWorkflowError('REVIEW_RESPONSE_UNAVAILABLE', 'The review provider cannot be reached by this server runtime.', 500);
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetchImpl(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
                if (!response.ok) {
                    throw createWorkflowError('REVIEW_RESPONSE_PROVIDER_ERROR', 'The review provider rejected the response. The approved draft was kept.', 502);
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw createWorkflowError('REVIEW_RESPONSE_TIMEOUT', 'The review provider timed out. The approved draft was kept.', 504);
                }
                if (error.code) throw error;
                throw createWorkflowError('REVIEW_RESPONSE_PROVIDER_ERROR', 'The review provider could not be reached. The approved draft was kept.', 502);
            } finally {
                clearTimeout(timeout);
            }
        }
    };
}

function parseJsonResponse(content) {
    const text = String(content || '').trim();
    const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
        return JSON.parse(unfenced);
    } catch {
        const start = unfenced.indexOf('{');
        const end = unfenced.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(unfenced.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

function serializeSchedule(row) {
    return {
        id: Number(row.id),
        businessId: Number(row.business_id),
        workflowSlug: row.workflow_slug,
        scheduleKind: row.schedule_kind,
        cadence: row.cadence,
        runHour: Number(row.run_hour),
        runMinute: Number(row.run_minute),
        dayOfWeek: row.day_of_week === null ? null : Number(row.day_of_week),
        dayOfMonth: row.day_of_month === null ? null : Number(row.day_of_month),
        timezone: row.timezone,
        input: row.input || {},
        enabled: Boolean(row.enabled),
        nextRunAt: row.next_run_at,
        lastRunAt: row.last_run_at || null,
        lastRunId: row.last_run_id === null ? null : Number(row.last_run_id),
        lastStatus: row.last_status || null,
        lastError: row.last_error || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function serializeWorkflowDefinition(workflow) {
    return {
        slug: workflow.slug,
        name: workflow.name,
        description: workflow.description,
        resultView: workflow.resultView,
        steps: workflow.steps.map((step) => ({ key: step.key, title: step.title }))
    };
}

function serializeBusiness(business) {
    return {
        id: Number(business.id),
        name: business.name,
        currency: business.currency,
        timezone: business.timezone
    };
}

function serializeBusinessProfile(business) {
    const row = business && typeof business === 'object' ? business : {};
    return {
        id: Number(row.id),
        name: row.name || '',
        businessType: row.business_type || row.businessType || '',
        industry: row.industry || '',
        productsServices: asArray(row.products_services ?? row.productsServices),
        websiteUrl: row.website_url || row.websiteUrl || '',
        location: asObject(row.location),
        countryCode: row.country_code || row.countryCode || '',
        latitude: finiteNumberOrNull(row.latitude),
        longitude: finiteNumberOrNull(row.longitude),
        targetAudience: row.target_audience || row.targetAudience || '',
        brandVoice: row.brand_voice || row.brandVoice || '',
        socialMediaAccounts: asObject(row.social_media_accounts ?? row.socialMediaAccounts),
        marketingGoals: asArray(row.marketing_goals ?? row.marketingGoals),
        googlePlaceId: row.google_place_id || row.googlePlaceId || '',
        currency: row.currency || 'USD',
        timezone: row.timezone || 'UTC'
    };
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function serializePeriod(period) {
    return {
        from: new Date(period.from).toISOString(),
        to: new Date(period.to).toISOString()
    };
}

function serializeRun(run) {
    return {
        id: Number(run.id),
        businessId: run.business_id === null || run.business_id === undefined ? null : Number(run.business_id),
        workflowSlug: run.workflow_slug,
        workflowName: run.workflow_name,
        status: run.status,
        input: run.input || {},
        output: run.output || null,
        error: run.error_message || null,
        dataPeriodStart: run.data_period_start || null,
        dataPeriodEnd: run.data_period_end || null,
        dataRetrievedAt: run.data_retrieved_at || null,
        recordsAnalyzed: Number(run.records_analyzed || 0),
        durationMs: run.duration_ms === null || run.duration_ms === undefined ? null : Number(run.duration_ms),
        progressPercentage: Number(run.progress_percentage || 0),
        currentStep: run.current_step || null,
        estimatedCompletionAt: run.estimated_completion_at || null,
        createdAt: run.created_at,
        startedAt: run.started_at || null,
        completedAt: run.completed_at || null,
        steps: Array.isArray(run.steps) ? run.steps.map((step) => ({
            key: step.step_key,
            title: step.step_title,
            order: Number(step.step_order),
            status: step.status,
            error: step.error_message || null
        })) : undefined,
        logs: Array.isArray(run.logs) ? run.logs.map((entry) => ({
            id: Number(entry.id), level: entry.level, stepKey: entry.step_key || null,
            message: entry.message, metadata: entry.metadata || {}, createdAt: entry.created_at
        })) : undefined,
        artifacts: Array.isArray(run.artifacts) ? run.artifacts.map(serializeArtifact) : undefined
    };
}

function summarizeStepOutput(output) {
    if (!output || typeof output !== 'object') return output;
    if (Array.isArray(output)) return { records: output.length };
    if (output.business && output.retrievedAt) {
        return { retrievedAt: output.retrievedAt, businessId: Number(output.business.id) };
    }
    return output;
}

function sumRecordCounts(counts) {
    return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function startWorkflowHeartbeat({ database, runId, businessId, staleAfterSeconds }) {
    const intervalMs = Math.max(1000, Math.min(30000, Math.floor(staleAfterSeconds * 1000 / 3)));
    const heartbeat = setInterval(() => {
        Promise.resolve(database.touchWorkflowRun?.({ runId, businessId }))
            .then((touched) => {
                if (!touched) clearInterval(heartbeat);
            })
            .catch(() => {});
    }, intervalMs);
    heartbeat.unref?.();
    return heartbeat;
}

function withWorkflowExecutionTimeout(operation, maxRunSeconds) {
    let timeout = null;
    const timeoutPromise = new Promise((resolve, reject) => {
        void resolve;
        timeout = setTimeout(() => {
            reject(createWorkflowError(
                'WORKFLOW_TIMEOUT',
                'The workflow exceeded its maximum execution time and was safely stopped. Run it again after checking the connected data provider.',
                504
            ));
        }, maxRunSeconds * 1000);
        timeout.unref?.();
    });
    return Promise.race([Promise.resolve().then(operation), timeoutPromise])
        .finally(() => { if (timeout) clearTimeout(timeout); });
}

function assertWorkflowDeadline(deadlineAt) {
    if (Number.isFinite(deadlineAt) && Date.now() >= deadlineAt) {
        throw createWorkflowError(
            'WORKFLOW_TIMEOUT',
            'The workflow exceeded its maximum execution time and was safely stopped. Run it again after checking the connected data provider.',
            504
        );
    }
}

function emit(callback, type, payload) {
    try {
        callback({ type, ...payload, timestamp: new Date().toISOString() });
    } catch {
        // Streaming disconnects must not interrupt database execution.
    }
}

function createWorkflowError(code, publicMessage, statusCode = 500) {
    const error = new Error(publicMessage);
    error.code = code;
    error.publicMessage = publicMessage;
    error.statusCode = statusCode;
    return error;
}

function parseBoundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

module.exports = {
    buildMarketingResult,
    buildOverview,
    createWorkflowError,
    createWorkflowService
};
