'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const PluginData = require('./models/pluginData');
const { mongoose } = require('./database');

/**
 * Generic data manager that handles both MongoDB and local JSON fallback.
 */
class DBManager {
    constructor() {
        this.dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    }

    /**
     * Retrieves data for a specific key.
     * @param {string} key - The lookup key.
     * @param {any} defaultValue - Default value if key not found.
     * @returns {Promise<any>}
     */
    async get(key, defaultValue = null) {
        // Try MongoDB first, but only when the driver is actually connected.
        // This avoids 10s+ buffered-query stalls when MONGODB_URL is set but unavailable.
        if (config.MONGODB_URL && mongoose.connection.readyState === 1) {
            try {
                const doc = await PluginData.findOne({ key });
                if (doc) return doc.data;
            } catch (err) {
                console.error(`[DBManager:Get] MongoDB error for ${key}: ${err.message}`);
            }
        }

        // Fallback to local JSON
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
        // Save to MongoDB if available
        if (config.MONGODB_URL && mongoose.connection.readyState === 1) {
            try {
                await PluginData.findOneAndUpdate(
                    { key },
                    { data, updatedAt: new Date() },
                    { upsert: true, new: true }
                );
            } catch (err) {
                console.error(`[DBManager:Set] MongoDB error for ${key}: ${err.message}`);
            }
        }

        // Always save to local JSON as well for maximum reliability/redundancy
        try {
            const filePath = path.join(this.dataDir, `${key}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(`[DBManager:Set] local save error for ${key}: ${err.message}`);
        }
    }
}

module.exports = new DBManager();
