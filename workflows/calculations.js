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
        : toNonNegativeNumber(row.current_stock);
    const unitsSold = toNonNegativeNumber(row.units_sold);
    const previousUnitsSold = row.previous_units_sold === null || row.previous_units_sold === undefined
        ? null
        : toNonNegativeNumber(row.previous_units_sold);
    const currentDailyDemand = safeDivide(unitsSold, periodDays);
    const previousDailyDemand = previousUnitsSold === null ? null : safeDivide(previousUnitsSold, periodDays);
    const projectedDailyDemand = currentDailyDemand === null
        ? null
        : previousDailyDemand === null
            ? currentDailyDemand
            : (currentDailyDemand * 0.7) + (previousDailyDemand * 0.3);
    const averageWeeklyDemand = projectedDailyDemand === null ? null : projectedDailyDemand * 7;
    const projectedDemand = projectedDailyDemand === null ? null : projectedDailyDemand * forecastDays;
    const estimatedDaysOfStock = currentStock !== null && projectedDailyDemand && projectedDailyDemand > 0
        ? safeDivide(currentStock, projectedDailyDemand)
        : null;
    const demandTrendPercentage = previousUnitsSold === null
        ? null
        : growthPercentage(unitsSold, previousUnitsSold);
    const leadTimeDays = nullablePositiveNumber(row.lead_time_days);
    const bufferDays = nullableNonNegativeNumber(row.reorder_buffer_days);
    const reorderPoint = currentStock !== null && projectedDailyDemand !== null && leadTimeDays !== null
        ? projectedDailyDemand * (leadTimeDays + (bufferDays || 0))
        : null;
    const safetyStock = projectedDailyDemand !== null && bufferDays !== null
        ? projectedDailyDemand * bufferDays
        : null;
    const targetStock = currentStock !== null && projectedDailyDemand !== null && leadTimeDays !== null
        ? projectedDailyDemand * (forecastDays + leadTimeDays + (bufferDays || 0))
        : null;
    const recommendedReorderQuantity = targetStock === null
        ? null
        : Math.max(0, Math.ceil(targetStock - currentStock));

    let reorderRecommendation = 'insufficient_data';
    if (currentStock === null) reorderRecommendation = 'insufficient_data';
    else if (projectedDailyDemand === 0) reorderRecommendation = 'no_recent_demand';
    else if (reorderPoint !== null) reorderRecommendation = currentStock <= reorderPoint ? 'reorder' : 'monitor';

    let risk = 'unknown';
    if (currentStock !== null && projectedDailyDemand === 0) risk = 'low';
    else if (estimatedDaysOfStock !== null && leadTimeDays !== null) {
        if (estimatedDaysOfStock <= leadTimeDays) risk = 'critical';
        else if (estimatedDaysOfStock <= leadTimeDays + (bufferDays || 0) + 3) risk = 'high';
        else if (estimatedDaysOfStock <= forecastDays + leadTimeDays) risk = 'medium';
        else risk = 'low';
    }

    return {
        productId: Number(row.product_id),
        productName: String(row.product_name || ''),
        sku: row.sku || null,
        currentStock,
        unitsSold,
        previousUnitsSold,
        averageDailyDemand: projectedDailyDemand,
        currentDailyDemand,
        previousDailyDemand,
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
        recommendedReorderQuantity,
        reorderRecommendation,
        risk,
        confidence: inventoryConfidence(unitsSold, periodDays)
    };
}

function inventoryConfidence(unitsSold, periodDays) {
    if (periodDays < 14 || unitsSold < 3) return 'low';
    if (periodDays < 28 || unitsSold < 10) return 'medium';
    return 'high';
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
