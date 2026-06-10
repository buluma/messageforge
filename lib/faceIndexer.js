'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const logger = require('./logger');
const config = require('../config');
const faceSidecar = require('./faceSidecarClient');

const DATA_DIR = path.join(__dirname, '../data');
const FACES_DIR = path.join(DATA_DIR, '.faces');
const INDEX_FILE = path.join(DATA_DIR, 'face-index.json');
const INDEX_VERSION = 2;
const MODEL = 'buffalo_l';
const DIM = 512;
const IMAGE_TYPES = new Set(['image']);
const VIDEO_TYPES = new Set(['video']);

const status = {
    running: false,
    total: 0,
    done: 0,
    error: null,
    phase: 'idle',
    sidecar: 'unknown',
};

function mediaHash(rel) {
    return crypto.createHash('sha1').update(rel).digest('hex');
}

function newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyIndex(extra = {}) {
    return {
        version: INDEX_VERSION,
        model: MODEL,
        dim: DIM,
        indexed: [],
        faces: [],
        persons: [],
        ...extra,
    };
}

function toFloat32Array(value) {
    if (!value || value.length !== DIM) return null;
    const out = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) {
        const n = Number(value[i]);
        if (!Number.isFinite(n)) return null;
        out[i] = n;
    }
    return out;
}

function normalizeMediaUrl(url) {
    const mediaUrl = String(url || '');
    if (!mediaUrl.startsWith('/media-files/')) return null;
    const rel = mediaUrl.slice('/media-files/'.length).replace(/\\/g, '/');
    if (!rel || rel.split('/').some((part) => part === '..' || part.startsWith('.'))) return null;
    return `/media-files/${rel}`;
}

function mediaUrlToPath(mediaUrl) {
    const normalized = normalizeMediaUrl(mediaUrl);
    if (!normalized) return null;
    const rel = normalized.slice('/media-files/'.length);
    const abs = path.resolve(DATA_DIR, rel);
    if (!abs.startsWith(DATA_DIR + path.sep)) return null;
    return abs;
}

function loadIndex() {
    try {
        if (!fs.existsSync(INDEX_FILE)) return emptyIndex();
        const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        if (raw?.version !== INDEX_VERSION || raw?.model !== MODEL || raw?.dim !== DIM) {
            return emptyIndex({
                legacyPersons: Array.isArray(raw?.persons) ? raw.persons : [],
                needsRebuild: true,
            });
        }

        const faces = (raw.faces || [])
            .map((face) => ({
                ...face,
                mediaUrl: normalizeMediaUrl(face.mediaUrl),
                embedding: toFloat32Array(face.embedding),
            }))
            .filter((face) => face.mediaUrl && face.embedding);

        const persons = (raw.persons || []).map((person) => ({
            ...person,
            centroid: toFloat32Array(person.centroid),
            mediaUrls: (person.mediaUrls || []).map(normalizeMediaUrl).filter(Boolean),
            jid: person.jid || null,
        }));

        return emptyIndex({
            indexed: Array.isArray(raw.indexed) ? raw.indexed : [],
            faces,
            persons,
            lastIndexed: raw.lastIndexed || null,
        });
    } catch {
        return emptyIndex();
    }
}

function serialiseVector(value) {
    return value ? Array.from(value) : [];
}

function saveIndex(index) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const serialisable = {
        version: INDEX_VERSION,
        model: MODEL,
        dim: DIM,
        indexed: Array.from(new Set(index.indexed || [])),
        faces: (index.faces || []).map((face) => ({
            ...face,
            embedding: serialiseVector(face.embedding),
        })),
        persons: (index.persons || []).map((person) => ({
            ...person,
            centroid: serialiseVector(person.centroid),
        })),
        lastIndexed: index.lastIndexed || Math.floor(Date.now() / 1000),
    };
    const tmp = INDEX_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serialisable, null, 2));
    fs.renameSync(tmp, INDEX_FILE);
}

