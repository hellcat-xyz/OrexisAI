'use strict';

const { createHttpClient } = require('./http-client');

const MAX_WEBSITE_TEXT = 60_000;
const MAX_COMPETITORS = 8;
const MAX_REVIEWS = 20;
const MAX_ITEMS_PER_SOURCE = 25;

function createLiveMarketingDataCollector({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const http = createHttpClient({
        fetchImpl,
        timeoutMs: parseInteger(env.MARKETING_SOURCE_TIMEOUT_MS, 12_000, 2_000, 60_000),
        retries: parseInteger(env.MARKETING_SOURCE_RETRIES, 2, 0, 5)
    });

    return {
        configuration() {
            return {
                googlePlaces: Boolean(env.GOOGLE_PLACES_API_KEY),
                googleTrends: Boolean(env.GOOGLE_TRENDS_API_URL),
                keywordTrends: Boolean(env.KEYWORD_TRENDS_API_URL),
                industryNews: Boolean(env.NEWS_API_KEY),
                localEvents: Boolean(env.TICKETMASTER_API_KEY),
                seasonalEvents: Boolean(env.SEASONAL_EVENTS_API_URL),
                weather: Boolean(env.OPENWEATHER_API_KEY),
                socialTrends: Boolean(env.SOCIAL_TRENDS_API_URL)
            };
        },

        async collectCompetitors({ competitors = [], onLog = () => {} } = {}) {
            onLog('info', 'Refreshing configured competitor websites.');
            try {
                const value = await collectCompetitors(http, competitors);
                const snapshot = normalizeSnapshot('competitors', value);
                onLog(snapshot.status === 'available' ? 'info' : 'warning', snapshot.status === 'available'
                    ? 'Competitor website refresh completed.'
                    : `Competitor website refresh is unavailable: ${snapshot.errorMessage}`);
                return {
                    retrievedAt: snapshot.retrievedAt,
                    status: snapshot.status,
                    provider: snapshot.provider,
                    results: Array.isArray(snapshot.payload) ? snapshot.payload : [],
                    reason: snapshot.status === 'available' ? null : snapshot.errorMessage
                };
            } catch (error) {
                const snapshot = unavailableSnapshot('competitors', error.publicMessage || error.message || 'Competitor source request failed.');
                onLog('warning', `Competitor website refresh failed: ${snapshot.errorMessage}`);
                return {
                    retrievedAt: snapshot.retrievedAt,
                    status: 'unavailable',
                    provider: snapshot.provider,
                    results: [],
                    reason: snapshot.errorMessage
                };
            }
        },

        async collect({ business, competitors = [], databaseReviews = [], period, onLog = () => {} }) {
            const tasks = [
                ['website', () => collectWebsite(http, business)],
                ['google-business-profile', () => collectGooglePlace(http, env, business)],
                ['business-reviews', () => collectDatabaseReviews(databaseReviews)],
                ['competitors', () => collectCompetitors(http, competitors)],
                ['trending-keywords', () => collectConfiguredJson(http, env.KEYWORD_TRENDS_API_URL, env.KEYWORD_TRENDS_API_TOKEN, {
                    business: summarizeBusinessForProvider(business),
                    period
                }, 'keyword-trends-api')],
                ['google-trends', () => collectConfiguredJson(http, env.GOOGLE_TRENDS_API_URL, env.GOOGLE_TRENDS_API_TOKEN, {
                    keywords: deriveSeedKeywords(business),
                    geo: business.country_code || business.location?.countryCode || null,
                    period
                }, 'google-trends-api')],
                ['industry-news', () => collectIndustryNews(http, env, business, period)],
                ['public-holidays', () => collectPublicHolidays(http, business, period)],
                ['local-events', () => collectLocalEvents(http, env, business, period)],
                ['seasonal-events', () => collectConfiguredJson(http, env.SEASONAL_EVENTS_API_URL, env.SEASONAL_EVENTS_API_TOKEN, {
                    business: summarizeBusinessForProvider(business), period
                }, 'seasonal-events-api')],
                ['weather', () => collectWeather(http, env, business)],
                ['social-media-trends', () => collectConfiguredJson(http, env.SOCIAL_TRENDS_API_URL, env.SOCIAL_TRENDS_API_TOKEN, {
                    business: summarizeBusinessForProvider(business),
                    socialAccounts: business.social_media_accounts || {},
                    period
                }, 'social-trends-api')]
            ];

            const snapshots = await Promise.all(tasks.map(async ([sourceType, operation]) => {
                onLog('info', `Collecting ${sourceType.replaceAll('-', ' ')}.`);
                try {
                    const value = await operation();
                    const snapshot = normalizeSnapshot(sourceType, value);
                    onLog(snapshot.status === 'available' ? 'info' : 'warning', snapshot.status === 'available'
                        ? `Collected ${sourceType.replaceAll('-', ' ')}.`
                        : `${sourceType.replaceAll('-', ' ')} is unavailable: ${snapshot.errorMessage}`);
                    return snapshot;
                } catch (error) {
                    const snapshot = unavailableSnapshot(sourceType, error.publicMessage || error.message || 'Source request failed.');
                    onLog('warning', `${sourceType.replaceAll('-', ' ')} failed: ${snapshot.errorMessage}`);
                    return snapshot;
                }
            }));

            return {
                retrievedAt: new Date().toISOString(),
                snapshots,
                available: Object.fromEntries(snapshots.filter((item) => item.status === 'available').map((item) => [item.sourceType, item.payload])),
                unavailable: snapshots.filter((item) => item.status !== 'available').map((item) => ({
                    sourceType: item.sourceType,
                    reason: item.errorMessage
                }))
            };
        }
    };
}

async function collectWebsite(http, business) {
    if (!business.website_url) return unavailable('website', 'Business website URL is not configured.');
    const html = await http.text(business.website_url, { maxBytes: 2 * 1024 * 1024 });
    const parsed = parseWebsite(html, business.website_url);
    if (!parsed.text) return unavailable('website', 'The website returned no usable public text.');
    return {
        provider: 'business-website',
        sourceUrl: business.website_url,
        payload: parsed
    };
}

async function collectGooglePlace(http, env, business) {
    if (!env.GOOGLE_PLACES_API_KEY) return unavailable('google-places', 'GOOGLE_PLACES_API_KEY is not configured.');
    if (!business.google_place_id) return unavailable('google-places', 'The business Google Place ID is not configured.');
    const fields = [
        'id', 'displayName', 'formattedAddress', 'location', 'websiteUri', 'businessStatus',
        'rating', 'userRatingCount', 'reviews', 'regularOpeningHours', 'primaryTypeDisplayName', 'googleMapsUri'
    ].join(',');
    const endpoint = `https://places.googleapis.com/v1/places/${encodeURIComponent(business.google_place_id)}`;
    const payload = await http.json(endpoint, {
        headers: {
            'X-Goog-Api-Key': String(env.GOOGLE_PLACES_API_KEY),
            'X-Goog-FieldMask': fields
        }
    });
    return {
        provider: 'google-places',
        sourceUrl: payload.googleMapsUri || null,
        payload: {
            id: payload.id,
            displayName: payload.displayName?.text || null,
            formattedAddress: payload.formattedAddress || null,
            location: payload.location || null,
            websiteUri: payload.websiteUri || null,
            businessStatus: payload.businessStatus || null,
            primaryType: payload.primaryTypeDisplayName?.text || null,
            rating: numberOrNull(payload.rating),
            userRatingCount: integerOrNull(payload.userRatingCount),
            openingHours: payload.regularOpeningHours?.weekdayDescriptions || [],
            reviews: (payload.reviews || []).slice(0, MAX_REVIEWS).map((review) => ({
                name: review.name || null,
                rating: numberOrNull(review.rating),
                text: review.text?.text || review.originalText?.text || null,
                relativePublishTimeDescription: review.relativePublishTimeDescription || null,
                publishTime: review.publishTime || null,
                author: review.authorAttribution?.displayName || null,
                sourceUrl: review.googleMapsUri || null
            }))
        }
    };
}

function collectDatabaseReviews(reviews) {
    const normalized = (Array.isArray(reviews) ? reviews : []).slice(0, MAX_REVIEWS).map((review) => ({
        provider: review.provider,
        rating: numberOrNull(review.rating),
        text: review.review_text,
        publishedAt: review.published_at,
        sourceUrl: review.source_url || null,
        status: review.review_status
    }));
    if (normalized.length === 0) return unavailable('database', 'No current imported review records are available.');
    return { provider: 'postgresql', sourceUrl: null, payload: normalized };
}

async function collectCompetitors(http, competitors) {
    const configured = (Array.isArray(competitors) ? competitors : [])
        .filter((item) => item.active !== false && item.source_url)
        .slice(0, MAX_COMPETITORS);
    if (configured.length === 0) return unavailable('competitor-websites', 'No competitor website URLs are configured.');

    const results = await Promise.all(configured.map(async (competitor) => {
        try {
            const html = await http.text(competitor.source_url, {
                maxBytes: 2 * 1024 * 1024,
                truncate: true,
                headers: { 'Accept-Language': 'en-US,en;q=0.8' }
            });
            const parsed = parseWebsite(html, competitor.source_url);
            const products = normalizeWebsiteProducts(parsed.offers);
            const currencies = [...new Set(products.map((item) => item.currency).filter(Boolean))];
            return {
                id: Number(competitor.id),
                name: competitor.name,
                sourceName: 'public-website',
                sourceUrl: competitor.source_url,
                status: 'available',
                title: parsed.title,
                description: parsed.description,
                positioning: [parsed.title, parsed.description].filter(Boolean).join(' — ') || null,
                text: parsed.text.slice(0, 20_000),
                pricing: parsed.pricing,
                currency: currencies.length === 1 ? currencies[0] : null,
                products,
                offers: parsed.offers,
                rawMetadata: { headings: parsed.headings.slice(0, 20), pricing: parsed.pricing.slice(0, MAX_ITEMS_PER_SOURCE) }
            };
        } catch (error) {
            return {
                id: Number(competitor.id),
                name: competitor.name,
                sourceUrl: competitor.source_url,
                status: 'unavailable',
                errorCode: error.code || null,
                statusCode: Number(error.statusCode) || null,
                error: error.publicMessage || error.message
            };
        }
    }));
    const available = results.filter((item) => item.status === 'available');
    if (available.length === 0) {
        return {
            status: 'unavailable',
            provider: 'public-websites',
            sourceUrl: null,
            payload: results,
            reason: 'Configured competitor websites could not be retrieved.'
        };
    }
    return { provider: 'public-websites', sourceUrl: null, payload: results };
}

async function collectConfiguredJson(http, endpoint, token, requestBody, provider) {
    if (!endpoint) return unavailable(provider, `${provider.toUpperCase().replaceAll('-', '_')}_URL is not configured.`);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const payload = await http.json(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        maxBytes: 2 * 1024 * 1024
    });
    return { provider, sourceUrl: endpoint, payload: limitProviderPayload(payload) };
}

