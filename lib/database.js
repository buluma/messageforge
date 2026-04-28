'use strict';

const mongoose = require('mongoose');
const config = require('../config');

let mongoConnected = false;
let pgPool = null;

/**
 * MongoDB Connection
 */
async function connectMongo() {
    if (!config.MONGODB_URL) {
        console.log('[DB] No MONGODB_URL provided. Skipping MongoDB.');
        return;
    }

    try {
        await mongoose.connect(config.MONGODB_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        mongoConnected = true;
        console.log('[DB] MongoDB connected successfully.');
    } catch (err) {
        console.error(`[DB] MongoDB connection error: ${err.message}`);
        mongoConnected = false;
    }
}

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
            console.error('[DB] PostgreSQL unexpected error:', err.message);
        });

        pgPool.on('connect', () => {
            console.log('[DB] PostgreSQL client connected.');
        });

        console.log('[DB] PostgreSQL connection pool created.');
    } catch (err) {
        console.error('[DB] Failed to create PostgreSQL pool:', err.message);
    }
}

/**
 * Initialize database connections based on DATABASE_TYPE
 */
async function initDatabase() {
    const dbType = config.DATABASE_TYPE || 'local';
    console.log(`[DB] Initializing with type: ${dbType}`);

    // Initialize PostgreSQL if configured
    if (dbType === 'postgres') {
        connectPostgres();
    }

    // Initialize MongoDB (optional backend, used for migration or hybrid)
    if (dbType === 'mongo' || (dbType === 'postgres' && config.MONGODB_URL)) {
        await connectMongo();
    }
}

/**
 * Check if MongoDB is connected
 */
function isMongoConnected() {
    return mongoConnected;
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
        console.log('[DB] PostgreSQL pool closed.');
    }
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        console.log('[DB] MongoDB connection closed.');
    }
}

module.exports = {
    connectDB: initDatabase,
    mongoose,
    isMongoConnected,
    getPgPool,
    closeConnections,
};
