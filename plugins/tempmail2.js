'use strict';

const { TempMail } = require('tempmail.lol');
const { getCommand } = require('../lib/command');

function getSessionStore() {
    if (!global.tempMailSessions) global.tempMailSessions = new Map();
    return global.tempMailSessions;
}

function fmtDate(input) {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleString();
}

module.exports = {
    commands: ['tempinbox', 'readmail', 'delmail', 'tempmailhelp'],
    description: 'Extended temporary mail commands',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const { jid, contextInfo, fmt } = ctx;
        const from = message.key.participant || message.key.remoteJid;
        const mailSessions = getSessionStore();
        const cmd = getCommand(ctx);
        const text = args.join(' ').trim();
        const send = (t) =>
            sock.sendMessage(jid, { text: fmt(t), contextInfo }, { quoted: message });

        if (cmd === 'tempmailhelp') {
            return send(
                `📧 *TempMail Help*\n\n` +
                    `*Commands:*\n` +
                    `• \`.tempmail\` — Generate a new temporary email\n` +
                    `• \`.tempinbox <email>\` — Check inbox of an email\n` +
                    `• \`.readmail <email> <index>\` — Read a specific email (1, 2, 3...)\n` +
                    `• \`.delmail\` — Clear your saved temp email\n` +
                    `• \`.tempmailhelp\` — Show this help\n\n` +
                    `*Example flow:*\n` +
                    `1. \`.tempmail\` → get email address\n` +
                    `2. Use it to sign up somewhere\n` +
                    `3. \`.tempinbox <email>\` → check for new messages\n` +
                    `4. \`.readmail <email> 1\` → read first message`,
            );
        }

        if (cmd === 'delmail') {
            mailSessions.delete(from);
            return send(
                '🗑️ Your temp mail session cleared.\n\nUse `.tempmail` to generate a new one.',
            );
        }

        if (cmd === 'tempinbox') {
            const saved = mailSessions.get(from) || {};
            const address = text || saved.address;
            if (!address)
                return send(
                    '❌ Provide an email address.\n\n*Usage:* `.tempinbox <email@domain>`\n\nOr use `.tempmail` to generate one first.',
                );
            if (!address.includes('@'))
                return send('❌ Invalid email format. Include the full address including @domain.');

            try {
                await sock.sendPresenceUpdate('composing', jid);
                const token = saved.address === address ? saved.token : null;
                if (!token) {
                    return send(
                        `❌ I don't have an inbox token for \`${address}\`.\n\n` +
                            'Generate a new email with `.tempmail` and use that address.',
                    );
                }
                const mail = new TempMail();
                const inbox = await mail.checkInbox(token);

                if (!inbox?.length) {
                    return send(
                        `📭 *Inbox: ${address}*\n\nNo messages yet.\n\n_Emails may take a few minutes to arrive._`,
                    );
                }

                const items = inbox
                    .slice(0, 10)
                    .map(
                        (m, i) =>
                            `*${i + 1}.* From: ${m.from || m.sender || 'Unknown'}\n   Subject: ${m.subject || '(no subject)'}\n   Date: ${fmtDate(m.date || m.receivedAt || m.createdAt)}`,
                    )
                    .join('\n\n');

                return send(
                    `📬 *Inbox: ${address}*\n\n${items}\n\n_Use \`.readmail ${address} <number>\` to read a message_`,
                );
            } catch {
                return send(`❌ Could not fetch inbox for ${address}.\n\n_Try again in a moment._`);
            }
        }

        if (cmd === 'readmail') {
            const parts = text.split(/\s+/);
            const address = parts[0];
            const index = parseInt(parts[1]) - 1 || 0;

            if (!address || !address.includes('@')) {
                return send(
                    '❌ *Usage:* `.readmail <email@domain> <message number>`\n\nExample: `.readmail test@mail.com 1`',
                );
            }

            try {
                await sock.sendPresenceUpdate('composing', jid);
                const saved = mailSessions.get(from) || {};
                const token = saved.address === address ? saved.token : null;
                if (!token)
                    return send(
                        `❌ No session token found for ${address}. Generate it again with \`.tempmail\`.`,
                    );
                const mail = new TempMail();
                const inbox = await mail.checkInbox(token);

                if (!inbox?.length) return send(`📭 No messages in inbox: ${address}`);
                if (index >= inbox.length)
                    return send(
                        `❌ Message ${index + 1} not found. Inbox has ${inbox.length} message(s).`,
                    );

                const m = inbox[index];
                const body = (m.body || m.text || m.content || '(empty)')
                    .replace(/<[^>]+>/g, '')
                    .replace(/\s{2,}/g, ' ')
                    .slice(0, 1000);

                return send(
                    `📩 *Message ${index + 1}*\n\n` +
                        `📧 *From:* ${m.from || m.sender || 'Unknown'}\n` +
                        `📋 *Subject:* ${m.subject || '(no subject)'}\n` +
                        `📅 *Date:* ${fmtDate(m.date || m.receivedAt || m.createdAt)}\n\n` +
                        `📝 *Content:*\n${body}`,
                );
            } catch {
                return send(`❌ Could not read message.\n\n_Try \`.tempinbox ${address}\` first._`);
            }
        }
    },
};
