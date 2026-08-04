'use strict';

const { getWorkflow, listWorkflows } = require('./registry');
const {
    calculateInventoryForecast,
    growthPercentage,
    resolveComparablePeriod,
    safeDivide
} = require('./calculations');

const MAX_AI_FACT_BYTES = 96 * 1024;
const MAX_REVIEW_BATCH = 20;

function createWorkflowService({ database, geminiService, env = process.env, fetchImpl = globalThis.fetch }) {
    if (!database) throw new TypeError('A database service is required.');
    if (!geminiService) throw new TypeError('An AI service is required.');

    const reviewResponseConnector = createReviewResponseConnector({ env, fetchImpl });

    return {
        listDefinitions() {
            return listWorkflows().map(serializeWorkflowDefinition);
        },

        async execute({ userId, slug, input = {}, onEvent = () => {} }) {
            const workflow = getWorkflow(slug);
            if (!workflow) throw createWorkflowError('WORKFLOW_NOT_FOUND', 'That workflow does not exist.', 404);

            const business = await database.getOrCreateBusinessForUser(userId);
            const run = await database.createWorkflowRun({ userId, businessId: business.id, workflow, input });
            emit(onEvent, 'run', { run: serializeRun(run) });
            const startedAt = Date.now();

            await database.updateWorkflowRun({
                runId: run.id,
                status: 'running',
                businessId: business.id
            });
            emit(onEvent, 'status', { status: 'running', runId: Number(run.id) });

            const step = createStepExecutor({ database, onEvent, runId: run.id });
            let execution;
            try {
                execution = await executeBySlug({
                    workflow,
                    userId,
                    business,
                    input,
                    step,
                    database,
                    geminiService
                });
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
                    durationMs
                });
                const result = { ...serializeRun(saved), steps: undefined };
                emit(onEvent, 'completed', { run: result, output: execution.output });
                return { run: result, output: execution.output };
            } catch (error) {
                const durationMs = Date.now() - startedAt;
                await database.updateWorkflowRun({
                    runId: run.id,
                    status: 'failed',
                    output: execution?.output || null,
                    errorMessage: error.publicMessage || 'The workflow could not produce a trustworthy result.',
                    businessId: business.id,
                    periodStart: execution?.period?.from || null,
                    periodEnd: execution?.period?.to || null,
                    dataRetrievedAt: execution?.dataRetrievedAt || new Date().toISOString(),
                    recordsAnalyzed: execution?.recordsAnalyzed || 0,
                    durationMs
                }).catch(() => {});
                emit(onEvent, 'failed', {
                    code: error.code || 'WORKFLOW_FAILED',
                    error: error.publicMessage || 'The workflow could not produce a trustworthy result.',
                    runId: Number(run.id)
                });
                throw error;
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

        getConnectorConfiguration() {
            return {
                reviewResponsesConfigured: reviewResponseConnector.isConfigured
            };
        }
    };
}

async function executeBySlug(context) {
    switch (context.workflow.slug) {
        case 'weekly-marketing':
            return executeWeeklyMarketing(context);
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

async function executeWeeklyMarketing({ userId, business, input, step, database, geminiService }) {
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
            business: serializeBusiness(data.business),
            dataPeriod: serializePeriod(period.current),
            previousPeriod: serializePeriod(period.previous),
            recordsAnalyzed,
            factualResults: calculated.factualResults,
            calculatedMetrics: calculated.calculatedMetrics,
            aiInsights: ai
        }
    };
}

