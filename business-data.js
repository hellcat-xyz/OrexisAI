'use strict';

const MAX_IMPORT_RECORDS = 10_000;
const VALID_ORDER_STATUSES = new Set(['pending', 'paid', 'completed', 'fulfilled', 'cancelled', 'refunded', 'failed']);
const VALID_REVIEW_STATUSES = new Set(['published', 'hidden', 'removed']);
const VALID_CART_STATUSES = new Set(['active', 'abandoned', 'converted', 'expired', 'recovered']);
const VALID_DISCOUNT_TYPES = new Set(['percentage', 'fixed', 'shipping', 'other']);

function validateBusinessImportPayload(value) {
    const input = isPlainObject(value) ? value : {};
    const payload = {
        business: normalizeBusiness(input.business),
        customers: mapArray(input.customers, normalizeCustomer, 'customers'),
        products: mapArray(input.products, normalizeProduct, 'products'),
        orders: mapArray(input.orders, normalizeOrder, 'orders'),
        orderItems: mapArray(input.orderItems, normalizeOrderItem, 'orderItems'),
        campaignMetrics: mapArray(input.campaignMetrics, normalizeCampaignMetric, 'campaignMetrics'),
        reviews: mapArray(input.reviews, normalizeReview, 'reviews'),
        competitors: mapArray(input.competitors, normalizeCompetitor, 'competitors'),
        competitorSnapshots: mapArray(input.competitorSnapshots, normalizeCompetitorSnapshot, 'competitorSnapshots'),
        coupons: mapArray(input.coupons, normalizeCoupon, 'coupons'),
        trafficDailyMetrics: mapArray(input.trafficDailyMetrics, normalizeTrafficDailyMetric, 'trafficDailyMetrics'),
        carts: mapArray(input.carts, normalizeCart, 'carts'),
        suppliers: mapArray(input.suppliers, normalizeSupplier, 'suppliers'),
        warehouses: mapArray(input.warehouses, normalizeWarehouse, 'warehouses'),
        inventoryPositions: mapArray(input.inventoryPositions, normalizeInventoryPosition, 'inventoryPositions'),
        purchaseOrders: mapArray(input.purchaseOrders, normalizePurchaseOrder, 'purchaseOrders'),
        purchaseOrderItems: mapArray(input.purchaseOrderItems, normalizePurchaseOrderItem, 'purchaseOrderItems'),
        stockMovements: mapArray(input.stockMovements, normalizeStockMovement, 'stockMovements'),
        promotions: mapArray(input.promotions, normalizePromotion, 'promotions'),
        promotionProducts: mapArray(input.promotionProducts, normalizePromotionProduct, 'promotionProducts'),
        seasonalEvents: mapArray(input.seasonalEvents, normalizeSeasonalEvent, 'seasonalEvents'),
        weatherDaily: mapArray(input.weatherDaily, normalizeWeatherDaily, 'weatherDaily'),
        productDailyMetrics: mapArray(input.productDailyMetrics, normalizeProductDailyMetric, 'productDailyMetrics')
    };
    const total = Object.entries(payload).reduce((sum, [key, records]) => key === 'business' ? sum : sum + records.length, 0);
    if (total === 0 && !payload.business) throw importError('Import at least one business-data record.');
    if (total > MAX_IMPORT_RECORDS) throw importError(`A single import cannot exceed ${MAX_IMPORT_RECORDS.toLocaleString('en-US')} records.`);
    return payload;
}


function normalizeBusiness(value) {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value)) throw importError('business must be a JSON object.');
    return {
        name: optionalText(value.name, 160),
        businessType: optionalText(value.businessType, 160),
        industry: optionalText(value.industry, 160),
        productsServices: optionalStringArray(value.productsServices, 'business.productsServices', 100, 500),
        websiteUrl: optionalUrl(value.websiteUrl, 'business.websiteUrl'),
        location: optionalObject(value.location, 'business.location', 32 * 1024),
        countryCode: optionalCountryCode(value.countryCode),
        latitude: optionalCoordinate(value.latitude, 'business.latitude', -90, 90),
        longitude: optionalCoordinate(value.longitude, 'business.longitude', -180, 180),
        targetAudience: optionalText(value.targetAudience, 10_000),
        brandVoice: optionalText(value.brandVoice, 5_000),
        socialMediaAccounts: optionalObject(value.socialMediaAccounts, 'business.socialMediaAccounts', 32 * 1024),
        marketingGoals: optionalStringArray(value.marketingGoals, 'business.marketingGoals', 50, 1000),
        googlePlaceId: optionalText(value.googlePlaceId, 255),
        currency: optionalCurrency(value.currency),
        timezone: optionalTimezone(value.timezone)
    };
}

