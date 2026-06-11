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
    fmt: (s) => s,
    getStr: jest.fn((key) => key),
    getActiveTheme: jest.fn(() => ({ global: {} })),
}));

jest.mock('../lib/logger', () => ({
    custom: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

jest.mock('@whiskeysockets/baileys', () => ({
    isJidGroup: (jid) => typeof jid === 'string' && jid.endsWith('@g.us'),
    jidNormalizedUser: (jid) => (jid || '').replace(/:[^@]+@/, '@'),
    areJidsSameUser: (a, b) => a === b,
    downloadContentFromMessage: jest.fn(),
}));

jest.mock('jsdom', () => ({
    JSDOM: jest.fn(() => ({ window: { document: { querySelector: jest.fn() } } })),
}));

const { plugins, getCommandCollisions } = require('../handler');

describe('handler command collisions', () => {
    test('default plugin set has zero duplicate command aliases', () => {
        expect(plugins.length).toBeGreaterThan(0);
        expect(getCommandCollisions(plugins)).toEqual([]);
    });
});
