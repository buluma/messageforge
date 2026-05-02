'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');

// 3-level structure: alternatives (any matches) → sigs (all must match) → [offset, bytes[]]
// alternatives.some(sigs => sigs.every(([offset, bytes]) => bytes match buf))
const MAGIC_BYTES = new Map([
    ['.jpg',  [ [[0, [0xFF, 0xD8, 0xFF]]] ]],
    ['.jpeg', [ [[0, [0xFF, 0xD8, 0xFF]]] ]],
    ['.png',  [ [[0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]] ]],
    ['.gif',  [ [[0, [0x47, 0x49, 0x46, 0x38]]] ]],
    ['.webp', [ [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]] ]],
    ['.mp4',  [ [[4, [0x66, 0x74, 0x79, 0x70]]] ]],
    ['.mov',  [ [[4, [0x66, 0x74, 0x79, 0x70]]] ]],
    ['.m4a',  [ [[4, [0x66, 0x74, 0x79, 0x70]]] ]],
    ['.webm', [ [[0, [0x1A, 0x45, 0xDF, 0xA3]]] ]],
    ['.mkv',  [ [[0, [0x1A, 0x45, 0xDF, 0xA3]]] ]],
    ['.ogg',  [ [[0, [0x4F, 0x67, 0x67, 0x53]]] ]],
    ['.opus', [ [[0, [0x4F, 0x67, 0x67, 0x53]]] ]],
    ['.mp3',  [ [[0, [0x49, 0x44, 0x33]]], [[0, [0xFF, 0xFB]]], [[0, [0xFF, 0xFA]]], [[0, [0xFF, 0xF3]]] ]],
    ['.wav',  [ [[0, [0x52, 0x49, 0x46, 0x46]]] ]],
]);

function checkMagicBytes(buf, ext) {
    const alternatives = MAGIC_BYTES.get(ext);
    if (!alternatives) return true;
    return alternatives.some((sigs) =>
        sigs.every(([offset, expected]) =>
            expected.every((b, i) => buf[offset + i] === b)
        )
    );
}

const MEDIA_EXTS = new Map([
    ['.mp4', 'video'],
    ['.webm', 'video'],
    ['.mkv', 'video'],
    ['.mov', 'video'],
    ['.jpg', 'image'],
    ['.jpeg', 'image'],
    ['.png', 'image'],
    ['.webp', 'image'],
    ['.gif', 'image'],
    ['.mp3', 'audio'],
    ['.ogg', 'audio'],
    ['.opus', 'audio'],
    ['.wav', 'audio'],
    ['.m4a', 'audio'],
]);

function scanMediaDir(dir, baseDir, results) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue;
            scanMediaDir(full, baseDir, results);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            const kind = MEDIA_EXTS.get(ext);
            if (!kind) continue;
            const rel = path.relative(baseDir, full).replace(/\\/g, '/');
            const folder = path.relative(baseDir, dir).replace(/\\/g, '/') || '.';
            let stat;
            try {
                stat = fs.statSync(full);
            } catch {
                continue;
            }
            results.push({
                name: entry.name,
                url: `/media-files/${rel}`,
                type: kind,
                folder,
                size: stat.size,
                mtime: Math.floor(stat.mtimeMs / 1000),
            });
        }
    }
}

