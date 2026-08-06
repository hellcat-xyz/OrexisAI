'use strict';

const INVENTORY_DEMO_VERSION = 'orexis-inventory-v1';
const HISTORY_DAYS = 730;
const FUTURE_WEATHER_DAYS = 14;

function createInventoryDemoPayload({ businessId, currency = 'USD', timezone = 'UTC', countryCode = 'IN', now = new Date() } = {}) {
    const end = startOfUtcDay(now);
    const start = addUtcDays(end, -(HISTORY_DAYS - 1));
    const marker = { orexis_inventory_demo: INVENTORY_DEMO_VERSION };
    const suppliers = buildSuppliers(countryCode, marker);
    const warehouses = buildWarehouses(countryCode, marker);
    const products = buildProducts(currency, marker);
    const customers = buildCustomers(start, end, marker);
    const seasonalEvents = buildSeasonalEvents(start, end, countryCode, marker);
    const { promotions, promotionProducts } = buildPromotions(start, end, products, marker);
    const competitors = [
        { externalId: 'inventory-demo-competitor-value', name: 'ValueMart', sourceName: 'demo-observation', active: true, metadata: marker },
        { externalId: 'inventory-demo-competitor-premium', name: 'PrimeBasket', sourceName: 'demo-observation', active: true, metadata: marker }
    ];
    const competitorSnapshots = [];
    const weatherDaily = [];
    const productDailyMetrics = [];
    const orders = [];
    const orderItems = [];
    const purchaseOrders = [];
    const purchaseOrderItems = [];
    const stockMovements = [];
    const pendingReceipts = [];
    const stock = products.map((product, index) => 150 + (index * 17));
    let orderSequence = 0;
    let purchaseSequence = 0;
    let movementSequence = 0;

    for (let dayIndex = 0; dayIndex < HISTORY_DAYS + FUTURE_WEATHER_DAYS; dayIndex += 1) {
        const date = addUtcDays(start, dayIndex);
        const dateKey = date.toISOString().slice(0, 10);
        const weather = weatherForDate(date, countryCode, marker);
        weatherDaily.push(weather);
        if (dayIndex >= HISTORY_DAYS) continue;

        for (let pendingIndex = pendingReceipts.length - 1; pendingIndex >= 0; pendingIndex -= 1) {
            const receipt = pendingReceipts[pendingIndex];
            if (receipt.deliveryDate > dateKey) continue;
            stock[receipt.productIndex] += receipt.quantity;
            receipt.purchaseOrder.status = 'received';
            receipt.purchaseOrder.actualDeliveryDate = dateKey;
            receipt.purchaseOrderItem.quantityReceived = receipt.quantity;
            movementSequence += 1;
            stockMovements.push({
                externalId: `inventory-demo-move-${String(movementSequence).padStart(6, '0')}`,
                productExternalId: products[receipt.productIndex].externalId,
                warehouseExternalId: receipt.warehouseExternalId,
                movementType: 'stock_in',
                quantity: receipt.quantity,
                occurredAt: `${dateKey}T08:00:00.000Z`,
                referenceType: 'purchase_order',
                referenceExternalId: receipt.purchaseOrderExternalId,
                unitCostMinor: products[receipt.productIndex].costMinor,
                metadata: marker
            });
            pendingReceipts.splice(pendingIndex, 1);
        }

        const orderCount = 1 + (dayIndex % 4 === 0 ? 1 : 0);
        for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
            orderSequence += 1;
            const firstIndex = (dayIndex * 5 + orderIndex * 3) % products.length;
            const secondIndex = (dayIndex * 7 + orderIndex * 5 + 4) % products.length;
            const selected = firstIndex === secondIndex ? [firstIndex] : [firstIndex, secondIndex];
            const orderExternalId = `inventory-demo-order-${dateKey}-${orderIndex + 1}`;
            const customer = customers[(dayIndex * 11 + orderIndex * 17) % customers.length];
            const sourceName = ['Store', 'Website', 'Marketplace', 'Mobile App'][(dayIndex + orderIndex) % 4];
            const sales = [];

            selected.forEach((productIndex, itemIndex) => {
                const product = products[productIndex];
                const factor = demandFactor({ date, product, weather, seasonalEvents, promotions });
                const cycle = 0.82 + (((dayIndex + productIndex * 3) % 11) / 25);
                const requested = Math.max(1, Math.round(product.baseDailyDemand * factor * cycle));
                const sold = Math.min(requested, Math.floor(stock[productIndex]));
                if (sold <= 0) return;
                stock[productIndex] -= sold;
                const lineTotal = sold * product.priceMinor;
                sales.push({ productIndex, sold, lineTotal, itemIndex });
                orderItems.push({
                    orderExternalId,
                    externalId: `${orderExternalId}-item-${itemIndex + 1}`,
                    productExternalId: product.externalId,
                    quantity: sold,
                    unitPriceMinor: product.priceMinor,
                    totalAmountMinor: lineTotal,
                    metadata: marker
                });
                movementSequence += 1;
                stockMovements.push({
                    externalId: `inventory-demo-move-${String(movementSequence).padStart(6, '0')}`,
                    productExternalId: product.externalId,
                    warehouseExternalId: warehouses[productIndex % warehouses.length].externalId,
                    movementType: 'sale',
                    quantity: -sold,
                    occurredAt: `${dateKey}T${String(10 + ((dayIndex + orderIndex) % 10)).padStart(2, '0')}:15:00.000Z`,
                    referenceType: 'order',
                    referenceExternalId: orderExternalId,
                    unitCostMinor: product.costMinor,
                    metadata: marker
                });
            });

            if (sales.length > 0) {
                const totalAmountMinor = sales.reduce((sum, sale) => sum + sale.lineTotal, 0);
                orders.push({
                    externalId: orderExternalId,
                    customerExternalId: customer.externalId,
                    status: 'fulfilled',
                    currency,
                    totalAmountMinor,
                    refundedAmountMinor: 0,
                    orderedAt: `${dateKey}T${String(10 + ((dayIndex + orderIndex) % 10)).padStart(2, '0')}:15:00.000Z`,
                    sourceName,
                    shippingCountryCode: countryCode,
                    couponCode: activePromotionCode(date, promotions),
                    metadata: marker
                });
            }
        }

        addOperationalMovements({
            dayIndex,
            dateKey,
            products,
            warehouses,
            stock,
            stockMovements,
            marker,
            nextMovementId: () => {
                movementSequence += 1;
                return `inventory-demo-move-${String(movementSequence).padStart(6, '0')}`;
            }
        });

        products.forEach((product, productIndex) => {
            const hasPending = pendingReceipts.some((receipt) => receipt.productIndex === productIndex);
            if (stock[productIndex] > product.reorderPoint || hasPending) return;
            purchaseSequence += 1;
            const supplier = suppliers[productIndex % suppliers.length];
            const warehouse = warehouses[productIndex % warehouses.length];
            const delayDays = purchaseSequence % 9 === 0 ? 3 : purchaseSequence % 13 === 0 ? 6 : 0;
            const leadTime = Math.round(product.leadTimeDays + delayDays);
            const orderDate = dateKey;
            const expectedDeliveryDate = addUtcDays(date, product.leadTimeDays).toISOString().slice(0, 10);
            const deliveryDate = addUtcDays(date, leadTime).toISOString().slice(0, 10);
            const quantity = product.reorderQuantity;
            const externalId = `inventory-demo-po-${String(purchaseSequence).padStart(5, '0')}`;
            const purchaseOrder = {
                externalId,
                supplierExternalId: supplier.externalId,
                warehouseExternalId: warehouse.externalId,
                status: delayDays > 0 ? 'delayed' : 'in_transit',
                currency,
                orderDate,
                expectedDeliveryDate,
                actualDeliveryDate: null,
                shippingDelayDays: delayDays,
                transitTimeDays: leadTime,
                totalAmountMinor: quantity * product.costMinor,
                metadata: marker
            };
            const purchaseOrderItem = {
                purchaseOrderExternalId: externalId,
                externalId: `${externalId}-item-1`,
                productExternalId: product.externalId,
                quantityOrdered: quantity,
                quantityReceived: 0,
                unitCostMinor: product.costMinor,
                metadata: marker
            };
            purchaseOrders.push(purchaseOrder);
            purchaseOrderItems.push(purchaseOrderItem);
            pendingReceipts.push({
                productIndex,
                quantity,
                deliveryDate,
                purchaseOrderExternalId: externalId,
                warehouseExternalId: warehouse.externalId,
                purchaseOrder,
                purchaseOrderItem
            });
        });

        [0, 1].forEach((productIndex) => {
            const product = products[productIndex];
            const factor = demandFactor({ date, product, weather, seasonalEvents, promotions });
            const views = Math.round(70 + product.baseDailyDemand * 18 * factor + ((dayIndex + productIndex * 7) % 19));
            const cartAdds = Math.max(1, Math.round(views * (0.08 + productIndex * 0.01)));
            const conversions = Math.max(1, Math.round(cartAdds * (0.28 + ((dayIndex % 5) * 0.01))));
            productDailyMetrics.push({
                productExternalId: product.externalId,
                metricDate: dateKey,
                salesChannel: 'online',
                productViews: views,
                wishlistAdds: Math.round(views * 0.035),
                cartAdds,
                conversions,
                conversionRate: Number((conversions / views).toFixed(6)),
                metadata: marker
            });
        });

        if (date.getUTCDate() === 1) {
            competitors.forEach((competitor, competitorIndex) => {
                competitorSnapshots.push({
                    competitorExternalId: competitor.externalId,
                    retrievedAt: `${dateKey}T06:00:00.000Z`,
                    sourceName: 'demo-observation',
                    currency,
                    products: products.slice(0, 6).map((product, productIndex) => ({
                        sku: product.sku,
                        priceMinor: Math.round(product.priceMinor * (competitorIndex === 0 ? 0.96 + (productIndex % 3) * 0.01 : 1.04 + (productIndex % 2) * 0.02)),
                        available: (dayIndex + productIndex + competitorIndex) % 9 !== 0
                    })),
                    offers: [],
                    positioning: competitorIndex === 0 ? 'Value-led competitor' : 'Premium competitor',
                    rawMetadata: marker
                });
            });
        }
    }

    const inventoryPositions = [];
    products.forEach((product, productIndex) => {
        const primaryWarehouse = warehouses[productIndex % warehouses.length];
        const secondaryWarehouse = warehouses[(productIndex + 1) % warehouses.length];
        const primaryStock = Math.max(0, Math.floor(stock[productIndex] * 0.72));
        const secondaryStock = Math.max(0, Math.floor(stock[productIndex] - primaryStock));
        const incoming = pendingReceipts.filter((receipt) => receipt.productIndex === productIndex).reduce((sum, receipt) => sum + receipt.quantity, 0);
        product.currentStock = primaryStock + secondaryStock;
        [
            [primaryWarehouse, primaryStock, Math.floor(primaryStock * 0.08), Math.ceil(incoming * 0.7)],
            [secondaryWarehouse, secondaryStock, Math.floor(secondaryStock * 0.05), Math.floor(incoming * 0.3)]
        ].forEach(([warehouse, currentStock, reservedStock, incomingStock]) => {
            inventoryPositions.push({
                productExternalId: product.externalId,
                warehouseExternalId: warehouse.externalId,
                currentStock,
                reservedStock,
                incomingStock,
                damagedStock: productIndex % 5 === 0 ? 1 : 0,
                returnedStock: productIndex % 4 === 0 ? 1 : 0,
                stockValueMinor: Math.round(currentStock * product.costMinor),
                countedAt: end.toISOString(),
                metadata: marker
            });
        });
    });

    return {
        business: null,
        customers,
        suppliers,
        warehouses,
        products: products.map(({ baseDailyDemand, ...product }) => product),
        inventoryPositions,
        orders,
        orderItems,
        purchaseOrders,
        purchaseOrderItems,
        stockMovements,
        promotions,
        promotionProducts,
        seasonalEvents,
        weatherDaily,
        productDailyMetrics,
        competitors,
        competitorSnapshots,
        campaignMetrics: [],
        reviews: [],
        coupons: [],
        trafficDailyMetrics: [],
        carts: []
    };
}

