/**
 * monitoringContext.js — tiny, read-only runtime context for error reports.
 *
 * Feature code records interactions and timed operations here. Nothing in this
 * module changes app state, talks to Firestore, or changes rendering behavior.
 */
window.BARK = window.BARK || {};

(function () {
    const MAX_BREADCRUMBS = 12;
    const MAX_COMPLETED_OPERATIONS = 6;
    const IOS_SAFARI_RESUME_TRANSACTION_ERROR =
        /^Attempt to get (?:a record|records|all index records) from database without an in-progress transaction$/i;
    const breadcrumbs = [];
    const activeOperations = new Map();
    const completedOperations = [];
    const pendingAnalytics = [];
    let operationSequence = 0;
    let lastAction = null;
    let analyticsRetryTimer = null;
    let analyticsRetryAttempts = 0;

    function clean(value, max = 80) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/[\r\n|]+/g, ' ')
            .trim()
            .slice(0, max);
    }

    function nowMono() {
        return window.performance && typeof window.performance.now === 'function'
            ? window.performance.now()
            : Date.now();
    }

    function addBreadcrumb(name, detail) {
        try {
            const n = clean(name, 60) || 'unknown';
            const d = clean(detail, 100) || null;
            const now = Date.now();
            const previous = breadcrumbs[breadcrumbs.length - 1];
            if (previous && previous.n === n && previous.d === d && now - previous.t < 1000) {
                previous.t = now;
                previous.count = (previous.count || 1) + 1;
                return;
            }
            breadcrumbs.push({ n, d, t: now, count: 1 });
            if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
        } catch (_error) { /* monitoring must never throw */ }
    }

    function noteInteraction(action, detail) {
        try {
            lastAction = { n: clean(action, 60) || 'unknown', d: clean(detail, 100) || null, t: Date.now() };
            addBreadcrumb(`action:${lastAction.n}`, lastAction.d);
        } catch (_error) { /* no-op */ }
    }

    function beginOperation(name, detail) {
        try {
            operationSequence += 1;
            const token = `op-${operationSequence}`;
            const operation = {
                token,
                n: clean(name, 60) || 'unknown',
                d: clean(detail, 100) || null,
                startedAt: Date.now(),
                startedMono: nowMono()
            };
            activeOperations.set(token, operation);
            addBreadcrumb(`start:${operation.n}`, operation.d);
            return token;
        } catch (_error) {
            return null;
        }
    }

    function endOperation(token, detail) {
        try {
            if (!token || !activeOperations.has(token)) return null;
            const operation = activeOperations.get(token);
            activeOperations.delete(token);
            const durationMs = Math.max(0, Math.round(nowMono() - operation.startedMono));
            const completed = {
                n: operation.n,
                d: clean(detail, 100) || operation.d,
                startedAt: operation.startedAt,
                endedAt: Date.now(),
                durationMs
            };
            completedOperations.push(completed);
            if (completedOperations.length > MAX_COMPLETED_OPERATIONS) completedOperations.shift();
            addBreadcrumb(`done:${operation.n}`, `${durationMs}ms${completed.d ? ` ${completed.d}` : ''}`);
            return completed;
        } catch (_error) {
            return null;
        }
    }

    function inferArea(name) {
        const value = clean(name, 120).toLowerCase();
        if (/indexeddb|database|firestore|transaction|storage|vault/.test(value)) return 'storage/database';
        if (/marker|pin|cluster|map-render/.test(value)) return 'map/pin rendering';
        if (/zoom|pan|drag|map-gesture|move/.test(value)) return 'map interaction';
        if (/csv|spreadsheet|data-poll|park-data/.test(value)) return 'spreadsheet update';
        if (/trip|route/.test(value)) return 'trip/route';
        if (/trail|expedition|walk/.test(value)) return 'virtual trail';
        if (/watermark|canvas|export|image/.test(value)) return 'image/export';
        if (/panel|park-remove|visit|check-in|checkin/.test(value)) return 'park panel/visit';
        if (/payment|checkout|paywall|premium/.test(value)) return 'payment/upgrade';
        if (/auth|sign-in|account/.test(value)) return 'account/sign-in';
        return 'unknown';
    }

    function getReleaseChannel() {
        const host = String(location.hostname || '').toLowerCase();
        const path = String(location.pathname || '');
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || location.protocol === 'file:') return 'local';
        if (host.includes('github.io') && path.includes('/USBarkRangers/01-code/app')) return 'beta';
        if (host === 'usbarkrangersmap.com' || host === 'www.usbarkrangersmap.com' ||
            host === 'barkrangermap-auth.web.app' || host === 'barkrangermap-auth.firebaseapp.com') return 'production';
        return 'web';
    }

    function getDeviceFamily() {
        const ua = navigator.userAgent || '';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
        if (/Android/i.test(ua)) return 'Android';
        if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
        if (/Windows/i.test(ua)) return 'Windows';
        return 'Other';
    }

    function getBrowserFamily() {
        const ua = navigator.userAgent || '';
        if (/CriOS/i.test(ua)) return 'Chrome iOS';
        if (/FxiOS/i.test(ua)) return 'Firefox iOS';
        if (/EdgiOS|EdgA|Edg\//i.test(ua)) return 'Edge';
        if (/iPhone|iPad|iPod/i.test(ua) && /Safari/i.test(ua)) return 'Safari iOS';
        if (/Chrome/i.test(ua)) return 'Chrome';
        if (/Safari/i.test(ua)) return 'Safari';
        if (/Firefox/i.test(ua)) return 'Firefox';
        return 'Other';
    }

    function getActiveScreen() {
        const active = document.querySelector && document.querySelector('.ui-view.active');
        return active && active.id ? active.id : 'map';
    }

    function snapshot(freezeDurationMs) {
        try {
            const now = Date.now();
            const threshold = Number(freezeDurationMs) || 0;
            const active = Array.from(activeOperations.values()).sort((a, b) => b.startedAt - a.startedAt)[0] || null;
            const recentCompleted = [...completedOperations]
                .reverse()
                .find((operation) => now - operation.endedAt <= 5000 && operation.durationMs >= Math.max(100, threshold * 0.65)) || null;
            const likelyOperation = active || recentCompleted;
            const likelyName = likelyOperation ? likelyOperation.n : (lastAction ? lastAction.n : 'unknown');
            const parkRepo = window.BARK && window.BARK.repos && window.BARK.repos.ParkRepo;
            const points = parkRepo && typeof parkRepo.getAll === 'function' ? parkRepo.getAll() : null;
            const map = window.map;
            return {
                likelyArea: inferArea(likelyName),
                likelyOperation: likelyOperation ? likelyOperation.n : null,
                operationDurationMs: recentCompleted ? recentCompleted.durationMs : null,
                lastAction: lastAction ? lastAction.n : null,
                lastActionAgeSeconds: lastAction ? Math.max(0, Math.round((now - lastAction.t) / 1000)) : null,
                activeScreen: getActiveScreen(),
                pinCount: Array.isArray(points) ? points.length : document.querySelectorAll('.leaflet-marker-icon').length,
                mapZoom: map && typeof map.getZoom === 'function' ? map.getZoom() : null,
                releaseChannel: getReleaseChannel(),
                deviceFamily: getDeviceFamily(),
                browserFamily: getBrowserFamily(),
                breadcrumbs: breadcrumbs.map((item) => ({
                    name: item.n,
                    detail: item.d,
                    ageSeconds: Math.max(0, Math.round((now - item.t) / 1000)),
                    count: item.count || 1
                }))
            };
        } catch (_error) {
            return { likelyArea: 'unknown', releaseChannel: getReleaseChannel() };
        }
    }

    function classifyFreeze(durationMs, context) {
        const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
        const severity = seconds >= 45 ? 'extreme' : (seconds >= 15 ? 'severe' : 'noticeable');
        const likelyArea = context && context.likelyArea ? context.likelyArea : 'unknown';
        return {
            severity,
            likelyArea,
            freezeCategory: `${likelyArea}:${severity}`,
            durationSeconds: Math.round(seconds * 10) / 10
        };
    }

    function isRecoveredIosSafariStorageResume(message, context = {}) {
        if (!IOS_SAFARI_RESUME_TRANSACTION_ERROR.test(clean(message, 500))) return false;
        if (context.deviceFamily !== 'iOS' || context.browserFamily !== 'Safari iOS') return false;
        if (context.visibilityTransitionSeen !== true) return false;

        const resumeAgeSeconds = Number(context.secondsSinceVisibilityChange);
        return Number.isFinite(resumeAgeSeconds) && resumeAgeSeconds >= 0 && resumeAgeSeconds <= 5;
    }

    function classifyError(message, context = {}) {
        if (isRecoveredIosSafariStorageResume(message, context)) {
            return {
                likelyArea: 'iOS Safari storage resume warning',
                severity: 'routine',
                lowInformation: false,
                fingerprint: 'ios-safari-storage-resume-warning'
            };
        }

        const area = inferArea(message);
        const lowInformation = /^script error\.?$/i.test(clean(message, 100));
        return {
            likelyArea: area,
            severity: lowInformation ? 'routine' : (area === 'storage/database' ? 'important' : 'important'),
            lowInformation
        };
    }

    function sendAnalyticsEvent(item) {
        if (!window.goatcounter || typeof window.goatcounter.count !== 'function') return false;
        window.goatcounter.count({
            path: item.path,
            title: item.title,
            event: true,
            no_session: item.noSession !== false
        });
        return true;
    }

    function flushAnalytics() {
        analyticsRetryTimer = null;
        while (pendingAnalytics.length) {
            if (!sendAnalyticsEvent(pendingAnalytics[0])) break;
            pendingAnalytics.shift();
        }
        if (!pendingAnalytics.length) {
            analyticsRetryAttempts = 0;
        } else if (analyticsRetryAttempts >= 10) {
            pendingAnalytics.length = 0;
            analyticsRetryAttempts = 0;
        } else if (!analyticsRetryTimer) {
            analyticsRetryAttempts += 1;
            analyticsRetryTimer = setTimeout(flushAnalytics, 1000);
        }
    }

    function trackEvent(name, title) {
        try {
            if (getReleaseChannel() === 'local') return;
            const safeName = clean(name, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
            if (!safeName) return;
            const item = { path: `event-${safeName}`, title: clean(title, 120) || safeName, noSession: true };
            if (sendAnalyticsEvent(item)) return;
            pendingAnalytics.push(item);
            if (pendingAnalytics.length > 10) pendingAnalytics.shift();
            if (!analyticsRetryTimer) {
                analyticsRetryAttempts = 1;
                analyticsRetryTimer = setTimeout(flushAnalytics, 1000);
            }
        } catch (_error) { /* analytics must never affect the app */ }
    }

    function trackSessionEvent(name, title) {
        try {
            if (getReleaseChannel() === 'local') return;
            const safeName = clean(name, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
            if (!safeName) return;
            const item = { path: `event-${safeName}`, title: clean(title, 120) || safeName, noSession: false };
            if (sendAnalyticsEvent(item)) return;
            pendingAnalytics.push(item);
            if (pendingAnalytics.length > 10) pendingAnalytics.shift();
            if (!analyticsRetryTimer) {
                analyticsRetryAttempts = 1;
                analyticsRetryTimer = setTimeout(flushAnalytics, 1000);
            }
        } catch (_error) { /* analytics must never affect the app */ }
    }

    window.BARK.monitoring = {
        addBreadcrumb,
        noteInteraction,
        beginOperation,
        endOperation,
        snapshot,
        classifyFreeze,
        classifyError,
        inferArea,
        trackEvent,
        trackSessionEvent,
        getReleaseChannel
    };
    window.BARK.perfBreadcrumb = addBreadcrumb;
    window.BARK.perfOperationStart = beginOperation;
    window.BARK.perfOperationEnd = endOperation;
    window.BARK.noteInteraction = noteInteraction;
    window.BARK.trackMonitoringEvent = trackEvent;
    window.BARK.trackMonitoringSessionEvent = trackSessionEvent;

    // Count every real app load separately from GoatCounter's normal
    // privacy-preserving 8-hour visit. Comparing these two measurements tells
    // operations how many opens were repeats without adding a Firebase write.
    const releaseChannel = getReleaseChannel();
    if (releaseChannel === 'production' || releaseChannel === 'beta') {
        trackEvent(`app-open-${releaseChannel}`, `App opened: ${releaseChannel}`);
        trackSessionEvent(`app-session-${releaseChannel}`, `App session: ${releaseChannel}`);
    }
})();
