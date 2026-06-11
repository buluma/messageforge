const fs = require('fs');
if (fs.existsSync('config.env')) {
    require('dotenv').config({ path: './config.env' });
} else {
    require('dotenv').config();
}

function toBool(val, defaultOn = true) {
    if (val === undefined || val === null || val === '') return defaultOn;
    return val.toLowerCase() !== 'false';
}

function readSecretFile(filePath) {
    if (!filePath) return '';
    try {
        const p = String(filePath).trim();
        if (!p) return '';
        if (!fs.existsSync(p)) return '';
        return String(fs.readFileSync(p, 'utf8')).trim();
    } catch {
        return '';
    }
}

module.exports = {
    SESSION_ID: process.env.SESSION_ID || '',
    PAIRING_CODE: toBool(process.env.PAIRING_CODE, false),
    PAIRING_NUMBER: process.env.PAIRING_NUMBER || '',
    // PREFIX supports comma-separated list: ".,!,/,?"
    // Use "any" to accept any leading symbol, or "" / "none" for no prefix
    PREFIX: process.env.PREFIX || '.',
    BOT_NAME: process.env.BOT_NAME || 'MessageForge',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '',
    OWNER_NAME: process.env.OWNER_NAME || 'SHADOWNET',
    DESCRIPTION: process.env.DESCRIPTION || 'MessageForge',
    LIVE_MSG: process.env.LIVE_MSG || 'MessageForge is active',
    MODE: process.env.MODE || 'both',
    AUTO_STATUS_SEEN: toBool(process.env.AUTO_STATUS_SEEN, true),
    AUTO_STATUS_REACT: toBool(process.env.AUTO_STATUS_REACT, true),
    AUTO_STATUS_REPLY: toBool(process.env.AUTO_STATUS_REPLY, false),
    AUTO_STATUS_MSG: process.env.AUTO_STATUS_MSG || 'Seen by MessageForge',
    AUTO_STATUS_MODE: (process.env.AUTO_STATUS_MODE || 'all').toLowerCase().trim(),
    CUSTOM_REACT_EMOJIS: process.env.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍,👏,💙,🙌',
    Status_Saver: process.env.Status_Saver || process.env.STATUS_SAVER || 'false',
    STATUS_INBOX_JID: process.env.STATUS_INBOX_JID || '',
    STATUS_REPLY: process.env.STATUS_REPLY || 'false',
    STATUS_MSG: process.env.STATUS_MSG || 'MessageForge 💖 SUCCESSFULLY VIEWED YOUR STATUS',
    READ_MESSAGE: toBool(process.env.READ_MESSAGE, false),
    AUTO_REACT_NEWSLETTER: toBool(process.env.AUTO_REACT_NEWSLETTER, true),
    AUTO_FOLLOW_NEWSLETTER: toBool(process.env.AUTO_FOLLOW_NEWSLETTER, false),
    AUTO_UNFOLLOW_NEWSLETTER: toBool(process.env.AUTO_UNFOLLOW_NEWSLETTER, false),
    NEWSLETTER_JID: process.env.NEWSLETTER_JID || '120363200367779016@newsletter',
    ANTI_BAD: toBool(process.env.ANTI_BAD, false),
    ALWAYS_ONLINE: toBool(process.env.ALWAYS_ONLINE, false),
    AUTO_TYPING: toBool(process.env.AUTO_TYPING, true),
    AUTO_RECORDING: toBool(process.env.AUTO_RECORDING, false),
    DELETE_LINKS: toBool(process.env.DELETE_LINKS, false),
    ANTIDELETE_GROUP: toBool(process.env.ANTIDELETE_GROUP, true),
    ANTIDELETE_PRIVATE: toBool(process.env.ANTIDELETE_PRIVATE, true),
    ANTILINK: toBool(process.env.ANTILINK, false),
    ANTIVV: toBool(process.env.ANTIVV, true),
    ANTIVV_MAX_BYTES: Number(process.env.ANTIVV_MAX_BYTES || 64 * 1024 * 1024),
    ANTIVV_QUEUE_LIMIT: Number(process.env.ANTIVV_QUEUE_LIMIT || 30),
    DEBUG: toBool(process.env.DEBUG, false),
    STRICT_COMMAND_COLLISIONS: toBool(process.env.STRICT_COMMAND_COLLISIONS, false),
    THEME: (process.env.THEME || 'messageforge').toLowerCase().trim(),
    GREETING: process.env.GREETING || '',
    APP_URL: process.env.APP_URL || '',
    TENOR_API_KEY: process.env.TENOR_API_KEY || '',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || '',
    OPENROUTER_MODELS: process.env.OPENROUTER_MODELS || '',
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3.2',
    AI_TIMEOUT_MS: Number(process.env.AI_TIMEOUT_MS || 25000),
    DATABASE_TYPE: (process.env.DATABASE_TYPE || 'local').toLowerCase().trim(),
    POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
    POSTGRES_PORT: Number(process.env.POSTGRES_PORT || 5432),
    POSTGRES_USER: process.env.POSTGRES_USER || 'shadowwalker',
    POSTGRES_PASSWORD:
        process.env.POSTGRES_PASSWORD || readSecretFile(process.env.POSTGRES_PASSWORD_FILE) || '',
    POSTGRES_DB: process.env.POSTGRES_DB || 'messageforge',
    DASHBOARD_TOKEN: process.env.DASHBOARD_TOKEN || '',
    MESSENGER_HISTORY_MAX: Number(process.env.MESSENGER_HISTORY_MAX || 3000),
    MESSENGER_CACHED_CHATS: Number(process.env.MESSENGER_CACHED_CHATS || 50),
    LOG_MAX_FILE_BYTES: Number(process.env.LOG_MAX_FILE_BYTES || 5 * 1024 * 1024),
    LOG_MAX_AGE_DAYS: Number(process.env.LOG_MAX_AGE_DAYS || 2),
    LOG_MAX_TOTAL_BYTES: Number(process.env.LOG_MAX_TOTAL_BYTES || 200 * 1024 * 1024),
    LOG_FORMAT: (process.env.LOG_FORMAT || 'text').toLowerCase().trim(),
    PORT: Number(process.env.PORT || 25680),
    SEND_GUARD_MAX_PER_MIN: Number(process.env.SEND_GUARD_MAX_PER_MIN || 30),
    LID_JID_MAP_MAX: Number(process.env.LID_JID_MAP_MAX || 20000),
    LID_PHONE_CACHE_MAX: Number(process.env.LID_PHONE_CACHE_MAX || 60000),
    GROUP_CACHE_TTL_MS: Number(process.env.GROUP_CACHE_TTL_MS || 5 * 60 * 1000),
    MESSAGE_CACHE_TTL_MS: Number(process.env.MESSAGE_CACHE_TTL_MS || 3 * 60 * 60 * 1000),
    FACE_SIDECAR_URL: process.env.FACE_SIDECAR_URL || 'http://127.0.0.1:8011',
    FACE_SIDECAR_TIMEOUT_MS: Number(process.env.FACE_SIDECAR_TIMEOUT_MS || 60000),
    FACE_CLUSTER_TIMEOUT_MS: Number(process.env.FACE_CLUSTER_TIMEOUT_MS || 300000),
    FACE_CLUSTER_EPSILON: Number(process.env.FACE_CLUSTER_EPSILON || 1.05),
    FACE_CLUSTER_MIN_POINTS: Number(process.env.FACE_CLUSTER_MIN_POINTS || 2),
    FACE_PRIMARY_PATH_MODE: toBool(process.env.FACE_PRIMARY_PATH_MODE, false),
    FACE_SCAN_VIDEO: toBool(process.env.FACE_SCAN_VIDEO, false),
    FACE_VIDEO_MAX_FRAMES: Number(process.env.FACE_VIDEO_MAX_FRAMES || 3),
    FACE_VIDEO_MIN_SPACING_SEC: Number(process.env.FACE_VIDEO_MIN_SPACING_SEC || 2),
    FACE_MATCH_THRESHOLD: Number(process.env.FACE_MATCH_THRESHOLD || 0.45),
    MEDIA_MAX_MB: Number(process.env.MEDIA_MAX_MB || 100),
    DB_POOL_MAX: Number(process.env.DB_POOL_MAX || 20),
};
