'use strict';

const config = require('../config');
const logger = require('./logger');

let pgPool = null;
let pgReconnectTimer = null;
let pgReconnectAttempts = 0;

function clampInt(value, { min, max, fallback }) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

function schedulePgReconnect(reason) {
    if (pgReconnectTimer) return;

    const delayMs = Math.min(30000, 1000 * (2 ** Math.min(pgReconnectAttempts, 5)));
    logger.warn(`[DB] Scheduling PostgreSQL reconnect in ${delayMs}ms (${reason})`);

    pgReconnectTimer = setTimeout(async () => {
        pgReconnectTimer = null;
        pgReconnectAttempts += 1;

        try {
            if (pgPool) await pgPool.end();
        } catch (err) {
            logger.warn(`[DB] PostgreSQL pool close failed during reconnect: ${err.message}`);
        } finally {
            pgPool = null;
        }

        connectPostgres();
    }, delayMs);
    pgReconnectTimer.unref?.();
}

/**
 * PostgreSQL Connection Pool
 */
function connectPostgres() {
    const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = config;

    try {
        const { Pool } = require('pg');

        const max = clampInt(config.DB_POOL_MAX, { min: 1, max: 100, fallback: 20 });
        pgPool = new Pool({
            host: POSTGRES_HOST,
            port: POSTGRES_PORT,
            user: POSTGRES_USER,
            password: POSTGRES_PASSWORD,
            database: POSTGRES_DB,
            max,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });

        pgPool.on('error', (err) => {
            logger.error(`[DB] PostgreSQL unexpected error: ${err.message}`);
            // Attempt to validate connectivity and reconnect if the pool is unhealthy.
            Promise.resolve()
                .then(() => pgPool && pgPool.query('SELECT 1'))
                .catch((e) => {
                    schedulePgReconnect(`pool error + healthcheck failed: ${e.message}`);
                });
        });

        pgPool.on('connect', () => {
            logger.custom('DB', 'PostgreSQL client connected.');
        });

        pgReconnectAttempts = 0;
        logger.custom('DB', `PostgreSQL connection pool created (max=${max}).`);
    } catch (err) {
        logger.error(`[DB] Failed to create PostgreSQL pool: ${err.message}`);
    }
}

/**
 * Initialize database connections based on DATABASE_TYPE.
 * Supported backends: postgres | local.
 */
async function initDatabase() {
    const dbType = config.DATABASE_TYPE === 'postgres' ? 'postgres' : 'local';
    logger.custom('DB', `Initializing with type: ${dbType}`);

    // Initialize PostgreSQL if configured
    if (dbType === 'postgres') {
        connectPostgres();
    }
}

/**
 * Get PostgreSQL pool
 */
function getPgPool() {
    return pgPool;
}

/**
 * Close all database connections
 */
async function closeConnections() {
    if (pgPool) {
        await pgPool.end();
        logger.custom('DB', 'PostgreSQL pool closed.');
    }
}

module.exports = {
    connectDB: initDatabase,
    getPgPool,
    closeConnections,
};
