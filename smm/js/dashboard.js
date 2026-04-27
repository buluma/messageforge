import { state } from './state.js';
import * as api from './api.js';
import { escapeHtml, toTitleCase } from './utils.js';

const OWNER = 'buluma';
const REPO = 'messageforge';

export function mountDashboard() {
    refreshAll();
    setInterval(refreshAll, 5 * 60 * 1000);

    document.querySelectorAll('.pill[data-filter]').forEach((btn) => {
        btn.onclick = () => {
            document
                .querySelectorAll('.pill[data-filter]')
                .forEach((p) => p.classList.toggle('active', p === btn));
            state.pluginFilter = btn.dataset.filter;
            renderPlugins();
        };
    });
}

async function refreshAll() {
    await Promise.allSettled([
        fetchRepoInfo(),
        fetchDeveloper(),
        fetchAndRenderPlugins(),
        fetchAndRenderChart(),
    ]);
    document.getElementById('lastUpdated').textContent =
        `Updated ${new Date().toLocaleTimeString()}`;
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
    const filtered = state.allPlugins.filter(
        (p) => state.pluginFilter === 'all' || p.permission === state.pluginFilter,
    );
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
        const series = await fetchCommitSeries();
        renderCommitChart(series);
    } catch (e) {
        document.getElementById('chartStatus').textContent = 'Chart unavailable';
    }
}

async function fetchCommitSeries(weeks = 12) {
    const now = moment();
    const weekStart = now.clone().startOf('isoWeek');
    const weekLabel = weekStart.format('MMM D');

    let series = null;

    try {
        const data = await api.ghCommitActivity(OWNER, REPO);
        if (Array.isArray(data) && data.length > 0) {
            series = data.slice(-weeks).map((w) => ({
                week: moment.unix(w.week).format('MMM D'),
                total: w.total,
            }));
        }
    } catch {}

    if (!series) {
        // Fallback: count from commits endpoint
        const commits = await api.ghCommits(OWNER, REPO, 100);
        const buckets = Array.from({ length: weeks }, (_, i) => ({
            week: now.clone().subtract(i, 'weeks').startOf('isoWeek').format('MMM D'),
            total: 0,
        })).reverse();
        for (const c of commits || []) {
            const date = moment(c.commit?.author?.date);
            const idx = buckets.findIndex((w) => date.isSame(moment(w.week, 'MMM D'), 'isoWeek'));
            if (idx !== -1) buckets[idx].total++;
        }
        series = buckets;
    }

    // GitHub stats only cover complete weeks — patch/append the current partial week.
    try {
        const recentCommits = await api.ghCommits(OWNER, REPO, 100, weekStart.toISOString());
        const currentCount = (recentCommits || []).length;
        const last = series[series.length - 1];
        if (last && last.week === weekLabel) {
            last.total = currentCount;
        } else {
            series = [...series.slice(-(weeks - 1)), { week: weekLabel, total: currentCount }];
        }
    } catch {}

    return series;
}

function renderCommitChart(series) {
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
            labels: series.map((s) => s.week),
            datasets: [
                {
                    label: 'Commits',
                    data: series.map((s) => s.total),
                    borderColor: primary,
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 3,
                    pointBackgroundColor: primary,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
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
    document.getElementById('chartStatus').textContent = 'Live';
}

// ── tiny helper ──────────────────────────────────────────────────
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
}