function euclidean(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

function centroid(vecs, weights = null) {
    if (!Array.isArray(vecs) || !vecs.length) return null;
    const out = new Float32Array(DIM);
    let totalWeight = 0;
    for (let vi = 0; vi < vecs.length; vi++) {
        const vec = vecs[vi];
        if (!vec || vec.length !== DIM) continue;
        const weight =
            Array.isArray(weights) && Number.isFinite(weights[vi])
                ? Math.max(0.01, weights[vi])
                : 1;
        totalWeight += weight;
        for (let i = 0; i < DIM; i++) out[i] += vec[i] * weight;
    }
    if (totalWeight <= 0) return null;
    for (let i = 0; i < DIM; i++) out[i] /= totalWeight;
    return out;
}

function computeFaceQualityScore(face) {
    if (!face) return 0;
    const score = Number.isFinite(Number(face.score))
        ? Math.max(0, Math.min(1, Number(face.score)))
        : 0.5;
    const w = Math.max(0, Number(face.w) || 0);
    const h = Math.max(0, Number(face.h) || 0);
    const sizeNorm = Math.max(0, Math.min(1, Math.min(w, h) / 120));
    const ratio = w > 0 && h > 0 ? w / h : 1;
    const aspectNorm = Math.max(0, Math.min(1, 1 - Math.min(1, Math.abs(Math.log(ratio)))));
    return score * 0.5 + sizeNorm * 0.35 + aspectNorm * 0.15;
}

/**
 * Average pairwise euclidean distance across all embeddings for a person.
 * Lower means tighter grouping. Returns 0 for fewer than two embeddings.
 */
function computePersonConfidence(person) {
    const embeddings = person?.descriptors || person?.embeddings || [];
    if (embeddings.length < 2) return 0;

    let totalDist = 0;
    let pairCount = 0;
    for (let i = 0; i < embeddings.length; i++) {
        for (let j = i + 1; j < embeddings.length; j++) {
            totalDist += euclidean(embeddings[i], embeddings[j]);
            pairCount++;
        }
    }
    return pairCount > 0 ? totalDist / pairCount : 0;
}

function computeClusterConfidence(faces, center) {
    if (!Array.isArray(faces) || faces.length < 2 || !center) return 0;
    const avgDist =
        faces.reduce((sum, face) => sum + euclidean(face.embedding, center), 0) / faces.length;
    // Map average Euclidean distance to a 0-1 confidence score.
    // For L2-normalised ArcFace (buffalo_l) embeddings with eps=1.05:
    //   distance 0       → confidence 1.0  (perfect)
    //   distance = eps   → confidence 0.5  (at the cluster boundary)
    //   distance >= 2*eps → confidence 0   (shouldn't happen within a cluster)
    const eps = Number(config.FACE_CLUSTER_EPSILON || 1.05);
    const score = 1 - avgDist / (eps * 2);
    return Math.max(0, Math.min(1, score));
}

// Borrowed from TGDL's face crop endpoint — uses 40% padding around the
// face box, then resizes to a square thumbnail with cover-fit centering.
// TGDL reference: src/web/routes/ai.js `/ai/faces/:id/crop` (pad = 0.4)
const FACE_CROP_PAD = 0.4;
const FACE_CROP_SIZE = 160;

function cropBox(box, width, height) {
    const pw = box.w * FACE_CROP_PAD;
    const ph = box.h * FACE_CROP_PAD;
    const x = Math.max(0, Math.round(box.x - pw));
    const y = Math.max(0, Math.round(box.y - ph));
    const w = Math.min(width - x, Math.round(box.w + pw * 2));
    const h = Math.min(height - y, Math.round(box.h + ph * 2));
    return { x, y, w, h };
}

async function writeFaceCrop(imagePath, face, cropId) {
    try {
        const { loadImage, createCanvas } = require('canvas');
        const img = await loadImage(imagePath);
        const box = cropBox(face, img.width, img.height);
        if (box.w <= 0 || box.h <= 0) return null;

        if (!fs.existsSync(FACES_DIR)) fs.mkdirSync(FACES_DIR, { recursive: true });

        // Extract padded region, then resize to a square cover-fit thumbnail.
        // This mirrors TGDL's approach: pad=0.4 → extract → resize(size, size, cover).
        const src = createCanvas(Math.round(box.w), Math.round(box.h));
        const srcCtx = src.getContext('2d');
        srcCtx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

        const size = FACE_CROP_SIZE;
        const out = createCanvas(size, size);
        const outCtx = out.getContext('2d');

        // cover-fit: scale to fill, centre-crop
        const scale = Math.max(size / box.w, size / box.h);
        const sw = Math.round(box.w * scale);
        const sh = Math.round(box.h * scale);
        const sx = Math.round((size - sw) / 2);
        const sy = Math.round((size - sh) / 2);
        outCtx.drawImage(src, 0, 0, box.w, box.h, sx, sy, sw, sh);

        const fileName = `${cropId}.jpg`;
        fs.writeFileSync(
            path.join(FACES_DIR, fileName),
            out.toBuffer('image/jpeg', { quality: 0.85 }),
        );
        return `/api/media/face/${fileName}`;
    } catch (err) {
        logger.warn?.(`[faceIndexer] crop failed for ${imagePath}: ${err.message}`);
        return null;
    }
}

function execFilePromise(command, args, opts = {}) {
    return new Promise((resolve) => {
        execFile(command, args, opts, (err, stdout, stderr) => {
            resolve({ err, stdout, stderr });
        });
    });
}

async function probeVideoDuration(absPath) {
    const result = await execFilePromise(
        'ffprobe',
        [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            absPath,
        ],
        { timeout: 10000 },
    );
    if (result.err) return 0;
    const duration = Number.parseFloat(result.stdout);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

async function extractVideoFrames(absPath) {
    if (!config.FACE_SCAN_VIDEO) return { frames: [], cleanup: () => {} };

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messageforge-faces-'));
    const cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });
    const maxFrames = Math.max(1, Number(config.FACE_VIDEO_MAX_FRAMES) || 3);
    const minSpacing = Math.max(0, Number(config.FACE_VIDEO_MIN_SPACING_SEC) || 2);
    const duration = await probeVideoDuration(absPath);
    const frames = [];

    let seconds = [0];
    if (duration > 0) {
        const span = Math.max(duration - 0.5, 0);
        const wanted = Math.min(
            maxFrames,
            Math.max(1, Math.floor(duration / Math.max(1, minSpacing))),
        );
        seconds = Array.from({ length: wanted }, (_, i) => {
            if (wanted === 1) return Math.min(duration * 0.1, span);
            return Math.min(span, (span * i) / (wanted - 1));
        });
    }

    for (let i = 0; i < Math.min(maxFrames, seconds.length); i++) {
        const out = path.join(tempDir, `frame-${i}.jpg`);
        const result = await execFilePromise(
            'ffmpeg',
            ['-y', '-ss', String(seconds[i]), '-i', absPath, '-frames:v', '1', '-q:v', '2', out],
            { timeout: 30000 },
        );
        if (!result.err && fs.existsSync(out)) frames.push({ path: out, frameSec: seconds[i] });
    }

    return { frames, cleanup };
}

