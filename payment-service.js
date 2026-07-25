'use strict';

const crypto = require('node:crypto');
const { getPaidPlanById } = require('./plans');

const REQUEST_TIMEOUT_MS = 15_000;
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const PAYPAL_API_BASES = Object.freeze({
    sandbox: 'https://api-m.sandbox.paypal.com',
    live: 'https://api-m.paypal.com'
});

class PaymentError extends Error {
    constructor(message, { statusCode = 400, publicMessage = message, code = 'PAYMENT_ERROR' } = {}) {
        super(message);
        this.name = 'PaymentError';
        this.statusCode = statusCode;
        this.publicMessage = publicMessage;
        this.code = code;
    }
}

function createPaymentService({ database, env = process.env, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('This application requires Node.js 18 or newer with global fetch support.');
    }

    const razorpay = {
        keyId: String(env.RAZORPAY_KEY_ID || '').trim(),
        keySecret: String(env.RAZORPAY_KEY_SECRET || '').trim()
    };
    razorpay.isConfigured = Boolean(razorpay.keyId && razorpay.keySecret);

    const paypalMode = String(env.PAYPAL_MODE || 'sandbox').trim().toLowerCase();
    if (!PAYPAL_API_BASES[paypalMode]) {
        throw new Error('PAYPAL_MODE must be either sandbox or live.');
    }
    const paypal = {
        mode: paypalMode,
        apiBase: PAYPAL_API_BASES[paypalMode],
        clientId: String(env.PAYPAL_CLIENT_ID || '').trim(),
        clientSecret: String(env.PAYPAL_CLIENT_SECRET || '').trim()
    };
    paypal.isConfigured = Boolean(paypal.clientId && paypal.clientSecret);

    return {
        getPublicConfiguration() {
            return {
                razorpay: { isConfigured: razorpay.isConfigured, keyId: razorpay.keyId },
                paypal: { isConfigured: paypal.isConfigured, clientId: paypal.clientId, mode: paypal.mode }
            };
        },

        async createRazorpayOrder({ userId, planId }) {
            assertConfigured(razorpay.isConfigured, 'Razorpay');
            const plan = requirePaidPlan(planId);
            const receipt = createReceipt('rzp');
            const order = await requestJson(fetchImpl, `${RAZORPAY_API_BASE}/orders`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    Authorization: basicAuthorization(razorpay.keyId, razorpay.keySecret),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: plan.inrPaise,
                    currency: 'INR',
                    receipt,
                    notes: { user_id: String(userId), plan_id: plan.id }
                })
            }, 'Razorpay order creation');

            if (!isProviderId(order.id, 'order_')) {
                throw providerFailure('Razorpay returned an invalid order ID.');
            }

            await database.createPendingPayment({
                userId,
                provider: 'razorpay',
                planId: plan.id,
                providerOrderId: order.id,
                amountMinor: plan.inrPaise,
                currency: 'INR'
            });

            return {
                orderId: order.id,
                amount: plan.inrPaise,
                currency: 'INR',
                keyId: razorpay.keyId,
                plan: publicPlan(plan)
            };
        },

        async verifyRazorpayPayment({ userId, planId, orderId, paymentId, signature }) {
            assertConfigured(razorpay.isConfigured, 'Razorpay');
            const plan = requirePaidPlan(planId);
            assertProviderId(orderId, 'order_', 'Razorpay order');
            assertProviderId(paymentId, 'pay_', 'Razorpay payment');

            if (!verifyRazorpaySignature({ orderId, paymentId, signature, keySecret: razorpay.keySecret })) {
                throw new PaymentError('Razorpay signature verification failed.', {
                    statusCode: 400,
                    publicMessage: 'The Razorpay payment could not be verified.',
                    code: 'INVALID_RAZORPAY_SIGNATURE'
                });
            }

            const pending = await database.findPaymentByProviderOrder({
                userId,
                provider: 'razorpay',
                providerOrderId: orderId
            });
            assertPendingPaymentMatches(pending, plan, 'INR', plan.inrPaise);
            if (pending.status === 'completed') {
                return { success: true, plan: publicPlan(plan), alreadyCompleted: true };
            }

            let payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, {
                method: 'GET'
            });
            assertRazorpayPayment(payment, { orderId, paymentId, amount: plan.inrPaise });

            if (payment.status === 'authorized' && payment.captured !== true) {
                payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ amount: String(plan.inrPaise), currency: 'INR' }).toString()
                });
                assertRazorpayPayment(payment, { orderId, paymentId, amount: plan.inrPaise });
            }

            if (payment.status !== 'captured' || payment.captured !== true) {
                throw new PaymentError(`Razorpay payment is ${payment.status || 'not captured'}.`, {
                    statusCode: 409,
                    publicMessage: 'The payment is not captured yet. Please check the transaction and try again.',
                    code: 'RAZORPAY_NOT_CAPTURED'
                });
            }

            await database.completePayment({
                userId,
                provider: 'razorpay',
                planId: plan.id,
                providerOrderId: orderId,
                providerPaymentId: paymentId,
                amountMinor: plan.inrPaise,
                currency: 'INR'
            });

            return { success: true, plan: publicPlan(plan) };
        },

        async createPayPalOrder({ userId, planId }) {
            assertConfigured(paypal.isConfigured, 'PayPal');
            const plan = requirePaidPlan(planId);
            const accessToken = await getPayPalAccessToken();
            const order = await requestJson(fetchImpl, `${paypal.apiBase}/v2/checkout/orders`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'PayPal-Request-Id': createReceipt('pp')
                },
                body: JSON.stringify({
                    intent: 'CAPTURE',
                    purchase_units: [{
                        reference_id: plan.id,
                        custom_id: `${userId}:${plan.id}`.slice(0, 127),
                        description: `OutcomeAI ${plan.name} plan - 30 days`,
                        amount: {
                            currency_code: 'USD',
                            value: minorToDecimal(plan.usdCents)
                        }
                    }]
                })
            }, 'PayPal order creation');

            if (!isPayPalOrderId(order.id)) {
                throw providerFailure('PayPal returned an invalid order ID.');
            }

            await database.createPendingPayment({
                userId,
                provider: 'paypal',
                planId: plan.id,
                providerOrderId: order.id,
                amountMinor: plan.usdCents,
                currency: 'USD'
            });

            return { orderId: order.id };
        },

        async capturePayPalOrder({ userId, planId, orderId }) {
            assertConfigured(paypal.isConfigured, 'PayPal');
            const plan = requirePaidPlan(planId);
            if (!isPayPalOrderId(orderId)) {
                throw new PaymentError('Invalid PayPal order ID.', { publicMessage: 'Invalid PayPal order.' });
            }

            const pending = await database.findPaymentByProviderOrder({
                userId,
                provider: 'paypal',
                providerOrderId: orderId
            });
            assertPendingPaymentMatches(pending, plan, 'USD', plan.usdCents);
            if (pending.status === 'completed') {
                return { success: true, plan: publicPlan(plan), alreadyCompleted: true };
            }

            const accessToken = await getPayPalAccessToken();
            const captured = await requestJson(fetchImpl, `${paypal.apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'PayPal-Request-Id': createReceipt('capture')
                },
                body: '{}'
            }, 'PayPal order capture');

            const capture = validatePayPalCapture(captured, { plan, orderId });
            await database.completePayment({
                userId,
                provider: 'paypal',
                planId: plan.id,
                providerOrderId: orderId,
                providerPaymentId: capture.id,
                amountMinor: plan.usdCents,
                currency: 'USD'
            });

            return { success: true, plan: publicPlan(plan) };
        }
    };

    async function razorpayRequest(endpoint, options) {
        return requestJson(fetchImpl, `${RAZORPAY_API_BASE}${endpoint}`, {
            ...options,
            headers: {
                Accept: 'application/json',
                Authorization: basicAuthorization(razorpay.keyId, razorpay.keySecret),
                ...(options.headers || {})
            }
        }, 'Razorpay payment verification');
    }

    async function getPayPalAccessToken() {
        const token = await requestJson(fetchImpl, `${paypal.apiBase}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: basicAuthorization(paypal.clientId, paypal.clientSecret),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
        }, 'PayPal authentication');

        if (!token.access_token || typeof token.access_token !== 'string') {
            throw providerFailure('PayPal did not return an access token.');
        }
        return token.access_token;
    }
}

