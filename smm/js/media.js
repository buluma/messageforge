'use strict';

import api from './api.js';
import { toast, escapeHtml, setupFocusTrap } from './utils.js';

const ICON = { video: '🎬', image: '🖼️', audio: '🎵' };

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
}

function formatDate(ts) {
    return new Date(ts * 1000).toLocaleDateString();
}

const PAGE_SIZE = 50;
const PREWARM_THUMB_COUNT = 18;

let allFiles = [];
let allPersons = [];
let totalMediaBytes = 0;
let activeType = 'all';
let searchTerm = '';
let activePerson = null;
let sortKey = 'date-desc';
let mergeSourceId = null;
let mediaPage = 1;
// JID of the person whose link picker is currently open (null = closed)
let linkPickerOpenId = null;
// Cached non-group chat list for the JID picker
let chatList = null;

function sorted(files) {
    const arr = [...files];
    switch (sortKey) {
        case 'date-desc':
            return arr.sort((a, b) => b.mtime - a.mtime);
        case 'date-asc':
            return arr.sort((a, b) => a.mtime - b.mtime);
        case 'size-desc':
            return arr.sort((a, b) => b.size - a.size);
        case 'size-asc':
            return arr.sort((a, b) => a.size - b.size);
        case 'name-asc':
            return arr.sort((a, b) => a.name.localeCompare(b.name));
        case 'name-desc':
            return arr.sort((a, b) => b.name.localeCompare(a.name));
        default:
            return arr;
    }
}

function filtered() {
    const base = allFiles.filter((f) => {
        if (activeType !== 'all' && f.type !== activeType) return false;
        if (searchTerm && !f.name.toLowerCase().includes(searchTerm)) return false;
        if (activePerson) {
            const p = allPersons.find((x) => x.id === activePerson);
            if (!p || !p.mediaUrls.includes(f.url)) return false;
        }
        return true;
    });
    return sorted(base);
}

function thumbSrc(file) {
    const version = file.thumbVersion || `${file.mtime || 0}-${file.size || 0}`;
    return `/api/media/thumb?url=${encodeURIComponent(file.url)}&v=${encodeURIComponent(version)}`;
}

function prewarmThumbs(files) {
    files
        .filter((f) => f.type === 'image' || f.type === 'video')
        .slice(0, PREWARM_THUMB_COUNT)
        .forEach((f) => {
            const img = new Image();
            img.src = thumbSrc(f);
        });
}

