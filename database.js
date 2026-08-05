'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { getPlanById } = require('./plans');
const { buildMarketingPeriods } = require('./workflows/marketing-utils');

function createDatabaseFromEnvironment(env = process.env) {
    const connectionString = env.DATABASE_URL?.trim();
    if (!connectionString) {
        throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.');
    }

    const pool = new Pool({
        connectionString,
        max: parsePoolSize(env.DATABASE_POOL_MAX || '10'),
        ssl: env.DATABASE_SSL === 'true'
            ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
            : undefined
    });

    pool.on('error', (error) => {
        console.error('Unexpected PostgreSQL pool error:', error.message);
    });

    return createUserStore(pool);
}

function createUserStore(pool) {
    return {
        async initialize() {
            const schemaPath = path.join(__dirname, 'database', 'schema.sql');
            const schema = await fs.readFile(schemaPath, 'utf8');
            await pool.query(schema);
        },

        async healthCheck() {
            await pool.query('SELECT 1');
        },

        async findUserByEmail(email) {
            const result = await pool.query(
                `SELECT id, username, email, password_hash
                 FROM users
                 WHERE LOWER(email) = LOWER($1)
                 LIMIT 1`,
                [email]
            );
            return result.rows[0] || null;
        },

        async createUser({ username, email, passwordHash }) {
            const result = await pool.query(
                `INSERT INTO users (username, email, password_hash)
                 VALUES ($1, $2, $3)
                 RETURNING id, username, email`,
                [username, email, passwordHash]
            );
            return result.rows[0];
        },

        async createAuthSession({ tokenHash, userId, expiresAt, rememberMe, showLoginIntro = true }) {
            await pool.query(
                `INSERT INTO user_sessions (
                    token_hash, user_id, expires_at, remember_me, show_login_intro
                 ) VALUES ($1, $2, $3, $4, $5)`,
                [tokenHash, userId, expiresAt, rememberMe === true, showLoginIntro === true]
            );
        },

        async findAuthSession(tokenHash) {
            const result = await pool.query(
                `SELECT sessions.user_id,
                        sessions.expires_at,
                        sessions.remember_me,
                        sessions.show_login_intro,
                        users.username,
                        users.email
                 FROM user_sessions sessions
                 INNER JOIN users ON users.id = sessions.user_id
                 WHERE sessions.token_hash = $1
                   AND sessions.expires_at > NOW()
                 LIMIT 1`,
                [tokenHash]
            );
            return result.rows[0] || null;
        },

        async markAuthSessionIntroShown(tokenHash) {
            await pool.query(
                `UPDATE user_sessions
                 SET show_login_intro = FALSE, updated_at = NOW()
                 WHERE token_hash = $1`,
                [tokenHash]
            );
        },

        async deleteAuthSession(tokenHash) {
            await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
        },

        async deleteAuthSessionsForUser(userId) {
            await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
        },

        async deleteExpiredAuthSessions() {
            await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
        },

        async createPasswordResetToken({ email, tokenHash, expiresAt, requestedIp }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const userResult = await client.query(
                    `SELECT id, username, email
                     FROM users
                     WHERE LOWER(email) = LOWER($1)
                     LIMIT 1
                     FOR UPDATE`,
                    [email]
                );
                const user = userResult.rows[0] || null;
                if (!user) {
                    await client.query('COMMIT');
                    return null;
                }

                await client.query(
                    `UPDATE password_reset_tokens
                     SET used_at = COALESCE(used_at, NOW())
                     WHERE user_id = $1 AND used_at IS NULL`,
                    [user.id]
                );
                await client.query(
                    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
                     VALUES ($1, $2, $3, $4)`,
                    [user.id, tokenHash, expiresAt, requestedIp || null]
                );
                await client.query('COMMIT');
                return user;
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async getPasswordResetTokenStatus(tokenHash) {
            const result = await pool.query(
                `SELECT used_at, expires_at, expires_at <= NOW() AS expired
                 FROM password_reset_tokens
                 WHERE token_hash = $1
                 LIMIT 1`,
                [tokenHash]
            );
            const token = result.rows[0];
            if (!token) return 'invalid';
            if (token.used_at) return 'used';
            if (token.expired) return 'expired';
            return 'ready';
        },

        async consumePasswordResetToken({ tokenHash, passwordHash }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const tokenResult = await client.query(
                    `SELECT id, user_id, used_at, expires_at, expires_at <= NOW() AS expired
                     FROM password_reset_tokens
                     WHERE token_hash = $1
                     LIMIT 1
                     FOR UPDATE`,
                    [tokenHash]
                );
                const token = tokenResult.rows[0];
                if (!token) {
                    await client.query('ROLLBACK');
                    return { status: 'invalid' };
                }
                if (token.used_at) {
                    await client.query('ROLLBACK');
                    return { status: 'used' };
                }
                if (token.expired) {
                    await client.query('ROLLBACK');
                    return { status: 'expired' };
                }

                await client.query(
                    `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
                    [token.user_id, passwordHash]
                );
                await client.query(
                    `UPDATE password_reset_tokens
                     SET used_at = NOW()
                     WHERE user_id = $1 AND used_at IS NULL`,
                    [token.user_id]
                );
                await client.query('COMMIT');
                return { status: 'success', userId: String(token.user_id) };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async deleteExpiredPasswordResetTokens() {
            await pool.query(
                `DELETE FROM password_reset_tokens
                 WHERE expires_at < NOW() - INTERVAL '1 day'
                    OR used_at < NOW() - INTERVAL '1 day'`
            );
        },

        async getBillingProfile(userId) {
            const result = await pool.query(
                `UPDATE users
                 SET current_plan = CASE
                         WHEN plan_expires_at IS NOT NULL AND plan_expires_at <= NOW() THEN 'free'
                         ELSE current_plan
                     END,
                     plan_expires_at = CASE
                         WHEN plan_expires_at IS NOT NULL AND plan_expires_at <= NOW() THEN NULL
                         ELSE plan_expires_at
                     END,
                     updated_at = CASE
                         WHEN plan_expires_at IS NOT NULL AND plan_expires_at <= NOW() THEN NOW()
                         ELSE updated_at
                     END
                 WHERE id = $1
                 RETURNING current_plan, plan_expires_at`,
                [userId]
            );
            return result.rows[0] || { current_plan: 'free', plan_expires_at: null };
        },

        async getAiAgentPromptUsage(userId) {
            const client = await pool.connect();
            try {
                const period = await resolveAiAgentPromptPeriod(client, userId);
                const usageResult = await client.query(
                    `SELECT used_count
                     FROM ai_agent_prompt_usage
                     WHERE user_id = $1 AND plan_id = $2 AND period_start = $3
                     LIMIT 1`,
                    [userId, period.planId, period.periodStart]
                );
                return buildAiAgentPromptUsage(period, Number(usageResult.rows[0]?.used_count || 0));
            } finally {
                client.release();
            }
        },

        async reserveAiAgentPromptUsage(userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const period = await resolveAiAgentPromptPeriod(client, userId, { lockUser: true });
                const usageResult = await client.query(
                    `INSERT INTO ai_agent_prompt_usage (
                        user_id, plan_id, period_start, period_end, used_count
                     ) VALUES ($1, $2, $3, $4, 1)
                     ON CONFLICT (user_id, plan_id, period_start) DO UPDATE
                     SET used_count = ai_agent_prompt_usage.used_count + 1,
                         period_end = EXCLUDED.period_end,
                         updated_at = NOW()
                     WHERE ai_agent_prompt_usage.used_count < $5
                     RETURNING used_count`,
                    [userId, period.planId, period.periodStart, period.periodEnd, period.limit]
                );

                if (!usageResult.rows[0]) {
                    const existingResult = await client.query(
                        `SELECT used_count
                         FROM ai_agent_prompt_usage
                         WHERE user_id = $1 AND plan_id = $2 AND period_start = $3
                         LIMIT 1`,
                        [userId, period.planId, period.periodStart]
                    );
                    await client.query('COMMIT');
                    return {
                        allowed: false,
                        usage: buildAiAgentPromptUsage(period, Number(existingResult.rows[0]?.used_count || period.limit))
                    };
                }

                await client.query('COMMIT');
                return {
                    allowed: true,
                    usage: buildAiAgentPromptUsage(period, Number(usageResult.rows[0].used_count))
                };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async releaseAiAgentPromptUsage({ userId, planId, periodStart }) {
            const client = await pool.connect();
            try {
                await client.query(
                    `UPDATE ai_agent_prompt_usage
                     SET used_count = GREATEST(used_count - 1, 0), updated_at = NOW()
                     WHERE user_id = $1 AND plan_id = $2 AND period_start = $3`,
                    [userId, planId, periodStart]
                );
                const period = await resolveAiAgentPromptPeriod(client, userId);
                const usageResult = await client.query(
                    `SELECT used_count
                     FROM ai_agent_prompt_usage
                     WHERE user_id = $1 AND plan_id = $2 AND period_start = $3
                     LIMIT 1`,
                    [userId, period.planId, period.periodStart]
                );
                return buildAiAgentPromptUsage(period, Number(usageResult.rows[0]?.used_count || 0));
            } finally {
                client.release();
            }
        },

        async createPendingPayment({ userId, provider, planId, providerOrderId, amountMinor, currency }) {
            const result = await pool.query(
                `INSERT INTO payments (
                    user_id, provider, plan_id, provider_order_id, amount_minor, currency, status
                 ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
                 RETURNING id, user_id, provider, plan_id, provider_order_id,
                           provider_payment_id, amount_minor, currency, status,
                           refunded_amount_minor, access_starts_at, access_expires_at`,
                [userId, provider, planId, providerOrderId, amountMinor, currency]
            );
            return result.rows[0];
        },

        async findPaymentByProviderOrder({ userId, provider, providerOrderId }) {
            const result = await pool.query(
                `SELECT id, user_id, provider, plan_id, provider_order_id,
                        provider_payment_id, amount_minor, currency, status,
                        failure_reason, cancelled_at, refunded_at, refunded_amount_minor,
                        access_starts_at, access_expires_at, completed_at
                 FROM payments
                 WHERE user_id = $1 AND provider = $2 AND provider_order_id = $3
                 LIMIT 1`,
                [userId, provider, providerOrderId]
            );
            return result.rows[0] || null;
        },

        async findPaymentByProviderOrderAnyUser({ provider, providerOrderId }) {
            const result = await pool.query(
                `SELECT id, user_id, provider, plan_id, provider_order_id,
                        provider_payment_id, amount_minor, currency, status,
                        failure_reason, cancelled_at, refunded_at, refunded_amount_minor,
                        access_starts_at, access_expires_at, completed_at
                 FROM payments
                 WHERE provider = $1 AND provider_order_id = $2
                 LIMIT 1`,
                [provider, providerOrderId]
            );
            return result.rows[0] || null;
        },

        async findPaymentByProviderPaymentAnyUser({ provider, providerPaymentId }) {
            const result = await pool.query(
                `SELECT id, user_id, provider, plan_id, provider_order_id,
                        provider_payment_id, amount_minor, currency, status,
                        failure_reason, cancelled_at, refunded_at, refunded_amount_minor,
                        access_starts_at, access_expires_at, completed_at
                 FROM payments
                 WHERE provider = $1 AND provider_payment_id = $2
                 LIMIT 1`,
                [provider, providerPaymentId]
            );
            return result.rows[0] || null;
        },

        async markPaymentCancelled({ userId, provider, providerOrderId }) {
            const result = await pool.query(
                `UPDATE payments
                 SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                 WHERE user_id = $1
                   AND provider = $2
                   AND provider_order_id = $3
                   AND status IN ('pending', 'authorized', 'failed')
                 RETURNING id, status`,
                [userId, provider, providerOrderId]
            );
            return result.rows[0] || null;
        },

        async markPaymentStatus({
            userId,
            provider,
            providerOrderId,
            providerPaymentId = null,
            status,
            failureReason = null
        }) {
            const result = await pool.query(
                `UPDATE payments
                 SET status = $4,
                     provider_payment_id = COALESCE($5, provider_payment_id),
                     failure_reason = CASE WHEN $4 = 'failed' THEN $6 ELSE failure_reason END,
                     updated_at = NOW()
                 WHERE user_id = $1
                   AND provider = $2
                   AND provider_order_id = $3
                   AND status NOT IN ('completed', 'partially_refunded', 'refunded')
                 RETURNING id, user_id, provider, plan_id, provider_order_id,
                           provider_payment_id, amount_minor, currency, status`,
                [userId, provider, providerOrderId, status, providerPaymentId, failureReason]
            );
            return result.rows[0] || null;
        },

        async recordPaymentWebhookEvent({
            provider,
            eventId,
            eventType,
            providerOrderId = null,
            providerPaymentId = null,
            status,
            providerCreatedAt = null
        }) {
            const result = await pool.query(
                `INSERT INTO payment_webhook_events (
                    provider, event_id, event_type, provider_order_id, provider_payment_id,
                    status, provider_created_at, processed_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 ON CONFLICT (provider, event_id) DO NOTHING
                 RETURNING id`,
                [
                    provider,
                    eventId,
                    eventType,
                    providerOrderId,
                    providerPaymentId,
                    status,
                    providerCreatedAt
                ]
            );
            return { recorded: Boolean(result.rows[0]), duplicate: !result.rows[0] };
        },

        async recordPaymentStateFromWebhook({
            provider,
            eventId,
            eventType,
            providerOrderId,
            providerPaymentId = null,
            paymentStatus,
            failureReason = null,
            providerCreatedAt = null
        }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const eventResult = await insertWebhookEvent(client, {
                    provider,
                    eventId,
                    eventType,
                    providerOrderId,
                    providerPaymentId,
                    providerCreatedAt
                });
                if (!eventResult) {
                    await client.query('COMMIT');
                    return { handled: true, duplicate: true };
                }

                const paymentResult = await client.query(
                    `UPDATE payments
                     SET status = CASE
                             WHEN status IN ('completed', 'partially_refunded', 'refunded') THEN status
                             ELSE $3
                         END,
                         provider_payment_id = CASE
                             WHEN status IN ('completed', 'partially_refunded', 'refunded') THEN provider_payment_id
                             ELSE COALESCE($4, provider_payment_id)
                         END,
                         failure_reason = CASE WHEN $3 = 'failed' THEN $5 ELSE failure_reason END,
                         updated_at = NOW()
                     WHERE provider = $1 AND provider_order_id = $2
                     RETURNING id`,
                    [provider, providerOrderId, paymentStatus, providerPaymentId, failureReason]
                );
                await client.query(
                    `UPDATE payment_webhook_events
                     SET status = $2, processed_at = NOW()
                     WHERE id = $1`,
                    [eventResult.id, paymentStatus === 'failed' ? 'payment_failed' : 'processed']
                );
                await client.query('COMMIT');
                return { handled: Boolean(paymentResult.rows[0]), duplicate: false };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async completePaymentFromWebhook({
            eventId,
            eventType,
            providerCreatedAt = null,
            userId,
            provider,
            planId,
            providerOrderId,
            providerPaymentId,
            amountMinor,
            currency
        }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const eventResult = await insertWebhookEvent(client, {
                    provider,
                    eventId,
                    eventType,
                    providerOrderId,
                    providerPaymentId,
                    providerCreatedAt
                });
                if (!eventResult) {
                    const billing = await getBillingProfileWithClient(client, userId);
                    await client.query('COMMIT');
                    return { completed: true, duplicate: true, billing };
                }

                const completed = await completePaymentTransaction(client, {
                    userId,
                    provider,
                    planId,
                    providerOrderId,
                    providerPaymentId,
                    amountMinor,
                    currency
                });
                await client.query(
                    `UPDATE payment_webhook_events
                     SET status = 'processed', processed_at = NOW()
                     WHERE id = $1`,
                    [eventResult.id]
                );
                await client.query('COMMIT');
                return { ...completed, duplicate: false };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async completePayment(input) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const completed = await completePaymentTransaction(client, input);
                await client.query('COMMIT');
                return completed;
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async processPaymentRefundFromWebhook({
            eventId,
            eventType,
            providerCreatedAt = null,
            provider,
            providerOrderId,
            providerPaymentId,
            providerRefundId,
            refundAmountMinor,
            paymentAmountMinor,
            currency
        }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const eventResult = await insertWebhookEvent(client, {
                    provider,
                    eventId,
                    eventType,
                    providerOrderId,
                    providerPaymentId,
                    providerCreatedAt
                });
                if (!eventResult) {
                    await client.query('COMMIT');
                    return { handled: true, duplicate: true };
                }

                const paymentResult = await client.query(
                    `SELECT id, user_id, plan_id, provider_order_id, provider_payment_id,
                            amount_minor, currency, status, access_expires_at
                     FROM payments
                     WHERE provider = $1 AND provider_payment_id = $2
                     FOR UPDATE`,
                    [provider, providerPaymentId]
                );
                const payment = paymentResult.rows[0];
                if (!payment) {
                    await client.query(
                        `UPDATE payment_webhook_events
                         SET status = 'ignored', processed_at = NOW()
                         WHERE id = $1`,
                        [eventResult.id]
                    );
                    await client.query('COMMIT');
                    return { handled: false, duplicate: false };
                }
                if (payment.provider_order_id !== providerOrderId
                    || Number(payment.amount_minor) !== paymentAmountMinor
                    || payment.currency !== currency
                    || refundAmountMinor <= 0
                    || refundAmountMinor > paymentAmountMinor) {
                    const error = new Error('Refund details do not match the stored payment.');
                    error.code = 'PAYMENT_REFUND_MISMATCH';
                    throw error;
                }

                await client.query(
                    `INSERT INTO payment_refunds (
                        payment_id, provider, provider_refund_id, amount_minor, currency,
                        status, provider_created_at, processed_at
                     ) VALUES ($1, $2, $3, $4, $5, 'processed', $6, NOW())
                     ON CONFLICT (provider, provider_refund_id) DO UPDATE
                     SET status = 'processed',
                         amount_minor = EXCLUDED.amount_minor,
                         currency = EXCLUDED.currency,
                         provider_created_at = COALESCE(EXCLUDED.provider_created_at, payment_refunds.provider_created_at),
                         processed_at = NOW(),
                         updated_at = NOW()`,
                    [
                        payment.id,
                        provider,
                        providerRefundId,
                        refundAmountMinor,
                        currency,
                        providerCreatedAt
                    ]
                );
                const refundTotalResult = await client.query(
                    `SELECT COALESCE(SUM(amount_minor), 0)::BIGINT AS refunded_amount_minor
                     FROM payment_refunds
                     WHERE payment_id = $1 AND status = 'processed'`,
                    [payment.id]
                );
                const refundedAmountMinor = Number(refundTotalResult.rows[0].refunded_amount_minor);
                const fullyRefunded = refundedAmountMinor >= Number(payment.amount_minor);
                await client.query(
                    `UPDATE payments
                     SET status = $2,
                         refunded_amount_minor = LEAST($3, amount_minor),
                         refunded_at = CASE WHEN $2 = 'refunded' THEN NOW() ELSE refunded_at END,
                         updated_at = NOW()
                     WHERE id = $1`,
                    [payment.id, fullyRefunded ? 'refunded' : 'partially_refunded', refundedAmountMinor]
                );

                let billing = await getBillingProfileWithClient(client, payment.user_id);
                const currentExpiry = billing.plan_expires_at ? new Date(billing.plan_expires_at).getTime() : null;
                const refundedExpiry = payment.access_expires_at ? new Date(payment.access_expires_at).getTime() : null;
                if (fullyRefunded
                    && billing.current_plan === payment.plan_id
                    && (refundedExpiry === null || currentExpiry === refundedExpiry)) {
                    const fallbackResult = await client.query(
                        `SELECT plan_id, access_expires_at
                         FROM payments
                         WHERE user_id = $1
                           AND id <> $2
                           AND status IN ('completed', 'partially_refunded')
                           AND refunded_amount_minor < amount_minor
                           AND access_starts_at <= NOW()
                           AND access_expires_at > NOW()
                         ORDER BY access_expires_at DESC, completed_at DESC, id DESC
                         LIMIT 1`,
                        [payment.user_id, payment.id]
                    );
                    const fallback = fallbackResult.rows[0];
                    const userResult = await client.query(
                        `UPDATE users
                         SET current_plan = $2,
                             plan_expires_at = $3,
                             updated_at = NOW()
                         WHERE id = $1
                         RETURNING current_plan, plan_expires_at`,
                        [
                            payment.user_id,
                            fallback?.plan_id || 'free',
                            fallback?.access_expires_at || null
                        ]
                    );
                    billing = userResult.rows[0];
                }

                await client.query(
                    `UPDATE payment_webhook_events
                     SET status = 'processed', processed_at = NOW()
                     WHERE id = $1`,
                    [eventResult.id]
                );
                await client.query('COMMIT');
                return {
                    handled: true,
                    duplicate: false,
                    fullyRefunded,
                    refundedAmountMinor,
                    billing
                };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async listChatConversations(userId, limit = 40) {
            const result = await pool.query(
                `SELECT conversations.id,
                        conversations.title,
                        conversations.created_at,
                        conversations.updated_at,
                        COUNT(messages.id)::INTEGER AS message_count,
                        COALESCE((
                            SELECT latest.content
                            FROM chat_messages latest
                            WHERE latest.conversation_id = conversations.id
                            ORDER BY latest.created_at DESC, latest.id DESC
                            LIMIT 1
                        ), '') AS last_message
                 FROM chat_conversations conversations
                 LEFT JOIN chat_messages messages ON messages.conversation_id = conversations.id
                 WHERE conversations.user_id = $1
                 GROUP BY conversations.id
                 ORDER BY conversations.updated_at DESC, conversations.id DESC
                 LIMIT $2`,
                [userId, limit]
            );
            return result.rows;
        },

        async createChatConversation({ userId, title = 'New chat' }) {
            const result = await pool.query(
                `INSERT INTO chat_conversations (user_id, title)
                 VALUES ($1, $2)
                 RETURNING id, title, created_at, updated_at`,
                [userId, title]
            );
            return result.rows[0];
        },

        async branchChatConversation({ userId, conversationId, throughMessageId }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const sourceResult = await client.query(
                    `SELECT conversations.id,
                            conversations.title,
                            messages.id AS through_message_id,
                            messages.content AS last_message
                     FROM chat_conversations conversations
                     INNER JOIN chat_messages messages
                         ON messages.conversation_id = conversations.id
                     WHERE conversations.id = $1
                       AND conversations.user_id = $2
                       AND messages.id = $3
                       AND messages.role = 'assistant'
                     FOR UPDATE OF conversations`,
                    [conversationId, userId, throughMessageId]
                );
                const source = sourceResult.rows[0];
                if (!source) {
                    await client.query('ROLLBACK');
                    return null;
                }

                const branchResult = await client.query(
                    `INSERT INTO chat_conversations (user_id, title)
                     VALUES ($1, $2)
                     RETURNING id, title, created_at, updated_at`,
                    [userId, createBranchTitle(source.title)]
                );
                const branch = branchResult.rows[0];
                const copiedResult = await client.query(
                    `INSERT INTO chat_messages (conversation_id, role, content, created_at)
                     SELECT $1, source_messages.role, source_messages.content, source_messages.created_at
                     FROM chat_messages source_messages
                     WHERE source_messages.conversation_id = $2
                       AND source_messages.id <= $3
                     ORDER BY source_messages.created_at ASC, source_messages.id ASC
                     RETURNING id`,
                    [branch.id, conversationId, throughMessageId]
                );

                const updatedResult = await client.query(
                    `UPDATE chat_conversations
                     SET updated_at = NOW()
                     WHERE id = $1
                     RETURNING id, title, created_at, updated_at`,
                    [branch.id]
                );
                await client.query('COMMIT');
                return {
                    ...updatedResult.rows[0],
                    message_count: copiedResult.rowCount,
                    last_message: source.last_message
                };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async getChatMessages({ userId, conversationId }) {
            const conversationResult = await pool.query(
                `SELECT id, title, created_at, updated_at
                 FROM chat_conversations
                 WHERE id = $1 AND user_id = $2
                 LIMIT 1`,
                [conversationId, userId]
            );
            const conversation = conversationResult.rows[0];
            if (!conversation) return null;

            const messageResult = await pool.query(
                `SELECT id, role, content, created_at
                 FROM chat_messages
                 WHERE conversation_id = $1
                 ORDER BY created_at ASC, id ASC`,
                [conversationId]
            );
            return { conversation, messages: messageResult.rows };
        },

        async getChatContext({ userId, conversationId, throughMessageId, limit = 40 }) {
            const result = await pool.query(
                `SELECT recent.id, recent.role, recent.content, recent.created_at
                 FROM (
                     SELECT messages.id, messages.role, messages.content, messages.created_at
                     FROM chat_messages messages
                     INNER JOIN chat_conversations conversations
                         ON conversations.id = messages.conversation_id
                     WHERE messages.conversation_id = $1
                       AND conversations.user_id = $2
                       AND messages.id <= $3
                     ORDER BY messages.created_at DESC, messages.id DESC
                     LIMIT $4
                 ) recent
                 ORDER BY recent.created_at ASC, recent.id ASC`,
                [conversationId, userId, throughMessageId, limit]
            );
            return result.rows;
        },

        async addChatCommand({ userId, conversationId, content, generatedTitle }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const conversationResult = await client.query(
                    `SELECT id, title
                     FROM chat_conversations
                     WHERE id = $1 AND user_id = $2
                     FOR UPDATE`,
                    [conversationId, userId]
                );
                const conversation = conversationResult.rows[0];
                if (!conversation) {
                    const error = new Error('Chat conversation was not found.');
                    error.code = 'CHAT_NOT_FOUND';
                    throw error;
                }

                const messageResult = await client.query(
                    `INSERT INTO chat_messages (conversation_id, role, content)
                     VALUES ($1, 'user', $2)
                     RETURNING id, role, content, created_at`,
                    [conversationId, content]
                );

                const nextTitle = conversation.title === 'New chat' ? generatedTitle : conversation.title;
                const updatedConversationResult = await client.query(
                    `UPDATE chat_conversations
                     SET title = $2, updated_at = NOW()
                     WHERE id = $1
                     RETURNING id, title, created_at, updated_at`,
                    [conversationId, nextTitle]
                );

                await client.query('COMMIT');
                return {
                    conversation: updatedConversationResult.rows[0],
                    message: messageResult.rows[0]
                };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async addChatAssistantResponse({ userId, conversationId, content }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const conversationResult = await client.query(
                    `SELECT id, title
                     FROM chat_conversations
                     WHERE id = $1 AND user_id = $2
                     FOR UPDATE`,
                    [conversationId, userId]
                );
                if (!conversationResult.rows[0]) {
                    const error = new Error('Chat conversation was not found.');
                    error.code = 'CHAT_NOT_FOUND';
                    throw error;
                }

                const messageResult = await client.query(
                    `INSERT INTO chat_messages (conversation_id, role, content)
                     VALUES ($1, 'assistant', $2)
                     RETURNING id, role, content, created_at`,
                    [conversationId, content]
                );
                const updatedConversationResult = await client.query(
                    `UPDATE chat_conversations
                     SET updated_at = NOW()
                     WHERE id = $1
                     RETURNING id, title, created_at, updated_at`,
                    [conversationId]
                );

                await client.query('COMMIT');
                return {
                    conversation: updatedConversationResult.rows[0],
                    message: messageResult.rows[0]
                };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async renameChatConversation({ userId, conversationId, title }) {
            const result = await pool.query(
                `UPDATE chat_conversations
                 SET title = $3, updated_at = NOW()
                 WHERE id = $1 AND user_id = $2
                 RETURNING id, title, created_at, updated_at`,
                [conversationId, userId, title]
            );
            return result.rows[0] || null;
        },

        async deleteChatConversation({ userId, conversationId }) {
            const result = await pool.query(
                `DELETE FROM chat_conversations
                 WHERE id = $1 AND user_id = $2
                 RETURNING id`,
                [conversationId, userId]
            );
            return Boolean(result.rows[0]);
        },

        async getOrCreateBusinessForUser(userId) {
            return getOrCreateBusinessForUser(pool, userId);
        },

        async getBusinessForUser({ userId, businessId }) {
            return assertBusinessAccess(pool, userId, businessId);
        },

        async createWorkflowRun(input) {
            return createWorkflowRun(pool, input);
        },

        async updateWorkflowRun(input) {
            return updateWorkflowRun(pool, input);
        },

        async updateWorkflowStep(input) {
            return updateWorkflowStep(pool, input);
        },

        async getWorkflowRun({ userId, runId }) {
            return getWorkflowRun(pool, { userId, runId });
        },

        async listWorkflowRuns({ userId, workflowSlug = null, limit = 20 }) {
            return listWorkflowRuns(pool, { userId, workflowSlug, limit });
        },

        async getWeeklyMarketingData(input) {
            return getWeeklyMarketingData(pool, input);
        },

        async getWeeklyMarketingContext(input) {
            return getWeeklyMarketingContext(pool, input);
        },

        async updateWorkflowProgress(input) {
            return updateWorkflowProgress(pool, input);
        },

        async appendWorkflowLog(input) {
            return appendWorkflowLog(pool, input);
        },

        async saveWorkflowSourceSnapshots(input) {
            return saveWorkflowSourceSnapshots(pool, input);
        },

        async getWorkflowSourceSnapshots(input) {
            return getWorkflowSourceSnapshots(pool, input);
        },

        async saveWorkflowArtifact(input) {
            return saveWorkflowArtifact(pool, input);
        },

        async listWorkflowArtifacts(input) {
            return listWorkflowArtifacts(pool, input);
        },

        async getWorkflowArtifact(input) {
            return getWorkflowArtifact(pool, input);
        },

        async replaceWorkflowRunOutput(input) {
            return replaceWorkflowRunOutput(pool, input);
        },

        async getCompetitorAuditData(input) {
            return getCompetitorAuditData(pool, input);
        },

        async getReviewResponderData(input) {
            return getReviewResponderData(pool, input);
        },

        async saveReviewDrafts(input) {
            return saveReviewDrafts(pool, input);
        },

        async updateReviewResponse(input) {
            return updateReviewResponse(pool, input);
        },

        async getInventoryData(input) {
            return getInventoryData(pool, input);
        },

        async getBusinessOverview(input) {
            return getBusinessOverview(pool, input);
        },

        async getMarketingWorkspaceData(input) {
            return getMarketingWorkspaceData(pool, input);
        },

        async getEnterpriseAnalyticsData(input) {
            return getEnterpriseAnalyticsData(pool, input);
        },

        async getAnalyticsDatasetState(input) {
            return getAnalyticsDatasetState(pool, input);
        },

        async deleteAnalyticsDemoData(input) {
            return deleteAnalyticsDemoData(pool, input);
        },

        async saveMarketingCampaignAssets(input) {
            return saveMarketingCampaignAssets(pool, input);
        },

        async saveWorkflowAiExecution(input) {
            return saveWorkflowAiExecution(pool, input);
        },

        async saveCompetitorLiveSnapshots(input) {
            return saveCompetitorLiveSnapshots(pool, input);
        },

        async listMarketingCampaignAssets(input) {
            return listMarketingCampaignAssets(pool, input);
        },

        async getMarketingWorkspaceCache(input) {
            return getMarketingWorkspaceCache(pool, input);
        },

        async saveMarketingWorkspaceCache(input) {
            return saveMarketingWorkspaceCache(pool, input);
        },

        async listScheduledWorkflows(input) {
            return listScheduledWorkflows(pool, input);
        },

        async upsertScheduledWorkflow(input) {
            return upsertScheduledWorkflow(pool, input);
        },

        async deleteScheduledWorkflow(input) {
            return deleteScheduledWorkflow(pool, input);
        },

        async claimDueScheduledWorkflows(input) {
            return claimDueScheduledWorkflows(pool, input);
        },

        async completeScheduledWorkflow(input) {
            return completeScheduledWorkflow(pool, input);
        },

        async importBusinessData(input) {
            return importBusinessData(pool, input);
        },

        async createOrFindOAuthUser({ provider, providerUserId, email, preferredUsername }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Serialize callbacks for the same provider identity and verified email.
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`oauth:${provider}:${providerUserId}`]);
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`email:${email.toLowerCase()}`]);

                const existingIdentity = await findOAuthIdentity(client, provider, providerUserId);
                if (existingIdentity) {
                    await client.query('COMMIT');
                    return existingIdentity;
                }

                let user = await findUserByEmailWithClient(client, email);
                if (!user) {
                    user = await createOAuthUserWithUniqueUsername(client, {
                        email,
                        preferredUsername
                    });
                }

                const providerAlreadyLinked = await client.query(
                    `SELECT provider_user_id
                     FROM oauth_accounts
                     WHERE user_id = $1 AND provider = $2
                     LIMIT 1`,
                    [user.id, provider]
                );

                if (providerAlreadyLinked.rows[0]
                    && providerAlreadyLinked.rows[0].provider_user_id !== providerUserId) {
                    const error = new Error(`A different ${provider} identity is already linked to this user.`);
                    error.code = 'OAUTH_ACCOUNT_CONFLICT';
                    throw error;
                }

                await client.query(
                    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
                    [user.id, provider, providerUserId]
                );

                const linkedIdentity = await findOAuthIdentity(client, provider, providerUserId);
                if (!linkedIdentity) {
                    throw new Error('OAuth identity could not be linked.');
                }

                await client.query('COMMIT');
                return linkedIdentity;
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async close() {
            await pool.end();
        }
    };
}

const VALID_BUSINESS_ORDER_STATUSES_SQL = "'paid', 'completed', 'fulfilled'";
const NET_ITEM_REVENUE_SQL = `(CASE WHEN orders.total_amount_minor > 0 THEN ROUND(items.total_amount_minor::NUMERIC * GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)::NUMERIC / orders.total_amount_minor::NUMERIC)::BIGINT ELSE 0::BIGINT END)`;

async function getOrCreateBusinessForUser(pool, userId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business-user:${userId}`]);
        const existingResult = await client.query(
            `SELECT businesses.id, businesses.name, businesses.currency, businesses.timezone,
                    memberships.role
             FROM business_memberships memberships
             INNER JOIN businesses ON businesses.id = memberships.business_id
             WHERE memberships.user_id = $1
             ORDER BY CASE memberships.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                      memberships.created_at ASC, businesses.id ASC
             LIMIT 1`,
            [userId]
        );
        if (existingResult.rows[0]) {
            await client.query('COMMIT');
            return existingResult.rows[0];
        }

        const userResult = await client.query(
            'SELECT username FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        const user = userResult.rows[0];
        if (!user) {
            const error = new Error('Authenticated user was not found.');
            error.code = 'USER_NOT_FOUND';
            throw error;
        }
        const businessResult = await client.query(
            `INSERT INTO businesses (name, currency, timezone)
             VALUES ($1, 'USD', 'UTC')
             RETURNING id, name, currency, timezone`,
            [`${String(user.username || 'My').slice(0, 130)} Business`]
        );
        const business = businessResult.rows[0];
        await client.query(
            `INSERT INTO business_memberships (business_id, user_id, role)
             VALUES ($1, $2, 'owner')`,
            [business.id, userId]
        );
        await client.query('COMMIT');
        return { ...business, role: 'owner' };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function assertBusinessAccess(client, userId, businessId) {
    const result = await client.query(
        `SELECT businesses.*,
                memberships.role
         FROM business_memberships memberships
         INNER JOIN businesses ON businesses.id = memberships.business_id
         WHERE memberships.user_id = $1 AND businesses.id = $2
         LIMIT 1`,
        [userId, businessId]
    );
    if (!result.rows[0]) {
        const error = new Error('Business account was not found or access was denied.');
        error.code = 'BUSINESS_ACCESS_DENIED';
        error.statusCode = 403;
        error.publicMessage = 'You do not have access to that business account.';
        throw error;
    }
    return result.rows[0];
}

async function createWorkflowRun(pool, { userId, businessId, workflow, input = {} }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await assertBusinessAccess(client, userId, businessId);
        await client.query(
            `UPDATE workflow_runs
             SET status = 'failed',
                 error_message = 'Execution expired before completion.',
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE business_id = $1
               AND workflow_slug = $2
               AND status IN ('queued', 'running')
               AND updated_at < NOW() - INTERVAL '30 minutes'`,
            [businessId, workflow.slug]
        );
        const runResult = await client.query(
            `INSERT INTO workflow_runs (
                user_id, business_id, workflow_slug, workflow_name, status, input
             ) VALUES ($1, $2, $3, $4, 'queued', $5::JSONB)
             RETURNING *`,
            [userId, businessId, workflow.slug, workflow.name, JSON.stringify(input || {})]
        );
        const run = runResult.rows[0];
        const steps = [];
        for (let index = 0; index < workflow.steps.length; index += 1) {
            const step = workflow.steps[index];
            const stepResult = await client.query(
                `INSERT INTO workflow_step_runs (run_id, step_key, step_title, step_order, status)
                 VALUES ($1, $2, $3, $4, 'queued')
                 RETURNING *`,
                [run.id, step.key, step.title, index]
            );
            steps.push(stepResult.rows[0]);
        }
        await client.query('COMMIT');
        return { ...run, steps };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505' && error.constraint === 'workflow_runs_one_active_per_business') {
            const conflict = new Error('This workflow is already running for the selected business.');
            conflict.code = 'WORKFLOW_ALREADY_RUNNING';
            conflict.statusCode = 409;
            conflict.publicMessage = 'This workflow is already running. Wait for it to finish before starting another run.';
            throw conflict;
        }
        throw error;
    } finally {
        client.release();
    }
}

async function updateWorkflowRun(pool, {
    runId,
    status,
    output = null,
    errorMessage = null,
    businessId = null,
    periodStart = null,
    periodEnd = null,
    dataRetrievedAt = null,
    recordsAnalyzed = 0,
    durationMs = null,
    progressPercentage = null,
    currentStep = null,
    estimatedCompletionAt = null
}) {
    const result = await pool.query(
        `UPDATE workflow_runs
         SET status = $2,
             output = $3::JSONB,
             error_message = $4,
             business_id = COALESCE($5, business_id),
             data_period_start = $6,
             data_period_end = $7,
             data_retrieved_at = $8,
             records_analyzed = $9,
             duration_ms = $10,
             progress_percentage = COALESCE($11, progress_percentage),
             current_step = COALESCE($12, current_step),
             estimated_completion_at = $13,
             started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
             completed_at = CASE WHEN $2 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
            runId,
            status,
            output === null ? null : JSON.stringify(output),
            errorMessage,
            businessId,
            periodStart,
            periodEnd,
            dataRetrievedAt,
            Number.isSafeInteger(recordsAnalyzed) && recordsAnalyzed >= 0 ? recordsAnalyzed : 0,
            Number.isSafeInteger(durationMs) && durationMs >= 0 ? durationMs : null,
            Number.isInteger(progressPercentage) ? Math.max(0, Math.min(100, progressPercentage)) : null,
            currentStep,
            estimatedCompletionAt
        ]
    );
    return result.rows[0] || null;
}

async function updateWorkflowStep(pool, { runId, stepKey, status, input = null, output = null, errorMessage = null }) {
    const result = await pool.query(
        `UPDATE workflow_step_runs
         SET status = $3,
             input = $4::JSONB,
             output = $5::JSONB,
             error_message = $6,
             started_at = CASE WHEN $3 = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
             completed_at = CASE WHEN $3 IN ('completed', 'failed', 'skipped') THEN NOW() ELSE completed_at END
         WHERE run_id = $1 AND step_key = $2
         RETURNING *`,
        [
            runId,
            stepKey,
            status,
            input === null ? null : JSON.stringify(input),
            output === null ? null : JSON.stringify(output),
            errorMessage
        ]
    );
    return result.rows[0] || null;
}

async function getWorkflowRun(pool, { userId, runId }) {
    const runResult = await pool.query(
        `SELECT runs.*
         FROM workflow_runs runs
         WHERE runs.id = $1 AND runs.user_id = $2
         LIMIT 1`,
        [runId, userId]
    );
    const run = runResult.rows[0];
    if (!run) return null;
    const stepsResult = await pool.query(
        `SELECT * FROM workflow_step_runs
         WHERE run_id = $1
         ORDER BY step_order ASC, id ASC`,
        [runId]
    );
    const [logsResult, artifactsResult] = await Promise.all([
        pool.query(`SELECT id, level, step_key, message, metadata, created_at FROM workflow_run_logs WHERE run_id = $1 ORDER BY created_at ASC, id ASC`, [runId]),
        pool.query(`SELECT id, run_id, section_key, artifact_type, title, filename, mime_type, metadata, sha256, size_bytes, created_at, updated_at FROM workflow_artifacts WHERE run_id = $1 ORDER BY created_at ASC, id ASC`, [runId])
    ]);
    return { ...run, steps: stepsResult.rows, logs: logsResult.rows, artifacts: artifactsResult.rows };
}

async function listWorkflowRuns(pool, { userId, workflowSlug = null, limit = 20 }) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const result = await pool.query(
        `SELECT id, business_id, workflow_slug, workflow_name, status, output, error_message,
                data_period_start, data_period_end, data_retrieved_at, records_analyzed,
                duration_ms, progress_percentage, current_step, estimated_completion_at,
                created_at, started_at, completed_at, updated_at
         FROM workflow_runs
         WHERE user_id = $1
           AND ($2::TEXT IS NULL OR workflow_slug = $2)
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [userId, workflowSlug, safeLimit]
    );
    return result.rows;
}

async function getWeeklyMarketingContext(pool, { userId, businessId }) {
    const client = await pool.connect();
    try {
        const business = await assertBusinessAccess(client, userId, businessId);
        const [competitorsResult, reviewsResult] = await runClientQueriesSequentially([
            () => client.query(
                `SELECT id, name, source_url, active, metadata
                 FROM business_competitors
                 WHERE business_id = $1 AND active = TRUE
                 ORDER BY name ASC, id ASC
                 LIMIT 20`,
                [businessId]
            ),
            () => client.query(
                `SELECT provider, rating, review_text, published_at, source_url, review_status
                 FROM business_reviews
                 WHERE business_id = $1
                 ORDER BY published_at DESC NULLS LAST, id DESC
                 LIMIT 50`,
                [businessId]
            )
        ]);
        return { business, competitors: competitorsResult.rows, reviews: reviewsResult.rows, retrievedAt: new Date().toISOString() };
    } finally {
        client.release();
    }
}

async function updateWorkflowProgress(pool, { runId, percentage, currentStep = null, estimatedCompletionAt = null }) {
    const safePercentage = Math.max(0, Math.min(100, Number.parseInt(percentage, 10) || 0));
    const result = await pool.query(
        `UPDATE workflow_runs
         SET progress_percentage = $2, current_step = $3, estimated_completion_at = $4, updated_at = NOW()
         WHERE id = $1
         RETURNING progress_percentage, current_step, estimated_completion_at`,
        [runId, safePercentage, currentStep, estimatedCompletionAt]
    );
    return result.rows[0] || null;
}

async function appendWorkflowLog(pool, { runId, level = 'info', stepKey = null, message, metadata = {} }) {
    const safeLevel = ['debug', 'info', 'warning', 'error'].includes(level) ? level : 'info';
    const safeMessage = String(message || '').trim().slice(0, 4000);
    if (!safeMessage) return null;
    const result = await pool.query(
        `INSERT INTO workflow_run_logs (run_id, level, step_key, message, metadata)
         VALUES ($1, $2, $3, $4, $5::JSONB)
         RETURNING id, level, step_key, message, metadata, created_at`,
        [runId, safeLevel, stepKey, safeMessage, JSON.stringify(metadata || {})]
    );
    return result.rows[0] || null;
}

async function saveWorkflowSourceSnapshots(pool, { runId, snapshots }) {
    const rows = [];
    for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        const result = await pool.query(
            `INSERT INTO workflow_source_snapshots (
                run_id, source_type, provider, status, source_url, payload, error_message, retrieved_at
             ) VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7, $8)
             ON CONFLICT (run_id, source_type) DO UPDATE SET
                provider = EXCLUDED.provider, status = EXCLUDED.status, source_url = EXCLUDED.source_url,
                payload = EXCLUDED.payload, error_message = EXCLUDED.error_message, retrieved_at = EXCLUDED.retrieved_at
             RETURNING id, source_type, provider, status, source_url, error_message, retrieved_at`,
            [runId, snapshot.sourceType, snapshot.provider || null, snapshot.status, snapshot.sourceUrl || null,
                snapshot.payload === undefined ? null : JSON.stringify(snapshot.payload), snapshot.errorMessage || null,
                snapshot.retrievedAt || new Date().toISOString()]
        );
        rows.push(result.rows[0]);
    }
    return rows;
}

async function getWorkflowSourceSnapshots(pool, { userId, runId }) {
    const result = await pool.query(
        `SELECT snapshots.*
         FROM workflow_source_snapshots snapshots
         INNER JOIN workflow_runs runs ON runs.id = snapshots.run_id
         WHERE snapshots.run_id = $1 AND runs.user_id = $2
         ORDER BY snapshots.retrieved_at ASC, snapshots.id ASC`,
        [runId, userId]
    );
    return result.rows;
}

async function saveWorkflowArtifact(pool, { runId, sectionKey, artifactType, title, filename = null, mimeType, contentText = null, binary = null, metadata = {} }) {
    const binaryBuffer = binary === null || binary === undefined ? null : Buffer.from(binary);
    const text = contentText === null || contentText === undefined ? null : String(contentText);
    if (!binaryBuffer && text === null) throw new TypeError('Artifact content is required.');
    if (binaryBuffer && binaryBuffer.length > 25 * 1024 * 1024) throw new Error('Workflow artifact exceeds the 25 MB storage limit.');
    if (text && Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Workflow text artifact exceeds the 2 MB storage limit.');
    const content = binaryBuffer || Buffer.from(text || '', 'utf8');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const result = await pool.query(
        `INSERT INTO workflow_artifacts (
            run_id, section_key, artifact_type, title, filename, mime_type,
            content_text, binary_data, metadata, sha256, size_bytes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB, $10, $11)
         RETURNING id, run_id, section_key, artifact_type, title, filename, mime_type, metadata, sha256, size_bytes, created_at, updated_at`,
        [runId, sectionKey, artifactType, title, filename, mimeType, text, binaryBuffer, JSON.stringify(metadata || {}), sha256, content.length]
    );
    return result.rows[0];
}

async function listWorkflowArtifacts(pool, { userId, runId }) {
    const result = await pool.query(
        `SELECT artifacts.id, artifacts.run_id, artifacts.section_key, artifacts.artifact_type,
                artifacts.title, artifacts.filename, artifacts.mime_type, artifacts.metadata,
                artifacts.sha256, artifacts.size_bytes, artifacts.created_at, artifacts.updated_at
         FROM workflow_artifacts artifacts
         INNER JOIN workflow_runs runs ON runs.id = artifacts.run_id
         WHERE artifacts.run_id = $1 AND runs.user_id = $2
         ORDER BY artifacts.created_at ASC, artifacts.id ASC`,
        [runId, userId]
    );
    return result.rows;
}

async function getWorkflowArtifact(pool, { userId, artifactId }) {
    const result = await pool.query(
        `SELECT artifacts.*
         FROM workflow_artifacts artifacts
         INNER JOIN workflow_runs runs ON runs.id = artifacts.run_id
         WHERE artifacts.id = $1 AND runs.user_id = $2
         LIMIT 1`,
        [artifactId, userId]
    );
    return result.rows[0] || null;
}

async function replaceWorkflowRunOutput(pool, { userId, runId, output }) {
    const result = await pool.query(
        `UPDATE workflow_runs SET output = $3::JSONB, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [runId, userId, JSON.stringify(output || {})]
    );
    return result.rows[0] || null;
}

async function getWeeklyMarketingData(pool, { userId, businessId, current, previous }) {
    const client = await pool.connect();
    try {
        const business = await assertBusinessAccess(client, userId, businessId);
        const metricsResult = await client.query(
            `WITH scoped AS (
                SELECT orders.*,
                       GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0) AS net_amount_minor
                FROM business_orders orders
                WHERE orders.business_id = $1
                  AND orders.currency = $2
                  AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                  AND orders.total_amount_minor >= 0
                  AND orders.refunded_amount_minor >= 0
                  AND orders.refunded_amount_minor <= orders.total_amount_minor
                  AND orders.ordered_at >= $3
                  AND orders.ordered_at < $4
             )
             SELECT COUNT(*)::INTEGER AS total_orders,
                    COALESCE(SUM(net_amount_minor), 0)::BIGINT AS total_revenue_minor,
                    COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL)::INTEGER AS unique_customers,
                    MIN(ordered_at) AS first_record_at,
                    MAX(ordered_at) AS last_record_at
             FROM scoped`,
            [businessId, business.currency, current.from, current.to]
        );
        const previousMetricsResult = await client.query(
            `WITH scoped AS (
                SELECT GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0) AS net_amount_minor,
                       orders.customer_id
                FROM business_orders orders
                WHERE orders.business_id = $1
                  AND orders.currency = $2
                  AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                  AND orders.total_amount_minor >= 0
                  AND orders.refunded_amount_minor >= 0
                  AND orders.refunded_amount_minor <= orders.total_amount_minor
                  AND orders.ordered_at >= $3
                  AND orders.ordered_at < $4
             )
             SELECT COUNT(*)::INTEGER AS total_orders,
                    COALESCE(SUM(net_amount_minor), 0)::BIGINT AS total_revenue_minor,
                    COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL)::INTEGER AS unique_customers
             FROM scoped`,
            [businessId, business.currency, previous.from, previous.to]
        );
        const topProductsResult = await client.query(
            `SELECT products.id AS product_id,
                    products.name AS product_name,
                    products.sku,
                    SUM(items.quantity)::NUMERIC AS units_sold,
                    COALESCE(SUM(${NET_ITEM_REVENUE_SQL}) FILTER (WHERE orders.id IS NOT NULL), 0)::BIGINT AS revenue_minor,
                    COUNT(DISTINCT orders.id)::INTEGER AS order_count
             FROM business_order_items items
             INNER JOIN business_orders orders ON orders.id = items.order_id
             INNER JOIN business_products products ON products.id = items.product_id
             WHERE orders.business_id = $1
               AND orders.currency = $2
               AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
               AND orders.ordered_at >= $3
               AND orders.ordered_at < $4
               AND items.quantity > 0
             GROUP BY products.id, products.name, products.sku
             ORDER BY revenue_minor DESC, units_sold DESC, products.id ASC
             LIMIT 10`,
            [businessId, business.currency, current.from, current.to]
        );
        const dailyResult = await client.query(
            `SELECT DATE_TRUNC('day', orders.ordered_at AT TIME ZONE 'UTC')::DATE AS day,
                    COUNT(*)::INTEGER AS orders,
                    COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor
             FROM business_orders orders
             WHERE orders.business_id = $1
               AND orders.currency = $2
               AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
               AND orders.ordered_at >= $3
               AND orders.ordered_at < $4
             GROUP BY day
             ORDER BY day ASC`,
            [businessId, business.currency, current.from, current.to]
        );
        const customerTrendResult = await client.query(
            `SELECT
                COUNT(*) FILTER (WHERE customers.first_seen_at >= $2 AND customers.first_seen_at < $3)::INTEGER AS new_customers,
                COUNT(*) FILTER (WHERE customers.last_activity_at >= $2 AND customers.last_activity_at < $3)::INTEGER AS active_customers,
                COUNT(*) FILTER (WHERE customers.first_seen_at >= $4 AND customers.first_seen_at < $2)::INTEGER AS previous_new_customers
             FROM business_customers customers
             WHERE customers.business_id = $1`,
            [businessId, current.from, current.to, previous.from]
        );
        const campaignResult = await client.query(
            `SELECT COUNT(*)::INTEGER AS records,
                    COALESCE(SUM(spend_minor), 0)::BIGINT AS spend_minor,
                    COALESCE(SUM(attributed_revenue_minor), 0)::BIGINT AS attributed_revenue_minor,
                    COALESCE(SUM(impressions), 0)::BIGINT AS impressions,
                    COALESCE(SUM(clicks), 0)::BIGINT AS clicks,
                    COALESCE(SUM(visitors), 0)::BIGINT AS visitors,
                    COALESCE(SUM(leads), 0)::BIGINT AS leads,
                    COALESCE(SUM(conversions), 0)::BIGINT AS conversions,
                    MAX(retrieved_at) AS retrieved_at
             FROM business_campaign_daily_metrics
             WHERE business_id = $1
               AND currency = $2
               AND metric_date >= $3::DATE
               AND metric_date < $4::DATE`,
            [businessId, business.currency, current.from, current.to]
        );
        const recordCountResult = await client.query(
            `SELECT
                (SELECT COUNT(*) FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.ordered_at >= $2 AND orders.ordered_at < $3)::INTEGER AS order_records,
                (SELECT COUNT(*) FROM business_order_items items
                 INNER JOIN business_orders orders ON orders.id = items.order_id
                 WHERE orders.business_id = $1 AND orders.ordered_at >= $2 AND orders.ordered_at < $3)::INTEGER AS item_records,
                (SELECT COUNT(*) FROM business_campaign_daily_metrics metrics
                 WHERE metrics.business_id = $1 AND metrics.metric_date >= $2::DATE AND metrics.metric_date < $3::DATE)::INTEGER AS campaign_records`,
            [businessId, current.from, current.to]
        );
        return {
            business,
            retrievedAt: new Date().toISOString(),
            current: metricsResult.rows[0],
            previous: previousMetricsResult.rows[0],
            topProducts: topProductsResult.rows,
            daily: dailyResult.rows,
            customerTrend: customerTrendResult.rows[0],
            campaign: campaignResult.rows[0],
            recordCounts: recordCountResult.rows[0]
        };
    } finally {
        client.release();
    }
}

async function getCompetitorAuditData(pool, { userId, businessId }) {
    const client = await pool.connect();
    try {
        const business = await assertBusinessAccess(client, userId, businessId);
        const result = await client.query(
            `SELECT competitors.id AS competitor_id,
                    competitors.name,
                    competitors.external_id,
                    competitors.source_name AS configured_source_name,
                    competitors.source_url AS configured_source_url,
                    snapshots.id AS snapshot_id,
                    snapshots.retrieved_at,
                    snapshots.source_name,
                    snapshots.source_url,
                    snapshots.currency,
                    snapshots.products,
                    snapshots.offers,
                    snapshots.positioning
             FROM business_competitors competitors
             LEFT JOIN LATERAL (
                SELECT snapshot.*
                FROM business_competitor_snapshots snapshot
                WHERE snapshot.competitor_id = competitors.id
                ORDER BY snapshot.retrieved_at DESC, snapshot.id DESC
                LIMIT 1
             ) snapshots ON TRUE
             WHERE competitors.business_id = $1 AND competitors.active = TRUE
             ORDER BY competitors.name ASC, competitors.id ASC`,
            [businessId]
        );
        return { business, retrievedAt: new Date().toISOString(), competitors: result.rows };
    } finally {
        client.release();
    }
}

async function getReviewResponderData(pool, { userId, businessId, limit = 20 }) {
    const client = await pool.connect();
    try {
        const business = await assertBusinessAccess(client, userId, businessId);
        const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
        const result = await client.query(
            `SELECT reviews.id, reviews.external_id, reviews.provider, reviews.rating,
                    reviews.review_text, reviews.review_status, reviews.published_at,
                    reviews.source_url, reviews.response_draft, reviews.response_status,
                    customers.name AS customer_name
             FROM business_reviews reviews
             LEFT JOIN business_customers customers ON customers.id = reviews.customer_id
             WHERE reviews.business_id = $1
               AND reviews.review_status = 'published'
               AND reviews.response_status IN ('unanswered', 'draft')
             ORDER BY reviews.published_at ASC, reviews.id ASC
             LIMIT $2`,
            [businessId, safeLimit]
        );
        return { business, retrievedAt: new Date().toISOString(), reviews: result.rows };
    } finally {
        client.release();
    }
}

async function saveReviewDrafts(pool, { userId, businessId, drafts }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await assertBusinessAccess(client, userId, businessId);
        const saved = [];
        for (const draft of drafts) {
            const result = await client.query(
                `UPDATE business_reviews
                 SET response_draft = $4,
                     response_status = CASE WHEN $4 IS NULL OR BTRIM($4) = '' THEN 'unanswered' ELSE 'draft' END,
                     updated_at = NOW()
                 WHERE id = $1 AND business_id = $2 AND external_id = $3
                 RETURNING id, external_id, response_draft, response_status`,
                [draft.id, businessId, draft.externalId, draft.response]
            );
            if (result.rows[0]) saved.push(result.rows[0]);
        }
        await client.query('COMMIT');
        return saved;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function updateReviewResponse(pool, { userId, reviewId, response, status }) {
    const result = await pool.query(
        `UPDATE business_reviews reviews
         SET response_draft = $3,
             response_status = $4,
             responded_at = CASE WHEN $4 = 'sent' THEN NOW() ELSE responded_at END,
             updated_at = NOW()
         FROM business_memberships memberships
         WHERE reviews.id = $1
           AND memberships.user_id = $2
           AND memberships.business_id = reviews.business_id
         RETURNING reviews.id, reviews.business_id, reviews.external_id, reviews.provider,
                   reviews.response_draft, reviews.response_status, reviews.responded_at`,
        [reviewId, userId, response, status]
    );
    return result.rows[0] || null;
}

async function getInventoryData(pool, { userId, businessId, current, previous }) {
    const client = await pool.connect();
    try {
        const business = await assertBusinessAccess(client, userId, businessId);
        const result = await client.query(
            `SELECT products.id AS product_id,
                    products.name AS product_name,
                    products.sku,
                    products.current_stock,
                    products.lead_time_days,
                    products.reorder_buffer_days,
                    COALESCE(SUM(items.quantity) FILTER (
                        WHERE orders.ordered_at >= $2 AND orders.ordered_at < $3
                    ), 0)::NUMERIC AS units_sold,
                    COALESCE(SUM(items.quantity) FILTER (
                        WHERE orders.ordered_at >= $4 AND orders.ordered_at < $2
                    ), 0)::NUMERIC AS previous_units_sold,
                    COUNT(DISTINCT orders.id) FILTER (
                        WHERE orders.ordered_at >= $2 AND orders.ordered_at < $3
                    )::INTEGER AS order_records
             FROM business_products products
             LEFT JOIN business_order_items items ON items.product_id = products.id
             LEFT JOIN business_orders orders
                    ON orders.id = items.order_id
                   AND orders.business_id = $1
                   AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND orders.ordered_at >= $4
                   AND orders.ordered_at < $3
             WHERE products.business_id = $1 AND products.active = TRUE
             GROUP BY products.id, products.name, products.sku, products.current_stock,
                      products.lead_time_days, products.reorder_buffer_days
             ORDER BY products.name ASC, products.id ASC`,
            [businessId, current.from, current.to, previous.from]
        );
        const itemCount = result.rows.reduce((sum, row) => sum + Number(row.order_records || 0), 0);
        return {
            business,
            retrievedAt: new Date().toISOString(),
            products: result.rows,
            recordsAnalyzed: result.rows.length + itemCount
        };
    } finally {
        client.release();
    }
}

async function getBusinessOverview(pool, { userId, businessId, current, previous }) {
    const weekly = await getWeeklyMarketingData(pool, { userId, businessId, current, previous });
    const crmResult = await pool.query(
        `WITH valid_orders AS (
            SELECT orders.*
            FROM business_orders orders
            WHERE orders.business_id = $1
              AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
              AND orders.ordered_at >= $2
              AND orders.ordered_at < $3
         ), customer_orders AS (
            SELECT customer_id, COUNT(*)::INTEGER AS order_count,
                   SUM(GREATEST(total_amount_minor - refunded_amount_minor, 0))::BIGINT AS lifetime_value_minor,
                   MAX(ordered_at) AS last_order_at
            FROM business_orders
            WHERE business_id = $1
              AND status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
              AND customer_id IS NOT NULL
            GROUP BY customer_id
         )
         SELECT
            (SELECT COUNT(*) FROM business_customers WHERE business_id = $1)::INTEGER AS total_customers,
            (SELECT COUNT(DISTINCT customer_id) FROM valid_orders WHERE customer_id IS NOT NULL)::INTEGER AS active_customers,
            (SELECT COUNT(*) FROM business_customers
             WHERE business_id = $1 AND last_activity_at IS NOT NULL AND last_activity_at < NOW() - INTERVAL '30 days')::INTEGER AS inactive_30_days,
            (SELECT COUNT(*) FROM business_reviews
             WHERE business_id = $1 AND response_status IN ('unanswered', 'draft'))::INTEGER AS followups_due,
            (SELECT COUNT(*) FROM customer_orders WHERE order_count >= 2)::INTEGER AS repeat_customers,
            (SELECT COUNT(*) FROM customer_orders)::INTEGER AS purchasing_customers`,
        [businessId, current.from, current.to]
    );
    const customersResult = await pool.query(
        `WITH customer_orders AS (
            SELECT customer_id,
                   COUNT(*)::INTEGER AS order_count,
                   SUM(GREATEST(total_amount_minor - refunded_amount_minor, 0))::BIGINT AS lifetime_value_minor,
                   MAX(ordered_at) AS last_order_at
            FROM business_orders
            WHERE business_id = $1
              AND status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
              AND customer_id IS NOT NULL
            GROUP BY customer_id
         )
         SELECT customers.id, customers.external_id, customers.name, customers.email,
                customers.status, customers.first_seen_at, customers.last_activity_at,
                COALESCE(customer_orders.order_count, 0)::INTEGER AS order_count,
                COALESCE(customer_orders.lifetime_value_minor, 0)::BIGINT AS lifetime_value_minor,
                customer_orders.last_order_at,
                EXISTS (
                    SELECT 1 FROM business_reviews reviews
                    WHERE reviews.customer_id = customers.id
                      AND reviews.response_status IN ('unanswered', 'draft')
                ) AS needs_review_followup
         FROM business_customers customers
         LEFT JOIN customer_orders ON customer_orders.customer_id = customers.id
         WHERE customers.business_id = $1
         ORDER BY needs_review_followup DESC,
                  customer_orders.lifetime_value_minor DESC NULLS LAST,
                  customers.last_activity_at ASC NULLS LAST,
                  customers.id ASC
         LIMIT 50`,
        [businessId]
    );
    return {
        ...weekly,
        crm: crmResult.rows[0],
        customers: customersResult.rows
    };
}

async function importBusinessData(pool, { userId, businessId, payload }) {
    const client = await pool.connect();
    const counts = {
        business: 0,
        customers: 0,
        products: 0,
        orders: 0,
        orderItems: 0,
        campaignMetrics: 0,
        reviews: 0,
        competitors: 0,
        competitorSnapshots: 0,
        coupons: 0,
        trafficDailyMetrics: 0,
        carts: 0
    };
    try {
        await client.query('BEGIN');
        let business = await assertBusinessAccess(client, userId, businessId);
        if (payload.business) {
            const updatedBusinessResult = await client.query(
                `UPDATE businesses
                 SET name = COALESCE($2, name),
                     currency = COALESCE($3, currency),
                     timezone = COALESCE($4, timezone),
                     business_type = COALESCE($5, business_type),
                     industry = COALESCE($6, industry),
                     products_services = COALESCE($7::JSONB, products_services),
                     website_url = COALESCE($8, website_url),
                     location = COALESCE($9::JSONB, location),
                     country_code = COALESCE($10, country_code),
                     latitude = COALESCE($11, latitude),
                     longitude = COALESCE($12, longitude),
                     target_audience = COALESCE($13, target_audience),
                     brand_voice = COALESCE($14, brand_voice),
                     social_media_accounts = COALESCE($15::JSONB, social_media_accounts),
                     marketing_goals = COALESCE($16::JSONB, marketing_goals),
                     google_place_id = COALESCE($17, google_place_id),
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [
                    businessId, payload.business.name, payload.business.currency, payload.business.timezone,
                    payload.business.businessType, payload.business.industry,
                    payload.business.productsServices ? JSON.stringify(payload.business.productsServices) : null,
                    payload.business.websiteUrl,
                    payload.business.location ? JSON.stringify(payload.business.location) : null,
                    payload.business.countryCode, payload.business.latitude, payload.business.longitude,
                    payload.business.targetAudience, payload.business.brandVoice,
                    payload.business.socialMediaAccounts ? JSON.stringify(payload.business.socialMediaAccounts) : null,
                    payload.business.marketingGoals ? JSON.stringify(payload.business.marketingGoals) : null,
                    payload.business.googlePlaceId
                ]
            );
            business = { ...updatedBusinessResult.rows[0], role: business.role };
            counts.business = 1;
        }
        for (const item of payload.customers || []) {
            await client.query(
                `INSERT INTO business_customers (
                    business_id, external_id, name, email, status, first_seen_at, last_activity_at, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB)
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    email = EXCLUDED.email,
                    status = EXCLUDED.status,
                    first_seen_at = EXCLUDED.first_seen_at,
                    last_activity_at = EXCLUDED.last_activity_at,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.name, item.email, item.status, item.firstSeenAt, item.lastActivityAt, JSON.stringify(item.metadata || {})]
            );
            counts.customers += 1;
        }
        for (const item of payload.products || []) {
            await client.query(
                `INSERT INTO business_products (
                    business_id, external_id, name, sku, category_name, currency, price_minor, cost_minor,
                    current_stock, lead_time_days, reorder_buffer_days, active, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::JSONB)
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    sku = EXCLUDED.sku,
                    category_name = EXCLUDED.category_name,
                    currency = EXCLUDED.currency,
                    price_minor = EXCLUDED.price_minor,
                    cost_minor = EXCLUDED.cost_minor,
                    current_stock = EXCLUDED.current_stock,
                    lead_time_days = EXCLUDED.lead_time_days,
                    reorder_buffer_days = EXCLUDED.reorder_buffer_days,
                    active = EXCLUDED.active,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.name, item.sku, item.categoryName, item.currency || business.currency, item.priceMinor, item.costMinor, item.currentStock, item.leadTimeDays, item.reorderBufferDays, item.active, JSON.stringify(item.metadata || {})]
            );
            counts.products += 1;
        }
        for (const item of payload.orders || []) {
            await client.query(
                `INSERT INTO business_orders (
                    business_id, external_id, customer_id, status, currency, total_amount_minor,
                    refunded_amount_minor, ordered_at, source_name, shipping_country_code, coupon_code, metadata
                 ) VALUES (
                    $1, $2,
                    (SELECT id FROM business_customers WHERE business_id = $1 AND external_id = $3 LIMIT 1),
                    $4, $5, $6, $7, $8, $9, $10, $11, $12::JSONB
                 )
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    customer_id = EXCLUDED.customer_id,
                    status = EXCLUDED.status,
                    currency = EXCLUDED.currency,
                    total_amount_minor = EXCLUDED.total_amount_minor,
                    refunded_amount_minor = EXCLUDED.refunded_amount_minor,
                    ordered_at = EXCLUDED.ordered_at,
                    source_name = EXCLUDED.source_name,
                    shipping_country_code = EXCLUDED.shipping_country_code,
                    coupon_code = EXCLUDED.coupon_code,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.customerExternalId, item.status, item.currency || business.currency, item.totalAmountMinor, item.refundedAmountMinor, item.orderedAt, item.sourceName, item.shippingCountryCode, item.couponCode, JSON.stringify(item.metadata || {})]
            );
            counts.orders += 1;
        }
        for (const item of payload.orderItems || []) {
            const result = await client.query(
                `INSERT INTO business_order_items (
                    order_id, external_id, product_id, quantity, unit_price_minor, total_amount_minor, metadata
                 )
                 SELECT orders.id, $3, products.id, $5, $6, $7, $8::JSONB
                 FROM business_orders orders
                 LEFT JOIN business_products products
                    ON products.business_id = orders.business_id AND products.external_id = $4
                 WHERE orders.business_id = $1 AND orders.external_id = $2
                 ON CONFLICT (order_id, external_id) DO UPDATE SET
                    product_id = EXCLUDED.product_id,
                    quantity = EXCLUDED.quantity,
                    unit_price_minor = EXCLUDED.unit_price_minor,
                    total_amount_minor = EXCLUDED.total_amount_minor,
                    metadata = EXCLUDED.metadata
                 RETURNING id`,
                [businessId, item.orderExternalId, item.externalId, item.productExternalId, item.quantity, item.unitPriceMinor, item.totalAmountMinor, JSON.stringify(item.metadata || {})]
            );
            if (!result.rows[0]) throw createImportReferenceError(`Order ${item.orderExternalId} was not found for an order item.`);
            counts.orderItems += 1;
        }
        for (const item of payload.campaignMetrics || []) {
            await client.query(
                `INSERT INTO business_campaign_daily_metrics (
                    business_id, external_id, campaign_name, metric_date, currency, spend_minor,
                    attributed_revenue_minor, impressions, clicks, visitors, leads, conversions,
                    source_name, retrieved_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (business_id, external_id, metric_date) DO UPDATE SET
                    campaign_name = EXCLUDED.campaign_name,
                    currency = EXCLUDED.currency,
                    spend_minor = EXCLUDED.spend_minor,
                    attributed_revenue_minor = EXCLUDED.attributed_revenue_minor,
                    impressions = EXCLUDED.impressions,
                    clicks = EXCLUDED.clicks,
                    visitors = EXCLUDED.visitors,
                    leads = EXCLUDED.leads,
                    conversions = EXCLUDED.conversions,
                    source_name = EXCLUDED.source_name,
                    retrieved_at = EXCLUDED.retrieved_at,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.campaignName, item.metricDate, item.currency || business.currency, item.spendMinor, item.attributedRevenueMinor, item.impressions, item.clicks, item.visitors, item.leads, item.conversions, item.sourceName, item.retrievedAt]
            );
            counts.campaignMetrics += 1;
        }
        for (const item of payload.reviews || []) {
            await client.query(
                `INSERT INTO business_reviews (
                    business_id, external_id, customer_id, provider, rating, review_text,
                    review_status, published_at, source_url, metadata
                 ) VALUES (
                    $1, $2,
                    (SELECT id FROM business_customers WHERE business_id = $1 AND external_id = $3 LIMIT 1),
                    $4, $5, $6, $7, $8, $9, $10::JSONB
                 )
                 ON CONFLICT (business_id, provider, external_id) DO UPDATE SET
                    customer_id = EXCLUDED.customer_id,
                    rating = EXCLUDED.rating,
                    review_text = EXCLUDED.review_text,
                    review_status = EXCLUDED.review_status,
                    published_at = EXCLUDED.published_at,
                    source_url = EXCLUDED.source_url,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.customerExternalId, item.provider, item.rating, item.reviewText, item.reviewStatus, item.publishedAt, item.sourceUrl, JSON.stringify(item.metadata || {})]
            );
            counts.reviews += 1;
        }
        for (const item of payload.competitors || []) {
            await client.query(
                `INSERT INTO business_competitors (
                    business_id, external_id, name, source_name, source_url, active, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB)
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    source_name = EXCLUDED.source_name,
                    source_url = EXCLUDED.source_url,
                    active = EXCLUDED.active,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.name, item.sourceName, item.sourceUrl, item.active, JSON.stringify(item.metadata || {})]
            );
            counts.competitors += 1;
        }
        for (const item of payload.competitorSnapshots || []) {
            const result = await client.query(
                `INSERT INTO business_competitor_snapshots (
                    competitor_id, retrieved_at, source_name, source_url, currency,
                    products, offers, positioning, raw_metadata
                 )
                 SELECT competitors.id, $3, $4, $5, $6, $7::JSONB, $8::JSONB, $9, $10::JSONB
                 FROM business_competitors competitors
                 WHERE competitors.business_id = $1 AND competitors.external_id = $2
                 ON CONFLICT (competitor_id, retrieved_at) DO UPDATE SET
                    source_name = EXCLUDED.source_name,
                    source_url = EXCLUDED.source_url,
                    currency = EXCLUDED.currency,
                    products = EXCLUDED.products,
                    offers = EXCLUDED.offers,
                    positioning = EXCLUDED.positioning,
                    raw_metadata = EXCLUDED.raw_metadata
                 RETURNING id`,
                [businessId, item.competitorExternalId, item.retrievedAt, item.sourceName, item.sourceUrl, item.currency, JSON.stringify(item.products || []), JSON.stringify(item.offers || []), item.positioning, JSON.stringify(item.rawMetadata || {})]
            );
            if (!result.rows[0]) throw createImportReferenceError(`Competitor ${item.competitorExternalId} was not found for a snapshot.`);
            counts.competitorSnapshots += 1;
        }
        for (const item of payload.coupons || []) {
            await client.query(
                `INSERT INTO business_coupons (
                    business_id, external_id, code, discount_type, discount_value, currency,
                    starts_at, ends_at, active, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::JSONB)
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    code = EXCLUDED.code,
                    discount_type = EXCLUDED.discount_type,
                    discount_value = EXCLUDED.discount_value,
                    currency = EXCLUDED.currency,
                    starts_at = EXCLUDED.starts_at,
                    ends_at = EXCLUDED.ends_at,
                    active = EXCLUDED.active,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.code, item.discountType, item.discountValue, item.currency || business.currency, item.startsAt, item.endsAt, item.active, JSON.stringify(item.metadata || {})]
            );
            counts.coupons += 1;
        }
        for (const item of payload.trafficDailyMetrics || []) {
            await client.query(
                `INSERT INTO business_traffic_daily_metrics (
                    business_id, external_id, metric_date, source_name, medium_name, campaign_name,
                    sessions, users, new_users, product_views, add_to_carts, checkout_starts,
                    purchases, revenue_minor, currency, retrieved_at, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::JSONB)
                 ON CONFLICT (business_id, external_id, metric_date, source_name) DO UPDATE SET
                    medium_name = EXCLUDED.medium_name,
                    campaign_name = EXCLUDED.campaign_name,
                    sessions = EXCLUDED.sessions,
                    users = EXCLUDED.users,
                    new_users = EXCLUDED.new_users,
                    product_views = EXCLUDED.product_views,
                    add_to_carts = EXCLUDED.add_to_carts,
                    checkout_starts = EXCLUDED.checkout_starts,
                    purchases = EXCLUDED.purchases,
                    revenue_minor = EXCLUDED.revenue_minor,
                    currency = EXCLUDED.currency,
                    retrieved_at = EXCLUDED.retrieved_at,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.metricDate, item.sourceName, item.mediumName, item.campaignName, item.sessions, item.users, item.newUsers, item.productViews, item.addToCarts, item.checkoutStarts, item.purchases, item.revenueMinor, item.currency || business.currency, item.retrievedAt, JSON.stringify(item.metadata || {})]
            );
            counts.trafficDailyMetrics += 1;
        }
        for (const item of payload.carts || []) {
            await client.query(
                `INSERT INTO business_cart_sessions (
                    business_id, external_id, customer_id, currency, cart_value_minor, item_count,
                    status, source_name, started_at, updated_at, converted_order_external_id, metadata
                 ) VALUES (
                    $1, $2,
                    (SELECT id FROM business_customers WHERE business_id = $1 AND external_id = $3 LIMIT 1),
                    $4, $5, $6, $7, $8, $9, $10, $11, $12::JSONB
                 )
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    customer_id = EXCLUDED.customer_id,
                    currency = EXCLUDED.currency,
                    cart_value_minor = EXCLUDED.cart_value_minor,
                    item_count = EXCLUDED.item_count,
                    status = EXCLUDED.status,
                    source_name = EXCLUDED.source_name,
                    started_at = EXCLUDED.started_at,
                    updated_at = EXCLUDED.updated_at,
                    converted_order_external_id = EXCLUDED.converted_order_external_id,
                    metadata = EXCLUDED.metadata`,
                [businessId, item.externalId, item.customerExternalId, item.currency || business.currency, item.cartValueMinor, item.itemCount, item.status, item.sourceName, item.startedAt, item.updatedAt, item.convertedOrderExternalId, JSON.stringify(item.metadata || {})]
            );
            counts.carts += 1;
        }
        await client.query('DELETE FROM marketing_workspace_cache WHERE business_id = $1', [businessId]);
        await client.query('COMMIT');
        return { business, counts, importedAt: new Date().toISOString() };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function createImportReferenceError(message) {
    const error = new Error(message);
    error.code = 'IMPORT_REFERENCE_NOT_FOUND';
    error.statusCode = 400;
    error.publicMessage = message;
    return error;
}


async function insertWebhookEvent(client, {
    provider,
    eventId,
    eventType,
    providerOrderId = null,
    providerPaymentId = null,
    providerCreatedAt = null
}) {
    const result = await client.query(
        `INSERT INTO payment_webhook_events (
            provider, event_id, event_type, provider_order_id, provider_payment_id,
            status, provider_created_at
         ) VALUES ($1, $2, $3, $4, $5, 'processing', $6)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [
            provider,
            eventId,
            eventType,
            providerOrderId,
            providerPaymentId,
            providerCreatedAt
        ]
    );
    return result.rows[0] || null;
}

