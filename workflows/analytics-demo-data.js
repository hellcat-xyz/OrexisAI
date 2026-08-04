'use strict';

const DEMO_DATASET_VERSION = 'orexis-analytics-v1';
const DEMO_DAYS = 180;

function createAnalyticsDemoPayload({ businessId, currency = 'USD', timezone = 'UTC', now = new Date() } = {}) {
    const seed = Math.max(1, Number(businessId) || 1) * 2654435761;
    const random = createPrng(seed >>> 0);
    const end = startOfUtcDay(now);
    const products = buildProducts(currency);
    const customers = buildCustomers(random, end);
    const orders = [];
    const orderItems = [];
    const campaignMetrics = [];
    const trafficDailyMetrics = [];
    const carts = [];
    const coupons = buildCoupons(currency, end);
    const reviews = [];
    const channels = [
        { name: 'Direct', medium: 'direct', weight: 0.3, conversion: 0.041 },
        { name: 'Google Ads', medium: 'cpc', weight: 0.27, conversion: 0.033 },
        { name: 'Instagram', medium: 'social', weight: 0.23, conversion: 0.025 },
        { name: 'Email', medium: 'email', weight: 0.2, conversion: 0.052 }
    ];
    const countries = ['IN', 'US', 'GB', 'AE', 'CA'];
    let orderSequence = 0;
    let cartSequence = 0;

    for (let offset = DEMO_DAYS - 1; offset >= 0; offset -= 1) {
        const day = addUtcDays(end, -offset);
        const dateKey = day.toISOString().slice(0, 10);
        const weekday = day.getUTCDay();
        const trend = 0.78 + ((DEMO_DAYS - offset) / DEMO_DAYS) * 0.42;
        const weekendLift = weekday === 0 || weekday === 6 ? 1.24 : 1;
        const seasonalWave = 1 + Math.sin((DEMO_DAYS - offset) / 13) * 0.12;
        const campaignLift = offset < 25 ? 1.18 : 1;
        const expectedOrders = Math.max(1, Math.round((2.8 + random() * 3.7) * trend * weekendLift * seasonalWave * campaignLift));
        const dailyChannelOrders = new Map(channels.map((channel) => [channel.name, 0]));
        const dailyChannelRevenue = new Map(channels.map((channel) => [channel.name, 0]));

        for (let index = 0; index < expectedOrders; index += 1) {
            orderSequence += 1;
            const repeatBias = random() < 0.46;
            const customerIndex = repeatBias
                ? Math.floor(random() * Math.min(55, customers.length))
                : Math.floor(random() * customers.length);
            const customer = customers[customerIndex];
            const channel = weightedPick(random, channels, (item) => item.weight);
            const product = weightedPick(random, products, (item) => item.popularity);
            const quantity = random() < 0.18 ? 2 : 1;
            const secondProduct = random() < 0.28 ? weightedPick(random, products, (item) => item.popularity) : null;
            const subtotal = product.priceMinor * quantity + (secondProduct ? secondProduct.priceMinor : 0);
            const couponCode = random() < 0.18 ? (random() < 0.58 ? 'WELCOME10' : 'WEEKEND15') : null;
            const discount = couponCode === 'WEEKEND15' ? Math.round(subtotal * 0.15) : couponCode ? Math.round(subtotal * 0.1) : 0;
            const totalAmountMinor = Math.max(100, subtotal - discount);
            const refundedAmountMinor = random() < 0.045 ? Math.round(totalAmountMinor * (random() < 0.3 ? 1 : 0.35)) : 0;
            const hour = pickOrderHour(random, weekday);
            const orderedAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, Math.floor(random() * 60), Math.floor(random() * 60)));
            const orderExternalId = `orexis-demo-order-${dateKey}-${String(orderSequence).padStart(5, '0')}`;
            const country = countries[Math.min(countries.length - 1, Math.floor(random() ** 1.65 * countries.length))];

            orders.push({
                externalId: orderExternalId,
                customerExternalId: customer.externalId,
                status: random() < 0.57 ? 'fulfilled' : random() < 0.83 ? 'completed' : 'paid',
                currency,
                totalAmountMinor,
                refundedAmountMinor,
                orderedAt: orderedAt.toISOString(),
                sourceName: channel.name,
                shippingCountryCode: country,
                couponCode,
                metadata: demoMetadata({ timezone, channel: channel.name })
            });
            orderItems.push({
                orderExternalId,
                externalId: `${orderExternalId}-item-1`,
                productExternalId: product.externalId,
                quantity,
                unitPriceMinor: product.priceMinor,
                totalAmountMinor: product.priceMinor * quantity,
                metadata: demoMetadata()
            });
            if (secondProduct) {
                orderItems.push({
                    orderExternalId,
                    externalId: `${orderExternalId}-item-2`,
                    productExternalId: secondProduct.externalId,
                    quantity: 1,
                    unitPriceMinor: secondProduct.priceMinor,
                    totalAmountMinor: secondProduct.priceMinor,
                    metadata: demoMetadata()
                });
            }
            dailyChannelOrders.set(channel.name, dailyChannelOrders.get(channel.name) + 1);
            dailyChannelRevenue.set(channel.name, dailyChannelRevenue.get(channel.name) + Math.max(0, totalAmountMinor - refundedAmountMinor));
            customer.lastActivityAt = orderedAt.toISOString();
        }

        channels.forEach((channel, channelIndex) => {
            const measuredOrders = dailyChannelOrders.get(channel.name);
            const measuredRevenue = dailyChannelRevenue.get(channel.name);
            const sessions = Math.max(measuredOrders, Math.round((75 + random() * 160) * trend * weekendLift * channel.weight * 3.5));
            const productViews = Math.round(sessions * (0.62 + random() * 0.16));
            const addToCarts = Math.max(measuredOrders, Math.round(productViews * (0.13 + random() * 0.07)));
            const checkoutStarts = Math.max(measuredOrders, Math.round(addToCarts * (0.52 + random() * 0.16)));
            const campaignSpendMinor = channel.name === 'Direct' ? 0 : Math.round((1400 + random() * 4200) * trend * (channel.name === 'Google Ads' ? 1.35 : 1));
            const impressions = channel.name === 'Email'
                ? Math.round(sessions * (7 + random() * 3))
                : Math.round(sessions * (26 + random() * 34));
            const clicks = Math.max(sessions, Math.round(impressions * (0.018 + random() * 0.027)));

            trafficDailyMetrics.push({
                externalId: `orexis-demo-traffic-${channelIndex}-${dateKey}`,
                metricDate: dateKey,
                sourceName: channel.name,
                mediumName: channel.medium,
                campaignName: channel.name === 'Direct' ? null : `${channel.name} Always On`,
                sessions,
                users: Math.round(sessions * 0.83),
                newUsers: Math.round(sessions * (0.45 + random() * 0.18)),
                productViews,
                addToCarts,
                checkoutStarts,
                purchases: measuredOrders,
                revenueMinor: measuredRevenue,
                currency,
                retrievedAt: addUtcDays(day, 1).toISOString(),
                metadata: demoMetadata()
            });

            if (channel.name !== 'Direct') {
                campaignMetrics.push({
                    externalId: `orexis-demo-campaign-${channelIndex}-${dateKey}`,
                    campaignName: `${channel.name} Always On`,
                    metricDate: dateKey,
                    currency,
                    spendMinor: campaignSpendMinor,
                    attributedRevenueMinor: measuredRevenue,
                    impressions,
                    clicks,
                    visitors: sessions,
                    leads: Math.round(sessions * (0.07 + random() * 0.06)),
                    conversions: measuredOrders,
                    sourceName: channel.name,
                    retrievedAt: addUtcDays(day, 1).toISOString()
                });
            }
        });

        const cartCount = Math.max(1, Math.round(expectedOrders * (0.42 + random() * 0.4)));
        for (let index = 0; index < cartCount; index += 1) {
            cartSequence += 1;
            const channel = weightedPick(random, channels, (item) => item.weight);
            const converted = random() < 0.36;
            const recovered = !converted && random() < 0.13;
            const startedHour = pickOrderHour(random, weekday);
            const startedAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), startedHour, Math.floor(random() * 60)));
            carts.push({
                externalId: `orexis-demo-cart-${dateKey}-${String(cartSequence).padStart(5, '0')}`,
                customerExternalId: random() < 0.72 ? customers[Math.floor(random() * customers.length)].externalId : null,
                currency,
                cartValueMinor: products[Math.floor(random() * products.length)].priceMinor * (random() < 0.2 ? 2 : 1),
                itemCount: random() < 0.22 ? 2 : 1,
                status: converted ? 'converted' : recovered ? 'recovered' : 'abandoned',
                sourceName: channel.name,
                startedAt: startedAt.toISOString(),
                updatedAt: new Date(startedAt.getTime() + (20 + Math.floor(random() * 420)) * 60_000).toISOString(),
                convertedOrderExternalId: null,
                metadata: demoMetadata()
            });
        }
    }

    customers.forEach((customer, index) => {
        if (index < 24) {
            reviews.push({
                externalId: `orexis-demo-review-${String(index + 1).padStart(3, '0')}`,
                customerExternalId: customer.externalId,
                provider: 'demo-store',
                rating: index % 7 === 0 ? 3 : index % 5 === 0 ? 4 : 5,
                reviewText: index % 7 === 0
                    ? 'Delivery was fine, but clearer product guidance would improve the experience.'
                    : 'The purchase was straightforward and the product matched the description.',
                reviewStatus: 'published',
                publishedAt: customer.lastActivityAt || customer.firstSeenAt,
                metadata: demoMetadata()
            });
        }
    });

    return {
        business: null,
        customers,
        products: products.map(({ popularity, ...product }) => product),
        orders,
        orderItems,
        campaignMetrics,
        reviews,
        competitors: [],
        competitorSnapshots: [],
        coupons,
        trafficDailyMetrics,
        carts
    };
}

