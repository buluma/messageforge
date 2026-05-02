'use strict';

/**
 * Shared media-download helper for MessageForge plugins.
 * Uses downloadContentFromMessage (the correct Baileys API).
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../config');

const TYPE_MAP = {
    imageMessage:     'image',
    videoMessage:     'video',
    audioMessage:     'audio',
    documentMessage:  'document',
    stickerMessage:   'sticker',
    ptvMessage:       'video',
};

const MEDIA_MAX_BYTES = config.MEDIA_MAX_MB * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60 * 1000;

/**
 * Download a media message into a Buffer.
 * @param {object} msgContent  The specific typed sub-message (e.g. msg.imageMessage)
 * @param {string} mediaType   Baileys media type string ('image', 'video', 'audio', 'sticker', 'document')
 * @returns {Promise<Buffer>}
 */
async function dlBuffer(msgContent, mediaType) {
    // ✅ P3: lib/dlmedia.js — Promise.race 60s timeout on download
    const streamPromise = (async () => {
        const stream = await downloadContentFromMessage(msgContent, mediaType);
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of stream) {
            totalSize += chunk.length;
            if (totalSize > MEDIA_MAX_BYTES) {
                throw new Error(`Media download exceeded maximum size of ${config.MEDIA_MAX_MB}MB`);
            }
            chunks.push(chunk);
        }
        const buf = Buffer.concat(chunks);
        if (!buf.length) throw new Error('Downloaded media buffer is empty');
        return buf;
    })();

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Media download timed out after 60s')), DOWNLOAD_TIMEOUT_MS);
    });

    return Promise.race([streamPromise, timeoutPromise]);
}

/**
 * Auto-detect the media type from a message object and download it.
 * Searches the message top-level first, then inside quoted context.
 * @param {object} msgObj  message.message  (the inner message)
 * @returns {Promise<{ buffer: Buffer, mediaType: string, msgContent: object }>}
 */
async function dlAuto(msgObj) {
    // Check direct message
    for (const [key, type] of Object.entries(TYPE_MAP)) {
        if (msgObj?.[key]) {
            return { buffer: await dlBuffer(msgObj[key], type), mediaType: type, msgContent: msgObj[key] };
        }
    }
    // Check inside quoted context
    const quoted = msgObj?.extendedTextMessage?.contextInfo?.quotedMessage;
    for (const [key, type] of Object.entries(TYPE_MAP)) {
        if (quoted?.[key]) {
            return { buffer: await dlBuffer(quoted[key], type), mediaType: type, msgContent: quoted[key] };
        }
    }
    throw new Error('No downloadable media found in this message');
}

module.exports = { dlBuffer, dlAuto, TYPE_MAP };
