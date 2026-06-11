'use strict';

const { getCommand } = require('../lib/command');

if (!global.bannedUsers) global.bannedUsers = new Set();

module.exports = {
    commands: ['ban', 'unban', 'banlist'],
    description: 'Ban/unban users from using bot commands',
    usage: '.ban @user | .unban @user | .banlist',
    permission: 'admin',
    group: true,
    private: false,

    run: async (sock, message, args, ctx) => {
        const { jid, contextInfo, mentionedJid, fmt } = ctx;

        const rawCmd = getCommand(ctx);

        if (rawCmd === 'banlist') {
            if (!global.bannedUsers.size) {
                return sock.sendMessage(
                    jid,
                    { text: fmt('📋 *Ban List*\n\nNo users are currently banned.'), contextInfo },
                    { quoted: message },
                );
            }
            const list = [...global.bannedUsers].map((j) => `• @${j.split('@')[0]}`).join('\n');
            const mentions = [...global.bannedUsers];
            return sock.sendMessage(
                jid,
                {
                    text: fmt(`📋 *Banned Users (${global.bannedUsers.size})*\n\n${list}`),
                    mentions,
                    contextInfo,
                },
                { quoted: message },
            );
        }

        const targets = [];
        const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
        if (quoted) targets.push(quoted);
        if (mentionedJid?.length)
            mentionedJid.forEach((j) => {
                if (!targets.includes(j)) targets.push(j);
            });

        if (!targets.length) {
            const action = rawCmd === 'ban' ? 'ban' : 'unban';
            return sock.sendMessage(
                jid,
                {
                    text: fmt(
                        `❌ Reply to or mention someone to ${action} them.\n\nUsage: \`.${action} @user\``,
                    ),
                    contextInfo,
                },
                { quoted: message },
            );
        }

        if (rawCmd === 'ban') {
            const toBan = targets.filter((t) => {
                const tNum = t.split('@')[0].replace(/\D/g, '');
                const ownerNum = (process.env.OWNER_NUMBER || global.botNum || '').replace(
                    /\D/g,
                    '',
                );
                return tNum !== ownerNum;
            });

            if (!toBan.length) {
                return sock.sendMessage(
                    jid,
                    { text: fmt('⛔ Cannot ban the bot owner.'), contextInfo },
                    { quoted: message },
                );
            }

            toBan.forEach((t) => global.bannedUsers.add(t));
            require('../lib/state')
                .save()
                .catch(() => {});

            const names = toBan.map((j) => `@${j.split('@')[0]}`).join(', ');
            await sock.sendMessage(
                jid,
                {
                    text: fmt(`🔨 *Banned:* ${names}\n\nThey can no longer use bot commands.`),
                    mentions: toBan,
                    contextInfo,
                },
                { quoted: message },
            );
        } else if (rawCmd === 'unban') {
            const wasKnown = targets.filter((t) => global.bannedUsers.has(t));
            targets.forEach((t) => global.bannedUsers.delete(t));

            if (wasKnown.length) {
                require('../lib/state')
                    .save()
                    .catch(() => {});
            }

            if (!wasKnown.length) {
                return sock.sendMessage(
                    jid,
                    {
                        text: fmt('⚠️ None of the mentioned users are currently banned.'),
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            const names = wasKnown.map((j) => `@${j.split('@')[0]}`).join(', ');
            await sock.sendMessage(
                jid,
                {
                    text: fmt(`✅ *Unbanned:* ${names}\n\nThey can use bot commands again.`),
                    mentions: wasKnown,
                    contextInfo,
                },
                { quoted: message },
            );
        }
    },
};
