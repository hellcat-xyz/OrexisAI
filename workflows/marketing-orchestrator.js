'use strict';

const { DEFAULT_CHANNELS } = require('./marketing-ai');
const { validateMarketingRunInput, publicError } = require('./security');
const { sanitizePlainText } = require('./marketing-utils');

async function executeMarketingOperatingWorkflow({
    userId,
    business,
    input,
    step,
    database,
    analyticsEngine,
    marketingAiService,
    liveDataCollector,
    competitorIntelligenceService,
    reportService,
    runId,
    log
}) {
    const request = validateMarketingRunInput(input);
    const databaseSnapshot = await step('collect-database-data', async () => analyticsEngine.buildWorkspace({
        userId,
        businessId: business.id,
        from: request.from,
        to: request.to,
        timezone: business.timezone || 'UTC',
        defaultDays: 7,
        bypassCache: request.forceRefresh
    }));

    const validation = await step('validate-records', async () => validateWorkspace(databaseSnapshot));
    const kpis = await step('calculate-kpis', async () => databaseSnapshot.metrics);
    const comparisons = await step('compare-periods', async () => ({
        selectedPeriod: databaseSnapshot.trends.selectedPeriodComparison,
        daily: databaseSnapshot.trends.dailyComparison,
        weekly: databaseSnapshot.trends.weeklyComparison,
        monthly: databaseSnapshot.trends.monthlyComparison,
        quarterly: databaseSnapshot.trends.quarterlyComparison,
        yearOverYear: databaseSnapshot.trends.yearOverYearComparison,
        periods: databaseSnapshot.periodComparisons,
        dataPeriod: databaseSnapshot.dataPeriod,
        previousPeriod: databaseSnapshot.previousPeriod,
        yearAgoPeriod: databaseSnapshot.yearAgoPeriod
    }));
    const decliningProducts = await step('identify-declining-products', async () => databaseSnapshot.products.declining);
    const bestSellers = await step('identify-best-sellers', async () => databaseSnapshot.products.top);
    const customerSegments = await step('segment-customers', async () => databaseSnapshot.customers.segments);
    const deterministicOpportunities = await step('calculate-opportunities', async () => databaseSnapshot.opportunities);
    const stockRisks = await step('detect-stock-risks', async () => databaseSnapshot.products.stockAlerts);

    const context = await database.getWeeklyMarketingContext({ userId, businessId: business.id });
    const liveData = await step('collect-competitor-data', async () => {
        const collected = await liveDataCollector.collect({
            business: context.business,
            competitors: request.competitorScan ? context.competitors : [],
            databaseReviews: context.reviews,
            period: {
                current: databaseSnapshot.dataPeriod,
                previous: databaseSnapshot.previousPeriod
            },
            onLog: (level, message) => { void log(level, message, { sourceCollection: true }); }
        });
        await database.saveWorkflowSourceSnapshots({ runId, snapshots: collected.snapshots });
        const savedCompetitors = await competitorIntelligenceService.persistLiveFindings({
            userId,
            businessId: business.id,
            liveData: collected
        });
        return { ...collected, persistedCompetitorSnapshots: savedCompetitors.length };
    });

    const marketTrends = await step('collect-market-trends', async () => extractVerifiedMarketTrends(liveData));
    const requestedChannels = request.channels.length ? request.channels : DEFAULT_CHANNELS;
    const aiExecution = await step('generate-ai-reasoning', async () => marketingAiService.reason({
        workspace: databaseSnapshot,
        liveData,
        objective: request.objective,
        channels: requestedChannels
    }));
    const { auditPrompt, ...ai } = aiExecution;
    await database.saveWorkflowAiExecution({
        runId,
        model: ai.model,
        promptText: auditPrompt,
        response: ai,
        contextHash: ai.contextHash
    });

    const campaignIdeas = await step('generate-campaign-ideas', async () => ai.campaignPlan.map((campaign) => ({
        channel: campaign.channel,
        title: campaign.title,
        rationale: campaign.rationale,
        verifiedFacts: campaign.verifiedFacts
    })));
    const socialPosts = await step('generate-social-posts', async () => selectCampaigns(ai.campaignPlan, ['instagram', 'facebook']));
    const emailCampaign = await step('generate-email-campaign', async () => selectCampaigns(ai.campaignPlan, ['email']));
    const whatsappCampaign = await step('generate-whatsapp-campaign', async () => selectCampaigns(ai.campaignPlan, ['whatsapp']));
    const instagramCaptions = await step('generate-instagram-captions', async () => selectCampaigns(ai.campaignPlan, ['instagram']));
    const facebookAds = await step('generate-facebook-ads', async () => selectCampaigns(ai.campaignPlan, ['facebook']));
    const googleAds = await step('generate-google-ads', async () => selectCampaigns(ai.campaignPlan, ['google-ads']));
    const seoPlan = await step('generate-seo-plan', async () => ({
        keywords: ai.seoPlan.keywords,
        blogIdeas: ai.seoPlan.blogIdeas
    }));
    const landingPageImprovements = await step('improve-landing-page', async () => ai.seoPlan.landingPageImprovements);
    const discountRecommendations = await step('recommend-discounts', async () => ai.productStrategy.map((item) => ({
        productName: item.productName,
        recommendation: item.discountRecommendation,
        inventoryConstraint: item.inventoryConstraint,
        evidence: item.evidence
    })).filter((item) => item.recommendation));
    const pricingRecommendations = await step('recommend-pricing', async () => ai.productStrategy.map((item) => ({
        productName: item.productName,
        recommendation: item.pricingRecommendation,
        evidence: item.evidence
    })).filter((item) => item.recommendation));

    const growthPlan = await step('assemble-growth-plan', async () => {
        const savedCampaigns = await database.saveMarketingCampaignAssets({
            userId,
            businessId: business.id,
            runId,
            campaigns: ai.campaignPlan
        });
        const contentArtifact = await database.saveWorkflowArtifact({
            runId,
            sectionKey: 'marketing-operating-plan',
            artifactType: 'json',
            title: 'Marketing Operating Plan',
            filename: `marketing-operating-plan-${new Date().toISOString().slice(0, 10)}.json`,
            mimeType: 'application/json',
            contentText: JSON.stringify({ analytics: databaseSnapshot, ai }, null, 2),
            metadata: { contextHash: ai.contextHash, model: ai.model, campaignCount: savedCampaigns.length }
        });
        const reports = await createReports({
            reportService,
            database,
            runId,
            business: context.business,
            databaseSnapshot,
            ai,
            liveData
        });
        return {
            savedCampaigns: savedCampaigns.map(serializeCampaignAsset),
            contentArtifact: serializeArtifact(contentArtifact),
            reports
        };
    });

    const limitations = [...new Set([
        ...(databaseSnapshot.limitations || []),
        ...(liveData.unavailable || []).map((item) => `${item.sourceType}: ${item.reason}`),
        ...(ai.dataLimitations || [])
    ].filter(Boolean))];

    return {
        period: { from: new Date(databaseSnapshot.dataPeriod.from), to: new Date(databaseSnapshot.dataPeriod.to) },
        dataRetrievedAt: databaseSnapshot.generatedAt,
        recordsAnalyzed: databaseSnapshot.recordsAnalyzed,
        output: {
            workflow: 'weekly-marketing',
            workflowVersion: 3,
            trustworthy: true,
            partial: limitations.length > 0,
            business: databaseSnapshot.business,
            dataPeriod: databaseSnapshot.dataPeriod,
            previousPeriod: databaseSnapshot.previousPeriod,
            yearAgoPeriod: databaseSnapshot.yearAgoPeriod,
            recordsAnalyzed: databaseSnapshot.recordsAnalyzed,
            validation,
            analytics: databaseSnapshot,
            internalPerformance: {
                factualResults: summarizeFactualResults(databaseSnapshot),
                calculatedMetrics: kpis
            },
            comparisons,
            decliningProducts,
            bestSellers,
            customerSegments,
            deterministicOpportunities,
            stockRisks,
            marketTrends,
            aiReasoning: {
                executiveSummary: ai.executiveSummary,
                findings: ai.findings,
                opportunities: ai.opportunities,
                customerStrategy: ai.customerStrategy,
                productStrategy: ai.productStrategy,
                nextActions: ai.nextActions,
                model: ai.model,
                contextHash: ai.contextHash
            },
            campaignIdeas,
            campaigns: {
                socialPosts,
                emailCampaign,
                whatsappCampaign,
                instagramCaptions,
                facebookAds,
                googleAds,
                all: ai.campaignPlan
            },
            seoPlan,
            landingPageImprovements,
            discountRecommendations,
            pricingRecommendations,
            growthPlan,
            sourceSummary: liveData.snapshots.map(serializeSource),
            dataLimitations: limitations
        }
    };
}

