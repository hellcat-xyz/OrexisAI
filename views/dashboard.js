'use strict';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderDashboardPage({ user, plans, billing, paymentConfiguration, cspNonce = '' }) {
    const currentPlan = plans.find((plan) => plan.id === billing.currentPlanId) || plans[0];
    const expiryText = billing.planExpiresAt
        ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(billing.planExpiresAt))
        : '';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OutcomeAI - Workflow as a Service</title>
    <link rel="stylesheet" href="/style.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body
    data-user-email="${escapeHtml(user.email)}"
    data-razorpay-key-id="${escapeHtml(paymentConfiguration.razorpay.keyId)}"
    data-razorpay-configured="${paymentConfiguration.razorpay.isConfigured ? 'true' : 'false'}"
    data-paypal-client-id="${escapeHtml(paymentConfiguration.paypal.clientId)}"
    data-paypal-configured="${paymentConfiguration.paypal.isConfigured ? 'true' : 'false'}"
    data-paypal-mode="${escapeHtml(paymentConfiguration.paypal.mode)}"
    data-csp-nonce="${escapeHtml(cspNonce)}"
>
    <div class="app-container">
        <aside class="sidebar">
            <div class="logo">
                <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                <span>OutcomeAI</span>
            </div>
            <nav class="nav-menu" aria-label="Main navigation">
                <a href="#" class="nav-item active"><i class="fa-solid fa-border-all" aria-hidden="true"></i> Hub</a>
                <a href="#" class="nav-item"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i> Marketing</a>
                <a href="#" class="nav-item"><i class="fa-solid fa-chart-line" aria-hidden="true"></i> Analytics</a>
                <a href="#" class="nav-item"><i class="fa-solid fa-users" aria-hidden="true"></i> CRM</a>
                <a href="#" class="nav-item"><i class="fa-solid fa-gear" aria-hidden="true"></i> Settings</a>
                <button type="button" class="nav-item upgrade-nav-item" id="upgradeButton">
                    <i class="fa-solid fa-crown" aria-hidden="true"></i>
                    <span>Upgrade</span>
                    <span class="upgrade-pill">${escapeHtml(currentPlan.name)}</span>
                </button>
            </nav>
            <div class="user-profile">
                <div class="avatar">${escapeHtml(user.initials)}</div>
                <div class="user-info">
                    <span class="name">${escapeHtml(user.displayName)}</span>
                    <span class="plan" id="currentPlanName">${escapeHtml(currentPlan.name)} plan</span>
                </div>
                <form class="logout-form" method="post" action="/logout">
                    <button class="logout-btn" type="submit" title="Sign out" aria-label="Sign out">
                        <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
                    </button>
                </form>
            </div>
        </aside>

        <main class="main-content">
            <header class="top-bar">
                <h1>Ready-to-Run Outcomes</h1>
                <div class="search-bar">
                    <i class="fa-solid fa-search" aria-hidden="true"></i>
                    <input type="search" placeholder="Search workflows... (e.g., 'Weekly Marketing')" aria-label="Search workflows">
                </div>
            </header>

            <section class="workflows-grid" aria-label="Available workflows">
                <article class="workflow-card">
                    <div class="card-icon gradient-1"><i class="fa-solid fa-rocket" aria-hidden="true"></i></div>
                    <h3>Weekly Marketing</h3>
                    <p>Analyzes sales, generates copy, creates flyers, and checks competitor prices.</p>
                    <div class="card-footer">
                        <span class="time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ~2 mins</span>
                        <button class="run-btn" data-workflow="marketing">Run Now <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </div>
                </article>

                <article class="workflow-card">
                    <div class="card-icon gradient-2"><i class="fa-solid fa-magnifying-glass-dollar" aria-hidden="true"></i></div>
                    <h3>Competitor Audit</h3>
                    <p>Scrapes local competitors, compares pricing, and suggests price adjustments.</p>
                    <div class="card-footer">
                        <span class="time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ~1.5 mins</span>
                        <button class="run-btn" data-workflow="audit">Run Now <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </div>
                </article>

                <article class="workflow-card">
                    <div class="card-icon gradient-3"><i class="fa-solid fa-star-half-stroke" aria-hidden="true"></i></div>
                    <h3>Review Responder</h3>
                    <p>Reads new customer reviews across platforms and drafts personalized replies.</p>
                    <div class="card-footer">
                        <span class="time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ~30 secs</span>
                        <button class="run-btn" data-workflow="reviews">Run Now <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </div>
                </article>

                <article class="workflow-card">
                    <div class="card-icon gradient-4"><i class="fa-solid fa-box-open" aria-hidden="true"></i></div>
                    <h3>Inventory Predictor</h3>
                    <p>Forecasts next week's inventory needs based on weather, holidays, and past sales.</p>
                    <div class="card-footer">
                        <span class="time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ~1 min</span>
                        <button class="run-btn" data-workflow="inventory">Run Now <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </div>
                </article>
            </section>
        </main>
    </div>

    <div class="modal-overlay" id="executionModal" aria-hidden="true">
        <div class="modal-content glass-panel" role="dialog" aria-modal="true" aria-labelledby="workflowTitle">
            <button class="close-modal" id="closeModal" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            <div class="modal-header">
                <div class="running-indicator"><div class="spinner"></div></div>
                <h2 id="workflowTitle">Running Weekly Marketing...</h2>
            </div>
            <div class="execution-steps" id="executionSteps"></div>
            <div class="execution-result hidden" id="executionResult">
                <div class="success-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></div>
                <h3>Outcome Achieved!</h3>
                <p>Your workflow completed successfully and results are ready.</p>
                <button class="view-result-btn" id="closeResultBtn">View Results</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay upgrade-modal" id="upgradeModal" aria-hidden="true">
        <div class="upgrade-modal-content" role="dialog" aria-modal="true" aria-labelledby="upgradeTitle">
            <button class="close-modal" id="closeUpgradeModal" aria-label="Close upgrade plans">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <div class="upgrade-heading">
                <div>
                    <span class="eyebrow"><i class="fa-solid fa-sparkles" aria-hidden="true"></i> Upgrade OutcomeAI</span>
                    <h2 id="upgradeTitle">Choose the plan that fits your workload</h2>
                    <p>Secure one-time checkout for 30 days of access. No automatic renewal is created.</p>
                </div>
                <div class="current-plan-summary">
                    <span>Current plan</span>
                    <strong>${escapeHtml(currentPlan.name)}</strong>
                    ${expiryText ? `<small>Active until ${escapeHtml(expiryText)}</small>` : '<small>No expiry</small>'}
                </div>
            </div>

            <div class="payment-message" id="paymentMessage" role="status" aria-live="polite"></div>
            <div class="plans-grid">
                ${plans.map((plan) => renderPlanCard(plan, currentPlan.id, paymentConfiguration)).join('')}
            </div>
            <p class="payment-disclaimer">
                Razorpay charges the INR amount shown. PayPal charges the USD amount shown. Your plan activates only after server-side payment confirmation.
            </p>
        </div>
    </div>

    <script src="/app.js" nonce="${escapeHtml(cspNonce)}" defer></script>
