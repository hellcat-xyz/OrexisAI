'use strict';

const crypto = require('node:crypto');

function safeDivide(numerator, denominator) {
    const left = Number(numerator);
    const right = Number(denominator);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return null;
    return left / right;
}

function percentage(numerator, denominator) {
    const value = safeDivide(Number(numerator) * 100, denominator);
    return value === null ? null : round(value, 4);
}

function growthPercentage(current, previous) {
    const currentValue = Number(current);
    const previousValue = Number(previous);
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) return null;
    return round(((currentValue - previousValue) / Math.abs(previousValue)) * 100, 4);
}

function round(value, precision = 2) {
    if (!Number.isFinite(Number(value))) return null;
    const factor = 10 ** Math.max(0, Math.min(8, precision));
    return Math.round(Number(value) * factor) / factor;
}

function utcStartOfDay(value = new Date()) {
    const date = validDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcStartOfIsoWeek(value = new Date()) {
    const date = utcStartOfDay(value);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date;
}

function utcStartOfMonth(value = new Date()) {
    const date = validDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function utcStartOfQuarter(value = new Date()) {
    const date = validDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}

function utcStartOfYear(value = new Date()) {
    const date = validDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function addUtcDays(value, days) {
    const date = validDate(value);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date;
}

function addUtcMonths(value, months) {
    const date = validDate(value);
    date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
    return date;
}

function addUtcYears(value, years) {
    const date = validDate(value);
    const targetYear = date.getUTCFullYear() + Number(years || 0);
    const month = date.getUTCMonth();
    const maximumDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(
        targetYear,
        month,
        Math.min(date.getUTCDate(), maximumDay),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds()
    ));
}

function zonedParts(value, timeZone = 'UTC') {
    const date = validDate(value);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function zonedDateToUtc(parts, timeZone = 'UTC') {
    let guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0));
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const rendered = zonedParts(guess, timeZone);
        const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
        const actual = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour || 0, rendered.minute || 0, rendered.second || 0);
        const difference = target - actual;
        if (difference === 0) break;
        guess = new Date(guess.getTime() + difference);
    }
    return guess;
}

function addZonedDays(value, days, timeZone = 'UTC') {
    const parts = zonedParts(value, timeZone);
    const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0), parts.hour, parts.minute, parts.second));
    return zonedDateToUtc({
        year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate(),
        hour: calendar.getUTCHours(), minute: calendar.getUTCMinutes(), second: calendar.getUTCSeconds()
    }, timeZone);
}

function addZonedYears(value, years, timeZone = 'UTC') {
    const parts = zonedParts(value, timeZone);
    const targetYear = parts.year + Number(years || 0);
    const maximumDay = new Date(Date.UTC(targetYear, parts.month, 0)).getUTCDate();
    return zonedDateToUtc({ ...parts, year: targetYear, day: Math.min(parts.day, maximumDay) }, timeZone);
}

function zonedStartOfDay(value, timeZone = 'UTC') {
    const parts = zonedParts(value, timeZone);
    return zonedDateToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 }, timeZone);
}

