'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getPgPool } = require('./database');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data/messenger-history');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const HIDDEN_CHATS_FILE = path.join(__dirname, '../data/hidden-chats.json');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_PER_CHAT = config.MESSENGER_HISTORY_MAX;
const MAX_CACHED_CHATS = config.MESSENGER_CACHED_CHATS;

const writeQueue = new Map();
const WRITE_TIMEOUT_MS = 30 * 1000;
let indexLoaded = false;
const indexSet = new Set();

const hiddenChats = new Set(safeReadJson(HIDDEN_CHATS_FILE, []));

// In-memory cache: jid -> sorted Array<compactMsg>. LRU-bounded — cold chats
// evict to keep RSS predictable. Latest msg per jid kept separately and is
// cheap, so it stays unbounded for fast /api/chats rendering.
const messageCache = new Map();
const latestCache = new Map();
const latestIncomingNameCache = new Map();

function hasMedia(msg) {
    if (!msg || !msg.message) return false;
    const m = msg.message;
    const type = Object.keys(m)[0];
    if (
        [
            'imageMessage',
            'videoMessage',
            'documentMessage',
            'audioMessage',
            'stickerMessage',
        ].includes(type)
    )
        return true;
    if (type === 'ephemeralMessage' || type === 'viewOnceMessage' || type === 'viewOnceMessageV2') {
        const inner = m[type]?.message;
        if (!inner) return false;
        const innerType = Object.keys(inner)[0];
        if (
            [
                'imageMessage',
                'videoMessage',
                'documentMessage',
                'audioMessage',
                'stickerMessage',
            ].includes(innerType)
        )
            return true;
    }
    return false;
}

function isPostgresEnabled() {
    return config.DATABASE_TYPE === 'postgres' && getPgPool() !== null;
}

function messageCacheSet(jid, value) {
    messageCache.delete(jid);
    messageCache.set(jid, value);
    while (messageCache.size > MAX_CACHED_CHATS) {
        const oldest = messageCache.keys().next().value;
        if (oldest === undefined) break;
        messageCache.delete(oldest);
    }
}

function messageCacheTouch(jid) {
    if (!messageCache.has(jid)) return;
    const v = messageCache.get(jid);
    messageCache.delete(jid);
    messageCache.set(jid, v);
}

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function safeWriteJson(filePath, data) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

function jidToFileName(jid) {
    return Buffer.from(String(jid), 'utf8').toString('base64url') + '.json';
}

function chatPath(jid) {
    return path.join(DATA_DIR, jidToFileName(jid));
}

function addToIndex(jid) {
    if (!indexLoaded) {
        const index = safeReadJson(INDEX_FILE, []);
        for (const value of index) indexSet.add(value);
        indexLoaded = true;
    }
    if (indexSet.has(jid)) return;
    indexSet.add(jid);
    try {
        safeWriteJson(INDEX_FILE, Array.from(indexSet));
    } catch (err) {
        logger.error(`[messengerStore] addToIndex persist error: ${err.message}`);
    }
}

function toTimestamp(ts) {
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    if (typeof ts === 'string') {
        const n = Number(ts);
        return Number.isFinite(n) ? n : 0;
    }
    if (typeof ts === 'object' && ts !== null) {
        if (typeof ts.low === 'number') return ts.low;
        if (typeof ts.toString === 'function') {
            const n = Number(ts.toString());
            return Number.isFinite(n) ? n : 0;
        }
    }
    return 0;
}

function compactMessage(raw) {
    if (!raw?.key?.remoteJid || !raw?.key?.id) return null;
    try {
        return {
            key: raw.key,
            message: raw.message || null,
            messageTimestamp: toTimestamp(raw.messageTimestamp) || Math.floor(Date.now() / 1000),
            pushName: raw.pushName || '',
        };
    } catch {
        return null;
    }
}

function queueByJid(jid, writer) {
    const prev = writeQueue.get(jid) || Promise.resolve();

    // Ensure the queue remains locked until the writer actually finishes (success or error),
    // even if the caller's await times out.
    const writerFinished = (async () => {
        try {
            await prev;
            await writer();
        } catch (e) {
            logger.warn(`[messengerStore] write queue error for ${jid}: ${e.message}`);
        }
    })();

    // The caller gets a race between the writer finishing and a 30s timeout
    const callerPromise = (async () => {
        const timeout = new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error(`Write queue timeout for ${jid} after 30s`)),
                WRITE_TIMEOUT_MS,
            ),
        );
        return Promise.race([writerFinished, timeout]);
    })();

    // Subsequent writes must wait for the actual writer to finish, not the timeout
    writeQueue.set(
        jid,
        writerFinished.finally(() => {
            if (writeQueue.get(jid) === writerFinished) writeQueue.delete(jid);
        }),
    );

    return callerPromise;
}

