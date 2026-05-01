'use strict';

const { jidNormalizedUser } = require('@whiskeysockets/baileys');

const PRIVACY_HELP = [
    'Usage: .privacy <field> [value]',
    '',
    'Fields:',
    '- lastseen: all | contacts | contact_blacklist | none',
    '- online: all | match_last_seen',
    '- profile: all | contacts | contact_blacklist | none',
    '- status: all | contacts | contact_blacklist | none',
    '- readreceipts: all | none',
    '- groupsadd: all | contacts | contact_blacklist',
    '- disappearing: 0 | 86400 | 604800 | 7776000',
    '',
    'Examples:',
    '.privacy lastseen contacts',
    '.privacy online match_last_seen',
    '.privacy readreceipts none',
    '.privacy disappearing 86400',
].join('\n');

function normalizePhone(input) {
    return String(input || '').replace(/\D/g, '');
}

function toTimestampSeconds(v) {
    if (typeof v === 'number') return Math.floor(v);
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    if (typeof v === 'object' && v && typeof v.low === 'number') return Number(v.low);
    return Math.floor(Date.now() / 1000);
}

function quotedInfo(message) {
    return message?.message?.extendedTextMessage?.contextInfo || null;
}

function lastMessagePatch(message, fallbackJid) {
    const q = quotedInfo(message);
    if (q?.stanzaId) {
        return {
            key: {
                remoteJid: q.remoteJid || fallbackJid,
                id: q.stanzaId,
                fromMe: false,
                participant: q.participant,
            },
            messageTimestamp: Math.floor(Date.now() / 1000),
        };
    }

    return {
        key: {
            remoteJid: message?.key?.remoteJid || fallbackJid,
            id: message?.key?.id,
            fromMe: !!message?.key?.fromMe,
            participant: message?.key?.participant,
        },
        messageTimestamp: toTimestampSeconds(message?.messageTimestamp),
    };
}

function quotedStarMessage(message, sock) {
    const q = quotedInfo(message);
    if (!q?.stanzaId) return null;

    const myJid = jidNormalizedUser(sock?.user?.id || '');
    const participant = jidNormalizedUser(q.participant || '');
    return {
        id: q.stanzaId,
        fromMe: !!(myJid && participant && myJid === participant),
    };
}

async function runPrivacyCommand(sock, ctx, args) {
    const field = (args[0] || '').toLowerCase();
    const value = (args[1] || '').toLowerCase();

    if (!field) {
        const current = await sock.fetchPrivacySettings(true).catch(() => null);
        const summary = current
            ? [
                `lastseen: ${current.last || 'unknown'}`,
                `online: ${current.online || 'unknown'}`,
                `profile: ${current.profile || 'unknown'}`,
                `status: ${current.status || 'unknown'}`,
                `readreceipts: ${current.readreceipts || 'unknown'}`,
                `groupsadd: ${current.groupadd || 'unknown'}`,
                `disappearing: ${current.disappearing_mode || 'unknown'}`,
            ].join('\n')
            : 'Could not fetch privacy settings.';
        return ctx.reply(`🔐 *Privacy Settings*\n\n${summary}\n\n${PRIVACY_HELP}`);
    }

    if (field === 'disappearing') {
        const seconds = Number(args[1]);
        const allowed = new Set([0, 86400, 604800, 7776000]);
        if (!allowed.has(seconds)) {
            return ctx.reply('❌ Invalid disappearing value. Use one of: 0, 86400, 604800, 7776000');
        }
        await sock.updateDefaultDisappearingMode(seconds);
        return ctx.reply(`✅ Default disappearing mode updated to *${seconds}* seconds.`);
    }

    const handlers = {
        lastseen: {
            valid: new Set(['all', 'contacts', 'contact_blacklist', 'none']),
            update: (v) => sock.updateLastSeenPrivacy(v),
        },
        online: {
            valid: new Set(['all', 'match_last_seen']),
            update: (v) => sock.updateOnlinePrivacy(v),
        },
        profile: {
            valid: new Set(['all', 'contacts', 'contact_blacklist', 'none']),
            update: (v) => sock.updateProfilePicturePrivacy(v),
        },
        status: {
            valid: new Set(['all', 'contacts', 'contact_blacklist', 'none']),
            update: (v) => sock.updateStatusPrivacy(v),
        },
        readreceipts: {
            valid: new Set(['all', 'none']),
            update: (v) => sock.updateReadReceiptsPrivacy(v),
        },
        groupsadd: {
            valid: new Set(['all', 'contacts', 'contact_blacklist']),
            update: (v) => sock.updateGroupsAddPrivacy(v),
        },
    };

    const item = handlers[field];
    if (!item) return ctx.reply(PRIVACY_HELP);
    if (!item.valid.has(value)) {
        return ctx.reply(`❌ Invalid value for ${field}.\n\n${PRIVACY_HELP}`);
    }

    await item.update(value);
    return ctx.reply(`✅ Privacy updated: *${field}* → *${value}*`);
}

