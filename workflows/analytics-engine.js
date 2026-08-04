'use strict';

const {
    growthPercentage,
    inventoryRisk,
    linearForecast,
    normalizeRequestedPeriod,
    nullableNumber,
    percentage,
    round,
    safeDivide,
    stableHash
} = require('./marketing-utils');

function createMarketingAnalyticsEngine({ database, cacheTtlSeconds = 30 } = {}) {
    if (!database) throw new TypeError('A database service is required.');

    return {
        async buildWorkspace({ userId, businessId, from = '', to = '', timezone = 'UTC', defaultDays = 30, bypassCache = false } = {}) {
            const periods = normalizeRequestedPeriod({ from, to, timeZone: timezone, defaultDays });
            const cacheKey = stableHash({ businessId: Number(businessId), from: periods.current.from, to: periods.current.to, version: 3 });
            if (!bypassCache) {
                const cached = await database.getMarketingWorkspaceCache({ userId, businessId, cacheKey });
                if (cached?.payload) return { ...cached.payload, cache: { hit: true, expiresAt: cached.expires_at } };
            }
            const raw = await database.getMarketingWorkspaceData({ userId, businessId, periods });
            const workspace = buildMarketingWorkspace(raw);
            await database.saveMarketingWorkspaceCache({
                businessId,
                cacheKey,
                payload: workspace,
                sourceUpdatedAt: newestTimestamp(Object.values(raw.freshness || {})),
                ttlSeconds: cacheTtlSeconds
            });
            return { ...workspace, cache: { hit: false, expiresAt: null } };
        },

        buildMarketingWorkspace
    };
}