async function detectInImage(absPath, mediaUrl, frameSec = null) {
    const result = await faceSidecar.detectFaces(absPath);
    if (!result.ok) return { ok: false, error: result.error || 'detect_failed' };

    const out = [];
    for (const detected of result.faces || []) {
        const faceId = newId('face');
        const qualityScore = computeFaceQualityScore(detected);
        const cropUrl = await writeFaceCrop(absPath, detected, faceId);
        out.push({
            id: faceId,
            mediaUrl,
            frameSec,
            x: detected.x,
            y: detected.y,
            w: detected.w,
            h: detected.h,
            score: detected.score,
            qualityScore,
            embedding: detected.embedding,
            personId: null,
            cropUrl,
        });
    }

    return { ok: true, faces: out };
}

async function indexFile(file) {
    const mediaUrl = normalizeMediaUrl(file?.url);
    if (!mediaUrl) return { ok: true, faces: [] };
    const absPath = mediaUrlToPath(mediaUrl);
    if (!absPath || !fs.existsSync(absPath)) return { ok: true, faces: [] };

    if (IMAGE_TYPES.has(file.type)) {
        return detectInImage(absPath, mediaUrl);
    }

    if (VIDEO_TYPES.has(file.type)) {
        if (!config.FACE_SCAN_VIDEO) return { ok: true, faces: [] };
        const { frames, cleanup } = await extractVideoFrames(absPath);
        try {
            const faces = [];
            for (const frame of frames) {
                const result = await detectInImage(frame.path, mediaUrl, frame.frameSec);
                if (!result.ok) return result;
                faces.push(...result.faces);
            }
            return { ok: true, faces };
        } finally {
            cleanup();
        }
    }

    return { ok: true, faces: [] };
}

function mediaOverlapScore(person, faces) {
    const personUrls = new Set((person.mediaUrls || []).map(normalizeMediaUrl).filter(Boolean));
    if (!personUrls.size) return 0;
    const clusterUrls = new Set(
        faces.map((face) => normalizeMediaUrl(face.mediaUrl)).filter(Boolean),
    );
    let score = 0;
    for (const url of clusterUrls) {
        if (personUrls.has(url)) score++;
    }
    return score;
}