function readChatMessages(jid) {
    ensureDir();
    return safeReadJson(chatPath(jid), []);
}

function writeChatMessages(jid, messages) {
    ensureDir();
    safeWriteJson(chatPath(jid), messages);
}

function mergeAndSortMessages(persisted, live) {
    const byId = new Map();
    for (const msg of persisted || []) {
        const key = msg?.key?.id;
        if (key) byId.set(key, msg);
    }
    for (const msg of live || []) {
        const c = compactMessage(msg);
        const key = c?.key?.id;
        if (key) byId.set(key, c);
    }

    const all = Array.from(byId.values());
    all.sort((a, b) => {
        const t = toTimestamp(a.messageTimestamp) - toTimestamp(b.messageTimestamp);
        if (t !== 0) return t;
        return String(a?.key?.id || '').localeCompare(String(b?.key?.id || ''));
    });
    return all;
}

function ensureCacheLoaded(jid) {
    const cached = messageCache.get(jid);
    if (cached) {
        messageCacheTouch(jid);
        return cached;
    }
    const persisted = readChatMessages(jid);
    const sorted = mergeAndSortMessages(persisted, []);
    messageCacheSet(jid, sorted);
    if (sorted.length) {
        latestCache.set(jid, sorted[sorted.length - 1]);
        latestIncomingNameCache.set(jid, deriveLatestIncomingPushName(sorted));
    }
    return sorted;
}

function mergeWithLive(jid, liveMessages) {
    const cached = ensureCacheLoaded(jid);
    if (!Array.isArray(liveMessages) || liveMessages.length === 0) return cached;
    return mergeAndSortMessages(cached, liveMessages);
}

function deriveLatestIncomingPushName(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m?.key?.fromMe) continue;
        const name = String(m?.pushName || '').trim();
        if (name) return name;
    }
    return '';
}

// ─── PostgreSQL Message Storage ──────────────────────────────────────────────

async function persistMessagesPg(messages) {
    const pool = getPgPool();
    if (!pool) return;

    for (const raw of messages) {
        const c = compactMessage(raw);
        const jid = c?.key?.remoteJid;
        if (!jid || !c?.key?.id) continue;

        try {
            await pool.query(
                `INSERT INTO messages (jid, msg_id, key, message, message_timestamp, push_name, updated_at)
                 VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, NOW())
                 ON CONFLICT (jid, msg_id) DO UPDATE SET
                     key = EXCLUDED.key,
                     message = EXCLUDED.message,
                     message_timestamp = EXCLUDED.message_timestamp,
                     push_name = EXCLUDED.push_name,
                     updated_at = NOW()`,
                [
                    jid,
                    c.key.id,
                    JSON.stringify(c.key),
                    JSON.stringify(c.message),
                    c.messageTimestamp,
                    c.pushName || '',
                ],
            );
        } catch (err) {
            logger.error(`[messengerStore] PostgreSQL persist error: ${err.message}`);
        }
    }
}

async function readChatMessagesPg(jid) {
    const pool = getPgPool();
    if (!pool) return [];

    try {
        const result = await pool.query(
            `
            SELECT key, message, message_timestamp, push_name
            FROM messages
            WHERE jid = $1
            ORDER BY message_timestamp ASC
            LIMIT $2
        `,
            [jid, MAX_PER_CHAT],
        );

        return result.rows.map((row) => ({
            key: typeof row.key === 'string' ? JSON.parse(row.key) : row.key,
            message: typeof row.message === 'string' ? JSON.parse(row.message) : row.message,
            messageTimestamp: Number(row.message_timestamp),
            pushName: row.push_name || '',
        }));
    } catch (err) {
        logger.error(`[messengerStore] PostgreSQL read error: ${err.message}`);
        return [];
    }
}

async function listKnownJidsPg() {
    const pool = getPgPool();
    if (!pool) return [];

    try {
        const result = await pool.query(`
            SELECT DISTINCT jid FROM messages ORDER BY jid
        `);
        return result.rows.map((row) => row.jid);
    } catch (err) {
        logger.error(`[messengerStore] PostgreSQL listJids error: ${err.message}`);
        return [];
    }
}

// ─── Soft-Delete (hide until next incoming message) ──────────────────────────