function zonedDaySpan(from, to, timeZone = 'UTC') {
    const left = zonedParts(from, timeZone);
    const right = zonedParts(to, timeZone);
    return Math.round((Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / 86_400_000);
}

function shiftPeriod(period, milliseconds) {
    return {
        from: new Date(new Date(period.from).getTime() + milliseconds),
        to: new Date(new Date(period.to).getTime() + milliseconds)
    };
}

function buildMarketingPeriods(now = new Date(), timeZone = 'UTC') {
    const currentTime = validDate(now);
    const currentParts = zonedParts(currentTime, timeZone);
    const todayStart = zonedStartOfDay(currentTime, timeZone);
    const tomorrow = addZonedDays(todayStart, 1, timeZone);
    const localDay = new Date(Date.UTC(currentParts.year, currentParts.month - 1, currentParts.day));
    const isoWeekday = localDay.getUTCDay() || 7;
    const today = { from: todayStart, to: tomorrow };
    const week = { from: addZonedDays(todayStart, 1 - isoWeekday, timeZone), to: tomorrow };
    const month = { from: zonedDateToUtc({ year: currentParts.year, month: currentParts.month, day: 1 }, timeZone), to: tomorrow };
    const quarter = { from: zonedDateToUtc({ year: currentParts.year, month: Math.floor((currentParts.month - 1) / 3) * 3 + 1, day: 1 }, timeZone), to: tomorrow };
    const year = { from: zonedDateToUtc({ year: currentParts.year, month: 1, day: 1 }, timeZone), to: tomorrow };
    const custom = { from: addZonedDays(tomorrow, -30, timeZone), to: tomorrow };
    const withComparisons = (period) => {
        const days = zonedDaySpan(period.from, period.to, timeZone);
        return {
            current: period,
            previous: { from: addZonedDays(period.from, -days, timeZone), to: addZonedDays(period.to, -days, timeZone) },
            yearAgo: { from: addZonedYears(period.from, -1, timeZone), to: addZonedYears(period.to, -1, timeZone) }
        };
    };
    return {
        today: withComparisons(today),
        week: withComparisons(week),
        month: withComparisons(month),
        quarter: withComparisons(quarter),
        year: withComparisons(year),
        rolling30Days: withComparisons(custom)
    };
}

function normalizeRequestedPeriod({ from, to, now = new Date(), defaultDays = 30, timeZone = 'UTC' } = {}) {
    const currentTime = validDate(now);
    const end = to ? requestedExclusiveEnd(to, timeZone) : addZonedDays(zonedStartOfDay(currentTime, timeZone), 1, timeZone);
    const start = from ? requestedInclusiveStart(from, timeZone) : addZonedDays(end, -defaultDays, timeZone);
    if (start >= end) {
        const error = new Error('The analytics start date must be earlier than the end date.');
        error.code = 'INVALID_ANALYTICS_PERIOD';
        error.statusCode = 400;
        error.publicMessage = 'Choose a valid analytics date range.';
        throw error;
    }
    const maxDuration = 3 * 365 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxDuration) {
        const error = new Error('The analytics date range cannot exceed three years.');
        error.code = 'ANALYTICS_PERIOD_TOO_LARGE';
        error.statusCode = 400;
        error.publicMessage = 'Choose an analytics range of three years or less.';
        throw error;
    }
    const duration = end.getTime() - start.getTime();
    const calendarDays = zonedDaySpan(start, end, timeZone);
    return {
        current: { from: start, to: end },
        previous: calendarDays > 0
            ? { from: addZonedDays(start, -calendarDays, timeZone), to: addZonedDays(end, -calendarDays, timeZone) }
            : shiftPeriod({ from: start, to: end }, -duration),
        yearAgo: { from: addZonedYears(start, -1, timeZone), to: addZonedYears(end, -1, timeZone) },
        days: Math.max(1, calendarDays || Math.ceil(duration / 86_400_000))
    };
}

function requestedInclusiveStart(value, timeZone) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [year, month, day] = text.split('-').map(Number);
        return zonedDateToUtc({ year, month, day }, timeZone);
    }
    return inclusiveStart(value);
}

function requestedExclusiveEnd(value, timeZone) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [year, month, day] = text.split('-').map(Number);
        return addZonedDays(zonedDateToUtc({ year, month, day }, timeZone), 1, timeZone);
    }
    return exclusiveEnd(value);
}

