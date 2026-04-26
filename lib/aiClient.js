'use strict';

const axios = require('axios');
const config = require('../config');

const DEFAULT_OPENROUTER_MODELS = ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-8b-instruct:free'];

function sanitizeHeader(value, fallback) {
    const str = String(value || '')
        .replace(/[^\x20-\x7E]+/g, ' ')
        .trim();
    return str || fallback;
}

function shouldLog(opts) {
    return opts?.log !== false;
}

function traceLabel(opts) {
    return opts?.trace ? String(opts.trace) : 'ai';
}

function logInfo(opts, msg) {
    if (!shouldLog(opts)) return;
    console.log(`[AI] [${traceLabel(opts)}] ${msg}`);
}

function isHtmlLike(text) {
    if (typeof text !== 'string') return false;
    const s = text.trim();
    return /^\s*<!doctype html/i.test(s) || /^\s*<html/i.test(s) || /<\/html>/i.test(s);
}

function normalizeText(raw) {
    if (typeof raw !== 'string') return null;
    const clean = raw.trim();
    if (!clean || clean.length < 2) return null;
    if (isHtmlLike(clean)) return null;
    return clean;
}

function parseMessageContent(content) {
    if (typeof content === 'string') return normalizeText(content);
    if (Array.isArray(content)) {
        const joined = content
            .map((part) => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (typeof part.text === 'string') return part.text;
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
        return normalizeText(joined);
    }
    return null;
}

function parseOpenRouterText(data) {
    const choice = data?.choices?.[0];
    if (!choice) return null;
    const messageText = parseMessageContent(choice.message?.content);
    if (messageText) return messageText;
    return normalizeText(choice.text);
}

function parseOllamaText(data) {
    const fromChat = normalizeText(data?.message?.content);
    if (fromChat) return fromChat;
    return normalizeText(data?.response);
}

function errorMessage(err) {
    return String(err?.response?.data?.error || err?.message || '').trim();
}

function toPrompt(messages) {
    return messages
        .map(
            (m) =>
                `${m.role === 'system' ? 'System' : m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`,
        )
        .join('\n')
        .trim();
}

function asMessages({ prompt, system, messages }) {
    if (Array.isArray(messages) && messages.length) return messages;
    const out = [];
    if (system && typeof system === 'string') out.push({ role: 'system', content: system });
    if (prompt && typeof prompt === 'string') out.push({ role: 'user', content: prompt });
    return out;
}

function getOpenRouterModels(customModels = []) {
    if (Array.isArray(customModels) && customModels.length) return customModels;
    const fromEnv = String(config.OPENROUTER_MODELS || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    if (fromEnv.length) return fromEnv;
    if (config.OPENROUTER_MODEL) return [config.OPENROUTER_MODEL];
    return DEFAULT_OPENROUTER_MODELS;
}

async function tryOpenRouter(messages, opts = {}) {
    const apiKey = config.OPENROUTER_API_KEY || '';
    if (!apiKey) return null;

    const models = getOpenRouterModels(opts.openRouterModels);
    const timeout = Number(opts.timeoutMs || config.AI_TIMEOUT_MS || 25000);
    const temperature = Number.isFinite(opts.temperature) ? opts.temperature : 0.7;
    const maxTokens = Number(opts.maxTokens || 700);

    for (const model of models) {
        try {
            const res = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model,
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                },
                {
                    timeout,
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': config.APP_URL || 'https://localhost',
                        'X-Title': sanitizeHeader(config.BOT_NAME, 'ShadowBot'),
                    },
                },
            );
            const text = parseOpenRouterText(res.data);
            if (text) return { text, provider: 'openrouter', model };
        } catch {
            // Try next model, then fallback to Ollama.
        }
    }
    return null;
}

async function getFallbackOllamaModel(baseUrl, preferredModel, timeout) {
    try {
        const res = await axios.get(`${baseUrl}/api/tags`, { timeout });
        const models = Array.isArray(res.data?.models) ? res.data.models : [];
        const names = models.map((m) => m?.name).filter(Boolean);
        const localModels = names.filter((name) => !name.endsWith(':cloud'));
        if (preferredModel && names.includes(preferredModel)) return preferredModel;
        if (localModels.length) return localModels[0];
        return names[0] || null;
    } catch {
        return null;
    }
}

async function tryOllama(messages, opts = {}) {
    const baseUrl = String(config.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const timeout = Number(opts.timeoutMs || config.AI_TIMEOUT_MS || 25000);
    const temperature = Number.isFinite(opts.temperature) ? opts.temperature : 0.7;
    let model = opts.ollamaModel || config.OLLAMA_MODEL || 'llama3.2';

    const requestChat = async (selectedModel) =>
        axios.post(
            `${baseUrl}/api/chat`,
            {
                model: selectedModel,
                messages,
                stream: false,
                options: { temperature },
            },
            { timeout },
        );

    const requestGenerate = async (selectedModel) =>
        axios.post(
            `${baseUrl}/api/generate`,
            {
                model: selectedModel,
                prompt: toPrompt(messages),
                stream: false,
                options: { temperature },
            },
            { timeout },
        );

    const runWithModel = async (selectedModel) => {
        try {
            const res = await requestChat(selectedModel);
            const text = parseOllamaText(res.data);
            if (text) return { text, provider: 'ollama', model: selectedModel };
        } catch (err) {
            const msg = errorMessage(err);
            if (!/does not support chat/i.test(msg)) throw err;
            const res = await requestGenerate(selectedModel);
            const text = parseOllamaText(res.data);
            if (text) return { text, provider: 'ollama', model: selectedModel };
        }
        return null;
    };

    try {
        const first = await runWithModel(model);
        if (first) return first;
    } catch {
        const fallbackModel = await getFallbackOllamaModel(baseUrl, model, timeout);
        if (!fallbackModel || fallbackModel === model) return null;
        model = fallbackModel;
        try {
            const second = await runWithModel(model);
            if (second) return second;
        } catch {
            return null;
        }
    }

    return null;
}

async function askTextAI(opts = {}) {
    const messages = asMessages(opts);
    if (!messages.length) return null;

    const primary = await tryOpenRouter(messages, opts);
    if (primary) {
        logInfo(opts, `provider=openrouter model=${primary.model}`);
        return primary;
    }

    if (config.OPENROUTER_API_KEY) {
        logInfo(opts, 'openrouter unavailable; trying ollama fallback');
    } else {
        logInfo(opts, 'OPENROUTER_API_KEY missing; using ollama fallback');
    }

    const fallback = await tryOllama(messages, opts);
    if (fallback) {
        logInfo(opts, `provider=ollama model=${fallback.model}`);
        return fallback;
    }

    logInfo(opts, 'all providers unavailable');

    return null;
}

module.exports = {
    askTextAI,
};
