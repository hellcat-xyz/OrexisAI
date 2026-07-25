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
    <div class="app-container" id="appContainer">
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-brand-row">
                <div class="logo" aria-label="OutcomeAI">
                    <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                    <span class="logo-text">OutcomeAI</span>
                </div>
                <button type="button" class="sidebar-toggle" id="sidebarToggle" aria-label="Collapse sidebar" aria-expanded="true">
                    <i class="fa-solid fa-angles-left" aria-hidden="true"></i>
                </button>
            </div>

            <nav class="nav-menu" aria-label="Main navigation">
                <button type="button" class="nav-item active" data-view-target="hub" aria-label="Hub">
                    <i class="fa-solid fa-border-all" aria-hidden="true"></i>
                    <span class="nav-label">Hub</span>
                </button>
                <button type="button" class="nav-item" data-view-target="marketing" aria-label="Marketing">
                    <i class="fa-solid fa-bullhorn" aria-hidden="true"></i>
                    <span class="nav-label">Marketing</span>
                </button>
                <button type="button" class="nav-item" data-view-target="analytics" aria-label="Analytics">
                    <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
                    <span class="nav-label">Analytics</span>
                </button>
                <button type="button" class="nav-item" data-view-target="crm" aria-label="CRM">
                    <i class="fa-solid fa-users" aria-hidden="true"></i>
                    <span class="nav-label">CRM</span>
                </button>
                <button type="button" class="nav-item upgrade-nav-item" id="upgradeButton" aria-label="Upgrade plan">
                    <i class="fa-solid fa-crown" aria-hidden="true"></i>
                    <span class="nav-label">Upgrade</span>
                    <span class="upgrade-pill">${escapeHtml(currentPlan.name)}</span>
                </button>
            </nav>

            <div class="sidebar-footer">
                <div class="profile-menu" id="profileMenu" role="menu" aria-hidden="true">
                    <div class="profile-menu-heading">
                        <strong>${escapeHtml(user.displayName)}</strong>
                        <span>${escapeHtml(user.email)}</span>
                    </div>
                    <button type="button" class="profile-menu-item" data-view-target="settings" role="menuitem">
                        <i class="fa-solid fa-gear" aria-hidden="true"></i>
                        <span>Account settings</span>
                    </button>
                    <button type="button" class="profile-menu-item" id="profileUpgradeButton" role="menuitem">
                        <i class="fa-solid fa-crown" aria-hidden="true"></i>
                        <span>Plans and billing</span>
                    </button>
                    <form method="post" action="/logout">
                        <button class="profile-menu-item danger" type="submit" role="menuitem">
                            <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
                            <span>Sign out</span>
                        </button>
                    </form>
                </div>

                <button type="button" class="user-profile" id="profileButton" aria-haspopup="menu" aria-expanded="false" aria-controls="profileMenu">
                    <span class="avatar">${escapeHtml(user.initials)}</span>
                    <span class="user-info">
                        <span class="name">${escapeHtml(user.displayName)}</span>
                        <span class="plan" id="currentPlanName">${escapeHtml(currentPlan.name)} plan</span>
                    </span>
                    <i class="fa-solid fa-chevron-up profile-chevron" aria-hidden="true"></i>
                </button>
            </div>
        </aside>

        <main class="main-content">
            <header class="top-bar">
                <div class="page-heading">
                    <span class="page-kicker" id="pageKicker">Outcome workspace</span>
                    <h1 id="pageTitle">Ready-to-Run Outcomes</h1>
                    <p id="pageSubtitle">Choose a business result. OutcomeAI handles the models, tools, and routing behind it.</p>
                </div>
                <div class="topbar-actions">
                    <div class="search-bar">
                        <i class="fa-solid fa-search" aria-hidden="true"></i>
                        <input id="workspaceSearch" type="search" placeholder="Search outcomes..." aria-label="Search current workspace">
                        <button type="button" class="search-clear" id="clearSearchButton" aria-label="Clear search" hidden>
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </header>

            <div class="search-empty-state" id="searchEmptyState" hidden>
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <strong>No matching items</strong>
                <span>Try a broader search in this workspace.</span>
            </div>

            <section class="dashboard-view active" data-view="hub" aria-label="Outcome Hub">
                <div class="outcome-hero searchable-item" data-search-text="workflow as a service outcomes automation business hub">
                    <div class="outcome-hero-copy">
                        <span class="eyebrow"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Workflow-as-a-Service</span>
                        <h2>AI is hidden. The finished work is what you buy.</h2>
                        <p>Run pre-built, multi-step business workflows without choosing models or stitching tools together. OutcomeAI routes each step to the best available system and returns a usable result.</p>
                        <div class="hero-actions">
                            <button class="primary-action run-btn" type="button" data-workflow="marketing">
                                Run weekly marketing <i class="fa-solid fa-play" aria-hidden="true"></i>
                            </button>
                            <button class="secondary-action" type="button" data-view-target="analytics">
                                View business pulse <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    <div class="outcome-route" aria-label="Example workflow routing">
                        <div class="route-node source"><i class="fa-solid fa-store" aria-hidden="true"></i><span>Your business data</span></div>
                        <div class="route-line"></div>
                        <div class="route-stack">
                            <div class="route-node"><i class="fa-solid fa-chart-simple" aria-hidden="true"></i><span>Analyze sales</span></div>
                            <div class="route-node"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i><span>Create campaign</span></div>
                            <div class="route-node"><i class="fa-solid fa-image" aria-hidden="true"></i><span>Generate assets</span></div>
                        </div>
                        <div class="route-line"></div>
                        <div class="route-node result"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Finished outcome</span></div>
                    </div>
                </div>

                <div class="pulse-grid" aria-label="Workspace summary">
                    <article class="pulse-card searchable-item" data-search-text="active workflows automation">
                        <span>Active workflows</span>
                        <strong>4</strong>
                        <small><i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i> 2 ready to run</small>
                    </article>
                    <article class="pulse-card searchable-item" data-search-text="hours saved productivity">
                        <span>Estimated time saved</span>
                        <strong>11.4h</strong>
                        <small>This week</small>
                    </article>
                    <article class="pulse-card searchable-item" data-search-text="outcomes completed success">
                        <span>Outcomes completed</span>
                        <strong>18</strong>
                        <small>94% completed without edits</small>
                    </article>
                </div>

                <div class="section-heading">
                    <div>
                        <span class="section-label">Outcome library</span>
                        <h2>One click, complete work</h2>
                    </div>
                </div>
                <div class="workflows-grid" aria-label="Available workflows">
                    ${renderWorkflowCard({ icon: 'fa-rocket', gradient: 'gradient-1', title: 'Weekly Marketing', description: 'Analyzes sales, generates copy, creates flyers, and checks competitor prices.', time: '~2 mins', workflow: 'marketing', search: 'weekly marketing campaign sales flyer competitor' })}
                    ${renderWorkflowCard({ icon: 'fa-magnifying-glass-dollar', gradient: 'gradient-2', title: 'Competitor Audit', description: 'Scrapes local competitors, compares pricing, and suggests price adjustments.', time: '~1.5 mins', workflow: 'audit', search: 'competitor audit pricing market research' })}
                    ${renderWorkflowCard({ icon: 'fa-star-half-stroke', gradient: 'gradient-3', title: 'Review Responder', description: 'Reads new customer reviews across platforms and drafts personalized replies.', time: '~30 secs', workflow: 'reviews', search: 'review responder customer reputation replies' })}
                    ${renderWorkflowCard({ icon: 'fa-box-open', gradient: 'gradient-4', title: 'Inventory Predictor', description: 'Forecasts next week\'s inventory needs based on weather, holidays, and past sales.', time: '~1 min', workflow: 'inventory', search: 'inventory forecast demand weather sales' })}
                </div>
            </section>

            <section class="dashboard-view" data-view="marketing" aria-label="Marketing workspace" hidden>
                <div class="workspace-grid marketing-layout">
                    <article class="command-card searchable-item" data-search-text="weekly marketing campaign complete outcome">
                        <div class="command-card-icon marketing"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i></div>
                        <span class="section-label">Recommended outcome</span>
                        <h2>Run this week’s marketing</h2>
                        <p>OutcomeAI reviews recent sales, finds the strongest offer, generates platform-ready copy and visuals, then prepares a publishing checklist.</p>
                        <ul class="deliverable-list">
                            <li><i class="fa-solid fa-check" aria-hidden="true"></i> 3 social posts</li>
                            <li><i class="fa-solid fa-check" aria-hidden="true"></i> 1 promotional flyer</li>
                            <li><i class="fa-solid fa-check" aria-hidden="true"></i> Competitor price snapshot</li>
                        </ul>
                        <button class="primary-action run-btn" type="button" data-workflow="marketing">Run weekly marketing <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </article>

                    <article class="activity-panel searchable-item" data-search-text="campaign queue drafts scheduled published">
                        <div class="panel-heading">
                            <div>
                                <span class="section-label">Campaign queue</span>
                                <h3>Prepared outcomes</h3>
                            </div>
                            <span class="status-badge">3 items</span>
                        </div>
                        <div class="activity-list">
                            <div class="activity-row">
                                <span class="activity-icon"><i class="fa-brands fa-instagram" aria-hidden="true"></i></span>
                                <div><strong>Weekend best-seller carousel</strong><small>Draft ready for review</small></div>
                                <span class="status-dot ready">Ready</span>
                            </div>
                            <div class="activity-row">
                                <span class="activity-icon"><i class="fa-solid fa-envelope" aria-hidden="true"></i></span>
                                <div><strong>Returning customer offer</strong><small>Scheduled for Friday</small></div>
                                <span class="status-dot scheduled">Scheduled</span>
                            </div>
                            <div class="activity-row">
                                <span class="activity-icon"><i class="fa-solid fa-image" aria-hidden="true"></i></span>
                                <div><strong>In-store promotion flyer</strong><small>Generated from last week’s sales</small></div>
                                <span class="status-dot ready">Ready</span>
                            </div>
                        </div>
                    </article>
                </div>

                <div class="section-heading compact">
                    <div>
                        <span class="section-label">More marketing outcomes</span>
                        <h2>Choose the job, not the model</h2>
                    </div>
                </div>
                <div class="workflows-grid">
                    ${renderWorkflowCard({ icon: 'fa-hashtag', gradient: 'gradient-1', title: 'Social Content Pack', description: 'Creates a full week of captions, hooks, hashtags, and matching image briefs.', time: '~1 min', workflow: 'social-pack', search: 'social media content captions hashtags images' })}
                    ${renderWorkflowCard({ icon: 'fa-binoculars', gradient: 'gradient-2', title: 'Competitor Watch', description: 'Checks competitor offers and turns changes into a clear response plan.', time: '~45 secs', workflow: 'competitor-watch', search: 'competitor watch offers prices response plan' })}
                    ${renderWorkflowCard({ icon: 'fa-envelope-open-text', gradient: 'gradient-3', title: 'Customer Win-Back', description: 'Finds inactive customers and drafts a personalized reactivation campaign.', time: '~1.5 mins', workflow: 'win-back', search: 'customer win back email inactive reactivation' })}
                </div>
            </section>

            <section class="dashboard-view" data-view="analytics" aria-label="Analytics workspace" hidden>
                <div class="metrics-grid" aria-label="Business metrics">
                    <article class="metric-card searchable-item" data-search-text="revenue sales performance"><span>Revenue pulse</span><strong>$12,840</strong><small class="positive"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> 12.8% vs last week</small></article>
                    <article class="metric-card searchable-item" data-search-text="orders transactions"><span>Orders</span><strong>486</strong><small class="positive"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> 7.2%</small></article>
                    <article class="metric-card searchable-item" data-search-text="average order value"><span>Average order</span><strong>$26.42</strong><small>Stable</small></article>
                    <article class="metric-card searchable-item" data-search-text="returning customers retention"><span>Returning customers</span><strong>38%</strong><small class="positive"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> 4.1%</small></article>
                </div>

                <div class="analytics-grid">
                    <article class="chart-panel searchable-item" data-search-text="weekly sales trend chart revenue">
                        <div class="panel-heading">
                            <div><span class="section-label">Sales trend</span><h3>Last 7 days</h3></div>
                            <span class="status-badge positive-badge">+12.8%</span>
                        </div>
                        <div class="bar-chart" aria-label="Sales chart for the last seven days">
                            ${renderBar('Mon', 44, '$1.3k')}
                            ${renderBar('Tue', 58, '$1.7k')}
                            ${renderBar('Wed', 50, '$1.5k')}
                            ${renderBar('Thu', 72, '$2.1k')}
                            ${renderBar('Fri', 86, '$2.5k')}
                            ${renderBar('Sat', 100, '$2.9k')}
                            ${renderBar('Sun', 74, '$2.2k')}
                        </div>
                    </article>

                    <article class="insight-panel searchable-item" data-search-text="ai insight recommendations sales afternoon bundle">
                        <div class="insight-icon"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i></div>
                        <span class="section-label">OutcomeAI insight</span>
                        <h3>Your strongest growth window is Friday afternoon.</h3>
                        <p>Orders between 3 PM and 6 PM are up 24%. A time-limited bundle in that window could lift weekly revenue without discounting all day.</p>
                        <button class="secondary-action run-btn" type="button" data-workflow="analytics-report">Generate action report <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
                    </article>
                </div>

                <div class="section-heading compact">
                    <div><span class="section-label">Analytics outcomes</span><h2>Turn data into the next action</h2></div>
                </div>
                <div class="workflows-grid">
                    ${renderWorkflowCard({ icon: 'fa-file-lines', gradient: 'gradient-2', title: 'Weekly Business Report', description: 'Explains what changed, why it changed, and the three actions to take next.', time: '~1 min', workflow: 'analytics-report', search: 'weekly business report performance actions' })}
                    ${renderWorkflowCard({ icon: 'fa-chart-area', gradient: 'gradient-4', title: 'Demand Forecast', description: 'Predicts next week’s demand and flags inventory or staffing risks.', time: '~1.5 mins', workflow: 'demand-forecast', search: 'demand forecast inventory staffing risk' })}
                    ${renderWorkflowCard({ icon: 'fa-filter-circle-dollar', gradient: 'gradient-3', title: 'Profit Leak Finder', description: 'Reviews margins, discounts, and waste to surface avoidable profit loss.', time: '~2 mins', workflow: 'profit-leaks', search: 'profit margin discount waste cost leak' })}
                </div>
            </section>

            <section class="dashboard-view" data-view="crm" aria-label="CRM workspace" hidden>
                <div class="metrics-grid crm-metrics" aria-label="Customer metrics">
                    <article class="metric-card searchable-item" data-search-text="total customers contacts"><span>Total customers</span><strong>1,284</strong><small>46 added this month</small></article>
                    <article class="metric-card searchable-item" data-search-text="follow ups due"><span>Follow-ups due</span><strong>18</strong><small class="warning"><i class="fa-solid fa-clock" aria-hidden="true"></i> 6 high priority</small></article>
                    <article class="metric-card searchable-item" data-search-text="at risk customers churn"><span>At-risk customers</span><strong>23</strong><small>Inactive for 30+ days</small></article>
                    <article class="metric-card searchable-item" data-search-text="customer value repeat"><span>Repeat purchase rate</span><strong>41%</strong><small class="positive"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> 3.6%</small></article>
                </div>

                <div class="crm-layout">
                    <article class="customer-panel searchable-item" data-search-text="customer list contacts follow up loyalty">
                        <div class="panel-heading">
                            <div><span class="section-label">Priority customers</span><h3>Who needs attention</h3></div>
                            <button class="secondary-action run-btn" type="button" data-workflow="crm-followups">Draft all follow-ups</button>
                        </div>
                        <div class="customer-table" role="table" aria-label="Priority customers">
                            <div class="customer-row customer-head" role="row">
                                <span role="columnheader">Customer</span><span role="columnheader">Signal</span><span role="columnheader">Next action</span>
                            </div>
                            ${renderCustomer('Maya Patel', 'MP', 'High-value customer', 'Send loyalty thank-you', 'loyal')}
                            ${renderCustomer('Noah Williams', 'NW', 'No order in 42 days', 'Send win-back offer', 'risk')}
                            ${renderCustomer('Aarav Mehta', 'AM', 'Left a 5-star review', 'Request referral', 'loyal')}
                            ${renderCustomer('Emma Chen', 'EC', 'Support issue resolved', 'Check satisfaction', 'attention')}
                        </div>
                    </article>

                    <article class="crm-action-panel searchable-item" data-search-text="crm automatic follow up retention customers">
                        <div class="command-card-icon crm"><i class="fa-solid fa-user-check" aria-hidden="true"></i></div>
                        <span class="section-label">Recommended outcome</span>
                        <h3>Recover at-risk customers</h3>
                        <p>OutcomeAI identifies customers likely to churn, chooses the right message, and prepares a personalized follow-up sequence.</p>
                        <button class="primary-action run-btn" type="button" data-workflow="retention-watch">Build retention sequence <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </article>
                </div>

                <div class="section-heading compact">
                    <div><span class="section-label">CRM outcomes</span><h2>Keep every relationship moving</h2></div>
                </div>
                <div class="workflows-grid">
                    ${renderWorkflowCard({ icon: 'fa-paper-plane', gradient: 'gradient-1', title: 'Smart Follow-Ups', description: 'Drafts personalized follow-ups based on each customer’s history and latest signal.', time: '~1 min', workflow: 'crm-followups', search: 'smart customer follow up personalized history' })}
                    ${renderWorkflowCard({ icon: 'fa-heart-circle-bolt', gradient: 'gradient-3', title: 'Retention Watch', description: 'Finds churn risk early and builds a targeted recovery sequence.', time: '~1.5 mins', workflow: 'retention-watch', search: 'retention churn risk recovery customers' })}
                    ${renderWorkflowCard({ icon: 'fa-user-plus', gradient: 'gradient-2', title: 'Lead Qualifier', description: 'Scores new inquiries and produces the best next response for each lead.', time: '~45 secs', workflow: 'lead-qualifier', search: 'lead qualifier score inquiries sales response' })}
                </div>
            </section>

            <section class="dashboard-view" data-view="settings" aria-label="Account settings" hidden>
                <div class="settings-layout">
                    <article class="settings-card profile-settings-card searchable-item" data-search-text="profile account plan billing email">
                        <div class="large-avatar">${escapeHtml(user.initials)}</div>
                        <div>
                            <span class="section-label">Your profile</span>
                            <h2>${escapeHtml(user.displayName)}</h2>
                            <p>${escapeHtml(user.email)}</p>
                        </div>
                        <div class="settings-plan-card">
                            <span>Current plan</span>
                            <strong data-current-plan-name>${escapeHtml(currentPlan.name)}</strong>
                            ${expiryText ? `<small>Active until ${escapeHtml(expiryText)}</small>` : '<small>No expiry</small>'}
                            <button type="button" class="secondary-action" id="settingsUpgradeButton">Manage billing</button>
                        </div>
                    </article>

                    <form class="settings-card settings-form searchable-item" id="workspaceSettingsForm" data-search-text="business workspace preferences review email routing settings">
                        <div class="panel-heading">
                            <div><span class="section-label">Workspace defaults</span><h3>Business context</h3></div>
                        </div>
                        <p class="settings-description">These details help workflows produce more relevant outcomes. They are stored only in this browser for now.</p>
                        <div class="form-grid">
                            <label><span>Business name</span><input type="text" name="businessName" placeholder="Your business name" autocomplete="organization"></label>
                            <label><span>Industry</span><select name="industry"><option value="">Choose an industry</option><option>Food and beverage</option><option>Retail</option><option>Professional services</option><option>Health and wellness</option><option>Other</option></select></label>
                            <label><span>Primary market</span><input type="text" name="market" placeholder="City or customer segment"></label>
                            <label class="full-width"><span>Weekly business goal</span><textarea name="weeklyGoal" rows="3" placeholder="Example: Increase repeat orders without increasing discounts"></textarea></label>
                        </div>
                        <div class="preference-list">
                            <label class="toggle-row"><span><strong>Require review before publishing</strong><small>Keep generated marketing work in draft until approved.</small></span><input type="checkbox" name="requireReview" checked><span class="toggle-control"></span></label>
                            <label class="toggle-row"><span><strong>Email completion summaries</strong><small>Receive a short summary when an outcome finishes.</small></span><input type="checkbox" name="emailSummaries"><span class="toggle-control"></span></label>
                            <label class="toggle-row"><span><strong>Show model routing details</strong><small>Display which systems handled each workflow step.</small></span><input type="checkbox" name="showRouting" checked><span class="toggle-control"></span></label>
                        </div>
                        <div class="settings-actions">
                            <span class="settings-status" id="settingsStatus" role="status" aria-live="polite"></span>
                            <button class="primary-action" type="submit">Save settings</button>
                        </div>
                    </form>

                    <article class="settings-card integrations-card searchable-item" data-search-text="integrations connections sales social crm data sources">
                        <div class="panel-heading"><div><span class="section-label">Connections</span><h3>Workflow data sources</h3></div></div>
                        <p class="settings-description">Connect the systems OutcomeAI should use when completing work.</p>
                        <div class="integration-list">
                            ${renderIntegration('sales', 'fa-cash-register', 'Sales data', 'Use order history for campaigns, forecasts, and reports.')}
                            ${renderIntegration('social', 'fa-share-nodes', 'Social channels', 'Prepare and publish approved marketing content.')}
                            ${renderIntegration('crm', 'fa-address-book', 'Customer records', 'Power follow-ups, lead scoring, and retention workflows.')}
                        </div>
                    </article>
                </div>
            </section>
        </main>
    </div>

    <div class="modal-overlay" id="executionModal" aria-hidden="true">
        <div class="modal-content glass-panel" role="dialog" aria-modal="true" aria-labelledby="workflowTitle">
            <button class="close-modal" id="closeModal" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            <div class="modal-header">
                <div class="running-indicator"><div class="spinner"></div></div>
                <h2 id="workflowTitle">Running workflow...</h2>
            </div>
            <div class="execution-steps" id="executionSteps"></div>
            <div class="execution-result hidden" id="executionResult">
                <div class="success-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></div>
                <h3 id="workflowResultTitle">Outcome achieved</h3>
                <p id="workflowResultDescription">Your workflow completed successfully and the finished work is ready.</p>
                <button class="view-result-btn" id="closeResultBtn">View workspace</button>
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
                    <strong data-current-plan-name>${escapeHtml(currentPlan.name)}</strong>
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

