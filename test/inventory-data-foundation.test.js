'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { validateBusinessImportPayload } = require('../business-data');
const {
    FUTURE_WEATHER_DAYS,
    HISTORY_DAYS,
    INVENTORY_DEMO_VERSION,
    createInventoryDemoPayload
} = require('../workflows/inventory-demo-data');
const { createWorkflowService } = require('../workflows/service');

const FIXED_NOW = new Date('2026-08-06T00:00:00.000Z');

function recordCount(payload) {
    return Object.entries(payload).reduce((total, [key, value]) => (
        key === 'business' || !Array.isArray(value) ? total : total + value.length
    ), 0);
}

test('inventory demo dataset is deterministic, relational, and clearly marked as demo data', () => {
    const first = createInventoryDemoPayload({ currency: 'INR', timezone: 'Asia/Kolkata', countryCode: 'IN', now: FIXED_NOW });
    const second = createInventoryDemoPayload({ currency: 'INR', timezone: 'Asia/Kolkata', countryCode: 'IN', now: FIXED_NOW });

    assert.deepEqual(first, second);
    assert.equal(first.weatherDaily.length, HISTORY_DAYS + FUTURE_WEATHER_DAYS);
    assert.ok(first.orders.length >= HISTORY_DAYS);
    assert.ok(first.orderItems.length > first.orders.length);
    assert.ok(recordCount(first) > 5_000);
    assert.ok(recordCount(first) <= 10_000);
    assert.equal(first.orders[0].metadata.orexis_inventory_demo, INVENTORY_DEMO_VERSION);

    const products = new Set(first.products.map((item) => item.externalId));
    const orders = new Set(first.orders.map((item) => item.externalId));
    const suppliers = new Set(first.suppliers.map((item) => item.externalId));
    const warehouses = new Set(first.warehouses.map((item) => item.externalId));
    assert.ok(first.orderItems.every((item) => products.has(item.productExternalId) && orders.has(item.orderExternalId)));
    assert.ok(first.products.every((item) => suppliers.has(item.supplierExternalId) && warehouses.has(item.defaultWarehouseExternalId)));
    assert.ok(first.inventoryPositions.every((item) => products.has(item.productExternalId) && warehouses.has(item.warehouseExternalId)));

    const soldUnits = first.orderItems.reduce((sum, item) => sum + item.quantity, 0);
    const salesMovements = first.stockMovements
        .filter((item) => item.movementType === 'sale')
        .reduce((sum, item) => sum + Math.abs(item.quantity), 0);
    assert.equal(salesMovements, soldUnits);
    const movementTypes = new Set(first.stockMovements.map((item) => item.movementType));
    for (const type of ['stock_in', 'stock_out', 'sale', 'return', 'damaged', 'transfer_in', 'transfer_out', 'adjustment']) {
        assert.ok(movementTypes.has(type), `expected ${type} movement records`);
    }
    assert.ok(first.purchaseOrders.some((item) => item.status === 'received' && item.actualDeliveryDate));
    assert.ok(first.purchaseOrders.some((item) => ['in_transit', 'delayed'].includes(item.status) && !item.actualDeliveryDate));
    assert.equal(first.business, null);

    const validated = validateBusinessImportPayload(first);
    assert.equal(validated.products.length, first.products.length);
    assert.equal(validated.purchaseOrders.length, first.purchaseOrders.length);
    assert.equal(validated.productDailyMetrics.length, first.productDailyMetrics.length);
});

test('inventory data foundation adds tenant-scoped relational tables, indexes, import UI, and authenticated routes', () => {
    const root = path.join(__dirname, '..');
    const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
    const database = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(root, 'views', 'dashboard.js'), 'utf8');
    const client = fs.readFileSync(path.join(root, 'public', 'inventory-data.js'), 'utf8');

    for (const table of [
        'business_suppliers',
        'business_warehouses',
        'business_inventory_positions',
        'business_purchase_orders',
        'business_purchase_order_items',
        'business_stock_movements',
        'business_promotions',
        'business_promotion_products',
        'business_seasonal_events',
        'business_weather_daily',
        'business_product_daily_metrics'
    ]) {
        assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
        assert.match(schema, new RegExp(`${table}[\\s\\S]*business_id BIGINT NOT NULL REFERENCES businesses\\(id\\)`));
    }
    assert.match(database, /async function getInventoryDataSummary/);
    assert.match(database, /async function deleteInventoryDemoData/);
    assert.match(database, /business_memberships/);
    assert.match(server, /\/api\/business\/inventory-data\/summary/);
    assert.match(server, /\/api\/business\/inventory-data\/demo/);
    assert.match(dashboard, /id="businessDataImport"/);
    assert.match(dashboard, /\/inventory-data\.js/);
    assert.match(client, /\/api\/business\/data\/import/);
    assert.match(client, /downloadTemplate/);
});

test('demo loading is opt-in and blocked when a business already has real order data', async () => {
    const geminiService = { getPublicConfiguration: () => ({ isConfigured: false }) };
    const realDataDatabase = {
        async getOrCreateBusinessForUser() {
            return { id: '7', name: 'Real Store', currency: 'INR', timezone: 'Asia/Kolkata', country_code: 'IN' };
        },
        async getInventoryDatasetState() {
            return { real_order_records: 1, demo_order_records: 0 };
        }
    };
    const protectedService = createWorkflowService({ database: realDataDatabase, geminiService });
    await assert.rejects(
        () => protectedService.loadInventoryDemoData({ userId: '5' }),
        (error) => error.code === 'INVENTORY_DEMO_REAL_DATA_PRESENT'
    );

    let importedPayload = null;
    const emptyDatabase = {
        async getOrCreateBusinessForUser() {
            return { id: '8', name: 'Empty Store', currency: 'INR', timezone: 'Asia/Kolkata', country_code: 'IN' };
        },
        async getInventoryDatasetState() {
            return { real_order_records: 0, demo_order_records: 0 };
        },
        async importBusinessData({ payload }) {
            importedPayload = payload;
            return { counts: { orders: payload.orders.length } };
        }
    };
    const demoService = createWorkflowService({ database: emptyDatabase, geminiService });
    const result = await demoService.loadInventoryDemoData({ userId: '5' });
    assert.equal(result.loaded, true);
    assert.equal(result.datasetVersion, INVENTORY_DEMO_VERSION);
    assert.ok(importedPayload.orders.length >= HISTORY_DAYS);
    assert.equal(importedPayload.orders[0].metadata.orexis_inventory_demo, INVENTORY_DEMO_VERSION);
});