function buildSuppliers(countryCode, marker) {
    return [
        ['northstar', 'Northstar Consumer Supply', 7, 96],
        ['evergreen', 'Evergreen Manufacturing', 12, 91],
        ['harbor', 'Harbor Distribution', 18, 86],
        ['rapid', 'Rapid Regional Wholesale', 5, 94]
    ].map(([slug, name, lead, reliability], index) => ({
        externalId: `inventory-demo-supplier-${slug}`,
        name,
        contactName: `Account Manager ${index + 1}`,
        email: `supplier.${slug}@example.com`,
        phone: `+91-90000-${String(12000 + index).padStart(5, '0')}`,
        countryCode,
        defaultLeadTimeDays: lead,
        reliabilityScore: reliability,
        active: true,
        metadata: marker
    }));
}

function buildWarehouses(countryCode, marker) {
    return [
        { externalId: 'inventory-demo-warehouse-central', name: 'Central Fulfilment Centre', region: 'Central', countryCode, capacityUnits: 12000, active: true, metadata: marker },
        { externalId: 'inventory-demo-warehouse-regional', name: 'Regional Dispatch Hub', region: 'Regional', countryCode, capacityUnits: 6500, active: true, metadata: marker }
    ];
}

function buildProducts(currency, marker) {
    const rows = [
        ['cold-brew', 'Cold Brew Concentrate', 'Beverages', 'Coffee', 129900, 62000, 4.8, 36, 90, 'hot'],
        ['herbal-tea', 'Herbal Tea Collection', 'Beverages', 'Tea', 79900, 31000, 4.2, 30, 80, 'cold'],
        ['protein-bars', 'Protein Bar Box', 'Food', 'Snacks', 99900, 42000, 5.1, 42, 110, 'neutral'],
        ['rain-jacket', 'Packable Rain Jacket', 'Apparel', 'Outerwear', 249900, 112000, 2.6, 20, 55, 'rain'],
        ['summer-cap', 'UV Protection Cap', 'Apparel', 'Accessories', 69900, 24000, 3.4, 24, 70, 'hot'],
        ['skin-care', 'Daily Skin Care Set', 'Beauty', 'Skin Care', 189900, 74000, 3.1, 22, 65, 'hot'],
        ['gift-box', 'Premium Gift Box', 'Gifts', 'Bundles', 159900, 61000, 4.6, 35, 100, 'holiday'],
        ['desk-lamp', 'Smart Desk Lamp', 'Home', 'Lighting', 219900, 98000, 2.2, 18, 50, 'winter'],
        ['storage-set', 'Modular Storage Set', 'Home', 'Storage', 179900, 79000, 2.8, 20, 60, 'neutral'],
        ['fitness-bottle', 'Insulated Fitness Bottle', 'Fitness', 'Hydration', 89900, 35000, 4.0, 28, 85, 'hot'],
        ['travel-organizer', 'Travel Organizer Kit', 'Travel', 'Accessories', 119900, 46000, 3.0, 24, 70, 'summer'],
        ['winter-blanket', 'All-Season Comfort Blanket', 'Home', 'Bedding', 279900, 126000, 2.5, 18, 55, 'cold']
    ];
    return rows.map(([slug, name, categoryName, subcategoryName, priceMinor, costMinor, baseDailyDemand, reorderPoint, reorderQuantity, weatherSensitivity], index) => ({
        externalId: `inventory-demo-product-${slug}`,
        name,
        sku: `INV-${String(index + 1).padStart(3, '0')}`,
        barcode: `8900000${String(10000 + index).padStart(5, '0')}`,
        brand: index % 2 === 0 ? 'Orexis Select' : 'Northline',
        categoryName,
        subcategoryName,
        supplierExternalId: `inventory-demo-supplier-${['northstar', 'evergreen', 'harbor', 'rapid'][index % 4]}`,
        manufacturer: index % 3 === 0 ? 'Northstar Works' : index % 3 === 1 ? 'Evergreen Labs' : 'Harbor Manufacturing',
        currency,
        priceMinor,
        costMinor,
        weightGrams: 180 + index * 95,
        dimensions: { lengthCm: 18 + index, widthCm: 12 + (index % 4), heightCm: 6 + (index % 3) },
        shelfLifeDays: ['Food', 'Beverages', 'Beauty'].includes(categoryName) ? 240 + index * 15 : null,
        storageRequirements: ['Food', 'Beverages', 'Beauty'].includes(categoryName) ? 'Store in a cool, dry place away from direct sunlight.' : 'Standard dry storage.',
        currentStock: 0,
        safetyStock: Math.ceil(baseDailyDemand * 7),
        reorderPoint,
        reorderQuantity,
        leadTimeDays: [7, 12, 18, 5][index % 4],
        reorderBufferDays: 5 + (index % 4),
        defaultWarehouseExternalId: index % 2 === 0 ? 'inventory-demo-warehouse-central' : 'inventory-demo-warehouse-regional',
        active: true,
        baseDailyDemand,
        metadata: { ...marker, weatherSensitivity }
    }));
}

