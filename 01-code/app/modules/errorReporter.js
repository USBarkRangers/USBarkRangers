/**
 * errorReporter.js (v2) - Client error + freeze reporting for the launch bug hunt.
 *
 * Catches uncaught JS errors, unhandled promise rejections, and UI freezes
 * (main-thread stalls) and forwards them to the reportClientError callable so
 * they surface as emails + a Firestore log. Built to be safe and quiet:
 *   - Only reports for signed-in users (the callable requires auth).
 *   - Per-session cap, min interval, and signature dedup so one broken screen
 *     can never flood.
 *   - Its own handlers never throw.
 *
 * v2 hardening (false-freeze fix): iOS suspends timers when the phone locks or
 * the user switches apps. On resume, the stale heartbeat tick can run BEFORE
 * the visibilitychange handler, making the entire pocket-time look like a
 * "freeze". Two defenses, robust to either ordering of that race:
 *   1. A hidden flag set on hide AND on show — the first tick after any
 *      visibility transition is always discarded.
 *   2. A hard cap: drift beyond suspendCapMs is suspension by definition
 *      (nobody waits minutes at a frozen page) and is never reported.
 * Reports now carry breadcrumbs (last heavy operations, via
 * window.BARK.perfBreadcrumb) and visibility context so real stalls can be
 * attributed to a specific operation.
 */
window.BARK = window.BARK || {};

(function () {
    // Overridable for tests via window.BARK_ERROR_REPORTER_CONFIG.
    const CFG = Object.assign({
        maxReportsPerSession: 15,   // more sensitive for the launch bug hunt
        minSendIntervalMs: 3000,    // let distinct errors close together through
        heartbeatMs: 2000,
        freezeThresholdMs: 5000,    // only a stall beyond this counts as a freeze
        suspendCapMs: 30000,        // drift beyond this = tab suspension, not a freeze
        watchdogStartDelayMs: 10000 // skip initial boot jank
    }, window.BARK_ERROR_REPORTER_CONFIG || {});

    const DEDUP_MAX = 40;
    const BREADCRUMB_MAX = 6;

    let reportCount = 0;
    let lastSendAt = 0;
    let installed = false;
    const seenSignatures = new Set();

    // ===== Breadcrumbs: heavy operations self-report here (name + timestamp) =====
    const breadcrumbs = [];
    function perfBreadcrumb(name) {
        try {
            breadcrumbs.push({ n: String(name).slice(0, 60), t: Date.now() });
            if (breadcrumbs.length > BREADCRUMB_MAX) breadcrumbs.shift();
        } catch (_e) { /* never throw */ }
    }

    // ===== Visibility tracking for freeze-vs-suspension classification =====
    let lastVisibilityChangeAt = Date.now();
    let hiddenSinceLastBeat = false;

    function buildContext() {
        try {
            const now = Date.now();
            const crumbs = breadcrumbs
                .map((b) => `${b.n}+${Math.round((now - b.t) / 1000)}s`)
                .join(',');
            const sinceVis = Math.round((now - lastVisibilityChangeAt) / 1000);
            return `vis=${document.visibilityState};sinceVisChange=${sinceVis}s;crumbs=${crumbs || 'none'}`;
        } catch (_e) {
            return null;
        }
    }

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
            if (reportCount >= CFG.maxReportsPerSession) return;
            if (!currentUid()) return; // callable requires auth; skip guests

            const now = Date.now();
            if (now - lastSendAt < CFG.minSendIntervalMs) return;

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
                appVersion: (window.BARK && window.BARK.APP_VERSION) || null,
                context: buildContext()
            }, extra || {});

            // Fire-and-forget — a reporting failure must never disrupt the app.
            Promise.resolve(callable(payload)).catch(() => {});
        } catch (_e) {
            /* reporting must never throw */
        }
    }

    function installFreezeWatchdog() {
        let last = Date.now();

        const noteTransition = () => {
            // Any visibility transition poisons the next tick: whichever of the
            // stale tick or this handler runs first, the interval since `last`
            // includes non-frozen time and must not be reported.
            lastVisibilityChangeAt = Date.now();
            hiddenSinceLastBeat = true;
            last = Date.now();
        };

        document.addEventListener('visibilitychange', noteTransition);
        window.addEventListener('pagehide', noteTransition);
        window.addEventListener('pageshow', noteTransition);
        window.addEventListener('focus', () => { last = Date.now(); });

        setInterval(() => {
            const now = Date.now();
            const drift = now - last - CFG.heartbeatMs;
            const skipForVisibility = hiddenSinceLastBeat;
            hiddenSinceLastBeat = false;
            last = now;

            if (skipForVisibility) return;                       // transition since last beat
            if (document.visibilityState !== 'visible') return;  // backgrounded: timers throttle
            if (drift >= CFG.suspendCapMs) return;               // suspension artifact, not a freeze
            if (drift >= CFG.freezeThresholdMs) {
                const stalledMs = Math.round(drift + CFG.heartbeatMs);
                report('freeze', `UI stalled for ~${stalledMs}ms`, null, { durationMs: stalledMs });
            }
        }, CFG.heartbeatMs);
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
        setTimeout(installFreezeWatchdog, CFG.watchdogStartDelayMs);
    }

    window.BARK.initErrorReporter = initErrorReporter;
    window.BARK.reportClientError = report;   // exposed for manual/boot reporting
    window.BARK.perfBreadcrumb = perfBreadcrumb; // heavy operations call this

    // Self-install as early as possible so errors during the rest of boot are caught.
    initErrorReporter();
})();
