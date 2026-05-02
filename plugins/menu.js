'use strict';

const moment = require('moment-timezone');
const baileys = require('@whiskeysockets/baileys');
const { proto, generateMessageIDV2 } = baileys;

const WEBSITE = 'https://github.com/buluma/messageforge';
const TZ = 'Africa/Nairobi';

// ── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = [
    {
        icon: '⬇️',
        name: 'Downloaders',
        cmds: ['yt', 'tiktok', 'instagram', 'facebook', 'apk', 'catbox'],
    },
    { icon: '🎵', name: 'Music & Audio', cmds: ['play', 'shazam', 'lyrics', 'toaudio'] },
    {
        icon: '🤖',
        name: 'AI & Intelligence',
        cmds: [
            'ai',
            'agent',
            'ask',
            'messageforge',
            'assistant',
            'imagine',
            'translate',
            'define',
            'tts',
            'calc',
            'shorten',
            'gitclone',
            'anime',
            'manga',
        ],
    },
    {
        icon: '🌍',
        name: 'Search & Info',
        cmds: ['wiki', 'country', 'ip', 'currency', 'time', 'weather', 'numberfact'],
    },
    { icon: '🖼️', name: 'Media Tools', cmds: ['vv', 'ascii', 'qrcode', 'react'] },
    {
        icon: '👥',
        name: 'Group Management',
        cmds: [
            'kick',
            'promote',
            'demote',
            'ban',
            'unban',
            'banlist',
            'tagall',
            'hidetag',
            'poll',
            'lock',
            'unlock',
            'link',
            'revoke',
            'setname',
            'setdesc',
            'broadcast',
        ],
    },
    {
        icon: '👋',
        name: 'Welcome & Events',
        cmds: ['welcome', 'goodbye', 'setwelcome', 'setgoodbye', 'welcomequiz', 'setquiz'],
    },
    {
        icon: '🛡️',
        name: 'Protection',
        cmds: [
            'antidemote',
            'antidelete',
            'antilink',
            'anticall',
            'antivv',
            'autoreply',
            'blocklist',
            'afk',
            'auditlog',
        ],
    },
    {
        icon: '😄',
        name: 'Fun & Entertainment',
        cmds: [
            'joke',
            'fact',
            'riddle',
            'meme',
            'quote',
            'advice',
            'compliment',
            'flip',
            'bible',
            'hello',
        ],
    },
    {
        icon: '🔒',
        name: 'Privacy & Utilities',
        cmds: ['password', 'morse', 'base64', 'tempmail', 'virus', 'eval'],
    },
    {
        icon: '📊',
        name: 'Status & Profile',
        cmds: ['save', 'spp', 'presence', 'autojoin', 'analytics', 'topusers', 'peakhours'],
    },
    {
        icon: '📰',
        name: 'Channels',
        cmds: ['newsletter', 'followchannel', 'unfollowchannel', 'channelinfo'],
    },
    {
        icon: 'ℹ️',
        name: 'Bot Info',
        cmds: [
            'alive',
            'ping',
            'uptime',
            'owner',
            'getjid',
            'repo',
            'remind',
            'rremind',
            'myreminders',
        ],
    },
    {
        icon: '👑',
        name: 'Owner & Sudo',
        cmds: [
            'sudo',
            'setsudo',
            'delsudo',
            'getsudo',
            'resetsudo',
            'block',
            'unblock',
            'setmode',
            'setprefix',
            'setbotname',
            'join',
            'cmd',
            'restart',
            'shutdown',
            'backupgroup',
            'restoregroup',
        ],
    },
    {
        icon: '🎮',
        name: 'Games',
        cmds: [
            'rps',
            'hangman',
            'ttt',
            'trivia',
            'riddle',
            'slots',
            '8ball',
            'scramble',
            'flagquiz',
            'mathquiz',
            'wordchain',
            'emojiguess',
            'challenge',
            'dailychallenge',
        ],
    },
    {
        icon: '🔧',
        name: 'Text & Dev Tools',
        cmds: [
            'reverse',
            'upper',
            'lower',
            'mock',
            'binary',
            'rot13',
            'leet',
            'json',
            'urlencode',
            'hash',
            'timestamp',
            'regex',
            'httpcode',
            'password',
        ],
    },
    {
        icon: '💰',
        name: 'Crypto & Finance',
        cmds: [
            'crypto',
            'loan',
            'savings',
            'tax',
            'inflation',
            'billsplit',
            'salary',
            'discount',
            'budget',
        ],
    },
    {
        icon: '💪',
        name: 'Health & Fitness',
        cmds: [
            'workout',
            'stretching',
            'calories',
            'water',
            'sleep',
            'meditation',
            'steps',
            'yoga',
            'bmi',
        ],
    },
    {
        icon: '📚',
        name: 'Education',
        cmds: [
            'element',
            'planet',
            'zodiac',
            'vocab',
            'acronym',
            'flag',
            'nato',
            'country',
            'phrasebook',
        ],
    },
    {
        icon: '📝',
        name: 'Productivity',
        cmds: [
            'pomodoro',
            'habits',
            'goals',
            'journal',
            'flashcards',
            'bookmarks',
            'schedule',
            'todo',
            'notes',
            'timer',
            'bookmark',
            'saved',
            'autoreply',
            'awaymsg',
            'expense',
            'splitbill',
            'balances',
        ],
    },
    { icon: '🏆', name: 'Leveling & XP', cmds: ['level', 'rank', 'xp', 'leaderboard'] },
    { icon: '🔗', name: 'Link Tools', cmds: ['summarize', 'linkpreview', 'tldr'] },
    { icon: '🎤', name: 'Voice Tools', cmds: ['transcribe', 'voicetotext', 'tts'] },
];

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━';

function section(title, cmds) {
    return `${title}\n${cmds.join('  ·  ')}`;
}

function buildMenuText(plugins, pfx, botName, ownerNum, mode, byText) {
    const allCmds = new Set(plugins.flatMap((p) => p.commands || []));
    const assigned = new Set();
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
    for (const { icon, name, cmds } of CATEGORIES) {
        const found = [...new Set(cmds.filter((c) => allCmds.has(c)))];
        if (!found.length) continue;
        found.forEach((c) => assigned.add(c));
        catBlocks.push(
            section(
                `${icon} *${name}*`,
                found.map((c) => `\`${pfx}${c}\``),
            ),
        );
    }

    const rest = [...allCmds].filter(
        (c) => !assigned.has(c) && !['menu', 'help', 'list'].includes(c),
    );
    if (rest.length)
        catBlocks.push(
            section(
                `🔧 *Other*`,
                rest.map((c) => `\`${pfx}${c}\``),
            ),
        );

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
