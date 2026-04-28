'use strict';

// Local LID<->phone mapping fallback for official @whiskeysockets/baileys builds
// where lib/Utils/lid-mapping is not exposed.
const _lidToPn = new Map();
const _pnToLid = new Map();

function normalizeLid(lid) {
    if (!lid || typeof lid !== 'string') return null;
    if (lid.includes('@lid')) return lid.split(':')[0] + '@lid';
    const bare = lid.split(':')[0].split('@')[0];
    return bare ? `${bare}@lid` : null;
}

function normalizePn(pn) {
    if (!pn || typeof pn !== 'string') return null;
    if (pn.includes('@')) return pn.replace(/:\d+@/, '@');
    const digits = pn.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : null;
}

const globalLidMapping = {
    set(lid, pn) {
        const nl = normalizeLid(lid);
        const np = normalizePn(pn);
        if (!nl || !np) return;
        _lidToPn.set(nl, np);
        _pnToLid.set(np, nl);
    },
    getPnFromLid(lid) {
        const nl = normalizeLid(lid);
        return nl ? _lidToPn.get(nl) || null : null;
    },
    getLidFromPn(pn) {
        const np = normalizePn(pn);
        return np ? _pnToLid.get(np) || null : null;
    },
    size() {
        return _lidToPn.size;
    },
};

module.exports = { globalLidMapping };