function buildProducts(currency) {
    const rows = [
        ['starter-kit', 'Starter Kit', 'Core Products', 4900, 2100, 86, 7, 5, 1.35],
        ['growth-bundle', 'Growth Bundle', 'Bundles', 8900, 3600, 52, 12, 6, 1.18],
        ['pro-pack', 'Pro Pack', 'Core Products', 12900, 5400, 39, 14, 7, 0.98],
        ['team-license', 'Team License', 'Subscriptions', 17900, 6100, 24, 18, 8, 0.74],
        ['support-plus', 'Support Plus', 'Services', 5900, 1700, 999, 2, 1, 0.81],
        ['automation-addon', 'Automation Add-on', 'Add-ons', 3900, 900, 71, 9, 4, 1.1],
        ['analytics-addon', 'Analytics Add-on', 'Add-ons', 4900, 1200, 64, 10, 4, 0.96],
        ['premium-template', 'Premium Template', 'Digital Products', 2900, 400, 120, 3, 2, 1.24],
        ['consulting-session', 'Consulting Session', 'Services', 14900, 6200, 999, 2, 1, 0.53],
        ['enterprise-pack', 'Enterprise Pack', 'Bundles', 24900, 9800, 18, 24, 10, 0.42],
        ['creator-pack', 'Creator Pack', 'Digital Products', 6900, 1800, 45, 8, 5, 0.88],
        ['retention-toolkit', 'Retention Toolkit', 'Digital Products', 7900, 2300, 31, 11, 5, 0.68]
    ];
    return rows.map(([slug, name, categoryName, priceMinor, costMinor, currentStock, leadTimeDays, reorderBufferDays, popularity], index) => ({
        externalId: `orexis-demo-product-${slug}`,
        name,
        sku: `OD-${String(index + 1).padStart(3, '0')}`,
        categoryName,
        currency,
        priceMinor,
        costMinor,
        currentStock,
        leadTimeDays,
        reorderBufferDays,
        active: true,
        popularity,
        metadata: demoMetadata()
    }));
}

