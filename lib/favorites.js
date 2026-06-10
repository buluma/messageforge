'use strict';

/**
 * lib/favorites.js
 * Manage favorite contacts for selective status automation
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load favorites from disk
 * @returns {Set<string>} Set of favorite JIDs
 */
function loadFavorites() {
    try {
        if (fs.existsSync(FAVORITES_FILE)) {
            const data = fs.readFileSync(FAVORITES_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return new Set(parsed);
        }
    } catch (e) {
        logger.warn(`[Favorites] Load error: ${e.message}`);
    }
    return new Set();
}

/**
 * Save favorites to disk
 * @param {Set<string>} favSet - Set of favorite JIDs
 */
function saveFavorites(favSet) {
    try {
        const data = JSON.stringify([...favSet], null, 2);
        fs.writeFileSync(FAVORITES_FILE, data, 'utf8');
    } catch (e) {
        logger.error(`[Favorites] Save error: ${e.message}`);
    }
}

// In-memory cache
let _favoritesCache = null;

/**
 * Get the favorites set (cached)
 * @returns {Set<string>}
 */
function getFavorites() {
    if (!_favoritesCache) {
        _favoritesCache = loadFavorites();
    }
    return _favoritesCache;
}

/**
 * Normalize a JID to consistent format (bare phone JID)
 * @param {string} jid - Input JID
 * @returns {string} Normalized JID
 */
function normalizeJid(jid) {
    if (!jid) return '';
    // Strip device suffix (e.g. :16 from 254759704347:16@s.whatsapp.net)
    let normalized = jid.replace(/:\d+@/, '@');
    // Convert LID to phone JID if possible
    if (normalized.includes('@lid')) {
        const bareLid = normalized.split('@')[0];
        if (global.lidJidMap?.has(bareLid + '@lid')) {
            normalized = global.lidJidMap.get(bareLid + '@lid');
        } else if (global.lidPhoneCache?.has(bareLid)) {
            normalized = `${global.lidPhoneCache.get(bareLid)}@s.whatsapp.net`;
        }
    }
    // Ensure @s.whatsapp.net suffix
    if (!normalized.includes('@')) {
        normalized = `${normalized.replace(/\D/g, '')}@s.whatsapp.net`;
    }
    return normalized;
}

/**
 * Check if a JID is in favorites
 * @param {string} jid - JID to check
 * @returns {boolean}
 */
function isFavorite(jid) {
    if (!jid) return false;
    const normalized = normalizeJid(jid);
    const favorites = getFavorites();
    // Direct match
    if (favorites.has(normalized)) return true;
    // Try without suffix
    const bare = normalized.split('@')[0];
    for (const fav of favorites) {
        if (fav.startsWith(bare + '@')) return true;
    }
    return false;
}

/**
 * Add a JID to favorites
 * @param {string} jid - JID to add
 * @returns {boolean} Success
 */
function addFavorite(jid) {
    if (!jid) return false;
    const normalized = normalizeJid(jid);
    if (!normalized) return false;

    const favorites = getFavorites();
    favorites.add(normalized);
    saveFavorites(favorites);
    logger.custom('Favorites', `➕ Added: ${normalized}`);
    return true;
}

/**
 * Remove a JID from favorites
 * @param {string} jid - JID to remove
 * @returns {boolean} Success
 */
function removeFavorite(jid) {
    if (!jid) return false;
    const normalized = normalizeJid(jid);
    const favorites = getFavorites();

    // Find and remove matching entry
    let removed = false;
    const bare = normalized.split('@')[0];
    for (const fav of favorites) {
        if (fav.startsWith(bare + '@')) {
            favorites.delete(fav);
            removed = true;
        }
    }
    if (removed) {
        saveFavorites(favorites);
        logger.custom('Favorites', `➖ Removed: ${normalized}`);
    }
    return removed;
}

/**
 * Get list of all favorites
 * @returns {string[]} Array of favorite JIDs
 */
function listFavorites() {
    return [...getFavorites()];
}

/**
 * Get formatted favorites list with numbers
 * @returns {Array<{jid: string, number: string}>}
 */
function getFormattedFavorites() {
    const favorites = getFavorites();
    return [...favorites].map((jid) => ({
        jid,
        number: jid.split('@')[0],
    }));
}

/**
 * Clear and reload cache (for testing)
 */
function reloadCache() {
    _favoritesCache = null;
}

module.exports = {
    isFavorite,
    addFavorite,
    removeFavorite,
    listFavorites,
    getFormattedFavorites,
    getFavorites,
    normalizeJid,
    reloadCache,
};
