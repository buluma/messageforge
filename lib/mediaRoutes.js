'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');

// 3-level structure: alternatives (any matches) → sigs (all must match) → [offset, bytes[]]
// alternatives.some(sigs => sigs.every(([offset, bytes]) => bytes match buf))
const MAGIC_BYTES = new Map([
    ['.jpg', [[[0, [0xff, 0xd8, 0xff]]]]],
    ['.jpeg', [[[0, [0xff, 0xd8, 0xff]]]]],
    ['.png', [[[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]]]],
    ['.gif', [[[0, [0x47, 0x49, 0x46, 0x38]]]]],
    [
        '.webp',
        [
            [
                [0, [0x52, 0x49, 0x46, 0x46]],
                [8, [0x57, 0x45, 0x42, 0x50]],
            ],
        ],
    ],
    ['.mp4', [[[4, [0x66, 0x74, 0x79, 0x70]]]]],
    ['.mov', [[[4, [0x66, 0x74, 0x79, 0x70]]]]],
    ['.m4a', [[[4, [0x66, 0x74, 0x79, 0x70]]]]],
    ['.webm', [[[0, [0x1a, 0x45, 0xdf, 0xa3]]]]],
    ['.mkv', [[[0, [0x1a, 0x45, 0xdf, 0xa3]]]]],
    ['.ogg', [[[0, [0x4f, 0x67, 0x67, 0x53]]]]],
    ['.opus', [[[0, [0x4f, 0x67, 0x67, 0x53]]]]],
    [
        '.mp3',
        [[[0, [0x49, 0x44, 0x33]]], [[0, [0xff, 0xfb]]], [[0, [0xff, 0xfa]]], [[0, [0xff, 0xf3]]]],
    ],
    ['.wav', [[[0, [0x52, 0x49, 0x46, 0x46]]]]],
]);

function checkMagicBytes(buf, ext) {
    const alternatives = MAGIC_BYTES.get(ext);
    if (!alternatives) return true;

    try {
        return alternatives.some((sigs) => {
            // sigs is an array of [offset, [expectedBytes]]
            return sigs.every((sig) => {
                if (!Array.isArray(sig)) return false;
                const [offset, expected] = sig;
                return expected.every((b, i) => buf[offset + i] === b);
            });
        });
    } catch (err) {
        console.warn(`[MediaRoutes] Magic byte check failed for ${ext}:`, err.message);
        return false;
    }
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
            const mtime = Math.floor(stat.mtimeMs / 1000);
            results.push({
                name: entry.name,
                url: `/media-files/${rel}`,
                type: kind,
                folder,
                size: stat.size,
                mtime,
                thumbVersion: `${mtime}-${stat.size}`,
            });
        }
    }
}

// Returns the hex SHA-256 digest of a file's contents.
function computeFileHash(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function mediaRelFromUrl(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('/media-files/')) return null;
    return url.slice('/media-files/'.length);
}

function normalizeMediaFolder(folder) {
    if (!folder || folder === '.') return '';
    if (typeof folder !== 'string') return null;
    const normalized = folder
        .replace(/\\/g, '/')
        .trim()
        .replace(/^\/+|\/+$/g, '');
    if (!normalized) return '';
    const parts = normalized.split('/');
    if (
        path.isAbsolute(normalized) ||
        parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
    ) {
        return null;
    }
    return parts.join('/');
}