</body>
</html>`;
}

function renderPlanCard(plan, currentPlanId, paymentConfiguration) {
    const isCurrent = plan.id === currentPlanId;
    const isFree = plan.usdCents === 0;
    const usd = `$${(plan.usdCents / 100).toFixed(0)}`;
    const inr = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(plan.inrPaise / 100);

    return `<article class="plan-card${plan.featured ? ' featured' : ''}${isCurrent ? ' current' : ''}" data-plan-card="${escapeHtml(plan.id)}">
        ${plan.featured ? '<span class="popular-badge">Most popular</span>' : ''}
        <div class="plan-card-head">
            <div>
                <h3>${escapeHtml(plan.name)}</h3>
                <p>${escapeHtml(plan.tagline)}</p>
            </div>
            ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
        </div>
        <div class="plan-price">
            <strong>${isFree ? '$0' : usd}</strong>
            <span>${isFree ? 'forever' : 'for 30 days'}</span>
        </div>
        ${isFree ? '' : `<div class="razorpay-price">${escapeHtml(inr)} with Razorpay</div>`}
        <ul class="plan-features">
            ${plan.features.map((feature) => `<li><i class="fa-solid fa-check" aria-hidden="true"></i>${escapeHtml(feature)}</li>`).join('')}
        </ul>
        <div class="payment-actions">
            ${isFree
        ? `<button class="plan-disabled-btn" type="button" disabled>${isCurrent ? 'Your current plan' : 'Included by default'}</button>`
        : `<button class="razorpay-pay-btn" type="button" data-plan-id="${escapeHtml(plan.id)}"${paymentConfiguration.razorpay.isConfigured ? '' : ' disabled'}>
                    <i class="fa-solid fa-credit-card" aria-hidden="true"></i>
                    ${paymentConfiguration.razorpay.isConfigured ? 'Pay with Razorpay' : 'Razorpay not configured'}
                </button>
                <div class="paypal-button-slot" data-plan-id="${escapeHtml(plan.id)}">
                    ${paymentConfiguration.paypal.isConfigured ? '<span class="paypal-loading">Loading PayPal…</span>' : '<button class="plan-disabled-btn" type="button" disabled>PayPal not configured</button>'}
                </div>`}
        </div>
    </article>`;
}

module.exports = { escapeHtml, renderDashboardPage, renderPlanCard };
