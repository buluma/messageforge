'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('./logger');

const MODELS_DIR = path.join(__dirname, '../data/face-models');
const FACES_DIR = path.join(__dirname, '../data/.faces');
const THUMBS_DIR = path.join(__dirname, '../data/.thumbs');
const INDEX_FILE = path.join(__dirname, '../data/face-index.json');
const MATCH_THRESHOLD = 0.52;

let modelsLoaded = false;
let faceapi = null;
let Canvas = null;
let loadPromise = null;

const status = { running: false, total: 0, done: 0, error: null };

function thumbHash(rel) {
    return crypto.createHash('sha1').update(rel).digest('hex');
}

async function ensureModels() {
    if (modelsLoaded) return;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        faceapi = require('face-api.js');
        const { createCanvas, Canvas, Image, ImageData } = require('canvas');

        faceapi.env.monkeyPatch({
            Canvas,
            Image,
            ImageData,
            fetch,
            createCanvasElement: () => createCanvas(0, 0),
        });

        await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
        await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(MODELS_DIR);
        await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);

        modelsLoaded = true;
        logger.custom('faceIndexer', 'Models loaded.');
    })();

    return loadPromise;
}

function loadIndex() {
    try {
        if (!fs.existsSync(INDEX_FILE)) return { persons: [], indexed: [] };
        const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        // Revive Float32Arrays from plain arrays
        for (const p of raw.persons || []) {
            p.descriptors = (p.descriptors || []).map((d) => new Float32Array(d));
        }
        return raw;
    } catch {
        return { persons: [], indexed: [] };
    }
}

function saveIndex(index) {
    // Store descriptors as plain arrays (JSON-serialisable)
    const serialisable = {
        ...index,
        persons: index.persons.map((p) => ({
            ...p,
            descriptors: p.descriptors.map((d) => Array.from(d)),
        })),
    };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(serialisable, null, 2));
}

function bestMatch(persons, descriptor) {
    let best = null;
    let bestDist = Infinity;
    for (const p of persons) {
        for (const d of p.descriptors) {
            const dist = faceapi.euclideanDistance(Array.from(descriptor), Array.from(d));
            if (dist < bestDist) { bestDist = dist; best = p; }
        }
    }
    return bestDist < MATCH_THRESHOLD ? best : null;
}

function cropFace(canvas, box) {
    const { Canvas: Cv } = require('canvas');
    const pad = 0.2;
    const pw = box.width * pad;
    const ph = box.height * pad;
    const x = Math.max(0, box.x - pw);
    const y = Math.max(0, box.y - ph);
    const w = Math.min(canvas.width - x, box.width + pw * 2);
    const h = Math.min(canvas.height - y, box.height + ph * 2);

    const out = new Cv(Math.round(w), Math.round(h));
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return out;
}

async function indexFile(mediaUrl, index) {
    const rel = mediaUrl.replace('/media-files/', '');
    const hash = thumbHash(rel);
    const thumbFile = path.join(THUMBS_DIR, `${hash}.jpg`);

    if (!fs.existsSync(thumbFile)) return false;

    const { loadImage, createCanvas } = require('canvas');
    const img = await loadImage(thumbFile).catch(() => null);
    if (!img) return false;

    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);

    let detections;
    try {
        detections = await faceapi
            .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
            .withFaceLandmarks(true)
            .withFaceDescriptors();
    } catch {
        detections = [];
    }

    if (!detections || detections.length === 0) return false;

    if (!fs.existsSync(FACES_DIR)) fs.mkdirSync(FACES_DIR, { recursive: true });

    for (const det of detections) {
        const descriptor = det.descriptor;
        const match = bestMatch(index.persons, descriptor);

        if (match) {
            if (!match.mediaUrls.includes(mediaUrl)) match.mediaUrls.push(mediaUrl);
            match.descriptors.push(descriptor);
            // Keep at most 10 descriptors per person (memory)
            if (match.descriptors.length > 10) match.descriptors.shift();
        } else {
            const id = `person_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const faceCanvas = cropFace(canvas, det.detection.box);
            const faceFile = path.join(FACES_DIR, `${id}.jpg`);
            fs.writeFileSync(faceFile, faceCanvas.toBuffer('image/jpeg', { quality: 0.85 }));

            index.persons.push({
                id,
                name: `Person ${index.persons.length + 1}`,
                faceUrl: `/api/media/face/${id}.jpg`,
                mediaUrls: [mediaUrl],
                descriptors: [descriptor],
            });
        }
    }

    return true;
}

async function buildIndex(allMediaFiles) {
    if (status.running) return;
    status.running = true;
    status.error = null;
    status.done = 0;
    status.total = allMediaFiles.length;

    try {
        await ensureModels();
        const index = loadIndex();
        const indexed = new Set(index.indexed || []);

        const toProcess = allMediaFiles.filter((f) => {
            const rel = f.url.replace('/media-files/', '');
            const hash = thumbHash(rel);
            return !indexed.has(hash) && fs.existsSync(path.join(THUMBS_DIR, `${hash}.jpg`));
        });

        status.total = toProcess.length;

        for (const f of toProcess) {
            await indexFile(f.url, index);
            const rel = f.url.replace('/media-files/', '');
            indexed.add(thumbHash(rel));
            index.indexed = Array.from(indexed);
            index.lastIndexed = Math.floor(Date.now() / 1000);
            saveIndex(index);
            status.done++;
        }
    } catch (err) {
        status.error = err.message;
        logger.error(`[faceIndexer] ${err.message}`);
    } finally {
        status.running = false;
    }
}

function getPersons() {
    const index = loadIndex();
    return index.persons.map((p) => ({
        id: p.id,
        name: p.name,
        faceUrl: p.faceUrl,
        mediaUrls: p.mediaUrls,
        count: p.mediaUrls.length,
    }));
}

function renamePerson(id, name) {
    const index = loadIndex();
    const p = index.persons.find((x) => x.id === id);
    if (!p) return false;
    p.name = name;
    saveIndex(index);
    return true;
}

function getStatus() {
    return { ...status };
}

module.exports = { buildIndex, getPersons, renamePerson, getStatus, FACES_DIR };
