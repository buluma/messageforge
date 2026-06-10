'use strict';

const { performance } = require('perf_hooks');
const os = require('os');

module.exports = {
    commands: ['ping', 'uptime', 'runtime'],
    description: 'Check bot response time, uptime, and system stats',
    permission: 'public',
    group: true,
    private: true,
    run: async (sock, message, args, { contextInfo, safeSend, getStr }) => {
        const botName = getStr('botName') || 'MessageForge';
        const pic = getStr('pic1') || '';

        const start = performance.now();
        await safeSend({ text: '🏓 _Pinging..._' }, { quoted: message });
        const ms = (performance.now() - start).toFixed(2);

        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = Math.floor(uptime % 60);

        const cpu = os.cpus()[0]?.model || 'Unknown CPU';
        const platform = os.platform().toUpperCase();
        const totalMem = (os.totalmem() / 1073741824).toFixed(2);
        const freeMem = (os.freemem() / 1073741824).toFixed(2);

        const caption = `┏━━━━━━━━━━━━━━━┓
      ✦ *${botName} Status* ✦
┗━━━━━━━━━━━━━━━┛

⏱ *Response:* ${ms} ms
🕒 *Uptime:* ${h}h ${m}m ${s}s
🖥 *CPU:* ${cpu}
🏗 *Platform:* ${platform}
🛠 *RAM:* ${freeMem} GB / ${totalMem} GB

✨ _Powered by ${botName}_`;

        if (pic) {
            await safeSend({ image: { url: pic }, caption, contextInfo }, { quoted: message });
        } else {
            await safeSend({ text: caption, contextInfo }, { quoted: message });
        }
    },
};
