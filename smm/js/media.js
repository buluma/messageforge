'use strict';

import api from './api.js';
import { toast } from './utils.js';

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
let totalMediaBytes = 0;
let activeType = 'all';
let searchTerm = '';
let activePerson = null;
let sortKey = 'date-desc';
let mergeSourceId = null;
// JID of the person whose link picker is currently open (null = closed)
let linkPickerOpenId = null;
// Cached non-group chat list for the JID picker
let chatList = null;

function sorted(files) {
    const arr = [...files];
    switch (sortKey) {
        case 'date-desc': return arr.sort((a, b) => b.mtime - a.mtime);
        case 'date-asc':  return arr.sort((a, b) => a.mtime - b.mtime);
        case 'size-desc': return arr.sort((a, b) => b.size - a.size);
        case 'size-asc':  return arr.sort((a, b) => a.size - b.size);
        case 'name-asc':  return arr.sort((a, b) => a.name.localeCompare(b.name));
        case 'name-desc': return arr.sort((a, b) => b.name.localeCompare(a.name));
        default: return arr;
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

function renderGrid() {
    const grid = document.getElementById('mediaGrid');
    const files = filtered();
    const countLabel = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    const sizeLabel = totalMediaBytes > 0 ? ` · ${formatBytes(totalMediaBytes)}` : '';
    document.getElementById('mediaCount').textContent = countLabel + sizeLabel;

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
        toast.error(`Delete failed: ${err.response?.data?.error || err.message}`);
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
    wrap.hidden = false;
    if (allPersons.length === 0) {
        grid.innerHTML = '';
        return;
    }

    grid.innerHTML = allPersons.map((p) => {
        const linkedName = p.jid
            ? (chatList?.find((c) => c.jid === p.jid)?.name || p.jid.split('@')[0])
            : null;
        return `
        <div class="person-card ${activePerson === p.id ? 'active' : ''} ${mergeSourceId === p.id ? 'merge-source' : ''}"
             data-person-id="${p.id}">
            <button class="person-delete-btn" data-person-id="${p.id}" title="Remove person">✕</button>
            <div class="person-avatar">
                ${p.faceUrl
                    ? `<img src="${p.faceUrl}" alt="${p.name}" class="person-face-img" />`
                    : `<span>👤</span>`}
            </div>
            <div class="person-name" contenteditable="false" data-person-id="${p.id}">${p.name}</div>
            ${linkedName ? `<div class="person-jid-label" title="${p.jid}">@${linkedName}</div>` : ''}
            <div class="person-count">${p.count} file${p.count !== 1 ? 's' : ''}</div>
            ${mergeSourceId && mergeSourceId !== p.id
                ? `<button class="person-merge-into-btn" data-person-id="${p.id}" title="Merge into this person">← Merge here</button>`
                : ''}
            ${!mergeSourceId
                ? `<button class="person-merge-btn" data-person-id="${p.id}" title="Merge this person into another">⇄ Merge</button>`
                : ''}
            ${!mergeSourceId
                ? `<button class="person-link-btn" data-person-id="${p.id}" title="Link to WhatsApp contact">⇗ Link contact</button>`
                : ''}
            ${linkPickerOpenId === p.id ? `
            <div class="person-link-picker" data-person-id="${p.id}">
                <select class="person-link-select" data-person-id="${p.id}">
                    <option value="">— select contact —</option>
                    ${(chatList || []).map((c) => `<option value="${c.jid}" ${p.jid === c.jid ? 'selected' : ''}>${c.name || c.jid.split('@')[0]}</option>`).join('')}
                </select>
            </div>` : ''}
        </div>
    `;
    }).join('');

    const cancelBtn = document.getElementById('mergeCancelBtn');
    if (cancelBtn) cancelBtn.hidden = !mergeSourceId;
}

async function loadPersons() {
    try {
        const data = await api.get('/api/media/persons').then((r) => r.data);
        allPersons = data.persons || [];
        renderPeople();
    } catch { /* silent */ }
}

async function fetchChatList() {
    if (chatList) return chatList;
    try {
        const data = await api.get('/api/chats').then((r) => r.data);
        const chats = (data.chats || data || []);
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
            type: file.type.startsWith('video') ? 'video'
                : file.type.startsWith('audio') ? 'audio' : 'image',
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
        totalMediaBytes = mediaData.totalBytes || 0;
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

    document.getElementById('mediaSort').addEventListener('change', (e) => {
        sortKey = e.target.value;
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
            await api.patch(`/api/media/persons/${mergeSourceId}`, { mergeInto: targetId }).catch(() => {});
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
}
