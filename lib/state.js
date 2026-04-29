'use strict';

const db = require('./dbManager');
const logger = require('./logger');

/**
 * Manages the bot's global in-memory state and handles periodic/manual persistence.
 */
class StateManager {
    constructor() {
        this.collections = [
            { name: 'sudo',            globalKey: 'sudoUsers',        type: 'set' },
            { name: 'banned',          globalKey: 'bannedUsers',      type: 'set' },
            { name: 'antilink_groups', globalKey: 'antilinkGroups',   type: 'set' },
            { name: 'antibad_groups',  globalKey: 'antibadGroups',    type: 'set' },
            { name: 'antidemote_gps',  globalKey: 'antiDemoteGroups', type: 'set' },
            { name: 'auto_reply_sch',  globalKey: 'autoReplySchedules', type: 'obj' },
        ];
    }

    /**
     * Initializes global state from DB/JSON storage.
     */
    async init() {
        logger.custom('StateManager', 'Initializing state...');
        for (const col of this.collections) {
            const data = await db.get(col.name, col.type === 'set' ? [] : {});
            if (col.type === 'set') {
                global[col.globalKey] = new Set(Array.isArray(data) ? data : []);
            } else {
                global[col.globalKey] = data || {};
            }
        }
        logger.custom('StateManager', 'State initialized successfully.');
    }

    /**
     * Persists current in-memory global state back to DB/JSON.
     */
    async save() {
        for (const col of this.collections) {
            const current = global[col.globalKey];
            if (!current) continue;

            const dataToSave = col.type === 'set' ? [...current] : current;
            await db.set(col.name, dataToSave);
        }
        logger.custom('StateManager', 'Global state persisted.');
    }

    /**
     * Starts a periodic auto-save timer.
     * @param {number} intervalMs - Auto-save frequency (default: 5 mins).
     */
    startAutoSave(intervalMs = 5 * 60 * 1000) {
        setInterval(() => this.save(), intervalMs);
    }
}

module.exports = new StateManager();
