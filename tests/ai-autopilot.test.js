'use strict';

let mockFiles;

jest.mock('fs', () => ({
    existsSync: jest.fn((file) => Object.prototype.hasOwnProperty.call(mockFiles, file)),
    readFileSync: jest.fn((file) => mockFiles[file]),
    writeFileSync: jest.fn((file, data) => {
        mockFiles[file] = data;
    }),
    mkdirSync: jest.fn(),
}));

jest.mock('../config', () => ({
    PREFIX: '.',
    OWNER_NUMBER: '254712345678',
}));

jest.mock('../lib/aiClient', () => ({
    askTextAI: jest.fn(),
}));

const config = require('../config');
const { askTextAI } = require('../lib/aiClient');
const autopilot = require('../plugins/ai-autopilot');

function setState(state) {
    mockFiles[autopilot._private.dataFile] = JSON.stringify(state);
}

function activeState(overrides = {}) {
    return {
        version: 2,
        settings: {
            voiceProfile: 'short and casual',
            learnStyle: false,
            logReplies: true,
            minDelayMs: 0,
            maxDelayMs: 0,
            ...(overrides.settings || {}),
        },
        chats: {
            'user@s.whatsapp.net': { enabled: true, mode: 'auto' },
            ...(overrides.chats || {}),
        },
        styleSamples: overrides.styleSamples || [],
        logs: overrides.logs || [],
    };
}

describe('ai-autopilot', () => {
    beforeEach(() => {
        mockFiles = {};
        askTextAI.mockReset();
        autopilot._private.conversationMemory.clear();
        autopilot._private.inFlightChats.clear();
        autopilot._private.lastReplyAt.clear();
        config.PREFIX = '.';
    });

    test('is private-only and deletes state when disabled', async () => {
        const reply = jest.fn();
        await autopilot.run(null, null, ['on'], {
            sender: 'user@s.whatsapp.net',
            reply,
            isGroup: false,
        });

        expect(JSON.parse(mockFiles[autopilot._private.dataFile]).chats).toEqual({
            'user@s.whatsapp.net': { enabled: true, mode: 'auto' },
        });
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('Enabled'));

        await autopilot.run(null, null, ['off'], {
            sender: 'user@s.whatsapp.net',
            reply,
            isGroup: false,
        });
        expect(JSON.parse(mockFiles[autopilot._private.dataFile]).chats).toEqual({});

        await autopilot.run(null, null, ['on'], {
            sender: 'group@g.us',
            reply,
            isGroup: true,
        });
        expect(reply).toHaveBeenLastCalledWith('AI Autopilot is only available in direct chats.');
    });

    test('skips groups, commands, disabled chats, and throttled chats', async () => {
        setState(activeState());
        askTextAI
            .mockResolvedValueOnce({ text: '{"reply":true,"reason":"needs answer"}' })
            .mockResolvedValueOnce({ text: 'hello' });
        const sock = {
            sendPresenceUpdate: jest.fn(),
            sendMessage: jest.fn(),
        };
        const message = { key: { fromMe: false } };

        await autopilot.onMessage(sock, message, 'hello', {
            jid: 'group@g.us',
            sender: 'group@g.us',
            isGroup: true,
        });
        await autopilot.onMessage(sock, message, '.alive', {
            jid: 'user@s.whatsapp.net',
            sender: 'user@s.whatsapp.net',
            isGroup: false,
            isCommandLike: true,
        });
        await autopilot.onMessage(sock, message, 'hello', {
            jid: 'other@s.whatsapp.net',
            sender: 'other@s.whatsapp.net',
            isGroup: false,
            isCommandLike: false,
        });

        expect(askTextAI).not.toHaveBeenCalled();

        await autopilot.onMessage(sock, message, 'hello', {
            jid: 'user@s.whatsapp.net',
            sender: 'user@s.whatsapp.net',
            isGroup: false,
            isCommandLike: false,
        });
        await autopilot.onMessage(sock, message, 'again', {
            jid: 'user@s.whatsapp.net',
            sender: 'user@s.whatsapp.net',
            isGroup: false,
            isCommandLike: false,
        });

        expect(askTextAI).toHaveBeenCalledTimes(2);
        expect(sock.sendMessage).toHaveBeenCalledWith(
            'user@s.whatsapp.net',
            { text: 'hello' },
            { quoted: message },
        );
    });

    test('fallback prefix detection supports comma prefixes and any-prefix mode', () => {
        config.PREFIX = '.,!,?';
        expect(autopilot._private.isCommandText('!alive')).toBe(true);
        expect(autopilot._private.isCommandText('hello')).toBe(false);

        config.PREFIX = 'any';
        expect(autopilot._private.isCommandText('#alive')).toBe(true);
        expect(autopilot._private.isCommandText('hello')).toBe(false);
    });

    test('ask mode sends a draft to the owner instead of replying to the chat', async () => {
        setState(
            activeState({
                chats: {
                    'user@s.whatsapp.net': { enabled: true, mode: 'ask' },
                },
            }),
        );
        askTextAI
            .mockResolvedValueOnce({ text: '{"reply":true,"reason":"useful"}' })
            .mockResolvedValueOnce({ text: 'draft reply' });

        const sock = {
            sendPresenceUpdate: jest.fn(),
            sendMessage: jest.fn(),
        };
        const message = { key: { fromMe: false } };

        await autopilot.onMessage(sock, message, 'can you check this?', {
            jid: 'user@s.whatsapp.net',
            sender: 'user@s.whatsapp.net',
            isGroup: false,
            isCommandLike: false,
        });

        expect(sock.sendMessage).toHaveBeenCalledTimes(1);
        expect(sock.sendMessage).toHaveBeenCalledWith('254712345678@s.whatsapp.net', {
            text: expect.stringContaining('draft reply'),
        });
    });

    test('learn mode stores own-message style samples', async () => {
        setState(activeState({ settings: { learnStyle: true, minDelayMs: 0, maxDelayMs: 0 } }));

        await autopilot.onOwnMessage(null, { key: { fromMe: true } }, 'yeah that works for me', {
            isGroup: false,
            isCommandLike: false,
        });

        const saved = JSON.parse(mockFiles[autopilot._private.dataFile]);
        expect(saved.styleSamples).toHaveLength(1);
        expect(saved.styleSamples[0].text).toBe('yeah that works for me');
    });
});
