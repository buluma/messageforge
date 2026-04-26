'use strict';

const mongoose = require('mongoose');

const pluginDataSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PluginData', pluginDataSchema);
