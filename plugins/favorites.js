'use strict';

/**
 * plugins/favorites.js
 * Manage favorite contacts for selective status automation
 */

const config = require('../config');
const { getCommand } = require('../lib/command');
const {
    isFavorite,
    addFavorite,
    removeFavorite,
    getFormattedFavorites,
    normalizeJid,
} = require('../lib/favorites');
const VALID_MODES = new Set(['all', 'favorites']);

function getEffectiveMode() {
    const runtimeMode = String(global.autoStatusFlags?.mode || '')
        .trim()
        .toLowerCase();
    if (VALID_MODES.has(runtimeMode)) return runtimeMode;
    const envMode = String(config.AUTO_STATUS_MODE || '')
        .trim()
        .toLowerCase();
    if (VALID_MODES.has(envMode)) return envMode;
    return 'all';
}

module.exports = {
    commands: ['fav', 'favorites', 'favorite'],
    description: 'Manage favorite contacts for status automation',
    usage: `.fav add <number>\n.fav remove <number>\n.fav list\n.fav check <number>\n.fav mode`,
    permission: 'owner',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const { jid, contextInfo, quoted } = ctx;
        const command = getCommand(ctx);
        const isFavCommand = ['fav', 'favorites', 'favorite'].includes(command);

        // Get target JID from args or quoted message
        let targetJid = '';
        if (args[1]) {
            // Number provided as argument
            const digits = args[1].replace(/\D/g, '');
            targetJid = digits ? `${digits}@s.whatsapp.net` : '';
        } else if (quoted?.key?.participant || quoted?.participant || quoted?.key?.remoteJid) {
            // Reply/quote target
            targetJid =
                quoted.key?.participant || quoted.participant || quoted.key?.remoteJid || '';
        }
        targetJid = normalizeJid(targetJid);

        // ── .fav list ───────────────────────────────────────────────────────────────
        if (isFavCommand && (!args[0] || args[0] === 'list')) {
            const favs = getFormattedFavorites();
            const mode = getEffectiveMode();

            if (favs.length === 0) {
                return sock.sendMessage(
                    jid,
                    {
                        text: [
                            `⭐ *Favorite Contacts*`,
                            ``,
                            `🔒 *Mode:* ${mode === 'favorites' ? 'Favorites Only' : 'All Contacts'}`,
                            ``,
                            `📝 No favorites added yet.`,
                            ``,
                            `*Usage:*`,
                            `• \`.fav add <number>\` — Add to favorites`,
                            `• \`.fav remove <number>\` — Remove from favorites`,
                            `• \`.fav list\` — List all favorites`,
                            `• \`.fav check <number>\` — Check if contact is favorite`,
                            `• \`.fav mode\` — Show current mode`,
                        ].join('\n'),
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            let listText = `⭐ *Favorite Contacts* (${favs.length})\n`;
            listText += `🔒 *Mode:* ${mode === 'favorites' ? '⭐ Favorites Only' : '👤 All Contacts'}\n`;
            listText += `\n`;
            favs.forEach((f, i) => {
                listText += `${i + 1}. @${f.number}\n`;
            });
            listText += `\n`;
            listText += `*Usage:*\n`;
            listText += `• \`.fav add <number>\` — Add to favorites\n`;
            listText += `• \`.fav remove <number>\` — Remove\n`;
            listText += `• \`.fav mode set all|favorites\` — Switch mode`;

            return sock.sendMessage(
                jid,
                {
                    text: listText,
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // ── .fav add ────────────────────────────────��──────────────────────────────
        if (isFavCommand && args[0] === 'add') {
            if (!targetJid) {
                return sock.sendMessage(
                    jid,
                    {
                        text: `❌ Please provide a number.\n\n*Usage:* \`.fav add 2547xxxxxxx\``,
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            const success = addFavorite(targetJid);
            const num = targetJid.split('@')[0];
            return sock.sendMessage(
                jid,
                {
                    text: success
                        ? `✅ *Added to Favorites*\n\n➕ @${num} is now a favorite contact.\nTheir statuses will trigger auto-view/react/reply.`
                        : `❌ Failed to add @${num}.`,
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // ── .fav remove ───────────────────────────────────────────────────────
        if (isFavCommand && args[0] === 'remove') {
            if (!targetJid) {
                return sock.sendMessage(
                    jid,
                    {
                        text: `❌ Please provide a number.\n\n*Usage:* \`.fav remove 2547xxxxxxx\``,
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            const success = removeFavorite(targetJid);
            const num = targetJid.split('@')[0];
            return sock.sendMessage(
                jid,
                {
                    text: success
                        ? `✅ *Removed from Favorites*\n\n➖ @${num} is no longer a favorite.`
                        : `❌ @${num} was not in favorites.`,
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // ── .fav check ───────────────────────────────────────────────────────
        if (isFavCommand && args[0] === 'check') {
            if (!targetJid) {
                return sock.sendMessage(
                    jid,
                    {
                        text: `❌ Please provide a number.\n\n*Usage:* \`.fav check 2547xxxxxxx\``,
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            const isFav = isFavorite(targetJid);
            const num = targetJid.split('@')[0];
            return sock.sendMessage(
                jid,
                {
                    text: isFav
                        ? `✅ *Favorite Check*\n\n⭐ @${num} is in your favorites list.`
                        : `❌ *Favorite Check*\n\n⭕ @${num} is NOT in your favorites.`,
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // ── .fav mode set ─────────────────────────────────────────────────
        if (isFavCommand && args[0] === 'mode' && args[1] === 'set') {
            const newMode = (args[2] || '').toLowerCase();
            if (newMode !== 'all' && newMode !== 'favorites') {
                return sock.sendMessage(
                    jid,
                    {
                        text: `❌ Invalid mode. Use:\n• \`.fav mode set all\` — All contacts\n• \`.fav mode set favorites\` — Favorites only`,
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            if (global.autoStatusFlags === undefined) {
                global.autoStatusFlags = { seen: null, react: null, mode: null };
            }
            global.autoStatusFlags.mode = newMode;

            return sock.sendMessage(
                jid,
                {
                    text: [
                        `🔄 *Mode Updated*`,
                        ``,
                        `New mode: \`${newMode}\``,
                        ``,
                        newMode === 'favorites'
                            ? `⭐ Only favorite contacts will trigger auto-status.`
                            : `👤 All contacts will trigger auto-status.`,
                        ``,
                        `✅ Applied immediately for this runtime session.`,
                        `⚠️ To persist after restart, update \`.env\`:`,
                        ``,
                        `\`AUTO_STATUS_MODE=${newMode}\``,
                        `Then restart the bot.`,
                    ].join('\n'),
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // ── .fav mode ───────────────────────────────────────────────────────
        if (isFavCommand && args[0] === 'mode') {
            const currentMode = getEffectiveMode();
            const favs = getFormattedFavorites();
            const modeSrc = global.autoStatusFlags?.mode ? 'runtime override' : 'config.env';

            return sock.sendMessage(
                jid,
                {
                    text: [
                        `🔒 *Status Automation Mode*`,
                        ``,
                        `*Current:* ${currentMode === 'favorites' ? '⭐ Favorites Only' : '👤 All Contacts'}`,
                        `*Source:* ${modeSrc}`,
                        `*Favorites Count:* ${favs.length}`,
                        ``,
                        currentMode === 'favorites'
                            ? `Only favorite contacts will trigger auto-view/react/reply.`
                            : `All contacts will trigger auto-view/react/reply.`,
                        ``,
                        `*To change mode:*`,
                        `• \`.fav mode set all\` — All contacts`,
                        `• \`.fav mode set favorites\` — Favorites only`,
                    ].join('\n'),
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // Default help
        return sock.sendMessage(
            jid,
            {
                text: [
                    `⭐ *Favorites Manager*`,
                    ``,
                    `*Commands:*`,
                    `• \`.fav list\` — Show all favorites`,
                    `• \`.fav add <number>\` — Add to favorites`,
                    `• \`.fav remove <number>\` — Remove from favorites`,
                    `• \`.fav check <number>\` — Check favorite status`,
                    `• \`.fav mode\` — Show current mode`,
                    `• \`.fav mode set all|favorites\` — Change mode`,
                    ``,
                    `*Current Mode:* ${getEffectiveMode()}`,
                ].join('\n'),
                contextInfo,
            },
            { quoted: message },
        );
    },
};
