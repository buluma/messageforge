'use strict';

// Mock heavy dependencies before requiring handler.js
jest.mock('../config', () => ({
    PREFIX: '.',
    MODE: 'public',
    OWNER_NUMBER: '254712345678',
    AUTO_TYPING: false,
    AUTO_RECORDING: false,
    BOT_NUMBER: '',
    SUDO: '',
    THEME: 'messageforge',
    DATABASE_TYPE: 'json',
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

// Prevent plugin directory scanning on load
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

const { jidToNum, sameNumber } = require('../handler');

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

describe('sameNumber', () => {
    test('returns true for identical numbers', () => {
        expect(sameNumber('254712345678', '254712345678')).toBe(true);
    });

    test('returns true when last 9 digits match (local vs international format)', () => {
        // last 9 digits of '254712345678' = '712345678'
        // last 9 digits of '0712345678'   = '712345678'
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
        // '12345' vs '22345': not identical, tail=5 < 6 → false
        expect(sameNumber('12345', '22345')).toBe(false);
    });

    test('returns true for identical short strings (fast-path)', () => {
        // a === b short-circuits before the tail-length check
        expect(sameNumber('12345', '12345')).toBe(true);
    });
});
