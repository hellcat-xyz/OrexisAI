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
                 WHERE email = $1
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

        async close() {
            await pool.end();
        }
    };
}

function parsePoolSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new Error('DATABASE_POOL_MAX must be a number between 1 and 100.');
    }
    return parsed;
}

module.exports = { createDatabaseFromEnvironment, createUserStore };