function requirePaidPlan(planId) {
    const plan = getPaidPlanById(planId);
    if (!plan) {
        throw new PaymentError('Unknown paid plan.', { publicMessage: 'Select a valid paid plan.' });
    }
    return plan;
}

function assertConfigured(isConfigured, providerName) {
    if (!isConfigured) {
        throw new PaymentError(`${providerName} is not configured.`, {
            statusCode: 503,
            publicMessage: `${providerName} checkout is not configured yet.`,
            code: 'PAYMENT_PROVIDER_NOT_CONFIGURED'
        });
    }
}

function assertPendingPaymentMatches(payment, plan, currency, amountMinor) {
    if (!payment) {
        throw new PaymentError('Pending payment was not found.', {
            statusCode: 404,
            publicMessage: 'This payment order was not found for your account.'
        });
    }
    if (payment.plan_id !== plan.id
        || payment.currency !== currency
        || Number(payment.amount_minor) !== amountMinor) {
        throw new PaymentError('Stored payment details do not match the requested plan.', {
            statusCode: 409,
            publicMessage: 'The payment details do not match the selected plan.'
        });
    }
}

function verifyRazorpaySignature({ orderId, paymentId, signature, keySecret }) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
        return false;
    }
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest();
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function assertRazorpayPayment(payment, { orderId, paymentId, amount }) {
    if (payment.id !== paymentId
        || payment.order_id !== orderId
        || Number(payment.amount) !== amount
        || payment.currency !== 'INR') {
        throw new PaymentError('Razorpay payment details did not match the order.', {
            statusCode: 409,
            publicMessage: 'The Razorpay payment details do not match this order.'
        });
    }
}

