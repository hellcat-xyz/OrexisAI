'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { getPaidPlanById } = require('../plans');
const {
    createPaymentService,
    minorToDecimal,
    validatePayPalCapture,
    verifyRazorpaySignature,
    verifyRazorpayWebhookSignature
} = require('../payment-service');
const { renderDashboardPage } = require('../views/dashboard');

test('Razorpay signatures are verified with a timing-safe HMAC comparison', () => {
    const keySecret = 'test_secret';
    const orderId = 'order_ABC123456';
    const paymentId = 'pay_XYZ123456';
    const signature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    assert.equal(verifyRazorpaySignature({ orderId, paymentId, signature, keySecret }), true);
    assert.equal(verifyRazorpaySignature({ orderId, paymentId, signature: '0'.repeat(64), keySecret }), false);
});

test('Razorpay webhook signatures use the exact raw request body', () => {
    const webhookSecret = 'webhook_test_secret';
    const rawBody = Buffer.from('{"entity":"event","event":"payment.captured","payload":{}}');
    const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

    assert.equal(verifyRazorpayWebhookSignature({ rawBody, signature, webhookSecret }), true);
    assert.equal(verifyRazorpayWebhookSignature({
        rawBody: Buffer.from(`${rawBody.toString('utf8')} `),
        signature,
        webhookSecret
    }), false);
});

test('captured Razorpay webhooks complete the stored payment idempotently', async () => {
    const plan = getPaidPlanById('pro');
    const webhookSecret = 'webhook_test_secret';
    const calls = [];
    const database = {
        async findPaymentByProviderOrderAnyUser({ provider, providerOrderId }) {
            assert.equal(provider, 'razorpay');
            assert.equal(providerOrderId, 'order_TEST123');
            return {
                user_id: 42,
                plan_id: plan.id,
                amount_minor: plan.inrPaise,
                currency: 'INR',
                status: 'pending'
            };
        },
        async completePaymentFromWebhook(input) {
            calls.push(input);
            return { completed: true, duplicate: false };
        },
        async recordPaymentWebhookEvent() {
            throw new Error('captured webhook should not be ignored');
        }
    };
    const service = createPaymentService({
        database,
        env: {
            RAZORPAY_KEY_ID: 'rzp_test_public',
            RAZORPAY_KEY_SECRET: 'test_key_secret',
            RAZORPAY_WEBHOOK_SECRET: webhookSecret
        },
        fetchImpl: async () => {
            throw new Error('webhook processing should not call Razorpay API');
        }
    });
    const event = {
        entity: 'event',
        event: 'payment.captured',
        created_at: 1_700_000_000,
        payload: {
            payment: {
                entity: {
                    id: 'pay_TEST123',
                    order_id: 'order_TEST123',
                    amount: plan.inrPaise,
                    currency: 'INR',
                    status: 'captured',
                    captured: true
                }
            }
        }
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

    const result = await service.handleRazorpayWebhook({
        rawBody,
        signature,
        eventId: 'event_TEST123'
    });

    assert.deepEqual(result, { received: true, handled: true, duplicate: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].userId, 42);
    assert.equal(calls[0].providerOrderId, 'order_TEST123');
    assert.equal(calls[0].providerPaymentId, 'pay_TEST123');
    assert.equal(calls[0].eventId, 'event_TEST123');
});

test('PayPal capture validation checks order, plan, amount, currency and capture state', () => {
    const plan = getPaidPlanById('pro');
    const orderId = '5O190127TN364715T';
    const capture = validatePayPalCapture({
        id: orderId,
        status: 'COMPLETED',
        purchase_units: [{
            reference_id: plan.id,
            amount: { currency_code: 'USD', value: minorToDecimal(plan.usdCents) },
            payments: {
                captures: [{
                    id: '3C679366HH908993F',
                    status: 'COMPLETED',
                    amount: { currency_code: 'USD', value: minorToDecimal(plan.usdCents) }
                }]
            }
        }]
    }, { plan, orderId });

    assert.equal(capture.id, '3C679366HH908993F');
});

test('dashboard renders all plans and keeps gateway secrets out of the page', () => {
    const plans = [
        { id: 'free', name: 'Free', tagline: 'Free', usdCents: 0, inrPaise: 0, featured: false, features: ['One'] },
        { id: 'pro', name: 'Pro', tagline: 'Pro', usdCents: 2900, inrPaise: 249900, featured: true, features: ['Two'] }
    ];
    const html = renderDashboardPage({
        user: { email: 'user@example.com', displayName: 'User', initials: 'U' },
        plans,
        billing: { currentPlanId: 'free', planExpiresAt: null },
        paymentConfiguration: {
            razorpay: { isConfigured: true, keyId: 'rzp_test_public' },
            paypal: { isConfigured: true, clientId: 'paypal-public', mode: 'sandbox' }
        }
    });

    assert.match(html, /id="upgradeButton"/);
    assert.match(html, /Pay with Razorpay/);
    assert.match(html, /data-paypal-client-id="paypal-public"/);
    assert.doesNotMatch(html, /key_secret|client_secret/i);
});


test('successful Razorpay verification atomically returns the activated Pro billing state', async () => {
    const plan = getPaidPlanById('pro');
    const keySecret = 'test_key_secret';
    const orderId = 'order_ACTIVATE123';
    const paymentId = 'pay_ACTIVATE123';
    const signature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    const completedCalls = [];
    const expiresAt = new Date('2026-08-30T12:00:00.000Z');
    const database = {
        async findPaymentByProviderOrder() {
            return {
                user_id: '42',
                plan_id: plan.id,
                provider_order_id: orderId,
                provider_payment_id: null,
                amount_minor: plan.inrPaise,
                currency: 'INR',
                status: 'pending'
            };
        },
        async completePayment(input) {
            completedCalls.push(input);
            return {
                completed: true,
                alreadyCompleted: false,
                billing: { current_plan: 'pro', plan_expires_at: expiresAt }
            };
        },
        async getBillingProfile() {
            throw new Error('completePayment should return the authoritative billing row');
        }
    };
    const service = createPaymentService({
        database,
        env: {
            RAZORPAY_KEY_ID: 'rzp_test_public',
            RAZORPAY_KEY_SECRET: keySecret
        },
        fetchImpl: async (url) => {
            assert.match(url, new RegExp(`/payments/${paymentId}$`));
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        id: paymentId,
                        order_id: orderId,
                        amount: plan.inrPaise,
                        currency: 'INR',
                        status: 'captured',
                        captured: true
                    });
                }
            };
        }
    });

    const result = await service.verifyRazorpayPayment({
        userId: '42',
        planId: 'pro',
        orderId,
        paymentId,
        signature
    });

    assert.equal(completedCalls.length, 1);
    assert.equal(completedCalls[0].planId, 'pro');
    assert.equal(completedCalls[0].providerPaymentId, paymentId);
    assert.deepEqual(result.billing, {
        currentPlanId: 'pro',
        currentPlanName: 'Pro',
        planExpiresAt: expiresAt
    });
    assert.equal(result.paymentStatus, 'completed');
});