function persistHiddenChats() {
    try {
        fs.writeFileSync(HIDDEN_CHATS_FILE, JSON.stringify(Array.from(hiddenChats), null, 2));
    } catch (err) {
        logger.error(`[messengerStore] Failed to persist hidden-chats: ${err.message}`);
    }
}

function unhideChat(jid) {
    if (!hiddenChats.has(jid)) return;
    hiddenChats.delete(jid);
    persistHiddenChats();
}

async function softDeleteChat(jid) {
    messageCache.delete(jid);
    latestCache.delete(jid);
    latestIncomingNameCache.delete(jid);

    indexSet.delete(jid);
    if (indexLoaded) safeWriteJson(INDEX_FILE, Array.from(indexSet));

    ensureDir();
    const file = chatPath(jid);
    if (fs.existsSync(file)) {
        try {
            fs.unlinkSync(file);
        } catch (err) {
            logger.error(`[messengerStore] softDeleteChat unlink error: ${err.message}`);
        }
    }

    if (isPostgresEnabled()) {
        const pool = getPgPool();
        if (pool) {
            try {
                await pool.query('DELETE FROM messages WHERE jid = $1', [jid]);
            } catch (err) {
                logger.error(`[messengerStore] softDeleteChat PG error: ${err.message}`);
            }
        }
    }

    hiddenChats.add(jid);
    persistHiddenChats();
}

