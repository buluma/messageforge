'use strict';

/**
 * lib/statusManager.js
 * Status@broadcast handler for gifted-baileys (npm:gifted-baileys@^2.5.8)
 *
 * Root-cause fix (confirmed from Heroku logs):
 *   statusJidList must contain @s.whatsapp.net (phone) JIDs, NOT @lid JIDs.
 *   gifted-baileys exposes m.key.participantPn for exactly this purpose.
 *   Previous code used m.key.participant (@lid) → WhatsApp silently rejected it.
 */

const config = require('../config');
const logger = require('./logger');
const { isFavorite } = require('./favorites');

// ─── Per-process dedup set ─────────────────────────────────────────────────────
// Prevents triple-processing when Bad MAC errors cause the same status to be
// retransmitted 2-3 times within the same session (seen in Heroku logs).
const _seenIds = new Set();
const VALID_STATUS_MODES = new Set(['all', 'favorites']);

function toRuntimeBool(val, fallback) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'boolean') return val;
    const norm = String(val).trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(norm)) return true;
    if (['false', '0', 'off', 'no'].includes(norm)) return false;
    return fallback;
}

function normalizeStatusMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    return VALID_STATUS_MODES.has(normalized) ? normalized : null;
}

function getEffectiveStatusSettings() {
    const flags = global.autoStatusFlags || {};
    return {
        seen: toRuntimeBool(flags.seen, config.AUTO_STATUS_SEEN),
        react: toRuntimeBool(flags.react, config.AUTO_STATUS_REACT),
        mode: normalizeStatusMode(flags.mode) || normalizeStatusMode(config.AUTO_STATUS_MODE) || 'all',
    };
}

// ─── Message-type unwrapper ────────────────────────────────────────────────────
function unwrapStatus(m) {
    let inner = { ...(m.message || {}) };
    if (inner.ephemeralMessage)  inner = { ...(inner.ephemeralMessage.message  || inner) };
    if (inner.viewOnceMessageV2) inner = { ...(inner.viewOnceMessageV2.message || inner) };
    if (inner.viewOnceMessage)   inner = { ...(inner.viewOnceMessage.message   || inner) };

    const ORDER = [
        'imageMessage', 'videoMessage', 'audioMessage',
        'extendedTextMessage', 'conversation', 'stickerMessage',
        'documentMessage', 'reactionMessage',
    ];
    const msgType = ORDER.find(k => inner[k]) || Object.keys(inner)[0] || 'unknown';
    return { inner, msgType };
}

// ─── Resolve the phone JID from a status key ──────────────────────────────────
// gifted-baileys puts the @s.whatsapp.net JID in key.participantPn when the
// sender is a LID-migrated account. Always prefer that over key.participant.
function resolvePhoneJid(key) {
    // participantPn is the phone JID gifted-baileys attaches alongside the LID
    if (key.participantPn && key.participantPn.includes('@s.whatsapp.net')) {
        return key.participantPn;
    }
    // If participant is already a phone JID use it directly
    if (key.participant && key.participant.includes('@s.whatsapp.net')) {
        return key.participant;
    }
    // participant is a @lid — try the global LID→phone map built from contacts events
    if (key.participant && key.participant.includes('@lid') && global.lidJidMap?.has(key.participant)) {
        return global.lidJidMap.get(key.participant);
    }
    // Last resort: return whatever we have (may still be @lid, but we tried)
    return key.participant || null;
}

function resolveStatusInboxJid(sock) {
    const selfJid = sock.user?.id?.includes(':')
        ? `${sock.user.id.split(':')[0]}@s.whatsapp.net`
        : (sock.user?.id || global.botJid || null);
    const rawTarget = String(config.STATUS_INBOX_JID || '').trim();
    if (!rawTarget || rawTarget.toLowerCase() === 'me') return selfJid;
    if (rawTarget.toLowerCase() === 'owner' && config.OWNER_NUMBER) {
        return String(config.OWNER_NUMBER).includes('@')
            ? String(config.OWNER_NUMBER)
            : `${String(config.OWNER_NUMBER).replace(/\D/g, '')}@s.whatsapp.net`;
    }
    if (rawTarget.includes('@')) return rawTarget;
    const digits = rawTarget.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : selfJid;
}

