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