async function getBillingProfileWithClient(client, userId) {
    const result = await client.query(
        `UPDATE users
         SET current_plan = CASE
                 WHEN plan_expires_at IS NOT NULL AND plan_expires_at <= NOW() THEN 'free'
                 ELSE current_plan
             END,
             plan_expires_at = CASE
                 WHEN plan_expires_at IS NOT NULL AND plan_expires_at <= NOW() THEN NULL
                 ELSE plan_expires_at
             END,
             updated_at = CASE
                 WHEN plan_expires_at IS NOT NULL AND plan_expires_at <= NOW() THEN NOW()
                 ELSE updated_at
             END
         WHERE id = $1
         RETURNING current_plan, plan_expires_at`,
        [userId]
    );
    return result.rows[0] || { current_plan: 'free', plan_expires_at: null };
}

async function resolveAiAgentPromptPeriod(client, userId, { lockUser = false } = {}) {
    await client.query(
        `UPDATE users
         SET current_plan = 'free', plan_expires_at = NULL, updated_at = NOW()
         WHERE id = $1 AND plan_expires_at IS NOT NULL AND plan_expires_at <= NOW()`,
        [userId]
    );
    const userResult = await client.query(
        `SELECT current_plan, plan_expires_at, updated_at
         FROM users
         WHERE id = $1
         ${lockUser ? 'FOR UPDATE' : ''}`,
        [userId]
    );
    const user = userResult.rows[0];
    if (!user) throw databasePublicError('USER_NOT_FOUND', 'The signed-in account was not found.', 404);

    const plan = getPlanById(user.current_plan) || getPlanById('free');
    const limit = Number(plan.aiAgentPromptLimit);
    if (plan.id === 'free') {
        const periodResult = await client.query(
            `SELECT DATE_TRUNC('month', NOW()) AS period_start,
                    DATE_TRUNC('month', NOW()) + INTERVAL '1 month' AS period_end`
        );
        return {
            planId: plan.id,
            planName: plan.name,
            limit,
            periodKind: 'calendar_month',
            periodStart: periodResult.rows[0].period_start,
            periodEnd: periodResult.rows[0].period_end
        };
    }

    const paymentPeriodResult = await client.query(
        `SELECT access_starts_at AS period_start, access_expires_at AS period_end
         FROM payments
         WHERE user_id = $1
           AND plan_id = $2
           AND status IN ('completed', 'partially_refunded')
           AND refunded_amount_minor < amount_minor
           AND access_starts_at <= NOW()
           AND access_expires_at > NOW()
         ORDER BY access_starts_at DESC, completed_at DESC, id DESC
         LIMIT 1`,
        [userId, plan.id]
    );
    let period = paymentPeriodResult.rows[0];
    if (!period) {
        const fallbackResult = await client.query(
            `SELECT COALESCE($1::TIMESTAMPTZ - INTERVAL '30 days', $2::TIMESTAMPTZ) AS period_start,
                    COALESCE($1::TIMESTAMPTZ, $2::TIMESTAMPTZ + INTERVAL '30 days') AS period_end`,
            [user.plan_expires_at, user.updated_at]
        );
        period = fallbackResult.rows[0];
    }

    return {
        planId: plan.id,
        planName: plan.name,
        limit,
        periodKind: 'subscription',
        periodStart: period.period_start,
        periodEnd: period.period_end
    };
}

