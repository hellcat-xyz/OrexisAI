'use strict';

const WORKFLOWS = Object.freeze({
    'weekly-marketing': Object.freeze({
        slug: 'weekly-marketing',
        aliases: Object.freeze(['marketing', 'daily-summary', 'monthly-report', 'trend-detection', 'campaign-optimizer']),
        name: 'Weekly Marketing',
        description: 'Runs a verified business-data marketing operating system, generates grounded campaigns, and stores the complete execution history.',
        resultView: 'marketing',
        steps: Object.freeze([
            Object.freeze({ key: 'collect-database-data', title: 'Collecting current business data' }),
            Object.freeze({ key: 'validate-records', title: 'Validating source records' }),
            Object.freeze({ key: 'calculate-kpis', title: 'Calculating business KPIs' }),
            Object.freeze({ key: 'compare-periods', title: 'Comparing previous periods' }),
            Object.freeze({ key: 'identify-declining-products', title: 'Identifying declining products' }),
            Object.freeze({ key: 'identify-best-sellers', title: 'Identifying best sellers' }),
            Object.freeze({ key: 'segment-customers', title: 'Segmenting customers' }),
            Object.freeze({ key: 'calculate-opportunities', title: 'Calculating growth opportunities' }),
            Object.freeze({ key: 'detect-stock-risks', title: 'Detecting inventory risk' }),
            Object.freeze({ key: 'load-marketing-context', title: 'Loading marketing context' }),
            Object.freeze({ key: 'collect-competitor-data', title: 'Collecting competitor intelligence' }),
            Object.freeze({ key: 'collect-market-trends', title: 'Collecting current market trends' }),
            Object.freeze({ key: 'generate-ai-reasoning', title: 'Generating grounded AI reasoning' }),
            Object.freeze({ key: 'save-ai-audit', title: 'Saving grounded AI audit' }),
            Object.freeze({ key: 'generate-campaign-ideas', title: 'Generating campaign ideas' }),
            Object.freeze({ key: 'generate-social-posts', title: 'Generating social media posts' }),
            Object.freeze({ key: 'generate-email-campaign', title: 'Generating email campaign' }),
            Object.freeze({ key: 'generate-whatsapp-campaign', title: 'Generating WhatsApp campaign' }),
            Object.freeze({ key: 'generate-instagram-captions', title: 'Generating Instagram captions' }),
            Object.freeze({ key: 'generate-facebook-ads', title: 'Generating Facebook ads' }),
            Object.freeze({ key: 'generate-google-ads', title: 'Generating Google Ads copy' }),
            Object.freeze({ key: 'generate-seo-plan', title: 'Generating SEO content plan' }),
            Object.freeze({ key: 'improve-landing-page', title: 'Generating landing page improvements' }),
            Object.freeze({ key: 'recommend-discounts', title: 'Generating discount recommendations' }),
            Object.freeze({ key: 'recommend-pricing', title: 'Generating pricing recommendations' }),
            Object.freeze({ key: 'generate-creative-images', title: 'Generating campaign creatives' }),
            Object.freeze({ key: 'assemble-growth-plan', title: 'Assembling growth plan and reports' }),
            Object.freeze({ key: 'load-artifacts', title: 'Loading saved workflow artifacts' }),
            Object.freeze({ key: 'save-result', title: 'Saving workflow history' })
        ])
    }),
    'competitor-audit': Object.freeze({
        slug: 'competitor-audit',
        aliases: Object.freeze(['audit', 'competitor-watch']),
        name: 'Competitor Audit',
        description: 'Analyzes the newest competitor snapshots retrieved from configured legitimate sources.',
        resultView: 'marketing',
        steps: Object.freeze([
            Object.freeze({ key: 'resolve-business', title: 'Preparing workflow' }),
            Object.freeze({ key: 'load-competitors', title: 'Loading configured competitors' }),
            Object.freeze({ key: 'refresh-sources', title: 'Refreshing competitor websites' }),
            Object.freeze({ key: 'recover-blocked-sources', title: 'Recovering blocked public sources' }),
            Object.freeze({ key: 'persist-snapshots', title: 'Saving verified snapshots' }),
            Object.freeze({ key: 'validate-data', title: 'Validating current source data' }),
            Object.freeze({ key: 'compare-competitors', title: 'Calculating pricing and change comparisons' }),
            Object.freeze({ key: 'generate-insights', title: 'Generating grounded recommendations' }),
            Object.freeze({ key: 'save-result', title: 'Saving result' })
        ])
    }),
    'review-responder': Object.freeze({
        slug: 'review-responder',
        aliases: Object.freeze(['reviews']),
        name: 'Review Responder',
        description: 'Analyzes real unanswered reviews and prepares editable, provider-safe response drafts.',
        resultView: 'crm',
        steps: Object.freeze([
            Object.freeze({ key: 'resolve-business', title: 'Preparing workflow' }),
            Object.freeze({ key: 'fetch-reviews', title: 'Fetching customer reviews' }),
            Object.freeze({ key: 'validate-data', title: 'Validating review data' }),
            Object.freeze({ key: 'analyze-reviews', title: 'Analyzing sentiment and concerns' }),
            Object.freeze({ key: 'generate-responses', title: 'Generating response drafts' }),
            Object.freeze({ key: 'save-result', title: 'Saving result' })
        ])
    }),
    'inventory-predictor': Object.freeze({
        slug: 'inventory-predictor',
        aliases: Object.freeze(['inventory', 'demand-forecast']),
        name: 'Inventory Predictor',
        description: 'Forecasts stock depletion from current inventory and verified historical unit sales.',
        resultView: 'analytics',
        steps: Object.freeze([
            Object.freeze({ key: 'resolve-business', title: 'Preparing workflow' }),
            Object.freeze({ key: 'fetch-inventory-data', title: 'Fetching inventory and sales data' }),
            Object.freeze({ key: 'validate-data', title: 'Validating inventory data' }),
            Object.freeze({ key: 'calculate-forecast', title: 'Calculating demand forecast' }),
            Object.freeze({ key: 'generate-insights', title: 'Running AI analysis' }),
            Object.freeze({ key: 'save-result', title: 'Saving result' })
        ])
    })
});

const WORKFLOW_ALIASES = Object.freeze(Object.fromEntries(
    Object.values(WORKFLOWS).flatMap((workflow) => [
        [workflow.slug, workflow.slug],
        ...workflow.aliases.map((alias) => [alias, workflow.slug])
    ])
));

function getWorkflow(slug) {
    if (typeof slug !== 'string') return null;
    const normalized = slug.trim().toLowerCase();
    const canonicalSlug = WORKFLOW_ALIASES[normalized];
    return canonicalSlug ? WORKFLOWS[canonicalSlug] : null;
}

function listWorkflows() {
    return Object.values(WORKFLOWS);
}

module.exports = {
    getWorkflow,
    listWorkflows
};