function validateWorkspace(workspace) {
    if (!workspace?.business?.id) throw publicError('MARKETING_BUSINESS_MISSING', 'The selected business could not be loaded.', 404);
    const freshness = workspace.freshness || {};
    const records = Number(workspace.recordsAnalyzed || 0);
    if (records < 1) throw publicError('MARKETING_DATA_REQUIRED', 'Connect or import real business records before running weekly marketing.', 422);
    return {
        valid: true,
        recordsAnalyzed: records,
        orderRecords: Number(freshness.orderRecords || 0),
        customerRecords: Number(freshness.customerRecords || 0),
        productRecords: Number(freshness.productRecords || 0),
        campaignRecords: Number(freshness.campaignRecords || 0),
        trafficRecords: Number(freshness.trafficRecords || 0),
        cartRecords: Number(freshness.cartRecords || 0),
        limitations: workspace.limitations || []
    };
}

function extractVerifiedMarketTrends(liveData) {
    const available = liveData?.available || {};
    return {
        keywords: available['trending-keywords'] || null,
        googleTrends: available['google-trends'] || null,
        industryNews: available['industry-news'] || null,
        localEvents: available['local-events'] || null,
        seasonalEvents: available['seasonal-events'] || null,
        weather: available.weather || null,
        socialTrends: available['social-media-trends'] || null,
        sourcesAvailable: Object.keys(available)
    };
}

