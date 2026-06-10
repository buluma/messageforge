# Face Sidecar Migration Plan

## Goal

Move MessageForge people grouping from the in-process `face-api.js` pipeline to the existing TGDL `tgdl-faces` sidecar contract.

The target outcome is:

- more reliable face detection and embeddings;
- no TensorFlow/Canvas runtime fragility inside the Node process;
- optional use of the Mac/CoreML sidecar for expensive work;
- better, repeatable people grouping through sidecar-backed DBSCAN;
- minimal disruption to the current Media page and person-linking UI.

## Current State

The current implementation is centered on:

- `lib/faceIndexer.js` — face-api model loading, thumbnail-based detection, greedy person matching, JSON index read/write.
- `lib/faceRoutes.js` — `/api/media/persons`, `/api/media/index-faces`, `/api/media/index-status`, rename/merge/delete/link routes.
- `smm/js/media.js` — People grid, scan button, polling, merge/link UI.
- `messageforge.js` — route registration and automatic incremental face indexing on new media.
- `config.js` and `sample.env` — current `FACE_MATCH_THRESHOLD` config.
- `data/face-index.json` — current JSON index.
- `data/.faces/` — current face crop cache.
- `data/face-models/` — current face-api model cache.

Current behavior:

- `face-api.js` downloads SSD MobileNet, landmark, and recognition models into `data/face-models/`.
- The indexer reads generated thumbnails from `data/.thumbs/`.
- It detects faces, computes descriptors, and greedily assigns each descriptor to an existing person using `FACE_MATCH_THRESHOLD`.
- People, descriptors, linked JIDs, and indexed thumbnail hashes are stored in `data/face-index.json`.
- Person cards and merge/link actions are already exposed in the media UI.

Known limitations:

- `face-api.js` depends on old bundled TensorFlow.js behavior and `canvas` monkey-patching.
- Grouping is greedy and order-dependent.
- The JSON index will become expensive and fragile as the media library grows.
- Current data suggests thumbnails may have been indexed as source media at least once, for example `/media-files/.thumbs/...jpg`.
- There is no global recluster step.
- Descriptors are limited to 10 per person, which can lose useful cluster shape over time.

## Sidecar Contract To Reuse

Use the TGDL `tgdl-faces` HTTP API:

- `GET /health`
- `GET /info`
- `POST /detect`
- `POST /cluster`

Useful current sidecar properties:

- InsightFace `buffalo_l`
- 512-dimensional ArcFace embeddings
- CoreML on Mac when available
- CPU fallback where needed

### MessageForge Request/Response Expectations

MessageForge should tolerate extra fields in sidecar responses, but should require the following minimum contract.

#### `POST /detect`

Request (path mode):

```json
{
    "path": "/absolute/path/to/file.jpg"
}
```

Request (base64 mode):

```json
{
    "image_b64": "..."
}
```

Response (minimum accepted shape):

```json
{
    "faces": [
        {
            "x": 10,
            "y": 20,
            "w": 100,
            "h": 100,
            "score": 0.93,
            "embedding": [0.0, 0.1]
        }
    ],
    "image_w": 1280,
    "image_h": 720
}
```

Interpretation rules:

- `x`, `y`, `w`, `h` are source-image pixel coordinates.
- `score` is detector confidence.
- MessageForge should compute its own `qualityScore` from score, box size, and aspect ratio.
- `embedding` must be length 512 for `buffalo_l`; otherwise skip that face.
- If `faces` is missing or empty, treat as no detections.

#### `POST /cluster`

Request:

```json
{
    "faces": [{ "embedding": [0.0, 0.1], "quality_score": 0.9 }],
    "eps": 1.05,
    "min_points": 2,
    "quality_weighted_centroid": true
}
```

Response (minimum accepted shape):

```json
{
    "clusters": [{ "member_idxs": [0, 2, 5], "centroid": [0.0, 0.1], "face_count": 3 }],
    "noise": [1, 3]
}
```

Interpretation rules:

- `member_idxs` point into the request `faces` array.
- Every input face is either in one cluster or in `noise`.
- If clustering fails or shape is invalid, keep previous grouping and surface a non-fatal status error.

Reference implementation: `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/faces-service/tgdl_faces/app.py`.

## Proposed Config

Add env-backed settings in `config.js` and `sample.env`:

```env
FACE_SIDECAR_URL=http://127.0.0.1:8011
FACE_SIDECAR_TIMEOUT_MS=60000
FACE_CLUSTER_TIMEOUT_MS=300000
FACE_CLUSTER_EPSILON=1.05
FACE_CLUSTER_MIN_POINTS=2
FACE_PRIMARY_PATH_MODE=false
FACE_SCAN_VIDEO=false
FACE_VIDEO_MAX_FRAMES=3
FACE_VIDEO_MIN_SPACING_SEC=2
```

Recommended Mac/Tailscale setup:

```env
FACE_SIDECAR_URL=http://100.100.245.3:8011
FACE_PRIMARY_PATH_MODE=false
```

Use base64 mode by default for MessageForge unless the sidecar and MessageForge share the same filesystem path layout.