function renderWorkflowCard({ icon, gradient, title, description, time, workflow, search }) {
    return `<article class="workflow-card searchable-item" data-search-text="${escapeHtml(search)}">
        <div class="card-icon ${escapeHtml(gradient)}"><i class="fa-solid ${escapeHtml(icon)}" aria-hidden="true"></i></div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
        <div class="card-footer">
            <span class="time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(time)}</span>
            <button class="run-btn" type="button" data-workflow="${escapeHtml(workflow)}">Run Now <i class="fa-solid fa-play" aria-hidden="true"></i></button>
        </div>
    </article>`;
}

function renderBar(label, height, value) {
    return `<div class="bar-column"><span class="bar-value">${escapeHtml(value)}</span><div class="bar-track"><div class="bar-fill" style="height:${Number(height)}%"></div></div><span class="bar-label">${escapeHtml(label)}</span></div>`;
}

function renderCustomer(name, initials, signal, action, state) {
    return `<div class="customer-row" role="row">
        <span class="customer-name" role="cell"><span class="mini-avatar">${escapeHtml(initials)}</span><strong>${escapeHtml(name)}</strong></span>
        <span role="cell"><span class="customer-signal ${escapeHtml(state)}">${escapeHtml(signal)}</span></span>
        <span role="cell">${escapeHtml(action)}</span>
    </div>`;
}

function renderIntegration(id, icon, name, description) {
    return `<div class="integration-row" data-integration-row="${escapeHtml(id)}">
        <span class="integration-icon"><i class="fa-solid ${escapeHtml(icon)}" aria-hidden="true"></i></span>
        <div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(description)}</small></div>
        <button class="integration-connect-btn" type="button" data-integration="${escapeHtml(id)}">Connect</button>
    </div>`;
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

module.exports = {
    escapeHtml,
    renderBar,
    renderCustomer,
    renderDashboardPage,
    renderIntegration,
    renderPlanCard,
    renderWorkflowCard
};
