'use strict';

const crypto = require('node:crypto');
const { addUtcDays, addUtcMonths, validDate } = require('./marketing-utils');

function createCompetitorIntelligenceService({ database } = {}) {
    if (!database) throw new TypeError('A database service is required.');
    return {
        async persistLiveFindings({ userId, businessId, liveData }) {
            const payload = liveData?.available?.competitors;
            const rows = Array.isArray(payload) ? payload : [];
            const normalized = rows.map((row) => ({
                ...row,
                textHash: row.text ? crypto.createHash('sha256').update(String(row.text)).digest('hex') : null
            }));
            return database.saveCompetitorLiveSnapshots({
                userId,
                businessId,
                snapshots: normalized,
                retrievedAt: liveData?.retrievedAt || new Date().toISOString()
            });
        },

        summarizeChanges({ currentSnapshots = [], historicalSnapshots = [] } = {}) {
            const previousByCompetitor = new Map(historicalSnapshots.map((row) => [Number(row.competitor_id), row]));
            return currentSnapshots.map((current) => {
                const previous = previousByCompetitor.get(Number(current.competitor_id));
                const currentProducts = normalizeProducts(current.products);
                const previousProducts = normalizeProducts(previous?.products);
                const currentOffers = normalizeOffers(current.offers);
                const previousOffers = normalizeOffers(previous?.offers);
                return {
                    competitorId: Number(current.competitor_id),
                    competitorName: current.name || null,
                    sourceUrl: current.source_url || null,
                    retrievedAt: current.retrieved_at,
                    productLaunches: currentProducts.filter((item) => !previousProducts.some((previousItem) => sameProduct(item, previousItem))),
                    removedProducts: previousProducts.filter((item) => !currentProducts.some((currentItem) => sameProduct(item, currentItem))),
                    pricingChanges: comparePrices(currentProducts, previousProducts),
                    promotionChanges: compareOffers(currentOffers, previousOffers),
                    positioningChanged: Boolean(previous && String(current.positioning || '') !== String(previous.positioning || ''))
                };
            });
        }
    };
}

