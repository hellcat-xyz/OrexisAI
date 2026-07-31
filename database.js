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
