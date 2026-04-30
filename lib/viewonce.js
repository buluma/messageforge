'use strict';

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];
const queue = [];
let activeJobs = 0;

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeOwnerJid(ownerNumber) {
    const raw = String(ownerNumber || '').trim();
    if (!raw) return '';
    if (raw.includes('@')) return raw.replace(/:\d+@/, '@');
    const digits = raw.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : '';
}

function unwrapMessageContainer(message) {
    let current = message || {};
    let viewOnceWrapped = false;
    for (let i = 0; i < 5; i += 1) {
        const next =
            current.viewOnceMessageV2Extension?.message ||
            current.viewOnceMessageV2?.message ||
            current.viewOnceMessage?.message ||
            current.ephemeralMessage?.message;
        if (!next || next === current) break;
        if (
            current.viewOnceMessageV2Extension?.message ||
            current.viewOnceMessageV2?.message ||
            current.viewOnceMessage?.message
        ) {
            viewOnceWrapped = true;
        }
        current = next;
    }
    return { message: current, viewOnceWrapped };
}

function findViewOnceMedia(message, { allowPlainMedia = false } = {}) {
    const { message: unwrapped, viewOnceWrapped } = unwrapMessageContainer(message);
    const type = MEDIA_TYPES.find((key) => unwrapped?.[key]);
    if (type && (viewOnceWrapped || allowPlainMedia)) {
        return {
            type,
            mediaType: type.replace('Message', ''),
            content: unwrapped[type],
            message: unwrapped,
        };
    }

    return null;
}

function getDeclaredMediaLength(content) {
    const raw = content?.fileLength || content?.fileLengthHigh;
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'bigint') return Number(raw);
    if (typeof raw === 'object' && typeof raw.toNumber === 'function') return raw.toNumber();
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function downloadMediaBuffer(content, mediaType, { maxBytes } = {}) {
    const limit = toPositiveInt(maxBytes, 64 * 1024 * 1024);
    const declaredLength = getDeclaredMediaLength(content);
    if (declaredLength > limit) {
        throw new Error(`media exceeds Anti-VV size limit (${declaredLength}/${limit} bytes)`);
    }

    const stream = await downloadContentFromMessage(content, mediaType);
    const chunks = [];
    let total = 0;

    for await (const chunk of stream) {
        total += chunk.length;
        if (total > limit) {
            throw new Error(`media exceeds Anti-VV size limit (${total}/${limit} bytes)`);
        }
        chunks.push(chunk);
    }

    return Buffer.concat(chunks, total);
}

async function sendRevealedMedia(sock, jid, reveal, opts = {}) {
    const { type, content, buffer, caption = '' } = reveal;
    const quoted = opts.quoted ? { quoted: opts.quoted } : undefined;
    const mimetype = content?.mimetype;

    if (type === 'imageMessage') {
        return sock.sendMessage(jid, {
            image: buffer,
            caption,
            mimetype: mimetype || 'image/jpeg',
        }, quoted);
    }

    if (type === 'videoMessage') {
        return sock.sendMessage(jid, {
            video: buffer,
            caption,
            mimetype: mimetype || 'video/mp4',
        }, quoted);
    }

    if (type === 'audioMessage') {
        await sock.sendMessage(jid, {
            audio: buffer,
            mimetype: mimetype || 'audio/ogg',
            ptt: content?.ptt || false,
        }, quoted);
        if (caption && opts.audioCaptionAsText) {
            return sock.sendMessage(jid, { text: caption }, quoted);
        }
    }

    return null;
}

function enqueueAntiViewOnceJob(job, options = {}) {
    const concurrency = toPositiveInt(options.concurrency, 1);
    const maxQueue = toPositiveInt(options.maxQueue, 30);

    if (queue.length >= maxQueue) {
        if (typeof options.onDrop === 'function') options.onDrop();
        return false;
    }

    queue.push({ job, options, concurrency });
    setImmediate(drainQueue);
    return true;
}

function drainQueue() {
    const next = queue[0];
    if (!next || activeJobs >= next.concurrency) return;

    queue.shift();
    activeJobs += 1;

    Promise.resolve()
        .then(next.job)
        .catch((err) => {
            if (typeof next.options.onError === 'function') next.options.onError(err);
        })
        .finally(() => {
            activeJobs -= 1;
            drainQueue();
        });

    drainQueue();
}

module.exports = {
    downloadMediaBuffer,
    enqueueAntiViewOnceJob,
    findViewOnceMedia,
    normalizeOwnerJid,
    sendRevealedMedia,
};