function renderGrid() {
    const grid = document.getElementById('mediaGrid');
    const allFiltered = filtered();
    const countLabel = `${allFiltered.length} file${allFiltered.length !== 1 ? 's' : ''}`;
    const sizeLabel = totalMediaBytes > 0 ? ` · ${formatBytes(totalMediaBytes)}` : '';
    document.getElementById('mediaCount').textContent = countLabel + sizeLabel;

    if (allFiltered.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No media found.</div>';
        grid.hidden = false;
        return;
    }

    const visibleFiles = allFiltered.slice(0, PAGE_SIZE * mediaPage);

    grid.innerHTML = visibleFiles
        .map((f) => {
            const safeName = escapeHtml(f.name);
            const safeFolder = escapeHtml(f.folder === '.' ? 'root' : f.folder);
            const safeType = escapeHtml(f.type);
            const safeThumb = escapeHtml(thumbSrc(f));
            const icon = ICON[f.type] || '📄';
            return `
        <div class="media-card" data-url="${escapeHtml(f.url)}" data-type="${safeType}" data-name="${safeName}" tabindex="0" role="button" aria-label="View ${safeName}">
            <button class="media-delete-btn" data-url="${escapeHtml(f.url)}" title="Delete" aria-label="Delete ${safeName}">🗑</button>
            ${
                f.type === 'image' || f.type === 'video'
                    ? `<div class="media-thumb-wrap is-loading">
                        <img class="media-thumb-backdrop" src="${safeThumb}" alt="" aria-hidden="true" loading="lazy" decoding="async" />
                        <img class="media-thumb" src="${safeThumb}" alt="${safeName}" loading="lazy" decoding="async" data-icon="${icon}" />
                        <span class="media-type-badge media-type-badge--${safeType}">${icon} ${safeType}</span>
                        ${f.type === 'video' ? '<span class="media-play-badge">▶</span>' : ''}
                    </div>`
                    : `<div class="media-thumb-placeholder"><span>${icon}</span><span class="media-type-label">${safeType}</span></div>`
            }
            <div class="media-card-body">
                <div class="media-card-name" title="${safeName}">${safeName}</div>
                <div class="media-card-meta">
                    <span class="media-folder-tag">${safeFolder}</span>
                    <span>${formatBytes(f.size)}</span>
                </div>
                <div class="media-card-meta" style="margin-top:2px">
                    <span style="color:var(--text-dim)">${formatDate(f.mtime)}</span>
                </div>
            </div>
        </div>
    `;
        })
        .join('');

    prewarmThumbs(visibleFiles);

    // Append "Load more" button if there are additional files beyond the current page
    if (allFiltered.length > PAGE_SIZE * mediaPage) {
        const remaining = allFiltered.length - PAGE_SIZE * mediaPage;
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'media-load-more';
        loadMoreBtn.textContent = `Load more (${remaining} remaining)`;
        loadMoreBtn.addEventListener('click', () => {
            mediaPage += 1;
            renderGrid();
        });
        grid.appendChild(loadMoreBtn);
    }

    grid.querySelectorAll('img.media-thumb[data-icon]').forEach((img) => {
        const wrap = img.closest('.media-thumb-wrap');
        const markLoaded = () => wrap?.classList.remove('is-loading');
        if (img.complete && img.naturalWidth > 0) markLoaded();
        img.addEventListener('load', markLoaded, { once: true });
        img.onerror = function () {
            const icon = this.dataset.icon || '📄';
            const placeholder = document.createElement('div');
            placeholder.className = 'media-thumb-placeholder media-thumb-placeholder--error';
            placeholder.innerHTML = `<span>${icon}</span><span class="media-type-label">No preview</span>`;
            (wrap || this).replaceWith(placeholder);
        };
    });

    grid.hidden = false;
}

async function deleteFile(url, options = {}) {
    const confirmDelete = options.confirm !== false;
    const silent = options.silent === true;
    try {
        if (confirmDelete) {
            const f = allFiles.find((x) => x.url === url);
            const name = f?.name || url;
            const size = typeof f?.size === 'number' ? ` (${formatBytes(f.size)})` : '';
            if (!confirm(`Delete "${name}"${size}?`)) return false;
        }
        await api.delete('/api/media', { data: { url } });
        allFiles = allFiles.filter((f) => f.url !== url);
        if (!silent) renderGrid();
        return true;
    } catch (err) {
        toast.error(`Delete failed: ${err.response?.data?.error || err.message}`);
        return false;
    }
}

let lightboxUrl = null;
let lbAutoplay = false;
let lbLoop = false;

function lbVideoFiles() {
    return filtered().filter((f) => f.type === 'video');
}

function lbCurrentIndex() {
    return lbVideoFiles().findIndex((f) => f.url === lightboxUrl);
}

function updateLbControls(file) {
    const videos = lbVideoFiles();
    const idx = videos.findIndex((f) => f.url === file.url);
    const isVideo = file.type === 'video';

    document.getElementById('lbPrev').hidden = !isVideo || idx <= 0;
    document.getElementById('lbNext').hidden = !isVideo || idx >= videos.length - 1;
    document.getElementById('lbCounter').textContent =
        isVideo && videos.length > 1 ? `${idx + 1} / ${videos.length}` : '';
    document.getElementById('lbAutoplay').classList.toggle('active', lbAutoplay);
    document.getElementById('lbLoop').classList.toggle('active', lbLoop);

    const nameEl = document.getElementById('mediaLightboxName');
    const dlEl = document.getElementById('mediaLightboxDownload');
    nameEl.textContent = file.name;
    dlEl.href = file.url;
    dlEl.download = file.name;
}