async function collectIndustryNews(http, env, business, period) {
    if (!env.NEWS_API_KEY) return unavailable('newsapi', 'NEWS_API_KEY is not configured.');
    const query = deriveSeedKeywords(business).slice(0, 4).join(' OR ');
    if (!query) return unavailable('newsapi', 'Business industry or products are required for news discovery.');
    const params = new URLSearchParams({
        q: query.slice(0, 500),
        sortBy: 'publishedAt',
        pageSize: '15',
        language: String(env.NEWS_API_LANGUAGE || 'en')
    });
    if (periodBoundary(period, 'from')) params.set('from', String(periodBoundary(period, 'from')).slice(0, 10));
    if (periodBoundary(period, 'to')) params.set('to', String(periodBoundary(period, 'to')).slice(0, 10));
    const endpoint = `https://newsapi.org/v2/everything?${params}`;
    const payload = await http.json(endpoint, { headers: { 'X-Api-Key': String(env.NEWS_API_KEY) } });
    return {
        provider: 'newsapi',
        sourceUrl: 'https://newsapi.org',
        payload: (payload.articles || []).slice(0, MAX_ITEMS_PER_SOURCE).map((article) => ({
            source: article.source?.name || null,
            title: article.title || null,
            description: article.description || null,
            url: article.url || null,
            publishedAt: article.publishedAt || null
        }))
    };
}

