'use strict';

/**
 * Shared media-download helper for MessageForge plugins.
 * Uses downloadContentFromMessage (the correct Baileys API).
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../config');

const TYPE_MAP = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
    ptvMessage: 'video',
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
    let stream;
    let isFinished = false;

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            if (isFinished) return;
            if (stream && typeof stream.destroy === 'function') {
                try {
                    stream.destroy();
                } catch {
                    /* ignore */
                }
            }
            reject(new Error('Media download timed out after 60s'));
        }, DOWNLOAD_TIMEOUT_MS);
    });

    const streamPromise = (async () => {
        try {
            stream = await downloadContentFromMessage(msgContent, mediaType);
            const chunks = [];
            let totalSize = 0;

            for await (const chunk of stream) {
                totalSize += chunk.length;
                if (totalSize > MEDIA_MAX_BYTES) {
                    if (typeof stream.destroy === 'function') stream.destroy();
                    throw new Error(
                        `Media download exceeded maximum size of ${config.MEDIA_MAX_MB}MB`,
                    );
                }
                chunks.push(chunk);
            }

            isFinished = true;
            const buf = Buffer.concat(chunks);
            if (!buf.length) throw new Error('Downloaded media buffer is empty');
            return buf;
        } catch (err) {
            isFinished = true;
            throw err;
        }
    })();

    return Promise.race([streamPromise, timeoutPromise]);
}

/**
 * Auto-detect the media type from a message object and download it.
 * Searches the message top-level first, then inside quoted context.
 * @param {object} msgObj  message.message  (the inner message)
 * @returns {Promise<{ buffer: Buffer, mediaType: string, msgContent: object }>}
 */
function unwrapMessage(msg) {
    if (!msg) return msg;
    if (msg.ephemeralMessage) return unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage) return unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2) return unwrapMessage(msg.viewOnceMessageV2.message);
    if (msg.documentWithCaptionMessage)
        return unwrapMessage(msg.documentWithCaptionMessage.message);
    return msg;
}

async function dlAuto(msgObj) {
    let unwrapped = unwrapMessage(msgObj);

    // Check direct message
    for (const [key, type] of Object.entries(TYPE_MAP)) {
        if (unwrapped?.[key]) {
            return {
                buffer: await dlBuffer(unwrapped[key], type),
                mediaType: type,
                msgContent: unwrapped[key],
            };
        }
    }
    // Check inside quoted context
    const quoted = unwrapped?.extendedTextMessage?.contextInfo?.quotedMessage;
    const unwrappedQuoted = unwrapMessage(quoted);
    for (const [key, type] of Object.entries(TYPE_MAP)) {
        if (unwrappedQuoted?.[key]) {
            return {
                buffer: await dlBuffer(unwrappedQuoted[key], type),
                mediaType: type,
                msgContent: unwrappedQuoted[key],
            };
        }
    }
    throw new Error('No downloadable media found in this message');
}

module.exports = { dlBuffer, dlAuto, TYPE_MAP };
