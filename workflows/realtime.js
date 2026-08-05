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
        let closed = false;
        let heartbeat = null;
        let unsubscribe = null;
        const close = () => {
            if (closed) return;
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            unsubscribe?.();
        };

        res.once('close', close);
        res.once('error', close);
        if (res.writableEnded || res.destroyed) {
            close();
            return close;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Content-Type-Options': 'nosniff'
        });
        if (!writeRawSse(res, 'retry: 3000\n\n') || closed) {
            close();
            return close;
        }
        if (initialEvent && (!writeSse(res, normalizeEvent(initialEvent)) || closed)) {
            close();
            return close;
        }

        const nextUnsubscribe = subscribe((event) => {
            if (!closed && !writeSse(res, event)) close();
        });
        unsubscribe = typeof nextUnsubscribe === 'function' ? nextUnsubscribe : null;
        if (closed) {
            unsubscribe?.();
            return close;
        }

        heartbeat = setInterval(() => {
            if (!writeRawSse(res, `: heartbeat ${Date.now()}\n\n`)) close();
        }, heartbeatMs);
        heartbeat.unref?.();
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
    const type = String(event.type || 'message').replace(/[^A-Za-z0-9_-]/g, '') || 'message';
    const serialized = JSON.stringify(event).replace(/\u2028|\u2029/g, '');
    const data = serialized.split('\n').map((line) => `data: ${line}\n`).join('');
    return writeRawSse(res, `id: ${event.id}\nevent: ${type}\n${data}\n`);
}

function writeRawSse(res, frame) {
    if (res.writableEnded || res.destroyed) return false;
    try {
        res.write(frame);
        return !res.writableEnded && !res.destroyed;
    } catch (error) {
        if (res.writableEnded || res.destroyed || isExpectedStreamDisconnect(error)) return false;
        throw error;
    }
}

function isExpectedStreamDisconnect(error) {
    return ['ECONNRESET', 'EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(error?.code);
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
