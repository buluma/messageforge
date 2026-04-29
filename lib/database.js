'use strict';

const config = require('../config');
const logger = require('./logger');

let pgPool = null;

/**
 * PostgreSQL Connection Pool
 */
function connectPostgres() {
    const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = config;

    try {
        const { Pool } = require('pg');
        pgPool = new Pool({
            host: POSTGRES_HOST,
            port: POSTGRES_PORT,
            user: POSTGRES_USER,
            password: POSTGRES_PASSWORD,
            database: POSTGRES_DB,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        pgPool.on('error', (err) => {
            logger.error(`[DB] PostgreSQL unexpected error: ${err.message}`);
        });

        pgPool.on('connect', () => {
            logger.custom('DB', 'PostgreSQL client connected.');
        });

        logger.custom('DB', 'PostgreSQL connection pool created.');
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
