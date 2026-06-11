'use strict';

/**
 * In-memory metrics counters for observability.
 *
 * All counters are monotonic (never reset) and safe to read/write from
 * any synchronous context.  Exported as a shared singleton.
 *
 * Counters
 * --------
 * - commandsExecuted       : total successful command dispatches
 * - commandsFailed         : total command dispatches that threw
 * - sendGuardThrottled     : total times the send guard had to wait (rate limited)
 * - pluginOnMessageErrors  : total errors thrown by onMessage hooks
 */

const counters = {
    commandsExecuted: 0,
    commandsFailed: 0,
    sendGuardThrottled: 0,
    pluginOnMessageErrors: 0,
};

/**
 * Read a snapshot of all counters (shallow copy).
 * @returns {object}
 */
function getMetrics() {
    return { ...counters };
}

/**
 * Increment a named counter.
 * @param {'commandsExecuted'|'commandsFailed'|'sendGuardThrottled'|'pluginOnMessageErrors'} name
 * @param {number} [by=1]
 */
function inc(name, by = 1) {
    if (Object.prototype.hasOwnProperty.call(counters, name)) {
        counters[name] += by;
    }
}

module.exports = { counters, getMetrics, inc };
