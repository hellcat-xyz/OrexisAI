'use strict';

(() => {
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

    function money(value, currency = 'USD', compact = false) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Unavailable';
        return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 2 }).format(Number(value) / 100);
    }

    function number(value, maximumFractionDigits = 1) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Unavailable';
        return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(Number(value));
    }

    function percent(value) {
        return value === null || value === undefined || !Number.isFinite(Number(value)) ? 'Unavailable' : `${number(value, 1)}%`;
    }

    function metricCard(label, metric, currency) {
        const value = metric?.unit === 'minor-currency' ? money(metric.value, currency)
            : metric?.unit === 'percentage' ? percent(metric.value)
                : metric?.unit === 'ratio' ? (metric.value === null ? 'Unavailable' : `${number(metric.value, 2)}×`)
                    : number(metric?.value, 1);
        const change = metric?.changePercentage;
        return `<article class="marketing-kpi-card${metric?.available ? '' : ' unavailable'}">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <small>${metric?.available ? (change === null || change === undefined ? `${number(metric.sourceRecords, 0)} source records` : `${change >= 0 ? '+' : ''}${percent(change)} vs previous`) : escapeHtml(metric?.reason || 'Data unavailable')}</small>
        </article>`;
    }

    function renderMetricGrid(container, workspace) {
        if (!container) return;
        const metrics = workspace.metrics || {};
        const currency = workspace.business?.currency || 'USD';
        const entries = [
            ['Revenue today', metrics.revenueToday], ['Revenue this week', metrics.revenueThisWeek], ['Revenue this month', metrics.revenueThisMonth],
            ['Selected-period revenue', metrics.revenue], ['Orders', metrics.orders], ['Average order value', metrics.averageOrderValue],
            ['New customers', metrics.newCustomers], ['Returning customers', metrics.returningCustomers], ['Returning customer rate', metrics.returningCustomerPercentage],
            ['Profit', metrics.profit], ['Profit margin', metrics.profitMarginPercentage], ['Conversion rate', metrics.conversionRatePercentage],
            ['Customer acquisition cost', metrics.customerAcquisitionCost], ['Customer lifetime value', metrics.customerLifetimeValue], ['Repeat purchase rate', metrics.repeatPurchaseRatePercentage],
            ['Abandoned carts', metrics.abandonedCarts], ['Marketing ROI', metrics.marketingRoiPercentage], ['Inventory at risk', metrics.inventoryAtRisk],
            ['YOY revenue growth', metrics.yearOverYearRevenueGrowthPercentage]
        ];
        container.innerHTML = entries.map(([label, metric]) => metricCard(label, metric, currency)).join('');
    }

    function renderTrend(container, points, currency) {
        if (!container) return;
        if (!points?.length || points.every((point) => Number(point.revenueMinor || 0) === 0)) {
            container.innerHTML = empty('No revenue records exist in this period.');
            return;
        }
        const max = Math.max(...points.map((point) => Number(point.revenueMinor || 0)), 1);
        container.innerHTML = points.map((point) => {
            const height = Math.max(3, Math.round((Number(point.revenueMinor || 0) / max) * 100));
            return `<div class="marketing-trend-column" title="${escapeHtml(`${point.date}: ${money(point.revenueMinor, currency)}`)}"><span>${escapeHtml(money(point.revenueMinor, currency, true))}</span><div><i style="height:${height}%"></i></div><small>${escapeHtml(new Date(`${point.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</small></div>`;
        }).join('');
    }

    function renderProductTable(container, products, currency, emptyText) {
        if (!container) return;
        if (!products?.length) { container.innerHTML = empty(emptyText); return; }
        container.innerHTML = `<div class="marketing-table-head"><span>Product</span><span>Revenue</span><span>Units</span><span>Stock risk</span></div>${products.map((product) => `<div class="marketing-table-row"><span><strong>${escapeHtml(product.productName)}</strong><small>${escapeHtml(product.category || product.sku || 'Uncategorized')}</small></span><span>${escapeHtml(money(product.revenueMinor, currency))}</span><span>${escapeHtml(number(product.unitsSold, 2))}</span><span class="risk-badge risk-${escapeHtml(product.stockRisk)}">${escapeHtml(product.stockRisk)}</span></div>`).join('')}`;
    }

    function renderFunnel(container, funnel) {
        if (!container) return;
        if (!funnel?.available) { container.innerHTML = empty('Connect traffic daily metrics to calculate the full funnel.'); return; }
        const stages = [['Sessions', funnel.sessions], ['Product views', funnel.productViews], ['Add to carts', funnel.addToCarts], ['Checkout starts', funnel.checkoutStarts], ['Purchases', funnel.purchases]];
        const max = Math.max(...stages.map(([, value]) => Number(value || 0)), 1);
        container.innerHTML = stages.map(([label, value], index) => `<div class="funnel-stage"><span>${escapeHtml(label)}</span><strong>${escapeHtml(number(value, 0))}</strong><i style="width:${Math.max(8, Math.round((Number(value || 0) / max) * 100))}%"></i>${index < stages.length - 1 ? `<small>${escapeHtml(percent(index === 0 ? funnel.sessionToProductViewPercentage : index === 1 ? funnel.productViewToCartPercentage : index === 2 ? funnel.cartToCheckoutPercentage : funnel.checkoutToPurchasePercentage))}</small>` : ''}</div>`).join('');
    }

    function renderList(container, rows, renderer, emptyText) {
        if (!container) return;
        container.innerHTML = rows?.length ? rows.map(renderer).join('') : empty(emptyText);
    }

    function renderHistory(container, runs) {
        renderList(container, runs, (run) => `<button class="marketing-history-row" type="button" data-marketing-run-id="${Number(run.id)}"><span><strong>${escapeHtml(run.workflowName)}</strong><small>${escapeHtml(new Date(run.createdAt).toLocaleString())}</small></span><span><b>${escapeHtml(run.status)}</b><small>${escapeHtml(run.durationMs === null ? `${run.progressPercentage}%` : `${number(run.durationMs / 1000, 1)}s`)}</small></span></button>`, 'No workflow history exists yet.');
    }

    function renderSchedules(container, schedules) {
        renderList(container, schedules, (schedule) => `<div class="marketing-schedule-row"><span><strong>${escapeHtml(schedule.scheduleKind.replaceAll('-', ' '))}</strong><small>${escapeHtml(`${schedule.cadence} · ${schedule.timezone}`)}</small></span><span><b>${schedule.enabled ? 'Active' : 'Paused'}</b><small>${escapeHtml(`Next ${new Date(schedule.nextRunAt).toLocaleString()}`)}</small></span><button type="button" data-delete-schedule="${Number(schedule.id)}" aria-label="Delete schedule"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div>`, 'No scheduled marketing workflows.');
    }

    function renderCampaigns(container, campaigns) {
        renderList(container, campaigns, (campaign) => `<article class="marketing-campaign-card"><div><span>${escapeHtml(campaign.channel)}</span><b>${escapeHtml(campaign.status)}</b></div><h4>${escapeHtml(campaign.title)}</h4><pre>${escapeHtml(typeof campaign.content === 'string' ? campaign.content : JSON.stringify(campaign.content, null, 2))}</pre><small>${escapeHtml(campaign.rationale || '')}</small><button type="button" data-copy-campaign="${Number(campaign.id)}"><i class="fa-regular fa-copy" aria-hidden="true"></i> Copy</button></article>`, 'Run weekly marketing to generate grounded campaign drafts.');
    }

    function empty(text) { return `<div class="business-empty-state"><span>${escapeHtml(text)}</span></div>`; }
    function skeleton(count = 4) { return Array.from({ length: count }, () => '<div class="marketing-skeleton"></div>').join(''); }

    window.OrexisMarketingComponents = Object.freeze({ empty, escapeHtml, metricCard, money, number, percent, renderCampaigns, renderFunnel, renderHistory, renderList, renderMetricGrid, renderProductTable, renderSchedules, renderTrend, skeleton });
})();
