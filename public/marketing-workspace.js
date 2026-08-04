'use strict';

(() => {
    const hooks = window.OrexisMarketingHooks;
    const ui = window.OrexisMarketingComponents;
    const root = document.getElementById('marketingWorkspace');
    if (!root || !hooks || !ui) return;

    const elements = Object.fromEntries([
        'marketingWorkspaceForm', 'marketingFromDate', 'marketingToDate', 'marketingRefreshBtn', 'marketingRunBtn',
        'marketingLiveStatus', 'marketingDataStatus', 'marketingLiveMetricsGrid', 'marketingRevenueTrend',
        'marketingRevenueForecast', 'marketingTopProducts', 'marketingWorstProducts', 'marketingInventoryAlerts',
        'marketingFunnel', 'marketingTrafficSources', 'marketingCategories', 'marketingCampaignPerformance',
        'marketingGeography', 'marketingCoupons', 'marketingOpportunities', 'marketingLimitations',
        'marketingWorkflowProgress', 'marketingProgressBar', 'marketingProgressLabel', 'marketingTimeline',
        'marketingLogs', 'marketingCampaignDrafts', 'marketingHistory', 'marketingSchedules', 'marketingScheduleForm',
        'marketingScheduleKind', 'marketingCadence', 'marketingRunHour', 'marketingRunMinute', 'marketingDayOfWeek',
        'marketingDayOfMonth', 'marketingTimezone', 'marketingScheduleEnabled', 'marketingToastRegion'
    ].map((id) => [id, document.getElementById(id)]));

    const state = { workspace: null, runs: [], campaigns: [], schedules: [], running: false, runId: null, poller: null, businessUnsubscribe: null, runUnsubscribe: null };
    initializeDateRange();
    bindEvents();
    setLoading(true);
    state.poller = hooks.createPoller(loadAll, { intervalMs: 30_000, onError: showError });
    connectRealtime();

    function bindEvents() {
        elements.marketingWorkspaceForm?.addEventListener('submit', (event) => { event.preventDefault(); void loadWorkspace(true); });
        elements.marketingRefreshBtn?.addEventListener('click', () => void loadAll(true));
        elements.marketingRunBtn?.addEventListener('click', () => void runWorkflow());
        elements.marketingScheduleForm?.addEventListener('submit', (event) => { event.preventDefault(); void saveSchedule(); });
        elements.marketingCadence?.addEventListener('change', syncScheduleFields);
        elements.marketingScheduleKind?.addEventListener('change', () => {
            const schedule = state.schedules.find((item) => item.scheduleKind === elements.marketingScheduleKind.value);
            if (schedule) populateSchedule(schedule);
            else resetScheduleForKind(elements.marketingScheduleKind.value);
        });
        elements.marketingHistory?.addEventListener('click', (event) => {
            const row = event.target.closest('[data-marketing-run-id]');
            if (row) void openRun(Number(row.dataset.marketingRunId));
        });
        elements.marketingSchedules?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-delete-schedule]');
            if (button) void deleteSchedule(Number(button.dataset.deleteSchedule));
        });
        elements.marketingCampaignDrafts?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-copy-campaign]');
            if (!button) return;
            const campaign = state.campaigns.find((item) => item.id === Number(button.dataset.copyCampaign));
            if (!campaign) return;
            await navigator.clipboard.writeText(typeof campaign.content === 'string' ? campaign.content : JSON.stringify(campaign.content, null, 2));
            toast('Campaign copied.', 'success');
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !state.businessUnsubscribe) connectRealtime();
        });
        window.addEventListener('beforeunload', () => { state.businessUnsubscribe?.(); state.runUnsubscribe?.(); state.poller?.stop(); }, { once: true });
        syncScheduleFields();
    }

    async function loadAll(forceRefresh = false) {
        await Promise.allSettled([loadWorkspace(forceRefresh), loadRuns(), loadCampaigns(), loadSchedules()]);
    }

    async function loadWorkspace(forceRefresh = false) {
        const controller = hooks.replaceRequest('marketing-workspace');
        setStatus(forceRefresh ? 'Refreshing verified business data…' : 'Loading verified business data…');
        try {
            const query = new URLSearchParams();
            if (elements.marketingFromDate?.value) query.set('from', elements.marketingFromDate.value);
            if (elements.marketingToDate?.value) query.set('to', elements.marketingToDate.value);
            if (forceRefresh) query.set('refresh', '1');
            const payload = await hooks.fetchJson(`/api/marketing/workspace?${query.toString()}`, { signal: controller.signal });
            state.workspace = payload.workspace;
            renderWorkspace(payload.workspace);
            setStatus(dataStatus(payload.workspace));
        } catch (error) {
            if (error.name !== 'AbortError') {
                setStatus(error.message, true);
                showError(error);
            }
        } finally {
            hooks.releaseRequest('marketing-workspace', controller);
            setLoading(false);
        }
    }

    async function loadRuns() {
        const payload = await hooks.fetchJson('/api/workflow-runs?workflow=weekly-marketing&limit=20');
        state.runs = payload.runs || [];
        ui.renderHistory(elements.marketingHistory, state.runs);
        const active = state.runs.find((run) => ['queued', 'running'].includes(run.status));
        if (active && !state.running) watchRun(active.id);
    }

    async function loadCampaigns(runId = null) {
        const payload = await hooks.fetchJson(`/api/marketing/campaigns?limit=100${runId ? `&runId=${encodeURIComponent(runId)}` : ''}`);
        state.campaigns = payload.campaigns || [];
        ui.renderCampaigns(elements.marketingCampaignDrafts, state.campaigns);
    }

    async function loadSchedules() {
        const payload = await hooks.fetchJson('/api/marketing/schedules');
        state.schedules = payload.schedules || [];
        ui.renderSchedules(elements.marketingSchedules, state.schedules);
        const selected = state.schedules.find((item) => item.scheduleKind === elements.marketingScheduleKind?.value);
        if (selected) populateSchedule(selected);
    }

    function renderWorkspace(workspace) {
        const currency = workspace.business?.currency || 'USD';
        ui.renderMetricGrid(elements.marketingLiveMetricsGrid, workspace);
        ui.renderTrend(elements.marketingRevenueTrend, workspace.trends?.daily || [], currency);
        renderForecast(elements.marketingRevenueForecast, workspace.trends?.revenueForecast?.points || [], currency);
        ui.renderProductTable(elements.marketingTopProducts, workspace.products?.top || [], currency, 'No sold products exist in this period.');
        ui.renderProductTable(elements.marketingWorstProducts, workspace.products?.worst || [], currency, 'No underperforming sold products exist in this period.');
        ui.renderProductTable(elements.marketingInventoryAlerts, workspace.products?.stockAlerts || [], currency, 'No inventory risks can be calculated from the current records.');
        ui.renderFunnel(elements.marketingFunnel, workspace.funnel);
        renderSimpleRows(elements.marketingTrafficSources, workspace.trafficSources, (row) => [row.sourceName, `${ui.number(row.sessions, 0)} sessions`, ui.percent(row.conversionRatePercentage)]);
        renderSimpleRows(elements.marketingCategories, workspace.categories, (row) => [row.categoryName, ui.money(row.revenueMinor, currency), `${ui.number(row.unitsSold, 1)} units`]);
        renderSimpleRows(elements.marketingCampaignPerformance, workspace.campaigns?.rows, (row) => [row.campaignName, ui.money(row.attributedRevenueMinor, currency), row.roas === null ? 'ROAS unavailable' : `${ui.number(row.roas, 2)}× ROAS`]);
        renderSimpleRows(elements.marketingGeography, workspace.geography, (row) => [row.countryCode, ui.money(row.revenueMinor, currency), `${ui.number(row.orders, 0)} orders`]);
        renderSimpleRows(elements.marketingCoupons, workspace.coupons, (row) => [row.couponCode, ui.money(row.revenueMinor, currency), `${ui.number(row.orders, 0)} orders`]);
        renderOpportunities(workspace.opportunities || []);
        renderLimitations(workspace.limitations || []);
        elements.marketingTimezone.value = workspace.business?.timezone || elements.marketingTimezone.value || 'UTC';
    }

    function renderForecast(container, points, currency) {
        if (!container) return;
        if (!points.length) { container.innerHTML = ui.empty('A forecast requires enough daily sales history.'); return; }
        container.innerHTML = points.map((point) => `<div class="marketing-forecast-row"><span>${ui.escapeHtml(new Date(`${point.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span><strong>${ui.escapeHtml(ui.money(point.value, currency))}</strong></div>`).join('');
    }

    function renderSimpleRows(container, rows, formatter) {
        ui.renderList(container, rows, (row) => {
            const [title, value, detail] = formatter(row);
            return `<div class="marketing-data-row"><span><strong>${ui.escapeHtml(title || 'Unknown')}</strong><small>${ui.escapeHtml(detail || '')}</small></span><b>${ui.escapeHtml(value || '')}</b></div>`;
        }, 'No connected records are available for this view.');
    }

    function renderOpportunities(rows) {
        ui.renderList(elements.marketingOpportunities, rows, (row) => `<article class="marketing-opportunity priority-${ui.escapeHtml(row.priority || 'medium')}"><span>${ui.escapeHtml(row.priority || 'medium')}</span><strong>${ui.escapeHtml(row.title)}</strong><small>${ui.escapeHtml(Array.isArray(row.evidence) ? row.evidence.join(' · ') : row.evidence || '')}</small></article>`, 'No deterministic opportunities were detected in this period.');
    }

    function renderLimitations(rows) {
        if (!elements.marketingLimitations) return;
        elements.marketingLimitations.innerHTML = rows.length
            ? rows.map((item) => `<li><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${ui.escapeHtml(item)}</span></li>`).join('')
            : '<li class="is-complete"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>All displayed metrics have their required connected source records.</span></li>';
    }

    async function runWorkflow(retryRunId = null) {
        if (state.running) return;
        state.running = true;
        state.runId = null;
        setRunControls(true);
        resetProgress();
        const objective = root.querySelector('[name="marketingObjective"]')?.value?.trim() || '';
        const body = {
            from: elements.marketingFromDate.value,
            to: elements.marketingToDate.value,
            objective,
            competitorScan: root.querySelector('[name="competitorScan"]')?.checked !== false,
            forceRefresh: true
        };
        try {
            await hooks.streamNdjson(retryRunId ? `/api/workflow-runs/${retryRunId}/retry` : '/api/workflows/weekly-marketing/runs', { method: 'POST', body: retryRunId ? '{}' : JSON.stringify(body) }, handleWorkflowEvent);
        } catch (error) {
            handleWorkflowEvent({ type: 'failed', error: error.message, timestamp: new Date().toISOString() });
        } finally {
            state.running = false;
            setRunControls(false);
        }
    }

    function handleWorkflowEvent(event) {
        if (event.run?.id) state.runId = Number(event.run.id);
        if (event.runId) state.runId = Number(event.runId);
        if (event.type === 'run') {
            updateProgress(0, 'Workflow queued');
            appendTimeline('Workflow queued', 'running');
        } else if (event.type === 'step') {
            appendTimeline(event.title || event.stepTitle || event.stepKey || 'Workflow step', event.status || 'running');
        } else if (event.type === 'progress') {
            updateProgress(Number(event.percentage ?? event.progressPercentage ?? event.progress ?? 0), event.currentStepTitle || event.currentStep || 'Running workflow');
        } else if (event.type === 'log') {
            appendLog(event.level || 'info', event.message || 'Workflow update', event.timestamp);
        } else if (event.type === 'snapshot' && event.run) {
            state.runId = Number(event.run.id || state.runId || 0) || state.runId;
            updateProgress(event.run.progressPercentage, `${event.run.workflowName || 'Weekly marketing'}: ${event.run.status || 'running'}`);
            if (['completed', 'failed', 'cancelled'].includes(event.run.status)) finishRunSubscription();
        } else if (event.type === 'completed') {
            updateProgress(100, 'Weekly marketing completed');
            appendTimeline('Workflow completed', 'completed');
            finishRunSubscription();
            toast('Weekly marketing completed with verified data.', 'success');
            void loadAll(true);
        } else if (event.type === 'failed') {
            appendTimeline('Workflow failed', 'failed');
            appendLog('error', event.error || 'Workflow failed.', event.timestamp);
            finishRunSubscription();
            showRetry(event.error || 'Workflow failed.');
            toast(event.error || 'Workflow failed.', 'error');
        }
    }

    function watchRun(runId) {
        state.runUnsubscribe?.();
        state.runUnsubscribe = null;
        state.running = true;
        state.runId = runId;
        setRunControls(true);
        let unsubscribe = null;
        unsubscribe = hooks.subscribe(`/api/workflow-runs/${runId}/events`, {
            onEvent: handleWorkflowEvent,
            onError: () => {
                if (state.runUnsubscribe === unsubscribe) {
                    state.runUnsubscribe();
                    state.runUnsubscribe = null;
                }
            }
        });
        state.runUnsubscribe = unsubscribe;
    }

    function finishRunSubscription() {
        state.runUnsubscribe?.();
        state.runUnsubscribe = null;
        state.running = false;
        setRunControls(false);
    }

    function connectRealtime() {
        state.businessUnsubscribe?.();
        state.businessUnsubscribe = null;
        let unsubscribe = null;
        unsubscribe = hooks.subscribe('/api/marketing/events', {
            onEvent: (event) => {
                elements.marketingLiveStatus.textContent = 'Live';
                elements.marketingLiveStatus.classList.add('is-live');
                if (event.type === 'run' && event.run?.id && !state.running) watchRun(Number(event.run.id));
                if (event.type === 'completed' || event.type === 'scheduled-failed') void loadAll(true);
            },
            onError: () => {
                elements.marketingLiveStatus.textContent = 'Polling';
                elements.marketingLiveStatus.classList.remove('is-live');
                if (state.businessUnsubscribe === unsubscribe) {
                    state.businessUnsubscribe();
                    state.businessUnsubscribe = null;
                }
            }
        });
        state.businessUnsubscribe = unsubscribe;
    }

    async function openRun(runId) {
        const payload = await hooks.fetchJson(`/api/workflow-runs/${runId}`);
        const run = payload.run;
        resetProgress();
        state.runId = run.id;
        updateProgress(run.progressPercentage, `${run.workflowName}: ${run.status}`);
        for (const step of run.steps || []) appendTimeline(step.title, step.status);
        for (const entry of run.logs || []) appendLog(entry.level, entry.message, entry.createdAt);
        if (run.status === 'failed') showRetry(run.error || 'Workflow failed.');
        await loadCampaigns(run.id);
        elements.marketingWorkflowProgress?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function saveSchedule() {
        const payload = {
            scheduleKind: elements.marketingScheduleKind.value,
            cadence: elements.marketingCadence.value,
            runHour: Number(elements.marketingRunHour.value),
            runMinute: Number(elements.marketingRunMinute.value),
            dayOfWeek: elements.marketingCadence.value === 'weekly' ? Number(elements.marketingDayOfWeek.value) : null,
            dayOfMonth: elements.marketingCadence.value === 'monthly' ? Number(elements.marketingDayOfMonth.value) : null,
            timezone: elements.marketingTimezone.value.trim(),
            enabled: elements.marketingScheduleEnabled.checked,
            input: { competitorScan: true }
        };
        const result = await hooks.fetchJson('/api/marketing/schedules', { method: 'PUT', body: JSON.stringify(payload) });
        toast(`Schedule saved. Next run ${new Date(result.schedule.nextRunAt).toLocaleString()}.`, 'success');
        await loadSchedules();
    }

    async function deleteSchedule(id) {
        await hooks.fetchJson(`/api/marketing/schedules/${id}`, { method: 'DELETE' });
        toast('Schedule removed.', 'success');
        await loadSchedules();
    }

    function populateSchedule(schedule) {
        elements.marketingScheduleKind.value = schedule.scheduleKind;
        elements.marketingCadence.value = schedule.cadence;
        elements.marketingRunHour.value = schedule.runHour;
        elements.marketingRunMinute.value = schedule.runMinute;
        if (schedule.dayOfWeek) elements.marketingDayOfWeek.value = schedule.dayOfWeek;
        if (schedule.dayOfMonth) elements.marketingDayOfMonth.value = schedule.dayOfMonth;
        elements.marketingTimezone.value = schedule.timezone;
        elements.marketingScheduleEnabled.checked = schedule.enabled;
        syncScheduleFields();
    }

    function resetScheduleForKind(kind) {
        const defaults = {
            'daily-summary': ['daily', 8, 0],
            'weekly-marketing': ['weekly', 8, 0],
            'monthly-report': ['monthly', 8, 0],
            'trend-detection': ['daily', 9, 0],
            'competitor-scan': ['weekly', 7, 30],
            'inventory-scan': ['daily', 7, 0],
            'campaign-optimizer': ['weekly', 10, 0],
            'forecast-generator': ['weekly', 6, 30]
        };
        const [cadence, hour, minute] = defaults[kind] || defaults['weekly-marketing'];
        elements.marketingCadence.value = cadence;
        elements.marketingRunHour.value = hour;
        elements.marketingRunMinute.value = minute;
        elements.marketingDayOfWeek.value = '1';
        elements.marketingDayOfMonth.value = '1';
        elements.marketingScheduleEnabled.checked = true;
        syncScheduleFields();
    }

    function syncScheduleFields() {
        const cadence = elements.marketingCadence?.value;
        elements.marketingDayOfWeek?.closest('label')?.toggleAttribute('hidden', cadence !== 'weekly');
        elements.marketingDayOfMonth?.closest('label')?.toggleAttribute('hidden', cadence !== 'monthly');
    }

    function initializeDateRange() {
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        elements.marketingFromDate.value = localDateInputValue(start);
        elements.marketingToDate.value = localDateInputValue(end);
    }

    function localDateInputValue(date) {
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function setLoading(loading) {
        if (loading && elements.marketingLiveMetricsGrid) elements.marketingLiveMetricsGrid.innerHTML = ui.skeleton(8);
        root.classList.toggle('is-loading', loading);
    }

    function setStatus(message, error = false) {
        if (!elements.marketingDataStatus) return;
        elements.marketingDataStatus.textContent = message;
        elements.marketingDataStatus.classList.toggle('error', error);
    }

    function dataStatus(workspace) {
        const timeZone = workspace.business?.timezone || undefined;
        const from = new Date(workspace.dataPeriod.from).toLocaleDateString(undefined, { timeZone });
        const to = new Date(new Date(workspace.dataPeriod.to).getTime() - 1).toLocaleDateString(undefined, { timeZone });
        const generated = new Date(workspace.generatedAt).toLocaleTimeString(undefined, { timeZone });
        return `${ui.number(workspace.recordsAnalyzed, 0)} verified records · ${from}–${to} · generated ${generated}`;
    }

    function resetProgress() {
        elements.marketingTimeline.innerHTML = '';
        elements.marketingLogs.innerHTML = '';
        updateProgress(0, 'Ready to execute');
    }

    function updateProgress(value, label) {
        const progress = Math.min(100, Math.max(0, Number(value || 0)));
        elements.marketingProgressBar.value = progress;
        elements.marketingProgressBar.textContent = `${progress}%`;
        elements.marketingProgressLabel.textContent = `${label} · ${progress}%`;
    }

    function appendTimeline(label, status) {
        const existing = [...elements.marketingTimeline.querySelectorAll('[data-step-label]')].find((item) => item.dataset.stepLabel === label);
        const markup = `<i class="fa-solid ${status === 'completed' ? 'fa-circle-check' : status === 'failed' ? 'fa-circle-xmark' : 'fa-circle-notch fa-spin'}" aria-hidden="true"></i><span><strong>${ui.escapeHtml(label)}</strong><small>${ui.escapeHtml(status)}</small></span>`;
        if (existing) { existing.className = `marketing-timeline-step status-${status}`; existing.innerHTML = markup; return; }
        elements.marketingTimeline.insertAdjacentHTML('beforeend', `<div class="marketing-timeline-step status-${ui.escapeHtml(status)}" data-step-label="${ui.escapeHtml(label)}">${markup}</div>`);
    }

    function appendLog(level, message, timestamp) {
        elements.marketingLogs.insertAdjacentHTML('beforeend', `<div class="marketing-log level-${ui.escapeHtml(level)}"><time>${ui.escapeHtml(new Date(timestamp || Date.now()).toLocaleTimeString())}</time><span>${ui.escapeHtml(message)}</span></div>`);
        elements.marketingLogs.scrollTop = elements.marketingLogs.scrollHeight;
    }

    function showRetry(message) {
        elements.marketingLogs.insertAdjacentHTML('beforeend', `<button class="secondary-action marketing-retry" type="button"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Retry failed workflow</button>`);
        elements.marketingLogs.querySelector('.marketing-retry:last-child')?.addEventListener('click', () => void runWorkflow(state.runId));
        setStatus(message, true);
    }

    function setRunControls(running) {
        elements.marketingRunBtn.disabled = running;
        elements.marketingRunBtn.innerHTML = running ? '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Running weekly marketing' : 'Run weekly marketing <i class="fa-solid fa-play" aria-hidden="true"></i>';
        root.classList.toggle('workflow-running', running);
    }

    function showError(error) { toast(error?.message || 'Marketing workspace could not be updated.', 'error'); }

    function toast(message, type) {
        if (!elements.marketingToastRegion) return;
        const node = document.createElement('div');
        node.className = `marketing-toast ${type}`;
        node.textContent = message;
        elements.marketingToastRegion.append(node);
        window.setTimeout(() => node.remove(), 5000);
    }
})();
