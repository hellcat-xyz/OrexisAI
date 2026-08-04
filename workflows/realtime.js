'use strict';

const crypto = require('node:crypto');

function createMarketingEventBroker({ heartbeatMs = 15_000, historySize = 250 } = {}) {
    const runSubscribers = new Map();
    const businessSubscribers = new Map();
    const histories = new Map();

    function publishRun(runId, event) {
        const key = String(runId);
        const normalized = normalizeEvent(event);
        appendHistory(key, normalized);
        for (const subscriber of runSubscribers.get(key) || []) subscriber(normalized);
    }

    function publishBusiness(businessId, event) {
        const key = String(businessId);
        const normalized = normalizeEvent(event);
        for (const subscriber of businessSubscribers.get(key) || []) subscriber(normalized);
        if (normalized.runId || normalized.run?.id) publishRun(normalized.runId || normalized.run.id, normalized);
    }

    function subscribeRun(runId, listener, { replay = true } = {}) {
        const key = String(runId);
        if (!runSubscribers.has(key)) runSubscribers.set(key, new Set());
        runSubscribers.get(key).add(listener);
        if (replay) for (const event of histories.get(key) || []) listener(event);
        return () => removeSubscriber(runSubscribers, key, listener);
    }

    function subscribeBusiness(businessId, listener) {
        const key = String(businessId);
        if (!businessSubscribers.has(key)) businessSubscribers.set(key, new Set());
        businessSubscribers.get(key).add(listener);
        return () => removeSubscriber(businessSubscribers, key, listener);
    }

    function openSse(res, subscribe, { initialEvent = null } = {}) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Content-Type-Options': 'nosniff'
        });
        res.write('retry: 3000\n\n');
        if (initialEvent) writeSse(res, normalizeEvent(initialEvent));
        const unsubscribe = subscribe((event) => writeSse(res, event));
        const heartbeat = setInterval(() => {
            if (!res.writableEnded && !res.destroyed) res.write(`: heartbeat ${Date.now()}\n\n`);
        }, heartbeatMs);
        heartbeat.unref?.();
        const close = () => {
            clearInterval(heartbeat);
            unsubscribe?.();
        };
        res.once('close', close);
        res.once('error', close);
        return close;
    }

    function appendHistory(key, event) {
        const history = histories.get(key) || [];
        history.push(event);
        if (history.length > historySize) history.splice(0, history.length - historySize);
        histories.set(key, history);
    }

    return {
        openSse,
        publishBusiness,
        publishRun,
        subscribeBusiness,
        subscribeRun
    };
}

function writeSse(res, event) {
    if (res.writableEnded || res.destroyed) return;
    const type = String(event.type || 'message').replace(/[^A-Za-z0-9_-]/g, '') || 'message';
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${type}\n`);
    const serialized = JSON.stringify(event).replace(/\u2028|\u2029/g, '');
    for (const line of serialized.split('\n')) res.write(`data: ${line}\n`);
    res.write('\n');
}

function normalizeEvent(event) {
    return {
        id: event?.id || crypto.randomUUID(),
        timestamp: event?.timestamp || new Date().toISOString(),
        ...(event && typeof event === 'object' ? event : { type: 'message', value: event })
    };
}

function removeSubscriber(map, key, listener) {
    const subscribers = map.get(key);
    if (!subscribers) return;
    subscribers.delete(listener);
    if (subscribers.size === 0) map.delete(key);
}

module.exports = { createMarketingEventBroker, normalizeEvent, writeSse };
