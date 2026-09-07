'use strict';

const SIDEBAR_NAV_ICONS = Object.freeze({
    hub: `
        <span class="nav-icon nav-icon-hub" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
                <rect class="nav-icon-part nav-hub-tile nav-hub-tile-1" x="3.25" y="3.25" width="7.25" height="7.25" rx="1.6"></rect>
                <rect class="nav-icon-part nav-hub-tile nav-hub-tile-2" x="13.5" y="3.25" width="7.25" height="7.25" rx="1.6"></rect>
                <rect class="nav-icon-part nav-hub-tile nav-hub-tile-3" x="3.25" y="13.5" width="7.25" height="7.25" rx="1.6"></rect>
                <rect class="nav-icon-part nav-hub-tile nav-hub-tile-4" x="13.5" y="13.5" width="7.25" height="7.25" rx="1.6"></rect>
            </svg>
        </span>`,
    agent: `
        <span class="nav-icon nav-icon-agent" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
                <path class="nav-icon-part nav-agent-shell" d="M5.4 5.2h13.2a2.4 2.4 0 0 1 2.4 2.4v7.15a2.4 2.4 0 0 1-2.4 2.4H10l-4.75 3.1.85-3.25a2.4 2.4 0 0 1-3.1-2.25V7.6a2.4 2.4 0 0 1 2.4-2.4Z"></path>
                <circle class="nav-icon-part nav-agent-dot nav-agent-dot-1" cx="8" cy="11.2" r="1"></circle>
                <circle class="nav-icon-part nav-agent-dot nav-agent-dot-2" cx="12" cy="11.2" r="1"></circle>
                <circle class="nav-icon-part nav-agent-dot nav-agent-dot-3" cx="16" cy="11.2" r="1"></circle>
            </svg>
        </span>`,
    marketing: `
        <span class="nav-icon nav-icon-marketing" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
                <path class="nav-icon-part nav-marketing-body" d="M4 10.15v3.7a1.65 1.65 0 0 0 1.65 1.65H8l6.6 3.65V4.85L8 8.5H5.65A1.65 1.65 0 0 0 4 10.15Z"></path>
                <path class="nav-icon-part nav-marketing-handle" d="m7.35 15.5 1.35 4.05c.18.55.7.92 1.28.92h.85c.74 0 1.27-.72 1.05-1.43l-.65-2.08"></path>
                <path class="nav-icon-part nav-marketing-wave nav-marketing-wave-near" d="M17.3 8.25a4.5 4.5 0 0 1 0 7.5"></path>
                <path class="nav-icon-part nav-marketing-wave nav-marketing-wave-far" d="M19.4 5.6a8 8 0 0 1 0 12.8"></path>
            </svg>
        </span>`,
    analytics: `
        <span class="nav-icon nav-icon-analytics" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
                <path class="nav-icon-part nav-analytics-axis" d="M4 4.5v15.25h16"></path>
                <path class="nav-icon-part nav-analytics-line" d="m6.4 16.1 3.6-4.25 3.2 2.35 4.8-6.1"></path>
                <circle class="nav-icon-part nav-analytics-point nav-analytics-point-1" cx="6.4" cy="16.1" r="1.05"></circle>
                <circle class="nav-icon-part nav-analytics-point nav-analytics-point-2" cx="10" cy="11.85" r="1.05"></circle>
                <circle class="nav-icon-part nav-analytics-point nav-analytics-point-3" cx="13.2" cy="14.2" r="1.05"></circle>
                <circle class="nav-icon-part nav-analytics-point nav-analytics-point-4" cx="18" cy="8.1" r="1.05"></circle>
            </svg>
        </span>`,
    crm: `
        <span class="nav-icon nav-icon-crm" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
                <g class="nav-icon-part nav-crm-person nav-crm-person-left">
                    <circle cx="6.5" cy="8.1" r="2.25"></circle>
                    <path d="M2.7 17.75c.15-3 1.55-4.65 3.8-4.65s3.65 1.65 3.8 4.65"></path>
                </g>
                <g class="nav-icon-part nav-crm-person nav-crm-person-center">
                    <circle cx="12" cy="6.75" r="2.55"></circle>
                    <path d="M7.35 18.85c.18-3.7 1.9-5.75 4.65-5.75s4.47 2.05 4.65 5.75"></path>
                </g>
                <g class="nav-icon-part nav-crm-person nav-crm-person-right">
                    <circle cx="17.5" cy="8.1" r="2.25"></circle>
                    <path d="M13.7 17.75c.15-3 1.55-4.65 3.8-4.65s3.65 1.65 3.8 4.65"></path>
                </g>
            </svg>
        </span>`
});