function buildAiAgentPromptUsage(period, usedCount) {
    const used = Math.max(0, Math.min(period.limit, Number(usedCount) || 0));
    return {
        planId: period.planId,
        planName: period.planName,
        limit: period.limit,
        used,
        remaining: Math.max(0, period.limit - used),
        exhausted: used >= period.limit,
        periodKind: period.periodKind,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd
    };
}

async function completePaymentTransaction(client, {
    userId,
    provider,
    planId,
    providerOrderId,
    providerPaymentId,
    amountMinor,
    currency
}) {
    const paymentResult = await client.query(
        `SELECT id, user_id, plan_id, amount_minor, currency, status, provider_payment_id
         FROM payments
         WHERE user_id = $1 AND provider = $2 AND provider_order_id = $3
         FOR UPDATE`,
        [userId, provider, providerOrderId]
    );
    const payment = paymentResult.rows[0];
    if (!payment) {
        const error = new Error('Pending payment was not found.');
        error.code = 'PAYMENT_NOT_FOUND';
        throw error;
    }
    if (payment.plan_id !== planId
        || Number(payment.amount_minor) !== amountMinor
        || payment.currency !== currency) {
        const error = new Error('Payment details do not match the stored order.');
        error.code = 'PAYMENT_MISMATCH';
        throw error;
    }
    if (payment.status === 'refunded') {
        const error = new Error('Refunded payments cannot reactivate a subscription.');
        error.code = 'PAYMENT_REFUNDED';
        throw error;
    }
    if (payment.status === 'completed' || payment.status === 'partially_refunded') {
        if (payment.provider_payment_id !== providerPaymentId) {
            const error = new Error('Payment order was already completed with a different payment ID.');
            error.code = 'PAYMENT_ALREADY_COMPLETED';
            throw error;
        }
        const billing = await getBillingProfileWithClient(client, userId);
        return { completed: true, alreadyCompleted: true, billing };
    }

    const userResult = await client.query(
        `SELECT current_plan, plan_expires_at, NOW() AS database_now
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [userId]
    );
    const user = userResult.rows[0];
    if (!user) {
        const error = new Error('Payment user was not found.');
        error.code = 'PAYMENT_USER_NOT_FOUND';
        throw error;
    }

    const databaseNow = new Date(user.database_now);
    const existingExpiry = user.plan_expires_at ? new Date(user.plan_expires_at) : null;
    const accessStartsAt = user.current_plan === planId
        && existingExpiry
        && existingExpiry.getTime() > databaseNow.getTime()
        ? existingExpiry
        : databaseNow;
    const accessExpiresAt = new Date(accessStartsAt.getTime() + (30 * 24 * 60 * 60 * 1000));

    const updatedPayment = await client.query(
        `UPDATE payments
         SET status = 'completed',
             provider_payment_id = $2,
             failure_reason = NULL,
             cancelled_at = NULL,
             completed_at = COALESCE(completed_at, NOW()),
             access_starts_at = $3,
             access_expires_at = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [payment.id, providerPaymentId, accessStartsAt, accessExpiresAt]
    );
    if (!updatedPayment.rows[0]) {
        const error = new Error('Payment could not be completed.');
        error.code = 'PAYMENT_UPDATE_FAILED';
        throw error;
    }

    const billingResult = await client.query(
        `UPDATE users
         SET current_plan = $2,
             plan_expires_at = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING current_plan, plan_expires_at`,
        [userId, planId, accessExpiresAt]
    );
    if (!billingResult.rows[0]) {
        const error = new Error('Subscription could not be activated.');
        error.code = 'SUBSCRIPTION_ACTIVATION_FAILED';
        throw error;
    }

    return {
        completed: true,
        alreadyCompleted: false,
        billing: billingResult.rows[0]
    };
}

