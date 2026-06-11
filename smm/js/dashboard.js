import { state } from './state.js';
import * as api from './api.js';
import { escapeHtml, toTitleCase } from './utils.js';

const OWNER = 'buluma';
const REPO = 'messageforge';

export function mountDashboard() {
    refreshAll();
    setInterval(() => {
        if (document.hidden) return;
        const dashboardView = document.getElementById('view-dashboard');
        if (!dashboardView?.classList.contains('active')) return;
        refreshAll();
    }, 60 * 1000);

    document.querySelectorAll('.pill[data-filter]').forEach((btn) => {
        btn.onclick = () => {
            document
                .querySelectorAll('.pill[data-filter]')
                .forEach((p) => p.classList.toggle('active', p === btn));
            state.pluginFilter = btn.dataset.filter;
            renderPlugins();
        };
    });

    const pluginSearch = document.getElementById('pluginSearch');
    if (pluginSearch) {
        pluginSearch.oninput = () => {
            state.pluginQuery = pluginSearch.value.trim().toLowerCase();
            renderPlugins();
        };
    }

    const reloadBtn = document.getElementById('reloadPluginsBtn');
    if (reloadBtn) {
        reloadBtn.onclick = async () => {
            reloadBtn.disabled = true;
            reloadBtn.textContent = '…';
            try {
                await api.reloadPlugins();
                await fetchAndRenderPlugins();
                reloadBtn.textContent = '✓ Reloaded';
                setTimeout(() => {
                    reloadBtn.textContent = '↻ Reload';
                    reloadBtn.disabled = false;
                }, 2000);
            } catch {
                reloadBtn.textContent = '↻ Reload';
                reloadBtn.disabled = false;
            }
        };
    }
}

async function refreshAll() {
    await Promise.allSettled([
        fetchRepoInfo(),
        fetchDeveloper(),
        fetchAndRenderPlugins(),
        fetchAndRenderChart(),
        fetchAndRenderHealth(),
    ]);
    document.getElementById('lastUpdated').textContent =
        `Updated ${new Date().toLocaleTimeString()}`;
}

async function fetchAndRenderHealth() {
    try {
        const health = await api.opsHealth();
        const ok = health.status === 'ok' && health.bot?.socketReady;
        setText('opsHealthStatus', ok ? 'Healthy' : 'Degraded');
        setText('opsBotState', health.bot?.socketReady ? 'Socket ready' : 'Socket offline');
        setText('opsUptime', formatDuration(health.uptimeSeconds || 0));
        setText('opsMemory', formatBytes(health.memory?.rss || 0));
        setText(
            'opsStorage',
            `data ${formatBytes(health.storage?.dataBytes || 0)} · logs ${formatBytes(health.storage?.logsBytes || 0)}`,
        );
        setText(
            'opsTelegram',
            health.integrations?.telegramAutoSend
                ? health.integrations.telegramConfigured
                    ? 'Auto-send on'
                    : 'Auto-send missing config'
                : 'Auto-send off',
        );
        setText('opsPlugins', health.counts?.plugins);
    } catch {
        setText('opsHealthStatus', 'Unavailable');
    }
}

// ── Repo stats ───────────────────────────────────────────────────
async function fetchRepoInfo() {
    try {
        const d = await api.ghRepo(OWNER, REPO);
        setText('starsCount', d.stargazers_count);
        setText('forksCount', d.forks_count);
        setText('issuesCount', d.open_issues_count);
    } catch (e) {
        console.error('repo fetch failed', e);
    }
}

async function fetchDeveloper() {
    try {
        const d = await api.ghUser(OWNER);
        const av = document.getElementById('devAvatar');
        if (av) {
            av.style.backgroundImage = `url(${d.avatar_url})`;
            av.textContent = '';
        }
        setText('devName', d.name || d.login);
        setText('devBio', d.bio || 'Developer');
        setText('devFollowers', `Followers: ${d.followers}`);
        setText('devRepos', `Repos: ${d.public_repos}`);
    } catch (e) {
        console.error('dev fetch failed', e);
    }
}

// ── Plugins ──────────────────────────────────────────────────────
async function fetchAndRenderPlugins() {
    try {
        state.allPlugins = (await api.fetchPlugins()) || [];
        setText('pluginsCount', state.allPlugins.length);
        document.getElementById('pluginsLoading').style.display = 'none';
        renderPlugins();
    } catch (e) {
        console.error('plugins fetch failed', e);
    }
}

