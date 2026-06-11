'use strict';

const moment = require('moment-timezone');
const baileys = require('@whiskeysockets/baileys');
const { proto, generateMessageIDV2 } = baileys;

const WEBSITE = 'https://github.com/buluma/messageforge';
const TZ = 'Africa/Nairobi';

// ── Import category enum from handler ────────────────────────────────────────
let CATEGORY_META = {};
try {
    const { PLUGIN_CATEGORIES } = require('../handler');
    CATEGORY_META = PLUGIN_CATEGORIES;
} catch {
    // Fallback if handler cannot be loaded during build checks
}

// ── Filename heuristic rules for plugins without explicit category ───────────
const FILENAME_HEURISTICS = [
    { pattern: /^anti/i, category: 'moderation' },
    { pattern: /^(kick|promote|demote|ban|warn|purge|mutemember)/i, category: 'moderation' },
    { pattern: /(group|grouplink|groupinfo|groupbackup|grouprules|groupstatus|tagall|hidetag|poll|lock|unlock|welcome|welcomequiz|autojoin|broadcast|leveling|usage-analytics)/i, category: 'group' },
    { pattern: /^(yt|tiktok|instagram|facebook|twitter|mediafire|gdrive|capcut|soundcloud|apk|catbox|gitclone|reddit|pinterest|spotify)/i, category: 'downloaders' },
    { pattern: /^(game|games|wordgame|numberguess|dailychallenge|trivia)/i, category: 'games' },
    { pattern: /^(messageforge|ai-|summarize|transcribe|translate|tts|imagine)/i, category: 'ai' },
    { pattern: /(stalk|search|whois|wiki|news|weather|stock|info-lookup|githubstalk|igstalk|tiktokstalk)/i, category: 'search' },
    { pattern: /^(sudo|setprefix|baileys-gap|messageforge-owner)/i, category: 'owner' },
    { pattern: /(auto|scheduler)/i, category: 'automation' },
    { pattern: /^(music|lyrics|shazam|bgm|toaudio|togif|tojpeg|quotly|stickersearch|carbon)/i, category: 'media' },
];

const DEFAULT_CATEGORY = 'utility';

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Infer a plugin's category from its filename when no explicit category is set.
 * @param {string} filename - e.g. "antilink.js"
 * @returns {string} The inferred category key
 */
function heuristicCategory(filename) {
    if (!filename) return DEFAULT_CATEGORY;
    for (const { pattern, category } of FILENAME_HEURISTICS) {
        if (pattern.test(filename)) return category;
    }
    return DEFAULT_CATEGORY;
}

/**
 * Build a grouped category map from the loaded plugins.
 * @param {Array} plugins - The handler's plugins array
 * @returns {{ groups: Array, totalCommands: number }}
 *   groups: [{ icon, name, commands: [formattedCmd, ...] }]
 */
function buildCategoryGroups(plugins) {
    const groups = new Map(); // categoryKey -> { icon, name, commands: Set }

    for (const plugin of plugins) {
        // Skip hidden plugins
        if (plugin.hidden) continue;
        if (!Array.isArray(plugin.commands) || !plugin.commands.length) continue;

        const cat = plugin.category && CATEGORY_META[plugin.category]
            ? plugin.category
            : heuristicCategory(plugin.__pluginFile || '');

        if (!groups.has(cat)) {
            const meta = CATEGORY_META[cat] || { icon: '🔧', label: 'Other' };
            groups.set(cat, { icon: meta.icon, name: meta.label, commands: new Set() });
        }

        const group = groups.get(cat);
        for (const cmd of plugin.commands) {
            if (cmd) group.commands.add(cmd);
        }
    }

    // Sort groups: defined order first, then alphabetical
    const categoryOrder = Object.keys(CATEGORY_META);
    const sorted = [...groups.entries()].sort((a, b) => {
        const ai = categoryOrder.indexOf(a[0]);
        const bi = categoryOrder.indexOf(b[0]);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a[0].localeCompare(b[0]);
    });

    let totalCommands = 0;
    const result = sorted.map(([key, group]) => {
        const cmdArray = [...group.commands].sort();
        totalCommands += cmdArray.length;
        return {
            icon: group.icon,
            name: group.name,
            commands: cmdArray,
        };
    });

    return { groups: result, totalCommands };
}