function buildCustomers(start, end, marker) {
    const segments = ['New', 'Repeat', 'Loyal', 'Wholesale'];
    const regions = ['North', 'South', 'East', 'West', 'Central'];
    return Array.from({ length: 180 }, (_, index) => ({
        externalId: `inventory-demo-customer-${String(index + 1).padStart(4, '0')}`,
        name: `Demo Customer ${String(index + 1).padStart(3, '0')}`,
        email: `inventory.demo.${String(index + 1).padStart(4, '0')}@example.com`,
        status: index % 23 === 0 ? 'at-risk' : 'active',
        firstSeenAt: addUtcDays(start, index % 210).toISOString(),
        lastActivityAt: addUtcDays(end, -(index % 45)).toISOString(),
        customerSegment: segments[index % segments.length],
        purchaseFrequency: ['weekly', 'monthly', 'quarterly'][index % 3],
        region: regions[index % regions.length],
        metadata: marker
    }));
}

function buildSeasonalEvents(start, end, countryCode, marker) {
    const rows = [];
    for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
        const events = [
            ['new-year', 'New Year', `${year}-01-01`, `${year}-01-05`, 1.22, null],
            ['valentine', "Valentine's Day", `${year}-02-10`, `${year}-02-14`, 1.28, 'Gifts'],
            ['summer', 'Summer Demand', `${year}-04-01`, `${year}-06-30`, 1.16, 'Beverages'],
            ['easter', 'Easter', `${year}-03-25`, `${year}-04-05`, 1.12, 'Gifts'],
            ['regional', 'Regional Holiday', `${year}-10-15`, `${year}-10-25`, 1.18, null],
            ['halloween', 'Halloween', `${year}-10-27`, `${year}-10-31`, 1.14, 'Gifts'],
            ['black-friday', 'Black Friday', `${year}-11-22`, `${year}-11-30`, 1.42, null],
            ['winter', 'Winter Demand', `${year}-11-01`, `${year}-02-28`, 1.18, 'Home'],
            ['christmas', 'Christmas', `${year}-12-15`, `${year}-12-26`, 1.38, 'Gifts']
        ];
        events.forEach(([slug, name, startsOn, endsOn, demandMultiplier, categoryName]) => {
            const normalizedEnd = slug === 'winter' ? `${year}-12-31` : endsOn;
            rows.push({ externalId: `inventory-demo-event-${year}-${slug}`, name, eventType: slug, countryCode, startsOn, endsOn: normalizedEnd, demandMultiplier, categoryName, metadata: marker });
        });
    }
    return rows;
}

