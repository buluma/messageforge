'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const PluginData = require('./models/pluginData');
const { isMongoConnected, getPgPool } = require('./database');

/**
 * Generic data manager that handles PostgreSQL, MongoDB, and local JSON fallback.
 */
class DBManager {
    constructor() {
        this.dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    }

    /**
     * Get current database type in use
     */
    getDbType() {
        const dbType = config.DATABASE_TYPE || 'local';
        if (dbType === 'postgres') return 'postgres';
        if (dbType === 'mongo' && config.MONGODB_URL && isMongoConnected()) return 'mongo';
        return 'local';
    }

    /**
     * Retrieves data for a specific key.
     * @param {string} key - The lookup key.
     * @param {any} defaultValue - Default value if key not found.
     * @returns {Promise<any>}
     */
    async get(key, defaultValue = null) {
        const dbType = this.getDbType();

        // PostgreSQL
        if (dbType === 'postgres') {
            const pool = getPgPool();
            if (pool) {
                try {
                    const result = await pool.query(
                        'SELECT data FROM plugin_data WHERE key = $1',
                        [key],
                    );
                    if (result.rows.length > 0) {
                        return result.rows[0].data;
                    }
                } catch (err) {
                    console.error(`[DBManager:Get] PostgreSQL error for ${key}:`, err.message);
                }
            }
        }

        // MongoDB
        if (dbType === 'mongo') {
            try {
                const doc = await PluginData.findOne({ key });
                if (doc) return doc.data;
            } catch (err) {
                console.error(`[DBManager:Get] MongoDB error for ${key}: ${err.message}`);
            }
        }

        // Local JSON fallback
        try {
            const filePath = path.join(this.dataDir, `${key}.json`);
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (err) {
            console.error(`[DBManager:Get] local fallback error for ${key}: ${err.message}`);
        }

        return defaultValue;
    }

    /**
     * Saves data for a specific key.
     * @param {string} key - The lookup key.
     * @param {any} data - Data to save.
     */
    async set(key, data) {
        const dbType = this.getDbType();

        // PostgreSQL
        if (dbType === 'postgres') {
            const pool = getPgPool();
            if (pool) {
                try {
                    await pool.query(
                        `INSERT INTO plugin_data (key, data, updated_at)
                         VALUES ($1, $2, NOW())
                         ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
                        [key, JSON.stringify(data)],
                    );
                } catch (err) {
                    console.error(`[DBManager:Set] PostgreSQL error for ${key}:`, err.message);
                }
            }
        }

        // MongoDB
        if (dbType === 'mongo') {
            try {
                await PluginData.findOneAndUpdate(
                    { key },
                    { data, updatedAt: new Date() },
                    { upsert: true, new: true },
                );
            } catch (err) {
                console.error(`[DBManager:Set] MongoDB error for ${key}: ${err.message}`);
            }
        }

        // Always save to local JSON as well for redundancy
        try {
            const filePath = path.join(this.dataDir, `${key}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(`[DBManager:Set] local save error for ${key}: ${err.message}`);
        }
    }

    /**
     * Initialize PostgreSQL schema (call once on startup)
     */
    async initPostgresSchema() {
        const pool = getPgPool();
        if (!pool) {
            console.log('[DBManager] No PostgreSQL pool available for schema init.');
            return;
        }

        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS plugin_data (
                    key VARCHAR(255) PRIMARY KEY,
                    data JSONB NOT NULL,
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            console.log('[DBManager] PostgreSQL schema initialized successfully.');
        } catch (err) {
            console.error('[DBManager] PostgreSQL schema init error:', err.message);
        }
    }

    /**
     * Get raw PostgreSQL pool for advanced queries
     */
    getRawPool() {
        return getPgPool();
    }
}

module.exports = new DBManager();
