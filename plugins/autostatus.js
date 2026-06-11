'use strict';
const { getCommand } = require('../lib/command');

// Runtime toggles — override config values without editing config.env
// Read by messageforge.js status handler when present
if (global.autoStatusFlags === undefined) {
    global.autoStatusFlags = {
        seen: null, // null = use config default, true/false = runtime override
        react: null,
        mode: null, // null = use config default, "all"|"favorites" = runtime override
    };
}

const FLAGS = global.autoStatusFlags;
const VALID_MODES = new Set(['all', 'favorites']);

function getEffectiveMode(configMode) {
    const runtimeMode = String(FLAGS.mode || '')
        .trim()
        .toLowerCase();
    if (VALID_MODES.has(runtimeMode)) return runtimeMode;
    const envMode = String(configMode || '')
        .trim()
        .toLowerCase();
    if (VALID_MODES.has(envMode)) return envMode;
    return 'all';
}

module.exports = {
    commands: ['autoview', 'autolike', 'autoreact', 'autostatus', 'statusconfig'],
    description: 'Control automatic status viewing and liking at runtime',
    category: 'automation',
    usage: '.autoview on/off  |  .autolike on/off  |  .autostatus',
    permission: 'owner',
    group: false,
    private: true,

    run: async (sock, message, args, ctx) => {
        const { jid, contextInfo } = ctx;
        const command = getCommand(ctx);

        const sub = (args[0] || '').toLowerCase();

        // ── .autostatus / .statusconfig — show current state ─────────────────
        if (command === 'autostatus' || command === 'statusconfig') {
            const config = require('../config');
            const { getFormattedFavorites } = require('../lib/favorites');
            const seenEff = FLAGS.seen !== null ? FLAGS.seen : config.AUTO_STATUS_SEEN;
            const reactEff = FLAGS.react !== null ? FLAGS.react : config.AUTO_STATUS_REACT;
            const seenSrc = FLAGS.seen !== null ? '_(runtime override)_' : '_(from config.env)_';
            const reactSrc = FLAGS.react !== null ? '_(runtime override)_' : '_(from config.env)_';
            const mode = getEffectiveMode(config.AUTO_STATUS_MODE);
            const modeSrc = FLAGS.mode !== null ? '_(runtime override)_' : '_(from config.env)_';
            const favCount = getFormattedFavorites().length;

            return sock.sendMessage(
                jid,
                {
                    text: [
                        `📊 *Auto-Status Settings*`,
                        ``,
                        `👁️ *Auto View:*   ${seenEff ? '✅ ON' : '❌ OFF'}  ${seenSrc}`,
                        `❤️ *Auto Like:*   ${reactEff ? '✅ ON' : '❌ OFF'}  ${reactSrc}`,
                        `🔒 *Mode:*      ${mode === 'favorites' ? '⭐ Favorites Only' : '👤 All Contacts'} (${favCount} saved) ${modeSrc}`,
                        ``,
                        `*Commands:*`,
                        `• \`.autoview on\`  — force view all statuses`,
                        `• \`.autoview off\` — stop viewing statuses`,
                        `• \`.autolike on\`  — force react/like all statuses`,
                        `• \`.autolike off\` — stop reacting to statuses`,
                        `• \`.autostatus\`   — show this panel`,
                        `• \`.fav\`        — manage favorites`,
                    ].join('\n'),
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // ── .autoview on/off ──────────────────────────────────────────────────
        if (command === 'autoview') {
            if (sub !== 'on' && sub !== 'off') {
                const config = require('../config');
                const eff = FLAGS.seen !== null ? FLAGS.seen : config.AUTO_STATUS_SEEN;
                return sock.sendMessage(
                    jid,
                    {
                        text: `👁️ *Auto View* is currently *${eff ? 'ON' : 'OFF'}*\n\nUsage: \`.autoview on\` or \`.autoview off\``,
                        contextInfo,
                    },
                    { quoted: message },
                );
            }
            FLAGS.seen = sub === 'on';
            return sock.sendMessage(
                jid,
                {
                    text: FLAGS.seen
                        ? `👁️ *Auto View: ON*\n\n✅ Bot will now *view every status* as soon as it arrives — no exceptions.`
                        : `👁️ *Auto View: OFF*\n\n❌ Bot will stop automatically viewing statuses.`,
                    contextInfo,
                },
                { quoted: message },
            );
        }

        // ── .autolike / .autoreact on/off ─────────────────────────────────────
        if (command === 'autolike' || command === 'autoreact') {
            if (sub !== 'on' && sub !== 'off') {
                const config = require('../config');
                const eff = FLAGS.react !== null ? FLAGS.react : config.AUTO_STATUS_REACT;
                return sock.sendMessage(
                    jid,
                    {
                        text: `❤️ *Auto Like* is currently *${eff ? 'ON' : 'OFF'}*\n\nUsage: \`.autolike on\` or \`.autolike off\``,
                        contextInfo,
                    },
                    { quoted: message },
                );
            }
            FLAGS.react = sub === 'on';
            return sock.sendMessage(
                jid,
                {
                    text: FLAGS.react
                        ? `❤️ *Auto Like: ON*\n\n✅ Bot will now *react to every status* with an emoji — no exceptions.`
                        : `❤️ *Auto Like: OFF*\n\n❌ Bot will stop automatically reacting to statuses.`,
                    contextInfo,
                },
                { quoted: message },
            );
        }
    },
};