let lbCleanup = null;
function openLightbox(file) {
    const lb = document.getElementById('mediaLightbox');
    const content = document.getElementById('mediaLightboxContent');

    lightboxUrl = file.url;
    content.innerHTML = '';

    if (file.type === 'image') {
        const img = document.createElement('img');
        img.src = file.url;
        img.alt = file.name;
        content.appendChild(img);
    } else if (file.type === 'video') {
        const vid = document.createElement('video');
        vid.src = file.url;
        vid.controls = true;
        vid.autoplay = true;
        vid.loop = lbLoop;
        vid.addEventListener('ended', () => {
            if (lbLoop) return;
            if (!lbAutoplay) return;
            const idx = lbCurrentIndex();
            const videos = lbVideoFiles();
            if (idx < videos.length - 1) openLightbox(videos[idx + 1]);
        });
        content.appendChild(vid);
    } else if (file.type === 'audio') {
        const aud = document.createElement('audio');
        aud.src = file.url;
        aud.controls = true;
        aud.autoplay = true;
        content.appendChild(aud);
    }

    lb.hidden = false;
    updateLbControls(file);
    if (!lbCleanup) {
        lbCleanup = setupFocusTrap(lb, lb.querySelector('.media-lightbox-close'));
    }
}

function closeLightbox() {
    const lb = document.getElementById('mediaLightbox');
    const content = document.getElementById('mediaLightboxContent');
    content.innerHTML = '';
    lightboxUrl = null;
    lb.hidden = true;
    if (lbCleanup) {
        lbCleanup();
        lbCleanup = null;
    }
}

function lbNavigate(dir) {
    const videos = lbVideoFiles();
    const idx = lbCurrentIndex();
    const next = videos[idx + dir];
    if (next) openLightbox(next);
}

function renderPeople() {
    const wrap = document.getElementById('peopleSectionWrap');
    const grid = document.getElementById('peopleGrid');
    wrap.hidden = false;
    if (allPersons.length === 0) {
        grid.innerHTML = '';
        return;
    }

    grid.innerHTML = allPersons
        .map((p) => {
            const linkedName = p.jid
                ? chatList?.find((c) => c.jid === p.jid)?.name || p.jid.split('@')[0]
                : null;
            const safePName = escapeHtml(p.name);
            const safeLinked = linkedName ? escapeHtml(linkedName) : null;
            return `
        <div class="person-card ${activePerson === p.id ? 'active' : ''} ${mergeSourceId === p.id ? 'merge-source' : ''}"
             data-person-id="${p.id}">
            <button class="person-delete-btn" data-person-id="${p.id}" title="Remove person">✕</button>
            <div class="person-avatar">
                ${
                    p.faceUrl
                        ? `<img src="${p.faceUrl}" alt="${safePName}" class="person-face-img" />`
                        : `<span>👤</span>`
                }
            </div>
            <div class="person-name" contenteditable="false" data-person-id="${p.id}">${safePName}</div>
            ${safeLinked ? `<div class="person-jid-label" title="${escapeHtml(p.jid)}">@${safeLinked}</div>` : ''}
            <div class="person-count">${p.count} file${p.count !== 1 ? 's' : ''}</div>
            ${
                p.confidence != null && p.count > 1
                    ? p.confidence >= 0.75
                        ? `<div class="person-confidence person-confidence--high">High confidence</div>`
                        : p.confidence >= 0.5
                          ? `<div class="person-confidence person-confidence--medium">Medium</div>`
                          : `<div class="person-confidence person-confidence--low">Low confidence</div>`
                    : ''
            }
            ${
                mergeSourceId && mergeSourceId !== p.id
                    ? `<button class="person-merge-into-btn" data-person-id="${p.id}" title="Merge into this person">← Merge here</button>`
                    : ''
            }
            ${
                !mergeSourceId
                    ? `<button class="person-merge-btn" data-person-id="${p.id}" title="Merge this person into another">⇄ Merge</button>`
                    : ''
            }
            ${
                !mergeSourceId
                    ? `<button class="person-link-btn" data-person-id="${p.id}" title="Link to WhatsApp contact">⇗ Link contact</button>`
                    : ''
            }
            ${
                linkPickerOpenId === p.id
                    ? `
            <div class="person-link-picker" data-person-id="${p.id}">
                <select class="person-link-select" data-person-id="${p.id}">
                    <option value="">— select contact —</option>
                    ${(chatList || []).map((c) => `<option value="${c.jid}" ${p.jid === c.jid ? 'selected' : ''}>${c.name || c.jid.split('@')[0]}</option>`).join('')}
                </select>
            </div>`
                    : ''
            }
        </div>
    `;
        })
        .join('');

    const cancelBtn = document.getElementById('mergeCancelBtn');
    if (cancelBtn) cancelBtn.hidden = !mergeSourceId;
}

