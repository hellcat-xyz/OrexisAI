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

-- Server-side authentication sessions. Only a SHA-256 hash of the cookie
-- token is persisted so a database read cannot be used as a login cookie.
CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    remember_me BOOLEAN NOT NULL DEFAULT FALSE,
    show_login_intro BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_index
    ON user_sessions (user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS user_sessions_expiry_index
    ON user_sessions (expires_at);

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

-- One counter per user and effective subscription period. The period is a
-- calendar month for Free and the active payment access window for paid plans.
CREATE TABLE IF NOT EXISTS ai_agent_prompt_usage (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id VARCHAR(32) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    accounting_version SMALLINT NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, plan_id, period_start),
    CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS ai_agent_prompt_usage_period_index
    ON ai_agent_prompt_usage (user_id, period_end DESC);

-- Version 1 counted requests before the provider returned, so provider quota
-- failures could inflate the displayed total. Existing version-1 rows cannot be
-- separated reliably into successful and failed prompts; reset them once when
-- installing the success-only accounting model. New rows start at version 2.
ALTER TABLE ai_agent_prompt_usage
    ADD COLUMN IF NOT EXISTS accounting_version SMALLINT;
UPDATE ai_agent_prompt_usage
SET used_count = 0,
    accounting_version = 2,
    updated_at = NOW()
WHERE accounting_version IS NULL OR accounting_version < 2;
ALTER TABLE ai_agent_prompt_usage
    ALTER COLUMN accounting_version SET DEFAULT 2;
ALTER TABLE ai_agent_prompt_usage
    ALTER COLUMN accounting_version SET NOT NULL;

-- Short-lived database reservations prevent concurrent requests from exceeding
-- a plan limit. A reservation becomes usage only after the AI reply is saved.
CREATE TABLE IF NOT EXISTS ai_agent_prompt_reservations (
    reservation_id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL,
    plan_id VARCHAR(32) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id, plan_id, period_start)
        REFERENCES ai_agent_prompt_usage (user_id, plan_id, period_start)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_agent_prompt_reservations_period_index
    ON ai_agent_prompt_reservations (user_id, plan_id, period_start, expires_at);

CREATE INDEX IF NOT EXISTS ai_agent_prompt_reservations_expiry_index
    ON ai_agent_prompt_reservations (expires_at);

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
    business_type VARCHAR(160),
    industry VARCHAR(160),
    products_services JSONB NOT NULL DEFAULT '[]'::JSONB,
    website_url TEXT,
    location JSONB NOT NULL DEFAULT '{}'::JSONB,
    country_code CHAR(2),
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    target_audience TEXT,
    brand_voice TEXT,
    social_media_accounts JSONB NOT NULL DEFAULT '{}'::JSONB,
    marketing_goals JSONB NOT NULL DEFAULT '[]'::JSONB,
    google_place_id VARCHAR(255),
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
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS progress_percentage SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS current_step VARCHAR(100);
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS estimated_completion_at TIMESTAMPTZ;
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

UPDATE workflow_runs
SET heartbeat_at = COALESCE(heartbeat_at, updated_at, started_at, created_at)
WHERE status IN ('queued', 'running')
  AND heartbeat_at IS NULL;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type VARCHAR(160);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS industry VARCHAR(160);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS products_services JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS location JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS country_code CHAR(2);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_audience TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_voice TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS social_media_accounts JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS marketing_goals JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS google_place_id VARCHAR(255);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_runs_progress_check') THEN
        ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_progress_check CHECK (progress_percentage BETWEEN 0 AND 100);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workflow_run_logs (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    level VARCHAR(16) NOT NULL CHECK (level IN ('debug', 'info', 'warning', 'error')),
    step_key VARCHAR(100),
    message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_run_logs_run_created_index ON workflow_run_logs (run_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS workflow_source_snapshots (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    source_type VARCHAR(100) NOT NULL,
    provider VARCHAR(120),
    status VARCHAR(24) NOT NULL CHECK (status IN ('available', 'unavailable')),
    source_url TEXT,
    payload JSONB,
    error_message TEXT,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT workflow_source_snapshots_run_source_unique UNIQUE (run_id, source_type)
);
CREATE INDEX IF NOT EXISTS workflow_source_snapshots_run_index ON workflow_source_snapshots (run_id, retrieved_at ASC);

CREATE TABLE IF NOT EXISTS workflow_artifacts (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    section_key VARCHAR(120) NOT NULL,
    artifact_type VARCHAR(48) NOT NULL,
    title VARCHAR(240) NOT NULL,
    filename VARCHAR(255),
    mime_type VARCHAR(160) NOT NULL,
    content_text TEXT,
    binary_data BYTEA,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    sha256 CHAR(64) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT workflow_artifacts_content_check CHECK (content_text IS NOT NULL OR binary_data IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS workflow_artifacts_run_created_index ON workflow_artifacts (run_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS workflow_artifacts_run_section_index ON workflow_artifacts (run_id, section_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS workflow_runs_business_created_index
    ON workflow_runs (business_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS workflow_runs_active_heartbeat_index
    ON workflow_runs (business_id, workflow_slug, heartbeat_at ASC)
    WHERE status IN ('queued', 'running');

-- A business cannot have two active executions of the same workflow. Failed or
-- abandoned runs older than the execution timeout are released by createWorkflowRun.
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_one_active_per_business
    ON workflow_runs (business_id, workflow_slug)
    WHERE status IN ('queued', 'running');

-- Marketing workspace source data. These tables are populated only through
-- authenticated imports or configured integrations; no synthetic records are seeded.
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS category_name VARCHAR(160);
ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS source_name VARCHAR(160);
ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS shipping_country_code CHAR(2);
ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(160);

CREATE INDEX IF NOT EXISTS business_orders_source_period_index
    ON business_orders (business_id, source_name, ordered_at DESC);
CREATE INDEX IF NOT EXISTS business_orders_country_period_index
    ON business_orders (business_id, shipping_country_code, ordered_at DESC);
CREATE INDEX IF NOT EXISTS business_products_category_index
    ON business_products (business_id, category_name, active, name);

CREATE TABLE IF NOT EXISTS business_coupons (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    code VARCHAR(160) NOT NULL,
    discount_type VARCHAR(24) NOT NULL CHECK (discount_type IN ('percentage', 'fixed', 'shipping', 'other')),
    discount_value NUMERIC(18, 4),
    currency CHAR(3),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_coupons_external_unique UNIQUE (business_id, external_id),
    CONSTRAINT business_coupons_code_unique UNIQUE (business_id, code)
);
CREATE INDEX IF NOT EXISTS business_coupons_active_index
    ON business_coupons (business_id, active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS business_traffic_daily_metrics (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    metric_date DATE NOT NULL,
    source_name VARCHAR(160) NOT NULL,
    medium_name VARCHAR(160),
    campaign_name VARCHAR(240),
    sessions BIGINT CHECK (sessions IS NULL OR sessions >= 0),
    users BIGINT CHECK (users IS NULL OR users >= 0),
    new_users BIGINT CHECK (new_users IS NULL OR new_users >= 0),
    product_views BIGINT CHECK (product_views IS NULL OR product_views >= 0),
    add_to_carts BIGINT CHECK (add_to_carts IS NULL OR add_to_carts >= 0),
    checkout_starts BIGINT CHECK (checkout_starts IS NULL OR checkout_starts >= 0),
    purchases BIGINT CHECK (purchases IS NULL OR purchases >= 0),
    revenue_minor BIGINT CHECK (revenue_minor IS NULL OR revenue_minor >= 0),
    currency CHAR(3),
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_traffic_external_unique UNIQUE (business_id, external_id, metric_date, source_name)
);
CREATE INDEX IF NOT EXISTS business_traffic_period_index
    ON business_traffic_daily_metrics (business_id, metric_date DESC, source_name);

CREATE TABLE IF NOT EXISTS business_cart_sessions (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    customer_id BIGINT REFERENCES business_customers(id) ON DELETE SET NULL,
    currency CHAR(3) NOT NULL,
    cart_value_minor BIGINT NOT NULL DEFAULT 0 CHECK (cart_value_minor >= 0),
    item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    status VARCHAR(24) NOT NULL CHECK (status IN ('active', 'abandoned', 'converted', 'expired', 'recovered')),
    source_name VARCHAR(160),
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    converted_order_external_id VARCHAR(160),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_cart_sessions_external_unique UNIQUE (business_id, external_id)
);
CREATE INDEX IF NOT EXISTS business_cart_sessions_period_index
    ON business_cart_sessions (business_id, started_at DESC, status);

CREATE TABLE IF NOT EXISTS marketing_campaign_assets (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL,
    title VARCHAR(240) NOT NULL,
    content JSONB NOT NULL,
    rationale TEXT,
    verified_facts JSONB NOT NULL DEFAULT '[]'::JSONB,
    status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_campaign_assets_business_created_index
    ON marketing_campaign_assets (business_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS marketing_campaign_assets_run_index
    ON marketing_campaign_assets (run_id, channel, id);

CREATE TABLE IF NOT EXISTS scheduled_workflows (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workflow_slug VARCHAR(80) NOT NULL,
    schedule_kind VARCHAR(48) NOT NULL,
    cadence VARCHAR(24) NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
    run_hour SMALLINT NOT NULL DEFAULT 8 CHECK (run_hour BETWEEN 0 AND 23),
    run_minute SMALLINT NOT NULL DEFAULT 0 CHECK (run_minute BETWEEN 0 AND 59),
    day_of_week SMALLINT CHECK (day_of_week BETWEEN 1 AND 7),
    day_of_month SMALLINT CHECK (day_of_month BETWEEN 1 AND 28),
    timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
    input JSONB NOT NULL DEFAULT '{}'::JSONB,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    last_run_id BIGINT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    last_status VARCHAR(32),
    last_error TEXT,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scheduled_workflows_unique_kind UNIQUE (business_id, schedule_kind)
);
CREATE INDEX IF NOT EXISTS scheduled_workflows_due_index
    ON scheduled_workflows (enabled, next_run_at ASC)
    WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS marketing_workspace_cache (
    business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    cache_key CHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    source_updated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_workspace_cache_expiry_index
    ON marketing_workspace_cache (expires_at);

CREATE TABLE IF NOT EXISTS workflow_ai_executions (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    model VARCHAR(160) NOT NULL,
    prompt_text TEXT NOT NULL,
    response JSONB NOT NULL,
    context_hash CHAR(64) NOT NULL,
    prompt_bytes BIGINT NOT NULL CHECK (prompt_bytes >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_ai_executions_run_index
    ON workflow_ai_executions (run_id, created_at DESC, id DESC);

-- Inventory operations data foundation. All rows are tenant-scoped through business_id.
CREATE TABLE IF NOT EXISTS business_suppliers (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    name VARCHAR(240) NOT NULL,
    contact_name VARCHAR(200),
    email VARCHAR(254),
    phone VARCHAR(80),
    country_code CHAR(2),
    default_lead_time_days NUMERIC(10, 2) CHECK (default_lead_time_days IS NULL OR default_lead_time_days > 0),
    reliability_score NUMERIC(5, 2) CHECK (reliability_score IS NULL OR (reliability_score >= 0 AND reliability_score <= 100)),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_suppliers_external_unique UNIQUE (business_id, external_id)
);
CREATE INDEX IF NOT EXISTS business_suppliers_active_index ON business_suppliers (business_id, active, name);

CREATE TABLE IF NOT EXISTS business_warehouses (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    name VARCHAR(240) NOT NULL,
    region VARCHAR(160),
    country_code CHAR(2),
    capacity_units NUMERIC(18, 4) CHECK (capacity_units IS NULL OR capacity_units >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_warehouses_external_unique UNIQUE (business_id, external_id)
);
CREATE INDEX IF NOT EXISTS business_warehouses_active_index ON business_warehouses (business_id, active, name);

ALTER TABLE business_customers ADD COLUMN IF NOT EXISTS customer_segment VARCHAR(120);
ALTER TABLE business_customers ADD COLUMN IF NOT EXISTS purchase_frequency VARCHAR(80);
ALTER TABLE business_customers ADD COLUMN IF NOT EXISTS region VARCHAR(160);

ALTER TABLE business_products ADD COLUMN IF NOT EXISTS barcode VARCHAR(160);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS brand VARCHAR(160);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS subcategory_name VARCHAR(160);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES business_suppliers(id) ON DELETE SET NULL;
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(200);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS weight_grams NUMERIC(18, 4) CHECK (weight_grams IS NULL OR weight_grams >= 0);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS dimensions JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER CHECK (shelf_life_days IS NULL OR shelf_life_days > 0);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS storage_requirements TEXT;
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS safety_stock NUMERIC(18, 4) CHECK (safety_stock IS NULL OR safety_stock >= 0);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS reorder_point NUMERIC(18, 4) CHECK (reorder_point IS NULL OR reorder_point >= 0);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS reorder_quantity NUMERIC(18, 4) CHECK (reorder_quantity IS NULL OR reorder_quantity > 0);
ALTER TABLE business_products ADD COLUMN IF NOT EXISTS default_warehouse_id BIGINT REFERENCES business_warehouses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS business_products_supplier_index ON business_products (business_id, supplier_id, active);
CREATE INDEX IF NOT EXISTS business_products_warehouse_index ON business_products (business_id, default_warehouse_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS business_products_barcode_unique ON business_products (business_id, barcode) WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_inventory_positions (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
    warehouse_id BIGINT NOT NULL REFERENCES business_warehouses(id) ON DELETE CASCADE,
    current_stock NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    reserved_stock NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
    incoming_stock NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (incoming_stock >= 0),
    damaged_stock NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (damaged_stock >= 0),
    returned_stock NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (returned_stock >= 0),
    stock_value_minor BIGINT CHECK (stock_value_minor IS NULL OR stock_value_minor >= 0),
    counted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_inventory_positions_unique UNIQUE (product_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS business_inventory_positions_business_index ON business_inventory_positions (business_id, warehouse_id, product_id);

CREATE TABLE IF NOT EXISTS business_purchase_orders (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    supplier_id BIGINT REFERENCES business_suppliers(id) ON DELETE SET NULL,
    warehouse_id BIGINT REFERENCES business_warehouses(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('draft', 'ordered', 'in_transit', 'partially_received', 'received', 'cancelled', 'delayed')),
    currency CHAR(3) NOT NULL,
    order_date DATE NOT NULL,
    expected_delivery_date DATE,
    actual_delivery_date DATE,
    shipping_delay_days NUMERIC(10, 2) CHECK (shipping_delay_days IS NULL OR shipping_delay_days >= 0),
    transit_time_days NUMERIC(10, 2) CHECK (transit_time_days IS NULL OR transit_time_days >= 0),
    total_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_amount_minor >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_purchase_orders_external_unique UNIQUE (business_id, external_id),
    CONSTRAINT business_purchase_orders_dates_check CHECK (expected_delivery_date IS NULL OR expected_delivery_date >= order_date)
);
CREATE INDEX IF NOT EXISTS business_purchase_orders_status_index ON business_purchase_orders (business_id, status, expected_delivery_date);

CREATE TABLE IF NOT EXISTS business_purchase_order_items (
    id BIGSERIAL PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES business_purchase_orders(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    product_id BIGINT NOT NULL REFERENCES business_products(id) ON DELETE RESTRICT,
    quantity_ordered NUMERIC(18, 4) NOT NULL CHECK (quantity_ordered > 0),
    quantity_received NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    unit_cost_minor BIGINT CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_purchase_order_items_external_unique UNIQUE (purchase_order_id, external_id),
    CONSTRAINT business_purchase_order_items_received_check CHECK (quantity_received <= quantity_ordered)
);
CREATE INDEX IF NOT EXISTS business_purchase_order_items_product_index ON business_purchase_order_items (product_id, purchase_order_id);

CREATE TABLE IF NOT EXISTS business_stock_movements (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(180) NOT NULL,
    product_id BIGINT NOT NULL REFERENCES business_products(id) ON DELETE RESTRICT,
    warehouse_id BIGINT REFERENCES business_warehouses(id) ON DELETE SET NULL,
    movement_type VARCHAR(32) NOT NULL CHECK (movement_type IN ('stock_in', 'stock_out', 'sale', 'return', 'damaged', 'transfer_in', 'transfer_out', 'adjustment')),
    quantity NUMERIC(18, 4) NOT NULL CHECK (quantity <> 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    reference_type VARCHAR(80),
    reference_external_id VARCHAR(180),
    unit_cost_minor BIGINT CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_stock_movements_external_unique UNIQUE (business_id, external_id)
);
CREATE INDEX IF NOT EXISTS business_stock_movements_period_index ON business_stock_movements (business_id, product_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS business_promotions (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    name VARCHAR(240) NOT NULL,
    discount_percentage NUMERIC(6, 3) CHECK (discount_percentage IS NULL OR (discount_percentage >= 0 AND discount_percentage <= 100)),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    sales_channel VARCHAR(120),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_promotions_external_unique UNIQUE (business_id, external_id),
    CONSTRAINT business_promotions_dates_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS business_promotions_period_index ON business_promotions (business_id, starts_at, ends_at, active);

CREATE TABLE IF NOT EXISTS business_promotion_products (
    promotion_id BIGINT NOT NULL REFERENCES business_promotions(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, product_id)
);

CREATE TABLE IF NOT EXISTS business_seasonal_events (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    external_id VARCHAR(160) NOT NULL,
    name VARCHAR(240) NOT NULL,
    event_type VARCHAR(120),
    country_code CHAR(2),
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    demand_multiplier NUMERIC(8, 4) CHECK (demand_multiplier IS NULL OR demand_multiplier > 0),
    category_name VARCHAR(160),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_seasonal_events_external_unique UNIQUE (business_id, external_id),
    CONSTRAINT business_seasonal_events_dates_check CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS business_seasonal_events_period_index ON business_seasonal_events (business_id, starts_on, ends_on);

CREATE TABLE IF NOT EXISTS business_weather_daily (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    weather_date DATE NOT NULL,
    region VARCHAR(160) NOT NULL DEFAULT 'primary',
    temperature_c NUMERIC(7, 3),
    rainfall_mm NUMERIC(10, 3) CHECK (rainfall_mm IS NULL OR rainfall_mm >= 0),
    humidity_percentage NUMERIC(6, 3) CHECK (humidity_percentage IS NULL OR (humidity_percentage >= 0 AND humidity_percentage <= 100)),
    weather_condition VARCHAR(120),
    source_name VARCHAR(160),
    observed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_weather_daily_unique UNIQUE (business_id, weather_date, region)
);
CREATE INDEX IF NOT EXISTS business_weather_daily_period_index ON business_weather_daily (business_id, weather_date DESC, region);

CREATE TABLE IF NOT EXISTS business_product_daily_metrics (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    sales_channel VARCHAR(120) NOT NULL DEFAULT 'online',
    product_views BIGINT NOT NULL DEFAULT 0 CHECK (product_views >= 0),
    wishlist_adds BIGINT NOT NULL DEFAULT 0 CHECK (wishlist_adds >= 0),
    cart_adds BIGINT NOT NULL DEFAULT 0 CHECK (cart_adds >= 0),
    conversions BIGINT NOT NULL DEFAULT 0 CHECK (conversions >= 0),
    conversion_rate NUMERIC(8, 6) CHECK (conversion_rate IS NULL OR (conversion_rate >= 0 AND conversion_rate <= 1)),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT business_product_daily_metrics_unique UNIQUE (product_id, metric_date, sales_channel)
);
CREATE INDEX IF NOT EXISTS business_product_daily_metrics_period_index ON business_product_daily_metrics (business_id, metric_date DESC, product_id);