function buildMarketingWorkspace(raw) {
    const business = serializeBusiness(raw.business);
    const summaries = new Map((raw.summary || []).map((row) => [row.period_key, normalizeSummary(row)]));
    const current = summaries.get('current') || emptySummary();
    const previous = summaries.get('previous') || emptySummary();
    const yearAgo = summaries.get('year_ago') || emptySummary();
    const standardSummaries = new Map((raw.standardComparisons || []).map((row) => [row.period_key, normalizeComparisonSummary(row)]));
    const calendarComparisons = buildCalendarComparisons(standardSummaries);
    const customers = normalizeCustomerSummary(raw.customers || {});
    const campaigns = (raw.campaigns || []).map(normalizeCampaign);
    const trafficSources = (raw.trafficSources || []).map(normalizeTrafficSource);
    const carts = normalizeCartSummary(raw.carts || {});
    const daily = (raw.daily || []).map(normalizeDailyPoint);
    const periodDays = Math.max(1, Number(raw.periods?.days || daily.length || 1));
    const products = (raw.products || []).map((row) => normalizeProduct(row, periodDays));
    const inventory = new Map((raw.inventory || []).map((row) => [Number(row.product_id), normalizeInventory(row, periodDays)]));
    const enrichedProducts = products.map((product) => ({ ...product, ...(inventory.get(product.productId) || {}) }));
    const categories = (raw.categories || []).map(normalizeCategory);
    const customerSegments = normalizeSegments(raw.customerSegments || [], customers.totalCustomers);
    const campaignTotals = campaigns.reduce((result, campaign) => addCampaign(result, campaign), emptyCampaignTotals());
    const trafficTotals = trafficSources.reduce((result, source) => addTraffic(result, source), emptyTrafficTotals());
    const revenueForecast = linearForecast(daily.map((point) => ({ date: point.date, value: point.revenueMinor })), 14);
    const demandForecast = linearForecast(daily.map((point) => ({ date: point.date, value: point.units })), 14);
    const topProducts = enrichedProducts.filter((product) => product.unitsSold > 0).slice(0, 10);
    const worstProducts = [...enrichedProducts]
        .sort((left, right) => left.revenueMinor - right.revenueMinor || left.unitsSold - right.unitsSold || left.productName.localeCompare(right.productName))
        .slice(0, 10);
    const decliningProducts = enrichedProducts
        .filter((product) => product.revenueChangePercentage !== null && product.revenueChangePercentage < 0)
        .sort((left, right) => left.revenueChangePercentage - right.revenueChangePercentage || left.revenueMinor - right.revenueMinor)
        .slice(0, 10);
    const stockAlerts = enrichedProducts
        .filter((product) => ['out-of-stock', 'critical', 'low', 'watch'].includes(product.stockRisk))
        .sort((left, right) => stockRank(left.stockRisk) - stockRank(right.stockRisk) || nullableSort(left.daysOfCover, right.daysOfCover));
    const metrics = buildMetrics({
        current,
        previous,
        yearAgo,
        customers,
        campaignTotals,
        trafficTotals,
        carts,
        products: enrichedProducts,
        freshness: raw.freshness || {},
        calendarComparisons
    });
    const opportunities = buildDeterministicOpportunities({
        metrics,
        topProducts,
        worstProducts,
        stockAlerts,
        campaigns,
        trafficSources,
        carts,
        current,
        previous
    });

    return {
        trustworthy: true,
        generatedAt: new Date().toISOString(),
        business,
        dataPeriod: serializePeriod(raw.periods?.current),
        previousPeriod: serializePeriod(raw.periods?.previous),
        yearAgoPeriod: serializePeriod(raw.periods?.yearAgo),
        recordsAnalyzed: sumFreshnessRecords(raw.freshness),
        freshness: normalizeFreshness(raw.freshness || {}),
        metrics,
        trends: {
            daily,
            revenueForecast,
            demandForecast,
            selectedPeriodComparison: compareSummary(current, previous),
            dailyComparison: calendarComparisons.today.comparison,
            weeklyComparison: calendarComparisons.week.comparison,
            monthlyComparison: calendarComparisons.month.comparison,
            quarterlyComparison: calendarComparisons.quarter.comparison,
            yearOverYearComparison: calendarComparisons.year.comparison
        },
        periodComparisons: calendarComparisons,
        products: {
            top: topProducts,
            worst: worstProducts,
            declining: decliningProducts,
            all: enrichedProducts,
            stockAlerts
        },
        categories,
        customers: {
            ...customers,
            segments: customerSegments
        },
        campaigns: {
            totals: campaignTotals,
            rows: campaigns
        },
        funnel: buildFunnel(trafficTotals, campaignTotals, carts, current.orders),
        trafficSources,
        geography: (raw.geography || []).map(normalizeGeography),
        coupons: (raw.coupons || []).map(normalizeCoupon),
        opportunities,
        limitations: buildLimitations({ raw, current, customers, campaigns, trafficSources, carts, products: enrichedProducts })
    };
}

