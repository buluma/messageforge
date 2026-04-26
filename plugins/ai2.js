'use strict';

const config = require('../config');
const { fmt } = require('../lib/theme');
const { askTextAI } = require('../lib/aiClient');

function preferredModels(key) {
    const map = {
        gemini: ['google/gemini-2.5-flash-preview'],
        gpt4: ['openai/gpt-4o', 'openai/gpt-4o-mini'],
        venice: ['meta-llama/llama-3.3-8b-instruct:free'],
    };
    const base = Array.isArray(map[key]) ? map[key] : [];
    const fromEnv = String(config.OPENROUTER_MODELS || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    if (config.OPENROUTER_MODEL) fromEnv.unshift(config.OPENROUTER_MODEL);
    return [...new Set([...base, ...fromEnv])].filter(Boolean);
}

function buildMessages(query) {
    return [
        {
            role: 'system',
            content:
                'You are Silva, a concise and helpful WhatsApp assistant. Keep answers clear and practical.',
        },
        { role: 'user', content: query },
    ];
}

async function fallbackWebAnswer(query) {
    try {
        const axios = require('axios');
        const res = await axios.get(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
            { timeout: 7000 },
        );
        const d = res.data || {};
        const abstract = String(d.AbstractText || '').trim();
        if (abstract.length > 10) return abstract;
        const related = d.RelatedTopics?.find((x) => x?.Text)?.Text;
        if (related && related.length > 10) return related.trim();
    } catch {
        return null;
    }
    return null;
}

function buildPlugin(cmds, label, key) {
    return {
        commands: cmds,
        description: `Ask ${label} a question`,
        usage: `.${cmds[0]} <question>`,
        permission: 'public',
        group: true,
        private: true,

        run: async (sock, message, args, ctx) => {
            const { jid, contextInfo } = ctx;
            const query = args.join(' ').trim();

            if (!query) {
                return sock.sendMessage(
                    jid,
                    {
                        text: fmt(
                            `❌ *Usage:* \`.${cmds[0]} <question>\`\n\nExample: \`.${cmds[0]} What is quantum computing?\``,
                        ),
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            await sock.sendPresenceUpdate('composing', jid);

            const ai = await askTextAI({
                messages: buildMessages(query),
                openRouterModels: preferredModels(key),
                maxTokens: 700,
                temperature: 0.75,
                trace: `ai2:${cmds[0]}`,
            });

            let answer = ai?.text || null;
            if (!answer) answer = await fallbackWebAnswer(query);
            if (!answer)
                answer = '⚠️ AI providers unavailable (OpenRouter + Ollama). Try again later.';

            await sock.sendMessage(
                jid,
                {
                    text: fmt(
                        `🤖 *${label}*\n\n❓ *Q:* ${query}\n\n💬 *A:* ${answer}${
                            ai
                                ? `\n\n_⚙️ via ${ai.provider}${ai.model ? ` (${ai.model})` : ''}_`
                                : ''
                        }`,
                    ),
                    contextInfo,
                },
                { quoted: message },
            );
        },
    };
}

const chatai = buildPlugin(['chatai'], 'ChatAI', 'chatai');
const gemini = buildPlugin(['gemini', 'bard'], 'Gemini AI', 'gemini');
const giftedai = buildPlugin(['giftedai'], 'Gifted AI', 'chatai');
const gpt4 = buildPlugin(['gpt4', 'gpt-4'], 'GPT-4', 'gpt4');
const gpt4o = buildPlugin(['gpt4o', 'gpt-4o'], 'GPT-4o', 'gpt4');
const gpt4omini = buildPlugin(['gpt4o-mini'], 'GPT-4o Mini', 'gpt4');
const openai = buildPlugin(['openai'], 'OpenAI', 'gpt4');
const venice = buildPlugin(['venice'], 'Venice AI', 'venice');
const letmegpt = buildPlugin(['letmegpt'], 'LetMeGPT', 'chatai');

module.exports = [chatai, gemini, giftedai, gpt4, gpt4o, gpt4omini, openai, venice, letmegpt];
