'use strict';

const config = require('../config');

function makeMessageCache({ ttlMs = 3 * 60 * 60 * 1000, sweepEveryMs = 5 * 60 * 1000 } = {}) {
    const messageCache = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, value] of messageCache.entries()) {
            if (now - (value?.timestamp || 0) > ttlMs) messageCache.delete(key);
        }
    }, sweepEveryMs);
    timer.unref?.();
    return messageCache;
}

function cacheMessagesUpsert(messageCache, messages) {
    if (!Array.isArray(messages)) return;
    for (const m of messages) {
        if (!m?.message || !m?.key?.id) continue;
        const cacheKey = `${m.key.remoteJid}-${m.key.id}`;
        messageCache.set(cacheKey, {
            message: m.message,
            timestamp: Date.now(),
        });
    }
}

function makeGetMessage({ messageCache, store }) {
    return async (key) => {
        const cacheKey = `${key.remoteJid}-${key.id}`;
        const cached = messageCache.get(cacheKey);
        if (cached?.message) return cached.message;
        const stored = store.loadMessage(key.remoteJid, key.id);
        return stored?.message || undefined;
    };
}

function bindAntiDelete(sock, messageCache, deps = {}) {
    const { store, logMessage, globalContextInfo, downloadContentFromMessage } = deps;
    if (!sock) throw new Error('bindAntiDelete: sock required');
    if (!messageCache) throw new Error('bindAntiDelete: messageCache required');
    if (!store) throw new Error('bindAntiDelete: store required');
    if (typeof downloadContentFromMessage !== 'function')
        throw new Error('bindAntiDelete: downloadContentFromMessage required');
    if (typeof logMessage !== 'function') throw new Error('bindAntiDelete: logMessage required');

    const onCacheMessagesUpsert = ({ messages }) => {
        cacheMessagesUpsert(messageCache, messages);
    };

    const onMessagesUpdate = async (updates) => {
        for (const { key, update } of updates) {
            if (key.remoteJid === 'status@broadcast') continue;
            if (key.fromMe) continue;

            const isGroup = key.remoteJid?.endsWith('@g.us');
            if ((isGroup && !config.ANTIDELETE_GROUP) || (!isGroup && !config.ANTIDELETE_PRIVATE))
                continue;

            const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
            const cacheKey = `${key.remoteJid}-${key.id}`;
            const original = messageCache.get(cacheKey);
            const sender = key.participant || key.remoteJid;
            const senderNum = sender.split('@')[0];

            // Deleted message
            if (update?.message === null) {
                if (!original?.message) continue;
                const msgObj = original.message;
                const mType = Object.keys(msgObj)[0];
                const label = isGroup ? `Group: ${key.remoteJid.split('@')[0]}` : 'Private';

                try {
                    await sock.sendMessage(ownerJid, {
                        text: `🗑️ *Deleted Message Recovered*\n👤 From: @${senderNum}\n📌 ${label}`,
                        contextInfo: globalContextInfo,
                        mentions: [sender],
                    });
                    if (['conversation', 'extendedTextMessage'].includes(mType)) {
                        const text = msgObj.conversation || msgObj.extendedTextMessage?.text || '';
                        await sock.sendMessage(ownerJid, { text, contextInfo: globalContextInfo });
                    } else if (
                        [
                            'imageMessage',
                            'videoMessage',
                            'audioMessage',
                            'stickerMessage',
                            'documentMessage',
                        ].includes(mType)
                    ) {
                        const stream = await downloadContentFromMessage(
                            msgObj[mType],
                            mType.replace('Message', ''),
                        );
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const field = mType.replace('Message', '');
                        const payload = { [field]: buffer, contextInfo: globalContextInfo };
                        if (msgObj[mType]?.caption) payload.caption = msgObj[mType].caption;
                        await sock.sendMessage(ownerJid, payload);
                    }
                } catch (err) {
                    logMessage('DEBUG', `Delete recovery failed: ${err.message}`);
                }
            }

            // Edited message
            const editedMsg = update?.message?.protocolMessage?.editedMessage;
            if (editedMsg) {
                const oldText =
                    original?.message?.conversation ||
                    original?.message?.extendedTextMessage?.text ||
                    '(unknown)';
                const newText =
                    editedMsg.conversation || editedMsg.extendedTextMessage?.text || '(media)';
                const label = isGroup ? `Group: ${key.remoteJid.split('@')[0]}` : 'Private';
                try {
                    await sock.sendMessage(ownerJid, {
                        text: `✏️ *Edited Message*\n👤 From: @${senderNum}\n📌 ${label}\n\n*Before:* ${oldText}\n*After:* ${newText}`,
                        contextInfo: globalContextInfo,
                        mentions: [sender],
                    });
                } catch (err) {
                    logMessage('DEBUG', `Edit recovery failed: ${err.message}`);
                }
            }
        }
    };

    const onMessagesDelete = async (item) => {
        try {
            logMessage('DEBUG', 'messages.delete triggered');
            const keys = Array.isArray(item) ? item.map((i) => i.key) : item?.keys || [];
            for (const key of keys) {
                const from = key.remoteJid;
                const isGroupChat = from?.endsWith?.('@g.us');
                if (
                    (isGroupChat && !config.ANTIDELETE_GROUP) ||
                    (!isGroupChat && !config.ANTIDELETE_PRIVATE)
                )
                    continue;

                const cacheKey = `${from}-${key.id}`;
                const cached = messageCache.get(cacheKey);
                const storedMsg = cached?.message || store.loadMessage(from, key.id)?.message;
                if (!storedMsg) {
                    logMessage('WARN', `No cached message for anti-delete: ${key.id}`);
                    continue;
                }

                const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
                const sender = key.participant || from;
                const senderName = (sender || '').split('@')[0];
                const msgType = Object.keys(storedMsg)[0];
                const caption = `🗑️ *Anti-Delete Alert!*\n\n👤 *Sender:* @${senderName}\n📌 *Chat:* ${isGroupChat ? 'Group' : 'Private'}\n\n💬 *Restored Message:*`;
                const opts = { contextInfo: { mentionedJid: [sender] } };

                try {
                    if (['conversation', 'extendedTextMessage'].includes(msgType)) {
                        const text =
                            storedMsg.conversation || storedMsg.extendedTextMessage?.text || '';
                        await sock.sendMessage(ownerJid, {
                            text: `${caption}\n\n${text}`,
                            ...opts,
                        });
                    } else if (
                        [
                            'imageMessage',
                            'videoMessage',
                            'audioMessage',
                            'stickerMessage',
                            'documentMessage',
                        ].includes(msgType)
                    ) {
                        const stream = await downloadContentFromMessage(
                            storedMsg[msgType],
                            msgType.replace('Message', ''),
                        );
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const field = msgType.replace('Message', '');
                        const payload = { [field]: buffer, ...opts };
                        if (storedMsg[msgType]?.caption)
                            payload.caption = `${caption}\n\n${storedMsg[msgType].caption}`;
                        else payload.caption = caption;
                        await sock.sendMessage(ownerJid, payload);
                    } else {
                        await sock.sendMessage(ownerJid, {
                            text: `${caption}\n\n[${msgType}]`,
                            ...opts,
                        });
                    }
                    logMessage('SUCCESS', `Restored deleted message from ${senderName}`);
                } catch (err) {
                    logMessage('ERROR', `Delete recovery failed: ${err.message}`);
                }
            }
        } catch (err) {
            logMessage('ERROR', `Anti-Delete Error: ${err.stack || err.message}`);
        }
    };

    return {
        onCacheMessagesUpsert,
        onMessagesUpdate,
        onMessagesDelete,
    };
}

module.exports = {
    makeMessageCache,
    cacheMessagesUpsert,
    makeGetMessage,
    bindAntiDelete,
};

