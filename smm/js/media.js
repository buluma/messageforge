'use strict';

import api from './api.js';

const ICON = { video: '🎬', image: '🖼️', audio: '🎵' };

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
}

function formatDate(ts) {
    return new Date(ts * 1000).toLocaleDateString();
}

let allFiles = [];
let allPersons = [];
let activeType = 'all';
let searchTerm = '';
let activePerson = null;

function filtered() {
    return allFiles.filter((f) => {
        if (activeType !== 'all' && f.type !== activeType) return false;
        if (searchTerm && !f.name.toLowerCase().includes(searchTerm)) return false;
        if (activePerson) {
            const p = allPersons.find((x) => x.id === activePerson);
            if (!p || !p.mediaUrls.includes(f.url)) return false;
        }
        return true;
    });
}

function renderGrid() {
    const grid = document.getElementById('mediaGrid');
    const files = filtered();
    document.getElementById('mediaCount').textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;

    if (files.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No media found.</div>';
        grid.hidden = false;
        return;
    }

    grid.innerHTML = files.map((f) => `
        <div class="media-card" data-url="${f.url}" data-type="${f.type}" data-name="${f.name}">
            <button class="media-delete-btn" data-url="${f.url}" title="Delete">🗑</button>
            ${f.type === 'image' || f.type === 'video'
                ? `<img class="media-thumb" src="/api/media/thumb?url=${encodeURIComponent(f.url)}" alt="${f.name}" loading="lazy" data-icon="${ICON[f.type] || '📄'}" />`
                : `<div class="media-thumb-placeholder">${ICON[f.type] || '📄'}</div>`
            }
            <div class="media-card-body">
                <div class="media-card-name" title="${f.name}">${f.name}</div>
                <div class="media-card-meta">
                    <span class="media-folder-tag">${f.folder === '.' ? 'root' : f.folder}</span>
                    <span>${formatBytes(f.size)}</span>
                </div>
                <div class="media-card-meta" style="margin-top:2px">
                    <span style="color:var(--text-dim)">${formatDate(f.mtime)}</span>
                </div>
            </div>
        </div>
    `).join('');

    grid.querySelectorAll('img.media-thumb[data-icon]').forEach((img) => {
        img.onerror = function () {
            const icon = this.dataset.icon || '📄';
            const placeholder = document.createElement('div');
            placeholder.className = 'media-thumb-placeholder';
            placeholder.textContent = icon;
            this.replaceWith(placeholder);
        };
    });

    grid.hidden = false;
}

async function deleteFile(url) {
    try {
        await api.delete('/api/media', { data: { url } });
        allFiles = allFiles.filter((f) => f.url !== url);
        renderGrid();
    } catch (err) {
        alert(`Delete failed: ${err.response?.data?.error || err.message}`);
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
    document.getElementById('lbCounter').textContent = isVideo && videos.length > 1
        ? `${idx + 1} / ${videos.length}`
        : '';
    document.getElementById('lbAutoplay').classList.toggle('active', lbAutoplay);
    document.getElementById('lbLoop').classList.toggle('active', lbLoop);

    const nameEl = document.getElementById('mediaLightboxName');
    const dlEl = document.getElementById('mediaLightboxDownload');
    nameEl.textContent = file.name;
    dlEl.href = file.url;
    dlEl.download = file.name;
}

function openLightbox(file) {
    const lb = document.getElementById('mediaLightbox');
    const content = document.getElementById('mediaLightboxContent');

    lightboxUrl = file.url;
    content.innerHTML = '';

    if (file.type === 'image') {
        content.innerHTML = `<img src="${file.url}" alt="${file.name}" />`;
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
        content.innerHTML = `<audio src="${file.url}" controls autoplay></audio>`;
    }

    lb.hidden = false;
    updateLbControls(file);
}

function closeLightbox() {
    const lb = document.getElementById('mediaLightbox');
    const content = document.getElementById('mediaLightboxContent');
    content.innerHTML = '';
    lightboxUrl = null;
    lb.hidden = true;
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
    if (allPersons.length === 0) { wrap.hidden = true; return; }
    wrap.hidden = false;

    grid.innerHTML = allPersons.map((p) => `
        <div class="person-card ${activePerson === p.id ? 'active' : ''}" data-person-id="${p.id}">
            <div class="person-avatar">
                ${p.faceUrl
                    ? `<img src="${p.faceUrl}" alt="${p.name}" class="person-face-img" />`
                    : `<span>👤</span>`}
            </div>
            <div class="person-name" contenteditable="false" data-person-id="${p.id}">${p.name}</div>
            <div class="person-count">${p.count} file${p.count !== 1 ? 's' : ''}</div>
        </div>
    `).join('');
}

async function loadPersons() {
    try {
        const data = await api.get('/api/media/persons').then((r) => r.data);
        allPersons = data.persons || [];
        renderPeople();
    } catch { /* silent */ }
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
                statusEl.textContent = `Scanning ${s.done}/${s.total}…`;
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
            api.get('/api/media/persons').then((r) => r.data).catch(() => ({ persons: [] })),
        ]);
        allFiles = mediaData.files || [];
        allPersons = personsData.persons || [];
        loading.hidden = true;
        renderGrid();
        renderPeople();
    } catch (err) {
        loading.textContent = `Failed to load media: ${err.message}`;
    }
}

export function mountMedia() {
    document.getElementById('mediaFilterPills').addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        activeType = pill.dataset.type;
        document.querySelectorAll('#mediaFilterPills .pill').forEach((p) =>
            p.classList.toggle('active', p === pill),
        );
        renderGrid();
    });

    document.getElementById('mediaSearch').addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        renderGrid();
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

    document.getElementById('mediaLightbox').addEventListener('click', (e) => {
        if (e.target.classList.contains('media-lightbox-backdrop') ||
            e.target.classList.contains('media-lightbox-close')) {
            closeLightbox();
            return;
        }
        if (e.target.id === 'mediaLightboxDelete') {
            const url = lightboxUrl;
            closeLightbox();
            deleteFile(url);
            return;
        }
        if (e.target.id === 'lbPrev') { lbNavigate(-1); return; }
        if (e.target.id === 'lbNext') { lbNavigate(1); return; }
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
            if (e.key === 'Escape') { closeLightbox(); return; }
            if (e.key === 'ArrowRight') { lbNavigate(1); return; }
            if (e.key === 'ArrowLeft') { lbNavigate(-1); return; }
        }
    });

    document.getElementById('indexFacesBtn').addEventListener('click', startIndexing);

    document.getElementById('peopleGrid').addEventListener('click', (e) => {
        const card = e.target.closest('.person-card');
        if (!card) return;
        const id = card.dataset.personId;
        activePerson = activePerson === id ? null : id;
        renderPeople();
        renderGrid();
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
}