// ─── Main handler ──────────────────────────────────────────────────────────────
async function handleStatusBroadcast(sock, m, saveMedia) {
    try {
        const statusId    = m.key.id;
        const participant = m.key.participant;   // may be @lid

        // Skip own status echoes (participant is null when it is our own post)
        if (!participant) return;

        // ── Dedup: skip if we already handled this status ID this session ───
        if (_seenIds.has(statusId)) {
            logger.custom('StatusMgr', `⏭️ Duplicate status skipped: ${statusId}`);
            return;
        }
        _seenIds.add(statusId);
        // Prevent unbounded growth — keep only the last 500 IDs
        if (_seenIds.size > 500) {
            const oldest = _seenIds.values().next().value;
            _seenIds.delete(oldest);
        }

        const { inner, msgType } = unwrapStatus(m);

        // THE fix: use the phone JID (participantPn) not the LID for all delivery
        const phoneJid = resolvePhoneJid(m.key);
        const botRaw   = sock.user?.id || global.botJid || '';
        const botPhone = botRaw.replace(/:\d+@/, '@');   // strip :device suffix → bare phone JID

        const effective = getEffectiveStatusSettings();

        logger.custom('StatusMgr', `>>> id=${statusId} lid=${participant} phoneJid=${phoneJid} type=${msgType}`);
        logger.custom('StatusMgr', `⚙️ view=${effective.seen} react=${effective.react} reply=${config.AUTO_STATUS_REPLY}`);

        // ── Check favorite mode ──────────────────────────────────────────────────
        const isFavoriteMode = effective.mode === 'favorites';
        const senderJid = phoneJid || participant;
        const isFav = isFavoriteMode ? isFavorite(senderJid) : true;
        const modeLabel = isFavoriteMode
            ? (isFav ? '⭐ FAVORITE' : '⏭️ SKIP (not favorite)')
            : '👤 ALL';
        logger.custom('StatusMgr', `🔍 Mode: ${effective.mode} | ${modeLabel}`);

        // Skip if in favorites mode but sender is not a favorite
        if (isFavoriteMode && !isFav) {
            logger.custom('StatusMgr', `⏭️ Skipping non-favorite status: ${senderJid}`);
        } else {
            // ── 1. Auto View ───────────────────────────────────────────────────────
            if (effective.seen) {
                let viewDone = false;

                // sendReceipt is the correct gifted-baileys API for status read receipts
                try {
                    await sock.sendReceipt('status@broadcast', participant, [statusId], 'read');
                    logger.custom('StatusMgr', '✅ VIEW OK via sendReceipt');
                    viewDone = true;
                } catch (e1) {
                    logger.warn(`[StatusMgr] sendReceipt failed: ${e1.message}`);
                }

                // Fallback to readMessages if sendReceipt is not available
                if (!viewDone) {
                    try {
                        await sock.readMessages([{
                            remoteJid:   'status@broadcast',
                            id:          statusId,
                            participant: participant,
                            fromMe:      false,
                        }]);
                        logger.custom('StatusMgr', '✅ VIEW OK via readMessages');
                        viewDone = true;
                    } catch (e2) {
                        logger.warn(`[StatusMgr] readMessages failed: ${e2.message}`);
                    }
                }

                if (!viewDone) logger.error('[StatusMgr] ❌ VIEW FAILED — all methods exhausted');
            }

            // ── 2. Auto React ────────────────────────��─────────────────────────────
            if (effective.react) {
                const emojis      = (config.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍,👏').split(',');
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)].trim() || '❤️';

                // THE FIX: statusJidList must use @s.whatsapp.net JIDs, never @lid.
                // WhatsApp silently drops reactions when LID JIDs appear in this list.
                const statusJidList = [phoneJid, botPhone].filter(Boolean);

                logger.custom('StatusMgr', `🔄 REACT emoji=${randomEmoji} statusJidList=${JSON.stringify(statusJidList)}`);

                try {
                    await sock.sendMessage(
                        'status@broadcast',
                        {
                            react: {
                                text: randomEmoji,
                                key:  m.key,      // pass original key as-is (gifted-baileys requirement)
                            },
                        },
                        { statusJidList }
                    );
                    logger.custom('StatusMgr', '✅ REACT sent OK');
                } catch (e) {
                    logger.error(`[StatusMgr] ❌ REACT FAILED: ${e.message}`);
                }
            }

            // ── 3. Auto Reply ──────────────────────────────────────────────────────
            if (config.AUTO_STATUS_REPLY && !m.key.fromMe) {
                // Send reply to the phone JID, not the LID
                const replyTo = phoneJid || participant;
                try {
                    await sock.sendMessage(
                        replyTo,
                        {
                            text: config.AUTO_STATUS_MSG || 'Seen by MessageForge 💖',
                            contextInfo: {
                                stanzaId:      statusId,
                                participant:   replyTo,
                                quotedMessage: inner,
                            },
                        }
                    );
                    logger.custom('StatusMgr', '✅ REPLY sent OK');
                } catch (e) {
                    logger.warn(`[StatusMgr] ⚠️ REPLY failed: ${e.message}`);
                }
            }
        }

        // ── 4. Status Saver (always runs regardless of favorite mode) ─────────────────────
        if (config.Status_Saver === 'true' && typeof saveMedia === 'function') {
            try {
                const displayJid   = phoneJid || participant;
                const userName     = await sock.getName?.(displayJid) || displayJid.split('@')[0];
                const fromJid      = String(displayJid || '');
                const fromNumber   = fromJid.includes('@')
                    ? fromJid.split('@')[0].replace(/:\d+$/, '')
                    : fromJid;
                const tsRaw        = m.messageTimestamp;
                const tsSeconds    = typeof tsRaw === 'number'
                    ? tsRaw
                    : (typeof tsRaw === 'bigint' ? Number(tsRaw) : Number(tsRaw || 0));
                const tsIso        = tsSeconds
                    ? new Date(tsSeconds * 1000).toISOString()
                    : new Date().toISOString();
                const header       = 'AUTO STATUS SAVER';
                let   caption      =
                    `${header}\n\n` +
                    `*🩵 Status From:* ${userName}\n` +
                    `*🆔 JID:* ${fromJid}\n` +
                    `*📞 Number:* ${fromNumber}\n` +
                    `*🧾 Status ID:* ${statusId}\n` +
                    `*🕒 Time:* ${tsIso}`;

                switch (msgType) {
                    case 'imageMessage':
                    case 'videoMessage':
                        if (inner[msgType]?.caption) caption += `\n*🩵 Caption:* ${inner[msgType].caption}`;
                        await saveMedia({ message: inner }, msgType, sock, caption);
                        break;
                    case 'audioMessage':
                        caption += '\n*🩵 Audio Status*';
                        await saveMedia({ message: inner }, msgType, sock, caption);
                        break;
                    case 'extendedTextMessage':
                        caption =
                            `${header}\n\n` +
                            `*🩵 Status From:* ${userName}\n` +
                            `*🆔 JID:* ${fromJid}\n` +
                            `*📞 Number:* ${fromNumber}\n` +
                            `*🧾 Status ID:* ${statusId}\n` +
                            `*🕒 Time:* ${tsIso}\n\n` +
                            `${inner.extendedTextMessage?.text || ''}`;
                        await sock.sendMessage(resolveStatusInboxJid(sock), { text: caption });
                        break;
                    default:
                        logger.warn(`[StatusMgr] ℹ️ No saver handler for type: ${msgType}`);
                        break;
                }

                if (config.STATUS_REPLY === 'true') {
                    const replyMsg = config.STATUS_MSG || 'MessageForge 💖 SUCCESSFULLY VIEWED YOUR STATUS';
                    await sock.sendMessage(phoneJid || participant, { text: replyMsg });
                }

                logger.custom('StatusMgr', `✅ Status saved: ${statusId}`);
            } catch (e) {
                logger.error(`[StatusMgr] ❌ Save failed: ${e.message}`);
            }
        }

    } catch (e) {
        logger.error(`[StatusMgr] ❌ Handler error: ${e.message}\n${e.stack}`);
    }
}

// ─── Runtime flag setter (used by autostatus.js plugin) ───────────────────────
function getAutoStatusSettings() {
    const effective = getEffectiveStatusSettings();
    return {
        autoviewStatus:   String(effective.seen),
        autoLikeStatus:   String(effective.react),
        autoReplyStatus:  String(config.AUTO_STATUS_REPLY),
        statusReplyText:  config.AUTO_STATUS_MSG      || 'Seen by MessageForge 💖',
        statusLikeEmojis: config.CUSTOM_REACT_EMOJIS  || '❤️,🔥,💯,😍,👏',
        statusSaver:      String(config.Status_Saver  || 'false'),
        statusInboxJid:   config.STATUS_INBOX_JID || 'me',
        statusSaverReply: String(config.STATUS_REPLY  || 'false'),
        statusSaverMsg:   config.AUTO_STATUS_MSG    || 'MessageForge 💖 SUCCESSFULLY VIEWED YOUR STATUS',
        statusMode:    effective.mode,
    };
}

module.exports = { handleStatusBroadcast, getAutoStatusSettings, unwrapStatus };
