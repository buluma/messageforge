'use strict';

const mongoose = require('mongoose');
const config = require('../config');

const connectDB = async () => {
    if (!config.MONGODB_URL) {
        console.log('[DB] No MONGODB_URL provided. Falling back to local storage.');
        return null;
    }

    try {
        await mongoose.connect(config.MONGODB_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('[DB] MongoDB connected successfully.');
        return mongoose.connection;
    } catch (err) {
        console.error(`[DB] MongoDB connection error: ${err.message}`);
        console.log('[DB] Falling back to local storage.');
        return null;
    }
};

module.exports = { connectDB, mongoose };