function validatePayPalCapture(order, { plan, orderId }) {
    const purchaseUnit = Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
    const captures = purchaseUnit?.payments?.captures;
    const capture = Array.isArray(captures) ? captures[0] : null;
    const amount = capture?.amount || purchaseUnit?.amount;

    if (order.id !== orderId
        || order.status !== 'COMPLETED'
        || purchaseUnit?.reference_id !== plan.id
        || amount?.currency_code !== 'USD'
        || amount?.value !== minorToDecimal(plan.usdCents)
        || !capture?.id
        || capture.status !== 'COMPLETED') {
        throw new PaymentError('PayPal capture details did not match the order.', {
            statusCode: 409,
            publicMessage: 'The PayPal payment could not be confirmed for this plan.'
        });
    }
    return capture;
}

async function requestJson(fetchImpl, url, options, operationName) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        const text = await response.text();
        let value = {};
        if (text) {
            try {
                value = JSON.parse(text);
            } catch {
                throw providerFailure(`${operationName} returned invalid JSON.`);
            }
        }
        if (!response.ok) {
            const detail = extractProviderError(value) || `HTTP ${response.status}`;
            throw providerFailure(`${operationName} failed: ${detail}`);
        }
        return value;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw providerFailure(`${operationName} timed out.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function extractProviderError(value) {
    if (typeof value?.error_description === 'string') return value.error_description;
    if (typeof value?.message === 'string') return value.message;
    if (typeof value?.error?.description === 'string') return value.error.description;
    if (Array.isArray(value?.details) && typeof value.details[0]?.description === 'string') {
        return value.details[0].description;
    }
    return '';
}

function providerFailure(message) {
    return new PaymentError(message, {
        statusCode: 502,
        publicMessage: 'The payment provider could not complete the request. Please try again.',
        code: 'PAYMENT_PROVIDER_ERROR'
    });
}

function basicAuthorization(username, password) {
    return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function minorToDecimal(minor) {
    return (minor / 100).toFixed(2);
}

function publicPlan(plan) {
    return { id: plan.id, name: plan.name };
}

function createReceipt(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`.slice(0, 40);
}

function isProviderId(value, prefix) {
    return typeof value === 'string'
        && value.startsWith(prefix)
        && /^[A-Za-z0-9_-]{6,80}$/.test(value);
}

function assertProviderId(value, prefix, label) {
    if (!isProviderId(value, prefix)) {
        throw new PaymentError(`Invalid ${label} ID.`, { publicMessage: `Invalid ${label} ID.` });
    }
}

function isPayPalOrderId(value) {
    return typeof value === 'string' && /^[A-Z0-9]{8,40}$/i.test(value);
}

module.exports = {
    PaymentError,
    createPaymentService,
    minorToDecimal,
    verifyRazorpaySignature,
    validatePayPalCapture
};
