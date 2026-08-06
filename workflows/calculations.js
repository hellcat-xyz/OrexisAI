'use strict';

function safeDivide(numerator, denominator) {
    if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) return null;
    const left = Number(numerator);
    const right = Number(denominator);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return null;
    return left / right;
}

function growthPercentage(currentValue, previousValue) {
    const current = Number(currentValue);
    const previous = Number(previousValue);
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
    return ((current - previous) / previous) * 100;
}

function startOfIsoWeek(value = new Date()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('A valid date is required.');
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() - day + 1);
    return utc;
}

function addUtcDays(value, days) {
    const date = new Date(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
}

function resolveComparablePeriod({ from, to, now = new Date() } = {}) {
    let periodStart;
    let periodEnd;

    if (from || to) {
        periodStart = parseDateBoundary(from, false);
        periodEnd = parseDateBoundary(to, true);
        if (!periodStart || !periodEnd || periodEnd <= periodStart) {
            const error = new Error('The selected date range is invalid.');
            error.statusCode = 400;
            error.publicMessage = 'Choose a valid date range.';
            throw error;
        }
        const maximumRangeMs = 366 * 24 * 60 * 60 * 1000;
        if (periodEnd - periodStart > maximumRangeMs) {
            const error = new Error('Date ranges cannot exceed 366 days.');
            error.statusCode = 400;
            error.publicMessage = 'Choose a date range of 366 days or less.';
            throw error;
        }
    } else {
        periodStart = startOfIsoWeek(now);
        periodEnd = new Date(Math.min(addUtcDays(periodStart, 7).getTime(), new Date(now).getTime()));
        if (periodEnd <= periodStart) periodEnd = addUtcDays(periodStart, 1);
    }

    const durationMs = periodEnd - periodStart;
    return {
        current: { from: periodStart, to: periodEnd },
        previous: {
            from: new Date(periodStart.getTime() - durationMs),
            to: periodStart
        },
        days: Math.max(1, durationMs / (24 * 60 * 60 * 1000))
    };
}

function parseDateBoundary(value, inclusiveEnd) {
    if (!value) return null;
    const text = String(value).trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const date = new Date(dateOnly ? `${text}T00:00:00.000Z` : text);
    if (Number.isNaN(date.getTime())) return null;
    if (inclusiveEnd && dateOnly) date.setUTCDate(date.getUTCDate() + 1);
    return date;
}

function calculateInventoryForecast(row, periodDays, forecastDays = 7) {
    const currentStock = row.current_stock === null || row.current_stock === undefined
        ? null
        : nullableNonNegativeNumber(row.current_stock);
    const reservedStock = toNonNegativeNumber(row.reserved_stock);
    const damagedStock = toNonNegativeNumber(row.damaged_stock);
    const returnedStock = toNonNegativeNumber(row.returned_stock);
    const incomingStock = toNonNegativeNumber(row.incoming_stock);
    const availableStock = currentStock === null
        ? null
        : Math.max(0, currentStock - reservedStock - damagedStock + returnedStock);
    const unitsSold = toNonNegativeNumber(row.units_sold);
    const previousUnitsSold = toNonNegativeNumber(row.previous_units_sold);
    const yearAgoUnitsSold = toNonNegativeNumber(row.year_ago_units_sold);
    const currentDailyDemand = safeDivide(unitsSold, periodDays);
    const previousDailyDemand = safeDivide(previousUnitsSold, periodDays);
    const yearAgoDailyDemand = safeDivide(yearAgoUnitsSold, periodDays);
    const hasCurrentPeriod = Number(row.order_records || 0) > 0 || unitsSold > 0;
    const hasPreviousPeriod = Number(row.previous_order_records || 0) > 0 || previousUnitsSold > 0;
    const hasYearAgoPeriod = Number(row.year_ago_order_records || 0) > 0 || yearAgoUnitsSold > 0;
    let baselineDailyDemand = null;
    if (hasCurrentPeriod && hasPreviousPeriod && hasYearAgoPeriod) {
        baselineDailyDemand = currentDailyDemand * 0.55
            + previousDailyDemand * 0.25
            + yearAgoDailyDemand * 0.20;
    } else if (hasCurrentPeriod && hasPreviousPeriod) {
        baselineDailyDemand = currentDailyDemand * 0.70 + previousDailyDemand * 0.30;
    } else if (hasCurrentPeriod) {
        baselineDailyDemand = currentDailyDemand;
    } else if (hasPreviousPeriod && hasYearAgoPeriod) {
        baselineDailyDemand = previousDailyDemand * 0.65 + yearAgoDailyDemand * 0.35;
    } else if (hasPreviousPeriod) {
        baselineDailyDemand = previousDailyDemand;
    } else if (hasYearAgoPeriod) {
        baselineDailyDemand = yearAgoDailyDemand;
    }

    const productViews = toNonNegativeNumber(row.product_views);
    const previousProductViews = toNonNegativeNumber(row.previous_product_views);
    const cartAdds = toNonNegativeNumber(row.cart_adds);
    const previousCartAdds = toNonNegativeNumber(row.previous_cart_adds);
    const intentGrowth = previousCartAdds > 0
        ? (cartAdds - previousCartAdds) / previousCartAdds
        : previousProductViews > 0
            ? (productViews - previousProductViews) / previousProductViews
            : 0;
    const onlineIntentFactor = clamp(1 + intentGrowth * 0.08, 0.9, 1.15);
    const promotionDiscount = toNonNegativeNumber(row.promotion_discount_percentage);
    const promotionFactor = 1 + Math.min(0.35, promotionDiscount / 100 * 1.25);
    const seasonalFactor = clamp(nullablePositiveNumber(row.seasonal_demand_multiplier) || 1, 0.7, 2.25);
    const weatherFactor = inventoryWeatherFactor(row);
    const projectedDailyDemand = baselineDailyDemand === null
        ? null
        : baselineDailyDemand * onlineIntentFactor * promotionFactor * seasonalFactor * weatherFactor;
    const averageWeeklyDemand = projectedDailyDemand === null ? null : projectedDailyDemand * 7;
    const projectedDemand = projectedDailyDemand === null ? null : projectedDailyDemand * forecastDays;
    const estimatedDaysOfStock = availableStock !== null && projectedDailyDemand && projectedDailyDemand > 0
        ? safeDivide(availableStock, projectedDailyDemand)
        : null;
    const demandTrendPercentage = previousUnitsSold > 0
        ? growthPercentage(unitsSold, previousUnitsSold)
        : null;
    const leadTimeDays = nullablePositiveNumber(row.effective_lead_time_days ?? row.lead_time_days);
    const bufferDays = nullableNonNegativeNumber(row.reorder_buffer_days);
    const configuredSafetyStock = nullableNonNegativeNumber(row.safety_stock);
    const calculatedSafetyStock = projectedDailyDemand !== null && bufferDays !== null
        ? projectedDailyDemand * bufferDays
        : null;
    const safetyStock = configuredSafetyStock ?? calculatedSafetyStock;
    const calculatedReorderPoint = projectedDailyDemand !== null && leadTimeDays !== null
        ? projectedDailyDemand * leadTimeDays + (safetyStock || 0)
        : null;
    const configuredReorderPoint = nullableNonNegativeNumber(row.configured_reorder_point);
    const reorderPoint = calculatedReorderPoint === null
        ? configuredReorderPoint
        : Math.max(configuredReorderPoint || 0, calculatedReorderPoint);
    const targetStock = projectedDailyDemand !== null && leadTimeDays !== null
        ? projectedDailyDemand * (forecastDays + leadTimeDays) + (safetyStock || 0)
        : null;
    const netStockPosition = availableStock === null ? null : availableStock + incomingStock;
    const rawReorderQuantity = targetStock === null || netStockPosition === null
        ? null
        : Math.max(0, targetStock - netStockPosition);
    const configuredReorderQuantity = nullablePositiveNumber(row.configured_reorder_quantity);
    const recommendedReorderQuantity = rawReorderQuantity === null
        ? null
        : configuredReorderQuantity
            ? Math.ceil(rawReorderQuantity / configuredReorderQuantity) * configuredReorderQuantity
            : Math.ceil(rawReorderQuantity);

    let reorderRecommendation = 'insufficient_data';
    if (availableStock === null || projectedDailyDemand === null) reorderRecommendation = 'insufficient_data';
    else if (projectedDailyDemand === 0) reorderRecommendation = 'no_recent_demand';
    else if (reorderPoint !== null && availableStock <= reorderPoint) reorderRecommendation = 'reorder';
    else if (targetStock !== null && availableStock > targetStock * 1.8) reorderRecommendation = 'overstock_review';
    else reorderRecommendation = 'monitor';

    let risk = 'unknown';
    if (availableStock !== null && availableStock <= 0) risk = 'out_of_stock';
    else if (availableStock !== null && projectedDailyDemand === 0) risk = availableStock > 0 ? 'overstock' : 'low';
    else if (estimatedDaysOfStock !== null && leadTimeDays !== null) {
        if (estimatedDaysOfStock <= leadTimeDays) risk = 'critical';
        else if (estimatedDaysOfStock <= leadTimeDays + (bufferDays || 0) + 3) risk = 'high';
        else if (estimatedDaysOfStock <= forecastDays + leadTimeDays) risk = 'medium';
        else if (targetStock !== null && availableStock > targetStock * 1.8) risk = 'overstock';
        else risk = 'low';
    }

    return {
        productId: Number(row.product_id),
        productName: String(row.product_name || ''),
        sku: row.sku || null,
        barcode: row.barcode || null,
        brand: row.brand || null,
        categoryName: row.category_name || null,
        supplierName: row.supplier_name || null,
        supplierReliabilityScore: row.supplier_reliability_score === null || row.supplier_reliability_score === undefined
            ? null
            : nullableNonNegativeNumber(row.supplier_reliability_score),
        currentStock,
        reservedStock,
        damagedStock,
        returnedStock,
        availableStock,
        incomingStock,
        netStockPosition,
        unitsSold,
        previousUnitsSold,
        yearAgoUnitsSold,
        orderRecords: Number(row.order_records || 0),
        previousOrderRecords: Number(row.previous_order_records || 0),
        yearAgoOrderRecords: Number(row.year_ago_order_records || 0),
        averageDailyDemand: projectedDailyDemand,
        baselineDailyDemand,
        currentDailyDemand,
        previousDailyDemand,
        yearAgoDailyDemand,
        averageWeeklyDemand,
        forecastDays,
        projectedDemand,
        estimatedDaysOfStock,
        demandTrendPercentage,
        leadTimeDays,
        reorderBufferDays: bufferDays,
        safetyStock,
        reorderPoint,
        targetStock,
        configuredReorderQuantity,
        recommendedReorderQuantity,
        reorderRecommendation,
        risk,
        demandSignals: {
            onlineIntentFactor,
            promotionFactor,
            seasonalFactor,
            weatherFactor,
            activePromotions: row.active_promotions || null,
            seasonalEvents: row.seasonal_events || null,
            nextDeliveryDate: row.next_delivery_date || null
        },
        confidence: inventoryConfidence({ unitsSold, previousUnitsSold, yearAgoUnitsSold, periodDays, row })
    };
}

function inventoryWeatherFactor(row) {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const sensitivity = String(metadata.weatherSensitivity || '').toLowerCase();
    const temperature = Number(row.forecast_temperature_c);
    const rainfall = Number(row.forecast_rainfall_mm);
    if (sensitivity === 'hot' && Number.isFinite(temperature) && temperature >= 30) return 1.18;
    if (sensitivity === 'cold' && Number.isFinite(temperature) && temperature <= 18) return 1.16;
    if (sensitivity === 'rain' && Number.isFinite(rainfall) && rainfall >= 8) return 1.28;
    if (sensitivity === 'summer' && Number.isFinite(temperature) && temperature >= 28) return 1.12;
    if (sensitivity === 'winter' && Number.isFinite(temperature) && temperature <= 20) return 1.12;
    return 1;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value)));
}

function inventoryConfidence({ unitsSold, previousUnitsSold, yearAgoUnitsSold, periodDays, row }) {
    let score = 0;
    if (periodDays >= 28) score += 1;
    if (unitsSold >= 10) score += 1;
    if (previousUnitsSold >= 5) score += 1;
    if (yearAgoUnitsSold >= 5) score += 1;
    if (row.counted_at) score += 1;
    if (row.supplier_name && Number(row.effective_lead_time_days) > 0) score += 1;
    if (Number(row.product_views || 0) > 0) score += 1;
    if (score >= 6) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
}

function toNonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function nullablePositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nullableNonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

module.exports = {
    addUtcDays,
    calculateInventoryForecast,
    growthPercentage,
    resolveComparablePeriod,
    safeDivide,
    startOfIsoWeek
};
