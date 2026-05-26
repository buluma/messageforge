'use strict';

const fs = require('fs');
const config = require('../config');

const EXPECTED_DIM = 512;

function normalizeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    return raw.replace(/\/+$/, '');
}

function timeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 1));
    return { controller, timer };
}

function errorMessage(err) {
    if (!err) return 'unknown_error';
    if (err.name === 'AbortError') return 'timeout';
    return err.message || String(err);
}

async function readJsonResponse(res) {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

async function requestJson(pathname, body, opts = {}) {
    const baseUrl = normalizeUrl(opts.url || config.FACE_SIDECAR_URL);
    if (!baseUrl) return { ok: false, error: 'sidecar_url_unset' };

    const timeoutMs = Number(opts.timeoutMs || config.FACE_SIDECAR_TIMEOUT_MS || 60000);
    const { controller, timer } = timeoutSignal(timeoutMs);

    try {
        const res = await fetch(`${baseUrl}${pathname}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });
        const json = await readJsonResponse(res);
        if (!res.ok) {
            const code = json?.code || json?.error || `http_${res.status}`;
            return { ok: false, error: String(code), status: res.status, body: json };
        }
        return { ok: true, body: json, status: res.status };
    } catch (err) {
        return { ok: false, error: errorMessage(err) };
    } finally {
        clearTimeout(timer);
    }
}

function parseEmbedding(value) {
    if (!Array.isArray(value) || value.length !== EXPECTED_DIM) return null;
    const out = new Float32Array(EXPECTED_DIM);
    for (let i = 0; i < EXPECTED_DIM; i++) {
        const n = Number(value[i]);
        if (!Number.isFinite(n)) return null;
        out[i] = n;
    }
    return out;
}

function parseDetectBody(body) {
    if (!body || !Array.isArray(body.faces)) return { faces: [], skipped: 0 };
    const faces = [];
    let skipped = 0;

    for (const face of body.faces) {
        const embedding = parseEmbedding(face?.embedding);
        if (!embedding) {
            skipped++;
            continue;
        }
        const x = Number(face.x);
        const y = Number(face.y);
        const w = Number(face.w);
        const h = Number(face.h);
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
            skipped++;
            continue;
        }
        faces.push({
            x,
            y,
            w,
            h,
            score: Number.isFinite(Number(face.score)) ? Number(face.score) : 0,
            embedding,
        });
    }

    return { faces, skipped };
}

async function health(opts = {}) {
    const result = await requestJson('/health', undefined, {
        ...opts,
        timeoutMs: opts.timeoutMs || 5000,
    });
    if (!result.ok) return result;
    const body = result.body || {};
    return {
        ok: body.ok !== false,
        url: normalizeUrl(opts.url || config.FACE_SIDECAR_URL),
        model: body.model || body.detector || null,
        version: body.version || null,
        body,
    };
}

async function detectFaces(absPath, opts = {}) {
    if (!absPath) return { ok: false, error: 'path_required' };

    const pathMode =
        typeof opts.pathMode === 'boolean' ? opts.pathMode : Boolean(config.FACE_PRIMARY_PATH_MODE);

    async function callWithPath() {
        return requestJson(
            '/detect',
            { path: absPath },
            {
                ...opts,
                timeoutMs: opts.timeoutMs || config.FACE_SIDECAR_TIMEOUT_MS,
            },
        );
    }

    async function callWithBase64() {
        let imageB64;
        try {
            imageB64 = fs.readFileSync(absPath).toString('base64');
        } catch (err) {
            return { ok: false, error: `read_failed:${errorMessage(err)}` };
        }
        return requestJson(
            '/detect',
            { image_b64: imageB64 },
            {
                ...opts,
                timeoutMs: opts.timeoutMs || config.FACE_SIDECAR_TIMEOUT_MS,
            },
        );
    }

    let result = pathMode ? await callWithPath() : await callWithBase64();
    if (!result.ok && pathMode && [403, 404].includes(result.status)) {
        result = await callWithBase64();
    }
    if (!result.ok) return result;

    const parsed = parseDetectBody(result.body);
    return {
        ok: true,
        faces: parsed.faces,
        skipped: parsed.skipped,
        imageW: Number(result.body?.image_w) || null,
        imageH: Number(result.body?.image_h) || null,
        body: result.body,
    };
}

function parseClusterBody(body, inputCount) {
    if (!body || !Array.isArray(body.clusters) || !Array.isArray(body.noise)) {
        return { ok: false, error: 'invalid_cluster_shape' };
    }

    const seen = new Set();
    const clusters = [];

    for (const cluster of body.clusters) {
        if (!Array.isArray(cluster?.member_idxs) || cluster.member_idxs.length === 0) {
            return { ok: false, error: 'invalid_cluster_members' };
        }
        const memberIdxs = [];
        for (const rawIdx of cluster.member_idxs) {
            const idx = Number(rawIdx);
            if (!Number.isInteger(idx) || idx < 0 || idx >= inputCount || seen.has(idx)) {
                return { ok: false, error: 'invalid_cluster_member_idx' };
            }
            seen.add(idx);
            memberIdxs.push(idx);
        }
        const centroid = parseEmbedding(cluster.centroid);
        if (!centroid) return { ok: false, error: 'invalid_cluster_centroid' };
        clusters.push({
            memberIdxs,
            centroid,
            faceCount: Number(cluster.face_count) || memberIdxs.length,
        });
    }

    const noise = [];
    for (const rawIdx of body.noise) {
        const idx = Number(rawIdx);
        if (!Number.isInteger(idx) || idx < 0 || idx >= inputCount || seen.has(idx)) {
            return { ok: false, error: 'invalid_noise_idx' };
        }
        seen.add(idx);
        noise.push(idx);
    }

    if (seen.size !== inputCount) return { ok: false, error: 'cluster_coverage_mismatch' };
    return { ok: true, clusters, noise };
}

async function clusterFaces(faces, opts = {}) {
    const inputFaces = Array.isArray(faces) ? faces : [];
    const requestFaces = [];

    for (const face of inputFaces) {
        const embedding = face?.embedding;
        if (!embedding || embedding.length !== EXPECTED_DIM) {
            return { ok: false, error: 'invalid_embedding' };
        }
        requestFaces.push({
            embedding: Array.from(embedding),
            quality_score: Number.isFinite(Number(face.qualityScore))
                ? Number(face.qualityScore)
                : 0.5,
        });
    }

    const result = await requestJson(
        '/cluster',
        {
            faces: requestFaces,
            eps: Number(opts.eps || config.FACE_CLUSTER_EPSILON || 1.05),
            min_points: Number(opts.minPoints || config.FACE_CLUSTER_MIN_POINTS || 2),
            quality_weighted_centroid: opts.qualityWeightedCentroid !== false,
        },
        {
            ...opts,
            timeoutMs: opts.timeoutMs || config.FACE_CLUSTER_TIMEOUT_MS,
        },
    );
    if (!result.ok) return result;

    const parsed = parseClusterBody(result.body, requestFaces.length);
    if (!parsed.ok) return parsed;
    return { ok: true, clusters: parsed.clusters, noise: parsed.noise, body: result.body };
}

module.exports = {
    health,
    detectFaces,
    clusterFaces,
    normalizeUrl,
    EXPECTED_DIM,
};
