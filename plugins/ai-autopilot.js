'use strict';

const fs = require('fs');
const path = require('path');
const { askTextAI } = require('../lib/aiClient');
const config = require('../config');

const dataFile = path.join(__dirname, '..', 'data', 'autopilot.json');

function loadState() {
    try {
        if (fs.existsSync(dataFile)) {
            return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        }
    } catch (e) {
        console.error('[Autopilot] Failed to load state:', e.message);
    }
    return {};
}

function saveState(data) {
    try {
        fs.mkdirSync(path.dirname(dataFile), { recursive: true });
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[Autopilot] Failed to save state:', e.message);
    }
}

// Memory to keep context
const conversationMemory = new Map();
const MEMORY_MAX = 8;

function rememberMessage(jid, role, text) {
    if (!conversationMemory.has(jid)) conversationMemory.set(jid, []);
    const mem = conversationMemory.get(jid);
    mem.push({ role, text, ts: Date.now() });
    if (mem.length > MEMORY_MAX) mem.shift();
}

function getMemory(jid) {
    return conversationMemory.get(jid) || [];
}

module.exports = {
    commands: ['autopilot', 'ai-auto'],
    description: 'Toggle AI Auto-Pilot to automatically reply to chats',
    usage: '.autopilot on | .autopilot off | .autopilot status',
    permission: 'owner',
    group: true,
    private: true,

    run: async (sock, message, args, { sender, reply, isGroup }) => {
        const state = loadState();
        const action = args[0]?.toLowerCase();
        const jid = isGroup ? message.key.remoteJid : sender;

        if (action === 'on') {
            state[jid] = true;
            saveState(state);
            return reply(`✅ *AI Autopilot Enabled*\nI will now autonomously reply to new messages in this chat.`);
        } else if (action === 'off') {
            state[jid] = false;
            saveState(state);
            conversationMemory.delete(jid); // clear memory for this chat
            return reply(`🚫 *AI Autopilot Disabled*\nI have stopped auto-replying in this chat.`);
        } else if (action === 'status') {
            const status = state[jid] ? 'ON ✅' : 'OFF 🚫';
            return reply(`🤖 *AI Autopilot Status:* ${status}\n\nUse \`.autopilot on\` or \`.autopilot off\` to change it.`);
        } else {
            return reply(
                `🤖 *AI Autopilot*\n\n` +
                `Usage:\n` +
                `• \`.autopilot on\` : Enable auto-replies here\n` +
                `• \`.autopilot off\` : Disable auto-replies\n` +
                `• \`.autopilot status\` : Check current status`
            );
        }
    },

    onMessage: async (sock, message, text, { jid, isGroup, sender }) => {
        if (!text || message.key.fromMe) return;

        // Skip commands
        let isCommand = false;
        for (const p of Array.from(config.PREFIX || '^[.!]+')) {
            if (text.startsWith(p)) {
                isCommand = true;
                break;
            }
        }
        if (isCommand) return;

        const targetJid = isGroup ? jid : sender;
        const state = loadState();
        if (!state[targetJid]) return; // Not active in this chat

        // Save user message
        rememberMessage(targetJid, 'user', text);

        const mem = getMemory(targetJid).slice(-6);
        const history = mem.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');

        await sock.sendPresenceUpdate('composing', jid);

        try {
            const ai = await askTextAI({
                messages: [
                    {
                        role: 'system',
                        content: 
                            `You are an AI assistant taking over the WhatsApp chat on behalf of the user. ` +
                            `Be friendly, natural, and helpful. Do not sound like a generic customer support bot. ` +
                            `Keep responses concise since this is a WhatsApp chat.\n\n` +
                            `Conversation so far:\n${history}`
                    },
                    { role: 'user', content: text }
                ],
                maxTokens: 500,
                temperature: 0.7,
                trace: 'autopilot'
            });

            if (ai && ai.text) {
                const responseText = String(ai.text).trim();
                if (responseText.length > 0) {
                    rememberMessage(targetJid, 'assistant', responseText);
                    await sock.sendMessage(jid, { text: responseText }, { quoted: message });
                }
            }
        } catch (e) {
            console.error('[Autopilot] AI request failed:', e.message);
        }
    }
};
