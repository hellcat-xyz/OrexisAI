'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateBusinessImportPayload } = require('../business-data');

test('business import validation normalizes real records and allows central business configuration', () => {
    const payload = validateBusinessImportPayload({
        business: { name: 'Orexis Demo', currency: 'inr', timezone: 'Asia/Kolkata' },
        customers: [{ externalId: 'cus_1', email: 'Owner@Example.com' }],
        products: [{ externalId: 'prod_1', name: 'Product', currentStock: 10, leadTimeDays: 4 }],
        orders: [{ externalId: 'ord_1', customerExternalId: 'cus_1', status: 'paid', currency: 'INR', totalAmountMinor: 12500, orderedAt: '2026-08-01T10:00:00Z' }],
        orderItems: [{ orderExternalId: 'ord_1', externalId: 'line_1', productExternalId: 'prod_1', quantity: 2, totalAmountMinor: 12500 }]
    });

    assert.deepEqual(payload.business, { name: 'Orexis Demo', currency: 'INR', timezone: 'Asia/Kolkata' });
    assert.equal(payload.customers[0].email, 'owner@example.com');
    assert.equal(payload.orders[0].status, 'paid');
    assert.equal(payload.orderItems[0].quantity, 2);
});

test('business import validation rejects fabricated-looking invalid numeric and reference data before SQL', () => {
    assert.throws(
        () => validateBusinessImportPayload({ orders: [{ externalId: 'o', status: 'paid', totalAmountMinor: -1, orderedAt: '2026-08-01' }] }),
        /non-negative integer/
    );
    assert.throws(
        () => validateBusinessImportPayload({ reviews: [{ externalId: 'r', provider: 'google', rating: 6, reviewText: 'Test', publishedAt: '2026-08-01' }] }),
        /cannot exceed 5/
    );
    assert.throws(() => validateBusinessImportPayload({}), /Import at least one/);
});