test('Razorpay status polling reconciles a captured payment and activates the plan without a webhook', async () => {
    const plan = getPaidPlanById('pro');
    const expiresAt = new Date('2026-08-30T12:00:00.000Z');
    let lookupCount = 0;
    const completionCalls = [];
    const database = {
        async findPaymentByProviderOrder() {
            lookupCount += 1;
            return {
                user_id: '42',
                plan_id: plan.id,
                provider_order_id: 'order_RECONCILE123',
                provider_payment_id: null,
                amount_minor: plan.inrPaise,
                currency: 'INR',
                status: lookupCount === 1 ? 'pending' : 'completed'
            };
        },
        async completePayment(input) {
            completionCalls.push(input);
            return {
                completed: true,
                alreadyCompleted: false,
                billing: { current_plan: 'pro', plan_expires_at: expiresAt }
            };
        },
        async getBillingProfile() {
            return { current_plan: 'pro', plan_expires_at: expiresAt };
        },
        async markPaymentStatus() {
            throw new Error('captured reconciliation should complete instead of marking a pending state');
        }
    };
    const service = createPaymentService({
        database,
        env: {
            RAZORPAY_KEY_ID: 'rzp_test_public',
            RAZORPAY_KEY_SECRET: 'test_key_secret'
        },
        fetchImpl: async (url) => {
            assert.match(url, /\/orders\/order_RECONCILE123\/payments$/);
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        entity: 'collection',
                        count: 1,
                        items: [{
                            id: 'pay_RECONCILE123',
                            order_id: 'order_RECONCILE123',
                            amount: plan.inrPaise,
                            currency: 'INR',
                            status: 'captured',
                            captured: true,
                            created_at: 1_700_000_000
                        }]
                    });
                }
            };
        }
    });

    const result = await service.getRazorpayOrderStatus({
        userId: '42',
        orderId: 'order_RECONCILE123'
    });

    assert.equal(completionCalls.length, 1);
    assert.equal(completionCalls[0].providerPaymentId, 'pay_RECONCILE123');
    assert.equal(result.paymentStatus, 'completed');
    assert.equal(result.billing.currentPlanId, 'pro');
    assert.equal(result.billing.planExpiresAt, expiresAt);
});