async function collectPublicHolidays(http, business, period) {
    const countryCode = String(business.country_code || business.location?.countryCode || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) return unavailable('nager-date', 'A two-letter business country code is required for public holidays.');
    const from = new Date(periodBoundary(period, 'from') || Date.now());
    const to = new Date(periodBoundary(period, 'to') || (Date.now() + 14 * 86_400_000));
    const years = [...new Set([from.getUTCFullYear(), to.getUTCFullYear()])];
    const responses = await Promise.all(years.map((year) => http.json(`https://date.nager.at/api/v4/Holidays/${countryCode}/${year}`)));
    const lower = from.getTime() - (7 * 86_400_000);
    const upper = to.getTime() + (30 * 86_400_000);
    const holidays = responses.flat().filter((holiday) => {
        const time = Date.parse(holiday.date);
        return Number.isFinite(time) && time >= lower && time <= upper;
    }).slice(0, MAX_ITEMS_PER_SOURCE);
    return { provider: 'nager-date', sourceUrl: 'https://date.nager.at', payload: holidays };
}

async function collectLocalEvents(http, env, business, period) {
    if (!env.TICKETMASTER_API_KEY) return unavailable('ticketmaster', 'TICKETMASTER_API_KEY is not configured.');
    const city = business.location?.city || business.location?.locality;
    const countryCode = String(business.country_code || business.location?.countryCode || '').toUpperCase();
    if (!city && !countryCode) return unavailable('ticketmaster', 'Business city or country is required for local events.');
    const params = new URLSearchParams({
        apikey: String(env.TICKETMASTER_API_KEY),
        size: '20',
        sort: 'date,asc'
    });
    if (city) params.set('city', city);
    if (/^[A-Z]{2}$/.test(countryCode)) params.set('countryCode', countryCode);
    if (periodBoundary(period, 'from')) params.set('startDateTime', new Date(periodBoundary(period, 'from')).toISOString());
    if (periodBoundary(period, 'to')) params.set('endDateTime', new Date(new Date(periodBoundary(period, 'to')).getTime() + (14 * 86_400_000)).toISOString());
    const endpoint = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
    const payload = await http.json(endpoint);
    const events = payload._embedded?.events || [];
    return {
        provider: 'ticketmaster',
        sourceUrl: 'https://www.ticketmaster.com',
        payload: events.slice(0, MAX_ITEMS_PER_SOURCE).map((event) => ({
            id: event.id,
            name: event.name,
            url: event.url || null,
            date: event.dates?.start?.dateTime || event.dates?.start?.localDate || null,
            venue: event._embedded?.venues?.[0]?.name || null,
            city: event._embedded?.venues?.[0]?.city?.name || null,
            classification: event.classifications?.[0]?.segment?.name || null
        }))
    };
}

