'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

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
        `SELECT businesses.id, businesses.name, businesses.currency, businesses.timezone,
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
    durationMs = null
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
            Number.isSafeInteger(durationMs) && durationMs >= 0 ? durationMs : null
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
    return { ...run, steps: stepsResult.rows };
}

async function listWorkflowRuns(pool, { userId, workflowSlug = null, limit = 20 }) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const result = await pool.query(
        `SELECT id, business_id, workflow_slug, workflow_name, status, output, error_message,
                data_period_start, data_period_end, data_retrieved_at, records_analyzed,
                duration_ms, created_at, started_at, completed_at, updated_at
         FROM workflow_runs
         WHERE user_id = $1
           AND ($2::TEXT IS NULL OR workflow_slug = $2)
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [userId, workflowSlug, safeLimit]
    );
    return result.rows;
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
                    COALESCE(SUM(items.total_amount_minor), 0)::BIGINT AS revenue_minor,
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
        competitorSnapshots: 0
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
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, name, currency, timezone`,
                [businessId, payload.business.name, payload.business.currency, payload.business.timezone]
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
                    business_id, external_id, name, sku, currency, price_minor, cost_minor,
                    current_stock, lead_time_days, reorder_buffer_days, active, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::JSONB)
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    sku = EXCLUDED.sku,
                    currency = EXCLUDED.currency,
                    price_minor = EXCLUDED.price_minor,
                    cost_minor = EXCLUDED.cost_minor,
                    current_stock = EXCLUDED.current_stock,
                    lead_time_days = EXCLUDED.lead_time_days,
                    reorder_buffer_days = EXCLUDED.reorder_buffer_days,
                    active = EXCLUDED.active,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.name, item.sku, item.currency || business.currency, item.priceMinor, item.costMinor, item.currentStock, item.leadTimeDays, item.reorderBufferDays, item.active, JSON.stringify(item.metadata || {})]
            );
            counts.products += 1;
        }
        for (const item of payload.orders || []) {
            await client.query(
                `INSERT INTO business_orders (
                    business_id, external_id, customer_id, status, currency, total_amount_minor,
                    refunded_amount_minor, ordered_at, metadata
                 ) VALUES (
                    $1, $2,
                    (SELECT id FROM business_customers WHERE business_id = $1 AND external_id = $3 LIMIT 1),
                    $4, $5, $6, $7, $8, $9::JSONB
                 )
                 ON CONFLICT (business_id, external_id) DO UPDATE SET
                    customer_id = EXCLUDED.customer_id,
                    status = EXCLUDED.status,
                    currency = EXCLUDED.currency,
                    total_amount_minor = EXCLUDED.total_amount_minor,
                    refunded_amount_minor = EXCLUDED.refunded_amount_minor,
                    ordered_at = EXCLUDED.ordered_at,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
                [businessId, item.externalId, item.customerExternalId, item.status, item.currency || business.currency, item.totalAmountMinor, item.refundedAmountMinor, item.orderedAt, JSON.stringify(item.metadata || {})]
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