test('database payment completion is atomic and persists authoritative subscription dates', () => {
    const databaseSource = require('node:fs').readFileSync(require.resolve('../database'), 'utf8');
    const schemaSource = require('node:fs').readFileSync(require.resolve('../database/schema.sql'), 'utf8');

    assert.match(databaseSource, /async function completePaymentTransaction/);
    assert.match(databaseSource, /await client\.query\('BEGIN'\)/);
    assert.match(databaseSource, /UPDATE payments[\s\S]*access_starts_at[\s\S]*access_expires_at/);
    assert.match(databaseSource, /UPDATE users[\s\S]*current_plan = \$2[\s\S]*plan_expires_at = \$3/);
    assert.match(databaseSource, /await client\.query\('COMMIT'\)/);
    assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS payment_refunds/);
    assert.match(schemaSource, /refunded_amount_minor BIGINT NOT NULL DEFAULT 0/);
});

test('processed Razorpay refunds are delegated once with verified payment and refund amounts', async () => {
    const plan = getPaidPlanById('pro');
    const webhookSecret = 'refund_webhook_secret';
    const refundCalls = [];
    const database = {
        async findPaymentByProviderPaymentAnyUser() {
            return {
                user_id: '42',
                plan_id: 'pro',
                provider_order_id: 'order_REFUND123',
                provider_payment_id: 'pay_REFUND123',
                amount_minor: plan.inrPaise,
                currency: 'INR',
                status: 'completed'
            };
        },
        async processPaymentRefundFromWebhook(input) {
            refundCalls.push(input);
            return { handled: true, duplicate: false, fullyRefunded: true };
        },
        async recordPaymentWebhookEvent() {
            throw new Error('processed refund should not be ignored');
        }
    };
    const service = createPaymentService({
        database,
        env: {
            RAZORPAY_KEY_ID: 'rzp_test_public',
            RAZORPAY_KEY_SECRET: 'test_key_secret',
            RAZORPAY_WEBHOOK_SECRET: webhookSecret
        },
        fetchImpl: async () => {
            throw new Error('signed refund webhooks should not call the Razorpay API');
        }
    });
    const event = {
        entity: 'event',
        event: 'refund.processed',
        created_at: 1_700_000_000,
        payload: {
            refund: {
                entity: {
                    id: 'rfnd_REFUND123',
                    payment_id: 'pay_REFUND123',
                    amount: plan.inrPaise,
                    currency: 'INR',
                    status: 'processed'
                }
            },
            payment: {
                entity: {
                    id: 'pay_REFUND123',
                    order_id: 'order_REFUND123',
                    amount: plan.inrPaise,
                    currency: 'INR',
                    status: 'captured',
                    captured: true
                }
            }
        }
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    const result = await service.handleRazorpayWebhook({
        rawBody,
        signature,
        eventId: 'event_REFUND123'
    });

    assert.equal(result.fullyRefunded, true);
    assert.equal(refundCalls.length, 1);
    assert.equal(refundCalls[0].providerRefundId, 'rfnd_REFUND123');
    assert.equal(refundCalls[0].refundAmountMinor, plan.inrPaise);
});

test('dashboard exposes authoritative billing hooks, live expiry targets and INR prices', () => {
    const plan = getPaidPlanById('pro');
    const expiresAt = new Date('2026-08-30T12:00:00.000Z');
    const html = renderDashboardPage({
        user: { email: 'user@example.com', displayName: 'User', initials: 'U' },
        plans: [
            { id: 'free', name: 'Free', tagline: 'Free', usdCents: 0, inrPaise: 0, featured: false, features: ['One'] },
            plan
        ],
        billing: { currentPlanId: 'pro', planExpiresAt: expiresAt },
        paymentConfiguration: {
            razorpay: { isConfigured: true, keyId: 'rzp_test_public' },
            paypal: { isConfigured: false, clientId: '', mode: 'sandbox' }
        }
    });

    assert.match(html, /data-current-plan-id="pro"/);
    assert.match(html, /data-plan-expires-at="[^"]+"/);
    assert.equal((html.match(/data-current-plan-expiry/g) || []).length, 2);
    assert.match(html, /₹2,499 INR with Razorpay/);
});
