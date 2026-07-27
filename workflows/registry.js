'use strict';

const WORKFLOWS = Object.freeze({
    'social-pack': Object.freeze({
        slug: 'social-pack',
        name: 'Social Content Pack',
        description: 'Creates one week of social media content for the business.',
        resultView: 'marketing',
        steps: Object.freeze([
            Object.freeze({ key: 'load-business-context', title: 'Load business information' }),
            Object.freeze({ key: 'create-content-plan', title: 'Create weekly content plan' }),
            Object.freeze({ key: 'write-social-posts', title: 'Write social media posts' }),
            Object.freeze({ key: 'create-image-briefs', title: 'Create image ideas' })
        ])
    }),
    'competitor-watch': Object.freeze({
        slug: 'competitor-watch',
        name: 'Competitor Watch',
        description: 'Checks competitor changes and prepares a response plan.',
        resultView: 'marketing',
        steps: Object.freeze([
            Object.freeze({ key: 'load-competitors', title: 'Load saved competitors' }),
            Object.freeze({ key: 'collect-competitor-data', title: 'Collect competitor information' }),
            Object.freeze({ key: 'compare-offers', title: 'Compare important changes' }),
            Object.freeze({ key: 'create-response-plan', title: 'Create response plan' })
        ])
    }),
    'win-back': Object.freeze({
        slug: 'win-back',
        name: 'Customer Win-Back',
        description: 'Finds inactive customers and prepares a win-back campaign.',
        resultView: 'crm',
        steps: Object.freeze([
            Object.freeze({ key: 'load-customers', title: 'Load inactive customers' }),
            Object.freeze({ key: 'rank-opportunities', title: 'Rank win-back opportunities' }),
            Object.freeze({ key: 'draft-messages', title: 'Draft personalized messages' }),
            Object.freeze({ key: 'wait-for-approval', title: 'Wait for approval' })
        ])
    })
});

function getWorkflow(slug) {
    if (typeof slug !== 'string') {
        return null;
    }

    return WORKFLOWS[slug.trim().toLowerCase()] || null;
}

function listWorkflows() {
    return Object.values(WORKFLOWS);
}

module.exports = {
    getWorkflow,
    listWorkflows
};