function linearForecast(points, horizonDays = 14) {
    const rows = (Array.isArray(points) ? points : [])
        .map((point, index) => ({
            x: index,
            y: Number(point?.value ?? point?.revenueMinor ?? 0),
            date: point?.date || point?.day || null
        }))
        .filter((point) => Number.isFinite(point.y) && point.y >= 0);
    if (rows.length < 3) {
        return { available: false, reason: 'At least three daily observations are required.', points: [], confidence: null };
    }
    const n = rows.length;
    const sumX = rows.reduce((sum, point) => sum + point.x, 0);
    const sumY = rows.reduce((sum, point) => sum + point.y, 0);
    const sumXY = rows.reduce((sum, point) => sum + point.x * point.y, 0);
    const sumXX = rows.reduce((sum, point) => sum + point.x * point.x, 0);
    const denominator = n * sumXX - sumX * sumX;
    const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    const mean = sumY / n;
    const totalVariance = rows.reduce((sum, point) => sum + ((point.y - mean) ** 2), 0);
    const residualVariance = rows.reduce((sum, point) => sum + ((point.y - (intercept + slope * point.x)) ** 2), 0);
    const rSquared = totalVariance === 0 ? 1 : Math.max(0, Math.min(1, 1 - residualVariance / totalVariance));
    const lastDate = rows.at(-1).date ? validDate(rows.at(-1).date) : utcStartOfDay(new Date());
    const forecastPoints = [];
    for (let index = 1; index <= Math.max(1, Math.min(90, Number(horizonDays) || 14)); index += 1) {
        forecastPoints.push({
            date: addUtcDays(lastDate, index).toISOString().slice(0, 10),
            value: Math.max(0, Math.round(intercept + slope * (n - 1 + index)))
        });
    }
    return {
        available: true,
        reason: null,
        points: forecastPoints,
        confidence: round(rSquared, 4),
        slope: round(slope, 4),
        total: forecastPoints.reduce((sum, point) => sum + point.value, 0)
    };
}

function inventoryRisk({ currentStock, unitsSold, periodDays, leadTimeDays, reorderBufferDays }) {
    const stock = nullableNumber(currentStock);
    const units = nullableNumber(unitsSold);
    if (stock === null) return { level: 'unknown', velocity: null, daysOfCover: null, reorderPoint: null };
    if (stock === 0) return { level: 'out-of-stock', velocity: 0, daysOfCover: 0, reorderPoint: nullableNumber(leadTimeDays) };
    if (units === null || units <= 0 || !periodDays) return { level: 'healthy', velocity: 0, daysOfCover: null, reorderPoint: null };
    const velocity = units / periodDays;
    const daysOfCover = stock / velocity;
    const lead = nullableNumber(leadTimeDays);
    const buffer = nullableNumber(reorderBufferDays) || 0;
    const reorderPoint = lead === null ? null : velocity * (lead + buffer);
    let level = 'healthy';
    if (daysOfCover <= 3) level = 'critical';
    else if (lead !== null && daysOfCover <= lead) level = 'low';
    else if (lead !== null && daysOfCover <= lead + buffer) level = 'watch';
    return {
        level,
        velocity: round(velocity, 4),
        daysOfCover: round(daysOfCover, 2),
        reorderPoint: reorderPoint === null ? null : round(reorderPoint, 2)
    };
}

function stableHash(value) {
    return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function compactJson(value, maxBytes = 256 * 1024) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized;
    const error = new Error('The verified marketing context is too large to process safely.');
    error.code = 'MARKETING_CONTEXT_TOO_LARGE';
    error.statusCode = 413;
    error.publicMessage = 'Reduce the selected date range or connected source count and try again.';
    throw error;
}

function sanitizePlainText(value, maximum = 10_000) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/\r\n?/g, '\n')
        .trim()
        .slice(0, maximum);
}

function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        const error = new TypeError('A valid date is required.');
        error.code = 'INVALID_DATE';
        throw error;
    }
    return date;
}

function inclusiveStart(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : validDate(value);
}

function exclusiveEnd(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? addUtcDays(new Date(`${text}T00:00:00.000Z`), 1) : validDate(value);
}

function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

module.exports = {
    addUtcDays,
    addUtcMonths,
    addUtcYears,
    addZonedDays,
    addZonedYears,
    buildMarketingPeriods,
    compactJson,
    growthPercentage,
    inventoryRisk,
    linearForecast,
    normalizeRequestedPeriod,
    nullableNumber,
    percentage,
    round,
    safeDivide,
    sanitizePlainText,
    stableHash,
    utcStartOfDay,
    utcStartOfIsoWeek,
    utcStartOfMonth,
    utcStartOfQuarter,
    utcStartOfYear,
    validDate,
    zonedDateToUtc,
    zonedParts,
    zonedStartOfDay
};