function buildPromotions(start, end, products, marker) {
    const promotions = [];
    const promotionProducts = [];
    let sequence = 0;
    for (let cursor = new Date(start); cursor <= end; cursor = addUtcDays(cursor, 60)) {
        sequence += 1;
        const startsAt = addUtcDays(cursor, 8);
        const endsAt = addUtcDays(startsAt, 9);
        const externalId = `inventory-demo-promo-${String(sequence).padStart(3, '0')}`;
        promotions.push({
            externalId,
            name: sequence % 3 === 0 ? 'Seasonal Spotlight' : sequence % 2 === 0 ? 'Weekend Value Event' : 'Category Growth Campaign',
            discountPercentage: 10 + (sequence % 3) * 5,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            salesChannel: sequence % 2 === 0 ? 'Website' : 'All',
            active: true,
            metadata: { ...marker, code: `INV${String(sequence).padStart(2, '0')}` }
        });
        [0, 1, 2].forEach((offset) => {
            const product = products[(sequence * 3 + offset) % products.length];
            promotionProducts.push({ promotionExternalId: externalId, productExternalId: product.externalId });
        });
    }
    return { promotions, promotionProducts };
}

function addOperationalMovements({ dayIndex, dateKey, products, warehouses, stock, stockMovements, marker, nextMovementId }) {
    const add = ({ productIndex, warehouseIndex, movementType, quantity, referenceType }) => {
        const product = products[productIndex];
        stockMovements.push({
            externalId: nextMovementId(),
            productExternalId: product.externalId,
            warehouseExternalId: warehouses[warehouseIndex % warehouses.length].externalId,
            movementType,
            quantity,
            occurredAt: `${dateKey}T07:30:00.000Z`,
            referenceType,
            referenceExternalId: `inventory-demo-${referenceType}-${dateKey}-${productIndex + 1}`,
            unitCostMinor: product.costMinor,
            metadata: marker
        });
    };

    if (dayIndex > 0 && dayIndex % 31 === 0) {
        const productIndex = (dayIndex / 31) % products.length;
        stock[productIndex] += 1;
        add({ productIndex, warehouseIndex: productIndex, movementType: 'return', quantity: 1, referenceType: 'customer_return' });
    }
    if (dayIndex > 0 && dayIndex % 47 === 0) {
        const productIndex = (dayIndex / 47 + 2) % products.length;
        if (stock[productIndex] >= 1) {
            stock[productIndex] -= 1;
            add({ productIndex, warehouseIndex: productIndex, movementType: 'damaged', quantity: -1, referenceType: 'quality_control' });
        }
    }
    if (dayIndex > 0 && dayIndex % 53 === 0) {
        const productIndex = (dayIndex / 53 + 4) % products.length;
        const quantity = Math.min(2, Math.max(0, Math.floor(stock[productIndex])));
        if (quantity > 0) {
            add({ productIndex, warehouseIndex: productIndex, movementType: 'transfer_out', quantity: -quantity, referenceType: 'warehouse_transfer' });
            add({ productIndex, warehouseIndex: productIndex + 1, movementType: 'transfer_in', quantity, referenceType: 'warehouse_transfer' });
        }
    }
    if (dayIndex > 0 && dayIndex % 61 === 0) {
        const productIndex = (dayIndex / 61 + 6) % products.length;
        const quantity = dayIndex % 122 === 0 ? -1 : 1;
        if (quantity > 0 || stock[productIndex] >= 1) {
            stock[productIndex] += quantity;
            add({ productIndex, warehouseIndex: productIndex, movementType: 'adjustment', quantity, referenceType: 'cycle_count' });
        }
    }
    if (dayIndex > 0 && dayIndex % 71 === 0) {
        const productIndex = (dayIndex / 71 + 8) % products.length;
        if (stock[productIndex] >= 1) {
            stock[productIndex] -= 1;
            add({ productIndex, warehouseIndex: productIndex, movementType: 'stock_out', quantity: -1, referenceType: 'internal_use' });
        }
    }
}