function buildMetrics({ current, previous, yearAgo, customers, campaignTotals, trafficTotals, carts, products, freshness, calendarComparisons }) {
    const newCustomers = current.newCustomers || customers.newCustomerRecords;
    const profitAvailable = current.profitMinor !== null && current.profitItemRecords > 0;
    const acquiringSpend = campaignTotals.spendMinor;
    const conversionDenominator = trafficTotals.sessions > 0 ? trafficTotals.sessions : campaignTotals.visitors;
    const conversions = trafficTotals.purchases > 0 ? trafficTotals.purchases : campaignTotals.conversions;
    const knownInventory = products.filter((product) => product.currentStock !== null);
    const atRiskInventory = knownInventory.filter((product) => ['out-of-stock', 'critical', 'low', 'watch'].includes(product.stockRisk));
    const today = calendarComparisons.today;
    const week = calendarComparisons.week;
    const month = calendarComparisons.month;
    const calendarYear = calendarComparisons.year;
    return {
        revenueToday: comparableMetric(today.current.revenueMinor, today.previous.revenueMinor, 'minor-currency', today.current.orders, 'Requires valid orders today.'),
        revenueThisWeek: comparableMetric(week.current.revenueMinor, week.previous.revenueMinor, 'minor-currency', week.current.orders, 'Requires valid orders this week.'),
        revenueThisMonth: comparableMetric(month.current.revenueMinor, month.previous.revenueMinor, 'minor-currency', month.current.orders, 'Requires valid orders this month.'),
        revenue: comparableMetric(current.revenueMinor, previous.revenueMinor, 'minor-currency', current.orders, 'Requires valid paid, fulfilled, or completed orders.'),
        orders: comparableMetric(current.orders, previous.orders, 'count', current.orders, 'Requires valid paid, fulfilled, or completed orders.'),
        averageOrderValue: scalarMetric(safeDivide(current.revenueMinor, current.orders), 'minor-currency', current.orders, 'Requires at least one valid order.'),
        customerGrowth: comparableMetric(newCustomers, previous.newCustomers, 'count', Number(freshness.customer_records || 0), 'Requires customer records with first-seen dates.'),
        revenueGrowthPercentage: scalarMetric(growthPercentage(current.revenueMinor, previous.revenueMinor), 'percentage', previous.orders, 'Requires a non-zero previous-period revenue value.'),
        returningCustomerPercentage: scalarMetric(percentage(current.returningCustomers, current.purchasingCustomers), 'percentage', current.purchasingCustomers, 'Requires customer-linked orders.'),
        newCustomers: scalarMetric(newCustomers, 'count', Number(freshness.customer_records || 0), 'Requires customer records or customer-linked orders.'),
        returningCustomers: scalarMetric(current.returningCustomers, 'count', current.purchasingCustomers, 'Requires customer-linked orders.'),
        profit: scalarMetric(profitAvailable ? current.profitMinor : null, 'minor-currency', current.profitItemRecords, 'Requires product cost and order-item revenue for sold items.'),
        profitMarginPercentage: scalarMetric(profitAvailable ? percentage(current.profitMinor, current.revenueMinor) : null, 'percentage', current.profitItemRecords, 'Requires product cost and order-item revenue.'),
        conversionRatePercentage: scalarMetric(percentage(conversions, conversionDenominator), 'percentage', conversionDenominator, 'Requires connected traffic or campaign visitor data.'),
        customerAcquisitionCost: scalarMetric(newCustomers > 0 && acquiringSpend > 0 ? safeDivide(acquiringSpend, newCustomers) : null, 'minor-currency', campaignTotals.records, 'Requires campaign spend and new-customer records in the same period.'),
        customerLifetimeValue: scalarMetric(customers.averageCustomerLifetimeValueMinor, 'minor-currency', customers.purchasingCustomers, 'Requires customer-linked order history.'),
        repeatPurchaseRatePercentage: scalarMetric(percentage(customers.repeatCustomers, customers.purchasingCustomers), 'percentage', customers.purchasingCustomers, 'Requires customer-linked order history.'),
        abandonedCarts: scalarMetric(carts.abandonedCarts, 'count', carts.carts, 'Requires imported cart-session records.'),
        abandonedCartValue: scalarMetric(carts.abandonedValueMinor, 'minor-currency', carts.carts, 'Requires imported cart-session records.'),
        marketingRoiPercentage: scalarMetric(campaignTotals.spendMinor > 0 ? percentage(campaignTotals.attributedRevenueMinor - campaignTotals.spendMinor, campaignTotals.spendMinor) : null, 'percentage', campaignTotals.records, 'Requires campaign spend and attributed revenue.'),
        campaignReturnOnSpend: scalarMetric(campaignTotals.spendMinor > 0 ? safeDivide(campaignTotals.attributedRevenueMinor, campaignTotals.spendMinor) : null, 'ratio', campaignTotals.records, 'Requires campaign spend and attributed revenue.'),
        inventoryAtRisk: scalarMetric(atRiskInventory.length, 'count', knownInventory.length, 'Requires current stock for active products.'),
        yearOverYearRevenueGrowthPercentage: scalarMetric(growthPercentage(calendarYear.current.revenueMinor, calendarYear.previous.revenueMinor), 'percentage', calendarYear.previous.orders, 'Requires comparable year-to-date order data from one year earlier.')
    };
}