function createMediaRoutes({ mediaDataDir, requireDashboardAuth, facesBuildIndex } = {}) {
    if (!mediaDataDir) throw new Error('createMediaRoutes: mediaDataDir required');

    const router = express.Router();
    const MEDIA_DATA_DIR = mediaDataDir;

    const THUMB_DIR = path.join(MEDIA_DATA_DIR, '.thumbs');

    // Probe once: does this ffmpeg have libwebp?
    let _thumbExt = null;
    function thumbExt() {
        if (_thumbExt) return _thumbExt;
        try {
            const out = require('child_process').execFileSync(
                'ffmpeg',
                ['-hide_banner', '-encoders'],
                { encoding: 'utf8', timeout: 5000 },
            );
            _thumbExt = out.includes('libwebp') ? 'webp' : 'jpg';
        } catch {
            _thumbExt = 'jpg';
        }
        return _thumbExt;
    }

    function thumbKey(relPath) {
        return crypto.createHash('sha1').update(relPath).digest('hex');
    }

    function thumbPath(relPath, stat, variant = '') {
        const suffix = stat ? `-${Math.floor(stat.mtimeMs / 1000)}-${stat.size}` : '';
        return path.join(THUMB_DIR, `${thumbKey(relPath)}${variant}${suffix}.${thumbExt()}`);
    }

    function unlinkThumbsForRel(relPath) {
        const key = thumbKey(relPath);
        let entries = [];
        try {
            entries = fs.readdirSync(THUMB_DIR);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.startsWith(key)) continue;
            try {
                fs.unlinkSync(path.join(THUMB_DIR, entry));
            } catch {
                /* best-effort cache cleanup */
            }
        }
    }

    // TGDL-style single-pass thumbnail: seek → scale → encode.
    // Uses libwebp when available (10× faster, smaller output); falls back to
    // MJPEG if ffmpeg wasn't built with libwebp (common on macOS homebrew).
    // HW decode via videotoolbox (mac) or vaapi (linux) where available.
    // Scale stays in software (single-frame, fast enough).
    // See: src/core/thumbs.js `hwaccelFullPipeline` + `_generateVideoThumb`
    const THUMB_CONCURRENCY = 3;
    let thumbActive = 0;
    const thumbQueue = [];

    const HW_ACCEL =
        process.platform === 'darwin'
            ? ['-hwaccel', 'videotoolbox']
            : process.platform === 'linux'
              ? ['-hwaccel', 'vaapi']
              : [];
    const SCALE_VF = "scale='min(320,iw)':-2:flags=fast_bilinear";

    function probeDuration(src, cb) {
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
            { timeout: 5000 },
            (err, stdout) => {
                if (err) return cb(null);
                const duration = Number.parseFloat(String(stdout).trim());
                cb(Number.isFinite(duration) && duration > 0 ? duration : null);
            },
        );
    }

    function buildSeekPlan(src, cb) {
        probeDuration(src, (duration) => {
            if (!duration || duration < 2) {
                cb([1, 0]);
                return;
            }
            const candidates = [Math.max(0.5, duration * 0.1), Math.max(0.5, duration * 0.5), 1, 0];
            cb([...new Set(candidates.map((n) => Math.min(duration - 0.1, Number(n.toFixed(2)))))]);
        });
    }

    function runThumb(src, dest, cb, seekPlanOverride = null) {
        if (thumbActive >= THUMB_CONCURRENCY) {
            thumbQueue.push(() => runThumb(src, dest, cb, seekPlanOverride));
            return;
        }
        thumbActive++;

        const isWebp = dest.endsWith('.webp');

        function hasUsableThumb() {
            try {
                return fs.statSync(dest).size > 0;
            } catch {
                return false;
            }
        }

        function spawn(seekSec, done) {
            const args = [
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                ...HW_ACCEL,
                '-ss',
                String(seekSec),
                '-i',
                src,
                '-frames:v',
                '1',
                '-an',
                '-vf',
                SCALE_VF,
            ];
            if (isWebp) {
                args.push('-c:v', 'libwebp', '-quality', '80', '-compression_level', '6');
            } else {
                args.push('-c:v', 'mjpeg', '-q:v', '5');
            }
            args.push('-f', isWebp ? 'webp' : 'image2', dest);

            execFile('ffmpeg', args, { timeout: 20000 }, (err) => done(err));
        }

        const runSeekPlan = (seekPlan) => {
            let idx = 0;
            let lastErr = null;

            const tryNext = () => {
                const seekSec = seekPlan[idx++];
                if (seekSec == null) {
                    thumbActive--;
                    if (thumbQueue.length) thumbQueue.shift()();
                    cb(lastErr || new Error('Thumbnail generation failed'));
                    return;
                }
                spawn(seekSec, (err) => {
                    if (!err && hasUsableThumb()) {
                        thumbActive--;
                        if (thumbQueue.length) thumbQueue.shift()();
                        cb(null);
                        return;
                    }
                    lastErr = err;
                    tryNext();
                });
            };

            tryNext();
        };

        if (Array.isArray(seekPlanOverride) && seekPlanOverride.length > 0) {
            runSeekPlan(seekPlanOverride);
            return;
        }
        buildSeekPlan(src, runSeekPlan);
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

        let stat;
        try {
            stat = fs.statSync(src);
        } catch {
            return res.status(404).json({ error: 'Media not found' });
        }

        const seek = Number.parseFloat(req.query.seek);
        const hasSeek = Number.isFinite(seek) && seek >= 0;
        const seekValue = hasSeek ? Number(seek.toFixed(1)) : null;
        const dest = thumbPath(rel, stat, hasSeek ? `-seek-${Math.round(seekValue * 10)}` : '');
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

        runThumb(
            src,
            dest,
            (err) => {
                const waiters = thumbInProgress.get(dest) || [];
                thumbInProgress.delete(dest);
                if (err || !fs.existsSync(dest)) {
                    for (const w of waiters)
                        w.res.status(500).json({ error: 'Thumbnail generation failed' });
                    return;
                }
                for (const w of waiters) w.serve();
            },
            hasSeek ? [seekValue, 1, 0] : null,
        );
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
        const rel = mediaRelFromUrl(url);
        if (!rel) {
            return res.status(400).json({ error: 'Invalid url' });
        }
        const target = path.resolve(MEDIA_DATA_DIR, rel);
        if (!target.startsWith(MEDIA_DATA_DIR + path.sep) && target !== MEDIA_DATA_DIR) {
            return res.status(400).json({ error: 'Path traversal rejected' });
        }
        try {
            fs.unlinkSync(target);
            unlinkThumbsForRel(rel);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.patch('/move', requireDashboardAuth, (req, res) => {
        const { urls, folder } = req.body || {};
        if (!Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: 'urls must be a non-empty array' });
        }
        if (urls.length > 200) {
            return res.status(413).json({ error: 'Cannot move more than 200 files at once' });
        }

        const destFolder = normalizeMediaFolder(folder);
        if (destFolder == null) {
            return res.status(400).json({ error: 'Invalid destination folder' });
        }

        const destDir = path.resolve(MEDIA_DATA_DIR, destFolder || '.');
        if (destDir !== MEDIA_DATA_DIR && !destDir.startsWith(MEDIA_DATA_DIR + path.sep)) {
            return res.status(400).json({ error: 'Path traversal rejected' });
        }

        const planned = [];
        const seenDest = new Set();
        for (const url of urls) {
            const rel = mediaRelFromUrl(url);
            if (!rel) return res.status(400).json({ error: `Invalid url: ${url}` });

            const src = path.resolve(MEDIA_DATA_DIR, rel);
            if (!src.startsWith(MEDIA_DATA_DIR + path.sep) || !fs.existsSync(src)) {
                return res.status(400).json({ error: `Media not found: ${url}` });
            }
            const stat = fs.statSync(src);
            if (!stat.isFile()) {
                return res.status(400).json({ error: `Not a file: ${url}` });
            }

            const basename = path.basename(src);
            const ext = path.extname(basename).toLowerCase();
            if (!MEDIA_EXTS.has(ext)) {
                return res.status(400).json({ error: `Unsupported file type: ${basename}` });
            }

            const dest = path.join(destDir, basename);
            const destRel = path.relative(MEDIA_DATA_DIR, dest).replace(/\\/g, '/');
            if (seenDest.has(destRel)) {
                return res.status(409).json({ error: `Destination conflict: ${basename}` });
            }
            seenDest.add(destRel);

            if (src !== dest && fs.existsSync(dest)) {
                return res.status(409).json({ error: `Destination already exists: ${destRel}` });
            }
            planned.push({ oldUrl: url, oldRel: rel, src, dest, destRel });
        }

        try {
            fs.mkdirSync(destDir, { recursive: true });
            const moved = [];
            for (const item of planned) {
                if (item.src !== item.dest) {
                    fs.renameSync(item.src, item.dest);
                    unlinkThumbsForRel(item.oldRel);
                }
                moved.push({
                    from: item.oldUrl,
                    to: `/media-files/${item.destRel}`,
                    folder: destFolder || '.',
                    name: path.basename(item.dest),
                });
            }
            res.json({ moved });
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
            return res
                .status(400)
                .json({ error: `File content does not match declared type ${ext}` });
        }

        const dest = path.join(MEDIA_DATA_DIR, basename);
        // Final path traversal guard
        if (!dest.startsWith(MEDIA_DATA_DIR + path.sep)) {
            return res.status(400).json({ error: 'Path traversal rejected' });
        }

        try {
            unlinkThumbsForRel(basename);
            fs.writeFileSync(dest, buf);
            const uploadedUrl = `/media-files/${basename}`;
            res.json({ url: uploadedUrl });
            // Trigger incremental face indexing for the uploaded file
            if (typeof facesBuildIndex === 'function') {
                Promise.resolve(
                    facesBuildIndex([{ url: uploadedUrl, type: MEDIA_EXTS.get(ext) }]),
                ).catch(() => {});
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
