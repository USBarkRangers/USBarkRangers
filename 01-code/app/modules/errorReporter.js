/**
 * errorReporter.js - Client error + freeze reporting for the launch bug hunt.
 *
 * Catches uncaught JS errors, unhandled promise rejections, and UI freezes
 * (main-thread stalls) and forwards them to the reportClientError callable so
 * they surface as emails + a Firestore log. Built to be safe and quiet:
 *   - Only reports for signed-in users (the callable requires auth).
 *   - Per-session cap, min interval, and signature dedup so one broken screen
 *     can never flood.
 *   - Its own handlers never throw.
 * The server side adds its own per-user email cap and in-memory dedup on top.
 */
window.BARK = window.BARK || {};

(function () {
    const MAX_REPORTS_PER_SESSION = 8;
    const MIN_SEND_INTERVAL_MS = 8000;
    const FREEZE_HEARTBEAT_MS = 2000;
    const FREEZE_THRESHOLD_MS = 5000;   // only a stall beyond this counts as a freeze
    const WATCHDOG_START_DELAY_MS = 10000; // skip initial boot jank
    const DEDUP_MAX = 40;

    let reportCount = 0;
    let lastSendAt = 0;
    let installed = false;
    const seenSignatures = new Set();

    function currentUid() {
        try {
            return (window.firebase && firebase.auth && firebase.auth().currentUser)
                ? firebase.auth().currentUser.uid
                : null;
        } catch (_e) {
            return null;
        }
    }

    function getCallable() {
        try {
            if (window.firebase && firebase.functions) {
                return firebase.functions().httpsCallable('reportClientError');
            }
        } catch (_e) { /* ignore */ }
        return null;
    }

    function buildSignature(type, message, stack) {
        const firstFrame = (stack || '').split('\n').find((line) => /:\d+:\d+/.test(line)) || '';
        return `${type}|${(message || '').slice(0, 120)}|${firstFrame.trim().slice(0, 120)}`;
    }

    function report(type, message, stack, extra) {
        try {
            if (reportCount >= MAX_REPORTS_PER_SESSION) return;
            if (!currentUid()) return; // callable requires auth; skip guests

            const now = Date.now();
            if (now - lastSendAt < MIN_SEND_INTERVAL_MS) return;

            const signature = buildSignature(type, message, stack);
            if (seenSignatures.has(signature)) return;

            const callable = getCallable();
            if (!callable) return;

            seenSignatures.add(signature);
            if (seenSignatures.size > DEDUP_MAX) seenSignatures.clear();
            reportCount += 1;
            lastSendAt = now;

            const payload = Object.assign({
                type,
                message: String(message || '').slice(0, 500),
                stack: String(stack || '').slice(0, 4000),
                path: (location.pathname + location.hash).slice(0, 300),
                userAgent: navigator.userAgent.slice(0, 300),
                appVersion: (window.BARK && window.BARK.APP_VERSION) || null
            }, extra || {});

            // Fire-and-forget — a reporting failure must never disrupt the app.
            Promise.resolve(callable(payload)).catch(() => {});
        } catch (_e) {
            /* reporting must never throw */
        }
    }

    function installFreezeWatchdog() {
        let last = Date.now();

        document.addEventListener('visibilitychange', () => {
            // Returning to a backgrounded tab isn't a freeze — reset the baseline.
            if (document.visibilityState === 'visible') last = Date.now();
        });

        setInterval(() => {
            const now = Date.now();
            const drift = now - last - FREEZE_HEARTBEAT_MS;
            last = now;
            if (document.visibilityState !== 'visible') return; // timers throttle when hidden
            if (drift >= FREEZE_THRESHOLD_MS) {
                const stalledMs = Math.round(drift + FREEZE_HEARTBEAT_MS);
                report('freeze', `UI stalled for ~${stalledMs}ms`, null, { durationMs: stalledMs });
            }
        }, FREEZE_HEARTBEAT_MS);
    }

    function initErrorReporter() {
        if (installed) return;
        installed = true;

        window.addEventListener('error', (event) => {
            const err = event && event.error;
            const message = (event && event.message) || (err && err.message) || 'Uncaught error';
            const stack = (err && err.stack)
                || (event && event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null);
            report('error', message, stack);
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event && event.reason;
            const message = (reason && reason.message) || String(reason || 'Unhandled promise rejection');
            const stack = (reason && reason.stack) || null;
            report('unhandledrejection', message, stack);
        });

        // Delay the freeze watchdog so slow initial boot isn't misreported.
        setTimeout(installFreezeWatchdog, WATCHDOG_START_DELAY_MS);
    }

    window.BARK.initErrorReporter = initErrorReporter;
    window.BARK.reportClientError = report; // exposed for manual/boot reporting

    // Self-install as early as possible so errors during the rest of boot are caught.
    initErrorReporter();
})();
