'use strict';

const {
    growthPercentage,
    normalizeRequestedPeriod,
    percentage,
    round,
    safeDivide
} = require('./marketing-utils');

const FILTER_VALUES = Object.freeze({
    businessHours: new Set(['all', 'business-hours', 'after-hours']),
    compare: new Set(['previous-period', 'previous-year', 'none'])
});

function createEnterpriseAnalyticsService({ database, analyticsEngine } = {}) {
    if (!database) throw new TypeError('A database service is required.');
    if (!analyticsEngine) throw new TypeError('An analytics engine is required.');

    return {
        async buildDashboard({ userId, from = '', to = '', filters = {}, bypassCache = false } = {}) {
            const business = await database.getOrCreateBusinessForUser(userId);
            const normalizedFilters = normalizeEnterpriseFilters(filters);
            const periods = normalizeRequestedPeriod({ from, to, timeZone: business.timezone || 'UTC', defaultDays: 30 });
            const [base, enterpriseRaw] = await Promise.all([
                analyticsEngine.buildWorkspace({
                    userId,
                    businessId: business.id,
                    from,
                    to,
                    timezone: business.timezone || 'UTC',
                    bypassCache
                }),
                database.getEnterpriseAnalyticsData({
                    userId,
                    businessId: business.id,
                    periods,
                    filters: normalizedFilters
                })
            ]);
            return buildEnterpriseDashboard({ base, raw: enterpriseRaw, filters: normalizedFilters });
        },

        normalizeEnterpriseFilters
    };
}

function buildEnterpriseDashboard({ base, raw, filters = {} } = {}) {
    const normalizedFilters = normalizeEnterpriseFilters(filters);
    const business = {
        ...(base?.business || {}),
        name: raw?.business?.name || base?.business?.name || 'Business',
        currency: raw?.business?.currency || base?.business?.currency || 'USD',
        timezone: raw?.business?.timezone || base?.business?.timezone || 'UTC'
    };
    const summaries = new Map((raw?.summary || []).map((row) => [row.period_key, normalizeSummary(row)]));
    const current = summaries.get('current') || emptySummary();
    const comparisonKey = normalizedFilters.compare === 'previous-year' ? 'year_ago' : 'previous';
    const comparison = normalizedFilters.compare === 'none' ? emptySummary() : summaries.get(comparisonKey) || emptySummary();
    const daily = (raw?.daily || []).map(normalizeDaily);
    const previousDaily = (raw?.previousDaily || []).map(normalizeDaily);
    const baseMetrics = base?.metrics || {};
    const refunds = normalizeRefunds(raw?.refunds || {});
    const customerSummary = normalizeCustomerAnalytics(raw?.customerAnalytics || {});
    const confidence = buildConfidenceModel({ raw, current, daily, base });
    const metrics = buildExecutiveMetrics({
        current,
        comparison,
        daily,
        baseMetrics,
        base,
        refunds,
        customerSummary,
        confidence,
        compareMode: normalizedFilters.compare
    });
    const anomalies = detectAnomalies(daily);
    const seasonality = buildSeasonality(raw?.weekday || [], daily);
    const revenue = buildRevenueModel({ daily, previousDaily, base, anomalies, seasonality });
    const inventory = buildInventoryModel(base?.products || {});
    const products = buildProductModel(base?.products || {}, raw?.productPerformance || [], raw?.categoryPerformance || base?.categories || []);
    const attribution = buildAttributionModel({ base, raw });
    const customers = buildCustomerModel({ base, raw, customerSummary });
    const cashFlow = buildCashFlowModel(raw?.cashFlowDaily || [], base);
    const businessHealth = buildBusinessHealth({ metrics, base, refunds, inventory, confidence });
    const decisionEngine = buildDecisionEngine({
        metrics,
        base,
        inventory,
        products,
        refunds,
        customers,
        attribution,
        anomalies,
        businessHealth
    });
    const workflows = buildDecisionWorkflows({ metrics, inventory, attribution, customers, decisionEngine });
    const dataQuality = buildDataQuality({ base, raw, confidence });
    const period = buildPeriod(base?.dataPeriod, business.timezone);
    const summariesText = buildNarrativeSummaries({ metrics, period, businessHealth, decisionEngine, revenue });

    return {
        version: 1,
        trustworthy: true,
        generatedAt: new Date().toISOString(),
        business,
        period,
        comparisonPeriod: buildPeriod(normalizedFilters.compare === 'previous-year' ? base?.yearAgoPeriod : base?.previousPeriod, business.timezone),
        filters: {
            ...normalizedFilters,
            channels: (raw?.filterOptions?.channels || []).map(normalizeFilterOption),
            locations: (raw?.filterOptions?.locations || []).map(normalizeFilterOption)
        },
        live: {
            pollingSeconds: 30,
            sourceUpdatedAt: newestTimestamp(Object.values(base?.freshness || {})),
            recordsAnalyzed: Number(base?.recordsAnalyzed || 0),
            cacheHit: Boolean(base?.cache?.hit)
        },
        executive: {
            headline: summariesText.executiveHeadline,
            summary: summariesText.executiveSummary,
            metrics
        },
        revenue,
        funnel: normalizeFunnel(base?.funnel || {}),
        customers,
        products,
        inventory,
        attribution,
        geography: (base?.geography || []).map(normalizeGeography),
        heatmap: buildHeatmap(raw?.hourly || []),
        refunds,
        cashFlow,
        businessHealth,
        anomalies,
        opportunities: base?.opportunities || [],
        decisionEngine,
        workflows,
        summaries: summariesText,
        dataQuality,
        onboarding: buildOnboarding({ base, raw, dataQuality }),
        demo: normalizeDemoState(raw?.demoState || {})
    };
}

