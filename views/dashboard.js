'use strict';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderDashboardPage({ user }) {
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
<body>
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
            </nav>
            <div class="user-profile">
                <div class="avatar">${escapeHtml(user.initials)}</div>
                <div class="user-info">
                    <span class="name">${escapeHtml(user.displayName)}</span>
                    <span class="plan">${escapeHtml(user.email)}</span>
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

    <script src="/app.js" defer></script>
</body>
</html>`;
}

module.exports = { renderDashboardPage };