function buildCustomers(random, end) {
    const firstNames = ['Aarav', 'Maya', 'Noah', 'Sofia', 'Arjun', 'Lina', 'Ethan', 'Zara', 'Rohan', 'Emma', 'Kabir', 'Nora'];
    const lastNames = ['Shah', 'Patel', 'Brown', 'Wilson', 'Mehta', 'Khan', 'Lee', 'Martin', 'Singh', 'Clark'];
    return Array.from({ length: 120 }, (_, index) => {
        const first = firstNames[index % firstNames.length];
        const last = lastNames[Math.floor(index / firstNames.length) % lastNames.length];
        const firstSeen = addUtcDays(end, -(20 + Math.floor(random() * 320)));
        return {
            externalId: `orexis-demo-customer-${String(index + 1).padStart(4, '0')}`,
            name: `${first} ${last}`,
            email: `demo.customer.${String(index + 1).padStart(4, '0')}@example.com`,
            status: index % 19 === 0 ? 'at-risk' : 'active',
            firstSeenAt: firstSeen.toISOString(),
            lastActivityAt: addUtcDays(firstSeen, Math.floor(random() * Math.max(1, Math.min(300, (end - firstSeen) / 86_400_000)))).toISOString(),
            metadata: demoMetadata()
        };
    });
}

function buildCoupons(currency, end) {
    return [
        { externalId: 'orexis-demo-coupon-welcome10', code: 'WELCOME10', discountType: 'percentage', discountValue: 10, currency, startsAt: addUtcDays(end, -365).toISOString(), endsAt: addUtcDays(end, 365).toISOString(), active: true, metadata: demoMetadata() },
        { externalId: 'orexis-demo-coupon-weekend15', code: 'WEEKEND15', discountType: 'percentage', discountValue: 15, currency, startsAt: addUtcDays(end, -365).toISOString(), endsAt: addUtcDays(end, 365).toISOString(), active: true, metadata: demoMetadata() }
    ];
}

function pickOrderHour(random, weekday) {
    const businessHours = weekday >= 1 && weekday <= 5;
    if (random() < (businessHours ? 0.72 : 0.54)) return 9 + Math.floor(random() * 9);
    const hours = [0, 1, 7, 8, 18, 19, 20, 21, 22, 23];
    return hours[Math.floor(random() * hours.length)];
}

function weightedPick(random, rows, weightSelector) {
    const total = rows.reduce((sum, item) => sum + Math.max(0, Number(weightSelector(item)) || 0), 0);
    let cursor = random() * total;
    for (const item of rows) {
        cursor -= Math.max(0, Number(weightSelector(item)) || 0);
        if (cursor <= 0) return item;
    }
    return rows.at(-1);
}

function createPrng(seed) {
    let state = seed || 1;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function demoMetadata(extra = {}) {
    return { orexis_demo: DEMO_DATASET_VERSION, ...extra };
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
    DEMO_DATASET_VERSION,
    createAnalyticsDemoPayload
};
