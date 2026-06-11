'use strict';

jest.mock('../config', () => ({
    PREFIX: '.',
    MODE: 'public',
    OWNER_NUMBER: '254712345678',
    AUTO_TYPING: false,
    AUTO_RECORDING: false,
    BOT_NUMBER: '',
    SUDO: '',
    THEME: 'messageforge',
    DATABASE_TYPE: 'local',
    STRICT_COMMAND_COLLISIONS: false,
}));

jest.mock('../lib/theme', () => ({
    getStr: jest.fn((key) => key),
    getActiveTheme: jest.fn(() => ({ global: {} })),
}));

jest.mock('../lib/logger', () => ({
    custom: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

jest.mock('fs', () => {
    const realFs = jest.requireActual('fs');
    return {
        ...realFs,
        readdirSync: (dir, ...args) => {
            if (typeof dir === 'string' && dir.includes('plugins')) return [];
            return realFs.readdirSync(dir, ...args);
        },
    };
});

const logger = require('../lib/logger');
const {
    handleMessages,
    safeSend,
    PERM,
    plugins,
    jidToNum,
    sameNumber,
    levenshtein,
    predictCommand,
    groupCache,
} = require('../handler');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSock(overrides = {}) {
    return {
        sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg-id' } }),
        sendPresenceUpdate: jest.fn().mockResolvedValue(null),
        groupMetadata: jest.fn().mockRejectedValue(new Error('not a group')),
        user: { id: '999000000@s.whatsapp.net' },
        // Bypass rate-limit jitter — tests must not wait on random delays
        __messageforgeSendGuarded: true,
        ...overrides,
    };
}

function makeMsg({ jid, from, text, fromMe = false } = {}) {
    const remoteJid = jid || '254712345678@s.whatsapp.net';
    const participant = from && from !== remoteJid ? from : undefined;
    return {
        key: { remoteJid, id: 'key-id', fromMe, participant },
        message: { conversation: text || '' },
    };
}

// Each test that uses group metadata needs a unique JID to avoid groupCache hits
// from previous tests. The cache is module-level and persists across test runs.
let _groupJidCounter = 100;
function makeGroupJid() {
    return `120363${_groupJidCounter++}@g.us`;
}

function makeGroupSock(participants = []) {
    const sock = makeSock();
    sock.groupMetadata = jest.fn().mockResolvedValue({ participants });
    return sock;
}

function makePlugin(commands, opts = {}) {
    return {
        commands,
        permission: PERM.PUBLIC,
        group: true,
        private: true,
        run: jest.fn().mockResolvedValue(null),
        ...opts,
    };
}

// Push plugins into the live array; return teardown fn
function withPlugins(...pluginList) {
    plugins.push(...pluginList);
    return () => {
        for (const p of pluginList) {
            const i = plugins.indexOf(p);
            if (i >= 0) plugins.splice(i, 1);
        }
    };
}

// ─── jidToNum ────────────────────────────────────────────────────────────────

describe('jidToNum', () => {
    test('extracts number from standard @s.whatsapp.net JID', () => {
        expect(jidToNum('254712345678@s.whatsapp.net')).toBe('254712345678');
    });

    test('strips device suffix from colon-variant JID', () => {
        expect(jidToNum('254712345678:12@s.whatsapp.net')).toBe('254712345678');
    });

    test('returns empty string for null', () => {
        expect(jidToNum(null)).toBe('');
    });

    test('returns empty string for empty string', () => {
        expect(jidToNum('')).toBe('');
    });

    test('extracts number from group JID', () => {
        expect(jidToNum('120363123456789012@g.us')).toBe('120363123456789012');
    });
});

// ─── sameNumber ──────────────────────────────────────────────────────────────

describe('sameNumber', () => {
    test('returns true for identical numbers', () => {
        expect(sameNumber('254712345678', '254712345678')).toBe(true);
    });

    test('returns true when last 9 digits match (local vs international format)', () => {
        expect(sameNumber('254712345678', '0712345678')).toBe(true);
    });

    test('returns false for clearly different numbers', () => {
        expect(sameNumber('254712345678', '254799999999')).toBe(false);
    });

    test('returns false when first argument is empty string', () => {
        expect(sameNumber('', '254712345678')).toBe(false);
    });

    test('returns false when first argument is null', () => {
        expect(sameNumber(null, '254712345678')).toBe(false);
    });

    test('returns false when differing numbers share fewer than 6 tail digits', () => {
        expect(sameNumber('12345', '22345')).toBe(false);
    });

    test('returns true for identical short strings (fast-path)', () => {
        expect(sameNumber('12345', '12345')).toBe(true);
    });
});

// ─── levenshtein ─────────────────────────────────────────────────────────────

describe('levenshtein', () => {
    test('identical strings → 0', () => {
        expect(levenshtein('ping', 'ping')).toBe(0);
    });

    test('single substitution → 1', () => {
        // 'pong' vs 'ping': only middle char differs (o→i)
        expect(levenshtein('pong', 'ping')).toBe(1);
    });

    test('single insertion → 1', () => {
        expect(levenshtein('png', 'ping')).toBe(1);
    });

    test('single deletion → 1', () => {
        // 'pings' has one extra char vs 'ping'
        expect(levenshtein('pings', 'ping')).toBe(1);
    });

    test('transposition counts as 2 edits (not Damerau)', () => {
        // Standard Levenshtein: 'pign' → 'ping' requires delete 'g' + insert 'g' = 2
        expect(levenshtein('pign', 'ping')).toBe(2);
    });

    test('single char wrong → 1', () => {
        // 'pigg' vs 'ping': p=p, i=i, g→n (sub), g=g → dist=1
        expect(levenshtein('pigg', 'ping')).toBe(1);
    });

    test('completely different strings → max distance', () => {
        expect(levenshtein('abc', 'xyz')).toBe(3);
    });

    test('empty string to word → word length', () => {
        expect(levenshtein('', 'ping')).toBe(4);
    });

    test('word to empty string → word length', () => {
        expect(levenshtein('ping', '')).toBe(4);
    });
});

// ─── predictCommand ───────────────────────────────────────────────────────────

describe('predictCommand', () => {
    const ping = makePlugin(['ping']);
    const pint = makePlugin(['pint']);
    const pirate = makePlugin(['pirate']);
    const help = makePlugin(['help']);
    const hello = makePlugin(['hello']);

    test('exact prefix match: typed ≥ 3 chars matching one command', () => {
        const result = predictCommand('pin', [ping, help]);
        expect(result).toMatchObject({ match: 'ping', confidence: 'prefix' });
    });

    test('ambiguous: typed prefix matches multiple commands', () => {
        // 'pin' is a prefix of both 'ping' and 'pint'
        const result = predictCommand('pin', [ping, pint]);
        expect(result).toMatchObject({ confidence: 'ambiguous' });
        expect(result.matches).toContain('ping');
        expect(result.matches).toContain('pint');
    });

    test('prefix check skipped for typed < 3 chars', () => {
        // 'pi' is 2 chars, falls through to Levenshtein — too far from 'ping'/'pirate'
        const result = predictCommand('pi', [ping, pirate]);
        expect(result).toBeNull();
    });

    test('typo correction: single substitution within threshold', () => {
        // 'pong' vs 'ping' = 1 edit, threshold for len=4 is 1
        const result = predictCommand('pong', [ping]);
        expect(result).toMatchObject({ match: 'ping', confidence: 'typo' });
    });

    test('typo correction: single deletion within threshold', () => {
        // 'pings' vs 'ping' = 1, threshold for len=5 is 1
        const result = predictCommand('pings', [ping]);
        expect(result).toMatchObject({ match: 'ping' });
    });

    test('short commands use threshold 1: 2-edit typo not corrected', () => {
        // 'pigg' vs 'pint' = 2 edits (i→i, g→n, g→t), threshold for len=4 is 1 → no match
        const result = predictCommand('pigg', [pint]);
        expect(result).toBeNull();
    });

    test('longer commands use threshold 2: 2-edit fuzzy match', () => {
        // 'helloo' (6 chars) vs 'hello' = 1 edit (insertion) → matches within threshold 2
        const result = predictCommand('helloo', [hello, help]);
        expect(result).not.toBeNull();
        expect(result.match).toBe('hello');
    });

    test('returns null when no command within threshold', () => {
        const result = predictCommand('zzz', [ping, help]);
        expect(result).toBeNull();
    });
});

// ─── handleMessages ───────────────────────────────────────────────────────────

describe('handleMessages', () => {
    let cleanup;
    let plugin;

    beforeEach(() => {
        plugin = makePlugin(['ping']);
        cleanup = withPlugins(plugin);
        delete global.bannedUsers;
        delete global.sudoUsers;
        delete global.botLid;
        delete global.botNum;
        // Clear group metadata cache so tests don't bleed into each other
        groupCache.clear();
    });

    afterEach(() => {
        cleanup();
        jest.clearAllMocks();
    });

    // ── No-op cases ─────────────────────────────────────────────────────────

    test('ignores message with no message body', async () => {
        const sock = makeSock();
        await handleMessages(sock, {
            key: { remoteJid: '123@s.whatsapp.net', id: 'x', fromMe: false },
            message: null,
        });
        expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    test('ignores message with no matching prefix', async () => {
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: 'hello world' }));
        expect(plugin.run).not.toHaveBeenCalled();
    });

    test('ignores empty command after prefix', async () => {
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.' }));
        expect(plugin.run).not.toHaveBeenCalled();
    });

    // ── Prefix parsing ───────────────────────────────────────────────────────

    test('dispatches with single prefix "."', async () => {
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    test('passes args to plugin', async () => {
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping foo bar' }));
        expect(plugin.run).toHaveBeenCalledWith(
            sock,
            expect.anything(),
            ['foo', 'bar'],
            expect.any(Object),
        );
    });

    test('command is lowercased before dispatch', async () => {
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.PING' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    // ── Permission gates ─────────────────────────────────────────────────────

    test('public plugin runs for any user', async () => {
        plugin.permission = PERM.PUBLIC;
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', from: '111111111@s.whatsapp.net' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    test('admin plugin blocked for non-admin in group', async () => {
        plugin.permission = PERM.ADMIN;
        const sender = '111111111@s.whatsapp.net';
        const groupJid = makeGroupJid();
        const sock = makeGroupSock([
            { id: sender, admin: null },
            { id: '999000000@s.whatsapp.net', admin: 'superadmin' },
        ]);
        await handleMessages(sock, makeMsg({ jid: groupJid, from: sender, text: '.ping' }));
        expect(plugin.run).not.toHaveBeenCalled();
        expect(sock.sendMessage).toHaveBeenCalledWith(
            groupJid,
            expect.objectContaining({ text: expect.stringContaining('admin') }),
            expect.any(Object),
        );
    });

    test('admin plugin runs for group admin', async () => {
        plugin.permission = PERM.ADMIN;
        const sender = '111111111@s.whatsapp.net';
        const groupJid = makeGroupJid();
        const sock = makeGroupSock([
            { id: sender, admin: 'admin' },
            { id: '999000000@s.whatsapp.net', admin: 'superadmin' },
        ]);
        await handleMessages(sock, makeMsg({ jid: groupJid, from: sender, text: '.ping' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    test('owner plugin blocked for non-owner', async () => {
        plugin.permission = PERM.OWNER;
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', from: '999000001@s.whatsapp.net' }));
        expect(plugin.run).not.toHaveBeenCalled();
        expect(sock.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringContaining('owner') }),
            expect.any(Object),
        );
    });

    test('owner plugin runs for owner (OWNER_NUMBER match)', async () => {
        plugin.permission = PERM.OWNER;
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', from: '254712345678@s.whatsapp.net' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    test('owner plugin runs when message is fromMe', async () => {
        plugin.permission = PERM.OWNER;
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', fromMe: true }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    // ── Scope guards ─────────────────────────────────────────────────────────

    test('group:false plugin sends private-only error in group', async () => {
        plugin.group = false;
        const sender = '111111111@s.whatsapp.net';
        const groupJid = makeGroupJid();
        const sock = makeGroupSock([{ id: sender, admin: null }]);
        await handleMessages(sock, makeMsg({ jid: groupJid, from: sender, text: '.ping' }));
        expect(plugin.run).not.toHaveBeenCalled();
        expect(sock.sendMessage).toHaveBeenCalledWith(
            groupJid,
            expect.objectContaining({ text: expect.stringContaining('private') }),
            expect.any(Object),
        );
    });

    test('private:false plugin sends group-only error in private chat', async () => {
        plugin.private = false;
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', from: '111111111@s.whatsapp.net' }));
        expect(plugin.run).not.toHaveBeenCalled();
        expect(sock.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringContaining('group') }),
            expect.any(Object),
        );
    });

    test('group:true plugin runs in group', async () => {
        const sender = '111111111@s.whatsapp.net';
        const groupJid = makeGroupJid();
        const sock = makeGroupSock([{ id: sender, admin: null }]);
        await handleMessages(sock, makeMsg({ jid: groupJid, from: sender, text: '.ping' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    test('private:true plugin runs in private chat', async () => {
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', from: '111111111@s.whatsapp.net' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    // ── botAdmin guard ───────────────────────────────────────────────────────

    test('botAdmin plugin blocked when bot is not group admin', async () => {
        plugin.botAdmin = true;
        const sender = '111111111@s.whatsapp.net';
        const groupJid = makeGroupJid();
        const sock = makeGroupSock([
            { id: sender, admin: 'admin' },
            { id: '999000000@s.whatsapp.net', admin: null },
        ]);
        await handleMessages(sock, makeMsg({ jid: groupJid, from: sender, text: '.ping' }));
        expect(plugin.run).not.toHaveBeenCalled();
        expect(sock.sendMessage).toHaveBeenCalledWith(
            groupJid,
            expect.objectContaining({ text: expect.stringContaining('botAdmin') }),
            expect.any(Object),
        );
    });

    test('botAdmin plugin runs when bot is group admin', async () => {
        plugin.botAdmin = true;
        const sender = '111111111@s.whatsapp.net';
        const groupJid = makeGroupJid();
        const sock = makeGroupSock([
            { id: sender, admin: 'admin' },
            { id: '999000000@s.whatsapp.net', admin: 'superadmin' },
        ]);
        await handleMessages(sock, makeMsg({ jid: groupJid, from: sender, text: '.ping' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    // ── Ban gate ─────────────────────────────────────────────────────────────

    test('banned user cannot trigger commands', async () => {
        const bannedJid = '111111111@s.whatsapp.net';
        global.bannedUsers = new Set([bannedJid]);
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', from: bannedJid }));
        expect(plugin.run).not.toHaveBeenCalled();
        expect(sock.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringContaining('owner') }),
            expect.any(Object),
        );
    });

    test('owner is exempt from ban gate', async () => {
        const ownerJid = '254712345678@s.whatsapp.net';
        global.bannedUsers = new Set([ownerJid]);
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.ping', from: ownerJid }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
    });

    // ── Typo / prediction ────────────────────────────────────────────────────

    test('typo correction runs corrected command and sends prediction note', async () => {
        const sock = makeSock();
        // 'pong' is 1 Levenshtein edit from 'ping' → typo correction triggers
        await handleMessages(sock, makeMsg({ text: '.pong' }));
        expect(plugin.run).toHaveBeenCalledTimes(1);
        const calls = sock.sendMessage.mock.calls;
        const noteCall = calls.find(([, content]) => content.text && content.text.includes('ping'));
        expect(noteCall).toBeDefined();
    });

    test('ambiguous prefix match sends disambiguation and does not run plugins', async () => {
        const pint = makePlugin(['pint']);
        const remove = withPlugins(pint);
        try {
            const sock = makeSock();
            // 'pin' is a 3-char prefix of both 'ping' and 'pint' → ambiguous
            await handleMessages(sock, makeMsg({ text: '.pin' }));
            expect(plugin.run).not.toHaveBeenCalled();
            expect(pint.run).not.toHaveBeenCalled();
            const calls = sock.sendMessage.mock.calls;
            const ambiguousCall = calls.find(
                ([, content]) => content.text && content.text.includes('Did you mean'),
            );
            expect(ambiguousCall).toBeDefined();
        } finally {
            remove();
        }
    });

    test('completely unknown command does nothing', async () => {
        const sock = makeSock();
        await handleMessages(sock, makeMsg({ text: '.zzzzz' }));
        expect(plugin.run).not.toHaveBeenCalled();
        expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    test('plugin onMessage error is logged, not swallowed', async () => {
        const eventPlugin = makePlugin(['noop'], {
            onMessage: jest.fn().mockRejectedValue(new Error('hook boom')),
        });
        eventPlugin.__pluginFile = 'event-test.js';
        const remove = withPlugins(eventPlugin);
        try {
            const sock = makeSock();
            await handleMessages(sock, makeMsg({ text: 'hello world' }));
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('[Plugin] onMessage error in event-test.js: hook boom'),
            );
        } finally {
            remove();
        }
    });

    // ── Plugin error handling ────────────────────────────────────────────────

    test('plugin run() throwing sends error message and does not crash handler', async () => {
        plugin.run.mockRejectedValue(new Error('boom'));
        const sock = makeSock();
        // suppress expected console.error output
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(handleMessages(sock, makeMsg({ text: '.ping' }))).resolves.toBeUndefined();
        expect(sock.sendMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ text: expect.stringContaining('boom') }),
            expect.any(Object),
        );
    });

    // ── ctx shape ────────────────────────────────────────────────────────────

    test('ctx passed to plugin has all required keys', async () => {
        const sock = makeSock();
        let capturedCtx;
        plugin.run = jest.fn((_sock, _msg, _args, ctx) => {
            capturedCtx = ctx;
        });
        await handleMessages(sock, makeMsg({ text: '.ping foo' }));
        expect(capturedCtx).toMatchObject({
            jid: expect.any(String),
            from: expect.any(String),
            sender: expect.any(String),
            isGroup: false,
            isOwner: expect.any(Boolean),
            isAdmin: false,
            isBotAdmin: false,
            isSudo: false,
            args: ['foo'],
            prefix: '.',
            usedPrefix: '.',
            safeSend: expect.any(Function),
            reply: expect.any(Function),
        });
    });
});

// ─── safeSend ────────────────────────────────────────────────────────────────

describe('safeSend', () => {
    test('returns null for null jid', async () => {
        const sock = makeSock();
        const result = await safeSend(sock, null, { text: 'hi' });
        expect(result).toBeNull();
        expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    test('returns null for sock without sendMessage', async () => {
        const result = await safeSend({}, '123@s.whatsapp.net', { text: 'hi' });
        expect(result).toBeNull();
    });

    test('bypasses rate limiting when __messageforgeSendGuarded is true', async () => {
        const sock = makeSock({ __messageforgeSendGuarded: true });
        const result = await safeSend(sock, '123@s.whatsapp.net', { text: 'hi' });
        expect(result).toEqual({ key: { id: 'msg-id' } });
        expect(sock.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', { text: 'hi' }, {});
    });

    test('returns null and logs when sendMessage throws', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const sock = makeSock({
            __messageforgeSendGuarded: true,
            sendMessage: jest.fn().mockRejectedValue(new Error('network error')),
        });
        const result = await safeSend(sock, '123@s.whatsapp.net', { text: 'hi' });
        expect(result).toBeNull();
    });
});
