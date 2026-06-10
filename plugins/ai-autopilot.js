'use strict';

const fs = require('fs');
const path = require('path');
const { askTextAI } = require('../lib/aiClient');
const config = require('../config');

const dataFile = path.join(__dirname, '..', 'data', 'autopilot.json');
const COOLDOWN_MS = Number(process.env.AUTOPILOT_COOLDOWN_MS || 15000);
const STYLE_SAMPLE_MAX = 18;
const LOG_MAX = 100;
const DEFAULT_PROFILE = 'Sound like me: natural, concise, direct, and human. Avoid overexplaining.';
const inFlightChats = new Set();
const lastReplyAt = new Map();

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

function normalizeState(raw) {
    const state = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (!state.chats && !state.settings) {
        return {
            version: 2,
            settings: {
                voiceProfile: DEFAULT_PROFILE,
                learnStyle: false,
                logReplies: true,
                minDelayMs: 1200,
                maxDelayMs: 4200,
            },
            chats: Object.fromEntries(
                Object.entries(state)
                    .filter(([, enabled]) => enabled === true)
                    .map(([jid]) => [jid, { enabled: true, mode: 'auto' }]),
            ),
            styleSamples: [],
            logs: [],
        };
    }

    return {
        version: 2,
        settings: {
            voiceProfile: state.settings?.voiceProfile || DEFAULT_PROFILE,
            learnStyle: state.settings?.learnStyle === true,
            logReplies: state.settings?.logReplies !== false,
            minDelayMs: Number(state.settings?.minDelayMs || 1200),
            maxDelayMs: Number(state.settings?.maxDelayMs || 4200),
        },
        chats: state.chats && typeof state.chats === 'object' ? state.chats : {},
        styleSamples: Array.isArray(state.styleSamples) ? state.styleSamples : [],
        logs: Array.isArray(state.logs) ? state.logs : [],
    };
}

function loadAutopilotState() {
    return normalizeState(loadState());
}

function saveAutopilotState(state) {
    saveState(normalizeState(state));
}

function ownerJid() {
    const digits = String(config.OWNER_NUMBER || '').replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : null;
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

function isCommandText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;

    const rawPrefix = String(config.PREFIX || '.').trim();
    const lower = rawPrefix.toLowerCase();
    const noPrefixMode = !rawPrefix || lower === 'none' || lower === 'false';
    const anyPrefixMode = lower === 'any';

    if (anyPrefixMode) return /^[^\w\s]/u.test(trimmed);
    if (noPrefixMode) {
        const first = trimmed.split(/\s+/)[0] || '';
        return /^[a-z][a-z0-9-]{1,30}$/i.test(first);
    }

    return rawPrefix
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .some((prefix) => trimmed.startsWith(prefix));
}

function shouldThrottle(jid) {
    if (inFlightChats.has(jid)) return true;
    const last = lastReplyAt.get(jid) || 0;
    return Date.now() - last < COOLDOWN_MS;
}