function matchExistingPerson(oldPersons, cluster, clusterFaces, claimed) {
    let best = null;
    let bestDistance = Infinity;
    const eps = Number(config.FACE_CLUSTER_EPSILON || 1.05);

    for (const person of oldPersons) {
        if (!person || claimed.has(person.id)) continue;
        if (!person.centroid || !cluster.centroid) continue;
        const dist = euclidean(person.centroid, cluster.centroid);
        if (dist < bestDistance) {
            bestDistance = dist;
            best = person;
        }
    }
    if (best && bestDistance <= eps) return best;

    let bestOverlap = 0;
    best = null;
    for (const person of oldPersons) {
        if (!person || claimed.has(person.id)) continue;
        const overlap = mediaOverlapScore(person, clusterFaces);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            best = person;
        }
    }
    return bestOverlap > 0 ? best : null;
}

function copyBestCrop(personId, faces) {
    const best = [...faces].sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))[0];
    if (!best?.cropUrl) return `/api/media/face/${personId}.jpg`;
    const fileName = best.cropUrl.split('/').pop();
    const src = path.join(FACES_DIR, fileName);
    const dest = path.join(FACES_DIR, `${personId}.jpg`);
    try {
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    } catch {
        // Non-fatal: the route will 404 for the cover until another scan refreshes it.
    }
    return `/api/media/face/${personId}.jpg`;
}

async function rebuildPersons(index, oldIndex) {
    const faces = (index.faces || []).filter(
        (face) => face.embedding && face.embedding.length === DIM,
    );
    if (faces.length === 0) {
        index.persons = [];
        return { ok: true };
    }

    const result = await faceSidecar.clusterFaces(faces, {
        eps: config.FACE_CLUSTER_EPSILON,
        minPoints: config.FACE_CLUSTER_MIN_POINTS,
    });
    if (!result.ok) return { ok: false, error: result.error || 'cluster_failed' };

    for (const face of faces) face.personId = null;

    const oldPersons = [...(oldIndex.persons || []), ...(oldIndex.legacyPersons || [])];
    const claimed = new Set();
    const persons = [];

    for (const cluster of result.clusters) {
        const clusterFaces = cluster.memberIdxs.map((idx) => faces[idx]).filter(Boolean);
        if (!clusterFaces.length) continue;

        const matched = matchExistingPerson(oldPersons, cluster, clusterFaces, claimed);
        if (matched?.id) claimed.add(matched.id);

        const id = matched?.id || newId('person');
        const mediaUrls = Array.from(
            new Set(clusterFaces.map((face) => face.mediaUrl).filter(Boolean)),
        );
        const center =
            cluster.centroid ||
            centroid(
                clusterFaces.map((face) => face.embedding),
                clusterFaces.map((face) => face.qualityScore),
            );

        for (const face of clusterFaces) face.personId = id;

        const person = {
            id,
            name: matched?.name || `Person ${persons.length + 1}`,
            faceUrl: copyBestCrop(id, clusterFaces),
            mediaUrls,
            centroid: center,
            faceCount: cluster.faceCount || clusterFaces.length,
            jid: matched?.jid || null,
            confidence: computeClusterConfidence(clusterFaces, center),
        };
        persons.push(person);
    }

    index.persons = persons;
    return { ok: true, noise: result.noise };
}

function eligibleFiles(allMediaFiles, indexed) {
    return (Array.isArray(allMediaFiles) ? allMediaFiles : []).filter((file) => {
        const mediaUrl = normalizeMediaUrl(file?.url);
        if (!mediaUrl) return false;
        if (!IMAGE_TYPES.has(file.type) && !(config.FACE_SCAN_VIDEO && VIDEO_TYPES.has(file.type)))
            return false;
        const rel = mediaUrl.slice('/media-files/'.length);
        return !indexed.has(mediaHash(rel));
    });
}

async function buildIndex(allMediaFiles) {
    if (status.running) return;
    status.running = true;
    status.error = null;
    status.done = 0;
    status.total = Array.isArray(allMediaFiles) ? allMediaFiles.length : 0;
    status.phase = 'health';

    try {
        const health = await faceSidecar.health();
        status.sidecar = health.ok ? 'ready' : 'unreachable';
        if (!health.ok) throw new Error(`Sidecar unreachable: ${health.error}`);

        const oldIndex = loadIndex();
        const working = emptyIndex({
            indexed: oldIndex.needsRebuild ? [] : [...(oldIndex.indexed || [])],
            faces: oldIndex.needsRebuild ? [] : [...(oldIndex.faces || [])],
            persons: oldIndex.needsRebuild ? [] : [...(oldIndex.persons || [])],
        });
        const indexed = new Set(working.indexed || []);
        const toProcess = eligibleFiles(allMediaFiles, indexed);
        status.total = toProcess.length;
        status.phase = 'detect';

        let detectedAny = false;
        let processedAny = false;
        for (const file of toProcess) {
            const result = await indexFile(file);
            if (!result.ok) throw new Error(result.error || 'detect_failed');

            if (result.faces.length) {
                detectedAny = true;
                working.faces.push(...result.faces);
            }

            const mediaUrl = normalizeMediaUrl(file.url);
            const rel = mediaUrl.slice('/media-files/'.length);
            indexed.add(mediaHash(rel));
            working.indexed = Array.from(indexed);
            working.lastIndexed = Math.floor(Date.now() / 1000);
            processedAny = true;
            status.done++;
        }

        if (working.faces.length && (detectedAny || oldIndex.needsRebuild)) {
            status.phase = 'cluster';
            const clustered = await rebuildPersons(working, oldIndex);
            if (!clustered.ok) throw new Error(`Cluster failed: ${clustered.error}`);
        } else if (!working.faces.length) {
            working.persons = [];
        }

        if (processedAny || detectedAny) {
            saveIndex(working);
        }
    } catch (err) {
        status.error = err.message;
        logger.error(`[faceIndexer] ${err.message}`);
    } finally {
        status.phase = 'idle';
        status.running = false;
    }
}