function selectCampaigns(campaigns, channels) {
    const allowed = new Set(channels);
    return campaigns.filter((campaign) => allowed.has(campaign.channel));
}

async function createReports({ reportService, database, runId, business, databaseSnapshot, ai, liveData }) {
    const report = {
        executiveSummary: ai.executiveSummary,
        verifiedAnalytics: databaseSnapshot,
        findings: ai.findings,
        opportunities: ai.opportunities,
        customerStrategy: ai.customerStrategy,
        productStrategy: ai.productStrategy,
        campaigns: ai.campaignPlan,
        seoPlan: ai.seoPlan,
        nextActions: ai.nextActions,
        dataLimitations: [...(databaseSnapshot.limitations || []), ...(liveData.unavailable || []).map((item) => `${item.sourceType}: ${item.reason}`)]
    };
    const generated = await reportService.generate({
        business,
        report,
        images: [],
        generatedAt: new Date().toISOString()
    });
    const saved = [];
    for (const file of generated) saved.push(serializeArtifact(await database.saveWorkflowArtifact({ runId, ...file })));
    return saved;
}

function summarizeFactualResults(workspace) {
    return {
        currency: workspace.business.currency,
        totalRevenueMinor: workspace.metrics.revenue.value,
        totalOrders: workspace.metrics.orders.value,
        averageOrderValueMinor: workspace.metrics.averageOrderValue.value,
        uniqueCustomers: workspace.metrics.newCustomers.value + workspace.metrics.returningCustomers.value,
        topProducts: workspace.products.top,
        dailyTrend: workspace.trends.daily,
        campaign: workspace.campaigns.totals,
        campaignDataAvailable: workspace.campaigns.rows.length > 0,
        periodDays: Math.max(1, workspace.trends.daily.length)
    };
}

function serializeSource(snapshot) {
    return {
        sourceType: snapshot.sourceType,
        provider: snapshot.provider,
        status: snapshot.status,
        sourceUrl: snapshot.sourceUrl || null,
        error: snapshot.errorMessage || null,
        retrievedAt: snapshot.retrievedAt
    };
}

function serializeCampaignAsset(row) {
    return {
        id: Number(row.id),
        runId: Number(row.run_id),
        channel: row.channel,
        title: row.title,
        content: row.content,
        rationale: row.rationale || null,
        verifiedFacts: row.verified_facts || [],
        status: row.status,
        createdAt: row.created_at
    };
}

function serializeArtifact(row) {
    return {
        id: Number(row.id),
        runId: Number(row.run_id),
        sectionKey: row.section_key,
        artifactType: row.artifact_type,
        title: row.title,
        filename: row.filename || null,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes || 0),
        sha256: row.sha256,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        downloadUrl: `/api/workflow-artifacts/${Number(row.id)}/download`
    };
}

module.exports = {
    executeMarketingOperatingWorkflow,
    extractVerifiedMarketTrends,
    summarizeFactualResults,
    validateWorkspace
};