async function findOAuthIdentity(client, provider, providerUserId) {
    const result = await client.query(
        `SELECT users.id, users.username, users.email
         FROM oauth_accounts
         INNER JOIN users ON users.id = oauth_accounts.user_id
         WHERE oauth_accounts.provider = $1
           AND oauth_accounts.provider_user_id = $2
         LIMIT 1`,
        [provider, providerUserId]
    );
    return result.rows[0] || null;
}

async function findUserByEmailWithClient(client, email) {
    const result = await client.query(
        `SELECT id, username, email
         FROM users
         WHERE LOWER(email) = LOWER($1)
         LIMIT 1`,
        [email]
    );
    return result.rows[0] || null;
}

async function createOAuthUserWithUniqueUsername(client, { email, preferredUsername }) {
    const baseUsername = sanitizeOAuthUsername(preferredUsername || email.split('@')[0]);

    for (let attempt = 0; attempt < 100; attempt += 1) {
        const username = usernameCandidate(baseUsername, attempt);
        const result = await client.query(
            `INSERT INTO users (username, email, password_hash)
             VALUES ($1, $2, NULL)
             ON CONFLICT DO NOTHING
             RETURNING id, username, email`,
            [username, email]
        );

        if (result.rows[0]) {
            return result.rows[0];
        }

        const existingEmail = await findUserByEmailWithClient(client, email);
        if (existingEmail) {
            return existingEmail;
        }
    }

    throw new Error('Unable to allocate a unique username for OAuth account.');
}

