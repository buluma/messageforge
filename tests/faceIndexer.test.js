'use strict';

jest.mock('../lib/logger', () => ({
    custom: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

describe('computePersonConfidence', () => {
    let computePersonConfidence;

    beforeAll(() => {
        ({ computePersonConfidence } = require('../lib/faceIndexer'));
    });

    test('returns 0 for a person with a single descriptor', () => {
        const person = { descriptors: [new Float32Array([0.1, 0.2, 0.3])] };
        expect(computePersonConfidence(person)).toBe(0);
    });

    test('returns 0 for a person with no descriptors', () => {
        const person = { descriptors: [] };
        expect(computePersonConfidence(person)).toBe(0);
    });

    test('returns 0 when two identical descriptors are compared', () => {
        const desc = new Float32Array([0, 0, 0, 0]);
        const person = { descriptors: [desc, desc] };
        expect(computePersonConfidence(person)).toBe(0);
    });

    test('returns positive value for two different descriptors', () => {
        const person = {
            descriptors: [new Float32Array([0, 0, 0]), new Float32Array([1, 1, 1])],
        };
        expect(computePersonConfidence(person)).toBeCloseTo(Math.sqrt(3), 5);
    });

    test('averages pairwise distances for three descriptors', () => {
        const A = new Float32Array([0, 0]);
        const B = new Float32Array([3, 4]);
        const C = new Float32Array([0, 0]);
        const person = { descriptors: [A, B, C] };
        expect(computePersonConfidence(person)).toBeCloseTo(10 / 3, 5);
    });
});

describe('computeFaceQualityScore', () => {
    test('scores sane faces higher than tiny elongated faces', () => {
        const { computeFaceQualityScore } = require('../lib/faceIndexer');
        const good = computeFaceQualityScore({ score: 0.95, w: 140, h: 140 });
        const poor = computeFaceQualityScore({ score: 0.6, w: 20, h: 100 });
        expect(good).toBeGreaterThan(poor);
    });
});
