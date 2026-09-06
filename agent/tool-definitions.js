'use strict';

const DATE_PROPERTIES = Object.freeze({
    from: {
        type: 'string',
        description: 'Optional start date/time. Use YYYY-MM-DD or an ISO-8601 timestamp.'
    },
    to: {
        type: 'string',
        description: 'Optional end date/time. Use YYYY-MM-DD or an ISO-8601 timestamp.'
    }
});

const LIMIT_PROPERTY = Object.freeze({
    type: 'integer',
    description: 'Optional maximum number of rows to return. Use a small number between 1 and 20.'
});

const AGENT_TOOL_DECLARATIONS = Object.freeze([
    Object.freeze({
        name: 'get_business_overview',
        description: 'Read the authenticated user business overview, including current and previous-period sales, customers, CRM counts, marketing facts, and deterministic calculated metrics. Use this for broad questions about how the business is performing.',
        parameters: {
            type: 'object',
            properties: DATE_PROPERTIES
        }
    }),
    Object.freeze({
        name: 'get_marketing_workspace',
        description: 'Read current deterministic marketing analytics for the authenticated user business, including revenue/order trends, product performance, campaign performance, traffic, funnel, customer segments, stock alerts, and data limitations. Prefer narrower analyst tools when only one area is needed.',
        parameters: {
            type: 'object',
            properties: DATE_PROPERTIES
        }
    }),
    Object.freeze({
        name: 'get_enterprise_analytics',
        description: 'Read the authenticated user enterprise analytics dashboard with executive metrics, revenue trends, products, inventory, attribution, customer analytics, anomalies, business health, and deterministic recommendations. Use this for deep cross-functional analysis when narrower tools are insufficient.',
        parameters: {
            type: 'object',
            properties: DATE_PROPERTIES
        }
    }),
    Object.freeze({
        name: 'get_inventory_summary',
        description: 'Read the authenticated user current inventory data foundation and availability summary. Use this when the question is about whether enough inventory, supplier, warehouse, or purchase-order data exists for analysis.',
        parameters: {
            type: 'object',
            properties: {}
        }
    }),
    Object.freeze({
        name: 'get_revenue_comparison',
        description: 'Compare current vs previous-period revenue, orders, average order value, customers, and deterministic diagnostic signals. Use this first when revenue rose or fell, when orders and revenue move differently, or when the user asks what changed and why.',
        parameters: {
            type: 'object',
            properties: DATE_PROPERTIES
        }
    }),
    Object.freeze({
        name: 'get_sales_breakdown',
        description: 'Read a compact sales breakdown by daily trend, products, categories, traffic sources, geography, and coupons for the selected period. Use this to investigate where revenue came from or which mix/channel/location explains a change.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_PROPERTIES,
                limit: LIMIT_PROPERTY
            }
        }
    }),
    Object.freeze({
        name: 'get_product_performance',
        description: 'Read product-level sales, revenue, previous-period comparisons, profit when available, stock cover, and inventory risk. Use this when the user asks about a product, SKU, best sellers, product mix, or product-level causes.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_PROPERTIES,
                productQuery: {
                    type: 'string',
                    description: 'Optional product name, SKU, or product ID to match. Leave empty to return leading products.'
                },
                limit: LIMIT_PROPERTY
            }
        }
    }),
    Object.freeze({
        name: 'get_declining_products',
        description: 'Read the products with the steepest measured revenue declines versus the previous comparable period, including revenue delta, units, order count, and stock context. Use this to identify products driving a downturn.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_PROPERTIES,
                limit: LIMIT_PROPERTY
            }
        }
    }),
    Object.freeze({
        name: 'get_customer_retention',
        description: 'Read customer retention and lifecycle metrics without exposing customer identities: purchasing customers, repeat customers, repeat-purchase rate, lifetime revenue/value, new/active customer counts, and aggregate customer segments.',
        parameters: {
            type: 'object',
            properties: DATE_PROPERTIES
        }
    }),
    Object.freeze({
        name: 'get_inventory_risk',
        description: 'Read calculated product-level stock risk using current stock, sales velocity, days of cover, reorder point, and recent demand. Use this to answer what may stock out, what should be monitored, or what likely needs reordering.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_PROPERTIES,
                limit: LIMIT_PROPERTY
            }
        }
    }),
    Object.freeze({
        name: 'get_campaign_performance',
        description: 'Read measured campaign spend, attributed revenue, ROAS, impressions, clicks, visitors, conversions, CTR, conversion rate, CAC, and campaign-data freshness. Use this for paid marketing performance or to test whether campaigns explain a business change.',
        parameters: {
            type: 'object',
            properties: {
                ...DATE_PROPERTIES,
                limit: LIMIT_PROPERTY
            }
        }
    })
]);

module.exports = {
    AGENT_TOOL_DECLARATIONS
};