function buildFunnel(traffic, campaigns, carts, orders) {
    const sessions = traffic.sessions || campaigns.visitors;
    const productViews = traffic.productViews;
    const addToCarts = traffic.addToCarts || carts.carts;
    const checkoutStarts = traffic.checkoutStarts;
    const purchases = traffic.purchases || campaigns.conversions || orders;
    return {
        sessions,
        productViews,
        addToCarts,
        checkoutStarts,
        purchases,
        sessionToProductViewPercentage: percentage(productViews, sessions),
        productViewToCartPercentage: percentage(addToCarts, productViews),
        cartToCheckoutPercentage: percentage(checkoutStarts, addToCarts),
        checkoutToPurchasePercentage: percentage(purchases, checkoutStarts),
        overallConversionPercentage: percentage(purchases, sessions),
        available: sessions > 0,
        source: traffic.sessions > 0 ? 'traffic-daily-metrics' : campaigns.visitors > 0 ? 'campaign-daily-metrics' : orders > 0 ? 'orders-only' : null
    };
}

function buildDeterministicOpportunities({ metrics, topProducts, worstProducts, stockAlerts, campaigns, trafficSources, carts, current, previous }) {
    const opportunities = [];
    const revenueGrowth = metrics.revenueGrowthPercentage.value;
    if (revenueGrowth !== null && revenueGrowth < 0) opportunities.push(opportunity('revenue-decline', 'Revenue declined versus the previous comparable period', 'high', { changePercentage: revenueGrowth, currentRevenueMinor: current.revenueMinor, previousRevenueMinor: previous.revenueMinor }));
    if (topProducts[0]) opportunities.push(opportunity('best-seller', `Protect and expand demand for ${topProducts[0].productName}`, 'medium', { productId: topProducts[0].productId, revenueMinor: topProducts[0].revenueMinor, unitsSold: topProducts[0].unitsSold }));
    if (worstProducts[0]) opportunities.push(opportunity('low-performer', `Review positioning for ${worstProducts[0].productName}`, 'medium', { productId: worstProducts[0].productId, revenueMinor: worstProducts[0].revenueMinor, unitsSold: worstProducts[0].unitsSold }));
    if (stockAlerts[0]) opportunities.push(opportunity('stock-risk', `${stockAlerts[0].productName} has ${stockAlerts[0].stockRisk} stock risk`, stockAlerts[0].stockRisk === 'out-of-stock' || stockAlerts[0].stockRisk === 'critical' ? 'high' : 'medium', { productId: stockAlerts[0].productId, currentStock: stockAlerts[0].currentStock, daysOfCover: stockAlerts[0].daysOfCover }));
    const weakCampaign = campaigns.filter((row) => row.spendMinor > 0).sort((a, b) => nullableSort(a.roas, b.roas))[0];
    if (weakCampaign && weakCampaign.roas !== null && weakCampaign.roas < 1) opportunities.push(opportunity('campaign-loss', `${weakCampaign.campaignName} is returning less attributed revenue than spend`, 'high', { campaignName: weakCampaign.campaignName, spendMinor: weakCampaign.spendMinor, attributedRevenueMinor: weakCampaign.attributedRevenueMinor, roas: weakCampaign.roas }));
    const bestSource = trafficSources[0];
    if (bestSource) opportunities.push(opportunity('traffic-source', `${bestSource.sourceName} is the largest measured traffic source`, 'low', { sourceName: bestSource.sourceName, sessions: bestSource.sessions, purchases: bestSource.purchases }));
    if (carts.abandonedCarts > 0) opportunities.push(opportunity('cart-recovery', `${carts.abandonedCarts} carts were abandoned in the selected period`, 'high', { abandonedCarts: carts.abandonedCarts, abandonedValueMinor: carts.abandonedValueMinor }));
    return opportunities;
}