function demandFactor({ date, product, weather, seasonalEvents, promotions }) {
    const dateKey = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    let factor = weekday === 0 || weekday === 6 ? 1.12 : 1;
    seasonalEvents.forEach((event) => {
        if (dateKey < event.startsOn || dateKey > event.endsOn) return;
        if (!event.categoryName || event.categoryName === product.categoryName) factor *= Number(event.demandMultiplier || 1);
    });
    promotions.forEach((promotion) => {
        if (date < new Date(promotion.startsAt) || date >= new Date(promotion.endsAt)) return;
        factor *= 1 + Math.min(0.35, Number(promotion.discountPercentage || 0) / 100 * 1.25);
    });
    const sensitivity = product.metadata.weatherSensitivity;
    if (sensitivity === 'hot' && weather.temperatureC >= 30) factor *= 1.2;
    if (sensitivity === 'cold' && weather.temperatureC <= 18) factor *= 1.18;
    if (sensitivity === 'rain' && weather.rainfallMm >= 8) factor *= 1.35;
    if (sensitivity === 'summer' && weather.temperatureC >= 28) factor *= 1.14;
    if (sensitivity === 'winter' && weather.temperatureC <= 20) factor *= 1.14;
    if (sensitivity === 'holiday' && [11, 0].includes(date.getUTCMonth())) factor *= 1.18;
    return factor;
}

