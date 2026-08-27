/**
 * errorReporter.js (v3) — client errors and recoverable main-thread freezes.
 * Reports are authenticated, capped, cooldown-deduplicated, and best-effort.
 */
window.BARK = window.BARK || {};

(function () {
    const CFG = Object.assign({
        maxReportsPerSession: 12,
        minSendIntervalMs: 3000,
        signatureCooldownMs: 10 * 60 * 1000,
        heartbeatMs: 2000,
        freezeThresholdMs: 5000,
        suspendCapMs: 120000,
        watchdogStartDelayMs: 10000,
        pendingRetryDelayMs: 15000
    }, window.BARK_ERROR_REPORTER_CONFIG || {});

    const PENDING_FREEZE_KEY = 'barkPendingFreezeReportV1';
    const SIGNATURE_LIMIT = 60;
    let reportCount = 0;
    let lastSendAt = 0;
    let installed = false;
    const signatureTimes = new Map();
    let lastVisibilityChangeAt = Date.now();
    let visibilityTransitionSeen = false;
    let hiddenSinceLastBeat = false;
    let pendingRetryAttempts = 0;

    function monitoring() { return window.BARK && window.BARK.monitoring; }
    function clean(value, max) { return String(value === undefined || value === null ? '' : value).slice(0, max); }

    function redactSensitiveText(value, max) {
        return clean(value, max)
            .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
            .replace(/\b(id_token|access_token|refresh_token|authorization|oobCode|apiKey)(=|%3D)([^\s&#]*)/gi, '$1$2[REDACTED]')
            .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]');
    }

    function cleanPath(value) {
        return clean(value, 300).split(/[?#]/, 1)[0] || '/';
    }

    function sanitizePayload(payload) {
        const safe = Object.assign({}, payload || {});
        safe.message = redactSensitiveText(safe.message, 500);
        safe.stack = redactSensitiveText(safe.stack, 4000);
        safe.context = redactSensitiveText(safe.context, 500);
        safe.fingerprint = redactSensitiveText(safe.fingerprint, 180);
        safe.errorCode = redactSensitiveText(safe.errorCode, 80);
        safe.lastAction = redactSensitiveText(safe.lastAction, 80);
        safe.likelyOperation = redactSensitiveText(safe.likelyOperation, 80);
        safe.path = cleanPath(safe.path);
        return safe;
    }

    function currentUid() {
        try {
            return window.firebase && firebase.auth && firebase.auth().currentUser
                ? firebase.auth().currentUser.uid
                : null;
        } catch (_error) { return null; }
    }

    function getCallable() {
        try {
            return window.firebase && firebase.functions
                ? firebase.functions().httpsCallable('reportClientError')
                : null;
        } catch (_error) { return null; }
    }

    function getSnapshot(durationMs) {
        try {
            const monitor = monitoring();
            return monitor && typeof monitor.snapshot === 'function' ? monitor.snapshot(durationMs) : {};
        } catch (_error) { return {}; }
    }

    function buildLegacyContext(snapshot) {
        try {
            const sinceVisibility = Math.max(0, Math.round((Date.now() - lastVisibilityChangeAt) / 1000));
            const crumbs = Array.isArray(snapshot.breadcrumbs)
                ? snapshot.breadcrumbs.map((item) => `${item.name}+${item.ageSeconds}s${item.count > 1 ? `x${item.count}` : ''}`).join(',')
                : 'none';
            return `vis=${document.visibilityState};sinceVisChange=${sinceVisibility}s;area=${snapshot.likelyArea || 'unknown'};crumbs=${crumbs || 'none'}`;
        } catch (_error) { return null; }
    }

    function buildSignature(type, message, stack, extra) {
        if (extra && extra.fingerprint) return `${type}|${clean(extra.fingerprint, 180)}`;
        if (type === 'freeze') return `freeze|${clean(extra && extra.freezeCategory, 120) || 'unknown'}`;
        const firstFrame = clean(stack, 4000).split('\n').find((line) => /:\d+:\d+/.test(line)) || '';
        return `${type}|${clean(message, 120)}|${clean(firstFrame.trim(), 120)}`;
    }

    function signatureAllowed(signature, now) {
        const last = signatureTimes.get(signature);
        if (last && now - last < CFG.signatureCooldownMs) return false;
        signatureTimes.set(signature, now);
        if (signatureTimes.size > SIGNATURE_LIMIT) {
            for (const [key, timestamp] of signatureTimes) {
                if (now - timestamp >= CFG.signatureCooldownMs) signatureTimes.delete(key);
            }
            if (signatureTimes.size > SIGNATURE_LIMIT) signatureTimes.delete(signatureTimes.keys().next().value);
        }
        return true;
    }

    function savePendingFreeze(payload) {
        try { localStorage.setItem(PENDING_FREEZE_KEY, JSON.stringify({ savedAt: Date.now(), payload })); }
        catch (_error) { /* persistence is optional */ }
    }

    function clearPendingFreeze(reportId) {
        try {
            const stored = JSON.parse(localStorage.getItem(PENDING_FREEZE_KEY) || 'null');
            if (!stored || !stored.payload || stored.payload.reportId === reportId) localStorage.removeItem(PENDING_FREEZE_KEY);
        } catch (_error) { /* no-op */ }
    }

    function readPendingFreeze() {
        try {
            const stored = JSON.parse(localStorage.getItem(PENDING_FREEZE_KEY) || 'null');
            if (!stored || !stored.payload || Date.now() - Number(stored.savedAt || 0) > 24 * 60 * 60 * 1000) {
                localStorage.removeItem(PENDING_FREEZE_KEY);
                return null;
            }
            return stored.payload;
        } catch (_error) { return null; }
    }

    function sendPayload(payload, options = {}) {
        try {
            const safePayload = sanitizePayload(payload);
            if (safePayload.type === 'freeze' && !options.retry) savePendingFreeze(safePayload);
            if (reportCount >= CFG.maxReportsPerSession || !currentUid()) return false;
            const callable = getCallable();
            if (!callable) return false;
            const now = Date.now();
            if (!options.retry && now - lastSendAt < CFG.minSendIntervalMs) return false;
            const signature = buildSignature(safePayload.type, safePayload.message, safePayload.stack, safePayload);
            if (!options.retry && !signatureAllowed(signature, now)) return false;

            reportCount += 1;
            lastSendAt = now;
            Promise.resolve(callable(safePayload))
                .then(() => { if (safePayload.type === 'freeze') clearPendingFreeze(safePayload.reportId); })
                .catch(() => { /* pending freeze remains for next load */ });
            return true;
        } catch (_error) { return false; }
    }

    function report(type, message, stack, extra) {
        try {
            const durationMs = Number(extra && extra.durationMs);
            const snapshot = getSnapshot(Number.isFinite(durationMs) ? durationMs : null);
            const secondsSinceVisibilityChange = Math.max(0, Math.round((Date.now() - lastVisibilityChangeAt) / 1000));
            const errorClassification = type === 'freeze'
                ? null
                : (monitoring() && typeof monitoring().classifyError === 'function'
                    ? monitoring().classifyError(message, {
                        ...snapshot,
                        secondsSinceVisibilityChange,
                        visibilityTransitionSeen
                    })
                    : { likelyArea: 'unknown', severity: 'important' });
            const details = Object.assign({}, snapshot, errorClassification || {}, extra || {});
            const payload = {
                type,
                message: clean(message, 500),
                stack: clean(stack, 4000),
                path: cleanPath(location.pathname),
                hostname: clean(location.hostname, 120),
                userAgent: clean(navigator.userAgent, 300),
                appVersion: window.BARK.APP_VERSION || null,
                context: buildLegacyContext(details),
                reportId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
                durationMs: Number.isFinite(durationMs) ? durationMs : null,
                durationSeconds: Number.isFinite(Number(details.durationSeconds)) ? Number(details.durationSeconds) : null,
                severity: clean(details.severity || 'important', 30),
                likelyArea: clean(details.likelyArea || 'unknown', 80),
                freezeCategory: clean(details.freezeCategory, 120),
                fingerprint: clean(details.fingerprint, 180),
                releaseChannel: clean(details.releaseChannel, 30),
                deviceFamily: clean(details.deviceFamily, 40),
                browserFamily: clean(details.browserFamily, 40),
                activeScreen: clean(details.activeScreen, 60),
                lastAction: clean(details.lastAction, 80),
                lastActionAgeSeconds: Number.isFinite(Number(details.lastActionAgeSeconds)) ? Number(details.lastActionAgeSeconds) : null,
                likelyOperation: clean(details.likelyOperation, 80),
                operationDurationMs: Number.isFinite(Number(details.operationDurationMs)) ? Number(details.operationDurationMs) : null,
                pinCount: Number.isFinite(Number(details.pinCount)) ? Number(details.pinCount) : null,
                mapZoom: Number.isFinite(Number(details.mapZoom)) ? Number(details.mapZoom) : null,
                lowInformation: details.lowInformation === true
            };
            payload.errorName = clean(details.errorName, 80);
            payload.errorCode = clean(details.errorCode, 80);
            if (!payload.fingerprint) {
                payload.fingerprint = type === 'freeze'
                    ? `freeze:${payload.freezeCategory || payload.likelyArea}`
                    : `${type}:${payload.likelyArea}:${clean(payload.message.toLowerCase(), 100)}`;
            }
            return sendPayload(payload);
        } catch (_error) { return false; }
    }

    function retryPendingFreeze() {
        const payload = readPendingFreeze();
        if (!payload || pendingRetryAttempts >= 4) return;
        pendingRetryAttempts += 1;
        sendPayload(payload, { retry: true });
        setTimeout(retryPendingFreeze, CFG.pendingRetryDelayMs * 2);
    }

    function installFreezeWatchdog() {
        let last = Date.now();
        const noteTransition = () => {
            lastVisibilityChangeAt = Date.now();
            visibilityTransitionSeen = true;
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
            if (skipForVisibility || document.visibilityState !== 'visible') return;
            if (drift >= CFG.suspendCapMs || drift < CFG.freezeThresholdMs) return;

            const stalledMs = Math.round(drift + CFG.heartbeatMs);
            const snapshot = getSnapshot(stalledMs);
            const classification = monitoring() && typeof monitoring().classifyFreeze === 'function'
                ? monitoring().classifyFreeze(stalledMs, snapshot)
                : {
                    severity: stalledMs >= 45000 ? 'extreme' : (stalledMs >= 15000 ? 'severe' : 'noticeable'),
                    likelyArea: 'unknown',
                    freezeCategory: 'unknown',
                    durationSeconds: Math.round(stalledMs / 100) / 10
                };
            report('freeze', `UI stalled for approximately ${classification.durationSeconds.toFixed(1)} seconds`, null, {
                ...classification,
                durationMs: stalledMs
            });
        }, CFG.heartbeatMs);
    }

    function initErrorReporter() {
        if (installed) return;
        installed = true;
        window.addEventListener('error', (event) => {
            const err = event && event.error;
            const message = (event && event.message) || (err && err.message) || 'Uncaught error';
            const stack = (err && err.stack) || (event && event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null);
            report('error', message, stack);
        });
        window.addEventListener('unhandledrejection', (event) => {
            const reason = event && event.reason;
            const message = (reason && reason.message) || String(reason || 'Unhandled promise rejection');
            const stack = (reason && reason.stack) || null;
            report('unhandledrejection', message, stack, {
                errorName: clean(reason && reason.name, 80),
                errorCode: clean(reason && reason.code, 80)
            });
        });
        setTimeout(retryPendingFreeze, CFG.pendingRetryDelayMs);
        setTimeout(installFreezeWatchdog, CFG.watchdogStartDelayMs);
    }

    window.BARK.initErrorReporter = initErrorReporter;
    window.BARK.reportClientError = report;
    if (typeof window.BARK.perfBreadcrumb !== 'function') window.BARK.perfBreadcrumb = function () {};
    initErrorReporter();
})();
