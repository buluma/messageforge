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
let activeType = 'all';
let searchTerm = '';

function filtered() {
    return allFiles.filter((f) => {
        if (activeType !== 'all' && f.type !== activeType) return false;
        if (searchTerm && !f.name.toLowerCase().includes(searchTerm)) return false;
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

function openLightbox(file) {
    const lb = document.getElementById('mediaLightbox');
    const content = document.getElementById('mediaLightboxContent');
    const nameEl = document.getElementById('mediaLightboxName');
    const dlEl = document.getElementById('mediaLightboxDownload');

    lightboxUrl = file.url;

    if (file.type === 'image') {
        content.innerHTML = `<img src="${file.url}" alt="${file.name}" />`;
    } else if (file.type === 'video') {
        content.innerHTML = `<video src="${file.url}" controls autoplay></video>`;
    } else if (file.type === 'audio') {
        content.innerHTML = `<audio src="${file.url}" controls autoplay></audio>`;
    }

    nameEl.textContent = file.name;
    dlEl.href = file.url;
    dlEl.download = file.name;
    lb.hidden = false;
}

function closeLightbox() {
    const lb = document.getElementById('mediaLightbox');
    const content = document.getElementById('mediaLightboxContent');
    content.innerHTML = '';
    lightboxUrl = null;
    lb.hidden = true;
}

async function loadMedia() {
    const loading = document.getElementById('mediaLoading');
    const grid = document.getElementById('mediaGrid');
    loading.textContent = 'Loading media…';
    loading.hidden = false;
    grid.hidden = true;

    try {
        const data = await api.get('/api/media').then((r) => r.data);
        allFiles = data.files || [];
        loading.hidden = true;
        renderGrid();
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
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    document.querySelectorAll('.rail-btn[data-view="media"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (allFiles.length === 0) loadMedia();
        });
    });
}