function clampDelay(settings) {
    const min = Math.max(0, Number(settings.minDelayMs || 0));
    const max = Math.max(min, Number(settings.maxDelayMs || min));
    return min + Math.floor(Math.random() * (max - min + 1));
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function addStyleSample(state, text) {
    const sample = String(text || '').trim();
    if (!sample || sample.length < 2) return;
    state.styleSamples.push({ text: sample.slice(0, 500), ts: Date.now() });
    if (state.styleSamples.length > STYLE_SAMPLE_MAX) {
        state.styleSamples = state.styleSamples.slice(-STYLE_SAMPLE_MAX);
    }
}

function buildStyleGuide(state) {
    const samples = state.styleSamples
        .slice(-8)
        .map((item, idx) => `${idx + 1}. ${item.text}`)
        .join('\n');
    return samples
        ? `Recent examples of my own writing style:\n${samples}`
        : 'No learned writing samples yet.';
}

function logDecision(state, entry) {
    if (state.settings.logReplies === false) return;
    state.logs.push({ ...entry, ts: Date.now() });
    if (state.logs.length > LOG_MAX) state.logs = state.logs.slice(-LOG_MAX);
}

function renderStatus(state, jid) {
    const chat = chatSettings(state, jid);
    return [
        `🤖 *AI Autopilot Status:* ${chat ? 'ON ✅' : 'OFF 🚫'}`,
        ``,
        `Mode: ${chat?.mode || 'auto'}`,
        `Learn style: ${state.settings.learnStyle ? 'ON ✅' : 'OFF 🚫'}`,
        `Logging: ${state.settings.logReplies ? 'ON ✅' : 'OFF 🚫'}`,
        `Delay: ${state.settings.minDelayMs}-${state.settings.maxDelayMs}ms`,
        `Style samples: ${state.styleSamples.length}`,
        ``,
        `Profile: ${state.settings.voiceProfile}`,
    ].join('\n');
}

function chatSettings(state, jid) {
    const chat = state.chats[jid];
    if (!chat || chat.enabled !== true) return null;
    return {
        mode: ['auto', 'ask', 'quiet'].includes(chat.mode) ? chat.mode : 'auto',
        enabled: true,
    };
}

async function decideReply({ text, history, state, mode }) {
    if (mode === 'quiet') return { shouldReply: false, reason: 'quiet mode' };
    const ai = await askTextAI({
        messages: [
            {
                role: 'system',
                content:
                    `Decide whether an autopilot assistant should reply to this WhatsApp message. ` +
                    `Return compact JSON only: {"reply":true|false,"reason":"short reason"}. ` +
                    `Do not reply when the message is rhetorical, closed-ended acknowledgement, spam, or better ignored.\n\n` +
                    `${state.settings.voiceProfile}\n\n${buildStyleGuide(state)}\n\nConversation:\n${history}`,
            },
            { role: 'user', content: text },
        ],
        maxTokens: 80,
        temperature: 0.2,
        trace: 'autopilot-decision',
    });
    const raw = String(ai?.text || '').trim();
    try {
        const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        return { shouldReply: parsed.reply !== false, reason: parsed.reason || 'model decision' };
    } catch {
        return {
            shouldReply: !/\b(ok|okay|thanks|thank you|cool|nice|lol|haha)\b\.?$/i.test(text),
            reason: 'fallback decision',
        };
    }
}

async function generateReply({ text, history, state }) {
    return askTextAI({
        messages: [
            {
                role: 'system',
                content:
                    `You are replying to a WhatsApp direct chat on behalf of the user. ` +
                    `Match the user's writing style and the mood of the conversation. ` +
                    `Do not over-explain. Do not announce that you are an AI. ` +
                    `Keep it natural for WhatsApp.\n\n` +
                    `Voice profile:\n${state.settings.voiceProfile}\n\n` +
                    `${buildStyleGuide(state)}\n\n` +
                    `Conversation so far:\n${history}`,
            },
            { role: 'user', content: text },
        ],
        maxTokens: 350,
        temperature: 0.75,
        trace: 'autopilot',
    });
}

module.exports = {
    commands: ['autopilot', 'ai-auto'],
    description: 'Toggle AI Auto-Pilot to automatically reply to direct chats',
    usage: '.autopilot on | .autopilot off | .autopilot status',
    permission: 'owner',
    group: false,
    private: true,

    run: async (_sock, _message, args, { sender, reply, isGroup }) => {
        if (isGroup) return reply('AI Autopilot is only available in direct chats.');
        const state = loadAutopilotState();
        const action = args[0]?.toLowerCase();
        const value = args.slice(1).join(' ').trim();
        const jid = sender;

        if (action === 'on') {
            state.chats[jid] = { ...(state.chats[jid] || {}), enabled: true, mode: 'auto' };
            saveAutopilotState(state);
            return reply(
                `✅ *AI Autopilot Enabled*\nI will now autonomously reply to new direct messages in this chat.`,
            );
        } else if (action === 'off') {
            delete state.chats[jid];
            saveAutopilotState(state);
            conversationMemory.delete(jid); // clear memory for this chat
            return reply(`🚫 *AI Autopilot Disabled*\nI have stopped auto-replying in this chat.`);
        } else if (action === 'status') {
            return reply(renderStatus(state, jid));
        } else if (action === 'profile') {
            if (!value) return reply(`Current profile:\n${state.settings.voiceProfile}`);
            state.settings.voiceProfile = value.toLowerCase() === 'reset' ? DEFAULT_PROFILE : value;
            saveAutopilotState(state);
            return reply('✅ Autopilot voice profile updated.');
        } else if (action === 'learn') {
            const sub = args[1]?.toLowerCase();
            if (sub === 'on') state.settings.learnStyle = true;
            else if (sub === 'off') state.settings.learnStyle = false;
            else if (sub === 'reset') state.styleSamples = [];
            else
                return reply(
                    `Learn style: ${state.settings.learnStyle ? 'ON' : 'OFF'}\nSamples: ${state.styleSamples.length}\nUse \`.autopilot learn on|off|reset\`.`,
                );
            saveAutopilotState(state);
            return reply('✅ Autopilot learning settings updated.');
        } else if (action === 'mode') {
            const mode = args[1]?.toLowerCase();
            if (!['auto', 'ask', 'quiet'].includes(mode)) {
                return reply('Usage: `.autopilot mode auto|ask|quiet`');
            }
            state.chats[jid] = { ...(state.chats[jid] || {}), enabled: true, mode };
            saveAutopilotState(state);
            return reply(`✅ Autopilot mode set to *${mode}*.`);
        } else if (action === 'delay') {
            const min = Number(args[1]);
            const max = Number(args[2]);
            if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
                return reply('Usage: `.autopilot delay <min_ms> <max_ms>`');
            }
            state.settings.minDelayMs = min;
            state.settings.maxDelayMs = max;
            saveAutopilotState(state);
            return reply(`✅ Autopilot delay set to ${min}-${max}ms.`);
        } else if (action === 'logs') {
            const logs = state.logs.slice(-5).reverse();
            if (!logs.length) return reply('No autopilot logs yet.');
            return reply(
                logs
                    .map(
                        (item, idx) =>
                            `${idx + 1}. ${new Date(item.ts).toLocaleString()}\n${item.decision}: ${item.reason}\n${item.input || ''}\n→ ${item.output || ''}`,
                    )
                    .join('\n\n'),
            );
        } else {
            return reply(
                `🤖 *AI Autopilot*\n\n` +
                    `Usage:\n` +
                    `• \`.autopilot on\` : Enable direct-message auto-replies here\n` +
                    `• \`.autopilot off\` : Disable auto-replies\n` +
                    `• \`.autopilot status\` : Check current status\n` +
                    `• \`.autopilot profile <style>\` : Set your voice profile\n` +
                    `• \`.autopilot learn on|off|reset\` : Learn from your own sent messages\n` +
                    `• \`.autopilot mode auto|ask|quiet\` : Reply mode\n` +
                    `• \`.autopilot delay <min_ms> <max_ms>\` : Typing delay\n` +
                    `• \`.autopilot logs\` : Last decisions/replies`,
            );
        }
    },

    onMessage: async (sock, message, text, { jid, isGroup, sender, isCommandLike }) => {
        if (!text || message.key.fromMe || isGroup) return;
        if (isCommandLike ?? isCommandText(text)) return;

        const targetJid = sender;
        const state = loadAutopilotState();
        const chat = chatSettings(state, targetJid);
        if (!chat) return; // Not active in this chat
        if (shouldThrottle(targetJid)) return;

        inFlightChats.add(targetJid);

        // Save user message
        rememberMessage(targetJid, 'user', text);

        const mem = getMemory(targetJid).slice(-6);
        const history = mem
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .join('\n');

        try {
            const decision = await decideReply({ text, history, state, mode: chat.mode });
            if (!decision.shouldReply) {
                logDecision(state, {
                    jid: targetJid,
                    decision: 'skipped',
                    reason: decision.reason,
                    input: text,
                });
                saveAutopilotState(state);
                return;
            }
            await sock.sendPresenceUpdate('composing', jid);
            await wait(clampDelay(state.settings));
            const ai = await generateReply({ text, history, state });

            if (ai && ai.text) {
                const responseText = String(ai.text).trim();
                if (responseText.length > 0) {
                    rememberMessage(targetJid, 'assistant', responseText);
                    if (chat.mode === 'ask') {
                        const owner = ownerJid();
                        if (owner) {
                            await sock.sendMessage(owner, {
                                text: `🤖 *Autopilot draft for ${targetJid}:*\n\n${responseText}`,
                            });
                        }
                    } else {
                        await sock.sendMessage(jid, { text: responseText }, { quoted: message });
                    }
                    logDecision(state, {
                        jid: targetJid,
                        decision: chat.mode === 'ask' ? 'drafted' : 'replied',
                        reason: decision.reason,
                        input: text,
                        output: responseText,
                    });
                    saveAutopilotState(state);
                }
            }
        } catch (e) {
            console.error('[Autopilot] AI request failed:', e.message);
        } finally {
            inFlightChats.delete(targetJid);
            lastReplyAt.set(targetJid, Date.now());
        }
    },

    onOwnMessage: async (_sock, message, text, { isGroup, isCommandLike }) => {
        if (!text || isGroup || isCommandLike || !message.key.fromMe) return;
        const state = loadAutopilotState();
        if (!state.settings.learnStyle) return;
        addStyleSample(state, text);
        saveAutopilotState(state);
    },

    _private: {
        dataFile,
        isCommandText,
        normalizeState,
        loadAutopilotState,
        loadState,
        saveState,
        addStyleSample,
        buildStyleGuide,
        conversationMemory,
        inFlightChats,
        lastReplyAt,
    },
};