function section(title, cmds) {
    return `${title}\n${cmds.join('  ·  ')}`;
}

function buildMenuText(plugins, pfx, botName, ownerNum, mode, byText) {
    const { groups } = buildCategoryGroups(plugins);
    const modeEmoji = mode === 'PUBLIC' ? '🟢' : mode === 'PRIVATE' ? '🔒' : '🔵';
    const now = moment().tz(TZ);

    const header = [
        `✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦`,
        `⚡ *${botName.toUpperCase()}* ⚡`,
        `_The Ultimate WhatsApp Bot_`,
        `✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦`,
        ``,
    ].join('\n');

    const infoPanel = [
        `📋 *Bot Status*`,
        `› *Bot:*     ${botName}`,
        `› *Number:*  ${ownerNum}`,
        `› *Prefix:*  \`${pfx}\``,
        `› *Mode:*    ${modeEmoji} ${mode}`,
        `› *Plugins:* ${plugins.length} loaded`,
        `› *Date:*    ${now.format('ddd, D MMM YYYY')}`,
        `› *Time:*    ${now.format('hh:mm A')}`,
    ].join('\n');

    const catBlocks = [];
    for (const { icon, name, commands } of groups) {
        const formatted = commands.map((c) => `\`${pfx}${c}\``);
        catBlocks.push(section(`${icon} *${name}*`, formatted));
    }

    const footer = [
        ``,
        `💡 \`${pfx}help <cmd>\` for details`,
        `🌐 ${WEBSITE}`,
        ``,
        `> ⚡ _${byText || 'Made by: SHADOWNET Team'} © ${now.year()}_`,
    ].join('\n');

    const body = catBlocks.join(`\n\n${DIVIDER}\n\n`);
    return `${header}${infoPanel}\n\n${DIVIDER}\n\n${body}\n${footer}`;
}

// ── Send call log then menu text quoting it ───────────────────────────────────
async function sendCallLogMenu(sock, jid, menuText) {
    const CallOutcome = proto.Message.CallLogMessage.CallOutcome;
    const callMsgId = generateMessageIDV2(sock.user?.id);
    const botJid = sock.user?.id || '';

    // Step 1: send a real MISSED-VOICE-CALL log bubble
    const callContent = proto.Message.fromObject({
        callLogMesssage: {
            isVideo: false,
            callOutcome: CallOutcome.MISSED,
            durationSecs: 0,
            callType: 0,
        },
    });

    await sock.relayMessage(jid, callContent, { messageId: callMsgId });

    await new Promise((r) => setTimeout(r, 400));

    // Step 2: send the menu as a reply quoting the call log bubble
    const quotedCtx = {
        stanzaId: callMsgId,
        participant: botJid,
        quotedMessage: {
            callLogMesssage: {
                isVideo: false,
                callOutcome: CallOutcome.MISSED,
                durationSecs: 0,
                callType: 0,
            },
        },
    };

    await sock.sendMessage(jid, { text: menuText, contextInfo: quotedCtx });
}

module.exports = {
    commands: ['menu', 'help'],
    description: 'Show all available commands in a categorized menu',
    permission: 'public',
    group: true,
    private: true,
    category: 'utility',

    run: async (sock, message, args, ctx) => {
        const { prefix, contextInfo, jid, config, getStr } = ctx;
        const { plugins } = require('../handler');

        const botName = getStr('botName') || config.BOT_NAME || 'MessageForge';
        const ownerNum = `+${(config.OWNER_NUMBER || '').replace(/\D/g, '')}`;
        const mode = (config.MODE || 'public').toUpperCase();
        const pfx = prefix || '.';
        const byText = getStr('by');
        const menuText = buildMenuText(plugins, pfx, botName, ownerNum, mode, byText);

        // ── Primary: call log bubble → menu reply ──────────────────────────────
        try {
            await sendCallLogMenu(sock, jid, menuText);
            return;
        } catch (err) {
            console.error('[Menu] callLogMesssage send failed:', err.message);
        }

        // ── Fallback: text only ────────────────────────────────────────────────
        await sock.sendMessage(jid, { text: menuText, contextInfo }, { quoted: message });
    },
};