function sanitizeOAuthUsername(value) {
    let username = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);

    if (username.length < 3) {
        username = `user_${username || 'account'}`.slice(0, 32);
    }

    return username;
}

function usernameCandidate(baseUsername, attempt) {
    if (attempt === 0) {
        return baseUsername.slice(0, 32);
    }
    const suffix = `_${attempt}`;
    return `${baseUsername.slice(0, 32 - suffix.length)}${suffix}`;
}

function createBranchTitle(value) {
    const sourceTitle = String(value || '').replace(/\s+/g, ' ').trim();
    const baseTitle = !sourceTitle || sourceTitle === 'New chat' ? 'New chat' : sourceTitle;
    const suffix = ' · branch';
    return `${baseTitle.slice(0, 80 - suffix.length).trimEnd()}${suffix}`;
}


async function getMarketingWorkspaceData(pool, { userId, businessId, periods }) {
    const client = await pool.connect();
    try {
        const business = await assertBusinessAccess(client, userId, businessId);
        const current = periods.current;
        const previous = periods.previous;
        const yearAgo = periods.yearAgo;
        const common = [businessId, business.currency, current.from, current.to, previous.from, previous.to, yearAgo.from, yearAgo.to];
        const calendarPeriods = buildMarketingPeriods(new Date(new Date(current.to).getTime() - 1), business.timezone || 'UTC');
        const comparisonPeriods = [
            ['today_current', calendarPeriods.today.current], ['today_previous', calendarPeriods.today.previous],
            ['week_current', calendarPeriods.week.current], ['week_previous', calendarPeriods.week.previous],
            ['month_current', calendarPeriods.month.current], ['month_previous', calendarPeriods.month.previous],
            ['quarter_current', calendarPeriods.quarter.current], ['quarter_previous', calendarPeriods.quarter.previous],
            ['year_current', calendarPeriods.year.current], ['year_ago', calendarPeriods.year.yearAgo]
        ];
        const comparisonParameters = [
            businessId,
            business.currency,
            comparisonPeriods.map(([key]) => key),
            comparisonPeriods.map(([, period]) => period.from),
            comparisonPeriods.map(([, period]) => period.to)
        ];
        const [
            summaryResult,
            standardComparisonResult,
            dailyResult,
            productResult,
            categoryResult,
            customerResult,
            segmentResult,
            campaignResult,
            trafficResult,
            cartResult,
            geographyResult,
            couponResult,
            inventoryResult,
            freshnessResult
        ] = await runClientQueriesSequentially([
            () => client.query(
                `WITH scoped AS (
                    SELECT orders.id, orders.customer_id, orders.ordered_at,
                           GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)::BIGINT AS revenue_minor,
                           CASE
                               WHEN orders.ordered_at >= $3 AND orders.ordered_at < $4 THEN 'current'
                               WHEN orders.ordered_at >= $5 AND orders.ordered_at < $6 THEN 'previous'
                               WHEN orders.ordered_at >= $7 AND orders.ordered_at < $8 THEN 'year_ago'
                           END AS period_key
                    FROM business_orders orders
                    WHERE orders.business_id = $1
                      AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND (
                          (orders.ordered_at >= $3 AND orders.ordered_at < $4) OR
                          (orders.ordered_at >= $5 AND orders.ordered_at < $6) OR
                          (orders.ordered_at >= $7 AND orders.ordered_at < $8)
                      )
                 ), first_orders AS (
                    SELECT customer_id, MIN(ordered_at) AS first_order_at
                    FROM business_orders
                    WHERE business_id = $1
                      AND currency = $2
                      AND status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND customer_id IS NOT NULL
                    GROUP BY customer_id
                 ), item_profit AS (
                    SELECT CASE
                               WHEN orders.ordered_at >= $3 AND orders.ordered_at < $4 THEN 'current'
                               WHEN orders.ordered_at >= $5 AND orders.ordered_at < $6 THEN 'previous'
                               WHEN orders.ordered_at >= $7 AND orders.ordered_at < $8 THEN 'year_ago'
                           END AS period_key,
                           SUM(${NET_ITEM_REVENUE_SQL} - (products.cost_minor * items.quantity))
                               FILTER (WHERE orders.id IS NOT NULL AND products.cost_minor IS NOT NULL AND items.total_amount_minor IS NOT NULL)::BIGINT AS profit_minor,
                           COUNT(*) FILTER (WHERE products.cost_minor IS NOT NULL AND items.total_amount_minor IS NOT NULL)::INTEGER AS profit_item_records
                    FROM business_order_items items
                    INNER JOIN business_orders orders ON orders.id = items.order_id
                    LEFT JOIN business_products products ON products.id = items.product_id
                    WHERE orders.business_id = $1
                      AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND (
                          (orders.ordered_at >= $3 AND orders.ordered_at < $4) OR
                          (orders.ordered_at >= $5 AND orders.ordered_at < $6) OR
                          (orders.ordered_at >= $7 AND orders.ordered_at < $8)
                      )
                    GROUP BY period_key
                 )
                 SELECT scoped.period_key,
                        COUNT(*)::INTEGER AS orders,
                        COALESCE(SUM(scoped.revenue_minor), 0)::BIGINT AS revenue_minor,
                        COUNT(DISTINCT scoped.customer_id) FILTER (WHERE scoped.customer_id IS NOT NULL)::INTEGER AS purchasing_customers,
                        COUNT(DISTINCT scoped.customer_id) FILTER (
                            WHERE scoped.customer_id IS NOT NULL AND first_orders.first_order_at >=
                                CASE scoped.period_key WHEN 'current' THEN $3 WHEN 'previous' THEN $5 ELSE $7 END
                              AND first_orders.first_order_at <
                                CASE scoped.period_key WHEN 'current' THEN $4 WHEN 'previous' THEN $6 ELSE $8 END
                        )::INTEGER AS new_customers,
                        COUNT(DISTINCT scoped.customer_id) FILTER (
                            WHERE scoped.customer_id IS NOT NULL AND first_orders.first_order_at <
                                CASE scoped.period_key WHEN 'current' THEN $3 WHEN 'previous' THEN $5 ELSE $7 END
                        )::INTEGER AS returning_customers,
                        MIN(scoped.ordered_at) AS first_order_at,
                        MAX(scoped.ordered_at) AS last_order_at,
                        item_profit.profit_minor,
                        COALESCE(item_profit.profit_item_records, 0)::INTEGER AS profit_item_records
                 FROM scoped
                 LEFT JOIN first_orders ON first_orders.customer_id = scoped.customer_id
                 LEFT JOIN item_profit ON item_profit.period_key = scoped.period_key
                 WHERE scoped.period_key IS NOT NULL
                 GROUP BY scoped.period_key, item_profit.profit_minor, item_profit.profit_item_records`, common),
            () => client.query(
                `WITH comparison_periods AS (
                    SELECT *
                    FROM UNNEST($3::TEXT[], $4::TIMESTAMPTZ[], $5::TIMESTAMPTZ[])
                    AS period_values(period_key, from_at, to_at)
                 ), order_summary AS (
                    SELECT periods.period_key,
                           COUNT(orders.id)::INTEGER AS orders,
                           COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor,
                           COUNT(DISTINCT orders.customer_id) FILTER (WHERE orders.customer_id IS NOT NULL)::INTEGER AS purchasing_customers
                    FROM comparison_periods periods
                    LEFT JOIN business_orders orders
                      ON orders.business_id = $1
                     AND orders.currency = $2
                     AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                     AND orders.ordered_at >= periods.from_at
                     AND orders.ordered_at < periods.to_at
                    GROUP BY periods.period_key
                 ), profit_summary AS (
                    SELECT periods.period_key,
                           SUM(${NET_ITEM_REVENUE_SQL} - products.cost_minor * items.quantity)
                               FILTER (WHERE orders.id IS NOT NULL AND products.cost_minor IS NOT NULL AND items.total_amount_minor IS NOT NULL)::BIGINT AS profit_minor,
                           COUNT(items.id) FILTER (WHERE orders.id IS NOT NULL AND products.cost_minor IS NOT NULL AND items.total_amount_minor IS NOT NULL)::INTEGER AS profit_item_records
                    FROM comparison_periods periods
                    LEFT JOIN business_orders orders
                      ON orders.business_id = $1
                     AND orders.currency = $2
                     AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                     AND orders.ordered_at >= periods.from_at
                     AND orders.ordered_at < periods.to_at
                    LEFT JOIN business_order_items items ON items.order_id = orders.id
                    LEFT JOIN business_products products ON products.id = items.product_id
                    GROUP BY periods.period_key
                 )
                 SELECT periods.period_key,
                        periods.from_at, periods.to_at,
                        COALESCE(order_summary.orders, 0)::INTEGER AS orders,
                        COALESCE(order_summary.revenue_minor, 0)::BIGINT AS revenue_minor,
                        COALESCE(order_summary.purchasing_customers, 0)::INTEGER AS purchasing_customers,
                        profit_summary.profit_minor,
                        COALESCE(profit_summary.profit_item_records, 0)::INTEGER AS profit_item_records
                 FROM comparison_periods periods
                 LEFT JOIN order_summary USING (period_key)
                 LEFT JOIN profit_summary USING (period_key)
                 ORDER BY periods.from_at ASC, periods.period_key ASC`, comparisonParameters),
            () => client.query(
                `WITH days AS (
                    SELECT generate_series($3::TIMESTAMPTZ::DATE, ($4::TIMESTAMPTZ - INTERVAL '1 day')::DATE, INTERVAL '1 day')::DATE AS day
                 ), order_daily AS (
                    SELECT (orders.ordered_at AT TIME ZONE 'UTC')::DATE AS day,
                           COUNT(*)::INTEGER AS orders,
                           COUNT(DISTINCT orders.customer_id) FILTER (WHERE orders.customer_id IS NOT NULL)::INTEGER AS customers,
                           SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0))::BIGINT AS revenue_minor
                    FROM business_orders orders
                    WHERE orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND orders.ordered_at >= $3 AND orders.ordered_at < $4
                    GROUP BY day
                 ), item_daily AS (
                    SELECT (orders.ordered_at AT TIME ZONE 'UTC')::DATE AS day,
                           COALESCE(SUM(items.quantity), 0)::NUMERIC AS units,
                           SUM(${NET_ITEM_REVENUE_SQL} - products.cost_minor * items.quantity)
                               FILTER (WHERE products.cost_minor IS NOT NULL AND items.total_amount_minor IS NOT NULL)::BIGINT AS profit_minor
                    FROM business_order_items items
                    INNER JOIN business_orders orders ON orders.id = items.order_id
                    LEFT JOIN business_products products ON products.id = items.product_id
                    WHERE orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND orders.ordered_at >= $3 AND orders.ordered_at < $4
                    GROUP BY day
                 )
                 SELECT days.day, COALESCE(order_daily.orders, 0)::INTEGER AS orders,
                        COALESCE(order_daily.customers, 0)::INTEGER AS customers,
                        COALESCE(order_daily.revenue_minor, 0)::BIGINT AS revenue_minor,
                        COALESCE(item_daily.units, 0)::NUMERIC AS units,
                        item_daily.profit_minor
                 FROM days
                 LEFT JOIN order_daily USING (day)
                 LEFT JOIN item_daily USING (day)
                 ORDER BY days.day ASC`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `SELECT products.id AS product_id, products.name AS product_name, products.sku,
                        products.category_name, products.current_stock, products.lead_time_days,
                        products.reorder_buffer_days, products.price_minor, products.cost_minor,
                        COALESCE(SUM(items.quantity) FILTER (WHERE orders.ordered_at >= $3 AND orders.ordered_at < $4), 0)::NUMERIC AS units_sold,
                        COALESCE(SUM(${NET_ITEM_REVENUE_SQL}) FILTER (WHERE orders.ordered_at >= $3 AND orders.ordered_at < $4), 0)::BIGINT AS revenue_minor,
                        SUM(${NET_ITEM_REVENUE_SQL} - products.cost_minor * items.quantity)
                            FILTER (WHERE orders.ordered_at >= $3 AND orders.ordered_at < $4 AND products.cost_minor IS NOT NULL AND items.total_amount_minor IS NOT NULL)::BIGINT AS profit_minor,
                        COUNT(DISTINCT orders.id) FILTER (WHERE orders.ordered_at >= $3 AND orders.ordered_at < $4)::INTEGER AS order_count,
                        COALESCE(SUM(items.quantity) FILTER (WHERE orders.ordered_at >= $5 AND orders.ordered_at < $6), 0)::NUMERIC AS previous_units_sold,
                        COALESCE(SUM(${NET_ITEM_REVENUE_SQL}) FILTER (WHERE orders.ordered_at >= $5 AND orders.ordered_at < $6), 0)::BIGINT AS previous_revenue_minor,
                        MAX(orders.ordered_at) FILTER (WHERE orders.ordered_at >= $3 AND orders.ordered_at < $4) AS last_sold_at
                 FROM business_products products
                 LEFT JOIN business_order_items items ON items.product_id = products.id
                 LEFT JOIN business_orders orders ON orders.id = items.order_id
                    AND orders.business_id = $1 AND orders.currency = $2
                    AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                    AND ((orders.ordered_at >= $3 AND orders.ordered_at < $4)
                         OR (orders.ordered_at >= $5 AND orders.ordered_at < $6))
                 WHERE products.business_id = $1 AND products.active = TRUE
                 GROUP BY products.id
                 ORDER BY revenue_minor DESC, units_sold DESC, products.name ASC`, [businessId, business.currency, current.from, current.to, previous.from, previous.to]),
            () => client.query(
                `SELECT COALESCE(products.category_name, 'Uncategorized') AS category_name,
                        COUNT(DISTINCT products.id)::INTEGER AS products,
                        COALESCE(SUM(items.quantity) FILTER (WHERE orders.id IS NOT NULL), 0)::NUMERIC AS units_sold,
                        COALESCE(SUM(${NET_ITEM_REVENUE_SQL}) FILTER (WHERE orders.id IS NOT NULL), 0)::BIGINT AS revenue_minor,
                        SUM(${NET_ITEM_REVENUE_SQL} - products.cost_minor * items.quantity)
                            FILTER (WHERE orders.id IS NOT NULL AND products.cost_minor IS NOT NULL AND items.total_amount_minor IS NOT NULL)::BIGINT AS profit_minor,
                        COUNT(DISTINCT orders.id)::INTEGER AS orders
                 FROM business_products products
                 LEFT JOIN business_order_items items ON items.product_id = products.id
                 LEFT JOIN business_orders orders ON orders.id = items.order_id
                    AND orders.business_id = $1 AND orders.currency = $2
                    AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                    AND orders.ordered_at >= $3 AND orders.ordered_at < $4
                 WHERE products.business_id = $1 AND products.active = TRUE
                 GROUP BY COALESCE(products.category_name, 'Uncategorized')
                 ORDER BY revenue_minor DESC, category_name ASC`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `WITH customer_orders AS (
                    SELECT customer_id, COUNT(*)::INTEGER AS order_count,
                           SUM(GREATEST(total_amount_minor - refunded_amount_minor, 0))::BIGINT AS lifetime_revenue_minor,
                           MIN(ordered_at) AS first_order_at, MAX(ordered_at) AS last_order_at
                    FROM business_orders
                    WHERE business_id = $1 AND currency = $2
                      AND status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND customer_id IS NOT NULL
                    GROUP BY customer_id
                 )
                 SELECT COUNT(*)::INTEGER AS total_customers,
                        COUNT(customer_orders.customer_id)::INTEGER AS purchasing_customers,
                        COUNT(*) FILTER (WHERE customer_orders.order_count >= 2)::INTEGER AS repeat_customers,
                        COALESCE(SUM(customer_orders.lifetime_revenue_minor), 0)::BIGINT AS customer_lifetime_revenue_minor,
                        AVG(customer_orders.lifetime_revenue_minor)::NUMERIC AS average_customer_lifetime_value_minor,
                        COUNT(*) FILTER (WHERE customers.first_seen_at >= $3 AND customers.first_seen_at < $4)::INTEGER AS new_customer_records,
                        COUNT(*) FILTER (WHERE customers.last_activity_at >= $3 AND customers.last_activity_at < $4)::INTEGER AS active_customer_records
                 FROM business_customers customers
                 LEFT JOIN customer_orders ON customer_orders.customer_id = customers.id
                 WHERE customers.business_id = $1`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `WITH customer_orders AS (
                    SELECT customers.id,
                           COUNT(orders.id)::INTEGER AS orders,
                           COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor,
                           MIN(orders.ordered_at) AS first_order_at,
                           MAX(orders.ordered_at) AS last_order_at
                    FROM business_customers customers
                    LEFT JOIN business_orders orders ON orders.customer_id = customers.id
                      AND orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                    WHERE customers.business_id = $1
                    GROUP BY customers.id
                 )
                 SELECT CASE
                            WHEN orders = 0 THEN 'prospect'
                            WHEN orders = 1 AND first_order_at >= $3 AND first_order_at < $4 THEN 'new-buyer'
                            WHEN orders = 1 THEN 'one-time-buyer'
                            WHEN last_order_at < $3 - INTERVAL '90 days' THEN 'at-risk'
                            WHEN orders >= 4 THEN 'loyal'
                            ELSE 'repeat-buyer'
                        END AS segment,
                        COUNT(*)::INTEGER AS customers,
                        COALESCE(SUM(revenue_minor), 0)::BIGINT AS revenue_minor,
                        AVG(revenue_minor)::NUMERIC AS average_lifetime_value_minor
                 FROM customer_orders
                 GROUP BY segment
                 ORDER BY revenue_minor DESC, segment ASC`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `SELECT campaign_name, source_name,
                        COALESCE(SUM(spend_minor), 0)::BIGINT AS spend_minor,
                        COALESCE(SUM(attributed_revenue_minor), 0)::BIGINT AS attributed_revenue_minor,
                        COALESCE(SUM(impressions), 0)::BIGINT AS impressions,
                        COALESCE(SUM(clicks), 0)::BIGINT AS clicks,
                        COALESCE(SUM(visitors), 0)::BIGINT AS visitors,
                        COALESCE(SUM(leads), 0)::BIGINT AS leads,
                        COALESCE(SUM(conversions), 0)::BIGINT AS conversions,
                        MAX(retrieved_at) AS retrieved_at
                 FROM business_campaign_daily_metrics
                 WHERE business_id = $1 AND currency = $2
                   AND metric_date >= $3::DATE AND metric_date < $4::DATE
                 GROUP BY campaign_name, source_name
                 ORDER BY attributed_revenue_minor DESC, campaign_name ASC`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `SELECT source_name, medium_name,
                        COALESCE(SUM(sessions), 0)::BIGINT AS sessions,
                        COALESCE(SUM(users), 0)::BIGINT AS users,
                        COALESCE(SUM(new_users), 0)::BIGINT AS new_users,
                        COALESCE(SUM(product_views), 0)::BIGINT AS product_views,
                        COALESCE(SUM(add_to_carts), 0)::BIGINT AS add_to_carts,
                        COALESCE(SUM(checkout_starts), 0)::BIGINT AS checkout_starts,
                        COALESCE(SUM(purchases), 0)::BIGINT AS purchases,
                        COALESCE(SUM(revenue_minor), 0)::BIGINT AS revenue_minor,
                        MAX(retrieved_at) AS retrieved_at
                 FROM business_traffic_daily_metrics
                 WHERE business_id = $1
                   AND metric_date >= $2::DATE AND metric_date < $3::DATE
                 GROUP BY source_name, medium_name
                 ORDER BY sessions DESC, source_name ASC`, [businessId, current.from, current.to]),
            () => client.query(
                `SELECT COUNT(*)::INTEGER AS carts,
                        COUNT(*) FILTER (WHERE status = 'abandoned')::INTEGER AS abandoned_carts,
                        COUNT(*) FILTER (WHERE status IN ('converted', 'recovered'))::INTEGER AS converted_carts,
                        COALESCE(SUM(cart_value_minor) FILTER (WHERE status = 'abandoned'), 0)::BIGINT AS abandoned_value_minor,
                        COALESCE(SUM(cart_value_minor) FILTER (WHERE status = 'recovered'), 0)::BIGINT AS recovered_value_minor
                 FROM business_cart_sessions
                 WHERE business_id = $1 AND currency = $2
                   AND started_at >= $3 AND started_at < $4`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `SELECT COALESCE(shipping_country_code, 'Unknown') AS country_code,
                        COUNT(*)::INTEGER AS orders,
                        COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL)::INTEGER AS customers,
                        COALESCE(SUM(GREATEST(total_amount_minor - refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor
                 FROM business_orders
                 WHERE business_id = $1 AND currency = $2
                   AND status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND ordered_at >= $3 AND ordered_at < $4
                 GROUP BY COALESCE(shipping_country_code, 'Unknown')
                 ORDER BY revenue_minor DESC, country_code ASC`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `SELECT COALESCE(orders.coupon_code, 'No coupon') AS coupon_code,
                        COUNT(*)::INTEGER AS orders,
                        COUNT(DISTINCT orders.customer_id) FILTER (WHERE orders.customer_id IS NOT NULL)::INTEGER AS customers,
                        COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor
                 FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.currency = $2
                   AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND orders.ordered_at >= $3 AND orders.ordered_at < $4
                 GROUP BY COALESCE(orders.coupon_code, 'No coupon')
                 ORDER BY revenue_minor DESC, coupon_code ASC`, [businessId, business.currency, current.from, current.to]),
            () => client.query(
                `SELECT products.id AS product_id, products.name AS product_name, products.sku,
                        products.category_name, products.current_stock, products.lead_time_days,
                        products.reorder_buffer_days,
                        COALESCE(SUM(items.quantity) FILTER (WHERE orders.id IS NOT NULL), 0)::NUMERIC AS units_sold,
                        COUNT(DISTINCT orders.id)::INTEGER AS order_records
                 FROM business_products products
                 LEFT JOIN business_order_items items ON items.product_id = products.id
                 LEFT JOIN business_orders orders ON orders.id = items.order_id
                    AND orders.business_id = $1
                    AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                    AND orders.ordered_at >= $2 AND orders.ordered_at < $3
                 WHERE products.business_id = $1 AND products.active = TRUE
                 GROUP BY products.id
                 ORDER BY products.current_stock ASC NULLS LAST, products.name ASC`, [businessId, current.from, current.to]),
            () => client.query(
                `SELECT
                    (SELECT COUNT(*) FROM business_orders WHERE business_id = $1 AND ordered_at >= $2 AND ordered_at < $3)::INTEGER AS order_records,
                    (SELECT COUNT(*) FROM business_order_items items INNER JOIN business_orders orders ON orders.id = items.order_id WHERE orders.business_id = $1 AND orders.ordered_at >= $2 AND orders.ordered_at < $3)::INTEGER AS order_item_records,
                    (SELECT COUNT(*) FROM business_customers WHERE business_id = $1)::INTEGER AS customer_records,
                    (SELECT COUNT(*) FROM business_products WHERE business_id = $1 AND active = TRUE)::INTEGER AS product_records,
                    (SELECT COUNT(*) FROM business_campaign_daily_metrics WHERE business_id = $1 AND metric_date >= $2::DATE AND metric_date < $3::DATE)::INTEGER AS campaign_records,
                    (SELECT COUNT(*) FROM business_traffic_daily_metrics WHERE business_id = $1 AND metric_date >= $2::DATE AND metric_date < $3::DATE)::INTEGER AS traffic_records,
                    (SELECT COUNT(*) FROM business_cart_sessions WHERE business_id = $1 AND started_at >= $2 AND started_at < $3)::INTEGER AS cart_records,
                    (SELECT COUNT(*) FROM business_competitors WHERE business_id = $1 AND active = TRUE)::INTEGER AS competitor_records,
                    (SELECT MAX(updated_at) FROM business_orders WHERE business_id = $1) AS orders_updated_at,
                    (SELECT MAX(updated_at) FROM business_products WHERE business_id = $1) AS products_updated_at,
                    (SELECT MAX(updated_at) FROM business_customers WHERE business_id = $1) AS customers_updated_at,
                    (SELECT MAX(retrieved_at) FROM business_campaign_daily_metrics WHERE business_id = $1) AS campaigns_updated_at,
                    (SELECT MAX(retrieved_at) FROM business_traffic_daily_metrics WHERE business_id = $1) AS traffic_updated_at`, [businessId, current.from, current.to])
        ]);
        return {
            business,
            retrievedAt: new Date().toISOString(),
            periods,
            summary: summaryResult.rows,
            standardComparisons: standardComparisonResult.rows,
            daily: dailyResult.rows,
            products: productResult.rows,
            categories: categoryResult.rows,
            customers: customerResult.rows[0] || {},
            customerSegments: segmentResult.rows,
            campaigns: campaignResult.rows,
            trafficSources: trafficResult.rows,
            carts: cartResult.rows[0] || {},
            geography: geographyResult.rows,
            coupons: couponResult.rows,
            inventory: inventoryResult.rows,
            freshness: freshnessResult.rows[0] || {}
        };
    } finally {
        client.release();
    }
}