function renderSidebarNavIcon(name) {
    return SIDEBAR_NAV_ICONS[name] || '';
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderDashboardPage({ user, plans, billing, paymentConfiguration, aiConfiguration = {}, showLoginIntro = false, cspNonce = '' }) {
    const currentPlan = plans.find((plan) => plan.id === billing.currentPlanId) || plans[0];
    const expiryText = billing.planExpiresAt
        ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(billing.planExpiresAt))
        : '';
    const geminiConfigured = aiConfiguration.isConfigured === true;
    const geminiModel = aiConfiguration.model || 'gemini-3.6-flash';
    const promptUsage = aiConfiguration.promptUsage || {
        planId: currentPlan.id,
        planName: currentPlan.name,
        limit: currentPlan.aiAgentPromptLimit || 5,
        used: 0,
        remaining: currentPlan.aiAgentPromptLimit || 5,
        exhausted: false,
        periodKind: currentPlan.id === 'free' ? 'calendar_month' : 'subscription',
        periodStart: '',
        periodEnd: billing.planExpiresAt || ''
    };

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script nonce="${escapeHtml(cspNonce)}">
        (() => {
            try {
                const stored = JSON.parse(localStorage.getItem('outcomeai.workspaceSettings') || '{}');
                const theme = ['dark', 'midnight', 'light'].includes(stored.theme) ? stored.theme : 'dark';
                document.documentElement.dataset.theme = theme;
                document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
            } catch {
                document.documentElement.dataset.theme = 'dark';
                document.documentElement.style.colorScheme = 'dark';
            }
        })();
    </script>
    <title>OrexisAI - Workflow as a Service</title>
    <link rel="stylesheet" href="/style.css">
    <link rel="stylesheet" href="/hyperspeed.css">
    <link rel="stylesheet" href="/orb.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body
    data-user-email="${escapeHtml(user.email)}"
    data-original-user-display-name="${escapeHtml(user.displayName)}"
    data-razorpay-key-id="${escapeHtml(paymentConfiguration.razorpay.keyId)}"
    data-razorpay-configured="${paymentConfiguration.razorpay.isConfigured ? 'true' : 'false'}"
    data-paypal-client-id="${escapeHtml(paymentConfiguration.paypal.clientId)}"
    data-paypal-configured="${paymentConfiguration.paypal.isConfigured ? 'true' : 'false'}"
    data-paypal-mode="${escapeHtml(paymentConfiguration.paypal.mode)}"
    data-current-plan-id="${escapeHtml(currentPlan.id)}"
    data-current-plan-name="${escapeHtml(currentPlan.name)}"
    data-plan-expires-at="${escapeHtml(billing.planExpiresAt || '')}"
    data-csp-nonce="${escapeHtml(cspNonce)}"
    data-ai-model="${escapeHtml(geminiModel)}"
    data-agent-prompts-used="${escapeHtml(promptUsage.used)}"
    data-agent-prompts-limit="${escapeHtml(promptUsage.limit)}"
    data-agent-prompt-plan-id="${escapeHtml(promptUsage.planId)}"
    data-agent-prompt-plan-name="${escapeHtml(promptUsage.planName)}"
    data-agent-prompt-period-kind="${escapeHtml(promptUsage.periodKind)}"
    data-agent-prompt-period-start="${escapeHtml(promptUsage.periodStart || '')}"
    data-agent-prompt-period-end="${escapeHtml(promptUsage.periodEnd || '')}"
>
    ${showLoginIntro ? renderLoginBrandIntro() : ''}
    <div class="app-container" id="appContainer">
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-brand-row">
                <div class="logo outcome-brand-lockup" aria-label="OrexisAI">
                    <span class="outcome-brand-o" aria-hidden="true">O</span>
                    <span class="outcome-brand-word-mask logo-text" aria-hidden="true">
                        <span class="outcome-brand-word">rexis<span class="outcome-brand-ai">AI</span></span>
                    </span>
                </div>
                <button type="button" class="sidebar-toggle" id="sidebarToggle" aria-label="Collapse sidebar" aria-expanded="true">
                    <i class="fa-solid fa-angles-left" aria-hidden="true"></i>
                </button>
            </div>

            <nav class="nav-menu" aria-label="Main navigation">
                <span class="nav-active-pill" aria-hidden="true"></span>
                <span class="nav-active-indicator" aria-hidden="true"></span>
                <button type="button" class="nav-item active" data-view-target="hub" aria-label="Hub">
                    ${renderSidebarNavIcon('hub')}
                    <span class="nav-label">Hub</span>
                </button>
                <button type="button" class="nav-item" data-view-target="agent" aria-label="AI Agent">
                    ${renderSidebarNavIcon('agent')}
                    <span class="nav-label">AI Agent</span>
                </button>
                <button type="button" class="nav-item" data-view-target="marketing" aria-label="Marketing">
                    ${renderSidebarNavIcon('marketing')}
                    <span class="nav-label">Marketing</span>
                </button>
                <button type="button" class="nav-item" data-view-target="analytics" aria-label="Analytics">
                    ${renderSidebarNavIcon('analytics')}
                    <span class="nav-label">Analytics</span>
                </button>
                <button type="button" class="nav-item" data-view-target="crm" aria-label="CRM">
                    ${renderSidebarNavIcon('crm')}
                    <span class="nav-label">CRM</span>
                </button>
            </nav>

            <section class="chat-history-panel" aria-label="AI agent chat actions">
                <button type="button" class="new-chat-button" id="newChatButton">
                    <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
                    <span>New chat</span>
                </button>
                <button type="button" class="recent-chats-button" id="recentChatsButton" aria-haspopup="dialog" aria-controls="recentChatsModal" aria-expanded="false">
                    <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                    <span class="recent-chats-button-copy">
                        <strong>Recent chats</strong>
                        <small>Open saved conversations</small>
                    </span>
                    <span class="recent-chats-count" id="recentChatsCount" aria-label="0 saved chats">0</span>
                    <i class="fa-solid fa-chevron-right recent-chats-chevron" aria-hidden="true"></i>
                </button>
            </section>

            <button type="button" class="nav-item upgrade-nav-item sidebar-upgrade-button" id="upgradeButton" aria-label="Upgrade plan">
                <i class="fa-solid fa-crown" aria-hidden="true"></i>
                <span class="nav-label">Upgrade</span>
                <span class="upgrade-pill">${escapeHtml(currentPlan.name)}</span>
            </button>

            <div class="sidebar-footer">
                <div class="profile-menu" id="profileMenu" role="menu" aria-hidden="true">
                    <div class="profile-menu-heading">
                        <strong data-user-display-name>${escapeHtml(user.displayName)}</strong>
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
                        <span class="name" data-user-display-name>${escapeHtml(user.displayName)}</span>
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
                    <p id="pageSubtitle">Choose a business result. OrexisAI handles the models, tools, and routing behind it.</p>
                </div>
                <div class="topbar-actions">
                    <button type="button" class="theme-toggle-button" id="themeToggleButton" aria-label="Switch to light mode" aria-pressed="false" title="Switch to light mode">
                        <span class="theme-toggle-track" aria-hidden="true">
                            <i class="fa-solid fa-sun theme-toggle-sun"></i>
                            <i class="fa-solid fa-moon theme-toggle-moon"></i>
                            <span class="theme-toggle-thumb"></span>
                        </span>
                        <span class="theme-toggle-text">Light</span>
                    </button>
                    <button type="button" class="about-orexis-button" id="aboutOrexisButton" hidden>
                        <span class="about-orexis-mark" aria-hidden="true">O</span>
                        <span>About OrexisAI</span>
                    </button>
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

            <section class="dashboard-view agent-view" data-view="agent" aria-label="AI Agent chat" hidden>
                <div class="agent-chat-shell">
                    <div class="agent-orb-background" id="outcomeAgentOrb" aria-hidden="true"></div>
                    <header class="agent-chat-header">
                        <div class="agent-chat-heading">
                            <span class="agent-status-dot" aria-hidden="true"></span>
                            <div>
                                <span class="section-label">OrexisAI agent</span>
                                <h2 id="activeChatTitle">New chat</h2>
                                <form class="chat-title-editor" id="chatTitleEditor" hidden>
                                    <input id="chatTitleInput" type="text" maxlength="80" aria-label="Chat title">
                                    <button type="submit" aria-label="Save chat title"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
                                    <button type="button" id="cancelChatRenameButton" aria-label="Cancel rename"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                                </form>
                            </div>
                        </div>
                        <div class="agent-chat-actions">
                            <span class="gemini-status-badge ${geminiConfigured ? 'connected' : 'setup-required'}" title="${escapeHtml(geminiModel)}">
                                <i class="fa-solid ${geminiConfigured ? 'fa-wand-magic-sparkles' : 'fa-triangle-exclamation'}" aria-hidden="true"></i>
                                ${geminiConfigured ? `Gemini · ${escapeHtml(geminiModel)}` : 'Gemini setup required'}
                            </span>
                            <button type="button" class="icon-action" id="renameChatButton" aria-label="Rename chat" title="Rename chat" disabled>
                                <i class="fa-solid fa-pen" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="icon-action danger" id="deleteChatButton" aria-label="Delete chat" title="Delete chat" disabled>
                                <i class="fa-solid fa-trash" aria-hidden="true"></i>
                            </button>
                        </div>
                    </header>

                    <div class="agent-message-list" id="agentMessageList" role="log" aria-live="polite" aria-relevant="additions">
                        <div class="agent-empty-state" id="agentEmptyState">
                            <span class="agent-empty-icon"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i></span>
                            <h3>What outcome should the agent handle?</h3>
                            <p>Type a complete instruction. Every command and Gemini reply is attached to this account and stored in PostgreSQL, so you can reopen the full conversation from the sidebar.</p>
                            <div class="agent-prompt-suggestions" aria-label="Command examples">
                                <button type="button" data-agent-suggestion="Create next week's marketing plan from my best-selling products and prepare the social copy.">Plan next week’s marketing</button>
                                <button type="button" data-agent-suggestion="Analyze this week's performance and tell me the three actions with the highest impact.">Analyze business performance</button>
                                <button type="button" data-agent-suggestion="Find customers who need a follow-up and draft a personalized message for each one.">Prepare CRM follow-ups</button>
                            </div>
                        </div>
                    </div>

                    <form class="agent-command-composer" id="agentCommandForm">
                        <div class="agent-upload-toolbar" aria-label="Upload options">
                            <button type="button" class="agent-upload-button" id="agentCameraButton" aria-haspopup="dialog" aria-controls="cameraModal">
                                <i class="fa-solid fa-camera" aria-hidden="true"></i>
                                <span>Camera</span>
                            </button>
                            <button type="button" class="agent-upload-button" id="agentFolderButton">
                                <i class="fa-solid fa-folder-arrow-up" aria-hidden="true"></i>
                                <span>Folder</span>
                            </button>
                            <button type="button" class="agent-upload-button agent-voice-button" id="agentVoiceButton" aria-pressed="false" aria-describedby="agentVoiceStatus">
                                <i class="fa-solid fa-microphone" aria-hidden="true"></i>
                                <span>Voice</span>
                            </button>
                            <button type="button" class="agent-voice-end-button" id="agentVoiceEndButton" aria-label="End voice conversation" title="End voice conversation" hidden>
                                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                            </button>
                            <span class="agent-voice-status" id="agentVoiceStatus" role="status" aria-live="polite"></span>
                            <span class="agent-upload-status" id="agentUploadStatus" role="status" aria-live="polite"></span>
                            <input id="agentCameraCaptureInput" type="file" accept="image/*" capture="environment" hidden>
                            <input id="agentFolderInput" type="file" webkitdirectory directory multiple hidden>
                        </div>
                        <div class="agent-attachment-list" id="agentAttachmentList" aria-label="Uploaded attachments" hidden></div>
                        <div class="agent-editing-banner" id="agentEditingBanner" role="status" aria-live="polite" hidden>
                            <span><i class="fa-solid fa-pen" aria-hidden="true"></i> Editing your message</span>
                            <button type="button" id="cancelAgentEditButton" aria-label="Cancel editing message">Cancel</button>
                        </div>
                        <label class="sr-only" for="agentCommandInput">Command the OrexisAI agent</label>
                        <textarea id="agentCommandInput" name="command" rows="1" placeholder="Message OrexisAI…" autocomplete="off" aria-describedby="agentPromptLimitStatus"></textarea>
                        <button type="submit" class="agent-send-button" id="agentSendButton" aria-label="Send command" disabled>
                            <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
                        </button>
                        <div class="agent-composer-meta">
                            <span><i class="fa-solid fa-lock" aria-hidden="true"></i> Private to your account</span>
                            <span id="agentPromptLimitStatus" class="agent-prompt-limit" aria-live="polite">${escapeHtml(Number(promptUsage.used).toLocaleString('en-US'))} / ${escapeHtml(Number(promptUsage.limit).toLocaleString('en-US'))} prompts used</span>
                            <span>Enter to send · Shift+Enter for a new line</span>
                        </div>
                    </form>
                </div>
            </section>

            <section class="dashboard-view active" data-view="hub" aria-label="Outcome Hub">
                <div class="outcome-hero searchable-item" data-search-text="workflow as a service outcomes automation business hub">
                    <div class="hyperspeed-background" id="outcomeHyperspeed" aria-hidden="true"></div>
                    <div class="outcome-hero-copy">
                        <span class="eyebrow"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Workflow-as-a-Service</span>
                        <h2>AI is hidden. The finished work is what you buy.</h2>
                        <p>Run pre-built, multi-step business workflows without choosing models or stitching tools together. OrexisAI routes each step to the best available system and returns a usable result.</p>
                        <div class="hero-actions">
                            <button class="primary-action run-btn" type="button" data-workflow="weekly-marketing">
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
                    ${renderWorkflowCard({ icon: 'fa-rocket', gradient: 'gradient-1', title: 'Weekly Marketing', description: 'Calculates this week’s real sales performance and creates a fact-grounded marketing plan.', time: 'Live data', workflow: 'weekly-marketing', search: 'weekly marketing revenue orders customers products' })}
                    ${renderWorkflowCard({ icon: 'fa-magnifying-glass-dollar', gradient: 'gradient-2', title: 'Competitor Audit', description: 'Analyzes the newest sourced competitor snapshots from your configured integrations.', time: 'Source dependent', workflow: 'competitor-audit', search: 'competitor audit pricing offers positioning sources', configureCompetitors: true })}
                    ${renderWorkflowCard({ icon: 'fa-star-half-stroke', gradient: 'gradient-3', title: 'Review Responder', description: 'Uses real unanswered reviews to create editable, provider-safe response drafts.', time: 'Up to 20 reviews', workflow: 'review-responder', search: 'review responder customer reputation replies real reviews' })}
                    ${renderWorkflowCard({ icon: 'fa-box-open', gradient: 'gradient-4', title: 'Inventory Predictor', description: 'Forecasts next week\'s inventory needs based on weather, holidays, and past sales.', time: '~1 min', workflow: 'inventory-predictor', search: 'inventory forecast demand weather sales' })}
                </div>
            </section>

            <section class="dashboard-view" data-view="marketing" aria-label="Marketing workspace" id="marketingWorkspace" hidden>
                <form class="marketing-command-bar glass-panel" id="marketingWorkspaceForm">
                    <div class="marketing-command-heading">
                        <span class="command-card-icon marketing"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i></span>
                        <div><span class="section-label">Workflow-as-a-Service</span><h2>Marketing operating workspace</h2><p>Every result below is calculated from connected business records.</p></div>
                    </div>
                    <label>From<input type="date" id="marketingFromDate" name="from" required></label>
                    <label>To<input type="date" id="marketingToDate" name="to" required></label>
                    <button class="secondary-action" type="submit"><i class="fa-solid fa-filter" aria-hidden="true"></i> Apply</button>
                    <button class="secondary-action" type="button" id="marketingRefreshBtn"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Refresh</button>
                    <span class="marketing-live-badge" id="marketingLiveStatus"><i class="fa-solid fa-signal" aria-hidden="true"></i> Connecting</span>
                </form>

                <div class="business-data-status" id="marketingDataStatus" role="status" aria-live="polite">Loading verified business data…</div>
                <div class="metrics-grid marketing-live-metrics" id="marketingLiveMetricsGrid" aria-label="Live marketing metrics"></div>

                <div class="marketing-workspace-grid marketing-primary-grid">
                    <article class="command-card marketing-run-card searchable-item" data-search-text="weekly marketing workflow campaign automation">
                        <div class="marketing-run-card-head">
                            <div><span class="section-label">26-stage operating workflow</span><h2>Run Weekly Marketing</h2></div>
                            <span class="status-badge">Verified inputs only</span>
                        </div>
                        <p>Collects database records, computes KPIs, detects opportunities and stock risks, retrieves configured competitor sources, then generates evidence-bound campaign drafts.</p>
                        <label class="marketing-objective-field">Business objective<textarea name="marketingObjective" rows="3" maxlength="2000" placeholder="Optional: enter the outcome this run should prioritize"></textarea></label>
                        <label class="toggle-row marketing-scan-toggle"><span><strong>Competitor intelligence</strong><small>Use configured competitor URLs and connected public-data providers.</small></span><input type="checkbox" name="competitorScan" checked><span class="toggle-control"></span></label>
                        <button class="primary-action marketing-run-button run-btn" id="marketingRunBtn" type="button" data-workflow="weekly-marketing">Run weekly marketing <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </article>

                    <article class="activity-panel marketing-progress-panel" id="marketingWorkflowProgress">
                        <div class="panel-heading"><div><span class="section-label">Streaming execution</span><h3>Workflow timeline</h3></div><span class="status-badge">Realtime</span></div>
                        <div class="marketing-progress-copy" id="marketingProgressLabel">Ready to execute · 0%</div>
                        <progress class="marketing-progress-bar" id="marketingProgressBar" max="100" value="0">0%</progress>
                        <div class="marketing-execution-grid">
                            <div class="marketing-timeline" id="marketingTimeline"><div class="business-empty-state"><span>No active workflow.</span></div></div>
                            <div class="marketing-logs" id="marketingLogs" role="log" aria-live="polite"><div class="business-empty-state"><span>Execution logs will stream here.</span></div></div>
                        </div>
                    </article>
                </div>

                <div class="analytics-grid marketing-chart-grid">
                    <article class="chart-panel searchable-item" data-search-text="revenue trend sales daily">
                        <div class="panel-heading"><div><span class="section-label">Actual revenue</span><h3>Daily sales trend</h3></div></div>
                        <div class="marketing-trend-chart" id="marketingRevenueTrend" aria-label="Revenue by day"></div>
                    </article>
                    <article class="activity-panel searchable-item" data-search-text="revenue forecast projection">
                        <div class="panel-heading"><div><span class="section-label">Statistical forecast</span><h3>Next 14 days</h3></div></div>
                        <div class="marketing-forecast-list" id="marketingRevenueForecast"></div>
                    </article>
                </div>

                <div class="marketing-workspace-grid marketing-data-grid">
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Product performance</span><h3>Top sellers</h3></div></div><div class="marketing-table" id="marketingTopProducts"></div></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Product performance</span><h3>Lowest sellers</h3></div></div><div class="marketing-table" id="marketingWorstProducts"></div></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Inventory velocity</span><h3>Stock risk</h3></div></div><div class="marketing-table" id="marketingInventoryAlerts"></div></article>
                </div>

                <div class="marketing-workspace-grid marketing-insight-grid">
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Conversion</span><h3>Sales funnel</h3></div></div><div class="marketing-funnel" id="marketingFunnel"></div></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Acquisition</span><h3>Traffic sources</h3></div></div><div class="marketing-data-list" id="marketingTrafficSources"></div></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Merchandising</span><h3>Category performance</h3></div></div><div class="marketing-data-list" id="marketingCategories"></div></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Paid and owned</span><h3>Campaign performance</h3></div></div><div class="marketing-data-list" id="marketingCampaignPerformance"></div></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Markets</span><h3>Geographic sales</h3></div></div><div class="marketing-data-list" id="marketingGeography"></div></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Promotion</span><h3>Coupon performance</h3></div></div><div class="marketing-data-list" id="marketingCoupons"></div></article>
                </div>

                <div class="marketing-workspace-grid marketing-output-grid">
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Calculated signals</span><h3>Growth opportunities</h3></div></div><div class="marketing-opportunity-list" id="marketingOpportunities"></div><ul class="marketing-limitations" id="marketingLimitations"></ul></article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">AI output</span><h3>Grounded campaign drafts</h3></div></div><div class="marketing-campaign-grid" id="marketingCampaignDrafts"></div></article>
                </div>

                <div class="marketing-workspace-grid marketing-operations-grid">
                    <article class="activity-panel">
                        <div class="panel-heading"><div><span class="section-label">Background jobs</span><h3>Marketing schedules</h3></div></div>
                        <form class="marketing-schedule-form" id="marketingScheduleForm">
                            <label>Job<select id="marketingScheduleKind"><option value="daily-summary">Daily marketing summary</option><option value="weekly-marketing" selected>Weekly marketing</option><option value="monthly-report">Monthly report</option><option value="trend-detection">Trend detection</option><option value="competitor-scan">Competitor scan</option><option value="inventory-scan">Inventory scan</option><option value="campaign-optimizer">Campaign optimizer</option><option value="forecast-generator">Forecast generator</option></select></label>
                            <label>Cadence<select id="marketingCadence"><option value="daily">Daily</option><option value="weekly" selected>Weekly</option><option value="monthly">Monthly</option></select></label>
                            <label>Hour<input type="number" id="marketingRunHour" min="0" max="23" value="8" required></label>
                            <label>Minute<input type="number" id="marketingRunMinute" min="0" max="59" value="0" required></label>
                            <label>Weekday<select id="marketingDayOfWeek"><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="7">Sunday</option></select></label>
                            <label hidden>Month day<input type="number" id="marketingDayOfMonth" min="1" max="28" value="1"></label>
                            <label class="marketing-timezone-field">Timezone<input type="text" id="marketingTimezone" maxlength="80" value="UTC" required></label>
                            <label class="marketing-enabled-field"><input type="checkbox" id="marketingScheduleEnabled" checked> Enabled</label>
                            <button class="secondary-action" type="submit"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> Save schedule</button>
                        </form>
                        <div class="marketing-schedule-list" id="marketingSchedules"></div>
                    </article>
                    <article class="activity-panel"><div class="panel-heading"><div><span class="section-label">Audit trail</span><h3>Workflow history</h3></div></div><div class="marketing-history-list" id="marketingHistory"></div></article>
                </div>
                <div class="marketing-toast-region" id="marketingToastRegion" aria-live="polite" aria-atomic="true"></div>
            </section>

            <section class="dashboard-view enterprise-analytics-view" data-view="analytics" aria-label="Enterprise analytics workspace" hidden>
                <form class="enterprise-filter-shell glass-panel" id="analyticsDateForm">
                    <div class="enterprise-filter-title">
                        <span class="section-label">Business intelligence</span>
                        <h2>Analytics &amp; Decisions</h2>
                        <p>Live operating metrics, forecasts, risks, and recommended actions from connected business records.</p>
                    </div>
                    <div class="enterprise-date-presets" role="group" aria-label="Date range presets">
                        <button type="button" data-analytics-preset="today">Today</button>
                        <button type="button" data-analytics-preset="yesterday">Yesterday</button>
                        <button type="button" data-analytics-preset="7">Last 7 days</button>
                        <button type="button" data-analytics-preset="30" class="active">Last 30 days</button>
                        <button type="button" data-analytics-preset="this-month">This month</button>
                        <button type="button" data-analytics-preset="last-month">Last month</button>
                    </div>
                    <div class="enterprise-filter-fields">
                        <label>From<input type="date" name="from" id="analyticsFromDate" required></label>
                        <label>To<input type="date" name="to" id="analyticsToDate" required></label>
                        <label>Compare<select id="analyticsComparePeriod"><option value="previous-period">Previous period</option><option value="previous-year">Previous year</option><option value="none">No comparison</option></select></label>
                        <label>Channel<select id="analyticsChannelFilter"><option value="">All channels</option></select></label>
                        <label>Location<select id="analyticsLocationFilter"><option value="">All locations</option></select></label>
                        <label>Hours<select id="analyticsBusinessHours"><option value="all">All hours</option><option value="business-hours">Business hours</option><option value="after-hours">After hours</option></select></label>
                    </div>
                    <div class="enterprise-filter-actions">
                        <button class="secondary-action" type="submit"><i class="fa-solid fa-filter" aria-hidden="true"></i> Apply filters</button>
                        <button class="secondary-action" type="button" id="analyticsRefreshButton"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Refresh</button>
                        <button class="enterprise-live-toggle" type="button" id="analyticsLiveToggle" aria-pressed="true"><span></span> Live</button>
                        <div class="enterprise-live-status" id="analyticsLiveStatus" role="status" aria-live="polite">Connecting to live analytics…</div>
                    </div>
                </form>

                <button class="run-btn enterprise-static-workflow-hook" type="button" data-workflow="inventory-predictor" hidden aria-hidden="true" tabindex="-1">Run inventory predictor</button>
                <div class="enterprise-analytics-root" id="enterpriseAnalyticsRoot" aria-live="polite">
                    <div class="enterprise-analytics-skeleton" aria-label="Loading analytics">
                        <div class="skeleton-line wide"></div><div class="skeleton-line"></div>
                        <div class="skeleton-metric-row"><i></i><i></i><i></i><i></i></div>
                        <div class="skeleton-panel-row"><i></i><i></i></div>
                    </div>
                </div>
                <div class="enterprise-toast-region" id="analyticsToastRegion" aria-live="polite" aria-atomic="true"></div>

                <div class="enterprise-drilldown" id="analyticsDrilldown" role="dialog" aria-modal="true" aria-labelledby="analyticsDrilldownTitle" hidden>
                    <button class="enterprise-drilldown-backdrop" type="button" data-close-analytics-drilldown aria-label="Close details"></button>
                    <article class="enterprise-drilldown-panel">
                        <header><div><span class="section-label">Metric details</span><h2 id="analyticsDrilldownTitle">Analytics details</h2></div><button type="button" data-close-analytics-drilldown aria-label="Close details"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header>
                        <div id="analyticsDrilldownContent"></div>
                    </article>
                </div>
            </section>

            <section class="dashboard-view" data-view="crm" aria-label="CRM workspace" hidden>
                <div class="section-heading">
                    <div><span class="section-label">Customer database</span><h2>CRM</h2></div>
                    <button class="secondary-action business-data-refresh" type="button" data-refresh-view="crm"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Refresh</button>
                </div>
                <div class="business-data-status" id="crmDataStatus" role="status" aria-live="polite">Loading current database values…</div>
                <div class="metrics-grid crm-metrics" id="crmMetricsGrid" aria-label="Customer metrics"></div>

                <div class="crm-layout">
                    <article class="customer-panel searchable-item" data-search-text="customer list contacts follow up loyalty actual records">
                        <div class="panel-heading">
                            <div><span class="section-label">Priority customers</span><h3>Verified customer activity</h3></div>
                        </div>
                        <div class="customer-table" id="crmCustomerTable" role="table" aria-label="Priority customers"></div>
                    </article>

                    <article class="crm-action-panel searchable-item" data-search-text="review responder real customer reviews">
                        <div class="command-card-icon crm"><i class="fa-solid fa-star-half-stroke" aria-hidden="true"></i></div>
                        <span class="section-label">Review workflow</span>
                        <h3>Respond to real customer reviews</h3>
                        <p>Retrieves unanswered reviews, detects sentiment and concerns, and creates editable drafts. Sending remains disabled unless a real review-provider endpoint is configured.</p>
                        <button class="primary-action run-btn" type="button" data-workflow="review-responder">Prepare review responses <i class="fa-solid fa-play" aria-hidden="true"></i></button>
                    </article>
                </div>
            </section>

            <section class="dashboard-view" data-view="settings" aria-label="Account settings" hidden>
                <div class="settings-search-results" id="settingsSearchResults" hidden>
                    <div class="settings-search-heading">
                        <div>
                            <span class="section-label">Settings search</span>
                            <h2>Matching controls</h2>
                        </div>
                        <span class="settings-result-count" id="settingsSearchResultCount">0 results</span>
                    </div>
                    <div class="settings-search-list" id="settingsSearchResultsList" role="list"></div>
                </div>

                <form class="settings-form-shell" id="workspaceSettingsForm">
                    <div class="settings-layout">
                        <article class="settings-card profile-settings-card" id="settings-profile-summary">
                            <div class="large-avatar">${escapeHtml(user.initials)}</div>
                            <div>
                                <span class="section-label">Your profile</span>
                                <h2 data-user-display-name>${escapeHtml(user.displayName)}</h2>
                                <p>${escapeHtml(user.email)}</p>
                            </div>
                            <div class="settings-plan-card">
                                <span>Current plan</span>
                                <strong data-current-plan-name>${escapeHtml(currentPlan.name)}</strong>
                                <small data-current-plan-expiry>${expiryText ? `Active until ${escapeHtml(expiryText)}` : 'No expiry'}</small>
                                <button type="button" class="secondary-action" id="settingsUpgradeButton">Manage billing</button>
                            </div>
                        </article>

                        <article class="settings-card settings-card-wide" id="settings-user-preferences" data-setting-section="User preferences">
                            <div class="panel-heading">
                                <div><span class="section-label">Personalization</span><h3>User preferences</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-user-gear" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">Customize how your account is identified and how information is formatted for you.</p>
                            <div class="form-grid settings-form-grid">
                                <label class="setting-control" id="setting-display-name" data-setting-item data-setting-title="Display name" data-setting-category="User preferences" data-setting-description="Change the name shown in your profile menu and settings.">
                                    <span>Display name</span>
                                    <input type="text" name="displayName" value="${escapeHtml(user.displayName)}" maxlength="60" autocomplete="name">
                                    <small>Shown locally in this dashboard.</small>
                                </label>
                                <label class="setting-control" id="setting-role" data-setting-item data-setting-title="Role or job title" data-setting-category="User preferences" data-setting-description="Set your role so workspace recommendations fit your responsibilities.">
                                    <span>Role or job title</span>
                                    <input type="text" name="role" placeholder="Owner, marketer, operations lead">
                                    <small>Used to tailor workflow suggestions.</small>
                                </label>
                                <label class="setting-control" id="setting-language" data-setting-item data-setting-title="Language" data-setting-category="User preferences" data-setting-description="Choose the language used for generated outcomes and summaries.">
                                    <span>Outcome language</span>
                                    <select name="language">
                                        <option value="en-US">English (US)</option>
                                        <option value="en-GB">English (UK)</option>
                                        <option value="hi-IN">Hindi</option>
                                        <option value="es-ES">Spanish</option>
                                        <option value="fr-FR">French</option>
                                    </select>
                                    <small>Applies to future generated content.</small>
                                </label>
                                <label class="setting-control" id="setting-timezone" data-setting-item data-setting-title="Time zone" data-setting-category="User preferences" data-setting-description="Control dates, schedules, and workflow completion times.">
                                    <span>Time zone</span>
                                    <select name="timezone">
                                        <option value="Asia/Kolkata">Asia/Kolkata</option>
                                        <option value="UTC">UTC</option>
                                        <option value="America/New_York">America/New_York</option>
                                        <option value="America/Los_Angeles">America/Los_Angeles</option>
                                        <option value="Europe/London">Europe/London</option>
                                        <option value="Asia/Singapore">Asia/Singapore</option>
                                    </select>
                                    <small>Used for schedules and timestamps.</small>
                                </label>
                                <label class="setting-control" id="setting-date-format" data-setting-item data-setting-title="Date format" data-setting-category="User preferences" data-setting-description="Choose how dates are displayed across the dashboard.">
                                    <span>Date format</span>
                                    <select name="dateFormat">
                                        <option value="medium">Jul 25, 2026</option>
                                        <option value="numeric-us">07/25/2026</option>
                                        <option value="numeric-eu">25/07/2026</option>
                                        <option value="iso">2026-07-25</option>
                                    </select>
                                    <small>Controls dashboard date formatting.</small>
                                </label>
                                <label class="setting-control" id="setting-default-workspace" data-setting-item data-setting-title="Default workspace" data-setting-category="User preferences" data-setting-description="Choose which workspace opens after your next sign-in or refresh.">
                                    <span>Default workspace</span>
                                    <select name="defaultWorkspace">
                                        <option value="hub">Hub</option>
                                        <option value="agent">AI Agent</option>
                                        <option value="marketing">Marketing</option>
                                        <option value="analytics">Analytics</option>
                                        <option value="crm">CRM</option>
                                    </select>
                                    <small>Used the next time the dashboard loads.</small>
                                </label>
                            </div>
                        </article>

                        <article class="settings-card settings-card-wide" id="settings-appearance" data-setting-section="Appearance">
                            <div class="panel-heading">
                                <div><span class="section-label">Site customization</span><h3>Appearance</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-palette" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">Preview appearance changes instantly. Save them when the dashboard feels right.</p>

                            <fieldset class="setting-group" id="setting-theme" data-setting-item data-setting-title="Theme" data-setting-category="Appearance" data-setting-description="Switch the site between dark, midnight, and light themes.">
                                <legend>Theme</legend>
                                <div class="theme-choice-grid">
                                    <label class="theme-choice"><input type="radio" name="theme" value="dark" checked><span class="theme-preview dark-preview"><i></i><i></i><i></i></span><strong>Dark</strong></label>
                                    <label class="theme-choice"><input type="radio" name="theme" value="midnight"><span class="theme-preview midnight-preview"><i></i><i></i><i></i></span><strong>Midnight</strong></label>
                                    <label class="theme-choice"><input type="radio" name="theme" value="light"><span class="theme-preview light-preview"><i></i><i></i><i></i></span><strong>Light</strong></label>
                                </div>
                            </fieldset>

                            <fieldset class="setting-group" id="setting-accent-color" data-setting-item data-setting-title="Accent color" data-setting-category="Appearance" data-setting-description="Change buttons, active navigation, links, and focus highlights.">
                                <legend>Accent color</legend>
                                <div class="accent-choice-row">
                                    <label class="accent-choice indigo" title="Indigo"><input type="radio" name="accentColor" value="indigo" checked><span></span></label>
                                    <label class="accent-choice blue" title="Blue"><input type="radio" name="accentColor" value="blue"><span></span></label>
                                    <label class="accent-choice emerald" title="Emerald"><input type="radio" name="accentColor" value="emerald"><span></span></label>
                                    <label class="accent-choice rose" title="Rose"><input type="radio" name="accentColor" value="rose"><span></span></label>
                                    <label class="accent-choice amber" title="Amber"><input type="radio" name="accentColor" value="amber"><span></span></label>
                                </div>
                            </fieldset>

                            <div class="form-grid settings-form-grid appearance-selects">
                                <label class="setting-control" id="setting-density" data-setting-item data-setting-title="Dashboard density" data-setting-category="Appearance" data-setting-description="Choose comfortable or compact spacing throughout the site.">
                                    <span>Dashboard density</span>
                                    <select name="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
                                </label>
                                <label class="setting-control" id="setting-text-size" data-setting-item data-setting-title="Text size" data-setting-category="Appearance" data-setting-description="Make dashboard text smaller, standard, or larger.">
                                    <span>Text size</span>
                                    <select name="textSize"><option value="small">Small</option><option value="standard" selected>Standard</option><option value="large">Large</option></select>
                                </label>
                                <label class="setting-control" id="setting-card-style" data-setting-item data-setting-title="Card style" data-setting-category="Appearance" data-setting-description="Choose glass, solid, or minimal cards for the site.">
                                    <span>Card style</span>
                                    <select name="cardStyle"><option value="glass">Glass</option><option value="solid">Solid</option><option value="minimal">Minimal</option></select>
                                </label>
                                <label class="setting-control" id="setting-corner-style" data-setting-item data-setting-title="Corner style" data-setting-category="Appearance" data-setting-description="Change cards and controls between rounded and sharp corners.">
                                    <span>Corner style</span>
                                    <select name="cornerStyle"><option value="rounded">Rounded</option><option value="soft">Soft</option><option value="sharp">Sharp</option></select>
                                </label>
                            </div>

                            <div class="preference-list compact-preference-list">
                                <label class="toggle-row" id="setting-reduce-motion" data-setting-item data-setting-title="Reduce animations" data-setting-category="Appearance" data-setting-description="Reduce motion and nonessential interface animations."><span><strong>Reduce animations</strong><small>Turns off most motion and transition effects.</small></span><input type="checkbox" name="reduceMotion"><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-high-contrast" data-setting-item data-setting-title="High contrast" data-setting-category="Appearance" data-setting-description="Increase borders and text contrast for clearer visibility."><span><strong>High contrast</strong><small>Makes controls and card boundaries easier to see.</small></span><input type="checkbox" name="highContrast"><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-sidebar-default" data-setting-item data-setting-title="Collapsed sidebar by default" data-setting-category="Appearance" data-setting-description="Start the dashboard with the sidebar hidden to create more workspace room."><span><strong>Collapse sidebar by default</strong><small>Uses the compact sidebar whenever the dashboard loads.</small></span><input type="checkbox" name="sidebarDefaultCollapsed"><span class="toggle-control"></span></label>
                            </div>
                        </article>

                        <article class="settings-card settings-card-wide business-profile-card" id="settings-business-profile" data-setting-section="Business profile">
                            <div class="panel-heading">
                                <div><span class="section-label">AI grounding</span><h3>Business profile</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-building" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">This profile is stored with your authenticated business and is available to OrexisAI workflows and agent tools. Keep factual business details here; sales, customer, and inventory metrics still come from imported records.</p>
                            <div class="business-profile-status" id="businessProfileStatus" role="status" aria-live="polite" data-state="neutral">Loading your saved business profile…</div>
                            <div class="form-grid settings-form-grid business-profile-grid">
                                <label class="setting-control" data-setting-item data-setting-title="Business name" data-setting-category="Business profile" data-setting-description="The legal or trading name OrexisAI should use.">
                                    <span>Business name</span>
                                    <input id="businessProfileName" data-business-profile-field type="text" maxlength="160" autocomplete="organization" placeholder="Nova Clothing">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Business type" data-setting-category="Business profile" data-setting-description="Describe how the business operates, such as ecommerce, retail, SaaS, or services.">
                                    <span>Business type</span>
                                    <input id="businessProfileType" data-business-profile-field type="text" maxlength="160" placeholder="E-commerce">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Industry" data-setting-category="Business profile" data-setting-description="Your primary industry or category.">
                                    <span>Industry</span>
                                    <input id="businessProfileIndustry" data-business-profile-field type="text" maxlength="160" placeholder="Fashion and apparel">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Website" data-setting-category="Business profile" data-setting-description="Public website that live workflows may use as a business source.">
                                    <span>Website</span>
                                    <input id="businessProfileWebsite" data-business-profile-field type="url" maxlength="2048" placeholder="https://example.com" autocomplete="url">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Currency" data-setting-category="Business profile" data-setting-description="The currency used for imported business monetary values.">
                                    <span>Currency</span>
                                    <select id="businessProfileCurrency" data-business-profile-field>
                                        <option value="INR">INR — Indian Rupee</option>
                                        <option value="USD">USD — US Dollar</option>
                                        <option value="EUR">EUR — Euro</option>
                                        <option value="GBP">GBP — Pound Sterling</option>
                                        <option value="SGD">SGD — Singapore Dollar</option>
                                        <option value="AED">AED — UAE Dirham</option>
                                        <option value="JPY">JPY — Japanese Yen</option>
                                    </select>
                                    <small>Changing this does not convert historical imported amounts.</small>
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Business timezone" data-setting-category="Business profile" data-setting-description="Timezone used to interpret business periods and schedules.">
                                    <span>Business timezone</span>
                                    <select id="businessProfileTimezone" data-business-profile-field>
                                        <option value="Asia/Kolkata">Asia/Kolkata</option>
                                        <option value="UTC">UTC</option>
                                        <option value="America/New_York">America/New_York</option>
                                        <option value="America/Los_Angeles">America/Los_Angeles</option>
                                        <option value="Europe/London">Europe/London</option>
                                        <option value="Asia/Singapore">Asia/Singapore</option>
                                        <option value="Asia/Dubai">Asia/Dubai</option>
                                    </select>
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Business city" data-setting-category="Business profile" data-setting-description="Primary city served by the business.">
                                    <span>City</span>
                                    <input id="businessProfileCity" data-business-profile-field type="text" maxlength="160" placeholder="Chennai">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Business region" data-setting-category="Business profile" data-setting-description="State, province, or region where the business operates.">
                                    <span>State / region</span>
                                    <input id="businessProfileRegion" data-business-profile-field type="text" maxlength="160" placeholder="Tamil Nadu">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Business country" data-setting-category="Business profile" data-setting-description="Country name used as business context.">
                                    <span>Country</span>
                                    <input id="businessProfileCountry" data-business-profile-field type="text" maxlength="160" placeholder="India">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Country code" data-setting-category="Business profile" data-setting-description="Two-letter ISO country code used by live data connectors.">
                                    <span>Country code</span>
                                    <input id="businessProfileCountryCode" data-business-profile-field type="text" maxlength="2" autocapitalize="characters" placeholder="IN">
                                </label>
                                <label class="setting-control business-profile-span-2" data-setting-item data-setting-title="Products and services" data-setting-category="Business profile" data-setting-description="Products or services the business actually sells.">
                                    <span>Products / services</span>
                                    <textarea id="businessProfileProducts" data-business-profile-field rows="3" maxlength="10000" placeholder="Premium hoodies&#10;T-shirts&#10;Streetwear"></textarea>
                                    <small>One item per line or separated by commas.</small>
                                </label>
                                <label class="setting-control business-profile-span-2" data-setting-item data-setting-title="Target audience" data-setting-category="Business profile" data-setting-description="Describe the customers you are trying to reach.">
                                    <span>Target audience</span>
                                    <textarea id="businessProfileAudience" data-business-profile-field rows="3" maxlength="10000" placeholder="College students and young professionals aged 18–30"></textarea>
                                </label>
                                <label class="setting-control business-profile-span-2" data-setting-item data-setting-title="Brand voice" data-setting-category="Business profile" data-setting-description="How generated content should sound while staying factual.">
                                    <span>Brand voice</span>
                                    <textarea id="businessProfileBrandVoice" data-business-profile-field rows="3" maxlength="5000" placeholder="Youthful, confident, modern and concise"></textarea>
                                </label>
                                <label class="setting-control business-profile-span-2" data-setting-item data-setting-title="Marketing goals" data-setting-category="Business profile" data-setting-description="Goals OrexisAI should consider when prioritizing recommendations.">
                                    <span>Marketing goals</span>
                                    <textarea id="businessProfileGoals" data-business-profile-field rows="3" maxlength="10000" placeholder="Increase monthly revenue&#10;Improve repeat purchases&#10;Grow Instagram sales"></textarea>
                                    <small>One goal per line.</small>
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Instagram" data-setting-category="Business profile" data-setting-description="Optional Instagram profile URL.">
                                    <span>Instagram</span>
                                    <input id="businessProfileInstagram" data-business-profile-field type="url" maxlength="2048" placeholder="https://instagram.com/yourbrand">
                                </label>
                                <label class="setting-control" data-setting-item data-setting-title="Facebook" data-setting-category="Business profile" data-setting-description="Optional Facebook page URL.">
                                    <span>Facebook</span>
                                    <input id="businessProfileFacebook" data-business-profile-field type="url" maxlength="2048" placeholder="https://facebook.com/yourbrand">
                                </label>
                                <label class="setting-control business-profile-span-2" data-setting-item data-setting-title="LinkedIn" data-setting-category="Business profile" data-setting-description="Optional LinkedIn company page URL.">
                                    <span>LinkedIn</span>
                                    <input id="businessProfileLinkedin" data-business-profile-field type="url" maxlength="2048" placeholder="https://linkedin.com/company/yourbrand">
                                </label>
                            </div>
                            <div class="business-profile-actions">
                                <button class="primary-action" id="businessProfileSaveButton" type="button"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save business profile</button>
                                <button class="secondary-action" id="businessProfileReloadButton" type="button"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Reload saved profile</button>
                            </div>
                        </article>

                        <article class="settings-card" id="settings-workflow-controls" data-setting-section="Workflow controls">
                            <div class="panel-heading">
                                <div><span class="section-label">Automation</span><h3>Workflow controls</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-sliders" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">Control how much autonomy OrexisAI has when completing work.</p>
                            <div class="preference-list">
                                <label class="toggle-row" id="setting-review" data-setting-item data-setting-title="Review before publishing" data-setting-category="Workflow controls" data-setting-description="Keep generated marketing work in draft until you approve it."><span><strong>Require review before publishing</strong><small>Keep generated marketing work in draft until approved.</small></span><input type="checkbox" name="requireReview" checked><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-routing" data-setting-item data-setting-title="Model routing details" data-setting-category="Workflow controls" data-setting-description="Show which systems handled every workflow step."><span><strong>Show model routing details</strong><small>Display which systems handled each workflow step.</small></span><input type="checkbox" name="showRouting" checked><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-auto-run" data-setting-item data-setting-title="Automatic recurring workflows" data-setting-category="Workflow controls" data-setting-description="Allow approved recurring workflows to run on schedule."><span><strong>Allow scheduled auto-run</strong><small>Run approved recurring outcomes without another click.</small></span><input type="checkbox" name="allowAutoRun"><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-cost-guard" data-setting-item data-setting-title="Cost guardrails" data-setting-category="Workflow controls" data-setting-description="Pause workflows that may exceed your chosen usage threshold."><span><strong>Enable cost guardrails</strong><small>Pause unusually expensive workflows before they continue.</small></span><input type="checkbox" name="costGuardrails" checked><span class="toggle-control"></span></label>
                            </div>
                        </article>

                        <article class="settings-card" id="settings-notifications" data-setting-section="Notifications">
                            <div class="panel-heading">
                                <div><span class="section-label">Updates</span><h3>Notifications</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-bell" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">Choose which workflow and account updates should reach you.</p>
                            <div class="preference-list">
                                <label class="toggle-row" id="setting-email-summaries" data-setting-item data-setting-title="Email completion summaries" data-setting-category="Notifications" data-setting-description="Receive a short email summary when an outcome finishes."><span><strong>Email completion summaries</strong><small>Receive a short summary when an outcome finishes.</small></span><input type="checkbox" name="emailSummaries"><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-browser-alerts" data-setting-item data-setting-title="Browser notifications" data-setting-category="Notifications" data-setting-description="Show browser alerts for completed workflows and actions needing review."><span><strong>Browser notifications</strong><small>See completion and approval alerts while OrexisAI is open.</small></span><input type="checkbox" name="browserNotifications"><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-weekly-digest" data-setting-item data-setting-title="Weekly performance digest" data-setting-category="Notifications" data-setting-description="Receive a weekly summary of outcomes, time saved, and business signals."><span><strong>Weekly performance digest</strong><small>Get outcomes, time saved, and key business signals in one summary.</small></span><input type="checkbox" name="weeklyDigest" checked><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-failure-alerts" data-setting-item data-setting-title="Workflow failure alerts" data-setting-category="Notifications" data-setting-description="Always alert when a workflow fails or needs more information."><span><strong>Workflow failure alerts</strong><small>Always notify you when a workflow needs attention.</small></span><input type="checkbox" name="failureAlerts" checked><span class="toggle-control"></span></label>
                            </div>
                        </article>

                        <article class="settings-card" id="settings-privacy" data-setting-section="Privacy and data">
                            <div class="panel-heading">
                                <div><span class="section-label">Control</span><h3>Privacy & data</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">Choose what the dashboard remembers and uses for recommendations.</p>
                            <div class="preference-list">
                                <label class="toggle-row" id="setting-history" data-setting-item data-setting-title="Save workflow history" data-setting-category="Privacy and data" data-setting-description="Keep completed workflow history available in this browser."><span><strong>Save workflow history</strong><small>Keep completed outcomes available for future reference.</small></span><input type="checkbox" name="saveHistory" checked><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-personalization" data-setting-item data-setting-title="Personalized recommendations" data-setting-category="Privacy and data" data-setting-description="Use recent activity to rank useful workflows and suggestions."><span><strong>Personalized recommendations</strong><small>Use recent activity to prioritize useful outcomes.</small></span><input type="checkbox" name="personalizedRecommendations" checked><span class="toggle-control"></span></label>
                                <label class="toggle-row" id="setting-analytics-sharing" data-setting-item data-setting-title="Anonymous product analytics" data-setting-category="Privacy and data" data-setting-description="Share anonymous usage events to help improve the dashboard."><span><strong>Anonymous product analytics</strong><small>Share non-identifying usage events to improve OrexisAI.</small></span><input type="checkbox" name="anonymousAnalytics"><span class="toggle-control"></span></label>
                            </div>
                            <button class="danger-outline-btn" id="clearLocalDataButton" type="button"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Clear local preferences</button>
                        </article>

                        <article class="settings-card settings-card-wide inventory-data-card" id="businessDataImport" data-setting-section="Inventory data">
                            <div class="panel-heading">
                                <div><span class="section-label">Inventory foundation</span><h3>Business data import</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-database" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">Import your own products, warehouses, suppliers, stock, sales, purchase orders, promotions, weather, and online demand signals. Records are attached to your authenticated business.</p>
                            <div class="inventory-data-summary" id="inventoryDataSummary" aria-label="Inventory data coverage"></div>
                            <p class="inventory-coverage-text" id="inventoryCoverageText">Loading data coverage…</p>
                            <div class="inventory-import-grid">
                                <label class="setting-control">
                                    <span>Data type</span>
                                    <select id="inventoryDatasetType">
                                        <option value="suppliers">Suppliers</option>
                                        <option value="warehouses">Warehouses</option>
                                        <option value="products" selected>Products</option>
                                        <option value="customers">Customers</option>
                                        <option value="inventoryPositions">Warehouse inventory</option>
                                        <option value="orders">Sales orders</option>
                                        <option value="orderItems">Sales order items</option>
                                        <option value="purchaseOrders">Purchase orders</option>
                                        <option value="purchaseOrderItems">Purchase order items</option>
                                        <option value="stockMovements">Stock movements</option>
                                        <option value="promotions">Promotions</option>
                                        <option value="promotionProducts">Promotion products</option>
                                        <option value="seasonalEvents">Seasonal events</option>
                                        <option value="weatherDaily">Daily weather</option>
                                        <option value="productDailyMetrics">Product online analytics</option>
                                    </select>
                                    <small>Import references first: suppliers and warehouses → products → inventory, orders, and signals.</small>
                                </label>
                                <label class="setting-control inventory-file-control">
                                    <span>CSV file</span>
                                    <input type="file" id="inventoryCsvFile" accept=".csv,text/csv">
                                    <small>Up to 10,000 rows and 12 MB per import.</small>
                                </label>
                            </div>
                            <div class="inventory-import-actions">
                                <button class="secondary-action" type="button" id="inventoryTemplateButton"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> Download template</button>
                                <button class="primary-action" type="button" id="inventoryImportButton"><i class="fa-solid fa-file-import" aria-hidden="true"></i> Import CSV</button>
                                <button class="secondary-action" type="button" id="inventoryDataRefreshButton"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Refresh status</button>
                            </div>
                            <div class="inventory-demo-controls">
                                <div><strong>Need data to test the workflow?</strong><small>The deterministic demo creates two years of clearly marked, removable records and is blocked when real orders exist.</small></div>
                                <button class="secondary-action" type="button" id="inventoryDemoButton">Load two-year demo data</button>
                                <button class="danger-outline-btn" type="button" id="inventoryDemoRemoveButton" hidden>Remove demo data</button>
                            </div>
                            <div class="inventory-import-status" id="inventoryImportStatus" role="status" aria-live="polite" data-state="neutral">Choose a data type and download its CSV template.</div>
                        </article>

                        <article class="settings-card integrations-card settings-card-wide" id="settings-connections" data-setting-section="Connections">
                            <div class="panel-heading">
                                <div><span class="section-label">Connections</span><h3>Workflow data sources</h3></div>
                                <span class="settings-section-icon"><i class="fa-solid fa-plug" aria-hidden="true"></i></span>
                            </div>
                            <p class="settings-description">Connect the systems OrexisAI should use when completing work.</p>
                            <div class="integration-list">
                                ${renderIntegration('sales', 'fa-cash-register', 'Sales data', 'Use order history for campaigns, forecasts, and reports.')}
                                ${renderIntegration('social', 'fa-share-nodes', 'Social channels', 'Prepare and publish approved marketing content.')}
                                ${renderIntegration('crm', 'fa-address-book', 'Customer records', 'Power follow-ups, lead scoring, and retention workflows.')}
                            </div>
                        </article>
                    </div>

                    <div class="settings-save-bar">
                        <div>
                            <strong>Dashboard preferences</strong>
                            <span id="settingsStatus" role="status" aria-live="polite">Changes are previewed instantly.</span>
                        </div>
                        <div class="settings-save-actions">
                            <button class="secondary-action" id="resetSettingsButton" type="button">Reset defaults</button>
                            <button class="primary-action" type="submit">Save all settings</button>
                        </div>
                    </div>
                </form>
            </section>
        </main>
    </div>

    <div class="modal-overlay chat-history-modal" id="recentChatsModal" aria-hidden="true">
        <div class="chat-history-window" role="dialog" aria-modal="true" aria-labelledby="recentChatsTitle" tabindex="-1">
            <button type="button" class="close-modal chat-history-close" id="closeRecentChatsModal" aria-label="Close recent chats">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <div class="chat-history-window-header">
                <span class="chat-history-window-icon"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></span>
                <div>
                    <span class="section-label">AI Agent</span>
                    <h2 id="recentChatsTitle">Recent chats</h2>
                    <p>Select a saved conversation to continue where you left off.</p>
                </div>
                <span class="chat-sync-status" id="chatSyncStatus" aria-live="polite"></span>
            </div>
            <div class="chat-history-list" id="chatHistoryList" role="list" aria-label="Saved conversations">
                <div class="chat-history-loading"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>Loading chats…</span></div>
            </div>
        </div>
    </div>

    <div class="modal-overlay camera-modal" id="cameraModal" aria-hidden="true">
        <div class="camera-modal-content" role="dialog" aria-modal="true" aria-labelledby="cameraModalTitle" tabindex="-1">
            <button type="button" class="close-modal camera-modal-close" id="closeCameraModal" aria-label="Close camera">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <div class="camera-modal-heading">
                <span class="camera-modal-icon"><i class="fa-solid fa-camera" aria-hidden="true"></i></span>
                <div>
                    <span class="section-label">Device camera</span>
                    <h2 id="cameraModalTitle">Capture a photo</h2>
                    <p>Review the image before it is securely uploaded to your account.</p>
                </div>
            </div>
            <div class="camera-stage" id="cameraStage">
                <video id="cameraVideo" autoplay muted playsinline hidden></video>
                <img id="cameraPreview" alt="Captured photo preview" hidden>
                <div class="camera-placeholder" id="cameraPlaceholder">
                    <i class="fa-solid fa-camera-rotate" aria-hidden="true"></i>
                    <span>Waiting for camera permission…</span>
                </div>
            </div>
            <canvas id="cameraCanvas" hidden></canvas>
            <p class="camera-status" id="cameraStatus" role="status" aria-live="polite"></p>
            <div class="camera-actions">
                <button type="button" class="secondary-action" id="cameraFallbackButton" hidden>Use camera picker</button>
                <button type="button" class="secondary-action" id="cameraRetakeButton" hidden>
                    <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Retake
                </button>
                <button type="button" class="primary-action" id="cameraCaptureButton" disabled>
                    <i class="fa-solid fa-camera" aria-hidden="true"></i> Capture
                </button>
                <button type="button" class="primary-action" id="cameraUploadButton" hidden disabled>
                    <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Upload photo
                </button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="executionModal" aria-hidden="true">
        <div class="modal-content glass-panel" role="dialog" aria-modal="true" aria-labelledby="workflowTitle">
            <button class="close-modal" id="closeModal" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            <div class="modal-header">
                <div class="running-indicator"><div class="spinner"></div></div>
                <h2 id="workflowTitle">Running workflow...</h2>
            </div>
            <div class="workflow-live-progress" id="workflowLiveProgress" aria-live="polite">
                <div><strong id="workflowProgressText">Preparing execution…</strong><span id="workflowEtaText">Estimating completion time…</span></div>
                <progress id="workflowProgressBar" max="100" value="0">0%</progress>
                <div class="workflow-live-logs" id="workflowLiveLogs" role="log" aria-label="Workflow execution logs"></div>
            </div>
            <div class="execution-steps" id="executionSteps"></div>
            <div class="execution-result hidden" id="executionResult">
                <div class="success-icon" id="workflowResultIcon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></div>
                <h3 id="workflowResultTitle">Outcome achieved</h3>
                <p id="workflowResultDescription">Your workflow completed successfully and the finished work is ready.</p>
                <div class="workflow-result-meta" id="workflowResultMeta"></div>
                <div class="workflow-result-body" id="workflowResultBody"></div>
                <div class="workflow-result-actions">
                    <button class="secondary-action" type="button" id="workflowRunAgainBtn"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Run Again</button>
                    <button class="secondary-action" type="button" id="workflowPreviousRunsBtn"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Previous Runs</button>
                    <button class="view-result-btn" id="closeResultBtn">View workspace</button>
                </div>
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
                    <span class="eyebrow"><i class="fa-solid fa-sparkles" aria-hidden="true"></i> Upgrade OrexisAI</span>
                    <h2 id="upgradeTitle">Choose the plan that fits your workload</h2>
                    <p>Secure one-time checkout for 30 days of access. No automatic renewal is created.</p>
                </div>
                <div class="current-plan-summary">
                    <span>Current plan</span>
                    <strong data-current-plan-name>${escapeHtml(currentPlan.name)}</strong>
                    <small data-current-plan-expiry>${expiryText ? `Active until ${escapeHtml(expiryText)}` : 'No expiry'}</small>
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

    <div class="orexis-intro" id="orexisIntro" role="dialog" aria-modal="true" aria-labelledby="orexisIntroMessage" aria-hidden="true" hidden>
        <button type="button" class="orexis-intro-close" id="orexisIntroClose" aria-label="Skip OrexisAI introduction">
            <span>Skip</span>
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
        <div class="orexis-intro-particles" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
            <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="orexis-intro-stage">
            <div class="orexis-intro-orb" aria-hidden="true">
                <span class="orexis-intro-halo orexis-intro-halo-one"></span>
                <span class="orexis-intro-halo orexis-intro-halo-two"></span>
                <span class="orexis-intro-ring orexis-intro-ring-one"></span>
                <span class="orexis-intro-ring orexis-intro-ring-two"></span>
                <span class="orexis-intro-ring orexis-intro-ring-three"></span>
                <span class="orexis-intro-orbit orexis-intro-orbit-one"><i></i></span>
                <span class="orexis-intro-orbit orexis-intro-orbit-two"><i></i></span>
                <span class="orexis-intro-core"><b>O</b></span>
            </div>
            <p class="orexis-intro-message" id="orexisIntroMessage" aria-live="polite"></p>
            <span class="orexis-intro-caption">AI workflows · real business outcomes</span>
        </div>
    </div>

    <script src="/hyperspeed.js" nonce="${escapeHtml(cspNonce)}" defer></script>
    <script src="/orb.js" nonce="${escapeHtml(cspNonce)}" defer></script>
    <script src="/marketing-hooks.js" nonce="${escapeHtml(cspNonce)}" defer></script>
    <script src="/marketing-components.js" nonce="${escapeHtml(cspNonce)}" defer></script>
    <script src="/marketing-workspace.js" nonce="${escapeHtml(cspNonce)}" defer></script>
    <script src="/analytics-workspace.js" nonce="${escapeHtml(cspNonce)}" defer></script>
    <script src="/inventory-data.js" nonce="${escapeHtml(cspNonce)}" defer></script>
    <script src="/app.js" nonce="${escapeHtml(cspNonce)}" defer></script>
</body>
</html>`;
}

function renderLoginBrandIntro() {
    return `<div class="login-brand-intro" id="loginBrandIntro" role="status" aria-label="Welcome to OrexisAI">
        <div class="login-brand-glow" aria-hidden="true"></div>
        <div class="login-brand-stage">
            <div class="outcome-brand-lockup login-brand-lockup" aria-hidden="true">
                <span class="outcome-brand-o">O</span>
                <span class="outcome-brand-word-mask">
                    <span class="outcome-brand-word">rexis<span class="outcome-brand-ai">AI</span></span>
                </span>
            </div>
            <span class="login-brand-tagline">AI workflows. Real business outcomes.</span>
        </div>
        <button class="login-brand-skip" id="loginBrandSkip" type="button" aria-label="Skip logo animation">Skip</button>
    </div>`;
}

function renderWorkflowCard({ icon, gradient, title, description, time, workflow, search, configureCompetitors = false }) {
    const configureButton = configureCompetitors
        ? '<button class="workflow-config-btn" type="button" data-competitor-setup aria-label="Configure competitor sources" title="Configure competitor sources"><i class="fa-solid fa-gear" aria-hidden="true"></i></button>'
        : '';
    return `<article class="workflow-card searchable-item" data-search-text="${escapeHtml(search)}">
        <div class="card-icon ${escapeHtml(gradient)}"><i class="fa-solid ${escapeHtml(icon)}" aria-hidden="true"></i></div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
        <div class="card-footer">
            <span class="time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(time)}</span>
            <span class="workflow-card-actions">${configureButton}<button class="run-btn" type="button" data-workflow="${escapeHtml(workflow)}">Run Now <i class="fa-solid fa-play" aria-hidden="true"></i></button></span>
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
    return `<div class="integration-row" id="setting-integration-${escapeHtml(id)}" data-integration-row="${escapeHtml(id)}" data-setting-item data-setting-title="${escapeHtml(name)} connection" data-setting-category="Connections" data-setting-description="${escapeHtml(description)}">
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
        <div class="razorpay-price">${escapeHtml(inr)} INR${isFree ? '' : ' with Razorpay'}</div>
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
    renderLoginBrandIntro,
    renderPlanCard,
    renderWorkflowCard
};
