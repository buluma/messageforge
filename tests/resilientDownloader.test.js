'use strict';

const { Readable } = require('stream');

let mockFiles;

jest.mock('fs', () => ({
    createWriteStream: jest.fn((file) => {
        const { Writable } = require('stream');
        const chunks = [];
        return new Writable({
            write(chunk, _encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            },
            final(callback) {
                mockFiles[file] = Buffer.concat(chunks);
                callback();
            },
        });
    }),
    existsSync: jest.fn((file) => Object.prototype.hasOwnProperty.call(mockFiles, file)),
    statSync: jest.fn((file) => ({ size: mockFiles[file]?.length || 0 })),
    unlinkSync: jest.fn((file) => {
        delete mockFiles[file];
    }),
}));

jest.mock('axios', () => jest.fn());

const axios = require('axios');
const fs = require('fs');
const { classifyDownloadError, downloadToFile } = require('../lib/resilientDownloader');

function streamFrom(text) {
    return Readable.from([Buffer.from(text)]);
}

describe('resilientDownloader', () => {
    beforeEach(() => {
        mockFiles = {};
        axios.mockReset();
        fs.unlinkSync.mockClear();
    });

    test('classifies common network failures', () => {
        expect(classifyDownloadError({ code: 'EPROTO', message: 'SSL alert' })).toBe('tls');
        expect(classifyDownloadError({ code: 'ENOTFOUND' })).toBe('dns');
        expect(classifyDownloadError({ code: 'ETIMEDOUT' })).toBe('network');
        expect(classifyDownloadError({ response: { status: 403 } })).toBe('http_403');
    });

    test('tries the next candidate after a failed URL', async () => {
        axios
            .mockRejectedValueOnce(Object.assign(new Error('TLS failed'), { code: 'EPROTO' }))
            .mockResolvedValueOnce({
                data: streamFrom('valid media bytes'),
                headers: { 'content-type': 'video/mp4' },
                request: { res: { responseUrl: 'https://cdn.example/final.mp4' } },
            });

        const result = await downloadToFile(
            [
                { label: 'bad', url: 'https://bad.example/video.mp4' },
                { label: 'good', url: 'https://good.example/video.mp4' },
            ],
            '/tmp/video.mp4',
            { minBytes: 4 },
        );

        expect(result.label).toBe('good');
        expect(result.size).toBeGreaterThan(4);
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0].type).toBe('tls');
        expect(mockFiles['/tmp/video.mp4'].toString()).toBe('valid media bytes');
    });

    test('cleans partial files when all candidates fail', async () => {
        axios.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));

        await expect(
            downloadToFile(
                [{ label: 'missing', url: 'https://missing.example/video.mp4' }],
                '/tmp/x.mp4',
            ),
        ).rejects.toMatchObject({ failureTypes: ['dns'] });

        expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
});