async function collectWeather(http, env, business) {
    if (!env.OPENWEATHER_API_KEY) return unavailable('openweather', 'OPENWEATHER_API_KEY is not configured.');
    const latitude = numberOrNull(business.latitude ?? business.location?.latitude ?? business.location?.lat);
    const longitude = numberOrNull(business.longitude ?? business.location?.longitude ?? business.location?.lng ?? business.location?.lon);
    if (latitude === null || longitude === null) return unavailable('openweather', 'Business latitude and longitude are required for weather data.');
    const params = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        appid: String(env.OPENWEATHER_API_KEY),
        units: String(env.OPENWEATHER_UNITS || 'metric')
    });
    const [current, forecast] = await Promise.all([
        http.json(`https://api.openweathermap.org/data/2.5/weather?${params}`),
        http.json(`https://api.openweathermap.org/data/2.5/forecast?${params}`)
    ]);
    return {
        provider: 'openweather',
        sourceUrl: 'https://openweathermap.org',
        payload: {
            current: normalizeWeatherItem(current),
            forecast: (forecast.list || []).slice(0, 24).map(normalizeWeatherItem)
        }
    };
}

function deriveSeedKeywords(business) {
    const values = [
        business.industry,
        business.business_type,
        ...(Array.isArray(business.products_services) ? business.products_services : []),
        ...(Array.isArray(business.marketing_goals) ? business.marketing_goals : [])
    ];
    return [...new Set(values.flatMap((value) => String(value || '').split(/[,;|]/)).map(cleanText).filter((value) => value.length >= 2))].slice(0, 12);
}

