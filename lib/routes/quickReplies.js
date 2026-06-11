const path = require('path');
const fs = require('fs');

module.exports = function quickRepliesRoutes(app) {
    // ── Quick-reply templates ─────────────────────────────────────────────────────

    const QUICK_REPLIES_FILE = path.join(__dirname, 'data', 'quick-replies.json');

    function readQuickReplies() {
        try {
            if (!fs.existsSync(QUICK_REPLIES_FILE)) return [];
            const raw = JSON.parse(fs.readFileSync(QUICK_REPLIES_FILE, 'utf8'));
            return Array.isArray(raw) ? raw : [];
        } catch {
            return [];
        }
    }

    function writeQuickReplies(templates) {
        const dir = path.dirname(QUICK_REPLIES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(QUICK_REPLIES_FILE, JSON.stringify(templates, null, 2));
    }

    app.get('/api/quick-replies', (req, res) => {
        res.json(readQuickReplies());
    });

    app.post('/api/quick-replies', (req, res) => {
        const label = String(req.body?.label || '').trim();
        const text = String(req.body?.text || '').trim();
        if (!label || !text) return res.status(400).json({ error: 'label and text are required' });

        const templates = readQuickReplies();
        const id = Date.now().toString(36);
        templates.push({ id, label, text });
        writeQuickReplies(templates);
        res.json({ id, label, text });
    });

    app.delete('/api/quick-replies/:id', (req, res) => {
        const { id } = req.params;
        const templates = readQuickReplies();
        const next = templates.filter((t) => t.id !== id);
        if (next.length === templates.length) {
            return res.status(404).json({ error: 'Template not found' });
        }
        writeQuickReplies(next);
        res.json({ success: true });
    });

    app.put('/api/quick-replies', (req, res) => {
        const templates = req.body;
        if (!Array.isArray(templates)) return res.status(400).json({ error: 'Array required' });
        const valid = templates.filter((t) => t && typeof t.id === 'string' && t.label && t.text);
        writeQuickReplies(valid);
        res.json(valid);
    });
};
