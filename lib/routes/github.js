const axios = require('axios');
const { execFile } = require('child_process');

module.exports = function githubRoutes(app) {
    const GH_TOKEN = process.env.GITHUB_TOKEN || '';
    const ghHeaders = GH_TOKEN ? { Authorization: `token ${GH_TOKEN}` } : {};

    async function ghProxy(res, url, params = {}) {
        try {
            const r = await axios.get(url, {
                headers: { ...ghHeaders, 'User-Agent': 'messageforge' },
                params,
                timeout: 15000,
            });
            const forward = ['x-ratelimit-remaining', 'x-ratelimit-reset', 'link'];
            for (const h of forward) {
                if (r.headers[h]) res.set(h, r.headers[h]);
            }
            res.json(r.data);
        } catch (err) {
            const status = err.response?.status || 502;
            res.status(status).json({ error: err.message });
        }
    }

    app.get('/gh/repo', (req, res) =>
        ghProxy(res, `https://api.github.com/repos/${req.query.owner}/${req.query.repo}`),
    );
    app.get('/gh/contents', (req, res) =>
        ghProxy(
            res,
            `https://api.github.com/repos/${req.query.owner}/${req.query.repo}/contents/${req.query.path || ''}`,
        ),
    );
    app.get('/gh/user', (req, res) =>
        ghProxy(res, `https://api.github.com/users/${req.query.login}`),
    );
    app.get('/gh/commits', (req, res) =>
        ghProxy(res, `https://api.github.com/repos/${req.query.owner}/${req.query.repo}/commits`, {
            since: req.query.since,
            until: req.query.until,
            per_page: req.query.per_page || 1,
        }),
    );
    app.get('/gh/commit-activity', (req, res) =>
        ghProxy(
            res,
            `https://api.github.com/repos/${req.query.owner}/${req.query.repo}/stats/commit_activity`,
        ),
    );

    app.get('/api/local-commit-activity', (req, res) => {
        const weeksRaw = Number(req.query.weeks || 12);
        const weeks = Number.isFinite(weeksRaw) ? Math.min(Math.max(weeksRaw, 1), 52) : 12;
        const sinceDate = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
        const sinceIso = sinceDate.toISOString();

        execFile(
            'git',
            ['log', '--since', sinceIso, '--pretty=format:%cI'],
            { cwd: __dirname, timeout: 12000 },
            (err, stdout) => {
                if (err)
                    return res.status(500).json({ error: 'Failed to read local git activity' });
                const lines = String(stdout || '')
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean);
                res.json({ commits: lines });
            },
        );
    });
};
