'use strict';

(() => {
    const root = document.getElementById('enterpriseAnalyticsRoot');
    const form = document.getElementById('analyticsDateForm');
    if (!root || !form) return;

    const elements = {
        from: document.getElementById('analyticsFromDate'),
        to: document.getElementById('analyticsToDate'),
        compare: document.getElementById('analyticsComparePeriod'),
        channel: document.getElementById('analyticsChannelFilter'),
        location: document.getElementById('analyticsLocationFilter'),
        businessHours: document.getElementById('analyticsBusinessHours'),
        refresh: document.getElementById('analyticsRefreshButton'),
        liveToggle: document.getElementById('analyticsLiveToggle'),
        liveStatus: document.getElementById('analyticsLiveStatus'),
        toast: document.getElementById('analyticsToastRegion'),
        drilldown: document.getElementById('analyticsDrilldown'),
        drilldownTitle: document.getElementById('analyticsDrilldownTitle'),
        drilldownContent: document.getElementById('analyticsDrilldownContent')
    };

    const state = {
        dashboard: null,
        controller: null,
        polling: true,
        pollTimer: null,
        eventSource: null,
        loaded: false,
        loading: false,
        lastRequestAt: 0,
        activePreset: '30'
    };

    initializeDates();
    bindEvents();
    connectRealtime();
    loadDashboard({ refresh: false });

    function bindEvents() {
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            state.activePreset = '';
            markPreset();
            loadDashboard({ refresh: true });
        });
        elements.refresh?.addEventListener('click', () => loadDashboard({ refresh: true }));
        elements.liveToggle?.addEventListener('click', () => {
            state.polling = !state.polling;
            elements.liveToggle.setAttribute('aria-pressed', String(state.polling));
            elements.liveToggle.classList.toggle('paused', !state.polling);
            elements.liveToggle.lastChild.textContent = state.polling ? ' Live' : ' Paused';
            schedulePoll();
            updateLiveStatus(state.polling ? 'Live refresh enabled' : 'Live refresh paused', state.polling ? 'live' : 'paused');
        });
        form.querySelectorAll('[data-analytics-preset]').forEach((button) => {
            button.addEventListener('click', () => {
                state.activePreset = button.dataset.analyticsPreset || '30';
                applyPreset(state.activePreset);
                markPreset();
                loadDashboard({ refresh: true });
            });
        });
        root.addEventListener('click', handleDashboardClick);
        elements.drilldown?.addEventListener('click', (event) => {
            if (event.target.closest('[data-close-analytics-drilldown]')) closeDrilldown();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !elements.drilldown?.hidden) closeDrilldown();
        });
        document.addEventListener('outcomeai:view-changed', (event) => {
            if (event.detail?.view === 'analytics' && (!state.loaded || Date.now() - state.lastRequestAt > 30_000)) {
                loadDashboard({ refresh: false });
            }
            schedulePoll();
        });
        document.addEventListener('orexisai:business-data-refresh', () => loadDashboard({ refresh: true }));
        document.addEventListener('visibilitychange', schedulePoll);
        window.addEventListener('beforeunload', disconnectRealtime, { once: true });
    }

    async function handleDashboardClick(event) {
        const metricButton = event.target.closest('[data-analytics-metric]');
        if (metricButton) return openMetricDetails(metricButton.dataset.analyticsMetric);

        const chartPoint = event.target.closest('[data-chart-point]');
        if (chartPoint) return openChartPoint(chartPoint.dataset.chartPoint);

        const workflowButton = event.target.closest('[data-analytics-workflow]');
        if (workflowButton) return runWorkflow(workflowButton.dataset.analyticsWorkflow);

        const setupButton = event.target.closest('[data-analytics-action]');
        if (setupButton) return handleSetupAction(setupButton.dataset.analyticsAction);

        const exportButton = event.target.closest('[data-analytics-export]');
        if (exportButton) return exportReport(exportButton.dataset.analyticsExport);

        if (event.target.closest('[data-analytics-print]')) return window.print();
        if (event.target.closest('[data-analytics-email]')) return emailReport(event.target.closest('[data-analytics-email]'));
        if (event.target.closest('[data-load-analytics-demo]')) return loadDemoData(event.target.closest('[data-load-analytics-demo]'));
        if (event.target.closest('[data-remove-analytics-demo]')) return removeDemoData(event.target.closest('[data-remove-analytics-demo]'));
        if (event.target.closest('[data-schedule-report]')) return scheduleReport(event.target.closest('[data-schedule-report]').dataset.scheduleReport);

        const expandable = event.target.closest('[data-expand-card]');
        if (expandable) {
            const card = expandable.closest('.enterprise-panel');
            card?.classList.toggle('expanded');
            expandable.setAttribute('aria-expanded', String(card?.classList.contains('expanded')));
        }
    }

    async function loadDashboard({ refresh }) {
        if (state.loading && !refresh) return;
        state.controller?.abort();
        const controller = new AbortController();
        state.controller = controller;
        state.loading = true;
        state.lastRequestAt = Date.now();
        setLoading(true);
        updateLiveStatus(refresh ? 'Refreshing authenticated business data…' : 'Loading authenticated business data…', 'loading');
        try {
            const response = await fetch(`/api/analytics/workspace?${buildQuery({ refresh }).toString()}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal
            });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'Analytics could not be loaded.');
            state.dashboard = payload.dashboard;
            state.loaded = true;
            renderDashboard(payload.dashboard);
            syncFilterOptions(payload.dashboard?.filters || {});
            updateLiveStatus(buildLiveLabel(payload.dashboard), 'live');
        } catch (error) {
            if (error.name !== 'AbortError') {
                renderError(error.message);
                updateLiveStatus(error.message, 'error');
            }
        } finally {
            if (state.controller === controller) state.controller = null;
            state.loading = false;
            setLoading(false);
            schedulePoll();
        }
    }

    function renderDashboard(dashboard) {
        const metrics = dashboard?.executive?.metrics || [];
        const hasOrders = Number(metricByKey('orders', dashboard)?.value || 0) > 0;
        root.innerHTML = `
            ${renderExecutive(dashboard)}
            ${hasOrders ? renderMetricGrid(metrics, dashboard) : renderPrimaryEmptyState(dashboard)}
            <div class="enterprise-layout enterprise-layout-revenue">
                ${renderRevenuePanel(dashboard)}
                ${renderHealthPanel(dashboard)}
            </div>
            <div class="enterprise-layout enterprise-layout-three">
                ${renderFunnelPanel(dashboard)}
                ${renderCustomerPanel(dashboard)}
                ${renderRefundPanel(dashboard)}
            </div>
            <div class="enterprise-layout enterprise-layout-products">
                ${renderProductsPanel(dashboard)}
                ${renderInventoryPanel(dashboard)}
            </div>
            <div class="enterprise-layout enterprise-layout-three">
                ${renderHeatmapPanel(dashboard)}
                ${renderAttributionPanel(dashboard)}
                ${renderGeographyPanel(dashboard)}
            </div>
            <div class="enterprise-layout enterprise-layout-two">
                ${renderCashFlowPanel(dashboard)}
                ${renderCohortPanel(dashboard)}
            </div>
            ${renderDecisionEngine(dashboard)}
            ${renderWorkflowCenter(dashboard)}
            <div class="enterprise-layout enterprise-layout-three">
                ${renderSummaryPanel(dashboard?.summaries?.weekly, 'fa-calendar-week')}
                ${renderSummaryPanel(dashboard?.summaries?.monthly, 'fa-calendar-days')}
                ${renderExportCenter(dashboard)}
            </div>
            ${renderDataQuality(dashboard)}
        `;
        requestAnimationFrame(() => {
            root.querySelectorAll('.enterprise-animate-in').forEach((element, index) => {
                element.style.setProperty('--enterprise-delay', `${Math.min(index * 32, 420)}ms`);
                element.classList.add('visible');
            });
            animateCounters(dashboard);
        });
    }

    function renderExecutive(dashboard) {
        const health = dashboard?.businessHealth || {};
        const period = dashboard?.period?.label || 'Selected period';
        const highPriority = (dashboard?.decisionEngine?.recommendations || []).filter((item) => item.priority === 'high').length;
        return `<section class="enterprise-executive enterprise-animate-in searchable-item" data-search-text="executive summary business health revenue orders recommendations">
            <div class="enterprise-executive-copy">
                <div class="enterprise-live-pill"><span></span> Live business intelligence</div>
                <span class="section-label">Executive summary · ${escapeHtml(period)}</span>
                <h2>${escapeHtml(dashboard?.executive?.headline || 'Your business intelligence workspace')}</h2>
                <p>${escapeHtml(dashboard?.executive?.summary || 'Connect business records to generate a trustworthy operating summary.')}</p>
                <div class="enterprise-executive-meta">
                    <span><i class="fa-solid fa-database"></i> ${formatNumber(dashboard?.live?.recordsAnalyzed || 0)} records analyzed</span>
                    <span><i class="fa-solid fa-shield-halved"></i> ${formatNumber(dashboard?.dataQuality?.score || 0)}% data confidence</span>
                    <span><i class="fa-solid fa-bolt"></i> ${highPriority} high-priority action${highPriority === 1 ? '' : 's'}</span>
                </div>
            </div>
            <div class="enterprise-health-orbit ${escapeHtml(health.status || 'setup')}" style="--health-score:${Number(health.score || 0)}">
                <svg viewBox="0 0 120 120" aria-label="Business health score ${health.score ?? 'not available'}">
                    <circle class="health-track" cx="60" cy="60" r="50"></circle>
                    <circle class="health-progress" cx="60" cy="60" r="50"></circle>
                </svg>
                <div><strong>${health.score ?? '—'}</strong><span>Business health</span><small>${escapeHtml(health.status || 'Setup required')}</small></div>
            </div>
        </section>`;
    }

    function renderMetricGrid(metrics, dashboard) {
        return `<section class="enterprise-kpi-grid" aria-label="Executive business metrics">${metrics.map((metric) => renderMetricCard(metric, dashboard)).join('')}</section>`;
    }

    function renderMetricCard(metric, dashboard) {
        const trend = metric.changePercentage;
        const trendClass = trend === null || trend === undefined ? 'neutral' : trend > 0 ? 'positive' : trend < 0 ? 'negative' : 'neutral';
        const trendText = trend === null || trend === undefined ? 'Comparison unavailable' : `${trend > 0 ? '▲' : trend < 0 ? '▼' : '•'} ${Math.abs(Number(trend)).toFixed(1)}%`;
        return `<article class="enterprise-kpi-card enterprise-animate-in searchable-item" data-search-text="${escapeHtml(`${metric.label} ${metric.insight} ${metric.suggestedAction}`)}">
            <button class="enterprise-card-open" type="button" data-analytics-metric="${escapeHtml(metric.key)}" aria-label="Open ${escapeHtml(metric.label)} details"></button>
            <header><span>${escapeHtml(metric.label)}</span><i class="fa-solid ${iconForMetric(metric.key)}"></i></header>
            <strong class="enterprise-counter" data-counter-key="${escapeHtml(metric.key)}">${formatMetric(metric, dashboard?.business?.currency)}</strong>
            <div class="enterprise-kpi-trend ${trendClass}"><b>${escapeHtml(trendText)}</b><span>${metric.previousValue === null || metric.previousValue === undefined ? escapeHtml(metric.source || '') : `vs ${formatMetric({ ...metric, value: metric.previousValue }, dashboard?.business?.currency)}`}</span></div>
            ${sparkline(metric.sparkline || [], trendClass)}
            <div class="enterprise-confidence"><span><i style="width:${Number(metric.confidence || 0)}%"></i></span><small>${Number(metric.confidence || 0)}% confidence</small></div>
            <p><b>AI insight</b>${escapeHtml(metric.insight || 'Waiting for connected records.')}</p>
            <footer><span>${escapeHtml(metric.suggestedAction || 'Continue monitoring this metric.')}</span><i class="fa-solid fa-arrow-up-right-from-square"></i></footer>
        </article>`;
    }

    function renderPrimaryEmptyState(dashboard) {
        const canDemo = dashboard?.onboarding?.canLoadDemo;
        return `<section class="enterprise-primary-empty enterprise-animate-in">
            <div class="enterprise-empty-visual"><i class="fa-solid fa-chart-line"></i><span></span><span></span><span></span></div>
            <div><span class="section-label">Start with trusted data</span><h3>No orders yet</h3><p>Connect or import your store to begin tracking revenue, orders, customers, product performance, and forecasts. Nothing on this page is fabricated.</p>
            <div class="enterprise-empty-actions"><button type="button" class="primary-action" data-analytics-action="import-data"><i class="fa-solid fa-plug"></i> Connect business data</button>${canDemo ? '<button type="button" class="secondary-action" data-load-analytics-demo><i class="fa-solid fa-flask"></i> Load realistic demo dataset</button>' : ''}</div></div>
        </section>`;
    }

    function renderRevenuePanel(dashboard) {
        const daily = dashboard?.revenue?.daily || [];
        const forecast = dashboard?.revenue?.forecast || {};
        return panel('Revenue timeline', 'Revenue Overview', 'fa-chart-area', daily.length
            ? `<div class="enterprise-chart-toolbar"><span>${formatMoney(dashboard?.revenue?.totals?.revenueMinor || 0, dashboard?.business?.currency)}</span><small>${forecast.available ? `${forecast.confidence ?? 0}% forecast confidence` : 'Forecast requires more history'}</small></div>${lineChart(daily, forecast.points || [], dashboard?.business?.currency)}${renderAnomalies(dashboard?.anomalies || [], dashboard)}`
            : intelligentEmpty('No revenue history yet', 'Connect orders to unlock a daily revenue timeline, period comparisons, anomaly detection, and forecasting.', 'import-data'), 'enterprise-panel-wide revenue-panel');
    }

    function renderHealthPanel(dashboard) {
        const signals = dashboard?.businessHealth?.signals || [];
        return panel('Operating health', 'Business Health Score', 'fa-heart-pulse', `<div class="health-signal-list">${signals.map((signal) => `<div><span><b>${escapeHtml(signal.label)}</b><small>${escapeHtml(signal.explanation)}</small></span><strong class="${statusClass(signal.status)}">${escapeHtml(signal.status)}</strong><i><em style="width:${Number(signal.score || 0)}%"></em></i></div>`).join('')}</div>`, 'health-panel');
    }

    function renderFunnelPanel(dashboard) {
        const funnel = dashboard?.funnel || {};
        if (!funnel.available) return panel('Conversion', 'Sales Funnel', 'fa-filter-circle-dollar', intelligentEmpty('Conversion funnel is waiting for traffic data', 'Connect website traffic to measure sessions, product views, carts, checkout starts, purchases, and stage-by-stage loss.', 'open-settings'));
        const stages = [
            ['Sessions', funnel.sessions], ['Product views', funnel.productViews], ['Add to carts', funnel.addToCarts], ['Checkout starts', funnel.checkoutStarts], ['Purchases', funnel.purchases]
        ];
        const maximum = Math.max(1, Number(stages[0][1] || 0));
        return panel('Conversion', 'Sales Funnel', 'fa-filter-circle-dollar', `<div class="enterprise-funnel">${stages.map(([label, value], index) => `<div style="--funnel-width:${Math.max(18, Number(value || 0) / maximum * 100)}%"><span>${escapeHtml(label)}</span><strong>${formatNumber(value || 0)}</strong>${index ? `<small>${percentageText(value, stages[index - 1][1])} retained</small>` : '<small>100% entry</small>'}</div>`).join('')}</div>`);
    }

    function renderCustomerPanel(dashboard) {
        const customers = dashboard?.customers || {};
        const timeline = customers.timeline || [];
        if (!timeline.length && !customers.purchasingCustomers) return panel('Customers', 'Growth & Retention', 'fa-users', intelligentEmpty('Your first customer unlocks customer analytics', 'Customer-linked orders enable growth, retention, repeat purchase rate, lifetime value, cohorts, and churn risk.', 'open-settings'));
        return panel('Customers', 'Growth & Retention', 'fa-users', `<div class="enterprise-stat-pair"><span><small>Retention</small><strong>${nullablePercent(customers.retentionRatePercentage)}</strong></span><span><small>Repeat buyers</small><strong>${formatNumber(customers.repeatCustomers || 0)}</strong></span><span><small>Churn risk</small><strong>${formatNumber(customers.churnRiskCustomers || 0)}</strong></span></div>${dualMiniChart(timeline)}<div class="enterprise-segments">${(customers.segments || []).slice(0, 5).map((segment) => `<span><b>${escapeHtml(segment.segment || segment.name || 'Segment')}</b><small>${formatNumber(segment.customers || segment.count || 0)} customers</small></span>`).join('')}</div>`);
    }

    function renderRefundPanel(dashboard) {
        const refunds = dashboard?.refunds || {};
        return panel('Quality signal', 'Refund Analytics', 'fa-arrow-rotate-left', refunds.orders
            ? `<div class="enterprise-refund-gauge" style="--refund-rate:${Math.min(100, Number(refunds.ratePercentage || 0) * 5)}"><div><strong>${nullablePercent(refunds.ratePercentage)}</strong><span>of gross revenue</span></div></div><div class="enterprise-stat-pair"><span><small>Refunded orders</small><strong>${formatNumber(refunds.refundedOrders || 0)}</strong></span><span><small>Refunded value</small><strong>${formatMoney(refunds.refundedAmountMinor || 0, dashboard?.business?.currency)}</strong></span></div><p class="enterprise-panel-note">${Number(refunds.ratePercentage || 0) > 5 ? 'Refund value is elevated. Review product quality, expectations, and acquisition channels.' : 'Refund value is within the current monitoring threshold.'}</p>`
            : intelligentEmpty('Refund analytics appear after orders arrive', 'Refund rate and refunded value are calculated directly from order records.', 'import-data'));
    }

    function renderProductsPanel(dashboard) {
        const top = dashboard?.products?.top || [];
        const worst = dashboard?.products?.worst || [];
        if (!top.length) return panel('Merchandising', 'Product Performance', 'fa-boxes-stacked', intelligentEmpty('Product performance needs order items', 'Connect order items and products to identify best sellers, weak products, category contribution, and profit.', 'open-settings'), 'enterprise-panel-wide');
        const maximum = Math.max(1, ...top.map((row) => Number(row.revenueMinor || 0)));
        return panel('Merchandising', 'Product Performance', 'fa-boxes-stacked', `<div class="enterprise-tabs" role="tablist"><button type="button" class="active">Top performers</button><span>${worst.length} products need review</span></div><div class="enterprise-product-list">${top.slice(0, 8).map((product, index) => `<button type="button" data-analytics-metric="product:${product.productId}"><i>${index + 1}</i><span><b>${escapeHtml(product.productName)}</b><small>${escapeHtml(product.category || 'Uncategorized')} · ${formatNumber(product.unitsSold || 0)} units</small></span><em><strong>${formatMoney(product.revenueMinor || 0, dashboard?.business?.currency)}</strong><small class="${Number(product.revenueChangePercentage || 0) >= 0 ? 'positive' : 'negative'}">${signedPercent(product.revenueChangePercentage)}</small></em><u><s style="width:${Number(product.revenueMinor || 0) / maximum * 100}%"></s></u></button>`).join('')}</div>${categoryTreemap(dashboard?.products?.categories || [], dashboard)}`, 'enterprise-panel-wide products-panel');
    }

    function renderInventoryPanel(dashboard) {
        const inventory = dashboard?.inventory || {};
        if (!inventory.knownProducts) return panel('Operations', 'Inventory Health', 'fa-box-open', intelligentEmpty('Inventory is not connected', 'Import current stock, lead time, and product cost to unlock velocity, stockout risk, reorder quantity, and supplier impact.', 'open-settings'));
        return panel('Operations', 'Inventory Health', 'fa-box-open', `<div class="inventory-health-summary"><div><strong>${formatNumber(inventory.atRiskCount || 0)}</strong><span>products at risk</span></div><div><strong>${nullablePercent(inventory.healthyPercentage)}</strong><span>healthy inventory</span></div></div><div class="inventory-risk-list">${(inventory.risks || []).slice(0, 8).map((item) => `<button type="button" data-analytics-metric="inventory:${item.productId}"><span class="risk-dot ${escapeHtml(item.stockRisk)}"></span><span><b>${escapeHtml(item.productName)}</b><small>${item.daysOfCover === null || item.daysOfCover === undefined ? 'Days of cover unavailable' : `${Number(item.daysOfCover).toFixed(1)} days cover`} · ${formatNumber(item.currentStock ?? 0)} in stock</small></span><em>${item.recommendedReorderQuantity === null || item.recommendedReorderQuantity === undefined ? 'Review' : `Reorder ${formatNumber(item.recommendedReorderQuantity)}`}</em></button>`).join('') || '<div class="enterprise-success-state"><i class="fa-solid fa-circle-check"></i><span><b>No immediate stock risk detected</b><small>All products with known inventory exceed calculated risk thresholds.</small></span></div>'}</div><button class="secondary-action enterprise-inline-action" type="button" data-analytics-workflow="inventory-predictor">Run inventory workflow <i class="fa-solid fa-arrow-right"></i></button>`, 'inventory-panel');
    }

    function renderHeatmapPanel(dashboard) {
        const heatmap = dashboard?.heatmap || {};
        if (!(heatmap.cells || []).length) return panel('Timing', 'Sales Heatmap', 'fa-calendar-days', intelligentEmpty('Hourly sales patterns need order timestamps', 'Orders with timestamps reveal the strongest weekdays and hours for promotions, support, and inventory operations.', 'import-data'));
        const byKey = new Map(heatmap.cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
        const hours = [0, 3, 6, 9, 12, 15, 18, 21];
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return panel('Timing', 'Sales Heatmap', 'fa-calendar-days', `<div class="enterprise-heatmap"><div></div>${hours.map((hour) => `<b>${String(hour).padStart(2, '0')}</b>`).join('')}${days.map((day, weekday) => `<span>${day}</span>${hours.map((hour) => { const cells = [0, 1, 2].map((delta) => byKey.get(`${weekday}:${hour + delta}`)).filter(Boolean); const orders = cells.reduce((sum, cell) => sum + Number(cell.orders || 0), 0); const intensity = Math.min(1, orders / Math.max(1, heatmap.maximumOrders * 2.1)); return `<i style="--heat:${intensity}" title="${day} ${hour}:00 · ${orders} orders"></i>`; }).join('')}`).join('')}</div>`);
    }

    function renderAttributionPanel(dashboard) {
        const attribution = dashboard?.attribution || {};
        const channels = attribution.channels || [];
        if (!channels.length && !attribution.hasTraffic && !attribution.hasCampaigns) return panel('Marketing', 'Attribution & Campaigns', 'fa-bullseye', intelligentEmpty('Campaign metrics appear after connecting Meta or Google Ads', 'Traffic sources, spend, attributed revenue, CAC, ROI, and ROAS require campaign and traffic integrations.', 'open-settings'));
        const total = Math.max(1, channels.reduce((sum, row) => sum + Number(row.revenueMinor || 0), 0));
        return panel('Marketing', 'Attribution & Campaigns', 'fa-bullseye', `<div class="enterprise-channel-list">${channels.slice(0, 7).map((channel, index) => `<div><i style="--channel-index:${index}"></i><span><b>${escapeHtml(channel.channel)}</b><small>${formatNumber(channel.orders)} orders · ${percentageText(channel.revenueMinor, total)} share</small></span><strong>${formatMoney(channel.revenueMinor, dashboard?.business?.currency)}</strong></div>`).join('')}</div><div class="enterprise-campaign-table">${(attribution.campaigns || []).slice(0, 5).map((campaign) => `<div><span><b>${escapeHtml(campaign.campaignName)}</b><small>${escapeHtml(campaign.sourceName || 'Campaign')}</small></span><em>${campaign.roas === null || campaign.roas === undefined ? 'ROAS unavailable' : `${Number(campaign.roas).toFixed(2)}× ROAS`}</em></div>`).join('')}</div>`);
    }

    function renderGeographyPanel(dashboard) {
        const rows = dashboard?.geography || [];
        if (!rows.length) return panel('Markets', 'Regional Sales', 'fa-earth-americas', intelligentEmpty('Regional sales are waiting for shipping locations', 'Shipping country codes on orders unlock geographic demand and regional revenue concentration.', 'open-settings'));
        const max = Math.max(1, ...rows.map((row) => Number(row.revenueMinor || 0)));
        return panel('Markets', 'Regional Sales', 'fa-earth-americas', `<div class="enterprise-geo-list">${rows.slice(0, 8).map((row) => `<div><span class="geo-code">${escapeHtml(row.countryCode || '—')}</span><span><b>${formatMoney(row.revenueMinor, dashboard?.business?.currency)}</b><small>${formatNumber(row.orders)} orders · ${formatNumber(row.customers)} customers</small></span><i><em style="width:${Number(row.revenueMinor || 0) / max * 100}%"></em></i></div>`).join('')}</div>`);
    }

    function renderCashFlowPanel(dashboard) {
        const cash = dashboard?.cashFlow || {};
        if (!(cash.daily || []).length) return panel('Finance', 'Cash Flow Overview', 'fa-money-bill-trend-up', intelligentEmpty('Cash flow appears after revenue is recorded', 'Net revenue, refunds, campaign spend, and estimated profit are combined into a daily operating view.', 'import-data'), 'enterprise-panel-wide');
        return panel('Finance', 'Cash Flow Overview', 'fa-money-bill-trend-up', `<div class="enterprise-stat-pair enterprise-stat-four"><span><small>Net revenue</small><strong>${formatMoney(cash.netRevenueMinor || 0, dashboard?.business?.currency)}</strong></span><span><small>Refunds</small><strong>${formatMoney(cash.refundsMinor || 0, dashboard?.business?.currency)}</strong></span><span><small>Campaign spend</small><strong>${formatMoney(cash.campaignSpendMinor || 0, dashboard?.business?.currency)}</strong></span><span><small>Estimated profit</small><strong>${cash.estimatedProfitMinor === null || cash.estimatedProfitMinor === undefined ? 'Add costs' : formatMoney(cash.estimatedProfitMinor, dashboard?.business?.currency)}</strong></span></div>${cashFlowChart(cash.daily || [], dashboard?.business?.currency)}`, 'enterprise-panel-wide');
    }

    function renderCohortPanel(dashboard) {
        const cohorts = dashboard?.customers?.cohorts || [];
        if (!cohorts.length) return panel('Retention', 'Customer Cohorts', 'fa-layer-group', intelligentEmpty('Cohorts need repeat purchase history', 'Customer-linked orders across multiple months reveal retention by acquisition cohort.', 'open-settings'));
        return panel('Retention', 'Customer Cohorts', 'fa-layer-group', `<div class="enterprise-cohort"><div class="cohort-head"><span>Cohort</span>${[0, 1, 2, 3, 4, 5].map((month) => `<b>M${month}</b>`).join('')}</div>${cohorts.slice(-8).reverse().map((row) => `<div><span>${escapeHtml(row.cohort)}</span>${[0, 1, 2, 3, 4, 5].map((month) => { const value = Number(row[`month${month}`] || 0); const rate = month === 0 ? 100 : Number(row.customers || 0) ? value / Number(row.customers) * 100 : 0; return `<i style="--cohort:${rate / 100}" title="${rate.toFixed(1)}%"><em>${month === 0 ? formatNumber(row.customers) : `${rate.toFixed(0)}%`}</em></i>`; }).join('')}</div>`).join('')}</div>`);
    }

    function renderDecisionEngine(dashboard) {
        const recommendations = dashboard?.decisionEngine?.recommendations || [];
        return `<section class="enterprise-decision-center enterprise-animate-in searchable-item" data-search-text="AI recommendations decisions risks opportunities suggested actions">
            <header><div><span class="section-label">Grounded decision engine</span><h2>AI-assisted recommendations</h2><p>Recommendations are generated only from verified metrics and deterministic business rules. Missing data is stated, not invented.</p></div><span class="enterprise-grounded-badge"><i class="fa-solid fa-shield-check"></i> Grounded</span></header>
            <div class="enterprise-recommendation-grid">${recommendations.map((item) => `<article class="priority-${escapeHtml(item.priority)}"><header><span>${escapeHtml(item.priority)} priority</span><b>${Number(item.confidence || 0)}% confidence</b></header><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.reason)}</p><ul>${(item.evidence || []).slice(0, 4).map((evidence) => `<li>${escapeHtml(evidence)}</li>`).join('')}</ul><footer><span>Expected impact: ${escapeHtml(item.impact || 'Review')}</span>${item.workflowSlug ? `<button type="button" data-analytics-workflow="${escapeHtml(item.workflowSlug)}">${escapeHtml(item.actionLabel || 'Run workflow')} <i class="fa-solid fa-arrow-right"></i></button>` : '<button type="button" data-analytics-metric="anomalies">Inspect details <i class="fa-solid fa-arrow-right"></i></button>'}</footer></article>`).join('') || '<div class="enterprise-success-state"><i class="fa-solid fa-circle-check"></i><span><b>No urgent action detected</b><small>The connected metrics do not currently trigger a high-severity rule.</small></span></div>'}</div>
        </section>`;
    }

    function renderWorkflowCenter(dashboard) {
        const workflows = dashboard?.workflows || [];
        return `<section class="enterprise-workflow-center enterprise-animate-in searchable-item" data-search-text="revenue workflow inventory workflow marketing customer retention automation">
            <header><div><span class="section-label">Action center</span><h2>Business intelligence workflows</h2></div><p>Move from detection to action without leaving Analytics.</p></header>
            <div>${workflows.map((workflow) => `<article class="${workflow.triggered ? 'triggered' : ''}"><span class="workflow-state"><i></i>${workflow.triggered ? 'Action needed' : 'Monitoring'}</span><h3>${escapeHtml(workflow.title)}</h3><ol>${(workflow.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol><button type="button" data-analytics-workflow="${escapeHtml(workflow.workflowSlug)}">${workflow.triggered ? 'Run recommended workflow' : 'Run on demand'} <i class="fa-solid fa-play"></i></button></article>`).join('')}</div>
        </section>`;
    }

    function renderSummaryPanel(summary, icon) {
        return panel('Report', summary?.title || 'Business summary', icon, `<ul class="enterprise-summary-list">${(summary?.bullets || []).map((bullet) => `<li><i class="fa-solid fa-check"></i>${escapeHtml(bullet)}</li>`).join('')}</ul>`);
    }

    function renderExportCenter(dashboard) {
        return panel('Reports', 'Export Center', 'fa-file-export', `<p class="enterprise-panel-note">Export the current filtered view with metrics, product performance, inventory risks, and recommendations.</p><div class="enterprise-export-grid"><button type="button" data-analytics-export="csv"><i class="fa-solid fa-file-csv"></i><span><b>CSV</b><small>Raw analysis table</small></span></button><button type="button" data-analytics-export="excel"><i class="fa-solid fa-file-excel"></i><span><b>Excel</b><small>Multi-sheet workbook</small></span></button><button type="button" data-analytics-export="pdf"><i class="fa-solid fa-file-pdf"></i><span><b>PDF</b><small>Executive report</small></span></button><button type="button" data-analytics-print><i class="fa-solid fa-print"></i><span><b>Print</b><small>Printer-ready view</small></span></button><button type="button" data-analytics-email><i class="fa-solid fa-envelope"></i><span><b>Email report</b><small>Send to your account</small></span></button><button type="button" data-schedule-report="weekly"><i class="fa-solid fa-clock"></i><span><b>Schedule</b><small>Weekly report</small></span></button></div>${dashboard?.demo?.active ? '<button type="button" class="enterprise-demo-remove" data-remove-analytics-demo>Remove demo dataset</button>' : ''}`);
    }

    function renderDataQuality(dashboard) {
        const quality = dashboard?.dataQuality || {};
        return `<section class="enterprise-data-quality enterprise-animate-in searchable-item" data-search-text="data quality sources connections records confidence onboarding">
            <header><div><span class="section-label">Data trust center</span><h2>Coverage &amp; source health</h2><p>Every metric is traceable to connected records. Setup guidance replaces vague “insufficient data” messages.</p></div><div><strong>${formatNumber(quality.score || 0)}%</strong><span>coverage score</span></div></header>
            <div class="enterprise-quality-grid">${(quality.checks || []).map((check) => `<article class="${escapeHtml(check.status)}"><i class="fa-solid ${check.status === 'connected' ? 'fa-circle-check' : 'fa-circle-plus'}"></i><span><b>${escapeHtml(check.label)}</b><small>${check.status === 'connected' ? `${formatNumber(check.records)} connected records` : escapeHtml(check.action)}</small></span>${check.status === 'connected' ? '<em>Connected</em>' : `<button type="button" data-analytics-action="${check.key === 'orders' ? 'import-data' : 'open-settings'}">Set up</button>`}</article>`).join('')}</div>
            ${dashboard?.onboarding?.canLoadDemo ? '<div class="enterprise-demo-banner"><div><i class="fa-solid fa-flask"></i><span><b>Explore with a realistic demo business</b><small>Load a clearly marked, deterministic 180-day dataset. It can be removed at any time and is never mixed with real orders.</small></span></div><button type="button" data-load-analytics-demo>Load demo dataset</button></div>' : ''}
        </section>`;
    }

    function panel(kicker, title, icon, body, className = '') {
        return `<article class="enterprise-panel enterprise-animate-in searchable-item ${escapeHtml(className)}" data-search-text="${escapeHtml(`${kicker} ${title}`)}"><header><div><span class="section-label">${escapeHtml(kicker)}</span><h3>${escapeHtml(title)}</h3></div><span class="enterprise-panel-icon"><i class="fa-solid ${escapeHtml(icon)}"></i></span></header><div class="enterprise-panel-body">${body}</div><button type="button" class="enterprise-panel-expand" data-expand-card aria-expanded="false" aria-label="Expand ${escapeHtml(title)}"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button></article>`;
    }

    function intelligentEmpty(title, description, action) {
        return `<div class="enterprise-intelligent-empty"><i class="fa-solid fa-chart-simple"></i><span><b>${escapeHtml(title)}</b><small>${escapeHtml(description)}</small></span><button type="button" data-analytics-action="${escapeHtml(action)}">Set up <i class="fa-solid fa-arrow-right"></i></button></div>`;
    }

    function lineChart(actual, forecast, currency) {
        const points = [...actual.map((row) => ({ date: row.date, value: Number(row.revenueMinor || 0), actual: true })), ...forecast.map((row) => ({ date: row.date, value: Number(row.value || 0), lower: row.lower, upper: row.upper, actual: false }))];
        if (!points.length) return '';
        const width = 840;
        const height = 270;
        const padding = { left: 26, right: 20, top: 18, bottom: 34 };
        const max = Math.max(1, ...points.map((point) => Number(point.upper || point.value || 0)));
        const x = (index) => padding.left + index / Math.max(1, points.length - 1) * (width - padding.left - padding.right);
        const y = (value) => padding.top + (1 - Number(value || 0) / max) * (height - padding.top - padding.bottom);
        const actualPath = actual.map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(row.revenueMinor).toFixed(1)}`).join(' ');
        const areaPath = actual.length ? `${actualPath} L${x(actual.length - 1)},${height - padding.bottom} L${x(0)},${height - padding.bottom} Z` : '';
        const forecastOffset = Math.max(0, actual.length - 1);
        const forecastRows = forecast.length && actual.length ? [{ date: actual.at(-1).date, value: actual.at(-1).revenueMinor, lower: actual.at(-1).revenueMinor, upper: actual.at(-1).revenueMinor }, ...forecast] : forecast;
        const forecastPath = forecastRows.map((row, index) => `${index ? 'L' : 'M'}${x(forecastOffset + index).toFixed(1)},${y(row.value).toFixed(1)}`).join(' ');
        const bandTop = forecastRows.map((row, index) => `${index ? 'L' : 'M'}${x(forecastOffset + index).toFixed(1)},${y(row.upper ?? row.value).toFixed(1)}`).join(' ');
        const bandBottom = [...forecastRows].reverse().map((row, reverseIndex) => { const index = forecastRows.length - 1 - reverseIndex; return `L${x(forecastOffset + index).toFixed(1)},${y(row.lower ?? row.value).toFixed(1)}`; }).join(' ');
        const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0);
        return `<div class="enterprise-line-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenue timeline and forecast">
            <defs><linearGradient id="enterpriseRevenueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".34"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
            ${[0, .25, .5, .75, 1].map((tick) => `<line x1="${padding.left}" y1="${y(max * tick)}" x2="${width - padding.right}" y2="${y(max * tick)}" class="chart-grid"/>`).join('')}
            ${areaPath ? `<path d="${areaPath}" class="chart-area"/>` : ''}<path d="${actualPath}" class="chart-line"/>
            ${forecastRows.length ? `<path d="${bandTop} ${bandBottom} Z" class="chart-forecast-band"/><path d="${forecastPath}" class="chart-forecast-line"/>` : ''}
            ${points.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="4" class="chart-point ${point.actual ? '' : 'forecast'}" data-chart-point="${escapeHtml(JSON.stringify({ date: point.date, value: point.value, currency }))}"><title>${escapeHtml(point.date)} · ${escapeHtml(formatMoney(point.value, currency))}</title></circle>`).join('')}
            ${labels.map((point) => { const index = points.indexOf(point); return `<text x="${x(index)}" y="${height - 9}" text-anchor="middle">${escapeHtml(shortDate(point.date))}</text>`; }).join('')}
        </svg><div class="enterprise-chart-legend"><span><i class="actual"></i> Actual revenue</span>${forecastRows.length ? '<span><i class="forecast"></i> Forecast</span><span><i class="band"></i> Confidence band</span>' : ''}</div></div>`;
    }

    function cashFlowChart(rows, currency) {
        const maximum = Math.max(1, ...rows.flatMap((row) => [Number(row.netRevenueMinor || 0), Number(row.campaignSpendMinor || 0), Number(row.refundsMinor || 0)]));
        const shown = rows.slice(-30);
        return `<div class="enterprise-cash-chart" aria-label="Daily cash flow"><div>${shown.map((row) => `<span title="${escapeHtml(`${row.date}: ${formatMoney(row.netRevenueMinor, currency)} net revenue`)}"><i style="height:${Math.max(2, Number(row.netRevenueMinor || 0) / maximum * 100)}%"></i><b style="height:${Math.max(1, Number(row.campaignSpendMinor || 0) / maximum * 100)}%"></b><em style="height:${Math.max(1, Number(row.refundsMinor || 0) / maximum * 100)}%"></em></span>`).join('')}</div><footer><span><i></i>Net revenue</span><span><i></i>Spend</span><span><i></i>Refunds</span></footer></div>`;
    }

    function dualMiniChart(rows) {
        const shown = rows.slice(-30);
        const maximum = Math.max(1, ...shown.flatMap((row) => [Number(row.newCustomers || 0), Number(row.returningCustomers || 0)]));
        return `<div class="enterprise-dual-chart">${shown.map((row) => `<span title="${escapeHtml(`${row.date}: ${row.newCustomers} new, ${row.returningCustomers} returning`)}"><i style="height:${Number(row.newCustomers || 0) / maximum * 100}%"></i><b style="height:${Number(row.returningCustomers || 0) / maximum * 100}%"></b></span>`).join('')}</div><div class="enterprise-mini-legend"><span><i></i>New</span><span><i></i>Returning</span></div>`;
    }

    function categoryTreemap(categories, dashboard) {
        const rows = categories.filter((row) => Number(row.revenueMinor || 0) > 0).slice(0, 7);
        const total = Math.max(1, rows.reduce((sum, row) => sum + Number(row.revenueMinor || 0), 0));
        if (!rows.length) return '';
        return `<div class="enterprise-category-treemap">${rows.map((row, index) => `<div style="--category-size:${Math.max(18, Number(row.revenueMinor || 0) / total * 100)};--category-index:${index}"><b>${escapeHtml(row.categoryName)}</b><span>${formatMoney(row.revenueMinor, dashboard?.business?.currency)}</span></div>`).join('')}</div>`;
    }

    function renderAnomalies(anomalies, dashboard) {
        if (!anomalies.length) return '<div class="enterprise-no-anomaly"><i class="fa-solid fa-shield"></i>No material daily revenue anomaly detected.</div>';
        return `<div class="enterprise-anomaly-strip"><b><i class="fa-solid fa-wave-square"></i>${anomalies.length} unusual sales day${anomalies.length === 1 ? '' : 's'} detected</b>${anomalies.slice(0, 3).map((row) => `<button type="button" data-chart-point="${escapeHtml(JSON.stringify({ date: row.date, value: row.value, currency: dashboard?.business?.currency, anomaly: row.direction }))}">${escapeHtml(shortDate(row.date))} · ${escapeHtml(row.direction)}</button>`).join('')}</div>`;
    }

    function sparkline(values, trendClass) {
        const rows = values.map(Number).filter(Number.isFinite);
        if (rows.length < 2) return '<div class="enterprise-sparkline empty"><span>Trend builds as records arrive</span></div>';
        const width = 220;
        const height = 52;
        const min = Math.min(...rows);
        const max = Math.max(...rows);
        const range = Math.max(1, max - min);
        const points = rows.map((value, index) => `${index / (rows.length - 1) * width},${height - 5 - ((value - min) / range) * (height - 10)}`).join(' ');
        return `<div class="enterprise-sparkline ${trendClass}"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"/></svg></div>`;
    }

    function openMetricDetails(key) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        let title = 'Metric details';
        let content = '';
        if (key.startsWith('product:')) {
            const id = Number(key.split(':')[1]);
            const product = (dashboard.products?.all || []).find((row) => Number(row.productId) === id);
            if (!product) return;
            title = product.productName;
            content = detailGrid([
                ['Revenue', formatMoney(product.revenueMinor || 0, dashboard.business?.currency)], ['Units sold', formatNumber(product.unitsSold || 0)], ['Orders', formatNumber(product.orderCount || 0)], ['Revenue trend', signedPercent(product.revenueChangePercentage)], ['Profit', product.profitMinor === null || product.profitMinor === undefined ? 'Product cost required' : formatMoney(product.profitMinor, dashboard.business?.currency)], ['Current stock', product.currentStock ?? 'Not connected']
            ]) + `<p>${escapeHtml(product.stockRisk ? `Inventory status: ${product.stockRisk}.` : 'Inventory status is not available.')}</p>`;
        } else if (key.startsWith('inventory:')) {
            const id = Number(key.split(':')[1]);
            const item = (dashboard.inventory?.risks || []).find((row) => Number(row.productId) === id);
            if (!item) return;
            title = `${item.productName} inventory risk`;
            content = detailGrid([['Risk', item.stockRisk], ['Stock', item.currentStock ?? 'Unknown'], ['Days of cover', item.daysOfCover === null || item.daysOfCover === undefined ? 'Unavailable' : Number(item.daysOfCover).toFixed(1)], ['Reorder point', item.reorderPoint ?? 'Unavailable'], ['Recommended quantity', item.recommendedReorderQuantity ?? 'Review manually'], ['Confidence', `${item.confidence}%`]]) + `<p>${escapeHtml(item.supplierImpact)}</p><button type="button" class="primary-action" data-analytics-workflow="inventory-predictor">Run inventory predictor</button>`;
        } else if (key === 'anomalies') {
            title = 'Anomaly detection';
            content = `<div class="enterprise-detail-list">${(dashboard.anomalies || []).map((row) => `<div><span><b>${escapeHtml(row.date)}</b><small>${escapeHtml(row.direction)} revenue anomaly · z-score ${escapeHtml(row.zScore)}</small></span><strong>${formatMoney(row.value, dashboard.business?.currency)}</strong></div>`).join('') || '<p>No material anomalies were detected.</p>'}</div>`;
        } else {
            const metric = metricByKey(key, dashboard);
            if (!metric) return;
            title = metric.label;
            content = detailGrid([['Current value', formatMetric(metric, dashboard.business?.currency)], ['Comparison', metric.previousValue === null || metric.previousValue === undefined ? 'Not available' : formatMetric({ ...metric, value: metric.previousValue }, dashboard.business?.currency)], ['Change', signedPercent(metric.changePercentage)], ['Confidence', `${metric.confidence}%`], ['Source', metric.source]]) + `<div class="enterprise-detail-insight"><b>AI insight</b><p>${escapeHtml(metric.insight)}</p><b>Suggested action</b><p>${escapeHtml(metric.suggestedAction)}</p>${metric.workflowSlug ? `<button type="button" class="primary-action" data-analytics-workflow="${escapeHtml(metric.workflowSlug)}">Run recommended workflow</button>` : ''}</div>`;
        }
        openDrilldown(title, content);
    }

    function openChartPoint(serialized) {
        try {
            const point = JSON.parse(serialized);
            openDrilldown(point.anomaly ? `${point.anomaly} revenue anomaly` : 'Daily revenue', detailGrid([['Date', point.date], ['Revenue', formatMoney(point.value, point.currency)], ...(point.anomaly ? [['Signal', `${point.anomaly} anomaly`]] : [])]));
        } catch {
            // Ignore malformed visual point metadata.
        }
    }

    function openDrilldown(title, content) {
        if (!elements.drilldown) return;
        elements.drilldownTitle.textContent = title;
        elements.drilldownContent.innerHTML = content;
        elements.drilldown.hidden = false;
        document.documentElement.classList.add('analytics-modal-open');
        elements.drilldown.querySelector('[data-close-analytics-drilldown]:not(.enterprise-drilldown-backdrop)')?.focus();
    }

    function closeDrilldown() {
        if (!elements.drilldown) return;
        elements.drilldown.hidden = true;
        document.documentElement.classList.remove('analytics-modal-open');
    }

    function runWorkflow(slug) {
        const existing = document.querySelector(`.run-btn[data-workflow="${cssEscape(slug)}"]`);
        if (!existing) {
            toast('That workflow is not available in this workspace.', 'error');
            return;
        }
        closeDrilldown();
        existing.click();
    }

    function handleSetupAction(action) {
        if (action === 'import-data') {
            document.querySelector('[data-view-target="settings"]')?.click();
            setTimeout(() => document.getElementById('businessDataImport')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 180);
            return;
        }
        if (action === 'open-settings') document.querySelector('[data-view-target="settings"]')?.click();
    }

    async function loadDemoData(button) {
        if (!window.confirm('Load a clearly marked 180-day demo dataset? Demo records can be removed from the Export Center and are never mixed with real orders.')) return;
        await busyAction(button, 'Loading demo data…', async () => {
            const response = await fetch('/api/analytics/demo-data', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'Demo data could not be loaded.');
            toast(payload.demo?.alreadyLoaded ? 'The demo dataset is already loaded.' : 'Demo business data loaded successfully.', 'success');
            await loadDashboard({ refresh: true });
        });
    }

    async function removeDemoData(button) {
        if (!window.confirm('Remove every OrexisAI demo analytics record from this business?')) return;
        await busyAction(button, 'Removing…', async () => {
            const response = await fetch('/api/analytics/demo-data', { method: 'DELETE', headers: { Accept: 'application/json' } });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'Demo data could not be removed.');
            toast('Demo analytics data removed.', 'success');
            await loadDashboard({ refresh: true });
        });
    }

    function exportReport(format) {
        const params = buildQuery({ refresh: true });
        params.set('format', format);
        window.location.assign(`/api/analytics/export?${params.toString()}`);
        toast(`${format.toUpperCase()} report generation started.`, 'success');
    }

    async function emailReport(button) {
        await busyAction(button, 'Sending…', async () => {
            const response = await fetch('/api/analytics/email', {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: elements.from.value, to: elements.to.value, filters: currentFilters() })
            });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'The analytics report could not be emailed.');
            toast('Analytics report emailed to your account.', 'success');
        });
    }

    async function scheduleReport(cadence) {
        const timezone = state.dashboard?.business?.timezone || 'UTC';
        const payload = {
            kind: cadence === 'monthly' ? 'monthly-report' : 'weekly-marketing',
            cadence: cadence === 'monthly' ? 'monthly' : 'weekly',
            runHour: 8,
            runMinute: 0,
            dayOfWeek: 1,
            dayOfMonth: 1,
            timezone,
            enabled: true
        };
        const response = await fetch('/api/marketing/schedules', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await readJson(response);
        if (!response.ok) return toast(result.error || 'The report schedule could not be saved.', 'error');
        toast(`${cadence === 'monthly' ? 'Monthly' : 'Weekly'} report schedule saved for 08:00 ${timezone}.`, 'success');
    }

    async function busyAction(button, label, callback) {
        if (!button || button.disabled) return;
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(label)}`;
        try {
            await callback();
        } catch (error) {
            toast(error.message || 'The action could not be completed.', 'error');
        } finally {
            button.disabled = false;
            button.innerHTML = original;
        }
    }

    function connectRealtime() {
        if (!window.EventSource) return;
        disconnectRealtime();
        const source = new EventSource('/api/marketing/events');
        state.eventSource = source;
        const handleEvent = (event) => {
            try {
                const payload = JSON.parse(event.data || '{}');
                if (['completed', 'scheduled-completed', 'analytics-data-changed'].includes(payload.type) && isAnalyticsVisible()) {
                    loadDashboard({ refresh: true });
                }
            } catch {
                // Ignore malformed server-sent events.
            }
        };
        ['message', 'completed', 'scheduled-completed', 'analytics-data-changed'].forEach((type) => source.addEventListener(type, handleEvent));
        source.addEventListener('error', () => updateLiveStatus(state.polling ? 'Live stream reconnecting; polling remains active' : 'Live stream reconnecting', 'paused'));
    }

    function disconnectRealtime() {
        state.eventSource?.close();
        state.eventSource = null;
        clearTimeout(state.pollTimer);
    }

    function schedulePoll() {
        clearTimeout(state.pollTimer);
        if (!state.polling || document.hidden || !isAnalyticsVisible()) return;
        state.pollTimer = setTimeout(() => loadDashboard({ refresh: false }), 30_000);
    }

    function isAnalyticsVisible() {
        const view = document.querySelector('[data-view="analytics"]');
        return Boolean(view && !view.hidden && view.classList.contains('active'));
    }

    function setLoading(loading) {
        root.classList.toggle('is-refreshing', loading && state.loaded);
        elements.refresh?.classList.toggle('is-loading', loading);
        if (elements.refresh) elements.refresh.disabled = loading;
    }

    function renderError(message) {
        if (state.loaded) {
            toast(message, 'error');
            return;
        }
        root.innerHTML = `<div class="enterprise-load-error"><i class="fa-solid fa-triangle-exclamation"></i><div><h3>Analytics could not be loaded</h3><p>${escapeHtml(message)}</p><button type="button" class="primary-action" id="analyticsRetryButton">Retry</button></div></div>`;
        document.getElementById('analyticsRetryButton')?.addEventListener('click', () => loadDashboard({ refresh: true }));
    }

    function updateLiveStatus(text, stateName) {
        if (!elements.liveStatus) return;
        elements.liveStatus.textContent = text;
        elements.liveStatus.dataset.state = stateName;
    }

    function buildLiveLabel(dashboard) {
        const updated = dashboard?.live?.sourceUpdatedAt || dashboard?.generatedAt;
        return `Live · updated ${updated ? formatRelativeTime(updated) : 'now'} · refreshes every ${dashboard?.live?.pollingSeconds || 30}s`;
    }

    function syncFilterOptions(filters) {
        syncSelect(elements.channel, filters.channels || [], 'All channels', filters.channel);
        syncSelect(elements.location, filters.locations || [], 'All locations', filters.location);
    }

    function syncSelect(select, options, emptyLabel, selected) {
        if (!select) return;
        const current = selected || select.value;
        select.replaceChildren(new Option(emptyLabel, ''), ...options.map((option) => new Option(`${option.label} (${formatNumber(option.records)})`, option.value)));
        if (Array.from(select.options).some((option) => option.value === current)) select.value = current;
    }

    function initializeDates() {
        applyPreset('30');
        markPreset();
    }

    function applyPreset(preset) {
        const now = new Date();
        const today = dateOnly(now);
        let from = new Date(now);
        let to = new Date(now);
        if (preset === 'yesterday') {
            from.setDate(from.getDate() - 1);
            to = new Date(from);
        } else if (preset === '7' || preset === '30') {
            from.setDate(from.getDate() - Number(preset) + 1);
        } else if (preset === 'this-month') {
            from = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (preset === 'last-month') {
            from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            to = new Date(now.getFullYear(), now.getMonth(), 0);
        } else if (preset === 'today') {
            from = new Date(now);
        }
        elements.from.value = dateOnly(from);
        elements.to.value = preset === 'today' ? today : dateOnly(to);
    }

    function markPreset() {
        form.querySelectorAll('[data-analytics-preset]').forEach((button) => button.classList.toggle('active', button.dataset.analyticsPreset === state.activePreset));
    }

    function buildQuery({ refresh }) {
        const params = new URLSearchParams();
        if (elements.from.value) params.set('from', elements.from.value);
        if (elements.to.value) params.set('to', elements.to.value);
        const filters = currentFilters();
        Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
        if (refresh) params.set('refresh', '1');
        return params;
    }

    function currentFilters() {
        return {
            compare: elements.compare?.value || 'previous-period',
            channel: elements.channel?.value || '',
            location: elements.location?.value || '',
            businessHours: elements.businessHours?.value || 'all'
        };
    }

    function toast(message, type = 'info') {
        if (!elements.toast) return;
        const item = document.createElement('div');
        item.className = `enterprise-toast ${type}`;
        item.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info'}"></i><span>${escapeHtml(message)}</span>`;
        elements.toast.appendChild(item);
        requestAnimationFrame(() => item.classList.add('visible'));
        setTimeout(() => {
            item.classList.remove('visible');
            setTimeout(() => item.remove(), 240);
        }, 4_400);
    }

    function animateCounters(dashboard) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        root.querySelectorAll('[data-counter-key]').forEach((element) => {
            const metric = metricByKey(element.dataset.counterKey, dashboard);
            if (!metric || metric.value === null || metric.value === undefined || reduced) return;
            const target = Number(metric.value);
            const duration = 650;
            const started = performance.now();
            const tick = (now) => {
                const progress = Math.min(1, (now - started) / duration);
                const eased = 1 - ((1 - progress) ** 3);
                element.textContent = formatMetric({ ...metric, value: target * eased }, dashboard.business?.currency);
                if (progress < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    function detailGrid(rows) {
        return `<div class="enterprise-detail-grid">${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 'Not available')}</strong></div>`).join('')}</div>`;
    }

    function metricByKey(key, dashboard = state.dashboard) {
        return (dashboard?.executive?.metrics || []).find((metric) => metric.key === key);
    }

    function formatMetric(metric, currency) {
        if (!metric || metric.value === null || metric.value === undefined) return 'Not available yet';
        if (metric.unit === 'minor-currency') return formatMoney(metric.value, currency);
        if (metric.unit === 'percentage') return `${Number(metric.value).toFixed(1)}%`;
        if (metric.unit === 'ratio') return `${Number(metric.value).toFixed(2)}×`;
        return formatNumber(metric.value, Number(metric.value) % 1 ? 2 : 0);
    }

    function formatMoney(value, currency = 'USD') {
        try {
            return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(Number(value || 0) / 100);
        } catch {
            return `${currency || 'USD'} ${(Number(value || 0) / 100).toFixed(2)}`;
        }
    }

    function formatNumber(value, decimals = 0) {
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals }).format(Number(value || 0));
    }

    function nullablePercent(value) {
        return value === null || value === undefined ? 'Not available' : `${Number(value).toFixed(1)}%`;
    }

    function signedPercent(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'No comparison';
        const number = Number(value);
        return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`;
    }

    function percentageText(value, total) {
        return total ? `${(Number(value || 0) / Number(total) * 100).toFixed(1)}%` : '0.0%';
    }

    function formatRelativeTime(value) {
        const milliseconds = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(milliseconds) || milliseconds < 10_000) return 'just now';
        if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1000)}s ago`;
        if (milliseconds < 3_600_000) return `${Math.floor(milliseconds / 60_000)}m ago`;
        return new Date(value).toLocaleString();
    }

    function shortDate(value) {
        const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function dateOnly(value) {
        const date = new Date(value);
        const offset = date.getTimezoneOffset() * 60_000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 10);
    }

    function iconForMetric(key) {
        return ({ revenue: 'fa-dollar-sign', orders: 'fa-receipt', customers: 'fa-user-group', aov: 'fa-basket-shopping', 'products-sold': 'fa-box', conversion: 'fa-arrow-trend-up', returning: 'fa-rotate-left', profit: 'fa-coins', 'refund-rate': 'fa-arrow-rotate-left', clv: 'fa-gem', 'repeat-rate': 'fa-repeat', 'marketing-roi': 'fa-bullseye' })[key] || 'fa-chart-simple';
    }

    function statusClass(status) {
        return String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    function cssEscape(value) {
        return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/[^a-z0-9_-]/gi, '\\$&');
    }

    async function readJson(response) {
        const text = await response.text();
        if (!text) return {};
        try { return JSON.parse(text); } catch { return { error: text.slice(0, 500) }; }
    }

    function escapeHtml(value) {
        return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    }
})();
