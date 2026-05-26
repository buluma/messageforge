'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function embedding(value = 0.1) {
    return Array.from({ length: 512 }, () => value);
}

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: jest.fn().mockResolvedValue(body),
    };
}

describe('faceSidecarClient', () => {
    let tempFile;
    let client;

    beforeEach(() => {
        jest.resetModules();
        process.env.FACE_SIDECAR_URL = 'http://faces.local/';
        tempFile = path.join(os.tmpdir(), `face-client-${Date.now()}-${Math.random()}.jpg`);
        fs.writeFileSync(tempFile, Buffer.from('fake-image'));
        global.fetch = jest.fn();
        client = require('../lib/faceSidecarClient');
    });

    afterEach(() => {
        delete process.env.FACE_SIDECAR_URL;
        delete global.fetch;
        if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    });

    test('normalizes sidecar URLs', () => {
        expect(client.normalizeUrl('http://127.0.0.1:8011///')).toBe('http://127.0.0.1:8011');
    });

    test('parses detect responses into Float32Array embeddings', async () => {
        global.fetch.mockResolvedValue(
            jsonResponse({
                image_w: 640,
                image_h: 480,
                faces: [{ x: 1, y: 2, w: 80, h: 90, score: 0.93, embedding: embedding(0.2) }],
            }),
        );

        const result = await client.detectFaces(tempFile);

        expect(result.ok).toBe(true);
        expect(result.faces).toHaveLength(1);
        expect(result.faces[0].embedding).toBeInstanceOf(Float32Array);
        expect(result.faces[0].embedding).toHaveLength(512);
        expect(result.imageW).toBe(640);
        expect(global.fetch).toHaveBeenCalledWith(
            'http://faces.local/detect',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    test('returns ok false on network failures', async () => {
        global.fetch.mockRejectedValue(new Error('boom'));

        const result = await client.detectFaces(tempFile);

        expect(result.ok).toBe(false);
        expect(result.error).toBe('boom');
    });

    test('parses valid cluster responses', async () => {
        global.fetch.mockResolvedValue(
            jsonResponse({
                clusters: [{ member_idxs: [0, 1], centroid: embedding(0.3), face_count: 2 }],
                noise: [],
            }),
        );

        const result = await client.clusterFaces([
            { embedding: new Float32Array(embedding(0.1)), qualityScore: 0.8 },
            { embedding: new Float32Array(embedding(0.2)), qualityScore: 0.7 },
        ]);

        expect(result.ok).toBe(true);
        expect(result.clusters[0].memberIdxs).toEqual([0, 1]);
        expect(result.clusters[0].centroid).toBeInstanceOf(Float32Array);
    });

    test('rejects cluster responses that do not cover every input face', async () => {
        global.fetch.mockResolvedValue(
            jsonResponse({
                clusters: [{ member_idxs: [0], centroid: embedding(0.3), face_count: 1 }],
                noise: [],
            }),
        );

        const result = await client.clusterFaces([
            { embedding: new Float32Array(embedding(0.1)), qualityScore: 0.8 },
            { embedding: new Float32Array(embedding(0.2)), qualityScore: 0.7 },
        ]);

        expect(result.ok).toBe(false);
        expect(result.error).toBe('cluster_coverage_mismatch');
    });
});
