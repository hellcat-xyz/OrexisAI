'use strict';

const WORKFLOWS = Object.freeze({
    'weekly-marketing': Object.freeze({
        slug: 'weekly-marketing',
        aliases: Object.freeze(['marketing']),
        name: 'Weekly Marketing',
        description: 'Calculates the current weekly business performance and creates a fact-grounded marketing plan.',
        resultView: 'marketing',
        steps: Object.freeze([
            Object.freeze({ key: 'resolve-business', title: 'Preparing workflow' }),
            Object.freeze({ key: 'fetch-business-data', title: 'Fetching live business data' }),
            Object.freeze({ key: 'validate-data', title: 'Validating data' }),
            Object.freeze({ key: 'calculate-metrics', title: 'Calculating metrics' }),
            Object.freeze({ key: 'generate-insights', title: 'Running AI analysis' }),
            Object.freeze({ key: 'save-result', title: 'Saving result' })
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
            Object.freeze({ key: 'fetch-competitor-data', title: 'Fetching live competitor data' }),
            Object.freeze({ key: 'validate-data', title: 'Validating source data' }),
            Object.freeze({ key: 'compare-competitors', title: 'Calculating comparisons' }),
            Object.freeze({ key: 'generate-insights', title: 'Running AI analysis' }),
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
