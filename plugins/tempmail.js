'use strict';

const { TempMail } = require('tempmail.lol');

function getSessionStore() {
    if (!global.tempMailSessions) global.tempMailSessions = new Map();
    return global.tempMailSessions;
}

module.exports = {
    commands: ['tempmail', 'tmpmail', 'fakemail', 'disposable'],
    description: 'Generate a temporary disposable email address and check its inbox',
    usage: '.tempmail | .tempmail inbox [address]',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const { jid, contextInfo } = ctx;
        const userKey = message.key.participant || message.key.remoteJid;
        const session = getSessionStore();
        const sub = (args[0] || '').toLowerCase();

        if (sub === 'inbox') {
            const address = args[1]?.trim() || session.get(userKey)?.address;
            if (!address || !address.includes('@')) {
                return sock.sendMessage(
                    jid,
                    {
                        text: '❌ Provide the full email address.\n\nUsage: `.tempmail inbox you@domain.com`\n_Or generate one first with `.tempmail`_',
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            try {
                const mail = new TempMail();
                const token =
                    session.get(userKey)?.address === address ? session.get(userKey)?.token : null;
                if (!token) {
                    return sock.sendMessage(
                        jid,
                        {
                            text:
                                `❌ I don't have a session token for \`${address}\`.\n\n` +
                                'Generate a new address with `.tempmail` and use that inbox.',
                            contextInfo,
                        },
                        { quoted: message },
                    );
                }
                const inbox = await mail.checkInbox(token);
                if (!inbox?.length) {
                    return sock.sendMessage(
                        jid,
                        { text: `📭 *Inbox for* \`${address}\`\n\nNo messages yet.`, contextInfo },
                        { quoted: message },
                    );
                }

                const items = inbox
                    .slice(0, 5)
                    .map(
                        (m, i) =>
                            `*${i + 1}.* From: ${m.from || m.sender || 'Unknown'}\n   Subject: ${m.subject || '(no subject)'}`,
                    )
                    .join('\n\n');

                await sock.sendMessage(
                    jid,
                    {
                        text: `📬 *Inbox for* \`${address}\` (${inbox.length} message${inbox.length > 1 ? 's' : ''})\n\n${items}`,
                        contextInfo,
                    },
                    { quoted: message },
                );
            } catch (e) {
                await sock.sendMessage(
                    jid,
                    { text: `❌ Failed to fetch inbox: ${e.message}`, contextInfo },
                    { quoted: message },
                );
            }
        } else {
            try {
                const mail = new TempMail();
                const account = await mail.createInbox();
                const address = account.address || account.email;
                const token = account.token;
                if (!address || !token) throw new Error('Could not create inbox');
                session.set(userKey, { address, token });

                await sock.sendMessage(
                    jid,
                    {
                        text: [
                            `📧 *Temporary Email Generated*`,
                            ``,
                            `\`${address}\``,
                            ``,
                            `• Tap to copy the address above`,
                            `• Check inbox: \`.tempmail inbox\``,
                            ``,
                            `⚠️ This address is temporary — do not use for important accounts.`,
                        ].join('\n'),
                        contextInfo,
                    },
                    { quoted: message },
                );
            } catch (e) {
                await sock.sendMessage(
                    jid,
                    { text: `❌ Failed to create temp email: ${e.message}`, contextInfo },
                    { quoted: message },
                );
            }
        }
    },
};
