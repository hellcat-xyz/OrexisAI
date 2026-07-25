'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { getPaidPlanById } = require('../plans');
const {
    minorToDecimal,
    validatePayPalCapture,
    verifyRazorpaySignature
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