function createMarketingScheduler({ database, workflowService, eventBroker, env = process.env } = {}) {
    if (!database || !workflowService) throw new TypeError('Database and workflow services are required.');
    const workerId = `${env.HOSTNAME || 'orexis'}:${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
    const pollMs = boundedInteger(env.MARKETING_SCHEDULER_POLL_MS, 60_000, 10_000, 15 * 60_000);
    const batchSize = boundedInteger(env.MARKETING_SCHEDULER_BATCH_SIZE, 5, 1, 25);
    let timer = null;
    let running = false;

    async function tick() {
        if (running) return;
        running = true;
        try {
            const schedules = await database.claimDueScheduledWorkflows({ workerId, limit: batchSize });
            for (const schedule of schedules) await executeSchedule(schedule);
        } catch (error) {
            console.error('Marketing scheduler tick failed:', error.message);
        } finally {
            running = false;
        }
    }

    async function executeSchedule(schedule) {
        let runId = null;
        let status = 'failed';
        let errorMessage = null;
        try {
            const result = await workflowService.execute({
                userId: Number(schedule.created_by_user_id),
                businessId: Number(schedule.business_id),
                slug: schedule.workflow_slug,
                input: { ...(schedule.input || {}), scheduled: true, scheduleId: Number(schedule.id), scheduleKind: schedule.schedule_kind },
                onEvent: (event) => {
                    if (event.run?.id) runId = Number(event.run.id);
                    eventBroker?.publishBusiness(Number(schedule.business_id), { ...event, scheduleId: Number(schedule.id) });
                }
            });
            runId = Number(result.run.id);
            status = 'completed';
        } catch (error) {
            errorMessage = error.publicMessage || error.message || 'Scheduled workflow failed.';
            eventBroker?.publishBusiness(Number(schedule.business_id), {
                type: 'scheduled-failed',
                scheduleId: Number(schedule.id),
                error: errorMessage,
                timestamp: new Date().toISOString()
            });
        }
        await database.completeScheduledWorkflow({
            scheduleId: Number(schedule.id),
            workerId,
            nextRunAt: computeNextRun(schedule, new Date()),
            runId,
            status,
            errorMessage
        });
    }

    return {
        workerId,
        start() {
            if (timer || env.MARKETING_SCHEDULER_ENABLED === 'false') return;
            timer = setInterval(tick, pollMs);
            timer.unref?.();
            void tick();
        },
        async stop() {
            if (timer) clearInterval(timer);
            timer = null;
            while (running) await new Promise((resolve) => setTimeout(resolve, 25));
        },
        tick,
        computeNextRun
    };
}

function computeNextRun(schedule, from = new Date()) {
    const now = validDate(from);
    const timezone = schedule.timezone || 'UTC';
    const parts = zonedParts(now, timezone);
    let candidate = zonedDateToUtc({
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: Number(schedule.run_hour ?? schedule.runHour ?? 8),
        minute: Number(schedule.run_minute ?? schedule.runMinute ?? 0)
    }, timezone);
    const cadence = schedule.cadence;
    if (cadence === 'weekly') {
        const target = Number(schedule.day_of_week ?? schedule.dayOfWeek ?? 1);
        const current = isoWeekday(candidate, timezone);
        candidate = addUtcDays(candidate, (target - current + 7) % 7);
        if (candidate <= now) candidate = addUtcDays(candidate, 7);
    } else if (cadence === 'monthly') {
        const day = Math.max(1, Math.min(28, Number(schedule.day_of_month ?? schedule.dayOfMonth ?? 1)));
        candidate = zonedDateToUtc({ year: parts.year, month: parts.month, day, hour: Number(schedule.run_hour ?? schedule.runHour ?? 8), minute: Number(schedule.run_minute ?? schedule.runMinute ?? 0) }, timezone);
        if (candidate <= now) {
            const nextMonth = addUtcMonths(new Date(Date.UTC(parts.year, parts.month - 1, 1)), 1);
            candidate = zonedDateToUtc({ year: nextMonth.getUTCFullYear(), month: nextMonth.getUTCMonth() + 1, day, hour: Number(schedule.run_hour ?? schedule.runHour ?? 8), minute: Number(schedule.run_minute ?? schedule.runMinute ?? 0) }, timezone);
        }
    } else if (candidate <= now) {
        candidate = addUtcDays(candidate, 1);
    }
    return candidate.toISOString();
}

function zonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function zonedDateToUtc(parts, timeZone) {
    let guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const rendered = zonedParts(guess, timeZone);
        const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
        const actual = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute);
        const difference = target - actual;
        if (difference === 0) break;
        guess = new Date(guess.getTime() + difference);
    }
    return guess;
}

function isoWeekday(date, timeZone) {
    const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
    return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[label] || 1;
}

function normalizeProducts(value) { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []; }
function normalizeOffers(value) { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []; }
function sameProduct(left, right) { return String(left.name || left.product || '').trim().toLowerCase() === String(right.name || right.product || '').trim().toLowerCase(); }
function comparePrices(current, previous) { return current.flatMap((item) => { const old = previous.find((candidate) => sameProduct(item, candidate)); const currentPrice = numericPrice(item); const previousPrice = numericPrice(old); return old && currentPrice !== null && previousPrice !== null && currentPrice !== previousPrice ? [{ productName: item.name || item.product, previousPrice, currentPrice, change: currentPrice - previousPrice }] : []; }); }
function compareOffers(current, previous) { const previousSet = new Set(previous.map((item) => JSON.stringify(item))); const currentSet = new Set(current.map((item) => JSON.stringify(item))); return { added: current.filter((item) => !previousSet.has(JSON.stringify(item))), removed: previous.filter((item) => !currentSet.has(JSON.stringify(item))) }; }
function numericPrice(value) { const number = Number(value?.priceMinor ?? value?.price_minor ?? value?.price); return Number.isFinite(number) ? number : null; }
function boundedInteger(value, fallback, minimum, maximum) { const parsed = Number.parseInt(value, 10); return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback; }

module.exports = {
    computeNextRun,
    createCompetitorIntelligenceService,
    createMarketingScheduler
};