function summarizeBusinessForProvider(business) {
    return {
        name: business.name,
        businessType: business.business_type || null,
        industry: business.industry || null,
        productsServices: Array.isArray(business.products_services) ? business.products_services : [],
        websiteUrl: business.website_url || null,
        location: business.location || {},
        countryCode: business.country_code || null,
        targetAudience: business.target_audience || null,
        marketingGoals: Array.isArray(business.marketing_goals) ? business.marketing_goals : []
    };
}

function normalizeWeatherItem(value) {
    return {
        observedAt: value.dt ? new Date(Number(value.dt) * 1000).toISOString() : null,
        temperature: numberOrNull(value.main?.temp),
        feelsLike: numberOrNull(value.main?.feels_like),
        minimumTemperature: numberOrNull(value.main?.temp_min),
        maximumTemperature: numberOrNull(value.main?.temp_max),
        humidity: numberOrNull(value.main?.humidity),
        precipitationProbability: numberOrNull(value.pop),
        conditions: (value.weather || []).map((item) => item.description).filter(Boolean),
        windSpeed: numberOrNull(value.wind?.speed)
    };
}

function periodBoundary(period, key) {
    return period?.[key] || period?.current?.[key] || null;
}

function parseWebsite(html, sourceUrl) {
    const source = String(html || '').slice(0, 2 * 1024 * 1024);
    const title = decodeHtml(firstMatch(source, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const description = decodeHtml(
        firstMatch(source, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
        || firstMatch(source, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i)
    );
    const headings = [...source.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
        .slice(0, 30)
        .map((match) => cleanHtmlText(match[1]))
        .filter(Boolean);
    const structured = [...source.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
        .slice(0, 20)
        .flatMap((match) => parseJsonLd(match[1]));
    const offers = extractOffers(structured).slice(0, MAX_ITEMS_PER_SOURCE);
    const visibleText = cleanHtmlText(
        source
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    ).slice(0, MAX_WEBSITE_TEXT);
    return {
        sourceUrl,
        title: title || null,
        description: description || null,
        headings,
        text: visibleText,
        pricing: extractVisiblePrices(visibleText),
        offers
    };
}

function firstMatch(value, pattern) {
    const match = String(value || '').match(pattern);
    return match ? cleanHtmlText(match[1]) : '';
}

function cleanHtmlText(value) {
    return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value) {
    const entities = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
    };
    return String(value || '')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function parseJsonLd(value) {
    try {
        const parsed = JSON.parse(String(value || '').trim());
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

function extractOffers(values) {
    const offers = [];
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        const type = Array.isArray(value['@type']) ? value['@type'].join(' ') : String(value['@type'] || '');
        if (/product|offer|service/i.test(type) || value.offers) {
            const nested = Array.isArray(value.offers) ? value.offers : value.offers ? [value.offers] : [value];
            for (const item of nested) {
                if (!item || typeof item !== 'object') continue;
                const price = item.price ?? item.lowPrice ?? item.highPrice ?? value.price;
                const name = value.name || item.name || null;
                if (name || price !== undefined) {
                    offers.push({
                        name: name ? String(name).slice(0, 240) : null,
                        price: price === undefined ? null : String(price).slice(0, 80),
                        currency: item.priceCurrency || value.priceCurrency || null,
                        availability: item.availability || null,
                        url: item.url || value.url || null
                    });
                }
            }
        }
        Object.values(value).forEach(visit);
    };
    values.forEach(visit);
    return deduplicateObjects(offers);
}

function normalizeWebsiteProducts(offers) {
    const products = [];
    for (const offer of Array.isArray(offers) ? offers : []) {
        const name = cleanText(offer?.name);
        if (!name) continue;
        const currency = normalizeCurrencyCode(offer?.currency);
        const amount = parsePriceAmount(offer?.price);
        products.push({
            name: name.slice(0, 240),
            priceMinor: amount === null || !currency ? null : toMinorUnits(amount, currency),
            price: amount,
            currency,
            availability: offer?.availability ? String(offer.availability).slice(0, 240) : null,
            url: offer?.url ? String(offer.url).slice(0, 2000) : null
        });
    }
    return deduplicateObjects(products).slice(0, MAX_ITEMS_PER_SOURCE);
}

function normalizeCurrencyCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
}

function parsePriceAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function toMinorUnits(amount, currency) {
    let digits = 2;
    try {
        digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    } catch {}
    return Math.round(Number(amount) * (10 ** digits));
}

function extractVisiblePrices(text) {
    const matches = String(text || '').match(/(?:[$€£₹¥]|USD|EUR|GBP|INR|CAD|AUD)\s?\d[\d,.]*(?:\.\d{1,2})?/gi) || [];
    return [...new Set(matches.map((item) => item.trim()))].slice(0, MAX_ITEMS_PER_SOURCE);
}

function deduplicateObjects(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = JSON.stringify(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizeSnapshot(sourceType, value) {
    if (value?.status === 'unavailable') return unavailableSnapshot(sourceType, value.reason, value.provider, value.sourceUrl, value.payload);
    return {
        sourceType,
        provider: value?.provider || sourceType,
        status: 'available',
        sourceUrl: value?.sourceUrl || null,
        payload: limitProviderPayload(value?.payload ?? value ?? {}),
        errorMessage: null,
        retrievedAt: new Date().toISOString()
    };
}

function unavailable(provider, reason, sourceUrl = null) {
    return { status: 'unavailable', provider, reason, sourceUrl };
}

function unavailableSnapshot(sourceType, reason, provider = sourceType, sourceUrl = null, payload = null) {
    return {
        sourceType,
        provider,
        status: 'unavailable',
        sourceUrl,
        payload: payload === null || payload === undefined ? null : limitProviderPayload(payload),
        errorMessage: String(reason || 'Source is unavailable.').slice(0, 2000),
        retrievedAt: new Date().toISOString()
    };
}

function limitProviderPayload(payload) {
    const serialized = JSON.stringify(payload ?? null);
    if (Buffer.byteLength(serialized, 'utf8') <= 512 * 1024) return payload;
    return { truncated: true, preview: serialized.slice(0, 500_000) };
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

function parseInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

module.exports = {
    createLiveMarketingDataCollector,
    deriveSeedKeywords,
    extractOffers,
    extractVisiblePrices,
    parseWebsite
};
