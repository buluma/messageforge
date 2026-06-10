'use strict';

const express = require('express');

function createFaceRoutes({
    mediaDataDir,
    scanMediaDir,
    mediaExts,
    facesDir,
    facesBuildIndex,
    facesStatus,
    getPersons,
    getFaceCoverage,
    renamePerson,
    mergePerson,
    deletePerson,
    linkPersonJid,
} = {}) {
    if (!mediaDataDir) throw new Error('createFaceRoutes: mediaDataDir required');
    if (typeof scanMediaDir !== 'function')
        throw new Error('createFaceRoutes: scanMediaDir required');
    if (!mediaExts) throw new Error('createFaceRoutes: mediaExts required');
    if (typeof facesBuildIndex !== 'function')
        throw new Error('createFaceRoutes: facesBuildIndex required');
    if (typeof facesStatus !== 'function')
        throw new Error('createFaceRoutes: facesStatus required');
    if (typeof getPersons !== 'function') throw new Error('createFaceRoutes: getPersons required');
    if (typeof getFaceCoverage !== 'function')
        throw new Error('createFaceRoutes: getFaceCoverage required');
    if (typeof renamePerson !== 'function')
        throw new Error('createFaceRoutes: renamePerson required');
    if (typeof mergePerson !== 'function')
        throw new Error('createFaceRoutes: mergePerson required');
    if (typeof deletePerson !== 'function')
        throw new Error('createFaceRoutes: deletePerson required');
    if (typeof linkPersonJid !== 'function')
        throw new Error('createFaceRoutes: linkPersonJid required');

    const router = express.Router();

    if (facesDir) {
        router.use('/face', express.static(facesDir));
    }

    router.get('/persons', (req, res) => {
        try {
            res.json({ persons: getPersons() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/face-coverage', (req, res) => {
        try {
            res.json(getFaceCoverage());
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/index-status', (req, res) => {
        res.json(facesStatus());
    });

    router.post('/index-faces', (req, res) => {
        const files = [];
        scanMediaDir(mediaDataDir, mediaDataDir, files);
        facesBuildIndex(files).catch(() => {});
        res.json({ started: true, total: files.length });
    });

    router.patch('/persons/:id', (req, res) => {
        const { name, mergeInto, jid } = req.body;
        if (mergeInto) {
            const ok = mergePerson(req.params.id, mergeInto);
            if (!ok) return res.status(404).json({ error: 'Person not found' });
            return res.json({ success: true });
        }
        if (jid !== undefined) {
            const ok = linkPersonJid(req.params.id, jid || null);
            if (!ok) return res.status(404).json({ error: 'Person not found' });
            return res.json({ success: true });
        }
        if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
        const ok = renamePerson(req.params.id, name.trim());
        if (!ok) return res.status(404).json({ error: 'Person not found' });
        res.json({ success: true });
    });

    router.delete('/persons/:id', (req, res) => {
        const ok = deletePerson(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Person not found' });
        res.json({ success: true });
    });

    // Note: mediaExts is currently only needed by callers; we keep it in the signature
    // so future face endpoints can use it without reaching into other modules.
    void mediaExts;

    return router;
}

module.exports = {
    createFaceRoutes,
};