module.exports = {
    commands: [
        'privacy',
        'chatarchive', 'chatunarchive',
        'chatmute', 'chatunmute',
        'chatread', 'chatunread',
        'chatstar', 'chatunstar',
        'chatdelete', 'chatclear',
        'broadcastlist', 'blistinfo',
        'removepp', 'clearpp',
        'msgedit',
        'paircode',
        'waon', 'statusof', 'bizprofileof', 'ppurlof', 'presub', 'sendpresence', 'readmsg',
    ],
    description: 'Baileys gap commands (privacy/chat/broadcast/pairing/edit/primitives)',
    permission: 'owner',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const cmd = (ctx.command || '').toLowerCase();
        const jid = ctx.jid;

        if (cmd === 'privacy') {
            return runPrivacyCommand(sock, ctx, args).catch((e) => ctx.reply(`❌ Privacy update failed: ${e.message}`));
        }

        if (cmd === 'chatarchive' || cmd === 'chatunarchive') {
            await sock.chatModify({ archive: cmd === 'chatarchive', lastMessages: [lastMessagePatch(message, jid)] }, jid);
            return ctx.reply(cmd === 'chatarchive' ? '✅ Chat archived.' : '✅ Chat unarchived.');
        }

        if (cmd === 'chatmute' || cmd === 'chatunmute') {
            if (ctx.isGroup) return ctx.reply('❌ This command is for private chats only.');
            if (cmd === 'chatunmute') {
                await sock.chatModify({ mute: null }, jid);
                return ctx.reply('✅ Chat unmuted.');
            }
            const duration = (args[0] || '8h').toLowerCase();
            const map = { '8h': 8 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000 };
            const ms = map[duration] ?? Number(args[0]);
            if (!Number.isFinite(ms) || ms <= 0) {
                return ctx.reply('❌ Usage: .chatmute <8h|1d|7d|milliseconds>');
            }
            await sock.chatModify({ mute: ms }, jid);
            return ctx.reply(`✅ Chat muted for ${duration}.`);
        }

        if (cmd === 'chatread' || cmd === 'chatunread') {
            await sock.chatModify({ markRead: cmd === 'chatread', lastMessages: [lastMessagePatch(message, jid)] }, jid);
            return ctx.reply(cmd === 'chatread' ? '✅ Chat marked as read.' : '✅ Chat marked as unread.');
        }

        if (cmd === 'chatstar' || cmd === 'chatunstar') {
            const starMsg = quotedStarMessage(message, sock);
            if (!starMsg) return ctx.reply('❌ Reply to a message to star/unstar it.');
            await sock.chatModify({ star: { messages: [starMsg], star: cmd === 'chatstar' } }, jid);
            return ctx.reply(cmd === 'chatstar' ? '✅ Message starred.' : '✅ Message unstarred.');
        }

        if (cmd === 'chatdelete') {
            await sock.chatModify({
                delete: true,
                lastMessages: [lastMessagePatch(message, jid)],
            }, jid);
            return ctx.reply('✅ Chat deleted from your chat list.');
        }

        if (cmd === 'chatclear') {
            const q = quotedInfo(message);
            if (!q?.stanzaId) return ctx.reply('❌ Reply to a message to clear it for yourself.');
            await sock.chatModify({
                clear: {
                    messages: [{
                        id: q.stanzaId,
                        fromMe: false,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                    }],
                },
            }, jid);
            return ctx.reply('✅ Cleared quoted message for this account.');
        }

        if (cmd === 'broadcastlist' || cmd === 'blistinfo') {
            const broadcastJid = args[0] || (jid.endsWith('@broadcast') ? jid : '');
            if (!broadcastJid || !broadcastJid.endsWith('@broadcast')) {
                return ctx.reply('❌ Usage: .broadcastlist <timestamp@broadcast>\nTip: use .jid in the broadcast list chat to copy its JID.');
            }
            const info = await sock.getBroadcastListInfo(broadcastJid);
            const recipients = Array.isArray(info?.recipients) ? info.recipients : [];
            return ctx.reply(
                `📡 *Broadcast List Info*\n\n` +
                `JID: ${broadcastJid}\n` +
                `Name: ${info?.subject || info?.name || 'N/A'}\n` +
                `Recipients: ${recipients.length}`,
            );
        }

        if (cmd === 'removepp' || cmd === 'clearpp') {
            const target = args[0] || sock.user?.id;
            await sock.removeProfilePicture(target);
            return ctx.reply(`✅ Profile picture removed for: ${target}`);
        }

        if (cmd === 'msgedit') {
            const q = quotedInfo(message);
            const newText = args.join(' ').trim();
            if (!q?.stanzaId) return ctx.reply('❌ Reply to your message and provide new text.\nUsage: .msgedit <new text>');
            if (!newText) return ctx.reply('❌ Usage: .msgedit <new text>');
            const editKey = {
                remoteJid: q.remoteJid || jid,
                id: q.stanzaId,
                fromMe: true,
                participant: q.participant,
            };
            await sock.sendMessage(jid, { text: newText, edit: editKey });
            return ctx.reply('✅ Edit payload sent.');
        }

        if (cmd === 'paircode') {
            const number = normalizePhone(args[0] || process.env.PAIRING_NUMBER || '');
            if (!number) return ctx.reply('❌ Usage: .paircode <number_with_country_code>');
            if (sock?.authState?.creds?.registered) {
                return ctx.reply('ℹ️ This session is already registered. Pairing code is only available before login.');
            }
            const code = await sock.requestPairingCode(number);
            return ctx.reply(`🔐 Pairing code for ${number}:\n\n*${code}*`);
        }

        if (cmd === 'waon') {
            const number = normalizePhone(args[0]);
            if (!number) return ctx.reply('❌ Usage: .waon <number>');
            const res = await sock.onWhatsApp(`${number}@s.whatsapp.net`);
            const entry = res?.[0];
            return ctx.reply(entry?.exists ? `✅ ${number} is on WhatsApp.` : `❌ ${number} is not on WhatsApp.`);
        }

        if (cmd === 'statusof') {
            const number = normalizePhone(args[0]);
            if (!number) return ctx.reply('❌ Usage: .statusof <number>');
            const st = await sock.fetchStatus(`${number}@s.whatsapp.net`);
            const entry = Array.isArray(st) ? st[0] : st;
            const text = entry?.status?.status || entry?.status || 'No status';
            return ctx.reply(`💬 Status for ${number}:\n${text}`);
        }

        if (cmd === 'bizprofileof') {
            const number = normalizePhone(args[0]);
            if (!number) return ctx.reply('❌ Usage: .bizprofileof <number>');
            const b = await sock.getBusinessProfile(`${number}@s.whatsapp.net`);
            if (!b) return ctx.reply('No business profile found.');
            return ctx.reply(`🏢 *Business Profile*\n\nCategory: ${b.category || 'N/A'}\nDescription: ${b.description || 'N/A'}\nWebsite: ${(b.website || []).join(', ') || 'N/A'}`);
        }

        if (cmd === 'ppurlof') {
            const number = normalizePhone(args[0]);
            if (!number) return ctx.reply('❌ Usage: .ppurlof <number>');
            const url = await sock.profilePictureUrl(`${number}@s.whatsapp.net`, 'image');
            return ctx.reply(`🖼️ Profile picture URL:\n${url}`);
        }

        if (cmd === 'presub') {
            const number = normalizePhone(args[0]);
            if (!number) return ctx.reply('❌ Usage: .presub <number>');
            await sock.presenceSubscribe(`${number}@s.whatsapp.net`);
            return ctx.reply(`✅ Presence subscribed for ${number}.`);
        }

        if (cmd === 'sendpresence') {
            const state = (args[0] || '').toLowerCase();
            const allowed = new Set(['available', 'unavailable', 'composing', 'recording', 'paused']);
            if (!allowed.has(state)) return ctx.reply('❌ Usage: .sendpresence <available|unavailable|composing|recording|paused> [number]');
            const number = normalizePhone(args[1] || '');
            const target = number ? `${number}@s.whatsapp.net` : jid;
            await sock.sendPresenceUpdate(state, target);
            return ctx.reply(`✅ Presence ${state} sent to ${target}.`);
        }

        if (cmd === 'readmsg') {
            const q = quotedInfo(message);
            if (!q?.stanzaId) return ctx.reply('❌ Reply to a message to mark it read.');
            await sock.readMessages([{
                remoteJid: q.remoteJid || jid,
                id: q.stanzaId,
                participant: q.participant,
                fromMe: false,
            }]);
            return ctx.reply('✅ Message marked as read.');
        }
    },
};
