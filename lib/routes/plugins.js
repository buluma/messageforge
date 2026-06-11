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
            const { plugins: handlerPlugins, PLUGIN_CATEGORIES } = require('../../handler');
            const seen = new Set();
            const result = [];
            for (const p of handlerPlugins) {
                const key = (p.commands || []).join(',');
                if (seen.has(key)) continue;
                seen.add(key);
                const cat = p.category && PLUGIN_CATEGORIES[p.category] ? p.category : null;
                result.push({
                    name: (p.commands || [])[0] || 'unknown',
                    commands: p.commands || [],
                    description: p.description || '',
                    permission: p.permission || 'public',
                    group: p.group !== false,
                    private: p.private !== false,
                    category: cat,
                    tags: Array.isArray(p.tags) ? p.tags : [],
                    hidden: p.hidden === true,
                    file: p.__pluginFile || null,
                });
            }

            // Optional: filter by category query param
            const { category } = req.query;
            if (category) {
                res.json(result.filter((p) => p.category === category || (!p.category && category === 'uncategorized')));
            } else {
                res.json(result);
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};
