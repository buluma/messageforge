'use strict';

// Inline euclidean distance inside the factory — jest.mock factories are
// hoisted before variable declarations, so out-of-scope refs are forbidden.
jest.mock('face-api.js', () => ({
    euclideanDistance: (a, b) => {
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
        return Math.sqrt(sum);
    },
    env: { monkeyPatch: jest.fn() },
    nets: {
        ssdMobilenetv1: { loadFromDisk: jest.fn().mockResolvedValue(undefined) },
        faceLandmark68Net: { loadFromDisk: jest.fn().mockResolvedValue(undefined) },
        faceRecognitionNet: { loadFromDisk: jest.fn().mockResolvedValue(undefined) },
    },
    SsdMobilenetv1Options: jest.fn(),
    detectAllFaces: jest.fn(),
}));

jest.mock('canvas', () => ({
    createCanvas: jest.fn(() => ({ width: 100, height: 100, getContext: jest.fn() })),
    Canvas: class {},
    Image: class {},
    ImageData: class {},
    loadImage: jest.fn(),
}));

jest.mock('../lib/logger', () => ({
    custom: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

// jest.requireActual inside factory avoids the hoisting scope issue
jest.mock('fs', () => {
    const realFs = jest.requireActual('fs');
    return {
        ...realFs,
        existsSync: (p) => {
            if (p && p.includes('face-models')) return true;
            if (p && p.includes('face-index.json')) return false;
            return realFs.existsSync(p);
        },
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: realFs.readFileSync,
    };
});

let computePersonConfidence;

beforeAll(async () => {
    const faceIndexer = require('../lib/faceIndexer');
    computePersonConfidence = faceIndexer.computePersonConfidence;
    await faceIndexer.buildIndex([]);
});

describe('computePersonConfidence', () => {
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
            descriptors: [
                new Float32Array([0, 0, 0]),
                new Float32Array([1, 1, 1]),
            ],
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