function buildLimitations({ raw, current, customers, campaigns, trafficSources, carts, products }) {
    const limitations = [];
    const freshness = raw.freshness || {};
    if (!current.orders) limitations.push('No valid paid, fulfilled, or completed orders were found in the selected period.');
    if (!Number(freshness.customer_records || 0)) limitations.push('No customer records are connected.');
    if (!products.some((product) => product.profitMinor !== null)) limitations.push('Profit metrics are unavailable until product cost and order-item revenue are connected.');
    if (!campaigns.length) limitations.push('Campaign performance, CAC, ROI, and ROAS require campaign daily metrics.');
    if (!trafficSources.length) limitations.push('Traffic sources and the complete conversion funnel require traffic daily metrics.');
    if (!carts.carts) limitations.push('Abandoned-cart metrics require cart-session records.');
    if (!customers.purchasingCustomers) limitations.push('CLV and repeat-purchase metrics require customer-linked orders.');
    return limitations;
}

function normalizeSummary(row) {
    return {
        orders: Number(row.orders || 0),
        revenueMinor: Number(row.revenue_minor || 0),
        purchasingCustomers: Number(row.purchasing_customers || 0),
        newCustomers: Number(row.new_customers || 0),
        returningCustomers: Number(row.returning_customers || 0),
        profitMinor: nullableNumber(row.profit_minor),
        profitItemRecords: Number(row.profit_item_records || 0),
        firstOrderAt: row.first_order_at || null,
        lastOrderAt: row.last_order_at || null
    };
}

function emptySummary() {
    return { orders: 0, revenueMinor: 0, purchasingCustomers: 0, newCustomers: 0, returningCustomers: 0, profitMinor: null, profitItemRecords: 0, firstOrderAt: null, lastOrderAt: null };
}

function normalizeComparisonSummary(row) {
    return {
        ...normalizeSummary(row),
        from: row.from_at ? new Date(row.from_at).toISOString() : null,
        to: row.to_at ? new Date(row.to_at).toISOString() : null
    };
}

function buildCalendarComparisons(summaries) {
    const pair = (currentKey, previousKey) => {
        const current = summaries.get(currentKey) || emptySummary();
        const previous = summaries.get(previousKey) || emptySummary();
        return {
            current,
            previous,
            comparison: compareSummary(current, previous)
        };
    };
    return {
        today: pair('today_current', 'today_previous'),
        week: pair('week_current', 'week_previous'),
        month: pair('month_current', 'month_previous'),
        quarter: pair('quarter_current', 'quarter_previous'),
        year: pair('year_current', 'year_ago')
    };
}

function normalizeDailyPoint(row) {
    return { date: isoDate(row.day), revenueMinor: Number(row.revenue_minor || 0), orders: Number(row.orders || 0), customers: Number(row.customers || 0), units: Number(row.units || 0), profitMinor: nullableNumber(row.profit_minor) };
}

function normalizeProduct(row, periodDays) {
    const risk = inventoryRisk({ currentStock: row.current_stock, unitsSold: row.units_sold, periodDays, leadTimeDays: row.lead_time_days, reorderBufferDays: row.reorder_buffer_days });
    return {
        productId: Number(row.product_id), productName: row.product_name, sku: row.sku || null, category: row.category_name || null,
        priceMinor: nullableNumber(row.price_minor), costMinor: nullableNumber(row.cost_minor), currentStock: nullableNumber(row.current_stock),
        unitsSold: Number(row.units_sold || 0), revenueMinor: Number(row.revenue_minor || 0), profitMinor: nullableNumber(row.profit_minor),
        previousUnitsSold: Number(row.previous_units_sold || 0), previousRevenueMinor: Number(row.previous_revenue_minor || 0),
        unitChangePercentage: growthPercentage(row.units_sold, row.previous_units_sold), revenueChangePercentage: growthPercentage(row.revenue_minor, row.previous_revenue_minor),
        orderCount: Number(row.order_count || 0), lastSoldAt: row.last_sold_at || null,
        inventoryVelocity: risk.velocity, daysOfCover: risk.daysOfCover, reorderPoint: risk.reorderPoint, stockRisk: risk.level
    };
}

