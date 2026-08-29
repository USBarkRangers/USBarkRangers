/**
 * leaderboardSyncPolicy.js — pure timing policy for leaderboard writes.
 *
 * The leaderboard is a derived view. Park visits must save immediately, while
 * score writes may be safely coalesced. Keeping this policy free of Firebase
 * and timers makes its launch/bulk-entry behavior deterministic and testable.
 */
(function () {
    window.BARK = window.BARK || {};

    const DEFAULTS = Object.freeze({
        quietMs: 10 * 1000,
        bulkThreshold: 5,
        bulkWindowMs: 5 * 60 * 1000,
        bulkIntervalMs: 3 * 60 * 1000
    });

    function positiveNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function createLeaderboardSyncPolicy(options = {}) {
        const config = Object.freeze({
            quietMs: positiveNumber(options.quietMs, DEFAULTS.quietMs),
            bulkThreshold: Math.max(2, Math.trunc(positiveNumber(options.bulkThreshold, DEFAULTS.bulkThreshold))),
            bulkWindowMs: positiveNumber(options.bulkWindowMs, DEFAULTS.bulkWindowMs),
            bulkIntervalMs: positiveNumber(options.bulkIntervalMs, DEFAULTS.bulkIntervalMs)
        });

        let changeTimes = [];
        let lastObservedFingerprint = null;
        let lastSuccessfulSyncAt = 0;

        function prune(now) {
            const oldestAllowed = now - config.bulkWindowMs;
            changeTimes = changeTimes.filter(timestamp => timestamp >= oldestAllowed);
        }

        function request(fingerprint, now = Date.now()) {
            const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
            prune(safeNow);

            const changed = typeof fingerprint === 'string' && fingerprint !== lastObservedFingerprint;
            if (changed) {
                lastObservedFingerprint = fingerprint;
                changeTimes.push(safeNow);
                prune(safeNow);
            }

            const bulkMode = changeTimes.length >= config.bulkThreshold;
            const quietDueAt = safeNow + config.quietMs;
            const periodicDueAt = lastSuccessfulSyncAt > 0
                ? lastSuccessfulSyncAt + config.bulkIntervalMs
                : quietDueAt;

            return Object.freeze({
                changed,
                bulkMode,
                distinctChanges: changeTimes.length,
                // During continuous bulk entry, each change moves quietDueAt
                // forward until the periodic deadline wins. If the user stops,
                // the final score flushes after the normal quiet period.
                dueAt: bulkMode ? Math.min(quietDueAt, periodicDueAt) : quietDueAt
            });
        }

        function markSuccessfulSync(now = Date.now(), fingerprint = null) {
            const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
            lastSuccessfulSyncAt = safeNow;
            if (typeof fingerprint === 'string') lastObservedFingerprint = fingerprint;
            prune(safeNow);
        }

        function reset() {
            changeTimes = [];
            lastObservedFingerprint = null;
            lastSuccessfulSyncAt = 0;
        }

        function snapshot(now = Date.now()) {
            const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
            prune(safeNow);
            return Object.freeze({
                distinctChanges: changeTimes.length,
                bulkMode: changeTimes.length >= config.bulkThreshold,
                lastObservedFingerprint,
                lastSuccessfulSyncAt,
                config
            });
        }

        return Object.freeze({ request, markSuccessfulSync, reset, snapshot });
    }

    window.BARK.createLeaderboardSyncPolicy = createLeaderboardSyncPolicy;
    window.BARK.LEADERBOARD_SYNC_POLICY_DEFAULTS = DEFAULTS;
})();