function normalizeCustomer(item, index) {
    return {
        externalId: requiredId(item?.externalId, `customers[${index}].externalId`),
        name: optionalText(item?.name, 200),
        email: optionalEmail(item?.email, `customers[${index}].email`),
        status: optionalText(item?.status, 32) || 'active',
        firstSeenAt: optionalDate(item?.firstSeenAt, `customers[${index}].firstSeenAt`),
        lastActivityAt: optionalDate(item?.lastActivityAt, `customers[${index}].lastActivityAt`),
        customerSegment: optionalText(item?.customerSegment, 120),
        purchaseFrequency: optionalText(item?.purchaseFrequency, 80),
        region: optionalText(item?.region, 160),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeProduct(item, index) {
    return {
        externalId: requiredId(item?.externalId, `products[${index}].externalId`),
        name: requiredText(item?.name, 240, `products[${index}].name`),
        sku: optionalText(item?.sku, 160),
        barcode: optionalText(item?.barcode, 160),
        brand: optionalText(item?.brand, 160),
        categoryName: optionalText(item?.categoryName, 160),
        subcategoryName: optionalText(item?.subcategoryName, 160),
        supplierExternalId: optionalId(item?.supplierExternalId),
        manufacturer: optionalText(item?.manufacturer, 200),
        currency: optionalCurrency(item?.currency),
        priceMinor: optionalNonNegativeInteger(item?.priceMinor, `products[${index}].priceMinor`),
        costMinor: optionalNonNegativeInteger(item?.costMinor, `products[${index}].costMinor`),
        weightGrams: optionalNonNegativeNumber(item?.weightGrams, `products[${index}].weightGrams`),
        dimensions: optionalObject(item?.dimensions, `products[${index}].dimensions`, 8 * 1024) || {},
        shelfLifeDays: optionalPositiveInteger(item?.shelfLifeDays, `products[${index}].shelfLifeDays`),
        storageRequirements: optionalText(item?.storageRequirements, 2_000),
        currentStock: optionalNonNegativeNumber(item?.currentStock, `products[${index}].currentStock`),
        safetyStock: optionalNonNegativeNumber(item?.safetyStock, `products[${index}].safetyStock`),
        reorderPoint: optionalNonNegativeNumber(item?.reorderPoint, `products[${index}].reorderPoint`),
        reorderQuantity: optionalPositiveNumber(item?.reorderQuantity, `products[${index}].reorderQuantity`),
        leadTimeDays: optionalPositiveNumber(item?.leadTimeDays, `products[${index}].leadTimeDays`),
        reorderBufferDays: optionalNonNegativeNumber(item?.reorderBufferDays, `products[${index}].reorderBufferDays`),
        defaultWarehouseExternalId: optionalId(item?.defaultWarehouseExternalId),
        active: item?.active !== false,
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeOrder(item, index) {
    const totalAmountMinor = requiredNonNegativeInteger(item?.totalAmountMinor, `orders[${index}].totalAmountMinor`);
    const refundedAmountMinor = optionalNonNegativeInteger(item?.refundedAmountMinor, `orders[${index}].refundedAmountMinor`) || 0;
    if (refundedAmountMinor > totalAmountMinor) throw importError(`orders[${index}].refundedAmountMinor cannot exceed totalAmountMinor.`);
    const status = requiredText(item?.status, 32, `orders[${index}].status`).toLowerCase();
    if (!VALID_ORDER_STATUSES.has(status)) throw importError(`orders[${index}].status is not supported.`);
    return {
        externalId: requiredId(item?.externalId, `orders[${index}].externalId`),
        customerExternalId: optionalId(item?.customerExternalId),
        status,
        currency: optionalCurrency(item?.currency),
        totalAmountMinor,
        refundedAmountMinor,
        orderedAt: requiredDate(item?.orderedAt, `orders[${index}].orderedAt`),
        sourceName: optionalText(item?.sourceName, 160),
        shippingCountryCode: optionalCountryCodeValue(item?.shippingCountryCode, `orders[${index}].shippingCountryCode`),
        couponCode: optionalText(item?.couponCode, 160),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeOrderItem(item, index) {
    return {
        orderExternalId: requiredId(item?.orderExternalId, `orderItems[${index}].orderExternalId`),
        externalId: requiredId(item?.externalId, `orderItems[${index}].externalId`),
        productExternalId: optionalId(item?.productExternalId),
        quantity: requiredPositiveNumber(item?.quantity, `orderItems[${index}].quantity`),
        unitPriceMinor: optionalNonNegativeInteger(item?.unitPriceMinor, `orderItems[${index}].unitPriceMinor`),
        totalAmountMinor: optionalNonNegativeInteger(item?.totalAmountMinor, `orderItems[${index}].totalAmountMinor`),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeCampaignMetric(item, index) {
    return {
        externalId: requiredId(item?.externalId, `campaignMetrics[${index}].externalId`),
        campaignName: requiredText(item?.campaignName, 240, `campaignMetrics[${index}].campaignName`),
        metricDate: requiredDateOnly(item?.metricDate, `campaignMetrics[${index}].metricDate`),
        currency: optionalCurrency(item?.currency),
        spendMinor: optionalNonNegativeInteger(item?.spendMinor, `campaignMetrics[${index}].spendMinor`),
        attributedRevenueMinor: optionalNonNegativeInteger(item?.attributedRevenueMinor, `campaignMetrics[${index}].attributedRevenueMinor`),
        impressions: optionalNonNegativeInteger(item?.impressions, `campaignMetrics[${index}].impressions`),
        clicks: optionalNonNegativeInteger(item?.clicks, `campaignMetrics[${index}].clicks`),
        visitors: optionalNonNegativeInteger(item?.visitors, `campaignMetrics[${index}].visitors`),
        leads: optionalNonNegativeInteger(item?.leads, `campaignMetrics[${index}].leads`),
        conversions: optionalNonNegativeInteger(item?.conversions, `campaignMetrics[${index}].conversions`),
        sourceName: optionalText(item?.sourceName, 160),
        retrievedAt: optionalDate(item?.retrievedAt, `campaignMetrics[${index}].retrievedAt`) || new Date().toISOString()
    };
}

function normalizeReview(item, index) {
    const reviewStatus = String(item?.reviewStatus || 'published').toLowerCase();
    if (!VALID_REVIEW_STATUSES.has(reviewStatus)) throw importError(`reviews[${index}].reviewStatus is not supported.`);
    const rating = optionalNonNegativeNumber(item?.rating, `reviews[${index}].rating`);
    if (rating !== null && rating > 5) throw importError(`reviews[${index}].rating cannot exceed 5.`);
    return {
        externalId: requiredId(item?.externalId, `reviews[${index}].externalId`),
        customerExternalId: optionalId(item?.customerExternalId),
        provider: requiredText(item?.provider, 80, `reviews[${index}].provider`),
        rating,
        reviewText: requiredText(item?.reviewText, 20_000, `reviews[${index}].reviewText`),
        reviewStatus,
        publishedAt: requiredDate(item?.publishedAt, `reviews[${index}].publishedAt`),
        sourceUrl: optionalUrl(item?.sourceUrl, `reviews[${index}].sourceUrl`),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeCompetitor(item, index) {
    return {
        externalId: requiredId(item?.externalId, `competitors[${index}].externalId`),
        name: requiredText(item?.name, 240, `competitors[${index}].name`),
        sourceName: optionalText(item?.sourceName, 160),
        sourceUrl: optionalUrl(item?.sourceUrl, `competitors[${index}].sourceUrl`),
        active: item?.active !== false,
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeCompetitorSnapshot(item, index) {
    return {
        competitorExternalId: requiredId(item?.competitorExternalId, `competitorSnapshots[${index}].competitorExternalId`),
        retrievedAt: requiredDate(item?.retrievedAt, `competitorSnapshots[${index}].retrievedAt`),
        sourceName: requiredText(item?.sourceName, 160, `competitorSnapshots[${index}].sourceName`),
        sourceUrl: optionalUrl(item?.sourceUrl, `competitorSnapshots[${index}].sourceUrl`),
        currency: optionalCurrency(item?.currency),
        products: arrayOfObjects(item?.products, `competitorSnapshots[${index}].products`),
        offers: arrayOfObjects(item?.offers, `competitorSnapshots[${index}].offers`),
        positioning: optionalText(item?.positioning, 10_000),
        rawMetadata: metadataObject(item?.rawMetadata)
    };
}

function normalizeCoupon(item, index) {
    const discountType = requiredText(item?.discountType, 24, `coupons[${index}].discountType`).toLowerCase();
    if (!VALID_DISCOUNT_TYPES.has(discountType)) throw importError(`coupons[${index}].discountType is not supported.`);
    const startsAt = optionalDate(item?.startsAt, `coupons[${index}].startsAt`);
    const endsAt = optionalDate(item?.endsAt, `coupons[${index}].endsAt`);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw importError(`coupons[${index}].endsAt must be after startsAt.`);
    return {
        externalId: requiredId(item?.externalId, `coupons[${index}].externalId`),
        code: requiredText(item?.code, 160, `coupons[${index}].code`),
        discountType,
        discountValue: optionalNonNegativeNumber(item?.discountValue, `coupons[${index}].discountValue`),
        currency: optionalCurrency(item?.currency),
        startsAt,
        endsAt,
        active: item?.active !== false,
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeTrafficDailyMetric(item, index) {
    return {
        externalId: requiredId(item?.externalId, `trafficDailyMetrics[${index}].externalId`),
        metricDate: requiredDateOnly(item?.metricDate, `trafficDailyMetrics[${index}].metricDate`),
        sourceName: requiredText(item?.sourceName, 160, `trafficDailyMetrics[${index}].sourceName`),
        mediumName: optionalText(item?.mediumName, 160),
        campaignName: optionalText(item?.campaignName, 240),
        sessions: optionalNonNegativeInteger(item?.sessions, `trafficDailyMetrics[${index}].sessions`),
        users: optionalNonNegativeInteger(item?.users, `trafficDailyMetrics[${index}].users`),
        newUsers: optionalNonNegativeInteger(item?.newUsers, `trafficDailyMetrics[${index}].newUsers`),
        productViews: optionalNonNegativeInteger(item?.productViews, `trafficDailyMetrics[${index}].productViews`),
        addToCarts: optionalNonNegativeInteger(item?.addToCarts, `trafficDailyMetrics[${index}].addToCarts`),
        checkoutStarts: optionalNonNegativeInteger(item?.checkoutStarts, `trafficDailyMetrics[${index}].checkoutStarts`),
        purchases: optionalNonNegativeInteger(item?.purchases, `trafficDailyMetrics[${index}].purchases`),
        revenueMinor: optionalNonNegativeInteger(item?.revenueMinor, `trafficDailyMetrics[${index}].revenueMinor`),
        currency: optionalCurrency(item?.currency),
        retrievedAt: optionalDate(item?.retrievedAt, `trafficDailyMetrics[${index}].retrievedAt`) || new Date().toISOString(),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeCart(item, index) {
    const status = requiredText(item?.status, 24, `carts[${index}].status`).toLowerCase();
    if (!VALID_CART_STATUSES.has(status)) throw importError(`carts[${index}].status is not supported.`);
    const startedAt = requiredDate(item?.startedAt, `carts[${index}].startedAt`);
    const updatedAt = requiredDate(item?.updatedAt, `carts[${index}].updatedAt`);
    if (new Date(updatedAt) < new Date(startedAt)) throw importError(`carts[${index}].updatedAt cannot be before startedAt.`);
    return {
        externalId: requiredId(item?.externalId, `carts[${index}].externalId`),
        customerExternalId: optionalId(item?.customerExternalId),
        currency: optionalCurrency(item?.currency),
        cartValueMinor: optionalNonNegativeInteger(item?.cartValueMinor, `carts[${index}].cartValueMinor`) || 0,
        itemCount: optionalNonNegativeInteger(item?.itemCount, `carts[${index}].itemCount`) || 0,
        status,
        sourceName: optionalText(item?.sourceName, 160),
        startedAt,
        updatedAt,
        convertedOrderExternalId: optionalId(item?.convertedOrderExternalId),
        metadata: metadataObject(item?.metadata)
    };
}


function normalizeSupplier(item, index) {
    const reliabilityScore = optionalNonNegativeNumber(item?.reliabilityScore, `suppliers[${index}].reliabilityScore`);
    if (reliabilityScore !== null && reliabilityScore > 100) throw importError(`suppliers[${index}].reliabilityScore cannot exceed 100.`);
    return {
        externalId: requiredId(item?.externalId, `suppliers[${index}].externalId`),
        name: requiredText(item?.name, 240, `suppliers[${index}].name`),
        contactName: optionalText(item?.contactName, 200),
        email: optionalEmail(item?.email, `suppliers[${index}].email`),
        phone: optionalText(item?.phone, 80),
        countryCode: optionalCountryCodeValue(item?.countryCode, `suppliers[${index}].countryCode`),
        defaultLeadTimeDays: optionalPositiveNumber(item?.defaultLeadTimeDays, `suppliers[${index}].defaultLeadTimeDays`),
        reliabilityScore,
        active: item?.active !== false,
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeWarehouse(item, index) {
    return {
        externalId: requiredId(item?.externalId, `warehouses[${index}].externalId`),
        name: requiredText(item?.name, 240, `warehouses[${index}].name`),
        region: optionalText(item?.region, 160),
        countryCode: optionalCountryCodeValue(item?.countryCode, `warehouses[${index}].countryCode`),
        capacityUnits: optionalNonNegativeNumber(item?.capacityUnits, `warehouses[${index}].capacityUnits`),
        active: item?.active !== false,
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeInventoryPosition(item, index) {
    return {
        productExternalId: requiredId(item?.productExternalId, `inventoryPositions[${index}].productExternalId`),
        warehouseExternalId: requiredId(item?.warehouseExternalId, `inventoryPositions[${index}].warehouseExternalId`),
        currentStock: optionalNonNegativeNumber(item?.currentStock, `inventoryPositions[${index}].currentStock`) || 0,
        reservedStock: optionalNonNegativeNumber(item?.reservedStock, `inventoryPositions[${index}].reservedStock`) || 0,
        incomingStock: optionalNonNegativeNumber(item?.incomingStock, `inventoryPositions[${index}].incomingStock`) || 0,
        damagedStock: optionalNonNegativeNumber(item?.damagedStock, `inventoryPositions[${index}].damagedStock`) || 0,
        returnedStock: optionalNonNegativeNumber(item?.returnedStock, `inventoryPositions[${index}].returnedStock`) || 0,
        stockValueMinor: optionalNonNegativeInteger(item?.stockValueMinor, `inventoryPositions[${index}].stockValueMinor`),
        countedAt: optionalDate(item?.countedAt, `inventoryPositions[${index}].countedAt`) || new Date().toISOString(),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizePurchaseOrder(item, index) {
    const status = requiredText(item?.status, 32, `purchaseOrders[${index}].status`).toLowerCase();
    const allowed = new Set(['draft', 'ordered', 'in_transit', 'partially_received', 'received', 'cancelled', 'delayed']);
    if (!allowed.has(status)) throw importError(`purchaseOrders[${index}].status is not supported.`);
    const orderDate = requiredDateOnly(item?.orderDate, `purchaseOrders[${index}].orderDate`);
    const expectedDeliveryDate = optionalDateOnly(item?.expectedDeliveryDate, `purchaseOrders[${index}].expectedDeliveryDate`);
    const actualDeliveryDate = optionalDateOnly(item?.actualDeliveryDate, `purchaseOrders[${index}].actualDeliveryDate`);
    if (expectedDeliveryDate && expectedDeliveryDate < orderDate) throw importError(`purchaseOrders[${index}].expectedDeliveryDate cannot be before orderDate.`);
    return {
        externalId: requiredId(item?.externalId, `purchaseOrders[${index}].externalId`),
        supplierExternalId: optionalId(item?.supplierExternalId),
        warehouseExternalId: optionalId(item?.warehouseExternalId),
        status,
        currency: optionalCurrency(item?.currency),
        orderDate,
        expectedDeliveryDate,
        actualDeliveryDate,
        shippingDelayDays: optionalNonNegativeNumber(item?.shippingDelayDays, `purchaseOrders[${index}].shippingDelayDays`),
        transitTimeDays: optionalNonNegativeNumber(item?.transitTimeDays, `purchaseOrders[${index}].transitTimeDays`),
        totalAmountMinor: optionalNonNegativeInteger(item?.totalAmountMinor, `purchaseOrders[${index}].totalAmountMinor`) || 0,
        metadata: metadataObject(item?.metadata)
    };
}

function normalizePurchaseOrderItem(item, index) {
    const quantityOrdered = requiredPositiveNumber(item?.quantityOrdered, `purchaseOrderItems[${index}].quantityOrdered`);
    const quantityReceived = optionalNonNegativeNumber(item?.quantityReceived, `purchaseOrderItems[${index}].quantityReceived`) || 0;
    if (quantityReceived > quantityOrdered) throw importError(`purchaseOrderItems[${index}].quantityReceived cannot exceed quantityOrdered.`);
    return {
        purchaseOrderExternalId: requiredId(item?.purchaseOrderExternalId, `purchaseOrderItems[${index}].purchaseOrderExternalId`),
        externalId: requiredId(item?.externalId, `purchaseOrderItems[${index}].externalId`),
        productExternalId: requiredId(item?.productExternalId, `purchaseOrderItems[${index}].productExternalId`),
        quantityOrdered,
        quantityReceived,
        unitCostMinor: optionalNonNegativeInteger(item?.unitCostMinor, `purchaseOrderItems[${index}].unitCostMinor`),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeStockMovement(item, index) {
    const movementType = requiredText(item?.movementType, 32, `stockMovements[${index}].movementType`).toLowerCase();
    const allowed = new Set(['stock_in', 'stock_out', 'sale', 'return', 'damaged', 'transfer_in', 'transfer_out', 'adjustment']);
    if (!allowed.has(movementType)) throw importError(`stockMovements[${index}].movementType is not supported.`);
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) throw importError(`stockMovements[${index}].quantity must be a non-zero number.`);
    return {
        externalId: requiredText(item?.externalId, 180, `stockMovements[${index}].externalId`),
        productExternalId: requiredId(item?.productExternalId, `stockMovements[${index}].productExternalId`),
        warehouseExternalId: optionalId(item?.warehouseExternalId),
        movementType,
        quantity,
        occurredAt: requiredDate(item?.occurredAt, `stockMovements[${index}].occurredAt`),
        referenceType: optionalText(item?.referenceType, 80),
        referenceExternalId: optionalText(item?.referenceExternalId, 180),
        unitCostMinor: optionalNonNegativeInteger(item?.unitCostMinor, `stockMovements[${index}].unitCostMinor`),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizePromotion(item, index) {
    const discountPercentage = optionalNonNegativeNumber(item?.discountPercentage, `promotions[${index}].discountPercentage`);
    if (discountPercentage !== null && discountPercentage > 100) throw importError(`promotions[${index}].discountPercentage cannot exceed 100.`);
    const startsAt = requiredDate(item?.startsAt, `promotions[${index}].startsAt`);
    const endsAt = requiredDate(item?.endsAt, `promotions[${index}].endsAt`);
    if (new Date(endsAt) <= new Date(startsAt)) throw importError(`promotions[${index}].endsAt must be after startsAt.`);
    return {
        externalId: requiredId(item?.externalId, `promotions[${index}].externalId`),
        name: requiredText(item?.name, 240, `promotions[${index}].name`),
        discountPercentage,
        startsAt,
        endsAt,
        salesChannel: optionalText(item?.salesChannel, 120),
        active: item?.active !== false,
        metadata: metadataObject(item?.metadata)
    };
}

function normalizePromotionProduct(item, index) {
    return {
        promotionExternalId: requiredId(item?.promotionExternalId, `promotionProducts[${index}].promotionExternalId`),
        productExternalId: requiredId(item?.productExternalId, `promotionProducts[${index}].productExternalId`)
    };
}

function normalizeSeasonalEvent(item, index) {
    const startsOn = requiredDateOnly(item?.startsOn, `seasonalEvents[${index}].startsOn`);
    const endsOn = requiredDateOnly(item?.endsOn, `seasonalEvents[${index}].endsOn`);
    if (endsOn < startsOn) throw importError(`seasonalEvents[${index}].endsOn cannot be before startsOn.`);
    return {
        externalId: requiredId(item?.externalId, `seasonalEvents[${index}].externalId`),
        name: requiredText(item?.name, 240, `seasonalEvents[${index}].name`),
        eventType: optionalText(item?.eventType, 120),
        countryCode: optionalCountryCodeValue(item?.countryCode, `seasonalEvents[${index}].countryCode`),
        startsOn,
        endsOn,
        demandMultiplier: optionalPositiveNumber(item?.demandMultiplier, `seasonalEvents[${index}].demandMultiplier`),
        categoryName: optionalText(item?.categoryName, 160),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeWeatherDaily(item, index) {
    const humidity = optionalNonNegativeNumber(item?.humidityPercentage, `weatherDaily[${index}].humidityPercentage`);
    if (humidity !== null && humidity > 100) throw importError(`weatherDaily[${index}].humidityPercentage cannot exceed 100.`);
    return {
        weatherDate: requiredDateOnly(item?.weatherDate, `weatherDaily[${index}].weatherDate`),
        region: optionalText(item?.region, 160) || 'primary',
        temperatureC: optionalFiniteNumber(item?.temperatureC, `weatherDaily[${index}].temperatureC`),
        rainfallMm: optionalNonNegativeNumber(item?.rainfallMm, `weatherDaily[${index}].rainfallMm`),
        humidityPercentage: humidity,
        weatherCondition: optionalText(item?.weatherCondition, 120),
        sourceName: optionalText(item?.sourceName, 160),
        observedAt: optionalDate(item?.observedAt, `weatherDaily[${index}].observedAt`),
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeProductDailyMetric(item, index) {
    const conversionRate = optionalNonNegativeNumber(item?.conversionRate, `productDailyMetrics[${index}].conversionRate`);
    if (conversionRate !== null && conversionRate > 1) throw importError(`productDailyMetrics[${index}].conversionRate cannot exceed 1.`);
    return {
        productExternalId: requiredId(item?.productExternalId, `productDailyMetrics[${index}].productExternalId`),
        metricDate: requiredDateOnly(item?.metricDate, `productDailyMetrics[${index}].metricDate`),
        salesChannel: optionalText(item?.salesChannel, 120) || 'online',
        productViews: optionalNonNegativeInteger(item?.productViews, `productDailyMetrics[${index}].productViews`) || 0,
        wishlistAdds: optionalNonNegativeInteger(item?.wishlistAdds, `productDailyMetrics[${index}].wishlistAdds`) || 0,
        cartAdds: optionalNonNegativeInteger(item?.cartAdds, `productDailyMetrics[${index}].cartAdds`) || 0,
        conversions: optionalNonNegativeInteger(item?.conversions, `productDailyMetrics[${index}].conversions`) || 0,
        conversionRate,
        metadata: metadataObject(item?.metadata)
    };
}

function mapArray(value, mapper, label) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw importError(`${label} must be an array.`);
    return value.map(mapper);
}

function requiredId(value, label) {
    return requiredText(value, 160, label);
}

function optionalId(value) {
    return optionalText(value, 160);
}

function requiredText(value, maximum, label) {
    const text = String(value ?? '').trim();
    if (!text) throw importError(`${label} is required.`);
    if ([...text].length > maximum) throw importError(`${label} is too long.`);
    return text;
}

function optionalText(value, maximum) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if ([...text].length > maximum) throw importError('An imported text value is too long.');
    return text || null;
}

function optionalEmail(value, label) {
    const text = optionalText(value, 254);
    if (!text) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw importError(`${label} is invalid.`);
    return text.toLowerCase();
}

function optionalCurrency(value) {
    if (value === undefined || value === null || value === '') return null;
    const currency = String(value).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw importError('Currency values must use three-letter ISO codes.');
    return currency;
}


function optionalTimezone(value) {
    const text = optionalText(value, 80);
    if (!text) return null;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: text }).format(new Date());
    } catch {
        throw importError('business.timezone must be a valid IANA timezone.');
    }
    return text;
}

function requiredDate(value, label) {
    const result = optionalDate(value, label);
    if (!result) throw importError(`${label} is required.`);
    return result;
}

function optionalDate(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw importError(`${label} is invalid.`);
    return date.toISOString();
}

function requiredDateOnly(value, label) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00.000Z`).getTime())) {
        throw importError(`${label} must be YYYY-MM-DD.`);
    }
    return text;
}

function requiredNonNegativeInteger(value, label) {
    const result = optionalNonNegativeInteger(value, label);
    if (result === null) throw importError(`${label} is required.`);
    return result;
}

function optionalNonNegativeInteger(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw importError(`${label} must be a non-negative integer.`);
    return number;
}

function requiredPositiveNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw importError(`${label} must be greater than zero.`);
    return number;
}

function optionalPositiveInteger(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) throw importError(`${label} must be a positive integer.`);
    return number;
}

function optionalFiniteNumber(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw importError(`${label} must be a finite number.`);
    return number;
}

function optionalDateOnly(value, label) {
    if (value === undefined || value === null || value === '') return null;
    return requiredDateOnly(value, label);
}

function optionalPositiveNumber(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw importError(`${label} must be greater than zero.`);
    return number;
}

function optionalNonNegativeNumber(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw importError(`${label} must be non-negative.`);
    return number;
}

function optionalUrl(value, label) {
    const text = optionalText(value, 2048);
    if (!text) return null;
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        throw importError(`${label} is invalid.`);
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw importError(`${label} must use HTTP or HTTPS.`);
    return parsed.toString();
}

function optionalStringArray(value, label, maxItems, maxLength) {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || value.length > maxItems) throw importError(`${label} must be an array with at most ${maxItems} items.`);
    return value.map((item, index) => requiredText(item, maxLength, `${label}[${index}]`));
}

function optionalObject(value, label, maxBytes) {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value)) throw importError(`${label} must be a JSON object.`);
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw importError(`${label} is too large.`);
    return value;
}

function optionalCountryCode(value) {
    return optionalCountryCodeValue(value, 'business.countryCode');
}

function optionalCountryCodeValue(value, label) {
    const text = optionalText(value, 2);
    if (!text) return null;
    if (!/^[A-Za-z]{2}$/.test(text)) throw importError(`${label} must be a two-letter ISO country code.`);
    return text.toUpperCase();
}

function optionalCoordinate(value, label, minimum, maximum) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) throw importError(`${label} must be between ${minimum} and ${maximum}.`);
    return number;
}

function metadataObject(value) {
    if (value === undefined || value === null) return {};
    if (!isPlainObject(value)) throw importError('Metadata values must be JSON objects.');
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) throw importError('A metadata object is too large.');
    return value;
}

function arrayOfObjects(value, label) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => !isPlainObject(item))) throw importError(`${label} must be an array of JSON objects.`);
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) throw importError(`${label} is too large.`);
    return value;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function importError(publicMessage) {
    const error = new Error(publicMessage);
    error.code = 'INVALID_BUSINESS_IMPORT';
    error.statusCode = 400;
    error.publicMessage = publicMessage;
    return error;
}

module.exports = {
    MAX_IMPORT_RECORDS,
    validateBusinessImportPayload
};
