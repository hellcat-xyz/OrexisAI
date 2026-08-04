'use strict';

/**
 * @typedef {'daily-summary'|'weekly-marketing'|'monthly-report'|'trend-detection'|'competitor-scan'|'inventory-scan'|'campaign-optimizer'|'forecast-generator'} MarketingScheduleKind
 * @typedef {'email'|'whatsapp'|'instagram'|'facebook'|'google-ads'|'seo'|'landing-page'|'pricing'|'growth'} MarketingChannel
 * @typedef {'available'|'unavailable'|'partial'} DataAvailabilityState
 * @typedef {'queued'|'running'|'completed'|'failed'|'cancelled'} WorkflowRunStatus
 * @typedef {{from:string|Date,to:string|Date}} DatePeriod
 * @typedef {{current:DatePeriod,previous:DatePeriod,yearAgo:DatePeriod,days:number}} ComparablePeriods
 * @typedef {{value:number|null, previousValue:number|null, changePercentage:number|null, available:boolean, reason:string|null}} ComparableMetric
 * @typedef {{key:string,label:string,value:number|null,unit:string,availability:DataAvailabilityState,reason:string|null,sourceRecords:number}} MarketingMetric
 * @typedef {{date:string,revenueMinor:number,orders:number,customers:number,units:number,profitMinor:number|null}} DailyPerformancePoint
 * @typedef {{productId:number,productName:string,sku:string|null,category:string|null,revenueMinor:number,profitMinor:number|null,unitsSold:number,orderCount:number,currentStock:number|null,inventoryVelocity:number|null,daysOfCover:number|null,stockRisk:string}} ProductPerformance
 * @typedef {{campaignName:string,sourceName:string|null,spendMinor:number,attributedRevenueMinor:number,impressions:number,clicks:number,visitors:number,leads:number,conversions:number,roas:number|null,ctrPercentage:number|null,conversionRatePercentage:number|null,cacMinor:number|null}} CampaignPerformance
 * @typedef {{segment:string,customers:number,revenueMinor:number,averageLifetimeValueMinor:number|null,sharePercentage:number|null}} CustomerSegment
 * @typedef {{sourceType:string,provider:string,status:string,sourceUrl:string|null,retrievedAt:string,errorMessage:string|null,payload:unknown}} VerifiedSourceSnapshot
 * @typedef {{channel:MarketingChannel,title:string,content:unknown,rationale:string,verifiedFacts:string[],status:'draft'}} GeneratedCampaign
 * @typedef {{key:string,title:string,status:string,startedAt:string|null,completedAt:string|null,error:string|null}} WorkflowTimelineStep
 * @typedef {{id:number,workflowSlug:string,workflowName:string,status:WorkflowRunStatus,progressPercentage:number,currentStep:string|null,createdAt:string,startedAt:string|null,completedAt:string|null,durationMs:number|null,error:string|null}} WorkflowHistoryEntry
 */

const SCHEDULE_KINDS = Object.freeze([
    'daily-summary',
    'weekly-marketing',
    'monthly-report',
    'trend-detection',
    'competitor-scan',
    'inventory-scan',
    'campaign-optimizer',
    'forecast-generator'
]);

const MARKETING_CHANNELS = Object.freeze([
    'email',
    'whatsapp',
    'instagram',
    'facebook',
    'google-ads',
    'seo',
    'landing-page',
    'pricing',
    'growth'
]);

const WORKFLOW_RUN_STATUSES = Object.freeze([
    'queued', 'running', 'completed', 'failed', 'cancelled'
]);

const STOCK_RISK_LEVELS = Object.freeze(['unknown', 'healthy', 'watch', 'low', 'critical', 'out-of-stock']);

function isScheduleKind(value) {
    return SCHEDULE_KINDS.includes(String(value || '').trim().toLowerCase());
}

function isMarketingChannel(value) {
    return MARKETING_CHANNELS.includes(String(value || '').trim().toLowerCase());
}

function isWorkflowRunStatus(value) {
    return WORKFLOW_RUN_STATUSES.includes(String(value || '').trim().toLowerCase());
}

function assertPlainObject(value, label = 'value') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        const error = new TypeError(`${label} must be an object.`);
        error.code = 'INVALID_OBJECT';
        throw error;
    }
    return value;
}

function nullableFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value, fallback = 0) {
    const number = nullableFiniteNumber(value);
    return number !== null && number >= 0 ? number : fallback;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number.parseInt(value, 10);
    return Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : fallback;
}

module.exports = {
    MARKETING_CHANNELS,
    SCHEDULE_KINDS,
    STOCK_RISK_LEVELS,
    WORKFLOW_RUN_STATUSES,
    assertPlainObject,
    isMarketingChannel,
    isScheduleKind,
    isWorkflowRunStatus,
    nonNegativeNumber,
    nullableFiniteNumber,
    positiveInteger
};
