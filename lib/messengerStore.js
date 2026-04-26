'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data/messenger-history');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_PER_CHAT = Number(process.env.MESSENGER_HISTORY_MAX || 3000);

const writeQueue = new Map();
let indexLoaded = false;
const indexSet = new Set();

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
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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
    safeWriteJson(INDEX_FILE, Array.from(indexSet));
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
            messageTimestamp: raw.messageTimestamp || Math.floor(Date.now() / 1000),
            pushName: raw.pushName || '',
        };
    } catch {
        return null;
    }
}

function queueByJid(jid, writer) {
    const prev = writeQueue.get(jid) || Promise.resolve();
    const next = prev
        .then(writer)
        .catch(() => {})
        .finally(() => {
            if (writeQueue.get(jid) === next) writeQueue.delete(jid);
        });
    writeQueue.set(jid, next);
    return next;
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

async function persistMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    ensureDir();

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
        writes.push(
            queueByJid(jid, async () => {
                const existing = readChatMessages(jid);
                const merged = mergeAndSortMessages(existing, incoming);
                const trimmed =
                    merged.length > MAX_PER_CHAT
                        ? merged.slice(merged.length - MAX_PER_CHAT)
                        : merged;
                writeChatMessages(jid, trimmed);
                addToIndex(jid);
            }),
        );
    }

    await Promise.all(writes);
}

function listKnownJids(liveJids = []) {
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

function getLatestMessage(jid, liveMessages = []) {
    const persisted = readChatMessages(jid);
    const merged = mergeAndSortMessages(persisted, liveMessages);
    if (!merged.length) return null;
    return merged[merged.length - 1];
}

function getMessagesPage(jid, liveMessages = [], options = {}) {
    const persisted = readChatMessages(jid);
    const merged = mergeAndSortMessages(persisted, liveMessages);

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

function getMessageById(jid, msgId, liveMessages = []) {
    const persisted = readChatMessages(jid);
    const merged = mergeAndSortMessages(persisted, liveMessages);
    return merged.find((m) => String(m?.key?.id || '') === String(msgId)) || null;
}

module.exports = {
    persistMessages,
    listKnownJids,
    getLatestMessage,
    getMessagesPage,
    getMessageById,
};
