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
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_index
    ON chat_messages (conversation_id, created_at ASC, id ASC);

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