async function getChatMedia(jid) {
    const pool = getPgPool();
    if (!pool) {
        // In-memory fallback
        const msgs = ensureCacheLoaded(jid);
        return msgs.filter(hasMedia).reverse().slice(0, 500);
    }
    try {
        const query = `
            SELECT key, message, message_timestamp, push_name, msg_id
            FROM messages
            WHERE jid = $1 
              AND (
                 message ? 'imageMessage' OR 
                 message ? 'videoMessage' OR 
                 message ? 'audioMessage' OR 
                 message ? 'documentMessage' OR
                 message ? 'stickerMessage' OR
                 message->'ephemeralMessage'->'message' ? 'imageMessage' OR
                 message->'ephemeralMessage'->'message' ? 'videoMessage' OR
                 message->'viewOnceMessageV2'->'message' ? 'imageMessage' OR
                 message->'viewOnceMessageV2'->'message' ? 'videoMessage'
              )
            ORDER BY message_timestamp DESC
            LIMIT 500
        `;
        const result = await pool.query(query, [jid]);
        return result.rows.map((row) => ({
            key: typeof row.key === 'string' ? JSON.parse(row.key) : row.key,
            message: typeof row.message === 'string' ? JSON.parse(row.message) : row.message,
            messageTimestamp: Number(row.message_timestamp),
            pushName: row.push_name || '',
            msgId: row.msg_id,
        }));
    } catch (err) {
        logger.error(`[messengerStore] PostgreSQL getChatMedia error: ${err.message}`);
        return [];
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function persistMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    ensureDir();

    if (isPostgresEnabled()) {
        // Also update local JSON for fallback and media resolution
        await persistMessagesToJson(messages);
        await persistMessagesPg(messages);
        return;
    }

    // Local JSON fallback
    await persistMessagesToJson(messages);
}

// Extract JSON persistence to reuse in PostgreSQL mode
async function persistMessagesToJson(messages) {
    const grouped = new Map();
    for (const raw of messages) {
        const c = compactMessage(raw);
        const jid = c?.key?.remoteJid;
        if (!jid) continue;
        if (!grouped.has(jid)) grouped.set(jid, []);
        grouped.get(jid).push(c);
    }

    const writes = [];
    for (const [jid, incoming] of grouped.entries()) {
        unhideChat(jid);
        const current = ensureCacheLoaded(jid);
        const merged = mergeAndSortMessages(current, incoming);
        const trimmed =
            merged.length > MAX_PER_CHAT ? merged.slice(merged.length - MAX_PER_CHAT) : merged;
        messageCacheSet(jid, trimmed);
        if (trimmed.length) {
            latestCache.set(jid, trimmed[trimmed.length - 1]);
            latestIncomingNameCache.set(jid, deriveLatestIncomingPushName(trimmed));
        }
        addToIndex(jid);
        writes.push(
            queueByJid(jid, async () => {
                writeChatMessages(jid, trimmed);
            }),
        );
    }

    await Promise.all(writes);
}

function listKnownJids(liveJids = []) {
    if (isPostgresEnabled()) {
        // For PostgreSQL, we return live JIDs + cached
        return listKnownJidsPg().then((pgJids) => {
            return Array.from(
                new Set([
                    ...(Array.isArray(liveJids) ? liveJids : []),
                    ...pgJids,
                    ...Array.from(indexSet),
                ]),
            );
        });
    }

    // Local JSON fallback
    ensureDir();
    if (!indexLoaded) {
        const index = safeReadJson(INDEX_FILE, []);
        for (const value of index) indexSet.add(value);
        indexLoaded = true;
    }
    return Array.from(
        new Set([...(Array.isArray(liveJids) ? liveJids : []), ...Array.from(indexSet)]),
    );
}

async function getLatestMessage(jid, liveMessages = []) {
    if (Array.isArray(liveMessages) && liveMessages.length > 0) {
        const merged = mergeWithLive(jid, liveMessages);
        return merged.length ? merged[merged.length - 1] : null;
    }

    const cachedLatest = latestCache.get(jid);
    if (cachedLatest) return cachedLatest;

    // In PostgreSQL mode, query DB before JSON fallback so DB-only chats are visible.
    if (isPostgresEnabled()) {
        const latestFromPg = await getLatestMessagePg(jid);
        if (latestFromPg) {
            latestCache.set(jid, latestFromPg);
            return latestFromPg;
        }
    }

    const cached = ensureCacheLoaded(jid);
    return cached.length ? cached[cached.length - 1] : null;
}

async function getLatestIncomingPushName(jid, liveMessages = []) {
    if (Array.isArray(liveMessages) && liveMessages.length > 0) {
        const merged = mergeWithLive(jid, liveMessages);
        const name = deriveLatestIncomingPushName(merged);
        if (name) latestIncomingNameCache.set(jid, name);
        return name;
    }

    const cachedName = latestIncomingNameCache.get(jid);
    if (cachedName) return cachedName;

    if (isPostgresEnabled()) {
        const rows = await readChatMessagesPg(jid);
        const name = deriveLatestIncomingPushName(rows);
        if (name) latestIncomingNameCache.set(jid, name);
        return name;
    }

    const cached = ensureCacheLoaded(jid);
    const name = deriveLatestIncomingPushName(cached);
    if (name) latestIncomingNameCache.set(jid, name);
    return name;
}

// Async version that fetches from PostgreSQL for fresh data
async function getLatestMessagePg(jid) {
    const pool = getPgPool();
    if (!pool) return null;

    try {
        const result = await pool.query(
            `SELECT key, message, message_timestamp, push_name
             FROM messages
             WHERE jid = $1
             ORDER BY message_timestamp DESC
             LIMIT 1`,
            [jid],
        );

        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        return {
            key: typeof row.key === 'string' ? JSON.parse(row.key) : row.key,
            message: typeof row.message === 'string' ? JSON.parse(row.message) : row.message,
            messageTimestamp: Number(row.message_timestamp),
            pushName: row.push_name || '',
        };
    } catch (err) {
        logger.error(`[messengerStore] PostgreSQL getLatestMessagePg error: ${err.message}`);
        return null;
    }
}

async function getMessagesPage(jid, liveMessages = [], options = {}) {
    if (isPostgresEnabled()) {
        return getMessagesPagePg(jid, liveMessages, options);
    }

    // Local JSON fallback
    const merged = mergeWithLive(jid, liveMessages);
    return paginateMessages(merged, options);
}

async function getMessagesPagePg(jid, liveMessages = [], options = {}) {
    const pool = getPgPool();
    if (!pool) {
        const merged = mergeWithLive(jid, liveMessages);
        return paginateMessages(merged, options);
    }

    const limitRaw = Number(options.limit || DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const before = options.before ? String(options.before) : '';

    try {
        let query;
        let params;

        if (before) {
            // Get timestamp of the 'before' message
            const beforeResult = await pool.query(
                `
                SELECT message_timestamp, msg_id FROM messages WHERE jid = $1 AND msg_id = $2
            `,
                [jid, before],
            );

            if (beforeResult.rows.length === 0) {
                return { messages: [], page: { limit, hasMore: false, before: null, total: 0 } };
            }

            const beforeTs = Number(beforeResult.rows[0].message_timestamp);
            const beforeId = beforeResult.rows[0].msg_id;
            query = `
                SELECT key, message, message_timestamp, push_name, msg_id
                FROM messages
                WHERE jid = $1 AND (message_timestamp < $2 OR (message_timestamp = $2 AND msg_id < $3))
                ORDER BY message_timestamp DESC, msg_id DESC
                LIMIT $4
            `;
            params = [jid, beforeTs, beforeId, limit];
        } else {
            query = `
                SELECT key, message, message_timestamp, push_name, msg_id
                FROM messages
                WHERE jid = $1
                ORDER BY message_timestamp DESC, msg_id DESC
                LIMIT $2
            `;
            params = [jid, limit];
        }

        const result = await pool.query(query, params);

        // Get total count for the JID
        const countResult = await pool.query(
            `
            SELECT COUNT(*) FROM messages WHERE jid = $1
        `,
            [jid],
        );

        const messages = result.rows
            .map((row) => ({
                key: typeof row.key === 'string' ? JSON.parse(row.key) : row.key,
                message: typeof row.message === 'string' ? JSON.parse(row.message) : row.message,
                messageTimestamp: Number(row.message_timestamp),
                pushName: row.push_name || '',
            }))
            .reverse(); // Return in chronological order

        // For cursor pagination, find next 'before' cursor
        let hasMore = false;
        let nextBefore = null;
        if (messages.length === limit) {
            hasMore = true;
            nextBefore = messages[0].key.id;
        }

        return {
            messages,
            page: {
                limit,
                hasMore,
                before: nextBefore,
                total: parseInt(countResult.rows[0].count, 10),
            },
        };
    } catch (err) {
        logger.error(`[messengerStore] PostgreSQL getMessagesPage error: ${err.message}`);
        const merged = mergeWithLive(jid, liveMessages);
        return paginateMessages(merged, options);
    }
}

function paginateMessages(merged, options) {
    const limitRaw = Number(options.limit || DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const before = options.before ? String(options.before) : '';

    let end = merged.length;
    if (before) {
        const idx = merged.findIndex((m) => String(m?.key?.id || '') === before);
        if (idx >= 0) end = idx;
    }

    const start = Math.max(0, end - limit);
    const slice = merged.slice(start, end);
    const hasMore = start > 0;
    const nextBefore = hasMore && slice.length ? String(slice[0].key.id) : null;

    return {
        messages: slice,
        page: {
            limit,
            hasMore,
            before: nextBefore,
            total: merged.length,
        },
    };
}

async function getMessageById(jid, msgId, liveMessages = []) {
    // ✅ P3: lib/messengerStore.js:605 — getMessageById async/sync mismatch with Postgres path
    // First check live memory
    const merged = mergeWithLive(jid, liveMessages);
    const found = merged.find((m) => String(m?.key?.id || '') === String(msgId));
    if (found) return found;

    // For PostgreSQL, also check the database
    if (isPostgresEnabled()) {
        return await getMessageByIdPg(jid, msgId);
    }

    return null;
}

async function getMessageByIdPg(jid, msgId) {
    const pool = getPgPool();
    if (!pool) return null;

    try {
        const result = await pool.query(
            `SELECT key, message, message_timestamp, push_name
             FROM messages
             WHERE jid = $1 AND msg_id = $2
             LIMIT 1`,
            [jid, msgId],
        );

        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        return {
            key: typeof row.key === 'string' ? JSON.parse(row.key) : row.key,
            message: typeof row.message === 'string' ? JSON.parse(row.message) : row.message,
            messageTimestamp: Number(row.message_timestamp),
            pushName: row.push_name || '',
        };
    } catch (err) {
        logger.error(`[messengerStore] PostgreSQL getMessageByIdPg error: ${err.message}`);
        return null;
    }
}

// ─── Schema Initialization ────────────────────────────────────────────────────

async function initMessagesSchema() {
    const pool = getPgPool();
    if (!pool) return;

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                jid VARCHAR(255) NOT NULL,
                msg_id VARCHAR(255) NOT NULL,
                key JSONB NOT NULL,
                message JSONB,
                message_timestamp BIGINT NOT NULL,
                push_name VARCHAR(255) DEFAULT '',
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (jid, msg_id)
            )
        `);

        // Create index for faster queries
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_jid_timestamp
            ON messages (jid, message_timestamp DESC)
        `);

        logger.custom('messengerStore', 'PostgreSQL schema initialized successfully.');
    } catch (err) {
        logger.error(`[messengerStore] PostgreSQL schema init error: ${err.message}`);
    }
}

module.exports = {
    persistMessages,
    listKnownJids,
    getLatestMessage,
    getLatestIncomingPushName,
    getMessagesPage,
    getMessageById,
    initMessagesSchema,
    softDeleteChat,
    getChatMedia,
};