function normalizeInventory(row, periodDays) {
    const risk = inventoryRisk({ currentStock: row.current_stock, unitsSold: row.units_sold, periodDays, leadTimeDays: row.lead_time_days, reorderBufferDays: row.reorder_buffer_days });
    return { currentStock: nullableNumber(row.current_stock), inventoryVelocity: risk.velocity, daysOfCover: risk.daysOfCover, reorderPoint: risk.reorderPoint, stockRisk: risk.level };
}

function normalizeCategory(row) {
    return { categoryName: row.category_name, products: Number(row.products || 0), unitsSold: Number(row.units_sold || 0), revenueMinor: Number(row.revenue_minor || 0), profitMinor: nullableNumber(row.profit_minor), orders: Number(row.orders || 0) };
}

function normalizeCustomerSummary(row) {
    return {
        totalCustomers: Number(row.total_customers || 0), purchasingCustomers: Number(row.purchasing_customers || 0), repeatCustomers: Number(row.repeat_customers || 0),
        customerLifetimeRevenueMinor: Number(row.customer_lifetime_revenue_minor || 0), averageCustomerLifetimeValueMinor: nullableNumber(row.average_customer_lifetime_value_minor),
        newCustomerRecords: Number(row.new_customer_records || 0), activeCustomerRecords: Number(row.active_customer_records || 0)
    };
}

function normalizeSegments(rows, totalCustomers) {
    return rows.map((row) => ({ segment: row.segment, customers: Number(row.customers || 0), revenueMinor: Number(row.revenue_minor || 0), averageLifetimeValueMinor: nullableNumber(row.average_lifetime_value_minor), sharePercentage: percentage(row.customers, totalCustomers) }));
}

function normalizeCampaign(row) {
    const spendMinor = Number(row.spend_minor || 0); const attributedRevenueMinor = Number(row.attributed_revenue_minor || 0); const impressions = Number(row.impressions || 0); const clicks = Number(row.clicks || 0); const visitors = Number(row.visitors || 0); const conversions = Number(row.conversions || 0);
    return { campaignName: row.campaign_name, sourceName: row.source_name || null, spendMinor, attributedRevenueMinor, impressions, clicks, visitors, leads: Number(row.leads || 0), conversions, roas: spendMinor > 0 ? round(attributedRevenueMinor / spendMinor, 4) : null, ctrPercentage: percentage(clicks, impressions), conversionRatePercentage: percentage(conversions, visitors), cacMinor: conversions > 0 ? round(spendMinor / conversions, 2) : null, retrievedAt: row.retrieved_at || null };
}

function normalizeTrafficSource(row) {
    const sessions = Number(row.sessions || 0); const purchases = Number(row.purchases || 0);
    return { sourceName: row.source_name, mediumName: row.medium_name || null, sessions, users: Number(row.users || 0), newUsers: Number(row.new_users || 0), productViews: Number(row.product_views || 0), addToCarts: Number(row.add_to_carts || 0), checkoutStarts: Number(row.checkout_starts || 0), purchases, revenueMinor: Number(row.revenue_minor || 0), conversionRatePercentage: percentage(purchases, sessions), retrievedAt: row.retrieved_at || null };
}

function normalizeCartSummary(row) {
    return { carts: Number(row.carts || 0), abandonedCarts: Number(row.abandoned_carts || 0), convertedCarts: Number(row.converted_carts || 0), abandonedValueMinor: Number(row.abandoned_value_minor || 0), recoveredValueMinor: Number(row.recovered_value_minor || 0), recoveryRatePercentage: percentage(row.converted_carts, row.carts) };
}