async function loadPersons() {
    try {
        const data = await api.get('/api/media/persons').then((r) => r.data);
        allPersons = data.persons || [];
        renderPeople();
    } catch {
        /* silent */
    }
}

async function fetchChatList() {
    if (chatList) return chatList;
    try {
        const data = await api.get('/api/chats').then((r) => r.data);
        const chats = data.chats || data || [];
        chatList = chats
            .filter((c) => c.jid && !c.jid.endsWith('@g.us'))
            .map((c) => ({ jid: c.jid, name: c.name || c.pushName || c.jid.split('@')[0] }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        chatList = [];
    }
    return chatList;
}

async function uploadMedia(file) {
    const btn = document.getElementById('mediaUploadBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading…';

    try {
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Strip the data URL prefix (e.g. "data:video/mp4;base64,")
                const b64 = reader.result.split(',')[1];
                resolve(b64);
            };
            reader.onerror = () => reject(new Error('FileReader failed'));
            reader.readAsDataURL(file);
        });

        const resp = await api.post('/api/media/upload', { filename: file.name, data });
        const { url } = resp.data;

        // Build a synthetic file entry and prepend it
        const entry = {
            name: file.name,
            url,
            type: file.type.startsWith('video')
                ? 'video'
                : file.type.startsWith('audio')
                  ? 'audio'
                  : 'image',
            folder: '.',
            size: file.size,
            mtime: Math.floor(Date.now() / 1000),
        };
        allFiles.unshift(entry);
        renderGrid();
        toast.success(`Uploaded ${file.name}`);
    } catch (err) {
        toast.error(`Upload failed: ${err.response?.data?.error || err.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = '↑ Upload';
    }
}

let indexPollTimer = null;

async function startIndexing() {
    const btn = document.getElementById('indexFacesBtn');
    const statusEl = document.getElementById('indexStatus');
    btn.disabled = true;
    statusEl.textContent = 'Starting…';

    await api.post('/api/media/index-faces').catch(() => {});

    if (indexPollTimer) clearInterval(indexPollTimer);
    indexPollTimer = setInterval(async () => {
        try {
            const s = await api.get('/api/media/index-status').then((r) => r.data);
            if (s.running) {
                const prefix = s.phase === 'cluster' ? 'Clustering faces' : 'Scanning';
                const sidecar = s.sidecar === 'ready' ? 'Sidecar ready · ' : '';
                statusEl.textContent = `${sidecar}${prefix} ${s.done}/${s.total}…`;
            } else {
                clearInterval(indexPollTimer);
                indexPollTimer = null;
                btn.disabled = false;
                statusEl.textContent = s.error ? `Error: ${s.error}` : `Done`;
                await loadPersons();
            }
        } catch {
            clearInterval(indexPollTimer);
            indexPollTimer = null;
            btn.disabled = false;
        }
    }, 1500);
}

async function loadMedia() {
    const loading = document.getElementById('mediaLoading');
    const grid = document.getElementById('mediaGrid');
    loading.textContent = 'Loading media…';
    loading.hidden = false;
    grid.hidden = true;

    try {
        const [mediaData, personsData] = await Promise.all([
            api.get('/api/media').then((r) => r.data),
            api
                .get('/api/media/persons')
                .then((r) => r.data)
                .catch(() => ({ persons: [] })),
        ]);
        allFiles = mediaData.files || [];
        totalMediaBytes = mediaData.totalBytes || 0;
        allPersons = personsData.persons || [];
        loading.hidden = true;
        renderGrid();
        renderPeople();
    } catch (err) {
        loading.textContent = `Failed to load media: ${err.message}`;
    }
}

async function scanDuplicates() {
    const btn = document.getElementById('scanDuplicatesBtn');
    const wrap = document.getElementById('duplicatesSectionWrap');
    const grid = document.getElementById('duplicatesGrid');

    btn.disabled = true;
    btn.textContent = 'Scanning…';
    wrap.hidden = false;
    grid.innerHTML = '<div class="empty-state">Scanning for duplicates…</div>';

    try {
        const data = await api.get('/api/media/duplicates').then((r) => r.data);
        const groups = data.groups || [];

        if (groups.length === 0) {
            grid.innerHTML = '<div class="empty-state">No duplicates found.</div>';
            return;
        }

        grid.innerHTML = '';
        groups.forEach((urls, idx) => {
            const files = urls.map((url) => allFiles.find((f) => f.url === url)).filter(Boolean);
            if (files.length < 2) return;

            const groupEl = document.createElement('div');
            groupEl.className = 'duplicate-group';
            groupEl.dataset.groupIdx = idx;

            const thumbsHtml = files
                .map((f) => {
                    const safeFName = escapeHtml(f.name);
                    return `
                <div class="duplicate-item">
                    ${
                        f.type === 'image' || f.type === 'video'
                            ? `<img class="duplicate-thumb" src="${escapeHtml(thumbSrc(f))}" alt="${safeFName}" loading="lazy" />`
                            : `<div class="duplicate-thumb duplicate-thumb-icon">${ICON[f.type] || '📄'}</div>`
                    }
                    <div class="duplicate-item-name" title="${safeFName}">${safeFName}</div>
                    <div class="duplicate-item-size">${formatBytes(f.size)}</div>
                </div>
            `;
                })
                .join('');

            groupEl.innerHTML = `
                <div class="duplicate-thumbs">${thumbsHtml}</div>
                <div class="duplicate-actions">
                    <button class="ghost-btn duplicate-keep-btn" data-group-idx="${idx}">Keep first, delete rest</button>
                </div>
            `;
            grid.appendChild(groupEl);
        });

        if (grid.children.length === 0) {
            grid.innerHTML = '<div class="empty-state">No duplicates found.</div>';
        }
    } catch (err) {
        grid.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.response?.data?.error || err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Scan duplicates';
    }
}

async function keepFirstDeleteRest(groupIdx) {
    const groupEl = document.querySelector(`.duplicate-group[data-group-idx="${groupIdx}"]`);
    if (!groupEl) return;

    const thumbs = groupEl.querySelectorAll('.duplicate-item');
    // First item is kept; delete the rest
    const toDelete = [];
    thumbs.forEach((item, i) => {
        if (i === 0) return;
        const img = item.querySelector('img.duplicate-thumb');
        if (img) {
            // Decode the URL from the thumb src query param
            const match = img.src.match(/url=([^&]+)/);
            if (match) toDelete.push(decodeURIComponent(match[1]));
        }
    });

    for (const url of toDelete) {
        await deleteFile(url, { confirm: false, silent: true });
    }

    groupEl.remove();
    renderGrid();

    const grid = document.getElementById('duplicatesGrid');
    if (grid.children.length === 0) {
        grid.innerHTML = '<div class="empty-state">No duplicates remaining.</div>';
    }
}

export function mountMedia() {
    document.getElementById('mediaFilterPills').addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        activeType = pill.dataset.type;
        mediaPage = 1;
        document
            .querySelectorAll('#mediaFilterPills .pill')
            .forEach((p) => p.classList.toggle('active', p === pill));
        renderGrid();
    });

    document.getElementById('mediaSearch').addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        mediaPage = 1;
        renderGrid();
    });

    document.getElementById('mediaSort').addEventListener('change', (e) => {
        sortKey = e.target.value;
        mediaPage = 1;
        renderGrid();
    });

    document.getElementById('mediaUploadBtn').addEventListener('click', () => {
        document.getElementById('mediaUploadInput').click();
    });

    document.getElementById('mediaUploadInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) uploadMedia(file);
        // Reset so the same file can be re-selected if needed
        e.target.value = '';
    });

    document.getElementById('mediaGrid').addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.media-delete-btn');
        if (deleteBtn) {
            e.stopPropagation();
            deleteFile(deleteBtn.dataset.url);
            return;
        }
        const card = e.target.closest('.media-card');
        if (!card) return;
        const file = allFiles.find((f) => f.url === card.dataset.url);
        if (file) openLightbox(file);
    });

    document.getElementById('mediaGrid').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const card = e.target.closest('.media-card');
            if (!card) return;
            e.preventDefault();
            const file = allFiles.find((f) => f.url === card.dataset.url);
            if (file) openLightbox(file);
        }
    });

    document.getElementById('mediaLightbox').addEventListener('click', (e) => {
        if (
            e.target.classList.contains('media-lightbox-backdrop') ||
            e.target.classList.contains('media-lightbox-close')
        ) {
            closeLightbox();
            return;
        }
        if (e.target.id === 'mediaLightboxDelete') {
            const url = lightboxUrl;
            deleteFile(url).then((ok) => {
                if (ok) closeLightbox();
            });
            return;
        }
        if (e.target.id === 'lbPrev') {
            lbNavigate(-1);
            return;
        }
        if (e.target.id === 'lbNext') {
            lbNavigate(1);
            return;
        }
        if (e.target.id === 'lbAutoplay') {
            lbAutoplay = !lbAutoplay;
            e.target.classList.toggle('active', lbAutoplay);
            return;
        }
        if (e.target.id === 'lbLoop') {
            lbLoop = !lbLoop;
            e.target.classList.toggle('active', lbLoop);
            const vid = document.querySelector('#mediaLightboxContent video');
            if (vid) vid.loop = lbLoop;
            return;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!document.getElementById('mediaLightbox').hidden) {
            if (e.key === 'Escape') {
                closeLightbox();
                return;
            }
            if (e.key === 'ArrowRight') {
                lbNavigate(1);
                return;
            }
            if (e.key === 'ArrowLeft') {
                lbNavigate(-1);
                return;
            }
        }
    });

    document.getElementById('indexFacesBtn').addEventListener('click', startIndexing);

    document.getElementById('mergeCancelBtn').addEventListener('click', () => {
        mergeSourceId = null;
        renderPeople();
    });

    document.getElementById('peopleGrid').addEventListener('click', async (e) => {
        // Delete person
        const deleteBtn = e.target.closest('.person-delete-btn');
        if (deleteBtn) {
            e.stopPropagation();
            const id = deleteBtn.dataset.personId;
            if (!confirm('Remove this person and their face data?')) return;
            await api.delete(`/api/media/persons/${id}`).catch(() => {});
            allPersons = allPersons.filter((p) => p.id !== id);
            if (activePerson === id) activePerson = null;
            if (mergeSourceId === id) mergeSourceId = null;
            renderPeople();
            renderGrid();
            return;
        }

        // Initiate merge
        const mergeBtn = e.target.closest('.person-merge-btn');
        if (mergeBtn) {
            e.stopPropagation();
            mergeSourceId = mergeBtn.dataset.personId;
            renderPeople();
            return;
        }

        // Complete merge
        const mergeIntoBtn = e.target.closest('.person-merge-into-btn');
        if (mergeIntoBtn) {
            e.stopPropagation();
            const targetId = mergeIntoBtn.dataset.personId;
            await api
                .patch(`/api/media/persons/${mergeSourceId}`, { mergeInto: targetId })
                .catch(() => {});
            mergeSourceId = null;
            await loadPersons();
            renderGrid();
            return;
        }

        // Open/close link-contact picker
        const linkBtn = e.target.closest('.person-link-btn');
        if (linkBtn) {
            e.stopPropagation();
            const id = linkBtn.dataset.personId;
            if (linkPickerOpenId === id) {
                linkPickerOpenId = null;
                renderPeople();
                return;
            }
            // Fetch chats first, then open
            await fetchChatList();
            linkPickerOpenId = id;
            renderPeople();
            return;
        }

        // Close picker if clicking outside
        if (!e.target.closest('.person-link-picker')) {
            if (linkPickerOpenId) {
                linkPickerOpenId = null;
                renderPeople();
                return;
            }
        }

        // Filter by person
        const card = e.target.closest('.person-card');
        if (!card || mergeSourceId) return;
        const id = card.dataset.personId;
        activePerson = activePerson === id ? null : id;
        renderPeople();
        renderGrid();
    });

    document.getElementById('peopleGrid').addEventListener('change', async (e) => {
        const select = e.target.closest('.person-link-select');
        if (!select) return;
        const id = select.dataset.personId;
        const jid = select.value || null;
        try {
            await api.patch(`/api/media/persons/${id}`, { jid });
            const p = allPersons.find((x) => x.id === id);
            if (p) p.jid = jid;
        } catch (err) {
            toast.error(`Link failed: ${err.response?.data?.error || err.message}`);
        }
        linkPickerOpenId = null;
        renderPeople();
    });

    document.getElementById('peopleGrid').addEventListener('dblclick', (e) => {
        const nameEl = e.target.closest('.person-name');
        if (!nameEl) return;
        nameEl.contentEditable = 'true';
        nameEl.focus();
        const range = document.createRange();
        range.selectNodeContents(nameEl);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
    });

    document.getElementById('peopleGrid').addEventListener('keydown', async (e) => {
        const nameEl = e.target.closest('.person-name[contenteditable="true"]');
        if (!nameEl) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            nameEl.contentEditable = 'false';
            const id = nameEl.dataset.personId;
            const name = nameEl.textContent.trim();
            if (name) {
                await api.patch(`/api/media/persons/${id}`, { name }).catch(() => {});
                const p = allPersons.find((x) => x.id === id);
                if (p) p.name = name;
            } else {
                const p = allPersons.find((x) => x.id === id);
                if (p) nameEl.textContent = p.name;
            }
        }
        if (e.key === 'Escape') {
            nameEl.contentEditable = 'false';
            const p = allPersons.find((x) => x.id === nameEl.dataset.personId);
            if (p) nameEl.textContent = p.name;
        }
    });

    document.querySelectorAll('.rail-btn[data-view="media"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (allFiles.length === 0) loadMedia();
        });
    });

    document.getElementById('scanDuplicatesBtn').addEventListener('click', scanDuplicates);

    document.getElementById('duplicatesGrid').addEventListener('click', (e) => {
        const keepBtn = e.target.closest('.duplicate-keep-btn');
        if (!keepBtn) return;
        keepFirstDeleteRest(Number(keepBtn.dataset.groupIdx));
    });
}