async function getEnterpriseAnalyticsData(pool, { userId, businessId, periods, filters = {} }) {
    const client = await pool.connect();
    try {
        const business = await assertBusinessAccess(client, userId, businessId);
        const current = periods.current;
        const previous = periods.previous;
        const yearAgo = periods.yearAgo;
        const channel = String(filters.channel || '').trim() || null;
        const location = String(filters.location || '').trim().toUpperCase() || null;
        const businessHours = ['business-hours', 'after-hours'].includes(filters.businessHours) ? filters.businessHours : 'all';
        const values = [businessId, business.currency, current.from, current.to, previous.from, previous.to, yearAgo.from, yearAgo.to, business.timezone || 'UTC', channel, location, businessHours];
        const filterSql = enterpriseOrderFilterSql('orders');
        const currentFilterSql = enterprisePeriodFilterSql('orders', 3, 4);
        const previousFilterSql = enterprisePeriodFilterSql('orders', 5, 6);

        const [
            summaryResult,
            dailyResult,
            previousDailyResult,
            hourlyResult,
            weekdayResult,
            refundResult,
            channelPerformanceResult,
            customerAnalyticsResult,
            customerTimelineResult,
            cohortResult,
            productPerformanceResult,
            categoryPerformanceResult,
            cashFlowResult,
            filterChannelsResult,
            filterLocationsResult,
            dataQualityResult,
            demoStateResult
        ] = await runClientQueriesSequentially([
            () => queryWithCompactedParameters(client,
                `WITH periods(period_key, from_at, to_at) AS (
                    VALUES ('current', $3::TIMESTAMPTZ, $4::TIMESTAMPTZ),
                           ('previous', $5::TIMESTAMPTZ, $6::TIMESTAMPTZ),
                           ('year_ago', $7::TIMESTAMPTZ, $8::TIMESTAMPTZ)
                 ),
                 first_orders AS (
                    SELECT customer_id, MIN(ordered_at) AS first_order_at
                    FROM business_orders
                    WHERE business_id = $1 AND currency = $2
                      AND status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND customer_id IS NOT NULL
                    GROUP BY customer_id
                 ),
                 filtered_orders AS (
                    SELECT orders.*, first_orders.first_order_at
                    FROM business_orders orders
                    LEFT JOIN first_orders ON first_orders.customer_id = orders.customer_id
                    WHERE orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND orders.ordered_at >= LEAST($3::TIMESTAMPTZ, $5::TIMESTAMPTZ, $7::TIMESTAMPTZ)
                      AND orders.ordered_at < GREATEST($4::TIMESTAMPTZ, $6::TIMESTAMPTZ, $8::TIMESTAMPTZ)
                      ${filterSql}
                 ),
                 order_rollup AS (
                    SELECT periods.period_key,
                           COUNT(orders.id)::INTEGER AS orders,
                           COALESCE(SUM(orders.total_amount_minor), 0)::BIGINT AS gross_revenue_minor,
                           COALESCE(SUM(orders.refunded_amount_minor), 0)::BIGINT AS refunds_minor,
                           COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor,
                           COUNT(DISTINCT orders.customer_id) FILTER (WHERE orders.customer_id IS NOT NULL)::INTEGER AS purchasing_customers,
                           COUNT(DISTINCT orders.customer_id) FILTER (WHERE orders.customer_id IS NOT NULL AND orders.first_order_at >= periods.from_at)::INTEGER AS new_customers,
                           COUNT(DISTINCT orders.customer_id) FILTER (WHERE orders.customer_id IS NOT NULL AND orders.first_order_at < periods.from_at)::INTEGER AS returning_customers
                    FROM periods
                    LEFT JOIN filtered_orders orders ON orders.ordered_at >= periods.from_at AND orders.ordered_at < periods.to_at
                    GROUP BY periods.period_key
                 ),
                 item_rollup AS (
                    SELECT periods.period_key,
                           COALESCE(SUM(items.quantity), 0)::NUMERIC AS units,
                           CASE WHEN COUNT(items.id) FILTER (WHERE products.cost_minor IS NOT NULL) > 0
                                THEN COALESCE(SUM((${NET_ITEM_REVENUE_SQL}) - ROUND(products.cost_minor::NUMERIC * items.quantity)::BIGINT) FILTER (WHERE products.cost_minor IS NOT NULL), 0)::BIGINT
                                ELSE NULL END AS profit_minor
                    FROM periods
                    LEFT JOIN filtered_orders orders ON orders.ordered_at >= periods.from_at AND orders.ordered_at < periods.to_at
                    LEFT JOIN business_order_items items ON items.order_id = orders.id
                    LEFT JOIN business_products products ON products.id = items.product_id
                    GROUP BY periods.period_key
                 )
                 SELECT order_rollup.*, item_rollup.units, item_rollup.profit_minor
                 FROM order_rollup
                 INNER JOIN item_rollup USING (period_key)
                 ORDER BY CASE order_rollup.period_key WHEN 'current' THEN 0 WHEN 'previous' THEN 1 ELSE 2 END`,
                values
            ),
            () => queryWithCompactedParameters(client, enterpriseDailyQuery(3, 4, filterSql), values),
            () => queryWithCompactedParameters(client, enterpriseDailyQuery(5, 6, filterSql), values),
            () => queryWithCompactedParameters(client,
                `SELECT EXTRACT(DOW FROM orders.ordered_at AT TIME ZONE $9)::INTEGER AS weekday,
                        EXTRACT(HOUR FROM orders.ordered_at AT TIME ZONE $9)::INTEGER AS hour,
                        COUNT(*)::INTEGER AS orders,
                        COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor
                 FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.currency = $2
                   AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND ${currentFilterSql}
                   ${filterSql}
                 GROUP BY weekday, hour
                 ORDER BY weekday, hour`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `SELECT EXTRACT(DOW FROM orders.ordered_at AT TIME ZONE $9)::INTEGER AS weekday,
                        COUNT(*)::INTEGER AS orders,
                        COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor,
                        AVG(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0))::NUMERIC AS average_order_value_minor
                 FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.currency = $2
                   AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND ${currentFilterSql}
                   ${filterSql}
                 GROUP BY weekday
                 ORDER BY weekday`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `SELECT
                    COUNT(*) FILTER (WHERE ${currentFilterSql})::INTEGER AS orders,
                    COUNT(*) FILTER (WHERE ${currentFilterSql} AND orders.refunded_amount_minor > 0)::INTEGER AS refunded_orders,
                    COALESCE(SUM(orders.total_amount_minor) FILTER (WHERE ${currentFilterSql}), 0)::BIGINT AS gross_revenue_minor,
                    COALESCE(SUM(orders.refunded_amount_minor) FILTER (WHERE ${currentFilterSql}), 0)::BIGINT AS refunded_amount_minor,
                    COALESCE(SUM(orders.total_amount_minor) FILTER (WHERE ${previousFilterSql}), 0)::BIGINT AS previous_gross_revenue_minor,
                    COALESCE(SUM(orders.refunded_amount_minor) FILTER (WHERE ${previousFilterSql}), 0)::BIGINT AS previous_refunded_amount_minor
                 FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.currency = $2
                   AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND orders.ordered_at >= LEAST($3::TIMESTAMPTZ, $5::TIMESTAMPTZ)
                   AND orders.ordered_at < GREATEST($4::TIMESTAMPTZ, $6::TIMESTAMPTZ)
                   ${filterSql}`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `WITH scoped AS (
                    SELECT COALESCE(orders.source_name, 'Unattributed') AS channel,
                           orders.id, orders.customer_id, orders.total_amount_minor, orders.refunded_amount_minor
                    FROM business_orders orders
                    WHERE orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND ${currentFilterSql}
                      AND ($11::TEXT IS NULL OR COALESCE(orders.shipping_country_code, 'Unknown') = $11)
                      AND ${enterpriseBusinessHoursSql('orders')}
                 ), totals AS (SELECT COUNT(*)::NUMERIC AS orders FROM scoped)
                 SELECT scoped.channel,
                        COUNT(*)::INTEGER AS orders,
                        COUNT(DISTINCT scoped.customer_id) FILTER (WHERE scoped.customer_id IS NOT NULL)::INTEGER AS customers,
                        COALESCE(SUM(GREATEST(scoped.total_amount_minor - scoped.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor,
                        COALESCE(SUM(scoped.refunded_amount_minor), 0)::BIGINT AS refunds_minor,
                        CASE WHEN totals.orders > 0 THEN ROUND(COUNT(*)::NUMERIC * 100 / totals.orders, 4) ELSE NULL END AS share_percentage
                 FROM scoped CROSS JOIN totals
                 GROUP BY scoped.channel, totals.orders
                 ORDER BY revenue_minor DESC, scoped.channel ASC`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `WITH valid_orders AS (
                    SELECT orders.*
                    FROM business_orders orders
                    WHERE orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND orders.ordered_at < $4
                      ${filterSql}
                 ), customer_rollup AS (
                    SELECT customer_id,
                           COUNT(*)::INTEGER AS order_count,
                           COALESCE(SUM(GREATEST(total_amount_minor - refunded_amount_minor, 0)), 0)::BIGINT AS lifetime_value_minor,
                           MIN(ordered_at) AS first_order_at,
                           MAX(ordered_at) AS last_order_at,
                           BOOL_OR(ordered_at >= $3 AND ordered_at < $4) AS ordered_current,
                           BOOL_OR(ordered_at >= $5 AND ordered_at < $6) AS ordered_previous
                    FROM valid_orders
                    WHERE customer_id IS NOT NULL
                    GROUP BY customer_id
                 )
                 SELECT COUNT(*) FILTER (WHERE ordered_current)::INTEGER AS purchasing_customers,
                        COUNT(*) FILTER (WHERE order_count >= 2)::INTEGER AS repeat_customers,
                        AVG(lifetime_value_minor)::NUMERIC AS average_lifetime_value_minor,
                        COUNT(*) FILTER (WHERE ordered_previous)::INTEGER AS eligible_previous_customers,
                        COUNT(*) FILTER (WHERE ordered_previous AND ordered_current)::INTEGER AS retained_customers,
                        COUNT(*) FILTER (WHERE NOT ordered_current AND last_order_at < $3 - INTERVAL '90 days')::INTEGER AS churn_risk_customers
                 FROM customer_rollup`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `WITH first_orders AS (
                    SELECT customer_id, MIN(ordered_at) AS first_order_at
                    FROM business_orders
                    WHERE business_id = $1 AND currency = $2
                      AND status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND customer_id IS NOT NULL
                    GROUP BY customer_id
                 )
                 SELECT DATE(orders.ordered_at AT TIME ZONE $9) AS day,
                        COUNT(DISTINCT orders.customer_id) FILTER (WHERE first_orders.first_order_at >= $3)::INTEGER AS new_customers,
                        COUNT(DISTINCT orders.customer_id) FILTER (WHERE first_orders.first_order_at < $3)::INTEGER AS returning_customers,
                        COUNT(DISTINCT orders.customer_id)::INTEGER AS purchasing_customers
                 FROM business_orders orders
                 INNER JOIN first_orders ON first_orders.customer_id = orders.customer_id
                 WHERE orders.business_id = $1 AND orders.currency = $2
                   AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND ${currentFilterSql}
                   ${filterSql}
                 GROUP BY day
                 ORDER BY day`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `WITH valid_orders AS (
                    SELECT orders.customer_id,
                           DATE_TRUNC('month', orders.ordered_at AT TIME ZONE $9)::DATE AS purchase_month
                    FROM business_orders orders
                    WHERE orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND orders.customer_id IS NOT NULL
                      AND orders.ordered_at >= $3::TIMESTAMPTZ - INTERVAL '12 months'
                      AND orders.ordered_at < $4
                      ${filterSql}
                 ), first_purchase AS (
                    SELECT customer_id, MIN(purchase_month) AS cohort_month
                    FROM valid_orders GROUP BY customer_id
                 ), activity AS (
                    SELECT valid_orders.customer_id, first_purchase.cohort_month, valid_orders.purchase_month,
                           ((EXTRACT(YEAR FROM valid_orders.purchase_month) - EXTRACT(YEAR FROM first_purchase.cohort_month)) * 12
                            + EXTRACT(MONTH FROM valid_orders.purchase_month) - EXTRACT(MONTH FROM first_purchase.cohort_month))::INTEGER AS month_number
                    FROM valid_orders INNER JOIN first_purchase USING (customer_id)
                 )
                 SELECT cohort_month,
                        COUNT(DISTINCT customer_id)::INTEGER AS customers,
                        COUNT(DISTINCT customer_id) FILTER (WHERE month_number = 0)::INTEGER AS month_0,
                        COUNT(DISTINCT customer_id) FILTER (WHERE month_number = 1)::INTEGER AS month_1,
                        COUNT(DISTINCT customer_id) FILTER (WHERE month_number = 2)::INTEGER AS month_2,
                        COUNT(DISTINCT customer_id) FILTER (WHERE month_number = 3)::INTEGER AS month_3,
                        COUNT(DISTINCT customer_id) FILTER (WHERE month_number = 4)::INTEGER AS month_4,
                        COUNT(DISTINCT customer_id) FILTER (WHERE month_number = 5)::INTEGER AS month_5
                 FROM activity
                 GROUP BY cohort_month
                 ORDER BY cohort_month DESC
                 LIMIT 12`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `WITH scoped AS (
                    SELECT products.id AS product_id, products.name AS product_name, products.category_name,
                           products.current_stock, products.cost_minor,
                           orders.id AS order_id, orders.ordered_at,
                           orders.total_amount_minor AS order_total_amount_minor,
                           orders.refunded_amount_minor,
                           items.quantity,
                           items.total_amount_minor AS item_total_amount_minor
                    FROM business_products products
                    LEFT JOIN business_order_items items ON items.product_id = products.id
                    LEFT JOIN business_orders orders ON orders.id = items.order_id
                       AND orders.business_id = $1 AND orders.currency = $2
                       AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                       AND orders.ordered_at >= LEAST($3::TIMESTAMPTZ, $5::TIMESTAMPTZ)
                       AND orders.ordered_at < GREATEST($4::TIMESTAMPTZ, $6::TIMESTAMPTZ)
                       ${filterSql}
                    WHERE products.business_id = $1 AND products.active = TRUE
                 ), valued AS (
                    SELECT scoped.*,
                           CASE WHEN order_total_amount_minor > 0 AND item_total_amount_minor IS NOT NULL
                                THEN ROUND(item_total_amount_minor::NUMERIC * GREATEST(order_total_amount_minor - refunded_amount_minor, 0)::NUMERIC / order_total_amount_minor::NUMERIC)::BIGINT
                                ELSE 0::BIGINT END AS net_item_revenue_minor
                    FROM scoped
                 )
                 SELECT product_id, product_name, category_name, current_stock,
                        COALESCE(SUM(quantity) FILTER (WHERE ordered_at >= $3 AND ordered_at < $4), 0)::NUMERIC AS units_sold,
                        COALESCE(SUM(net_item_revenue_minor) FILTER (WHERE ordered_at >= $3 AND ordered_at < $4), 0)::BIGINT AS revenue_minor,
                        COALESCE(SUM(quantity) FILTER (WHERE ordered_at >= $5 AND ordered_at < $6), 0)::NUMERIC AS previous_units_sold,
                        COALESCE(SUM(net_item_revenue_minor) FILTER (WHERE ordered_at >= $5 AND ordered_at < $6), 0)::BIGINT AS previous_revenue_minor,
                        COUNT(DISTINCT order_id) FILTER (WHERE ordered_at >= $3 AND ordered_at < $4)::INTEGER AS order_count,
                        CASE WHEN COUNT(order_id) FILTER (WHERE ordered_at >= $3 AND ordered_at < $4 AND cost_minor IS NOT NULL) > 0
                             THEN COALESCE(SUM((net_item_revenue_minor - ROUND(cost_minor::NUMERIC * quantity)::BIGINT)) FILTER (WHERE ordered_at >= $3 AND ordered_at < $4 AND cost_minor IS NOT NULL), 0)::BIGINT
                             ELSE NULL END AS profit_minor
                 FROM valued
                 GROUP BY product_id, product_name, category_name, current_stock
                 ORDER BY revenue_minor DESC, product_name ASC`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `SELECT COALESCE(products.category_name, 'Uncategorized') AS category_name,
                        COUNT(DISTINCT products.id)::INTEGER AS products,
                        COALESCE(SUM(items.quantity), 0)::NUMERIC AS units_sold,
                        COUNT(DISTINCT orders.id)::INTEGER AS orders,
                        COALESCE(SUM(${NET_ITEM_REVENUE_SQL}), 0)::BIGINT AS revenue_minor,
                        CASE WHEN COUNT(items.id) FILTER (WHERE products.cost_minor IS NOT NULL) > 0
                             THEN COALESCE(SUM((${NET_ITEM_REVENUE_SQL}) - ROUND(products.cost_minor::NUMERIC * items.quantity)::BIGINT) FILTER (WHERE products.cost_minor IS NOT NULL), 0)::BIGINT
                             ELSE NULL END AS profit_minor
                 FROM business_products products
                 LEFT JOIN business_order_items items ON items.product_id = products.id
                 LEFT JOIN business_orders orders ON orders.id = items.order_id
                    AND orders.business_id = $1 AND orders.currency = $2
                    AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                    AND ${currentFilterSql}
                    ${filterSql}
                 WHERE products.business_id = $1 AND products.active = TRUE
                 GROUP BY COALESCE(products.category_name, 'Uncategorized')
                 ORDER BY revenue_minor DESC, category_name ASC`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `WITH days AS (
                    SELECT generate_series(
                        (($3::TIMESTAMPTZ AT TIME ZONE $9)::DATE),
                        ((($4::TIMESTAMPTZ - INTERVAL '1 microsecond') AT TIME ZONE $9)::DATE),
                        INTERVAL '1 day'
                    )::DATE AS day
                 ), order_daily AS (
                    SELECT DATE(orders.ordered_at AT TIME ZONE $9) AS day,
                           COALESCE(SUM(orders.total_amount_minor), 0)::BIGINT AS gross_revenue_minor,
                           COALESCE(SUM(orders.refunded_amount_minor), 0)::BIGINT AS refunds_minor,
                           COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS net_revenue_minor
                    FROM business_orders orders
                    WHERE orders.business_id = $1 AND orders.currency = $2
                      AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                      AND ${currentFilterSql}
                      ${filterSql}
                    GROUP BY day
                 ), campaign_daily AS (
                    SELECT metric_date AS day, COALESCE(SUM(spend_minor), 0)::BIGINT AS campaign_spend_minor
                    FROM business_campaign_daily_metrics
                    WHERE business_id = $1 AND currency = $2
                      AND metric_date >= (($3::TIMESTAMPTZ AT TIME ZONE $9)::DATE)
                      AND metric_date <= ((($4::TIMESTAMPTZ - INTERVAL '1 microsecond') AT TIME ZONE $9)::DATE)
                      AND ($10::TEXT IS NULL OR COALESCE(source_name, 'Unattributed') = $10)
                    GROUP BY metric_date
                 )
                 SELECT days.day,
                        COALESCE(order_daily.gross_revenue_minor, 0)::BIGINT AS gross_revenue_minor,
                        COALESCE(order_daily.refunds_minor, 0)::BIGINT AS refunds_minor,
                        COALESCE(order_daily.net_revenue_minor, 0)::BIGINT AS net_revenue_minor,
                        COALESCE(campaign_daily.campaign_spend_minor, 0)::BIGINT AS campaign_spend_minor,
                        NULL::BIGINT AS estimated_profit_minor
                 FROM days
                 LEFT JOIN order_daily USING (day)
                 LEFT JOIN campaign_daily USING (day)
                 ORDER BY days.day`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `SELECT COALESCE(orders.source_name, 'Unattributed') AS value,
                        COALESCE(orders.source_name, 'Unattributed') AS label,
                        COUNT(*)::INTEGER AS records
                 FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND orders.ordered_at >= $3 AND orders.ordered_at < $4
                 GROUP BY COALESCE(orders.source_name, 'Unattributed')
                 ORDER BY records DESC, label ASC`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `SELECT COALESCE(orders.shipping_country_code, 'Unknown') AS value,
                        COALESCE(orders.shipping_country_code, 'Unknown') AS label,
                        COUNT(*)::INTEGER AS records
                 FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                   AND orders.ordered_at >= $3 AND orders.ordered_at < $4
                 GROUP BY COALESCE(orders.shipping_country_code, 'Unknown')
                 ORDER BY records DESC, label ASC`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `SELECT
                    COUNT(*) FILTER (WHERE orders.ordered_at >= $3 AND orders.ordered_at < $4)::INTEGER AS total_order_records,
                    COUNT(*) FILTER (WHERE orders.ordered_at >= $3 AND orders.ordered_at < $4 ${filterSql})::INTEGER AS filtered_order_records
                 FROM business_orders orders
                 WHERE orders.business_id = $1 AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})`,
                values
            ),
            () => queryWithCompactedParameters(client,
                `SELECT
                    COUNT(*) FILTER (WHERE metadata->>'orexis_demo' = 'orexis-analytics-v1')::INTEGER AS demo_order_records,
                    COUNT(*) FILTER (WHERE COALESCE(metadata->>'orexis_demo', '') <> 'orexis-analytics-v1')::INTEGER AS real_order_records,
                    MAX(metadata->>'orexis_demo') FILTER (WHERE metadata ? 'orexis_demo') AS dataset_version
                 FROM business_orders
                 WHERE business_id = $1`,
                [businessId]
            )
        ]);

        return {
            business,
            periods,
            filters: { channel: channel || '', location: location || '', businessHours },
            summary: summaryResult.rows,
            daily: dailyResult.rows,
            previousDaily: previousDailyResult.rows,
            hourly: hourlyResult.rows,
            weekday: weekdayResult.rows,
            refunds: refundResult.rows[0] || {},
            channelPerformance: channelPerformanceResult.rows,
            customerAnalytics: customerAnalyticsResult.rows[0] || {},
            customerTimeline: customerTimelineResult.rows,
            cohorts: cohortResult.rows,
            productPerformance: productPerformanceResult.rows,
            categoryPerformance: categoryPerformanceResult.rows,
            cashFlowDaily: cashFlowResult.rows,
            filterOptions: { channels: filterChannelsResult.rows, locations: filterLocationsResult.rows },
            dataQuality: dataQualityResult.rows[0] || {},
            demoState: demoStateResult.rows[0] || {}
        };
    } finally {
        client.release();
    }
}