function weatherForDate(date, countryCode, marker) {
    const dayOfYear = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000);
    const seasonal = Math.sin((2 * Math.PI * (dayOfYear - 90)) / 365);
    const temperatureC = Number((25 + seasonal * 8 + ((dayOfYear % 9) - 4) * 0.35).toFixed(2));
    const monsoon = date.getUTCMonth() >= 5 && date.getUTCMonth() <= 8;
    const rainfallMm = monsoon ? Number((4 + (dayOfYear % 6) * 2.4).toFixed(2)) : dayOfYear % 17 === 0 ? 3.2 : 0;
    const humidityPercentage = Number((55 + (monsoon ? 22 : 4) + (dayOfYear % 7)).toFixed(2));
    return {
        weatherDate: date.toISOString().slice(0, 10),
        region: 'primary',
        temperatureC,
        rainfallMm,
        humidityPercentage: Math.min(100, humidityPercentage),
        weatherCondition: rainfallMm >= 8 ? 'Heavy rain' : rainfallMm > 0 ? 'Rain' : temperatureC >= 31 ? 'Hot' : temperatureC <= 18 ? 'Cool' : 'Clear',
        sourceName: 'deterministic-demo-climate',
        observedAt: `${date.toISOString().slice(0, 10)}T06:00:00.000Z`,
        metadata: { ...marker, countryCode }
    };
}

function activePromotionCode(date, promotions) {
    const promotion = promotions.find((item) => date >= new Date(item.startsAt) && date < new Date(item.endsAt));
    return promotion?.metadata?.code || null;
}

function startOfUtcDay(value) {
    const date = new Date(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(value, days) {
    const date = new Date(value);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date;
}

module.exports = {
    FUTURE_WEATHER_DAYS,
    HISTORY_DAYS,
    INVENTORY_DEMO_VERSION,
    createInventoryDemoPayload
};
