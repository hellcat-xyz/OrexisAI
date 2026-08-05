'use strict';

const PLANS = Object.freeze([
    Object.freeze({
        id: 'free',
        name: 'Free',
        tagline: 'Explore OrexisAI at your own pace.',
        usdCents: 0,
        inrPaise: 0,
        aiAgentPromptLimit: 5,
        featured: false,
        features: Object.freeze([
            '5 workflow runs each month',
            'Core workflow templates',
            'Community support'
        ])
    }),
    Object.freeze({
        id: 'starter',
        name: 'Starter',
        tagline: 'For individuals automating regular work.',
        usdCents: 900,
        inrPaise: 74900,
        aiAgentPromptLimit: 100,
        featured: false,
        features: Object.freeze([
            '100 workflow runs for 30 days',
            'All core workflow templates',
            'Email support'
        ])
    }),
    Object.freeze({
        id: 'pro',
        name: 'Pro',
        tagline: 'For professionals running AI every day.',
        usdCents: 2900,
        inrPaise: 249900,
        aiAgentPromptLimit: 500,
        featured: true,
        features: Object.freeze([
            '500 workflow runs for 30 days',
            'Premium workflows and analytics',
            'Priority support'
        ])
    }),
    Object.freeze({
        id: 'business',
        name: 'Business',
        tagline: 'For teams that need scale and control.',
        usdCents: 7900,
        inrPaise: 679900,
        aiAgentPromptLimit: 2000,
        featured: false,
        features: Object.freeze([
            '2,000 workflow runs for 30 days',
            'Team access and custom workflows',
            'Priority onboarding'
        ])
    })
]);

const planMap = new Map(PLANS.map((plan) => [plan.id, plan]));
const planAliases = new Map([
    ['free', 'free'],
    ['freeplan', 'free'],
    ['starter', 'starter'],
    ['starterplan', 'starter'],
    ['startermonthly', 'starter'],
    ['starter30day', 'starter'],
    ['pro', 'pro'],
    ['proplan', 'pro'],
    ['promonthly', 'pro'],
    ['pro30day', 'pro'],
    ['business', 'business'],
    ['businessplan', 'business'],
    ['businessmonthly', 'business'],
    ['business30day', 'business']
]);

function normalizePlanId(planId) {
    const value = String(planId || '').trim().toLowerCase();
    if (!value) return '';
    if (planMap.has(value)) return value;
    const compact = value.replace(/[^a-z0-9]+/g, '');
    return planAliases.get(compact) || '';
}

function getPlanById(planId) {
    const normalized = normalizePlanId(planId);
    return normalized ? planMap.get(normalized) || null : null;
}

function getPaidPlanById(planId) {
    const plan = getPlanById(planId);
    return plan && plan.usdCents > 0 && plan.inrPaise > 0 ? plan : null;
}

module.exports = { PLANS, getPlanById, getPaidPlanById, normalizePlanId };
