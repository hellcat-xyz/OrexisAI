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