## Data Model

Keep the first migration JSON-backed to reduce scope, but version the index.

New `data/face-index.json` shape:

```json
{
    "version": 2,
    "model": "buffalo_l",
    "dim": 512,
    "indexed": [],
    "faces": [
        {
            "id": "face_...",
            "mediaUrl": "/media-files/...",
            "x": 10,
            "y": 20,
            "w": 100,
            "h": 100,
            "score": 0.93,
            "qualityScore": 0.88,
            "embedding": [],
            "personId": "person_..."
        }
    ],
    "persons": [
        {
            "id": "person_...",
            "name": "Person 1",
            "faceUrl": "/api/media/face/person_....jpg",
            "mediaUrls": [],
            "centroid": [],
            "faceCount": 12,
            "jid": null,
            "confidence": 0.21
        }
    ]
}
```

Future improvement: migrate to a DB-backed store (SQLite/Postgres) after sidecar migration is stable.

## Implementation Phases

### Phase 1: Sidecar Client

Add `lib/faceSidecarClient.js`.

Responsibilities:

- normalize `FACE_SIDECAR_URL`;
- expose `health()`;
- expose `detectFaces(absPath, opts)`;
- expose `clusterFaces(faces, opts)`;
- support path mode and base64 mode;
- return `Float32Array` embeddings internally;
- use timeouts and never let a failed sidecar crash the bot.

Expected API:

```js
const { health, detectFaces, clusterFaces } = require('./faceSidecarClient');
```

Failure contract:

- client methods must not throw for network/HTTP/timeout/shape failures;
- return `{ ok: false, error: '...' }` on failures;
- return `{ ok: true, ... }` on success;
- include `error` in index status when relevant, but do not mutate existing saved people data on failure.

TGDL reference files:

- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/faces-client.js` — primary/fallback HTTP client, timeout handling, base64 fallback, `/cluster` parsing.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/faces-config.js` — env key parsing pattern.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/tests/ai/faces-client.test.js` — mocked fetch tests for detect and cluster.

### Phase 2: Replace Detection Internals

Update `lib/faceIndexer.js` so `indexFile()` calls the sidecar instead of `face-api.js`.

Keep:

- `buildIndex(allMediaFiles)`;
- `getPersons()`;
- `renamePerson()`;
- `mergePerson()`;
- `deletePerson()`;
- `linkPersonJid()`;
- `getStatus()`.

Remove or stop using:

- `downloadModels()`;
- `ensureModels()`;
- `face-api.js`;
- `canvas` as an inference dependency.

Still keep crop generation for face avatars. This can use `sharp` or `canvas`; it no longer needs to load face-api models.

MessageForge reference files:

- `lib/faceIndexer.js` — replace `ensureModels()`, `downloadModels()`, `bestMatch()`, and face-api detection calls.
- `tests/faceIndexer.test.js` — update tests that currently mock `face-api.js`.
- `package.json` and `package-lock.json` — remove `face-api.js` only after the sidecar path is stable.

### Phase 3: Global Reclustering

After all new detections are stored, call sidecar `/cluster` over all face embeddings.

Process:

1. Load all `faces` from the index.
2. Send embeddings to `/cluster`.
3. Preserve existing person labels/JIDs by matching old person centroids to new cluster centroids.
4. Rebuild `persons`.
5. Assign `face.personId`.
6. Regenerate or reuse cover face crops.

This replaces greedy first-match grouping with a repeatable whole-library grouping pass.

TGDL reference files:

- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/scan-runner.js` — tries sidecar clustering first and falls back to a Worker Thread.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/cluster-worker.js` — local DBSCAN fallback.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/faces.js` — quality scoring, centroid logic, DBSCAN defaults.

### Phase 4: Index Migration

When loading `data/face-index.json`:

- if missing, create v2;
- if `version !== 2`, treat old descriptors as incompatible;
- preserve user-facing labels and linked JIDs only when possible;
- otherwise trigger a full sidecar rebuild.

Old face-api descriptors should not be mixed with `buffalo_l` embeddings.

Migration notes:

- Existing v1 `persons[].descriptors` are face-api descriptors and must be discarded for grouping.
- Existing `name` and `jid` values may be preserved only by matching old cover/media URLs to new clusters.
- Existing `mediaUrls` that point into `/media-files/.thumbs/` should be ignored during rebuild.

### Phase 5: UI Preservation

Keep current Media page behavior:

- People section;
- Scan faces button;
- person filtering;
- rename/edit;
- merge;
- delete;
- link contact.

Small UI copy change:

- show sidecar state in `indexStatus`, for example `Sidecar ready`, `Sidecar unreachable`, `Scanning 10/200`.

MessageForge reference files:

- `smm/messageforge.html` — People section markup and `indexStatus`.
- `smm/js/media.js` — `startIndexing()`, `loadPersons()`, `renderPeople()`, merge/link interactions.
- `lib/faceRoutes.js` — keep the same route surface so the UI does not need a rewrite.

### Phase 6: Cleanup

After sidecar migration is stable:

