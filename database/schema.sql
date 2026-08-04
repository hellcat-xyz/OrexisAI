CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing installations created password_hash as NOT NULL. OAuth-only users do
-- not have a local password, so this migration intentionally makes it nullable.
ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
    ON users (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
    ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_accounts_provider_identity_unique UNIQUE (provider, provider_user_id),
    CONSTRAINT oauth_accounts_user_provider_unique UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS oauth_accounts_user_id_index
    ON oauth_accounts (user_id);

-- Billing state and verified gateway transactions.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS current_plan VARCHAR(32) NOT NULL DEFAULT 'free';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    plan_id VARCHAR(32) NOT NULL,
    provider_order_id VARCHAR(128) NOT NULL,
    provider_payment_id VARCHAR(128),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT payments_provider_order_unique UNIQUE (provider, provider_order_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_unique
    ON payments (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_user_created_index
    ON payments (user_id, created_at DESC);

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS refunded_amount_minor BIGINT NOT NULL DEFAULT 0;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS access_starts_at TIMESTAMPTZ;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS payment_refunds (
    id BIGSERIAL PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_refund_id VARCHAR(128) NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status VARCHAR(24) NOT NULL,
    provider_created_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT payment_refunds_provider_refund_unique UNIQUE (provider, provider_refund_id)
);

CREATE INDEX IF NOT EXISTS payment_refunds_payment_index
    ON payment_refunds (payment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    provider_order_id VARCHAR(128),
    provider_payment_id VARCHAR(128),
    status VARCHAR(24) NOT NULL
        CHECK (status IN ('processing', 'processed', 'ignored', 'payment_failed')),
    provider_created_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT payment_webhook_events_provider_event_unique UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_order_index
    ON payment_webhook_events (provider, provider_order_id, received_at DESC);

-- Persistent AI-agent conversations and client command history.
CREATE TABLE IF NOT EXISTS chat_conversations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(80) NOT NULL DEFAULT 'New chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_conversations_user_updated_index
    ON chat_conversations (user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL CHECK (char_length(content) >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_index
    ON chat_messages (conversation_id, created_at ASC, id ASC);

-- One-time, hashed password reset links. Raw reset tokens are never stored.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    requested_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_index
    ON password_reset_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_index
    ON password_reset_tokens (expires_at)
    WHERE used_at IS NULL;

-- Replace the legacy 4,000-character constraint without deleting existing chat data.
ALTER TABLE chat_messages
    DROP CONSTRAINT IF EXISTS chat_messages_content_check;
ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_content_check CHECK (char_length(content) >= 1);

-- Outcome workflow executions. Workflow definitions live in workflows/registry.js;
-- these tables store each user-owned run and its ordered step state.
CREATE TABLE IF NOT EXISTS workflow_runs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workflow_slug VARCHAR(80) NOT NULL,
    workflow_name VARCHAR(120) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued'
        CHECK (
            status IN (
                'queued',
                'running',
                'waiting_for_input',
                'waiting_for_approval',
                'completed',
                'failed',
                'cancelled'
            )
        ),
    input JSONB NOT NULL DEFAULT '{}'::JSONB,
    output JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workflow_runs_user_created_index
    ON workflow_runs (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS workflow_runs_status_created_index
    ON workflow_runs (status, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS workflow_step_runs (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_key VARCHAR(100) NOT NULL,
    step_title VARCHAR(160) NOT NULL,
    step_order INTEGER NOT NULL CHECK (step_order >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'queued'
        CHECK (
            status IN (
                'queued',
                'running',
                'waiting_for_input',
                'waiting_for_approval',
                'completed',
                'failed',
                'skipped'
            )
        ),
    input JSONB,
    output JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT workflow_step_runs_order_unique UNIQUE (run_id, step_order),
    CONSTRAINT workflow_step_runs_key_unique UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS workflow_step_runs_run_order_index
    ON workflow_step_runs (run_id, step_order ASC);

-- Tenant-owned business data used by production workflows. These tables contain
-- only imported or integration-sourced records; the application never seeds
-- sample analytics or synthetic customer data.
CREATE TABLE IF NOT EXISTS businesses (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_memberships (
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(24) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'analyst', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS business_memberships_user_index
    ON business_memberships (user_id, created_at ASC, business_id ASC);

CREATE TABLE IF NOT EXISTS business_customers (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    name VARCHAR(200),
    email VARCHAR(254),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    first_seen_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_customers_external_unique UNIQUE (business_id, external_id)
);

CREATE INDEX IF NOT EXISTS business_customers_activity_index
    ON business_customers (business_id, last_activity_at DESC NULLS LAST, id DESC);

CREATE TABLE IF NOT EXISTS business_products (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    name VARCHAR(240) NOT NULL,
    sku VARCHAR(160),
    currency CHAR(3) NOT NULL,
    price_minor BIGINT CHECK (price_minor IS NULL OR price_minor >= 0),
    cost_minor BIGINT CHECK (cost_minor IS NULL OR cost_minor >= 0),
    current_stock NUMERIC(18, 4) CHECK (current_stock IS NULL OR current_stock >= 0),
    lead_time_days NUMERIC(10, 2) CHECK (lead_time_days IS NULL OR lead_time_days > 0),
    reorder_buffer_days NUMERIC(10, 2) CHECK (reorder_buffer_days IS NULL OR reorder_buffer_days >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_products_external_unique UNIQUE (business_id, external_id)
);

CREATE INDEX IF NOT EXISTS business_products_active_index
    ON business_products (business_id, active, name ASC);

CREATE TABLE IF NOT EXISTS business_orders (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    customer_id BIGINT REFERENCES business_customers(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL,
    currency CHAR(3) NOT NULL,
    total_amount_minor BIGINT NOT NULL CHECK (total_amount_minor >= 0),
    ordered_at TIMESTAMPTZ NOT NULL,
    refunded_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount_minor >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_orders_external_unique UNIQUE (business_id, external_id),
    CONSTRAINT business_orders_refund_check CHECK (refunded_amount_minor <= total_amount_minor)
);

CREATE INDEX IF NOT EXISTS business_orders_period_index
    ON business_orders (business_id, ordered_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS business_orders_customer_index
    ON business_orders (business_id, customer_id, ordered_at DESC);

CREATE TABLE IF NOT EXISTS business_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES business_orders(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    product_id BIGINT REFERENCES business_products(id) ON DELETE SET NULL,
    quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
    unit_price_minor BIGINT CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
    total_amount_minor BIGINT CHECK (total_amount_minor IS NULL OR total_amount_minor >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_order_items_external_unique UNIQUE (order_id, external_id)
);

CREATE INDEX IF NOT EXISTS business_order_items_product_index
    ON business_order_items (product_id, order_id);

CREATE TABLE IF NOT EXISTS business_campaign_daily_metrics (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    campaign_name VARCHAR(240) NOT NULL,
    metric_date DATE NOT NULL,
    currency CHAR(3) NOT NULL,
    spend_minor BIGINT CHECK (spend_minor IS NULL OR spend_minor >= 0),
    attributed_revenue_minor BIGINT CHECK (attributed_revenue_minor IS NULL OR attributed_revenue_minor >= 0),
    impressions BIGINT CHECK (impressions IS NULL OR impressions >= 0),
    clicks BIGINT CHECK (clicks IS NULL OR clicks >= 0),
    visitors BIGINT CHECK (visitors IS NULL OR visitors >= 0),
    leads BIGINT CHECK (leads IS NULL OR leads >= 0),
    conversions BIGINT CHECK (conversions IS NULL OR conversions >= 0),
    source_name VARCHAR(160),
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_campaign_metrics_external_unique UNIQUE (business_id, external_id, metric_date)
);

CREATE INDEX IF NOT EXISTS business_campaign_metrics_period_index
    ON business_campaign_daily_metrics (business_id, metric_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS business_reviews (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    customer_id BIGINT REFERENCES business_customers(id) ON DELETE SET NULL,
    provider VARCHAR(80) NOT NULL,
    rating NUMERIC(3, 2) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
    review_text TEXT NOT NULL CHECK (char_length(review_text) > 0),
    review_status VARCHAR(32) NOT NULL DEFAULT 'published',
    published_at TIMESTAMPTZ NOT NULL,
    source_url TEXT,
    response_draft TEXT,
    response_status VARCHAR(32) NOT NULL DEFAULT 'unanswered'
        CHECK (response_status IN ('unanswered', 'draft', 'approved', 'sent', 'failed')),
    responded_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_reviews_external_unique UNIQUE (business_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS business_reviews_unanswered_index
    ON business_reviews (business_id, response_status, published_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS business_competitors (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    name VARCHAR(240) NOT NULL,
    source_name VARCHAR(160),
    source_url TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_competitors_external_unique UNIQUE (business_id, external_id)
);

CREATE INDEX IF NOT EXISTS business_competitors_active_index
    ON business_competitors (business_id, active, name ASC);

CREATE TABLE IF NOT EXISTS business_competitor_snapshots (
    id BIGSERIAL PRIMARY KEY,
    competitor_id BIGINT NOT NULL REFERENCES business_competitors(id) ON DELETE CASCADE,
    retrieved_at TIMESTAMPTZ NOT NULL,
    source_name VARCHAR(160) NOT NULL,
    source_url TEXT,
    currency CHAR(3),
    products JSONB NOT NULL DEFAULT '[]'::JSONB,
    offers JSONB NOT NULL DEFAULT '[]'::JSONB,
    positioning TEXT,
    raw_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_competitor_snapshots_retrieval_unique UNIQUE (competitor_id, retrieved_at)
);

CREATE INDEX IF NOT EXISTS business_competitor_snapshots_latest_index
    ON business_competitor_snapshots (competitor_id, retrieved_at DESC, id DESC);

ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS data_period_start TIMESTAMPTZ;
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS data_period_end TIMESTAMPTZ;
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS data_retrieved_at TIMESTAMPTZ;
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS records_analyzed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

CREATE INDEX IF NOT EXISTS workflow_runs_business_created_index
    ON workflow_runs (business_id, created_at DESC, id DESC);

-- A business cannot have two active executions of the same workflow. Failed or
-- abandoned runs older than the execution timeout are released by createWorkflowRun.
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_one_active_per_business
    ON workflow_runs (business_id, workflow_slug)
    WHERE status IN ('queued', 'running');