function renderPlugins() {
    const grid = document.getElementById('pluginsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const q = (state.pluginQuery || '').toLowerCase();
    const filtered = state.allPlugins.filter((p) => {
        if (state.pluginFilter !== 'all' && p.permission !== state.pluginFilter) return false;
        if (!q) return true;
        const name = toTitleCase(p.name || (p.commands || [])[0] || '').toLowerCase();
        const desc = (p.description || '').toLowerCase();
        const cmds = (p.commands || []).join(' ').toLowerCase();
        return name.includes(q) || desc.includes(q) || cmds.includes(q);
    });
    for (const p of filtered) {
        const card = document.createElement('div');
        card.className = 'plugin-card';
        const cmd = (p.commands || [])[0] || 'unknown';
        const perm = p.permission || 'public';
        card.innerHTML = `
      <div class="plugin-name">${escapeHtml(toTitleCase(p.name || cmd))}</div>
      <div class="plugin-desc">${escapeHtml(p.description || 'No description')}</div>
      <div class="plugin-cmd">.${escapeHtml(cmd)}</div>
      <span class="plugin-perm ${perm}">${escapeHtml(perm)}</span>`;
        grid.appendChild(card);
    }
}

// ── Chart ────────────────────────────────────────────────────────
async function fetchAndRenderChart() {
    try {
        const { githubSeries, localSeries, lastGithubCommitAt, lastLocalCommitAt } =
            await fetchCommitSeries();
        renderCommitChart(githubSeries, localSeries);
        const stamps = [lastGithubCommitAt, lastLocalCommitAt].filter(Boolean).sort();
        const lastAny = stamps.length ? stamps[stamps.length - 1] : null;
        const parts = ['Live'];
        if (lastAny) parts.push(`Last commit ${moment(lastAny).fromNow()}`);
        document.getElementById('chartStatus').textContent = parts.join(' • ');
    } catch (e) {
        document.getElementById('chartStatus').textContent = 'Chart unavailable';
    }
}

async function fetchCommitSeries(weeks = 12) {
    const now = moment();
    const weekStart = now.clone().startOf('isoWeek');
    const weekLabel = weekStart.format('MMM D');

    let githubSeries = null;
    let lastGithubCommitAt = null;
    let lastLocalCommitAt = null;

    try {
        const data = await api.ghCommitActivity(OWNER, REPO);
        if (Array.isArray(data) && data.length > 0) {
            githubSeries = data.slice(-weeks).map((w) => ({
                week: moment.unix(w.week).format('MMM D'),
                total: w.total,
            }));
        }
    } catch {}

    if (!githubSeries) {
        // Fallback: count from commits endpoint
        const commits = await api.ghCommits(OWNER, REPO, 100);
        const buckets = Array.from({ length: weeks }, (_, i) => ({
            week: now.clone().subtract(i, 'weeks').startOf('isoWeek').format('MMM D'),
            total: 0,
        })).reverse();
        for (const c of commits || []) {
            const date = moment(c.commit?.author?.date);
            if (!lastGithubCommitAt || date.isAfter(lastGithubCommitAt)) {
                lastGithubCommitAt = date.toISOString();
            }
            const idx = buckets.findIndex((w) => date.isSame(moment(w.week, 'MMM D'), 'isoWeek'));
            if (idx !== -1) buckets[idx].total++;
        }
        githubSeries = buckets;
    }

    // GitHub stats only cover complete weeks — patch/append the current partial week.
    try {
        const recentCommits = await api.ghCommits(OWNER, REPO, 100, weekStart.toISOString());
        const currentCount = (recentCommits || []).length;
        for (const c of recentCommits || []) {
            const d = c?.commit?.author?.date;
            if (d && (!lastGithubCommitAt || moment(d).isAfter(lastGithubCommitAt))) {
                lastGithubCommitAt = d;
            }
        }
        const last = githubSeries[githubSeries.length - 1];
        if (last && last.week === weekLabel) {
            last.total = currentCount;
        } else {
            githubSeries = [
                ...githubSeries.slice(-(weeks - 1)),
                { week: weekLabel, total: currentCount },
            ];
        }
    } catch {}

    const localBuckets = Array.from({ length: weeks }, (_, i) => ({
        week: now.clone().subtract(i, 'weeks').startOf('isoWeek').format('MMM D'),
        total: 0,
    })).reverse();

    try {
        const local = await api.localCommitActivity(weeks);
        for (const iso of local?.commits || []) {
            const date = moment(iso);
            if (!date.isValid()) continue;
            if (!lastLocalCommitAt || date.isAfter(lastLocalCommitAt)) {
                lastLocalCommitAt = date.toISOString();
            }
            const idx = localBuckets.findIndex((w) =>
                date.isSame(moment(w.week, 'MMM D'), 'isoWeek'),
            );
            if (idx !== -1) localBuckets[idx].total++;
        }
    } catch {}

    return { githubSeries, localSeries: localBuckets, lastGithubCommitAt, lastLocalCommitAt };
}

function renderCommitChart(githubSeries, localSeries) {
    const canvas = document.getElementById('commitsChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (state.commitsChart) state.commitsChart.destroy();

    const primary =
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() ||
        '#6366f1';

    state.commitsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: githubSeries.map((s) => s.week),
            datasets: [
                {
                    label: 'GitHub',
                    data: githubSeries.map((s) => s.total),
                    borderColor: primary,
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 3,
                    pointBackgroundColor: primary,
                },
                {
                    label: 'Local',
                    data: localSeries.map((s) => s.total),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16,185,129,0.06)',
                    fill: false,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 2,
                    pointBackgroundColor: '#10b981',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', boxWidth: 10, usePointStyle: true },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                },
            },
        },
    });
}

// ── tiny helper ──────────────────────────────────────────────────
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins = Math.floor((total % 3600) / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${mins}m`;
    return `${mins}m`;
}
