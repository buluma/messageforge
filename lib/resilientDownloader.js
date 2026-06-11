'use strict';

const fs = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const axios = require('axios');

const streamPipeline = promisify(pipeline);

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    Accept: '*/*',
};

function classifyDownloadError(err) {
    const message = String(err?.message || err || '');
    const code = err?.code || '';
    if (code === 'EPROTO' || /SSL|TLS|alert internal error|wrong version number/i.test(message)) {
        return 'tls';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'network';
    if (err?.response?.status) return `http_${err.response.status}`;
    return 'unknown';
}

function normalizeCandidate(candidate) {
    if (!candidate) return null;
    if (typeof candidate === 'string') return { url: candidate };
    if (candidate.url) return candidate;
    return null;
}

function uniqueCandidates(candidates) {
    const seen = new Set();
    return candidates
        .map(normalizeCandidate)
        .filter(Boolean)
        .filter((candidate) => {
            if (seen.has(candidate.url)) return false;
            seen.add(candidate.url);
            return true;
        });
}

async function downloadToFile(candidates, outputPath, options = {}) {
    const attempts = [];
    const list = uniqueCandidates(candidates);
    if (!list.length) throw new Error('No download URLs available');

    for (const candidate of list) {
        const label = candidate.label || candidate.url;
        try {
            const response = await axios({
                method: candidate.method || 'get',
                url: candidate.url,
                responseType: 'stream',
                timeout: candidate.timeout || options.timeout || 60000,
                maxRedirects: candidate.maxRedirects ?? options.maxRedirects ?? 5,
                headers: {
                    ...DEFAULT_HEADERS,
                    ...(options.headers || {}),
                    ...(candidate.headers || {}),
                },
                validateStatus: (status) => status >= 200 && status < 400,
            });

            await streamPipeline(response.data, fs.createWriteStream(outputPath));

            const stat = fs.statSync(outputPath);
            const minBytes = candidate.minBytes || options.minBytes || 1024;
            if (stat.size < minBytes) {
                throw new Error(`Downloaded file is too small (${stat.size} bytes)`);
            }

            return {
                ok: true,
                path: outputPath,
                size: stat.size,
                label,
                url: candidate.url,
                finalUrl: response.request?.res?.responseUrl || candidate.url,
                contentType: response.headers?.['content-type'] || null,
                attempts,
            };
        } catch (err) {
            try {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            } catch {
                // best-effort cleanup
            }
            attempts.push({
                label,
                url: candidate.url,
                code: err?.code || null,
                type: classifyDownloadError(err),
                message: String(err?.message || err),
            });
        }
    }

    const last = attempts[attempts.length - 1];
    const error = new Error(last?.message || 'All download candidates failed');
    error.attempts = attempts;
    error.failureTypes = [...new Set(attempts.map((item) => item.type))];
    throw error;
}

module.exports = {
    classifyDownloadError,
    downloadToFile,
};