async function executeCompetitorAudit({ userId, business, step, database, geminiService }) {
    await step('resolve-business', async () => ({ businessId: Number(business.id), businessName: business.name }));
    const data = await step('fetch-competitor-data', () => database.getCompetitorAuditData({
        userId,
        businessId: business.id
    }));
    const sourced = await step('validate-data', async () => {
        if (data.competitors.length === 0) {
            throw createWorkflowError(
                'COMPETITOR_INTEGRATION_REQUIRED',
                'No competitors are configured. Import competitor records and snapshots from a legitimate API or connected data source before running this audit.',
                422
            );
        }
        const available = data.competitors.filter((item) => item.snapshot_id && item.retrieved_at);
        if (available.length === 0) {
            throw createWorkflowError(
                'COMPETITOR_DATA_UNAVAILABLE',
                'Competitors are configured, but no retrieved snapshots are available. Connect a legitimate competitor-data API or import current sourced snapshots.',
                422
            );
        }
        return available;
    });
    const comparison = await step('compare-competitors', async () => buildCompetitorComparison(sourced));
    const ai = await step('generate-insights', async () => generateGroundedInsights({
        geminiService,
        workflowName: 'Competitor Audit',
        facts: comparison,
        instruction: [
            'Compare pricing, products, positioning, and offers only when those fields exist in the supplied snapshots.',
            'Generate actionable positioning and response recommendations.',
            'Cite competitor names and retrieval timestamps in the analysis.',
            'Do not infer missing prices, offers, market share, customer sentiment, or product quality.'
        ].join(' ')
    }));
    const dates = sourced.map((item) => new Date(item.retrieved_at)).filter((date) => !Number.isNaN(date.getTime()));
    const period = dates.length > 0
        ? { from: new Date(Math.min(...dates)), to: new Date(Math.max(...dates)) }
        : null;
    return {
        period,
        dataRetrievedAt: data.retrievedAt,
        recordsAnalyzed: sourced.length,
        output: {
            workflow: 'competitor-audit',
            trustworthy: true,
            business: serializeBusiness(data.business),
            dataPeriod: period ? serializePeriod(period) : null,
            recordsAnalyzed: sourced.length,
            factualResults: comparison.factualResults,
            calculatedMetrics: comparison.calculatedMetrics,
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
        return { products: data.products.length, productsWithStock: productsWithStock.length };
    });
    const forecasts = await step('calculate-forecast', async () => data.products.map((product) =>
        calculateInventoryForecast(product, period.days)));
    const ai = await step('generate-insights', async () => generateGroundedInsights({
        geminiService,
        workflowName: 'Inventory Predictor',
        facts: { periodDays: period.days, forecasts },
        instruction: [
            'Explain stock risks and prioritize products using only the calculated forecast.',
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
            methodology: {
                salesVelocity: 'Units sold / selected period days',
                averageDailyDemand: 'Units sold / selected period days',
                estimatedDaysOfStock: 'Current stock / average daily demand',
                reorderPoint: 'Average daily demand × (lead time days + configured buffer days)'
            },
            factualResults: data.products.map((product) => ({
                productId: Number(product.product_id),
                productName: product.product_name,
                sku: product.sku || null,
                currentStock: product.current_stock === null ? null : Number(product.current_stock),
                unitsSold: Number(product.units_sold || 0),
                previousUnitsSold: Number(product.previous_units_sold || 0)
            })),
            calculatedMetrics: forecasts,
            aiInsights: ai
        }
    };
}

function createStepExecutor({ database, onEvent, runId }) {
    return async function executeStep(stepKey, operation) {
        await database.updateWorkflowStep({ runId, stepKey, status: 'running' });
        emit(onEvent, 'step', { runId: Number(runId), stepKey, status: 'running' });
        try {
            const output = await operation();
            await database.updateWorkflowStep({ runId, stepKey, status: 'completed', output: summarizeStepOutput(output) });
            emit(onEvent, 'step', { runId: Number(runId), stepKey, status: 'completed' });
            return output;
        } catch (error) {
            await database.updateWorkflowStep({
                runId,
                stepKey,
                status: 'failed',
                errorMessage: error.publicMessage || error.message
            }).catch(() => {});
            emit(onEvent, 'step', {
                runId: Number(runId),
                stepKey,
                status: 'failed',
                error: error.publicMessage || 'This step failed.'
            });
            throw error;
        }
    };
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
        business: serializeBusiness(data.business),
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
        sourceName: row.source_name || row.configured_source_name || null,
        sourceUrl: row.source_url || row.configured_source_url || null,
        currency: row.currency || null,
        products: Array.isArray(row.products) ? row.products : [],
        offers: Array.isArray(row.offers) ? row.offers : [],
        positioning: row.positioning || null
    }));
    const priceGroups = new Map();
    for (const competitor of factualResults) {
        for (const product of competitor.products) {
            const name = String(product?.name || product?.product || '').trim();
            const price = Number(product?.priceMinor ?? product?.price_minor);
            if (!name || !Number.isFinite(price) || price < 0) continue;
            const key = name.toLocaleLowerCase('en-US');
            const entries = priceGroups.get(key) || [];
            entries.push({ competitorName: competitor.competitorName, productName: name, priceMinor: price, currency: competitor.currency });
            priceGroups.set(key, entries);
        }
    }
    const comparablePrices = [...priceGroups.values()]
        .filter((entries) => entries.length >= 2 && new Set(entries.map((entry) => entry.currency)).size === 1)
        .map((entries) => {
            const prices = entries.map((entry) => entry.priceMinor);
            return {
                productName: entries[0].productName,
                currency: entries[0].currency,
                lowestPriceMinor: Math.min(...prices),
                highestPriceMinor: Math.max(...prices),
                priceRangeMinor: Math.max(...prices) - Math.min(...prices),
                competitors: entries
            };
        });
    return {
        factualResults,
        calculatedMetrics: {
            competitorsWithCurrentSnapshots: factualResults.length,
            comparableProductGroups: comparablePrices
        }
    };
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
        createdAt: run.created_at,
        startedAt: run.started_at || null,
        completedAt: run.completed_at || null,
        steps: Array.isArray(run.steps) ? run.steps.map((step) => ({
            key: step.step_key,
            title: step.step_title,
            order: Number(step.step_order),
            status: step.status,
            error: step.error_message || null
        })) : undefined
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