function getPersons() {
    const index = loadIndex();
    return (index.persons || []).map((person) => ({
        id: person.id,
        name: person.name,
        faceUrl: person.faceUrl,
        mediaUrls: person.mediaUrls || [],
        count: person.faceCount || (person.mediaUrls || []).length,
        jid: person.jid || null,
        confidence: typeof person.confidence === 'number' ? person.confidence : null,
    }));
}

function getFaceCoverage() {
    const index = loadIndex();
    const detectedUrls = new Set((index.faces || []).map((face) => face.mediaUrl).filter(Boolean));
    return {
        indexed: Array.from(new Set((index.indexed || []).map(normalizeMediaUrl).filter(Boolean))),
        detected: Array.from(detectedUrls),
    };
}

function renamePerson(id, name) {
    const index = loadIndex();
    const person = index.persons.find((item) => item.id === id);
    if (!person) return false;
    person.name = name;
    saveIndex(index);
    return true;
}

function mergePerson(sourceId, targetId) {
    const index = loadIndex();
    const source = index.persons.find((item) => item.id === sourceId);
    const target = index.persons.find((item) => item.id === targetId);
    if (!source || !target || source === target) return false;

    const sourceFaces = index.faces.filter((face) => face.personId === sourceId);
    for (const face of sourceFaces) face.personId = targetId;

    target.mediaUrls = Array.from(
        new Set([...(target.mediaUrls || []), ...(source.mediaUrls || [])]),
    );
    target.faceCount = (target.faceCount || 0) + (source.faceCount || sourceFaces.length || 0);
    const targetFaces = index.faces.filter((face) => face.personId === targetId);
    target.centroid = centroid(
        targetFaces.map((face) => face.embedding),
        targetFaces.map((face) => face.qualityScore),
    );
    target.confidence = computeClusterConfidence(targetFaces, target.centroid);
    target.faceUrl = copyBestCrop(target.id, targetFaces);
    index.persons = index.persons.filter((item) => item.id !== sourceId);

    const faceFile = path.join(FACES_DIR, `${sourceId}.jpg`);
    if (fs.existsSync(faceFile)) fs.unlinkSync(faceFile);

    saveIndex(index);
    return true;
}

function deletePerson(id) {
    const index = loadIndex();
    const exists = index.persons.some((item) => item.id === id);
    if (!exists) return false;
    for (const face of index.faces || []) {
        if (face.personId === id) face.personId = null;
    }
    index.persons = index.persons.filter((item) => item.id !== id);
    const faceFile = path.join(FACES_DIR, `${id}.jpg`);
    if (fs.existsSync(faceFile)) fs.unlinkSync(faceFile);
    saveIndex(index);
    return true;
}

function linkPersonJid(id, jid) {
    const index = loadIndex();
    const person = index.persons.find((item) => item.id === id);
    if (!person) return false;
    person.jid = jid;
    saveIndex(index);
    return true;
}

function getStatus() {
    return {
        ...status,
        sidecarUrl: faceSidecar.normalizeUrl(config.FACE_SIDECAR_URL),
        model: MODEL,
        version: INDEX_VERSION,
    };
}

module.exports = {
    buildIndex,
    getPersons,
    getFaceCoverage,
    renamePerson,
    mergePerson,
    deletePerson,
    linkPersonJid,
    getStatus,
    FACES_DIR,
    computePersonConfidence,
    computeFaceQualityScore,
    _private: { loadIndex, saveIndex, euclidean, centroid, normalizeMediaUrl },
};
