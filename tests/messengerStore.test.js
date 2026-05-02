'use strict';

jest.mock('../config', () => ({ DATABASE_TYPE: 'json' }));
jest.mock('../lib/database', () => ({ getPgPool: () => null }));
jest.mock('../lib/logger', () => ({
    custom: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

// Move jest.requireActual inside the factory to avoid hoisting scope issues
jest.mock('fs', () => {
    const realFs = jest.requireActual('fs');
    return {
        ...realFs,
        existsSync: (p) => {
            if (p && (p.includes('hidden-chats.json') || p.includes('index.json'))) return false;
            if (p && p.includes('messenger-history')) return true;
            return false;
        },
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: realFs.readFileSync,
        unlinkSync: jest.fn(),
    };
});

let store;

beforeAll(() => {
    store = require('../lib/messengerStore');
});

describe('messengerStore module', () => {
    test('loads without throwing', () => {
        expect(store).toBeDefined();
    });

    test('exports softDeleteChat as a function', () => {
        expect(typeof store.softDeleteChat).toBe('function');
    });

    test('exports the expected public API surface', () => {
        const expected = [
            'persistMessages',
            'listKnownJids',
            'getLatestMessage',
            'getLatestIncomingPushName',
            'getMessagesPage',
            'getMessageById',
            'initMessagesSchema',
            'softDeleteChat',
        ];
        for (const fn of expected) {
            expect(typeof store[fn]).toBe('function');
        }
    });
});

describe('softDeleteChat', () => {
    test('resolves without throwing for a valid JID', async () => {
        await expect(store.softDeleteChat('254712345678@s.whatsapp.net')).resolves.toBeUndefined();
    });

    test('resolves without throwing for a group JID', async () => {
        await expect(store.softDeleteChat('120363123456789012@g.us')).resolves.toBeUndefined();
    });

    test('calls writeFileSync to persist hidden-chats after soft-delete', async () => {
        const fs = require('fs');
        fs.writeFileSync.mockClear();
        await store.softDeleteChat('9991112222@s.whatsapp.net');
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('hidden-chats.json'),
            expect.any(String),
        );
    });

    test('calling softDeleteChat twice on same JID does not throw', async () => {
        const jid = 'repeated@s.whatsapp.net';
        await store.softDeleteChat(jid);
        await expect(store.softDeleteChat(jid)).resolves.toBeUndefined();
    });
});
