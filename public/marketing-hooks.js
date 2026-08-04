'use strict';

(() => {
    const activeRequests = new Map();

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.error || `Request failed with ${response.status}.`);
            error.status = response.status;
            error.code = payload.code || null;
            throw error;
        }
        return payload;
    }

    async function streamNdjson(url, options, onEvent) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json', ...(options?.headers || {}) },
            ...options
        });
        if (!response.ok || !response.body) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || 'Workflow stream could not be opened.');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let lineEnd;
            while ((lineEnd = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, lineEnd).trim();
                buffer = buffer.slice(lineEnd + 1);
                if (!line) continue;
                const event = JSON.parse(line);
                onEvent?.(event);
            }
        }
        if (buffer.trim()) onEvent?.(JSON.parse(buffer));
    }

    function subscribe(url, handlers = {}) {
        const source = new EventSource(url, { withCredentials: true });
        const eventTypes = ['connected', 'snapshot', 'run', 'status', 'step', 'progress', 'log', 'completed', 'failed', 'scheduled-failed'];
        for (const type of eventTypes) source.addEventListener(type, (event) => handlers.onEvent?.(JSON.parse(event.data)));
        source.onerror = (event) => handlers.onError?.(event);
        return () => source.close();
    }

    function createPoller(task, { intervalMs = 30_000, immediate = true, onError = () => {} } = {}) {
        let timer = null;
        let stopped = false;
        let running = false;
        const run = async () => {
            if (stopped || running || document.hidden) return;
            running = true;
            try { await task(); } catch (error) { onError(error); } finally { running = false; }
        };
        if (immediate) void run();
        timer = window.setInterval(run, Math.max(5_000, intervalMs));
        const visibility = () => { if (!document.hidden) void run(); };
        document.addEventListener('visibilitychange', visibility);
        return {
            refresh: run,
            stop() { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); }
        };
    }

    function replaceRequest(key) {
        activeRequests.get(key)?.abort();
        const controller = new AbortController();
        activeRequests.set(key, controller);
        return controller;
    }

    function releaseRequest(key, controller) {
        if (activeRequests.get(key) === controller) activeRequests.delete(key);
    }

    window.OrexisMarketingHooks = Object.freeze({
        createPoller,
        fetchJson,
        releaseRequest,
        replaceRequest,
        streamNdjson,
        subscribe
    });
})();
