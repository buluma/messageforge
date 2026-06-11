'use strict';

const metrics = require('../lib/metrics');

describe('metrics module', () => {
    beforeEach(() => {
        // Reset counters before each test
        metrics.counters.commandsExecuted = 0;
        metrics.counters.commandsFailed = 0;
        metrics.counters.sendGuardThrottled = 0;
        metrics.counters.pluginOnMessageErrors = 0;
    });

    test('initial counters are zero', () => {
        const snapshot = metrics.getMetrics();
        expect(snapshot).toEqual({
            commandsExecuted: 0,
            commandsFailed: 0,
            sendGuardThrottled: 0,
            pluginOnMessageErrors: 0,
        });
    });

    test('inc() increments a named counter', () => {
        metrics.inc('commandsExecuted');
        expect(metrics.counters.commandsExecuted).toBe(1);
    });

    test('inc() increments by the given amount', () => {
        metrics.inc('commandsFailed', 3);
        expect(metrics.counters.commandsFailed).toBe(3);
    });

    test('inc() ignores unknown counter names', () => {
        metrics.inc('nonexistent');
        // No throw, counters unchanged
        const snapshot = metrics.getMetrics();
        expect(snapshot.commandsExecuted).toBe(0);
    });

    test('getMetrics() returns a snapshot (shallow copy)', () => {
        metrics.inc('commandsExecuted');
        const snap = metrics.getMetrics();
        expect(snap.commandsExecuted).toBe(1);

        // Mutating the snapshot does not affect live counters
        snap.commandsExecuted = 999;
        expect(metrics.counters.commandsExecuted).toBe(1);
    });

    test('all four counters can be incremented independently', () => {
        metrics.inc('commandsExecuted');
        metrics.inc('commandsFailed');
        metrics.inc('sendGuardThrottled');
        metrics.inc('pluginOnMessageErrors');

        const snap = metrics.getMetrics();
        expect(snap).toEqual({
            commandsExecuted: 1,
            commandsFailed: 1,
            sendGuardThrottled: 1,
            pluginOnMessageErrors: 1,
        });
    });
});
