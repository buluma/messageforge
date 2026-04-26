'use strict';

const axios  = require('axios');
const moment = require('moment-timezone');

const REPO_URL    = 'https://github.com/SilvaTechB/silva-md-bot';
const WEBSITE_URL = 'https://silvatech.co.ke';
const WA_CHANNEL  = 'https://whatsapp.com/channel/0029VaksrRh6GcGnT0J05n0j';
const SUPPORT_URL = 'https://chat.whatsapp.com/GzCZZxVnAHMINWdPQkGwJR';

module.exports = {
    commands:    ['repo', 'repository', 'github'],
    description: 'Show ShadowBot repository info',
    permission:  'public',
    group:       true,
    private:     true,

    run: async (sock, message, args, ctx) => {
        const { contextInfo } = ctx;
        const jid = message.key.remoteJid;

        let data = null;
        try {
            const res = await axios.get(
                'https://api.github.com/repos/SilvaTechB/silva-md-bot',
                { timeout: 10000 }
            );
            data = res.data;
        } catch { /* use fallback */ }

        const caption = data
            ? `*✨ ShadowBot — REPOSITORY INFO*\n\n` +
              `📦 *Repo:* ${data.name}\n` +
              `📝 *About:* ${data.description || 'WhatsApp MD Bot'}\n\n` +
              `⭐ *Stars:* ${data.stargazers_count.toLocaleString()}\n` +
              `🍴 *Forks:* ${data.forks_count.toLocaleString()}\n` +
              `💻 *Language:* ${data.language || 'JavaScript'}\n` +
              `📦 *Size:* ${(data.size / 1024).toFixed(1)} MB\n` +
              `📜 *License:* ${data.license?.name || 'MIT'}\n` +
              `⚠️ *Open Issues:* ${data.open_issues}\n` +
              `🕒 *Updated:* ${moment(data.updated_at).fromNow()}\n\n` +
              `🔗 *GitHub:* ${REPO_URL}\n` +
              `🌐 *Website:* ${WEBSITE_URL}\n` +
              `📢 *Newsletter:* ${WA_CHANNEL}\n` +
              `💬 *Support:* ${SUPPORT_URL}\n\n` +
              `⚡ _Powered by Silva Tech Inc_`
            : `*✨ ShadowBot — REPOSITORY*\n\n` +
              `📦 *Repo:* silva-md-bot\n` +
              `💻 *Language:* JavaScript\n` +
              `📜 *License:* MIT\n\n` +
              `🔗 *GitHub:* ${REPO_URL}\n` +
              `🌐 *Website:* ${WEBSITE_URL}\n` +
              `📢 *Newsletter:* ${WA_CHANNEL}\n` +
              `💬 *Support:* ${SUPPORT_URL}\n\n` +
              `⚡ _Powered by Silva Tech Inc_`;

        await sock.sendMessage(jid, { text: caption, contextInfo }, { quoted: message });
    }
};