function normalizeGeography(row) { return { countryCode: row.country_code, orders: Number(row.orders || 0), customers: Number(row.customers || 0), revenueMinor: Number(row.revenue_minor || 0) }; }
function normalizeCoupon(row) { return { couponCode: row.coupon_code, orders: Number(row.orders || 0), customers: Number(row.customers || 0), revenueMinor: Number(row.revenue_minor || 0) }; }
function serializeBusiness(row) { return { id: Number(row.id), name: row.name, currency: row.currency, timezone: row.timezone, industry: row.industry || null, businessType: row.business_type || null }; }
function serializePeriod(period) { return period ? { from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString() } : null; }
function compareSummary(current, comparison) { return { revenueGrowthPercentage: growthPercentage(current.revenueMinor, comparison.revenueMinor), orderGrowthPercentage: growthPercentage(current.orders, comparison.orders), customerGrowthPercentage: growthPercentage(current.purchasingCustomers, comparison.purchasingCustomers), profitGrowthPercentage: current.profitMinor === null || comparison.profitMinor === null ? null : growthPercentage(current.profitMinor, comparison.profitMinor) }; }
function scalarMetric(value, unit, sourceRecords, reason) { return { value: value === null || value === undefined || !Number.isFinite(Number(value)) ? null : round(Number(value), unit === 'minor-currency' || unit === 'count' ? 0 : 4), unit, available: Number(sourceRecords || 0) > 0 && value !== null && value !== undefined, reason: Number(sourceRecords || 0) > 0 && value !== null && value !== undefined ? null : reason, sourceRecords: Number(sourceRecords || 0) }; }
function comparableMetric(value, previousValue, unit, sourceRecords, reason) { const metric = scalarMetric(value, unit, sourceRecords, reason); return { ...metric, previousValue: Number(previousValue || 0), changePercentage: metric.available ? growthPercentage(value, previousValue) : null }; }
function emptyCampaignTotals() { return { records: 0, spendMinor: 0, attributedRevenueMinor: 0, impressions: 0, clicks: 0, visitors: 0, leads: 0, conversions: 0, roas: null }; }
function addCampaign(total, row) { total.records += 1; total.spendMinor += row.spendMinor; total.attributedRevenueMinor += row.attributedRevenueMinor; total.impressions += row.impressions; total.clicks += row.clicks; total.visitors += row.visitors; total.leads += row.leads; total.conversions += row.conversions; total.roas = total.spendMinor > 0 ? round(total.attributedRevenueMinor / total.spendMinor, 4) : null; return total; }
function emptyTrafficTotals() { return { records: 0, sessions: 0, users: 0, newUsers: 0, productViews: 0, addToCarts: 0, checkoutStarts: 0, purchases: 0, revenueMinor: 0 }; }
function addTraffic(total, row) { total.records += 1; for (const key of ['sessions', 'users', 'newUsers', 'productViews', 'addToCarts', 'checkoutStarts', 'purchases', 'revenueMinor']) total[key] += row[key]; return total; }
function opportunity(key, title, priority, evidence) { return { key, title, priority, evidence, source: 'deterministic-analytics' }; }
function normalizeFreshness(row) { return { orderRecords: Number(row.order_records || 0), orderItemRecords: Number(row.order_item_records || 0), customerRecords: Number(row.customer_records || 0), productRecords: Number(row.product_records || 0), campaignRecords: Number(row.campaign_records || 0), trafficRecords: Number(row.traffic_records || 0), cartRecords: Number(row.cart_records || 0), competitorRecords: Number(row.competitor_records || 0), ordersUpdatedAt: row.orders_updated_at || null, productsUpdatedAt: row.products_updated_at || null, customersUpdatedAt: row.customers_updated_at || null, campaignsUpdatedAt: row.campaigns_updated_at || null, trafficUpdatedAt: row.traffic_updated_at || null }; }
function sumFreshnessRecords(row) { return ['order_records', 'order_item_records', 'customer_records', 'product_records', 'campaign_records', 'traffic_records', 'cart_records', 'competitor_records'].reduce((sum, key) => sum + Number(row?.[key] || 0), 0); }
function newestTimestamp(values) { const timestamps = values.map((value) => new Date(value).getTime()).filter(Number.isFinite); return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null; }
function isoDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value || ''); }
function stockRank(value) { return ({ 'out-of-stock': 0, critical: 1, low: 2, watch: 3, healthy: 4, unknown: 5 })[value] ?? 6; }
function nullableSort(left, right) { if (left === null && right === null) return 0; if (left === null) return 1; if (right === null) return -1; return Number(left) - Number(right); }

module.exports = { buildMarketingWorkspace, createMarketingAnalyticsEngine };
