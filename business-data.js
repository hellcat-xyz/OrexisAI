'use strict';

const MAX_IMPORT_RECORDS = 10_000;
const VALID_ORDER_STATUSES = new Set(['pending', 'paid', 'completed', 'fulfilled', 'cancelled', 'refunded', 'failed']);
const VALID_REVIEW_STATUSES = new Set(['published', 'hidden', 'removed']);

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
        competitorSnapshots: mapArray(input.competitorSnapshots, normalizeCompetitorSnapshot, 'competitorSnapshots')
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
        metadata: metadataObject(item?.metadata)
    };
}

function normalizeProduct(item, index) {
    return {
        externalId: requiredId(item?.externalId, `products[${index}].externalId`),
        name: requiredText(item?.name, 240, `products[${index}].name`),
        sku: optionalText(item?.sku, 160),
        currency: optionalCurrency(item?.currency),
        priceMinor: optionalNonNegativeInteger(item?.priceMinor, `products[${index}].priceMinor`),
        costMinor: optionalNonNegativeInteger(item?.costMinor, `products[${index}].costMinor`),
        currentStock: optionalNonNegativeNumber(item?.currentStock, `products[${index}].currentStock`),
        leadTimeDays: optionalPositiveNumber(item?.leadTimeDays, `products[${index}].leadTimeDays`),
        reorderBufferDays: optionalNonNegativeNumber(item?.reorderBufferDays, `products[${index}].reorderBufferDays`),
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