async function runClientQueriesSequentially(queries) {
    const results = [];
    for (const query of queries) {
        results.push(await query());
    }
    return results;
}

function queryWithCompactedParameters(client, text, values) {
    const compacted = compactPostgresParameters(text, values);
    return client.query(compacted.text, compacted.values);
}

function compactPostgresParameters(text, values) {
    const parameterIndexes = [...new Set(
        [...String(text).matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))
    )].sort((left, right) => left - right);

    for (const index of parameterIndexes) {
        if (!Number.isSafeInteger(index) || index < 1 || index > values.length) {
            throw new RangeError(`PostgreSQL query references missing parameter $${index}.`);
        }
    }

    const remappedIndexes = new Map(parameterIndexes.map((index, offset) => [index, offset + 1]));
    return {
        text: String(text).replace(/\$(\d+)/g, (placeholder, rawIndex) => {
            const remapped = remappedIndexes.get(Number(rawIndex));
            return remapped ? `$${remapped}` : placeholder;
        }),
        values: parameterIndexes.map((index) => values[index - 1])
    };
}

function enterpriseDailyQuery(fromParameter, toParameter, filterSql) {
    const from = `$${fromParameter}`;
    const to = `$${toParameter}`;
    return `WITH days AS (
                SELECT generate_series(
                    ((${from}::TIMESTAMPTZ AT TIME ZONE $9)::DATE),
                    (((${to}::TIMESTAMPTZ - INTERVAL '1 microsecond') AT TIME ZONE $9)::DATE),
                    INTERVAL '1 day'
                )::DATE AS day
             ), scoped_orders AS (
                SELECT orders.*
                FROM business_orders orders
                WHERE orders.business_id = $1 AND orders.currency = $2
                  AND orders.status IN (${VALID_BUSINESS_ORDER_STATUSES_SQL})
                  AND orders.ordered_at >= ${from} AND orders.ordered_at < ${to}
                  ${filterSql}
             ), order_daily AS (
                SELECT DATE(orders.ordered_at AT TIME ZONE $9) AS day,
                       COUNT(*)::INTEGER AS orders,
                       COUNT(DISTINCT orders.customer_id) FILTER (WHERE orders.customer_id IS NOT NULL)::INTEGER AS customers,
                       COALESCE(SUM(orders.total_amount_minor), 0)::BIGINT AS gross_revenue_minor,
                       COALESCE(SUM(orders.refunded_amount_minor), 0)::BIGINT AS refunds_minor,
                       COALESCE(SUM(GREATEST(orders.total_amount_minor - orders.refunded_amount_minor, 0)), 0)::BIGINT AS revenue_minor
                FROM scoped_orders orders
                GROUP BY day
             ), item_daily AS (
                SELECT DATE(orders.ordered_at AT TIME ZONE $9) AS day,
                       COALESCE(SUM(items.quantity), 0)::NUMERIC AS units,
                       CASE WHEN COUNT(items.id) FILTER (WHERE products.cost_minor IS NOT NULL) > 0
                            THEN COALESCE(SUM((${NET_ITEM_REVENUE_SQL}) - ROUND(products.cost_minor::NUMERIC * items.quantity)::BIGINT) FILTER (WHERE products.cost_minor IS NOT NULL), 0)::BIGINT
                            ELSE NULL END AS profit_minor
                FROM scoped_orders orders
                LEFT JOIN business_order_items items ON items.order_id = orders.id
                LEFT JOIN business_products products ON products.id = items.product_id
                GROUP BY day
             )
             SELECT days.day,
                    COALESCE(order_daily.orders, 0)::INTEGER AS orders,
                    COALESCE(order_daily.customers, 0)::INTEGER AS customers,
                    COALESCE(item_daily.units, 0)::NUMERIC AS units,
                    COALESCE(order_daily.gross_revenue_minor, 0)::BIGINT AS gross_revenue_minor,
                    COALESCE(order_daily.refunds_minor, 0)::BIGINT AS refunds_minor,
                    COALESCE(order_daily.revenue_minor, 0)::BIGINT AS revenue_minor,
                    item_daily.profit_minor
             FROM days
             LEFT JOIN order_daily USING (day)
             LEFT JOIN item_daily USING (day)
             ORDER BY days.day`;
}

