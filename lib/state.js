'use strict';

const db = require('./dbManager');
const logger = require('./logger');

/**
 * Manages the bot's global in-memory state and handles periodic/manual persistence.
 */
class StateManager {
    constructor() {
        this.saving = false;
        this.collections = [
            { name: 'sudo', globalKey: 'sudoUsers', type: 'set' },
            { name: 'banned', globalKey: 'bannedUsers', type: 'set' },
            { name: 'antilink_groups', globalKey: 'antilinkGroups', type: 'set' },
            { name: 'antibad_groups', globalKey: 'antibadGroups', type: 'set' },
            { name: 'antidemote_gps', globalKey: 'antiDemoteGroups', type: 'set' },
            { name: 'auto_reply_sch', globalKey: 'autoReplySchedules', type: 'obj' },
        ];
    }

    /**
     * Initializes global state from DB/JSON storage.
     */
    async init() {
        logger.custom('StateManager', 'Initializing state...');
        for (const col of this.collections) {
            let data = await db.get(col.name, col.type === 'set' ? [] : {});

            // ✅ P3: lib/state.js:27 — type-validate loaded data; default [] if not array (for sets)
            if (col.type === 'set') {
                if (!Array.isArray(data)) {
                    logger.warn(
                        `[StateManager] Collection "${col.name}" expected Array, got ${typeof data}. Defaulting to [].`,
                    );
                    data = [];
                }
                global[col.globalKey] = new Set(data);
            } else {
                if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                    logger.warn(
                        `[StateManager] Collection "${col.name}" expected Object, got ${typeof data}. Defaulting to {}.`,
                    );
                    data = {};
                }
                global[col.globalKey] = data;
            }
        }
        logger.custom('StateManager', 'State initialized successfully.');
    }

    /**
     * Persists current in-memory global state back to DB/JSON.
     */
    async save() {
        // ✅ P3: lib/state.js:56 — saving flag mutex around autosave
        if (this.saving) return;
        this.saving = true;

        try {
            for (const col of this.collections) {
                const current = global[col.globalKey];
                if (!current) continue;

                const dataToSave = col.type === 'set' ? [...current] : current;
                await db.set(col.name, dataToSave);
            }
            logger.custom('StateManager', 'Global state persisted.');
        } catch (err) {
            logger.error(`[StateManager] Save failed: ${err.message}`);
        } finally {
            this.saving = false;
        }
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
