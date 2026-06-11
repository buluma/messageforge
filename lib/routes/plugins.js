module.exports = function pluginsRoutes(app) {
    app.get('/api/plugins/reload', (req, res) => {
        try {
            const { reloadAllPlugins } = require('../../handler');
            reloadAllPlugins();
            res.json({ success: true, message: 'All plugins reloaded' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/plugins', (req, res) => {
        try {
            const { plugins: handlerPlugins } = require('../../handler');
            const seen = new Set();
            const result = [];
            for (const p of handlerPlugins) {
                const key = (p.commands || []).join(',');
                if (seen.has(key)) continue;
                seen.add(key);
                result.push({
                    name: (p.commands || [])[0] || 'unknown',
                    commands: p.commands || [],
                    description: p.description || '',
                    permission: p.permission || 'public',
                    group: p.group !== false,
                    private: p.private !== false,
                });
            }
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};
