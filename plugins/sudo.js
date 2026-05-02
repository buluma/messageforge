'use strict';
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const config = require('../config');
const db = require('../lib/dbManager');

function isRealOwner(ctx) {
    if (ctx.m?.key?.fromMe) return true;
    const fromNorm = jidNormalizedUser(ctx.from);
    const botLid = jidNormalizedUser(global.botLid || '');
    if (botLid && fromNorm === botLid) return true;
    const ownerNum = ((process.env.OWNER_NUMBER || '').trim()
        || (typeof config.OWNER_NUMBER === 'string' ? config.OWNER_NUMBER.trim() : '')
        || (global.botNum || '')).replace(/\D/g, '');
    const botNum = (global.botNum || '').replace(/\D/g, '');
    const fromNum = fromNorm.replace(/@.*/, '').replace(/\D/g, '');
    if (fromNum && ownerNum && fromNum === ownerNum) return true;
    if (fromNum && botNum && fromNum === botNum) return true;
    return false;
}

module.exports = {
    commands: ['sudo'],
    description: 'Manage sudo users - grant owner-level access to trusted users',
    permission: 'owner',
    run: async (sock, message, args, ctx) => {
        const { jid, reply, mentionedJid } = ctx;
        const sub = (args[0] || '').toLowerCase();

        if (!sub || sub === 'help') {
            return reply(
                `👑 *Sudo Manager*\n\n` +
                `Sudo users get owner-level access to all bot commands.\n\n` +
                `*Commands:*\n` +
                `• .sudo add @user — Grant sudo access\n` +
                `• .sudo add 254712345678 — Grant by number\n` +
                `• .sudo del @user — Revoke sudo access\n` +
                `• .sudo list — View all sudo users\n` +
                `• .sudo reset — Remove all sudo users\n\n` +
                `_Only the real bot owner can manage sudo users._`
            );
        }

        if (!isRealOwner(ctx)) {
            return reply('⛔ Only the real bot owner can manage sudo users.');
        }

        if (sub === 'add' || sub === 'set') {
            const target = mentionedJid?.[0]
                || (args[1] ? `${args[1].replace(/\D/g, '')}@s.whatsapp.net` : null);
            if (!target) return reply('❌ Usage: .sudo add @user or .sudo add <number>');

            const list = await db.get('sudo', []);
            if (list.includes(target)) return reply(`ℹ️ @${target.split('@')[0]} is already a sudo user.`);
            list.push(target);
            await db.set('sudo', list);
            if (!global.sudoUsers) global.sudoUsers = new Set();
            global.sudoUsers.add(target);
            require('../lib/state').save().catch(() => {});

            await sock.sendMessage(jid, {
                text: `✅ *Sudo Added*\n\n@${target.split('@')[0]} now has owner-level access to all bot commands.`,
                mentions: [target]
            }, { quoted: message });
        }

        else if (sub === 'del' || sub === 'remove' || sub === 'rm') {
            const target = mentionedJid?.[0]
                || (args[1] ? `${args[1].replace(/\D/g, '')}@s.whatsapp.net` : null);
            if (!target) return reply('❌ Usage: .sudo del @user or .sudo del <number>');

            const list = (await db.get('sudo', [])).filter(j => j !== target);
            await db.set('sudo', list);
            if (global.sudoUsers) global.sudoUsers.delete(target);

            await sock.sendMessage(jid, {
                text: `✅ *Sudo Removed*\n\n@${target.split('@')[0]} no longer has sudo access.`,
                mentions: [target]
            }, { quoted: message });
        }

        else if (sub === 'list' || sub === 'ls') {
            const list = await db.get('sudo', []);
            if (!list.length) return reply('👤 *Sudo Users*\n\nNo sudo users configured.\n\nAdd one: .sudo add @user');
            const out = list.map((j, i) => `*${i + 1}.* @${j.split('@')[0]}`).join('\n');
            await sock.sendMessage(jid, {
                text: `👤 *Sudo Users (${list.length})*\n\n${out}`,
                mentions: list
            }, { quoted: message });
        }

        else if (sub === 'reset' || sub === 'clear') {
            await db.set('sudo', []);
            if (global.sudoUsers) global.sudoUsers.clear();
            reply('✅ All sudo users have been cleared.');
        }

        else {
            reply('❌ Unknown subcommand. Use .sudo help for usage.');
        }
    }
};