function buildExecutiveMetrics({ current, comparison, daily, baseMetrics, base, refunds, customerSummary, confidence, compareMode }) {
    const change = (value, previous) => compareMode === 'none' ? null : growthPercentage(value, previous);
    const dailyRevenue = daily.map((point) => point.revenueMinor);
    const dailyOrders = daily.map((point) => point.orders);
    const returningPercentage = metricValue(baseMetrics.returningCustomerPercentage);
    const conversionRate = metricValue(baseMetrics.conversionRatePercentage);
    const productsSold = daily.reduce((sum, point) => sum + point.units, 0);
    const profitValue = metricValue(baseMetrics.profit);
    const marginValue = metricValue(baseMetrics.profitMarginPercentage);
    const clvValue = metricValue(baseMetrics.customerLifetimeValue) ?? customerSummary.averageLifetimeValueMinor;
    const repeatRate = metricValue(baseMetrics.repeatPurchaseRatePercentage) ?? customerSummary.repeatPurchaseRatePercentage;
    const marketingRoi = metricValue(baseMetrics.marketingRoiPercentage);

    return [
        metric({ key: 'revenue', label: 'Revenue', value: current.revenueMinor, previousValue: comparison.revenueMinor, unit: 'minor-currency', changePercentage: change(current.revenueMinor, comparison.revenueMinor), confidence: confidence.orders, source: 'Valid paid, fulfilled, and completed orders', sparkline: dailyRevenue, insight: revenueInsight(current.revenueMinor, comparison.revenueMinor), suggestedAction: change(current.revenueMinor, comparison.revenueMinor) < 0 ? 'Run the revenue recovery workflow.' : 'Protect the channels and products driving growth.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'orders', label: 'Orders', value: current.orders, previousValue: comparison.orders, unit: 'count', changePercentage: change(current.orders, comparison.orders), confidence: confidence.orders, source: 'Authenticated order records', sparkline: dailyOrders, insight: volumeInsight(current.orders, comparison.orders), suggestedAction: current.orders === 0 ? 'Connect or import your store orders.' : 'Review peak order hours and conversion drop-offs.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'customers', label: 'Purchasing customers', value: current.purchasingCustomers, previousValue: comparison.purchasingCustomers, unit: 'count', changePercentage: change(current.purchasingCustomers, comparison.purchasingCustomers), confidence: confidence.customers, source: 'Customer-linked orders', sparkline: daily.map((point) => point.customers), insight: customerInsight(current.purchasingCustomers, comparison.purchasingCustomers), suggestedAction: 'Use customer segments to target retention and acquisition separately.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'aov', label: 'Average order value', value: safeDivide(current.revenueMinor, current.orders), previousValue: safeDivide(comparison.revenueMinor, comparison.orders), unit: 'minor-currency', changePercentage: change(safeDivide(current.revenueMinor, current.orders), safeDivide(comparison.revenueMinor, comparison.orders)), confidence: confidence.orders, source: 'Net revenue divided by valid orders', sparkline: daily.map((point) => safeDivide(point.revenueMinor, point.orders) || 0), insight: aovInsight(current, comparison), suggestedAction: 'Test bundles and complementary product recommendations.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'products-sold', label: 'Products sold', value: productsSold, previousValue: null, unit: 'count', changePercentage: null, confidence: confidence.orderItems, source: 'Verified order-item quantities', sparkline: daily.map((point) => point.units), insight: productsSold > 0 ? `${productsSold.toLocaleString('en-US')} units moved in the selected period.` : 'Product-level sales appear after order items are connected.', suggestedAction: 'Compare unit velocity with current stock and supplier lead time.', workflowSlug: 'inventory-predictor' }),
        metric({ key: 'conversion', label: 'Conversion rate', value: conversionRate, previousValue: null, unit: 'percentage', changePercentage: null, confidence: confidence.traffic, source: 'Traffic sessions and measured purchases', sparkline: [], insight: conversionRate === null ? 'Connect traffic data to unlock funnel conversion.' : conversionRate < 2 ? 'The measured funnel is converting below 2%.' : 'The measured funnel is converting above 2%.', suggestedAction: conversionRate !== null && conversionRate < 2 ? 'Inspect product-page and checkout drop-off.' : 'Preserve the highest-converting traffic sources.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'returning', label: 'Returning customers', value: returningPercentage, previousValue: null, unit: 'percentage', changePercentage: null, confidence: confidence.customers, source: 'Customer-linked order history', sparkline: [], insight: returningPercentage === null ? 'Returning-customer analytics unlock after customer-linked orders.' : `${round(returningPercentage, 1)}% of purchasing customers returned.`, suggestedAction: returningPercentage !== null && returningPercentage < 25 ? 'Launch a loyalty or win-back campaign.' : 'Reward repeat buyers and ask for referrals.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'profit', label: 'Estimated profit', value: profitValue, previousValue: null, unit: 'minor-currency', changePercentage: null, confidence: confidence.profit, source: 'Net item revenue minus configured product cost', sparkline: daily.map((point) => point.profitMinor || 0), insight: profitValue === null ? 'Add product cost to unlock profit analytics.' : `Estimated margin is ${marginValue === null ? 'not available' : `${round(marginValue, 1)}%`}.`, suggestedAction: profitValue === null ? 'Import product cost for each active product.' : 'Prioritize profitable products, not revenue alone.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'refund-rate', label: 'Refund rate', value: refunds.ratePercentage, previousValue: refunds.previousRatePercentage, unit: 'percentage', changePercentage: compareMode === 'none' ? null : differencePercentagePoints(refunds.ratePercentage, refunds.previousRatePercentage), confidence: confidence.orders, source: 'Order refund amounts', sparkline: [], insight: refunds.ratePercentage === null ? 'Refund analytics unlock after valid orders.' : `${round(refunds.ratePercentage, 1)}% of gross revenue was refunded.`, suggestedAction: refunds.ratePercentage !== null && refunds.ratePercentage > 5 ? 'Review products and channels with elevated refunds.' : 'Continue monitoring refund reasons and product quality.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'clv', label: 'Customer lifetime value', value: clvValue, previousValue: null, unit: 'minor-currency', changePercentage: null, confidence: confidence.customers, source: 'Complete customer-linked order history', sparkline: [], insight: clvValue === null ? 'CLV requires repeat customer-linked orders.' : 'Use CLV to set sustainable acquisition limits.', suggestedAction: 'Keep acquisition cost below contribution-adjusted CLV.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'repeat-rate', label: 'Repeat purchase rate', value: repeatRate, previousValue: null, unit: 'percentage', changePercentage: null, confidence: confidence.customers, source: 'Customers with two or more orders', sparkline: [], insight: repeatRate === null ? 'Repeat purchase rate unlocks with customer-linked history.' : `${round(repeatRate, 1)}% of purchasing customers bought again.`, suggestedAction: repeatRate !== null && repeatRate < 20 ? 'Create a post-purchase retention sequence.' : 'Segment repeat buyers for loyalty offers.', workflowSlug: 'weekly-marketing' }),
        metric({ key: 'marketing-roi', label: 'Marketing ROI', value: marketingRoi, previousValue: null, unit: 'percentage', changePercentage: null, confidence: confidence.campaigns, source: 'Campaign spend and attributed revenue', sparkline: [], insight: marketingRoi === null ? 'Connect campaign spend and attributed revenue.' : marketingRoi < 0 ? 'Measured campaigns returned less revenue than spend.' : 'Measured campaigns generated positive attributed return.', suggestedAction: marketingRoi !== null && marketingRoi < 0 ? 'Pause or rebuild losing campaigns.' : 'Scale campaigns with profitable return and sufficient volume.', workflowSlug: 'weekly-marketing' })
    ];
}

function buildRevenueModel({ daily, previousDaily, base, anomalies, seasonality }) {
    const forecast = base?.trends?.revenueForecast || { available: false, points: [], confidence: null };
    const volatility = coefficientOfVariation(daily.map((point) => point.revenueMinor));
    return {
        daily,
        previousDaily,
        forecast: {
            available: Boolean(forecast.available),
            confidence: forecast.confidence === null || forecast.confidence === undefined ? null : round(Number(forecast.confidence) * 100, 1),
            points: (forecast.points || []).map((point) => {
                const value = Number(point.value || 0);
                const uncertainty = Math.max(value * (0.12 + volatility * 0.35), 1);
                return { date: point.date, value, lower: Math.max(0, Math.round(value - uncertainty)), upper: Math.round(value + uncertainty) };
            }),
            reason: forecast.reason || null
        },
        anomalies,
        seasonality,
        totals: {
            revenueMinor: daily.reduce((sum, point) => sum + point.revenueMinor, 0),
            orders: daily.reduce((sum, point) => sum + point.orders, 0),
            profitMinor: nullableSum(daily.map((point) => point.profitMinor))
        }
    };
}

function buildInventoryModel(products) {
    const all = Array.isArray(products?.all) ? products.all : [];
    const risks = all
        .filter((product) => ['out-of-stock', 'critical', 'low', 'watch'].includes(product.stockRisk))
        .map((product) => ({
            ...product,
            confidence: inventoryConfidence(product),
            recommendedReorderQuantity: reorderQuantity(product),
            supplierImpact: supplierImpact(product)
        }))
        .sort((left, right) => stockRiskRank(left.stockRisk) - stockRiskRank(right.stockRisk) || nullableAscending(left.daysOfCover, right.daysOfCover));
    const known = all.filter((product) => product.currentStock !== null && product.currentStock !== undefined);
    const healthCounts = ['healthy', 'watch', 'low', 'critical', 'out-of-stock', 'unknown'].map((level) => ({
        level,
        count: all.filter((product) => product.stockRisk === level).length
    }));
    return {
        knownProducts: known.length,
        risks,
        healthCounts,
        atRiskCount: risks.length,
        healthyPercentage: percentage(known.filter((product) => product.stockRisk === 'healthy').length, known.length),
        demandForecast: products?.demandForecast || null
    };
}

function buildProductModel(products, productPerformance, categories) {
    const stockById = new Map((products?.all || []).map((row) => [Number(row.productId), row]));
    const rows = productPerformance.length
        ? productPerformance.map(normalizeProductPerformance).map((row) => ({ ...stockById.get(row.productId), ...row }))
        : (products?.all || []);
    const selling = rows.filter((row) => Number(row.unitsSold || 0) > 0 || Number(row.revenueMinor || 0) > 0);
    return {
        top: [...selling].sort((a, b) => Number(b.revenueMinor || 0) - Number(a.revenueMinor || 0)).slice(0, 10),
        worst: [...selling].sort((a, b) => Number(a.revenueMinor || 0) - Number(b.revenueMinor || 0)).slice(0, 10),
        declining: rows.filter((row) => Number(row.revenueChangePercentage) < 0).sort((a, b) => Number(a.revenueChangePercentage) - Number(b.revenueChangePercentage)).slice(0, 10),
        all: rows,
        categories: categories.map(normalizeCategoryPerformance)
    };
}

function buildAttributionModel({ base, raw }) {
    const trafficSources = (base?.trafficSources || []).map((row) => ({ ...row }));
    const campaigns = (base?.campaigns?.rows || []).map((row) => ({ ...row }));
    const channels = (raw?.channelPerformance || []).map(normalizeChannelPerformance);
    const trafficTotal = trafficSources.reduce((sum, row) => sum + Number(row.sessions || 0), 0);
    return {
        trafficSources: trafficSources.map((row) => ({ ...row, sharePercentage: percentage(row.sessions, trafficTotal) })),
        campaigns,
        channels,
        totals: base?.campaigns?.totals || {},
        hasTraffic: trafficSources.length > 0,
        hasCampaigns: campaigns.length > 0
    };
}

function buildCustomerModel({ base, raw, customerSummary }) {
    const timeline = (raw?.customerTimeline || []).map((row) => ({
        date: isoDate(row.day),
        newCustomers: Number(row.new_customers || 0),
        returningCustomers: Number(row.returning_customers || 0),
        purchasingCustomers: Number(row.purchasing_customers || 0)
    }));
    const cohorts = (raw?.cohorts || []).map((row) => ({
        cohort: isoMonth(row.cohort_month),
        customers: Number(row.customers || 0),
        month0: Number(row.month_0 || 0),
        month1: Number(row.month_1 || 0),
        month2: Number(row.month_2 || 0),
        month3: Number(row.month_3 || 0),
        month4: Number(row.month_4 || 0),
        month5: Number(row.month_5 || 0)
    }));
    return {
        ...(base?.customers || {}),
        ...customerSummary,
        timeline,
        cohorts,
        retentionRatePercentage: customerSummary.retentionRatePercentage,
        churnRiskCustomers: Number(raw?.customerAnalytics?.churn_risk_customers || 0)
    };
}

function buildCashFlowModel(rows, base) {
    const daily = rows.map((row) => ({
        date: isoDate(row.day),
        grossRevenueMinor: Number(row.gross_revenue_minor || 0),
        refundsMinor: Number(row.refunds_minor || 0),
        netRevenueMinor: Number(row.net_revenue_minor || 0),
        campaignSpendMinor: Number(row.campaign_spend_minor || 0),
        estimatedProfitMinor: nullableNumber(row.estimated_profit_minor),
        netCashContributionMinor: Number(row.net_revenue_minor || 0) - Number(row.campaign_spend_minor || 0)
    }));
    return {
        daily,
        netRevenueMinor: daily.reduce((sum, row) => sum + row.netRevenueMinor, 0),
        refundsMinor: daily.reduce((sum, row) => sum + row.refundsMinor, 0),
        campaignSpendMinor: daily.reduce((sum, row) => sum + row.campaignSpendMinor, 0),
        estimatedProfitMinor: metricValue(base?.metrics?.profit)
    };
}

function buildBusinessHealth({ metrics, base, refunds, inventory, confidence }) {
    const byKey = new Map(metrics.map((item) => [item.key, item]));
    const signals = [];
    pushSignal(signals, 'Revenue momentum', scoreGrowth(byKey.get('revenue')?.changePercentage), 20, 'Revenue trend against the comparison period');
    pushSignal(signals, 'Conversion efficiency', scoreThreshold(byKey.get('conversion')?.value, [1, 2, 3.5]), 15, 'Measured purchases divided by sessions');
    pushSignal(signals, 'Customer retention', scoreThreshold(byKey.get('repeat-rate')?.value, [10, 20, 35]), 15, 'Share of purchasing customers who ordered more than once');
    pushSignal(signals, 'Profitability', scoreThreshold(metricValue(base?.metrics?.profitMarginPercentage), [5, 15, 30]), 15, 'Estimated margin from product costs');
    pushSignal(signals, 'Inventory resilience', inventory.knownProducts ? clamp(100 - (inventory.atRiskCount / inventory.knownProducts) * 100, 0, 100) : null, 15, 'Share of products without near-term stock risk');
    pushSignal(signals, 'Refund control', refunds.ratePercentage === null ? null : clamp(100 - refunds.ratePercentage * 8, 0, 100), 10, 'Refunded value as a share of gross revenue');
    pushSignal(signals, 'Data coverage', confidence.overall, 10, 'Connected business records available to the analytics engine');
    const available = signals.filter((signal) => signal.score !== null);
    const totalWeight = available.reduce((sum, signal) => sum + signal.weight, 0);
    const score = totalWeight ? Math.round(available.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / totalWeight) : null;
    return {
        score,
        status: score === null ? 'setup' : score >= 80 ? 'strong' : score >= 65 ? 'stable' : score >= 45 ? 'watch' : 'critical',
        signals: signals.map((signal) => ({ ...signal, status: signal.score === null ? 'Not connected' : signal.score >= 80 ? 'Strong' : signal.score >= 60 ? 'Stable' : signal.score >= 40 ? 'Watch' : 'Critical' }))
    };
}

function buildDecisionEngine({ metrics, base, inventory, products, refunds, customers, attribution, anomalies, businessHealth }) {
    const byKey = new Map(metrics.map((item) => [item.key, item]));
    const recommendations = [];
    const revenue = byKey.get('revenue');
    if (revenue?.changePercentage !== null && revenue.changePercentage < -5) {
        recommendations.push(recommendation({ id: 'recover-revenue', priority: 'high', title: 'Run a revenue recovery plan', reason: `Revenue is down ${Math.abs(round(revenue.changePercentage, 1))}% versus the comparison period.`, evidence: [`Current net revenue: ${revenue.value}`, `Comparison net revenue: ${revenue.previousValue}`], actionLabel: 'Run weekly marketing', workflowSlug: 'weekly-marketing', confidence: revenue.confidence, impact: 'High' }));
    }
    const conversion = byKey.get('conversion');
    if (conversion?.value !== null && conversion.value < 2) {
        recommendations.push(recommendation({ id: 'improve-conversion', priority: 'high', title: 'Repair the highest-loss funnel stage', reason: `Measured conversion is ${round(conversion.value, 2)}%. Review product-view, cart, checkout, and purchase transitions before adding traffic.`, evidence: funnelEvidence(base?.funnel), actionLabel: 'Run marketing analysis', workflowSlug: 'weekly-marketing', confidence: conversion.confidence, impact: 'High' }));
    }
    if (inventory.risks[0]) {
        const item = inventory.risks[0];
        recommendations.push(recommendation({ id: 'restock-risk', priority: item.stockRisk === 'critical' || item.stockRisk === 'out-of-stock' ? 'high' : 'medium', title: `Protect sales for ${item.productName}`, reason: item.daysOfCover === null ? `Current stock is ${item.stockRisk}.` : `Estimated stock cover is ${round(item.daysOfCover, 1)} days versus supplier lead time.`, evidence: [`Stock: ${item.currentStock ?? 'unknown'}`, `Reorder point: ${item.reorderPoint ?? 'unknown'}`, `Suggested reorder quantity: ${item.recommendedReorderQuantity ?? 'review manually'}`], actionLabel: 'Run inventory predictor', workflowSlug: 'inventory-predictor', confidence: item.confidence, impact: 'High' }));
    }
    const weakCampaign = [...attribution.campaigns].filter((row) => row.roas !== null && row.roas !== undefined).sort((a, b) => a.roas - b.roas)[0];
    if (weakCampaign && weakCampaign.roas < 1) {
        recommendations.push(recommendation({ id: 'campaign-loss', priority: 'high', title: `Rebuild ${weakCampaign.campaignName}`, reason: `Attributed return is ${round(weakCampaign.roas, 2)}x, below measured spend.`, evidence: [`Spend: ${weakCampaign.spendMinor}`, `Attributed revenue: ${weakCampaign.attributedRevenueMinor}`], actionLabel: 'Generate campaign improvements', workflowSlug: 'weekly-marketing', confidence: confidenceFromRecords(weakCampaign.visitors, 200), impact: 'Medium to high' }));
    }
    if (customers.retentionRatePercentage !== null && customers.retentionRatePercentage < 25) {
        recommendations.push(recommendation({ id: 'retention', priority: 'medium', title: 'Launch a post-purchase retention sequence', reason: `Measured retention is ${round(customers.retentionRatePercentage, 1)}%. Focus on the first repeat purchase window.`, evidence: [`Repeat customers: ${customers.repeatCustomers || 0}`, `Purchasing customers: ${customers.purchasingCustomers || 0}`], actionLabel: 'Create retention campaign', workflowSlug: 'weekly-marketing', confidence: confidenceFromRecords(customers.purchasingCustomers, 100), impact: 'Medium' }));
    }
    if (refunds.ratePercentage !== null && refunds.ratePercentage > 5) {
        recommendations.push(recommendation({ id: 'refunds', priority: 'medium', title: 'Investigate elevated refunds', reason: `${round(refunds.ratePercentage, 1)}% of gross revenue was refunded.`, evidence: [`Refunded value: ${refunds.refundedAmountMinor}`, `Refunded orders: ${refunds.refundedOrders}`], actionLabel: 'Review product performance', workflowSlug: 'weekly-marketing', confidence: confidenceFromRecords(refunds.orders, 100), impact: 'Medium' }));
    }
    if (products.top[0] && (!revenue || revenue.changePercentage === null || revenue.changePercentage >= -5)) {
        recommendations.push(recommendation({ id: 'scale-winner', priority: 'low', title: `Expand demand for ${products.top[0].productName}`, reason: 'This product leads measured revenue in the selected period.', evidence: [`Revenue: ${products.top[0].revenueMinor}`, `Units sold: ${products.top[0].unitsSold}`], actionLabel: 'Generate product campaign', workflowSlug: 'weekly-marketing', confidence: confidenceFromRecords(products.top[0].orderCount, 60), impact: 'Medium' }));
    }
    if (anomalies.length) {
        recommendations.push(recommendation({ id: 'anomaly-review', priority: 'medium', title: 'Review unusual sales days', reason: `${anomalies.length} statistically unusual daily result${anomalies.length === 1 ? '' : 's'} were detected.`, evidence: anomalies.slice(0, 3).map((row) => `${row.date}: ${row.direction} revenue anomaly`), actionLabel: 'Inspect anomaly details', workflowSlug: null, confidence: anomalies[0].confidence, impact: 'Diagnostic' }));
    }
    if (recommendations.length === 0 && businessHealth.score !== null) {
        recommendations.push(recommendation({ id: 'maintain', priority: 'low', title: 'Maintain the current operating rhythm', reason: 'No high-severity revenue, conversion, campaign, refund, or inventory risk was detected.', evidence: [`Business health score: ${businessHealth.score}/100`], actionLabel: 'Run weekly summary', workflowSlug: 'weekly-marketing', confidence: Math.max(70, businessHealth.score), impact: 'Preventive' }));
    }
    return {
        grounded: true,
        method: 'Deterministic rules evaluated only against verified analytics fields',
        recommendations: recommendations.slice(0, 10)
    };
}

function buildDecisionWorkflows({ metrics, inventory, attribution, customers, decisionEngine }) {
    const revenue = metrics.find((item) => item.key === 'revenue');
    const weakCampaign = attribution.campaigns.some((row) => row.roas !== null && row.roas < 1);
    const retentionRisk = customers.retentionRatePercentage !== null && customers.retentionRatePercentage < 25;
    return [
        workflowCard('revenue-drop', 'Revenue Drop Workflow', revenue?.changePercentage !== null && revenue.changePercentage < 0, 'weekly-marketing', ['Detect revenue decline', 'Compare traffic, conversion, stock, and product mix', 'Rank likely causes', 'Generate a recovery campaign', 'Measure the next comparable period']),
        workflowCard('inventory-risk', 'Inventory Workflow', inventory.risks.length > 0, 'inventory-predictor', ['Detect low stock', 'Forecast days of cover', 'Compare supplier lead time', 'Recommend reorder quantity', 'Track replenishment risk']),
        workflowCard('campaign-performance', 'Marketing Workflow', weakCampaign, 'weekly-marketing', ['Detect weak return', 'Find the affected audience and channel', 'Recommend creative and offer changes', 'Generate campaign assets', 'Measure attributed impact']),
        workflowCard('customer-retention', 'Customer Retention Workflow', retentionRisk, 'weekly-marketing', ['Detect retention weakness', 'Identify customer segments', 'Recommend loyalty or win-back offer', 'Generate personalized campaign', 'Track repeat purchase rate'])
    ].map((row) => ({ ...row, recommendationIds: decisionEngine.recommendations.filter((item) => item.workflowSlug === row.workflowSlug).map((item) => item.id) }));
}

function buildDataQuality({ base, raw, confidence }) {
    const freshness = base?.freshness || {};
    const checks = [
        dataCheck('Orders', freshness.orderRecords, 'Connect or import order records to calculate revenue, order volume, refunds, and AOV.'),
        dataCheck('Order items', freshness.orderItemRecords, 'Order items unlock product performance, unit velocity, demand, and profit.'),
        dataCheck('Customers', freshness.customerRecords, 'Customer records unlock retention, CLV, cohorts, and churn risk.'),
        dataCheck('Products and inventory', freshness.productRecords, 'Products unlock stock risk, category performance, and reorder planning.'),
        dataCheck('Traffic', freshness.trafficRecords, 'Traffic metrics unlock source attribution and the full conversion funnel.'),
        dataCheck('Campaigns', freshness.campaignRecords, 'Campaign spend and attributed revenue unlock CAC, ROI, and ROAS.'),
        dataCheck('Cart sessions', freshness.cartRecords, 'Cart sessions unlock abandonment and recovery analytics.')
    ];
    return {
        score: confidence.overall,
        checks,
        lastUpdatedAt: newestTimestamp(Object.values(base?.freshness || {})),
        filteredOrderRecords: Number(raw?.dataQuality?.filtered_order_records || 0),
        totalOrderRecords: Number(raw?.dataQuality?.total_order_records || 0)
    };
}

function buildOnboarding({ base, raw, dataQuality }) {
    const checks = dataQuality.checks.filter((check) => check.status !== 'connected');
    return {
        complete: checks.length === 0,
        steps: checks.map((check) => ({ key: check.key, title: `Connect ${check.label.toLowerCase()}`, description: check.action, action: check.key === 'orders' ? 'import-data' : 'open-settings' })),
        canLoadDemo: Number(raw?.demoState?.real_order_records || 0) === 0 && Number(raw?.demoState?.demo_order_records || 0) === 0,
        hasDemoData: Number(raw?.demoState?.demo_order_records || 0) > 0,
        realDataPresent: Number(raw?.demoState?.real_order_records || 0) > 0,
        limitations: base?.limitations || []
    };
}

function buildNarrativeSummaries({ metrics, period, businessHealth, decisionEngine, revenue }) {
    const byKey = new Map(metrics.map((item) => [item.key, item]));
    const revenueMetric = byKey.get('revenue');
    const orderMetric = byKey.get('orders');
    const executiveHeadline = revenueMetric?.value === 0
        ? 'Connect business data to unlock your operating picture.'
        : revenueMetric?.changePercentage === null
            ? 'Your selected period is ready for review.'
            : revenueMetric.changePercentage >= 0
                ? `Revenue grew ${round(revenueMetric.changePercentage, 1)}% in the selected period.`
                : `Revenue declined ${Math.abs(round(revenueMetric.changePercentage, 1))}% in the selected period.`;
    const executiveSummary = revenueMetric?.value === 0
        ? 'No valid orders were found. The dashboard shows guided setup instead of fabricated metrics.'
        : `${orderMetric.value.toLocaleString('en-US')} valid orders were analyzed. Business health is ${businessHealth.status}${businessHealth.score === null ? '' : ` at ${businessHealth.score}/100`}, with ${decisionEngine.recommendations.filter((item) => item.priority === 'high').length} high-priority action${decisionEngine.recommendations.filter((item) => item.priority === 'high').length === 1 ? '' : 's'}.`;
    const weekly = summarizePeriod('Weekly summary', metrics, revenue.seasonality, decisionEngine);
    const monthly = summarizePeriod('Monthly summary', metrics, revenue.seasonality, decisionEngine);
    return { executiveHeadline, executiveSummary, weekly, monthly, periodLabel: period?.label || 'Selected period' };
}

function buildHeatmap(rows) {
    const cells = rows.map((row) => ({
        weekday: Number(row.weekday || 0),
        hour: Number(row.hour || 0),
        orders: Number(row.orders || 0),
        revenueMinor: Number(row.revenue_minor || 0)
    }));
    const maximumOrders = Math.max(1, ...cells.map((cell) => cell.orders));
    return { cells: cells.map((cell) => ({ ...cell, intensity: round(cell.orders / maximumOrders, 4) })), maximumOrders };
}

function detectAnomalies(daily) {
    const values = daily.map((point) => point.revenueMinor);
    if (values.length < 7) return [];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
    if (!deviation) return [];
    return daily.map((point) => ({ ...point, zScore: (point.revenueMinor - mean) / deviation }))
        .filter((point) => Math.abs(point.zScore) >= 2)
        .map((point) => ({ date: point.date, value: point.revenueMinor, zScore: round(point.zScore, 2), direction: point.zScore > 0 ? 'high' : 'low', confidence: clamp(Math.round(Math.min(99, 70 + Math.abs(point.zScore) * 8)), 0, 99) }))
        .sort((left, right) => Math.abs(right.zScore) - Math.abs(left.zScore));
}

function buildSeasonality(rows, daily) {
    if (rows.length) {
        return rows.map((row) => ({ weekday: Number(row.weekday || 0), orders: Number(row.orders || 0), revenueMinor: Number(row.revenue_minor || 0), averageOrderValueMinor: nullableNumber(row.average_order_value_minor) }));
    }
    const buckets = Array.from({ length: 7 }, (_, weekday) => ({ weekday, days: 0, orders: 0, revenueMinor: 0 }));
    daily.forEach((point) => {
        const weekday = new Date(`${point.date}T00:00:00.000Z`).getUTCDay();
        buckets[weekday].days += 1;
        buckets[weekday].orders += point.orders;
        buckets[weekday].revenueMinor += point.revenueMinor;
    });
    return buckets.map((bucket) => ({ ...bucket, averageOrderValueMinor: bucket.orders ? Math.round(bucket.revenueMinor / bucket.orders) : null }));
}

function buildConfidenceModel({ raw, current, daily, base }) {
    const freshness = base?.freshness || {};
    const orders = confidenceFromRecords(current.orders, Math.max(30, daily.length * 2));
    const orderItems = confidenceFromRecords(freshness.orderItemRecords, Math.max(50, current.orders));
    const customers = confidenceFromRecords(freshness.customerRecords, 100);
    const traffic = confidenceFromRecords(freshness.trafficRecords, Math.max(14, daily.length));
    const campaigns = confidenceFromRecords(freshness.campaignRecords, Math.max(14, daily.length));
    const profit = confidenceFromRecords(base?.metrics?.profit?.sourceRecords, 50);
    const values = [orders, orderItems, customers, traffic, campaigns, profit].filter((value) => value !== null);
    const overall = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    return { orders, orderItems, customers, traffic, campaigns, profit, overall, filteredRecords: Number(raw?.dataQuality?.filtered_order_records || 0) };
}

function normalizeEnterpriseFilters(value) {
    const input = value && typeof value === 'object' ? value : {};
    const businessHours = FILTER_VALUES.businessHours.has(input.businessHours) ? input.businessHours : 'all';
    const compare = FILTER_VALUES.compare.has(input.compare) ? input.compare : 'previous-period';
    return {
        businessHours,
        compare,
        channel: safeFilterText(input.channel, 160),
        location: safeFilterText(input.location, 24)?.toUpperCase() || ''
    };
}

function normalizeSummary(row) {
    return {
        orders: Number(row.orders || 0),
        grossRevenueMinor: Number(row.gross_revenue_minor || 0),
        refundsMinor: Number(row.refunds_minor || 0),
        revenueMinor: Number(row.revenue_minor || 0),
        purchasingCustomers: Number(row.purchasing_customers || 0),
        newCustomers: Number(row.new_customers || 0),
        returningCustomers: Number(row.returning_customers || 0),
        units: Number(row.units || 0),
        profitMinor: nullableNumber(row.profit_minor)
    };
}

function emptySummary() {
    return { orders: 0, grossRevenueMinor: 0, refundsMinor: 0, revenueMinor: 0, purchasingCustomers: 0, newCustomers: 0, returningCustomers: 0, units: 0, profitMinor: null };
}

function normalizeDaily(row) {
    return {
        date: isoDate(row.day),
        orders: Number(row.orders || 0),
        customers: Number(row.customers || 0),
        units: Number(row.units || 0),
        grossRevenueMinor: Number(row.gross_revenue_minor || 0),
        refundsMinor: Number(row.refunds_minor || 0),
        revenueMinor: Number(row.revenue_minor || 0),
        profitMinor: nullableNumber(row.profit_minor)
    };
}

function normalizeRefunds(row) {
    const gross = Number(row.gross_revenue_minor || 0);
    const previousGross = Number(row.previous_gross_revenue_minor || 0);
    return {
        orders: Number(row.orders || 0),
        refundedOrders: Number(row.refunded_orders || 0),
        refundedAmountMinor: Number(row.refunded_amount_minor || 0),
        ratePercentage: gross > 0 ? percentage(row.refunded_amount_minor, gross) : null,
        previousRatePercentage: previousGross > 0 ? percentage(row.previous_refunded_amount_minor, previousGross) : null,
        previousRefundedAmountMinor: Number(row.previous_refunded_amount_minor || 0)
    };
}

function normalizeCustomerAnalytics(row) {
    const purchasing = Number(row.purchasing_customers || 0);
    const repeat = Number(row.repeat_customers || 0);
    const retained = Number(row.retained_customers || 0);
    return {
        purchasingCustomers: purchasing,
        repeatCustomers: repeat,
        averageLifetimeValueMinor: nullableNumber(row.average_lifetime_value_minor),
        repeatPurchaseRatePercentage: purchasing ? percentage(repeat, purchasing) : null,
        retentionRatePercentage: Number(row.eligible_previous_customers || 0) ? percentage(retained, row.eligible_previous_customers) : null,
        retainedCustomers: retained,
        eligiblePreviousCustomers: Number(row.eligible_previous_customers || 0)
    };
}

function normalizeFunnel(row) {
    const result = {};
    for (const [key, value] of Object.entries(row || {})) result[key] = typeof value === 'number' ? value : value;
    return result;
}

function normalizeGeography(row) {
    return { countryCode: row.countryCode || row.country_code || 'Unknown', orders: Number(row.orders || 0), customers: Number(row.customers || 0), revenueMinor: Number(row.revenueMinor || row.revenue_minor || 0) };
}

function normalizeProductPerformance(row) {
    return {
        productId: Number(row.product_id || row.productId || 0),
        productName: row.product_name || row.productName,
        category: row.category_name || row.category || null,
        unitsSold: Number(row.units_sold || row.unitsSold || 0),
        revenueMinor: Number(row.revenue_minor || row.revenueMinor || 0),
        previousRevenueMinor: Number(row.previous_revenue_minor || row.previousRevenueMinor || 0),
        revenueChangePercentage: row.revenue_change_percentage === null || row.revenue_change_percentage === undefined ? growthPercentage(row.revenue_minor, row.previous_revenue_minor) : Number(row.revenue_change_percentage),
        profitMinor: nullableNumber(row.profit_minor ?? row.profitMinor),
        orderCount: Number(row.order_count || row.orderCount || 0),
        refundMinor: Number(row.refund_minor || 0),
        currentStock: nullableNumber(row.current_stock ?? row.currentStock),
        stockRisk: row.stock_risk || row.stockRisk || 'unknown'
    };
}

function normalizeCategoryPerformance(row) {
    return {
        categoryName: row.category_name || row.categoryName || 'Uncategorized',
        products: Number(row.products || 0),
        unitsSold: Number(row.units_sold || row.unitsSold || 0),
        revenueMinor: Number(row.revenue_minor || row.revenueMinor || 0),
        profitMinor: nullableNumber(row.profit_minor ?? row.profitMinor),
        orders: Number(row.orders || 0)
    };
}

function normalizeChannelPerformance(row) {
    const orders = Number(row.orders || 0);
    const revenueMinor = Number(row.revenue_minor || 0);
    return {
        channel: row.channel || 'Unattributed',
        orders,
        customers: Number(row.customers || 0),
        revenueMinor,
        refundsMinor: Number(row.refunds_minor || 0),
        averageOrderValueMinor: orders ? Math.round(revenueMinor / orders) : null,
        sharePercentage: nullableNumber(row.share_percentage)
    };
}

function normalizeFilterOption(row) {
    return { value: String(row.value || ''), label: String(row.label || row.value || ''), records: Number(row.records || 0) };
}

function normalizeDemoState(row) {
    return { active: Number(row.demo_order_records || 0) > 0, demoOrderRecords: Number(row.demo_order_records || 0), realOrderRecords: Number(row.real_order_records || 0), datasetVersion: row.dataset_version || null };
}

function metric(value) {
    return { previousValue: null, changePercentage: null, sparkline: [], workflowSlug: null, ...value, available: value.value !== null && value.value !== undefined, confidence: value.confidence === null || value.confidence === undefined ? 0 : clamp(Math.round(value.confidence), 0, 99) };
}

function recommendation(value) {
    return { priority: 'medium', evidence: [], workflowSlug: null, confidence: 70, impact: 'Medium', ...value };
}

function workflowCard(id, title, triggered, workflowSlug, steps) {
    return { id, title, triggered, status: triggered ? 'action-needed' : 'monitoring', workflowSlug, steps };
}

function dataCheck(label, records, action) {
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { key, label, records: Number(records || 0), status: Number(records || 0) > 0 ? 'connected' : 'setup-required', action };
}

function pushSignal(signals, label, score, weight, explanation) {
    signals.push({ label, score: score === null || score === undefined ? null : clamp(round(score, 1), 0, 100), weight, explanation });
}

function scoreGrowth(value) {
    if (value === null || value === undefined) return null;
    return clamp(55 + Number(value) * 2.2, 0, 100);
}

function scoreThreshold(value, thresholds) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    if (number < thresholds[0]) return 25;
    if (number < thresholds[1]) return 50;
    if (number < thresholds[2]) return 75;
    return 95;
}

function revenueInsight(current, previous) {
    if (!current) return 'Revenue appears after valid paid, fulfilled, or completed orders are connected.';
    const growth = growthPercentage(current, previous);
    if (growth === null) return 'Revenue is available; a prior non-zero period is needed for a trend comparison.';
    return growth >= 0 ? `Net revenue increased ${round(growth, 1)}% versus the comparison period.` : `Net revenue decreased ${Math.abs(round(growth, 1))}% versus the comparison period.`;
}

function volumeInsight(current, previous) {
    if (!current) return 'Order volume appears when valid orders are connected.';
    const growth = growthPercentage(current, previous);
    if (growth === null) return `${current.toLocaleString('en-US')} valid orders were measured.`;
    return growth >= 0 ? `Order volume increased ${round(growth, 1)}%.` : `Order volume decreased ${Math.abs(round(growth, 1))}%.`;
}

function customerInsight(current, previous) {
    if (!current) return 'Customer growth appears after orders are linked to customer records.';
    const growth = growthPercentage(current, previous);
    if (growth === null) return `${current.toLocaleString('en-US')} purchasing customers were measured.`;
    return growth >= 0 ? `Purchasing customers increased ${round(growth, 1)}%.` : `Purchasing customers decreased ${Math.abs(round(growth, 1))}%.`;
}

function aovInsight(current, previous) {
    const value = safeDivide(current.revenueMinor, current.orders);
    const comparison = safeDivide(previous.revenueMinor, previous.orders);
    if (value === null) return 'Average order value unlocks after the first valid order.';
    const growth = growthPercentage(value, comparison);
    if (growth === null) return 'Average order value is calculated from net revenue and valid orders.';
    return growth >= 0 ? `Basket value increased ${round(growth, 1)}%.` : `Basket value decreased ${Math.abs(round(growth, 1))}%.`;
}

function summarizePeriod(title, metrics, seasonality, decisionEngine) {
    const revenue = metrics.find((item) => item.key === 'revenue');
    const orders = metrics.find((item) => item.key === 'orders');
    const bestDay = [...seasonality].sort((a, b) => b.revenueMinor - a.revenueMinor)[0];
    return {
        title,
        bullets: [
            revenue?.changePercentage === null ? 'Revenue comparison is waiting for a non-zero comparison period.' : `Revenue ${revenue.changePercentage >= 0 ? 'grew' : 'declined'} ${Math.abs(round(revenue.changePercentage, 1))}%.`,
            `${orders?.value || 0} valid orders were measured.`,
            bestDay ? `${weekdayName(bestDay.weekday)} produced the most measured revenue.` : 'Seasonality appears after daily order history is connected.',
            decisionEngine.recommendations[0]?.title || 'No urgent action was detected.'
        ]
    };
}

function funnelEvidence(funnel) {
    if (!funnel?.available) return ['Complete traffic funnel data is not connected.'];
    return [
        `Sessions: ${funnel.sessions || 0}`,
        `Product views: ${funnel.productViews || 0}`,
        `Add to carts: ${funnel.addToCarts || 0}`,
        `Checkout starts: ${funnel.checkoutStarts || 0}`,
        `Purchases: ${funnel.purchases || 0}`
    ];
}

function inventoryConfidence(product) {
    let score = 35;
    if (product.currentStock !== null && product.currentStock !== undefined) score += 25;
    if (Number(product.unitsSold || 0) > 0) score += 20;
    if (product.daysOfCover !== null && product.daysOfCover !== undefined) score += 10;
    if (product.reorderPoint !== null && product.reorderPoint !== undefined) score += 10;
    return clamp(score, 0, 99);
}

function reorderQuantity(product) {
    if (product.currentStock === null || product.currentStock === undefined || product.reorderPoint === null || product.reorderPoint === undefined) return null;
    const target = Math.max(Number(product.reorderPoint) * 2, Number(product.inventoryVelocity || 0) * 30);
    return Math.max(0, Math.ceil(target - Number(product.currentStock)));
}

function supplierImpact(product) {
    if (product.daysOfCover === null || product.daysOfCover === undefined) return 'Demand history is required.';
    if (product.reorderPoint !== null && Number(product.currentStock) <= Number(product.reorderPoint)) return 'Supplier lead time may cause a stockout before replenishment arrives.';
    if (product.stockRisk === 'watch') return 'Reorder timing should be reviewed against supplier lead time.';
    return 'Current cover exceeds the calculated reorder threshold.';
}

function confidenceFromRecords(records, target) {
    const count = Number(records || 0);
    if (!count) return 0;
    return clamp(Math.round(35 + Math.log10(count + 1) / Math.log10(Math.max(2, Number(target || 100)) + 1) * 64), 35, 99);
}

function metricValue(value) {
    if (value && typeof value === 'object' && 'value' in value) return value.value === null || value.value === undefined ? null : Number(value.value);
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}

function differencePercentagePoints(current, previous) {
    if (current === null || current === undefined || previous === null || previous === undefined) return null;
    return round(Number(current) - Number(previous), 4);
}

function coefficientOfVariation(values) {
    const rows = values.map(Number).filter(Number.isFinite);
    if (rows.length < 2) return 0.2;
    const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
    if (!mean) return 0.2;
    const deviation = Math.sqrt(rows.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / rows.length);
    return clamp(deviation / mean, 0.05, 1.5);
}

function nullableSum(values) {
    const available = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
    return available.length ? available.reduce((sum, value) => sum + Number(value), 0) : null;
}

function buildPeriod(period, timezone) {
    if (!period?.from || !period?.to) return { from: null, to: null, label: 'Selected period' };
    const from = new Date(period.from);
    const exclusiveTo = new Date(period.to);
    const to = new Date(exclusiveTo.getTime() - 1);
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', dateStyle: 'medium' });
    return { from: from.toISOString(), to: exclusiveTo.toISOString(), label: `${formatter.format(from)} – ${formatter.format(to)}` };
}

function safeFilterText(value, maximum) {
    const text = String(value || '').trim();
    if (!text) return '';
    if ([...text].length > maximum || /[\u0000-\u001F\u007F]/.test(text)) {
        const error = new Error('Choose a valid analytics filter.');
        error.code = 'INVALID_ANALYTICS_FILTER';
        error.publicMessage = error.message;
        error.statusCode = 400;
        throw error;
    }
    return text;
}

function stockRiskRank(value) {
    return ({ 'out-of-stock': 0, critical: 1, low: 2, watch: 3, healthy: 4, unknown: 5 })[value] ?? 6;
}

function nullableAscending(left, right) {
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    return Number(left) - Number(right);
}

function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function isoDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toISOString().slice(0, 10);
}

function isoMonth(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '').slice(0, 7) : date.toISOString().slice(0, 7);
}

function weekdayName(value) {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][Number(value) || 0];
}

function newestTimestamp(values) {
    const timestamps = values
        .filter((value) => typeof value === 'string' || value instanceof Date)
        .map((value) => new Date(value).getTime())
        .filter((value) => Number.isFinite(value) && value >= Date.UTC(2000, 0, 1));
    return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value)));
}

module.exports = {
    buildEnterpriseDashboard,
    createEnterpriseAnalyticsService,
    normalizeEnterpriseFilters
};
