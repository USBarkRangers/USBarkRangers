/**
 * visitorAnalytics.js — privacy-bounded visitor and screen analytics.
 *
 * Google Analytics owns visitor/session deduplication. GoatCounter remains an
 * independent, privacy-friendly cross-check in monitoringContext.js. This
 * module never reads or writes Firestore and analytics failures never affect
 * app startup, navigation, authentication, or Premium state.
 */
window.BARK = window.BARK || {};

(function () {
    const SCREEN_NAMES = Object.freeze({
        'home-view': 'home',
        'map-view': 'map',
        'planner-view': 'planner',
        'profile-view': 'profile'
    });
    const VALID_AUDIENCES = new Set(['logged-out', 'free', 'premium']);

    let analytics = null;
    let initialized = false;
    let lastScreen = null;
    let pendingAudience = { kind: 'logged-out', user: null };

    function getReleaseChannel() {
        const monitoring = window.BARK.monitoring;
        if (monitoring && typeof monitoring.getReleaseChannel === 'function') {
            return monitoring.getReleaseChannel();
        }
        return 'unknown';
    }

    function isTrackableRelease() {
        const release = getReleaseChannel();
        return release === 'production' || release === 'beta';
    }

    function safeLogEvent(name, parameters) {
        if (!analytics || typeof analytics.logEvent !== 'function') return false;
        try {
            analytics.logEvent(name, parameters);
            return true;
        } catch (_error) {
            return false;
        }
    }

    function applyAudience() {
        if (!analytics) return;
        const kind = VALID_AUDIENCES.has(pendingAudience.kind)
            ? pendingAudience.kind
            : 'logged-out';
        const user = pendingAudience.user;
        const signedIn = Boolean(user && typeof user.uid === 'string' && user.uid);

        try {
            // Firebase Auth UIDs are internal pseudonymous identifiers. Never
            // send email, name, GPS, search text, park notes, or route details.
            analytics.setUserId(signedIn ? user.uid : null);
            analytics.setUserProperties({
                auth_state: signedIn ? 'signed_in' : 'logged_out',
                plan: kind === 'premium' ? 'premium' : (signedIn ? 'free' : 'logged_out'),
                release_channel: getReleaseChannel()
            });
        } catch (_error) { /* analytics must never affect auth */ }
    }

    function setAudience(kind, user) {
        pendingAudience = {
            kind: VALID_AUDIENCES.has(kind) ? kind : 'logged-out',
            user: user && user.uid ? { uid: String(user.uid) } : null
        };
        applyAudience();
    }

    function trackScreen(targetId, options = {}) {
        const screenName = SCREEN_NAMES[targetId] || null;
        if (!screenName || !analytics) return false;
        if (screenName === lastScreen && options.force !== true) return false;
        lastScreen = screenName;
        return safeLogEvent('bark_screen_view', {
            screen_name: screenName,
            release_channel: getReleaseChannel()
        });
    }

    function currentScreenTarget() {
        const active = document.querySelector('.nav-item.active[data-target]');
        return active ? active.getAttribute('data-target') : 'map-view';
    }

    async function init() {
        if (initialized) return Boolean(analytics);
        initialized = true;
        if (!isTrackableRelease()) return false;
        if (typeof firebase === 'undefined' || typeof firebase.analytics !== 'function') return false;

        try {
            analytics = firebase.analytics();
            analytics.setAnalyticsCollectionEnabled(true);
            applyAudience();
            safeLogEvent('bark_app_opened', { release_channel: getReleaseChannel() });
            trackScreen(currentScreenTarget(), { force: true });
            return true;
        } catch (error) {
            analytics = null;
            console.warn('[analytics] Visitor analytics could not initialize.', error && error.message);
            return false;
        }
    }

    window.BARK.visitorAnalytics = Object.freeze({
        init,
        setAudience,
        trackScreen,
        getReleaseChannel
    });
})();