function enterpriseOrderFilterSql(alias) {
    return `AND ($10::TEXT IS NULL OR COALESCE(${alias}.source_name, 'Unattributed') = $10)
            AND ($11::TEXT IS NULL OR COALESCE(${alias}.shipping_country_code, 'Unknown') = $11)
            AND ${enterpriseBusinessHoursSql(alias)}`;
}

function enterpriseBusinessHoursSql(alias) {
    return `(
        $12::TEXT = 'all'
        OR ($12::TEXT = 'business-hours'
            AND EXTRACT(ISODOW FROM ${alias}.ordered_at AT TIME ZONE $9) BETWEEN 1 AND 5
            AND EXTRACT(HOUR FROM ${alias}.ordered_at AT TIME ZONE $9) BETWEEN 9 AND 17)
        OR ($12::TEXT = 'after-hours'
            AND NOT (
                EXTRACT(ISODOW FROM ${alias}.ordered_at AT TIME ZONE $9) BETWEEN 1 AND 5
                AND EXTRACT(HOUR FROM ${alias}.ordered_at AT TIME ZONE $9) BETWEEN 9 AND 17
            ))
    )`;
}

function enterprisePeriodFilterSql(alias, fromParameter, toParameter) {
    return `${alias}.ordered_at >= $${fromParameter}::TIMESTAMPTZ AND ${alias}.ordered_at < $${toParameter}::TIMESTAMPTZ`;
}

async function getAnalyticsDatasetState(pool, { userId, businessId }) {
    const client = await pool.connect();
    try {
        await assertBusinessAccess(client, userId, businessId);
        const result = await client.query(
            `SELECT
                COUNT(*) FILTER (WHERE metadata->>'orexis_demo' = 'orexis-analytics-v1')::INTEGER AS demo_order_records,
                COUNT(*) FILTER (WHERE COALESCE(metadata->>'orexis_demo', '') <> 'orexis-analytics-v1')::INTEGER AS real_order_records
             FROM business_orders
             WHERE business_id = $1`,
            [businessId]
        );
        return result.rows[0] || { demo_order_records: 0, real_order_records: 0 };
    } finally {
        client.release();
    }
}

async function deleteAnalyticsDemoData(pool, { userId, businessId }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const business = await assertBusinessAccess(client, userId, businessId);
        if (!['owner', 'admin'].includes(business.role)) {
            throw databasePublicError('ANALYTICS_DEMO_ACCESS_DENIED', 'Only business owners and admins can remove demo analytics data.', 403);
        }
        const marker = 'orexis-analytics-v1';
        const counts = {};
        const campaigns = await client.query(
            `DELETE FROM business_campaign_daily_metrics
             WHERE business_id = $1 AND external_id LIKE 'orexis-demo-%'`,
            [businessId]
        );
        counts.campaignMetrics = campaigns.rowCount;
        for (const [key, table] of [
            ['trafficMetrics', 'business_traffic_daily_metrics'],
            ['carts', 'business_cart_sessions'],
            ['reviews', 'business_reviews'],
            ['coupons', 'business_coupons']
        ]) {
            const result = await client.query(`DELETE FROM ${table} WHERE business_id = $1 AND metadata->>'orexis_demo' = $2`, [businessId, marker]);
            counts[key] = result.rowCount;
        }
        const orders = await client.query(`DELETE FROM business_orders WHERE business_id = $1 AND metadata->>'orexis_demo' = $2`, [businessId, marker]);
        counts.orders = orders.rowCount;
        const customers = await client.query(`DELETE FROM business_customers WHERE business_id = $1 AND metadata->>'orexis_demo' = $2`, [businessId, marker]);
        counts.customers = customers.rowCount;
        const products = await client.query(`DELETE FROM business_products WHERE business_id = $1 AND metadata->>'orexis_demo' = $2`, [businessId, marker]);
        counts.products = products.rowCount;
        await client.query('DELETE FROM marketing_workspace_cache WHERE business_id = $1', [businessId]);
        await client.query('COMMIT');
        return { deleted: true, counts };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}


async function saveWorkflowAiExecution(pool, { runId, model, promptText, response, contextHash }) {
    const serializedPrompt = String(promptText || '');
    if (!serializedPrompt || Buffer.byteLength(serializedPrompt, 'utf8') > 512 * 1024) {
        throw databasePublicError('AI_AUDIT_PROMPT_INVALID', 'The grounded AI audit prompt is empty or too large.', 500);
    }
    const result = await pool.query(
        `INSERT INTO workflow_ai_executions (run_id, model, prompt_text, response, context_hash, prompt_bytes)
         SELECT runs.id, $2, $3, $4::JSONB, $5, $6
         FROM workflow_runs runs
         WHERE runs.id = $1
         RETURNING *`,
        [runId, String(model || 'unknown').slice(0, 160), serializedPrompt, JSON.stringify(response || {}), contextHash, Buffer.byteLength(serializedPrompt, 'utf8')]
    );
    if (!result.rows[0]) throw databasePublicError('WORKFLOW_RUN_NOT_FOUND', 'The workflow run was not found for AI audit storage.', 404);
    return result.rows[0];
}

async function saveMarketingCampaignAssets(pool, { userId, businessId, runId, campaigns }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await assertBusinessAccess(client, userId, businessId);
        const runResult = await client.query(
            'SELECT id FROM workflow_runs WHERE id = $1 AND user_id = $2 AND business_id = $3 LIMIT 1',
            [runId, userId, businessId]
        );
        if (!runResult.rows[0]) throw databasePublicError('WORKFLOW_RUN_NOT_FOUND', 'Workflow run was not found.', 404);
        const saved = [];
        for (const campaign of campaigns || []) {
            const result = await client.query(
                `INSERT INTO marketing_campaign_assets (
                    run_id, business_id, channel, title, content, rationale, verified_facts, status
                 ) VALUES ($1, $2, $3, $4, $5::JSONB, $6, $7::JSONB, 'draft')
                 RETURNING *`,
                [runId, businessId, campaign.channel, campaign.title, JSON.stringify(campaign.content), campaign.rationale || null, JSON.stringify(campaign.verifiedFacts || [])]
            );
            saved.push(result.rows[0]);
        }
        await client.query('COMMIT');
        return saved;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}


async function saveCompetitorLiveSnapshots(pool, { userId, businessId, snapshots, retrievedAt = new Date().toISOString() }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await assertBusinessAccess(client, userId, businessId);
        const saved = [];
        for (const item of snapshots || []) {
            if (!item || item.status !== 'available' || !item.id) continue;
            const result = await client.query(
                `INSERT INTO business_competitor_snapshots (
                    competitor_id, retrieved_at, source_name, source_url, currency,
                    products, offers, positioning, raw_metadata
                 )
                 SELECT competitors.id, $3, $4, $5, $6, $7::JSONB, $8::JSONB, $9, $10::JSONB
                 FROM business_competitors competitors
                 WHERE competitors.id = $1 AND competitors.business_id = $2
                 ON CONFLICT (competitor_id, retrieved_at) DO UPDATE SET
                    source_name = EXCLUDED.source_name,
                    source_url = EXCLUDED.source_url,
                    currency = EXCLUDED.currency,
                    products = EXCLUDED.products,
                    offers = EXCLUDED.offers,
                    positioning = EXCLUDED.positioning,
                    raw_metadata = EXCLUDED.raw_metadata
                 RETURNING *`,
                [item.id, businessId, retrievedAt, 'public-website', item.sourceUrl || null, item.currency || null, JSON.stringify(item.products || item.offers || []), JSON.stringify(item.offers || []), item.description || null, JSON.stringify({ title: item.title || null, pricing: item.pricing || [], textHash: item.textHash || null })]
            );
            if (result.rows[0]) saved.push(result.rows[0]);
        }
        await client.query('COMMIT');
        return saved;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function listMarketingCampaignAssets(pool, { userId, businessId, runId = null, limit = 100 }) {
    const client = await pool.connect();
    try {
        await assertBusinessAccess(client, userId, businessId);
        const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
        const result = await client.query(
            `SELECT assets.*
             FROM marketing_campaign_assets assets
             INNER JOIN workflow_runs runs ON runs.id = assets.run_id
             WHERE assets.business_id = $1 AND runs.user_id = $2
               AND ($3::BIGINT IS NULL OR assets.run_id = $3)
             ORDER BY assets.created_at DESC, assets.id DESC
             LIMIT $4`,
            [businessId, userId, runId, safeLimit]
        );
        return result.rows;
    } finally {
        client.release();
    }
}

async function getMarketingWorkspaceCache(pool, { userId, businessId, cacheKey }) {
    const result = await pool.query(
        `SELECT cache.payload, cache.source_updated_at, cache.expires_at
         FROM marketing_workspace_cache cache
         INNER JOIN business_memberships memberships ON memberships.business_id = cache.business_id
         WHERE cache.business_id = $1 AND memberships.user_id = $2
           AND cache.cache_key = $3 AND cache.expires_at > NOW()
         LIMIT 1`,
        [businessId, userId, cacheKey]
    );
    return result.rows[0] || null;
}

async function saveMarketingWorkspaceCache(pool, { businessId, cacheKey, payload, sourceUpdatedAt = null, ttlSeconds = 30 }) {
    const result = await pool.query(
        `INSERT INTO marketing_workspace_cache (business_id, cache_key, payload, source_updated_at, expires_at)
         VALUES ($1, $2, $3::JSONB, $4, NOW() + ($5::TEXT || ' seconds')::INTERVAL)
         ON CONFLICT (business_id) DO UPDATE SET
             cache_key = EXCLUDED.cache_key,
             payload = EXCLUDED.payload,
             source_updated_at = EXCLUDED.source_updated_at,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()
         RETURNING *`,
        [businessId, cacheKey, JSON.stringify(payload), sourceUpdatedAt, Math.max(5, Math.min(300, Number(ttlSeconds) || 30))]
    );
    return result.rows[0];
}

async function listScheduledWorkflows(pool, { userId, businessId }) {
    const result = await pool.query(
        `SELECT schedules.*
         FROM scheduled_workflows schedules
         INNER JOIN business_memberships memberships ON memberships.business_id = schedules.business_id
         WHERE schedules.business_id = $1 AND memberships.user_id = $2
         ORDER BY schedules.schedule_kind ASC`,
        [businessId, userId]
    );
    return result.rows;
}

async function upsertScheduledWorkflow(pool, { userId, businessId, schedule }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const business = await assertBusinessAccess(client, userId, businessId);
        if (!['owner', 'admin'].includes(business.role)) throw databasePublicError('SCHEDULE_ACCESS_DENIED', 'Only business owners and admins can change schedules.', 403);
        const result = await client.query(
            `INSERT INTO scheduled_workflows (
                business_id, created_by_user_id, workflow_slug, schedule_kind, cadence,
                run_hour, run_minute, day_of_week, day_of_month, timezone, input, enabled, next_run_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::JSONB, $12, $13)
             ON CONFLICT (business_id, schedule_kind) DO UPDATE SET
                created_by_user_id = EXCLUDED.created_by_user_id,
                workflow_slug = EXCLUDED.workflow_slug,
                cadence = EXCLUDED.cadence,
                run_hour = EXCLUDED.run_hour,
                run_minute = EXCLUDED.run_minute,
                day_of_week = EXCLUDED.day_of_week,
                day_of_month = EXCLUDED.day_of_month,
                timezone = EXCLUDED.timezone,
                input = EXCLUDED.input,
                enabled = EXCLUDED.enabled,
                next_run_at = EXCLUDED.next_run_at,
                locked_at = NULL,
                locked_by = NULL,
                updated_at = NOW()
             RETURNING *`,
            [businessId, userId, schedule.workflowSlug, schedule.scheduleKind, schedule.cadence, schedule.runHour, schedule.runMinute, schedule.dayOfWeek, schedule.dayOfMonth, schedule.timezone, JSON.stringify(schedule.input || {}), schedule.enabled !== false, schedule.nextRunAt]
        );
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function deleteScheduledWorkflow(pool, { userId, businessId, scheduleId }) {
    const result = await pool.query(
        `DELETE FROM scheduled_workflows schedules
         USING business_memberships memberships
         WHERE schedules.id = $1 AND schedules.business_id = $2
           AND memberships.business_id = schedules.business_id
           AND memberships.user_id = $3 AND memberships.role IN ('owner', 'admin')
         RETURNING schedules.id`,
        [scheduleId, businessId, userId]
    );
    return Boolean(result.rows[0]);
}

async function claimDueScheduledWorkflows(pool, { workerId, limit = 5 }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `WITH due AS (
                SELECT id
                FROM scheduled_workflows
                WHERE enabled = TRUE AND next_run_at <= NOW()
                  AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '30 minutes')
                ORDER BY next_run_at ASC, id ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $1
             )
             UPDATE scheduled_workflows schedules
             SET locked_at = NOW(), locked_by = $2, updated_at = NOW()
             FROM due
             WHERE schedules.id = due.id
             RETURNING schedules.*`,
            [Math.max(1, Math.min(25, Number(limit) || 5)), workerId]
        );
        await client.query('COMMIT');
        return result.rows;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function completeScheduledWorkflow(pool, { scheduleId, workerId, nextRunAt, runId = null, status, errorMessage = null }) {
    const result = await pool.query(
        `UPDATE scheduled_workflows
         SET next_run_at = $3,
             last_run_at = NOW(),
             last_run_id = $4,
             last_status = $5,
             last_error = $6,
             locked_at = NULL,
             locked_by = NULL,
             updated_at = NOW()
         WHERE id = $1 AND locked_by = $2
         RETURNING *`,
        [scheduleId, workerId, nextRunAt, runId, status, errorMessage]
    );
    return result.rows[0] || null;
}

function databasePublicError(code, publicMessage, statusCode) {
    const error = new Error(publicMessage);
    error.code = code;
    error.publicMessage = publicMessage;
    error.statusCode = statusCode;
    return error;
}

function parsePoolSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new Error('DATABASE_POOL_MAX must be a number between 1 and 100.');
    }
    return parsed;
}

module.exports = {
    createDatabaseFromEnvironment,
    createUserStore,
    sanitizeOAuthUsername,
    usernameCandidate
};
