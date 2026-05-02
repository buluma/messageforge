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
            // Treat the messenger-history directory as existing, but not the per-chat JSON files.
            if (typeof p === 'string' && p.endsWith('messenger-history')) return true;
            return false;
        },
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
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

    test('soft-delete then next incoming message auto-restores (unhides) chat', async () => {
        const fs = require('fs');
        fs.writeFileSync.mockClear();

        const jid = 'restore-roundtrip@s.whatsapp.net';

        await store.softDeleteChat(jid);

        const hiddenWritesAfterDelete = fs.writeFileSync.mock.calls
            .filter(([p]) => String(p).includes('hidden-chats.json'));
        expect(hiddenWritesAfterDelete.length).toBeGreaterThan(0);
        const deletePayload = hiddenWritesAfterDelete[hiddenWritesAfterDelete.length - 1][1];
        expect(JSON.parse(deletePayload)).toContain(jid);

        await store.persistMessages([
            {
                key: { remoteJid: jid, id: 'm1', fromMe: false },
                message: { conversation: 'hi' },
                messageTimestamp: 1710000000,
                pushName: 'Bob',
            },
        ]);

        const hiddenWritesAfterPersist = fs.writeFileSync.mock.calls
            .filter(([p]) => String(p).includes('hidden-chats.json'));
        expect(hiddenWritesAfterPersist.length).toBeGreaterThan(hiddenWritesAfterDelete.length);
        const persistPayload = hiddenWritesAfterPersist[hiddenWritesAfterPersist.length - 1][1];
        expect(JSON.parse(persistPayload)).not.toContain(jid);
    });
});

describe('atomic writes', () => {
    test('persistMessages writes chat history via tmp + rename (atomic pattern)', async () => {
        const fs = require('fs');
        fs.writeFileSync.mockClear();
        fs.renameSync.mockClear();

        const jid = 'atomic-write@s.whatsapp.net';
        await store.persistMessages([
            {
                key: { remoteJid: jid, id: 'm-atomic-1', fromMe: false },
                message: { conversation: 'hello' },
                messageTimestamp: 1710000001,
                pushName: 'Bob',
            },
        ]);

        // There are other writes (e.g. index), but at least one should be a chat file.
        const tmpWrites = fs.writeFileSync.mock.calls
            .map(([p]) => String(p))
            .filter((p) => p.includes('messenger-history') && p.endsWith('.json.tmp'));
        expect(tmpWrites.length).toBeGreaterThan(0);

        const renames = fs.renameSync.mock.calls
            .map(([from, to]) => [String(from), String(to)])
            .filter(([, to]) => to.includes('messenger-history') && to.endsWith('.json'));
        expect(renames.length).toBeGreaterThan(0);

        // Basic contract: each rename targets a non-.tmp file and sources a .tmp file
        for (const [from, to] of renames) {
            expect(from.endsWith('.tmp')).toBe(true);
            expect(to.endsWith('.tmp')).toBe(false);
        }
    });
});
