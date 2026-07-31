'use strict';

const crypto = require('node:crypto');
const { getPaidPlanById, getPlanById } = require('./plans');

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
        keySecret: String(env.RAZORPAY_KEY_SECRET || '').trim(),
        webhookSecret: String(env.RAZORPAY_WEBHOOK_SECRET || '').trim()
    };
    razorpay.isConfigured = Boolean(razorpay.keyId && razorpay.keySecret);
    razorpay.isWebhookConfigured = Boolean(razorpay.webhookSecret);

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

        async getBillingProfile({ userId }) {
            return publicBilling(await database.getBillingProfile(userId));
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
            if (Number(order.amount) !== plan.inrPaise
                || order.currency !== 'INR'
                || order.status !== 'created') {
                throw providerFailure('Razorpay returned order details that do not match the selected plan.');
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
            assertProviderId(orderId, 'order_', 'Razorpay order');
            assertProviderId(paymentId, 'pay_', 'Razorpay payment');

            const pending = await database.findPaymentByProviderOrder({
                userId,
                provider: 'razorpay',
                providerOrderId: orderId
            });
            if (!pending) {
                throw new PaymentError('Pending payment was not found.', {
                    statusCode: 404,
                    publicMessage: 'This Razorpay order was not found for your account.',
                    code: 'PAYMENT_NOT_FOUND'
                });
            }
            const plan = requirePaidPlan(pending.plan_id);
            if (planId && normalizePlanId(planId) !== plan.id) {
                throw new PaymentError('Selected plan does not match the stored Razorpay order.', {
                    statusCode: 409,
                    publicMessage: 'The payment does not match the selected plan.',
                    code: 'PAYMENT_PLAN_MISMATCH'
                });
            }
            assertPendingPaymentMatches(pending, plan, 'INR', plan.inrPaise);

            if (!verifyRazorpaySignature({
                orderId: pending.provider_order_id,
                paymentId,
                signature,
                keySecret: razorpay.keySecret
            })) {
                throw new PaymentError('Razorpay signature verification failed.', {
                    statusCode: 400,
                    publicMessage: 'The Razorpay payment could not be verified.',
                    code: 'INVALID_RAZORPAY_SIGNATURE'
                });
            }

            if (pending.status === 'completed' || pending.status === 'partially_refunded') {
                if (pending.provider_payment_id !== paymentId) {
                    throw new PaymentError('Razorpay order was completed with another payment.', {
                        statusCode: 409,
                        publicMessage: 'This Razorpay order has already been completed.',
                        code: 'PAYMENT_ALREADY_COMPLETED'
                    });
                }
                const billing = publicBilling(await database.getBillingProfile(userId));
                return {
                    success: true,
                    paymentStatus: pending.status,
                    plan: publicPlan(plan),
                    billing,
                    alreadyCompleted: true
                };
            }
            if (pending.status === 'refunded') {
                throw new PaymentError('Razorpay payment was refunded.', {
                    statusCode: 409,
                    publicMessage: 'This payment has been refunded and cannot activate a plan.',
                    code: 'PAYMENT_REFUNDED'
                });
            }

            let payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, {
                method: 'GET'
            });
            assertRazorpayPayment(payment, { orderId: pending.provider_order_id, paymentId, amount: plan.inrPaise });

            if (payment.status === 'authorized' && payment.captured !== true) {
                payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount: plan.inrPaise, currency: 'INR' })
                });
                assertRazorpayPayment(payment, { orderId: pending.provider_order_id, paymentId, amount: plan.inrPaise });
            }

            if (payment.status === 'failed') {
                await database.markPaymentStatus({
                    userId,
                    provider: 'razorpay',
                    providerOrderId: pending.provider_order_id,
                    providerPaymentId: paymentId,
                    status: 'failed',
                    failureReason: payment.error_description || payment.error_reason || 'Razorpay payment failed.'
                });
                throw new PaymentError('Razorpay payment failed.', {
                    statusCode: 409,
                    publicMessage: payment.error_description || 'Razorpay reported that the payment failed.',
                    code: 'RAZORPAY_PAYMENT_FAILED'
                });
            }

            if (payment.status !== 'captured' || payment.captured !== true) {
                await database.markPaymentStatus({
                    userId,
                    provider: 'razorpay',
                    providerOrderId: pending.provider_order_id,
                    providerPaymentId: paymentId,
                    status: payment.status === 'authorized' ? 'authorized' : 'pending'
                });
                throw new PaymentError(`Razorpay payment is ${payment.status || 'pending'}.`, {
                    statusCode: 409,
                    publicMessage: 'The payment is still pending capture. Your plan will activate as soon as Razorpay confirms it.',
                    code: 'RAZORPAY_PAYMENT_PENDING'
                });
            }

            const completed = await database.completePayment({
                userId,
                provider: 'razorpay',
                planId: plan.id,
                providerOrderId: pending.provider_order_id,
                providerPaymentId: paymentId,
                amountMinor: plan.inrPaise,
                currency: 'INR'
            });
            const billing = publicBilling(completed.billing || await database.getBillingProfile(userId));

            return {
                success: true,
                paymentStatus: 'completed',
                plan: publicPlan(plan),
                billing,
                alreadyCompleted: completed.alreadyCompleted === true
            };
        },

        async getRazorpayOrderStatus({ userId, orderId }) {
            assertConfigured(razorpay.isConfigured, 'Razorpay');
            assertProviderId(orderId, 'order_', 'Razorpay order');
            let payment = await database.findPaymentByProviderOrder({
                userId,
                provider: 'razorpay',
                providerOrderId: orderId
            });
            if (!payment) {
                throw new PaymentError('Razorpay order was not found.', {
                    statusCode: 404,
                    publicMessage: 'This Razorpay order was not found for your account.',
                    code: 'PAYMENT_NOT_FOUND'
                });
            }

            const plan = requirePaidPlan(payment.plan_id);
            assertPendingPaymentMatches(payment, plan, 'INR', plan.inrPaise);
            if (!['completed', 'partially_refunded', 'refunded'].includes(payment.status)) {
                const reconciled = await reconcileRazorpayOrder({ userId, payment, plan });
                if (reconciled?.billing) {
                    return {
                        orderId,
                        paymentStatus: reconciled.paymentStatus,
                        plan: publicPlan(plan),
                        billing: reconciled.billing
                    };
                }
                payment = await database.findPaymentByProviderOrder({
                    userId,
                    provider: 'razorpay',
                    providerOrderId: orderId
                }) || payment;
            }

            return {
                orderId,
                paymentStatus: payment.status,
                plan: publicPlan(plan),
                billing: publicBilling(await database.getBillingProfile(userId))
            };
        },

        async cancelRazorpayOrder({ userId, orderId }) {
            assertProviderId(orderId, 'order_', 'Razorpay order');
            const payment = await database.findPaymentByProviderOrder({
                userId,
                provider: 'razorpay',
                providerOrderId: orderId
            });
            if (!payment) {
                return { cancelled: false, paymentStatus: 'not_found' };
            }
            if (['completed', 'partially_refunded', 'refunded'].includes(payment.status)) {
                return { cancelled: false, paymentStatus: payment.status };
            }
            const cancelled = await database.markPaymentCancelled({
                userId,
                provider: 'razorpay',
                providerOrderId: orderId
            });
            return { cancelled: Boolean(cancelled), paymentStatus: cancelled?.status || payment.status };
        },

        async recordRazorpayCheckoutFailure({ userId, orderId, paymentId }) {
            assertConfigured(razorpay.isConfigured, 'Razorpay');
            assertProviderId(orderId, 'order_', 'Razorpay order');
            const pending = await database.findPaymentByProviderOrder({
                userId,
                provider: 'razorpay',
                providerOrderId: orderId
            });
            if (!pending) {
                return { handled: false, paymentStatus: 'not_found' };
            }
            if (['completed', 'partially_refunded', 'refunded'].includes(pending.status)) {
                return { handled: false, paymentStatus: pending.status };
            }
            if (!paymentId) {
                return { handled: false, paymentStatus: pending.status };
            }
            assertProviderId(paymentId, 'pay_', 'Razorpay payment');
            const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
            assertRazorpayPayment(payment, {
                orderId: pending.provider_order_id,
                paymentId,
                amount: Number(pending.amount_minor)
            });
            if (payment.status !== 'failed') {
                return { handled: false, paymentStatus: payment.status || pending.status };
            }
            await database.markPaymentStatus({
                userId,
                provider: 'razorpay',
                providerOrderId: pending.provider_order_id,
                providerPaymentId: paymentId,
                status: 'failed',
                failureReason: payment.error_description || payment.error_reason || 'Razorpay payment failed.'
            });
            return { handled: true, paymentStatus: 'failed' };
        },

        async handleRazorpayWebhook({ rawBody, signature, eventId }) {
            assertConfigured(razorpay.isWebhookConfigured, 'Razorpay webhook');
            if (!verifyRazorpayWebhookSignature({
                rawBody,
                signature,
                webhookSecret: razorpay.webhookSecret
            })) {
                throw new PaymentError('Razorpay webhook signature verification failed.', {
                    statusCode: 400,
                    publicMessage: 'Invalid Razorpay webhook signature.',
                    code: 'INVALID_RAZORPAY_WEBHOOK_SIGNATURE'
                });
            }

            const event = parseRazorpayWebhookEvent(rawBody);
            const webhookEventId = normalizeWebhookEventId(eventId)
                || `body_${crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 58)}`;
            const eventType = event.event;
            const providerCreatedAt = Number.isInteger(event.created_at)
                ? new Date(event.created_at * 1000)
                : null;
            const payment = event.payload?.payment?.entity;
            const order = event.payload?.order?.entity;
            const refund = event.payload?.refund?.entity;
            const orderId = payment?.order_id || order?.id || null;
            const paymentId = payment?.id || refund?.payment_id || null;

            if (eventType === 'payment.failed' || eventType === 'payment.authorized') {
                assertProviderId(orderId, 'order_', 'Razorpay order');
                assertProviderId(paymentId, 'pay_', 'Razorpay payment');
                const pending = await database.findPaymentByProviderOrderAnyUser({
                    provider: 'razorpay',
                    providerOrderId: orderId
                });
                if (!pending) {
                    await database.recordPaymentWebhookEvent({
                        provider: 'razorpay',
                        eventId: webhookEventId,
                        eventType,
                        providerOrderId: orderId,
                        providerPaymentId: paymentId,
                        status: 'ignored',
                        providerCreatedAt
                    });
                    return { received: true, handled: false };
                }
                assertRazorpayPayment(payment, {
                    orderId,
                    paymentId,
                    amount: Number(pending.amount_minor)
                });
                const state = await database.recordPaymentStateFromWebhook({
                    provider: 'razorpay',
                    eventId: webhookEventId,
                    eventType,
                    providerOrderId: orderId,
                    providerPaymentId: paymentId,
                    paymentStatus: eventType === 'payment.failed' ? 'failed' : 'authorized',
                    failureReason: payment.error_description || payment.error_reason || null,
                    providerCreatedAt
                });
                return { received: true, handled: state.handled, duplicate: state.duplicate === true };
            }

            if (eventType === 'refund.processed') {
                assertProviderId(paymentId, 'pay_', 'Razorpay payment');
                assertProviderId(orderId, 'order_', 'Razorpay order');
                assertProviderId(refund?.id, 'rfnd_', 'Razorpay refund');
                const storedPayment = await database.findPaymentByProviderPaymentAnyUser({
                    provider: 'razorpay',
                    providerPaymentId: paymentId
                });
                if (!storedPayment) {
                    await database.recordPaymentWebhookEvent({
                        provider: 'razorpay',
                        eventId: webhookEventId,
                        eventType,
                        providerOrderId: orderId,
                        providerPaymentId: paymentId,
                        status: 'ignored',
                        providerCreatedAt
                    });
                    return { received: true, handled: false };
                }
                assertRazorpayPayment(payment, {
                    orderId: storedPayment.provider_order_id,
                    paymentId,
                    amount: Number(storedPayment.amount_minor)
                });
                if (refund.status !== 'processed'
                    || refund.payment_id !== paymentId
                    || refund.currency !== storedPayment.currency
                    || !Number.isInteger(Number(refund.amount))) {
                    throw new PaymentError('Razorpay refund details did not match the payment.', {
                        statusCode: 409,
                        publicMessage: 'Razorpay refund details do not match the stored payment.',
                        code: 'RAZORPAY_REFUND_MISMATCH'
                    });
                }
                const processed = await database.processPaymentRefundFromWebhook({
                    eventId: webhookEventId,
                    eventType,
                    providerCreatedAt,
                    provider: 'razorpay',
                    providerOrderId: storedPayment.provider_order_id,
                    providerPaymentId: paymentId,
                    providerRefundId: refund.id,
                    refundAmountMinor: Number(refund.amount),
                    paymentAmountMinor: Number(storedPayment.amount_minor),
                    currency: storedPayment.currency
                });
                return {
                    received: true,
                    handled: processed.handled,
                    duplicate: processed.duplicate === true,
                    fullyRefunded: processed.fullyRefunded === true
                };
            }

            if (eventType === 'refund.created' || eventType === 'refund.failed') {
                await database.recordPaymentWebhookEvent({
                    provider: 'razorpay',
                    eventId: webhookEventId,
                    eventType,
                    providerOrderId: orderId,
                    providerPaymentId: paymentId,
                    status: 'ignored',
                    providerCreatedAt
                });
                return { received: true, handled: false };
            }

            if (eventType !== 'payment.captured' && eventType !== 'order.paid') {
                await database.recordPaymentWebhookEvent({
                    provider: 'razorpay',
                    eventId: webhookEventId,
                    eventType,
                    providerOrderId: orderId,
                    providerPaymentId: paymentId,
                    status: 'ignored',
                    providerCreatedAt
                });
                return { received: true, handled: false };
            }

            assertProviderId(orderId, 'order_', 'Razorpay order');
            assertProviderId(paymentId, 'pay_', 'Razorpay payment');
            const pending = await database.findPaymentByProviderOrderAnyUser({
                provider: 'razorpay',
                providerOrderId: orderId
            });
            if (!pending) {
                await database.recordPaymentWebhookEvent({
                    provider: 'razorpay',
                    eventId: webhookEventId,
                    eventType,
                    providerOrderId: orderId,
                    providerPaymentId: paymentId,
                    status: 'ignored',
                    providerCreatedAt
                });
                return { received: true, handled: false };
            }

            const plan = requirePaidPlan(pending.plan_id);
            assertPendingPaymentMatches(pending, plan, 'INR', plan.inrPaise);
            assertRazorpayPayment(payment, {
                orderId,
                paymentId,
                amount: plan.inrPaise
            });
            if (payment.status !== 'captured' || payment.captured !== true) {
                throw new PaymentError('Razorpay webhook payment is not captured.', {
                    statusCode: 409,
                    publicMessage: 'Razorpay payment is not captured.',
                    code: 'RAZORPAY_WEBHOOK_NOT_CAPTURED'
                });
            }
            if (order && (order.id !== orderId
                || order.currency !== 'INR'
                || Number(order.amount) !== plan.inrPaise
                || (eventType === 'order.paid' && order.status !== 'paid'))) {
                throw new PaymentError('Razorpay webhook order details did not match.', {
                    statusCode: 409,
                    publicMessage: 'Razorpay webhook order details do not match.',
                    code: 'RAZORPAY_WEBHOOK_ORDER_MISMATCH'
                });
            }

            const completed = await database.completePaymentFromWebhook({
                eventId: webhookEventId,
                eventType,
                providerCreatedAt,
                userId: pending.user_id,
                provider: 'razorpay',
                planId: plan.id,
                providerOrderId: orderId,
                providerPaymentId: paymentId,
                amountMinor: plan.inrPaise,
                currency: 'INR'
            });

            return {
                received: true,
                handled: true,
                duplicate: completed.duplicate === true
            };
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
                        description: `OrexisAI ${plan.name} plan - 30 days`,
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
            if (pending.status === 'completed' || pending.status === 'partially_refunded') {
                return {
                    success: true,
                    paymentStatus: pending.status,
                    plan: publicPlan(plan),
                    billing: publicBilling(await database.getBillingProfile(userId)),
                    alreadyCompleted: true
                };
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
            const completed = await database.completePayment({
                userId,
                provider: 'paypal',
                planId: plan.id,
                providerOrderId: orderId,
                providerPaymentId: capture.id,
                amountMinor: plan.usdCents,
                currency: 'USD'
            });

            return {
                success: true,
                paymentStatus: 'completed',
                plan: publicPlan(plan),
                billing: publicBilling(completed.billing || await database.getBillingProfile(userId)),
                alreadyCompleted: completed.alreadyCompleted === true
            };
        }
    };

    async function reconcileRazorpayOrder({ userId, payment, plan }) {
        const collection = await razorpayRequest(`/orders/${encodeURIComponent(payment.provider_order_id)}/payments`, {
            method: 'GET'
        });
        if (!collection || !Array.isArray(collection.items)) {
            throw providerFailure('Razorpay returned an invalid order payment list.');
        }

        const matchingPayments = collection.items
            .filter((item) => item
                && isProviderId(item.id, 'pay_')
                && item.order_id === payment.provider_order_id
                && Number(item.amount) === plan.inrPaise
                && item.currency === 'INR')
            .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0));
        let confirmed = matchingPayments.find((item) => item.status === 'captured' && item.captured === true) || null;
        const authorized = matchingPayments.find((item) => item.status === 'authorized' && item.captured !== true) || null;

        if (!confirmed && authorized) {
            confirmed = await razorpayRequest(`/payments/${encodeURIComponent(authorized.id)}/capture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: plan.inrPaise, currency: 'INR' })
            });
            assertRazorpayPayment(confirmed, {
                orderId: payment.provider_order_id,
                paymentId: authorized.id,
                amount: plan.inrPaise
            });
        }

        if (confirmed?.status === 'captured' && confirmed.captured === true) {
            const completed = await database.completePayment({
                userId,
                provider: 'razorpay',
                planId: plan.id,
                providerOrderId: payment.provider_order_id,
                providerPaymentId: confirmed.id,
                amountMinor: plan.inrPaise,
                currency: 'INR'
            });
            return {
                paymentStatus: 'completed',
                billing: publicBilling(completed.billing || await database.getBillingProfile(userId))
            };
        }

        const activeAttempt = matchingPayments.find((item) => ['created', 'authorized'].includes(item.status));
        const failedAttempt = matchingPayments.find((item) => item.status === 'failed');
        if (!activeAttempt && failedAttempt) {
            await database.markPaymentStatus({
                userId,
                provider: 'razorpay',
                providerOrderId: payment.provider_order_id,
                providerPaymentId: failedAttempt.id,
                status: 'failed',
                failureReason: failedAttempt.error_description || failedAttempt.error_reason || 'Razorpay payment failed.'
            });
        } else if (activeAttempt) {
            await database.markPaymentStatus({
                userId,
                provider: 'razorpay',
                providerOrderId: payment.provider_order_id,
                providerPaymentId: activeAttempt.id,
                status: activeAttempt.status === 'authorized' ? 'authorized' : 'pending'
            });
        }
        return null;
    }

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

function normalizePlanId(planId) {
    return String(planId || '').trim().toLowerCase();
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

function verifyRazorpayWebhookSignature({ rawBody, signature, webhookSecret }) {
    if ((!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string')
        || typeof webhookSecret !== 'string'
        || webhookSecret.length === 0
        || typeof signature !== 'string'
        || !/^[a-f0-9]{64}$/i.test(signature)) {
        return false;
    }
    const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest();
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function parseRazorpayWebhookEvent(rawBody) {
    let event;
    try {
        event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
    } catch {
        throw new PaymentError('Razorpay webhook contained invalid JSON.', {
            statusCode: 400,
            publicMessage: 'Invalid Razorpay webhook payload.',
            code: 'INVALID_RAZORPAY_WEBHOOK_PAYLOAD'
        });
    }
    if (!event
        || typeof event !== 'object'
        || Array.isArray(event)
        || event.entity !== 'event'
        || typeof event.event !== 'string'
        || !event.payload
        || typeof event.payload !== 'object'
        || Array.isArray(event.payload)) {
        throw new PaymentError('Razorpay webhook payload is malformed.', {
            statusCode: 400,
            publicMessage: 'Malformed Razorpay webhook payload.',
            code: 'INVALID_RAZORPAY_WEBHOOK_PAYLOAD'
        });
    }
    return event;
}

function normalizeWebhookEventId(value) {
    const eventId = String(value || '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(eventId) ? eventId : '';
}

function assertRazorpayPayment(payment, { orderId, paymentId, amount }) {
    if (!payment
        || typeof payment !== 'object'
        || payment.id !== paymentId
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
    return {
        id: plan.id,
        name: plan.name,
        usdCents: plan.usdCents,
        inrPaise: plan.inrPaise
    };
}

function publicBilling(profile) {
    const plan = getPlanById(profile?.current_plan) || getPlanById('free');
    return {
        currentPlanId: plan.id,
        currentPlanName: plan.name,
        planExpiresAt: profile?.plan_expires_at || null
    };
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
    verifyRazorpayWebhookSignature,
    parseRazorpayWebhookEvent,
    validatePayPalCapture
};