// Returns the hex SHA-256 digest of a file's contents.
function computeFileHash(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function createMediaRoutes({ mediaDataDir, requireDashboardAuth, facesBuildIndex } = {}) {
    if (!mediaDataDir) throw new Error('createMediaRoutes: mediaDataDir required');

    const router = express.Router();
    const MEDIA_DATA_DIR = mediaDataDir;

    const THUMB_DIR = path.join(MEDIA_DATA_DIR, '.thumbs');

    function thumbPath(relPath) {
        const hash = crypto.createHash('sha1').update(relPath).digest('hex');
        return path.join(THUMB_DIR, `${hash}.jpg`);
    }

    // Concurrency limiter: max 3 simultaneous ffmpeg thumbnail processes
    const THUMB_CONCURRENCY = 3;
    let thumbActive = 0;
    const thumbQueue = [];

    function runThumb(src, dest, cb) {
        if (thumbActive >= THUMB_CONCURRENCY) {
            thumbQueue.push(() => runThumb(src, dest, cb));
            return;
        }
        thumbActive++;

        // Probe duration so we can seek to 10% — avoids black opening frames
        execFile(
            'ffprobe',
            [
                '-v',
                'error',
                '-show_entries',
                'format=duration',
                '-of',
                'default=noprint_wrappers=1:nokey=1',
                src,
                ],
                { timeout: 10000 },
                (_, stdout) => {
                const duration = parseFloat(stdout) || 0;

                const seekSec = duration > 1 ? (duration * 0.1).toFixed(3) : '0';
                execFile(
                    'ffmpeg',
                    [
                        '-y',
                        '-ss',
                        seekSec,
                        '-i',
                        src,
                        '-vframes',
                        '1',
                        '-vf',
                        'scale=320:-1',
                        '-f',
                        'image2',
                        dest,
                    ],
                    { timeout: 20000 },
                    (err) => {
                        thumbActive--;
                        if (thumbQueue.length) thumbQueue.shift()();
                        cb(err);
                    },
                );
            },
        );
    }

    const thumbInProgress = new Map();

    router.get('/', (req, res) => {
        const results = [];
        scanMediaDir(MEDIA_DATA_DIR, MEDIA_DATA_DIR, results);
        results.sort((a, b) => b.mtime - a.mtime);
        const totalBytes = results.reduce((sum, f) => sum + (f.size || 0), 0);
        res.json({ files: results, total: results.length, totalBytes });
    });

    router.get('/thumb', (req, res) => {
        const { url } = req.query;
        if (!url || !url.startsWith('/media-files/')) {
            return res.status(400).json({ error: 'Invalid url' });
        }
        const rel = url.slice('/media-files/'.length);
        const src = path.resolve(MEDIA_DATA_DIR, rel);
        if (!src.startsWith(MEDIA_DATA_DIR + path.sep)) {
            return res.status(400).json({ error: 'Path traversal rejected' });
        }

        const dest = thumbPath(rel);
        const serve = () => {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.sendFile(dest);
        };

        if (fs.existsSync(dest)) return serve();

        if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

        // Deduplicate concurrent requests for the same file
        if (thumbInProgress.has(dest)) {
            thumbInProgress.get(dest).push({ res, serve });
            return;
        }
        thumbInProgress.set(dest, [{ res, serve }]);

        runThumb(src, dest, (err) => {
            const waiters = thumbInProgress.get(dest) || [];
            thumbInProgress.delete(dest);
            if (err || !fs.existsSync(dest)) {
                for (const w of waiters)
                    w.res.status(500).json({ error: 'Thumbnail generation failed' });
                return;
            }
            for (const w of waiters) w.serve();
        });
    });

    // Scans data/ (excluding dot-dirs), groups files by SHA-256, returns groups
    // that contain more than one file.
    router.get('/duplicates', (req, res) => {
        try {
            const hashMap = new Map();

            function scanForDuplicates(dir, baseDir) {
                let entries;
                try {
                    entries = fs.readdirSync(dir, { withFileTypes: true });
                } catch {
                    return;
                }
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (entry.name.startsWith('.')) continue;
                        scanForDuplicates(full, baseDir);
                    } else if (entry.isFile()) {
                        let hash;
                        try {
                            hash = computeFileHash(full);
                        } catch {
                            continue;
                        }
                        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
                        const url = `/media-files/${rel}`;
                        const existing = hashMap.get(hash) || [];
                        existing.push(url);
                        hashMap.set(hash, existing);
                    }
                }
            }

            scanForDuplicates(MEDIA_DATA_DIR, MEDIA_DATA_DIR);

            const groups = Array.from(hashMap.values()).filter((g) => g.length > 1);
            res.json({ groups });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/', (req, res) => {
        const { url } = req.body;
        if (!url || !url.startsWith('/media-files/')) {
            return res.status(400).json({ error: 'Invalid url' });
        }
        const rel = url.slice('/media-files/'.length);
        const target = path.resolve(MEDIA_DATA_DIR, rel);
        if (!target.startsWith(MEDIA_DATA_DIR + path.sep) && target !== MEDIA_DATA_DIR) {
            return res.status(400).json({ error: 'Path traversal rejected' });
        }
        try {
            fs.unlinkSync(target);
            const thumb = thumbPath(rel);
            if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Max 50 MB expressed as base64-decoded bytes
    const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

    router.post('/upload', requireDashboardAuth, (req, res) => {
        const { filename, data } = req.body;
        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename required' });
        }
        if (!data || typeof data !== 'string') {
            return res.status(400).json({ error: 'data (base64) required' });
        }

        // Strip directory components — only keep the basename
        const basename = path.basename(filename);
        if (!basename || basename === '.' || basename === '..') {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const ext = path.extname(basename).toLowerCase();
        if (!MEDIA_EXTS.has(ext)) {
            return res.status(400).json({ error: `Unsupported file type: ${ext}` });
        }

        // Rough size check before decoding (base64 inflates by ~4/3)
        if (data.length * 0.75 > UPLOAD_MAX_BYTES) {
            return res.status(413).json({ error: 'File too large (max 50 MB)' });
        }

        let buf;
        try {
            buf = Buffer.from(data, 'base64');
        } catch {
            return res.status(400).json({ error: 'Invalid base64 data' });
        }

        if (buf.length > UPLOAD_MAX_BYTES) {
            return res.status(413).json({ error: 'File too large (max 50 MB)' });
        }

        if (!checkMagicBytes(buf, ext)) {
            return res.status(400).json({ error: `File content does not match declared type ${ext}` });
        }

        const dest = path.join(MEDIA_DATA_DIR, basename);
        // Final path traversal guard
        if (!dest.startsWith(MEDIA_DATA_DIR + path.sep)) {
            return res.status(400).json({ error: 'Path traversal rejected' });
        }

        try {
            fs.writeFileSync(dest, buf);
            const uploadedUrl = `/media-files/${basename}`;
            res.json({ url: uploadedUrl });
            // Trigger incremental face indexing for the uploaded file
            if (typeof facesBuildIndex === 'function') {
                Promise.resolve(facesBuildIndex([{ url: uploadedUrl, type: MEDIA_EXTS.get(ext) }]))
                    .catch(() => {});
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

module.exports = {
    MEDIA_EXTS,
    scanMediaDir,
    createMediaRoutes,
};

