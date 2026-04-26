'use strict';
const { askTextAI } = require('../lib/aiClient');

module.exports = {
    commands: ['summarize', 'summary', 'tldr', 'shorten', 'brief'],
    description: 'AI summarizes any long text, article, or quoted message',
    usage: '.summarize <text> OR reply to a long message',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const { reply, safeSend } = ctx;

        // Accept direct text, quoted message text, or args
        const quoted = message.message?.extendedTextMessage?.contextInfo;
        const quotedText =
            quoted?.quotedMessage?.conversation ||
            quoted?.quotedMessage?.extendedTextMessage?.text ||
            '';

        const inputText = args.join(' ').trim() || quotedText;

        if (!inputText) {
            return reply(
                `📝 *Summarizer*\n\n` +
                    `Reply to any long message with \`.summarize\` to get a quick summary.\n\n` +
                    `Or provide text directly:\n` +
                    `\`.summarize The quick brown fox jumps over...\`\n\n` +
                    `_Aliases: .tldr  .brief  .shorten_`,
            );
        }

        if (inputText.length < 100) {
            return reply(
                `⚠️ The text is too short to summarize (${inputText.length} chars). Provide a longer piece of text.`,
            );
        }

        await safeSend({ text: `📝 _Summarizing..._` }, { quoted: message });

        const prompt = `Summarize the following text in clear, concise bullet points. Be brief but cover all key points:\n\n${inputText}`;

        // 1. Try OpenRouter (primary) + Ollama (fallback)
        try {
            const ai = await askTextAI({
                messages: [
                    {
                        role: 'system',
                        content:
                            'You summarize text into concise bullet points. Keep key facts and avoid fluff.',
                    },
                    { role: 'user', content: prompt },
                ],
                maxTokens: 700,
                temperature: 0.4,
                trace: 'summarize',
            });
            if (ai?.text) return reply(`📝 *Summary*\n\n${String(ai.text).trim()}`);
        } catch {
            // fall through
        }

        // 2. Built-in extractive summarization (no API)
        const sentences = inputText
            .replace(/\s+/g, ' ')
            .split(/(?<=[.!?])\s+/)
            .filter((s) => s.length > 20);

        const maxSentences = Math.min(5, Math.ceil(sentences.length * 0.3));
        const extracted = sentences.slice(0, maxSentences).join(' ');

        reply(
            `📝 *Summary* _(extracted)_\n\n${extracted}\n\n` +
                `_Original: ${inputText.length} chars → Summary: ${extracted.length} chars_`,
        );
    },
};