- remove `face-api.js` from `package.json`;
- remove face model download code;
- stop documenting `data/face-models/` as active;
- remove `FACE_MATCH_THRESHOLD` or keep only as legacy migration note;
- update `CLAUDE.md`, `README.md`, and `sample.env`.

Cleanup references:

- `CLAUDE.md` — current Face recognition section still documents face-api and `data/face-models/`.
- `sample.env` — replace `FACE_MATCH_THRESHOLD` with sidecar settings.
- `config.js` — replace or deprecate `FACE_MATCH_THRESHOLD`.
- `package.json` and `package-lock.json` — remove `face-api.js` after rollout.

## Media Input Policy

- Source of truth for indexing: original media files from `data/` (`/media-files/...`), not generated thumbnails.
- Images: send directly to `/detect`.
- Videos: only scan when `FACE_SCAN_VIDEO=true`.
- Video frame sampling when enabled:
    - max `FACE_VIDEO_MAX_FRAMES` frames per file;
    - minimum spacing `FACE_VIDEO_MIN_SPACING_SEC` seconds;
    - skip frames/files on extraction failure without aborting full scan.

Implementation note:

- `lib/mediaRoutes.js` already has thumbnail generation and upload hooks; do not reuse generated thumbnail URLs as face source URLs.
- `messageforge.js` currently watches `data/` and triggers incremental indexing; keep the watcher but ensure dot-directories are excluded before calling `facesBuildIndex()`.

## Important Guardrails

- Do not index dot-directories:
    - `data/.thumbs`
    - `data/.faces`
    - `data/face-models`
- Do not write sidecar-derived people over a good existing index until detection and clustering both succeed.
- Do not mix face-api descriptors with buffalo_l embeddings.
- Keep person labels and linked JIDs whenever reclustering can confidently match old centroids.
- Sidecar failures should leave existing index data intact.
- Avoid running heavy clustering on every single uploaded file; debounce or run a short delayed recluster.
- Keep the current routes declared before parameterized media routes.

## Testing Plan

Unit tests:

- `faceSidecarClient` parses `/detect` responses into `Float32Array`.
- `faceSidecarClient` returns `{ ok: false }` on network/timeout failures.
- `faceIndexer` preserves labels and JIDs through a recluster.
- v1 index load does not crash and forces rebuild behavior.
- dot-directory media URLs are excluded from indexing.
- video scan obeys `FACE_SCAN_VIDEO` and frame sampling limits.

Manual checks:

- Start MessageForge.
- Confirm `/api/media/persons` works before scanning.
- Click `Scan faces`.
- Confirm status progresses.
- Confirm people cards appear.
- Filter media by person.
- Rename a person.
- Link a person to a WhatsApp contact.
- Trigger scan again and confirm rename/link survives.
- Stop sidecar and confirm UI reports a useful failure without clearing existing people.

## Rollout Plan

1. Implement sidecar client with tests.
2. Add v2 index loader/saver.
3. Replace detection path behind the existing `buildIndex()` entrypoint.
4. Add recluster step.
5. Test with a small local media folder.
6. Test against the existing Mac sidecar.
7. Remove old face-api dependency only after the sidecar path is stable.

## File Reference Map

MessageForge files to change:

- `config.js` — add sidecar env config and deprecate `FACE_MATCH_THRESHOLD`.
- `sample.env` — document sidecar settings.
- `lib/faceSidecarClient.js` — new sidecar HTTP client.
- `lib/faceIndexer.js` — replace detection/grouping internals while preserving public exports.
- `lib/faceRoutes.js` — likely unchanged route surface; optionally expose sidecar health in status.
- `smm/js/media.js` — status copy only, unless new sidecar health fields are shown.
- `smm/messageforge.html` — likely unchanged.
- `messageforge.js` — ensure auto-index watcher excludes dot-directories before invoking face indexing.
- `tests/faceIndexer.test.js` — update from face-api mocks to sidecar/indexer behavior.
- `package.json` and `package-lock.json` — cleanup after migration stabilizes.
- `CLAUDE.md` and `README.md` — update face recognition docs.

TGDL files to copy patterns from:

- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/faces-service/tgdl_faces/app.py` — sidecar `/detect` and `/cluster` wire contract.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/faces-service/tests/test_app.py` — sidecar cluster test shape.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/faces-client.js` — robust HTTP client and cluster response parsing.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/faces-config.js` — env parser pattern.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/faces.js` — quality score and DBSCAN defaults.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/scan-runner.js` — sidecar-first clustering flow.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/src/core/ai/cluster-worker.js` — optional local DBSCAN fallback.
- `/Users/shadowwalker/Documents/GitHub/telegram-media-downloader/tests/ai/faces-client.test.js` — mocked client tests.

## Resolved Decisions

- Storage for migration phase: keep JSON v2 first; DB migration can follow later.
- Scan source media: scan original images/videos, not generated thumbnails.
- Video grouping default: opt-in (`FACE_SCAN_VIDEO=false` by default).
- Sidecar lifecycle: MessageForge only consumes an externally managed sidecar; it does not spawn its own sidecar.
