/**
 * loadState.js — truthful client-side loading state for park data and Profile data.
 *
 * This module does not fetch anything. It observes the canonical repositories and
 * auth hydration flags that already exist, then gives UI modules one shared answer
 * to two questions:
 *   1. Are park pins still loading, genuinely unavailable, or ready?
 *   2. Is a signed-in user's saved visit data authoritative yet?
 *
 * Keeping this read-only prevents loading UI from accidentally creating extra
 * Firebase reads, retries, or writes.
 */
(function initLoadState() {
    window.BARK = window.BARK || {};

    const DEFAULT_SLOW_THRESHOLD_MS = 4500;
    let parkState = 'idle';
    let slowTimer = null;

    function getParkRepo() {
        return window.BARK.repos && window.BARK.repos.ParkRepo;
    }

    function getParkCount() {
        const parkRepo = getParkRepo();
        if (!parkRepo || typeof parkRepo.getAll !== 'function') return 0;
        const parks = parkRepo.getAll();
        return Array.isArray(parks) ? parks.length : 0;
    }

    function clearSlowTimer() {
        if (slowTimer === null) return;
        clearTimeout(slowTimer);
        slowTimer = null;
    }

    function getParkStatusMessage() {
        if (parkState === 'offline') {
            return {
                title: 'Park pins are waiting for a connection',
                detail: 'The app will retry automatically when service returns.'
            };
        }
        if (parkState === 'unavailable') {
            return {
                title: 'Park pins could not finish loading',
                detail: 'Check your connection. The app will keep its safe retry schedule.'
            };
        }
        return {
            title: 'Loading is taking longer than usual',
            detail: 'Park pins will appear automatically when the data arrives.'
        };
    }

    function renderParkStatus() {
        const banner = document.getElementById('park-data-status');
        if (!banner) return;

        const shouldShow = parkState === 'slow' || parkState === 'offline' || parkState === 'unavailable';
        banner.hidden = !shouldShow;
        banner.dataset.state = parkState;

        if (!shouldShow) return;
        const message = getParkStatusMessage();
        const title = document.getElementById('park-data-status-title');
        const detail = document.getElementById('park-data-status-detail');
        if (title) title.textContent = message.title;
        if (detail) detail.textContent = message.detail;
    }

    function markParkDataReady() {
        clearSlowTimer();
        parkState = 'ready';
        renderParkStatus();
    }

    function beginParkLoad(options = {}) {
        clearSlowTimer();
        if (getParkCount() > 0) {
            markParkDataReady();
            return;
        }

        parkState = navigator.onLine === false ? 'offline' : 'loading';
        renderParkStatus();

        const requestedThreshold = Number(options.slowAfterMs);
        const slowAfterMs = Number.isFinite(requestedThreshold) && requestedThreshold >= 0
            ? requestedThreshold
            : DEFAULT_SLOW_THRESHOLD_MS;

        slowTimer = setTimeout(() => {
            slowTimer = null;
            if (getParkCount() > 0) {
                markParkDataReady();
                return;
            }
            parkState = navigator.onLine === false ? 'offline' : 'slow';
            renderParkStatus();
        }, slowAfterMs);
    }

    function markParkDataUnavailable() {
        if (getParkCount() > 0) {
            markParkDataReady();
            return;
        }
        clearSlowTimer();
        parkState = navigator.onLine === false ? 'offline' : 'unavailable';
        renderParkStatus();
    }

    function isProfileDataReady() {
        // Until Firebase's first auth callback runs, signed-out and signed-in are
        // indistinguishable. Showing a dash avoids flashing a false zero or a prior
        // account's score during that short window.
        if (window._authStateResolved !== true) return false;

        let currentUser = null;
        try {
            currentUser = typeof firebase !== 'undefined' && firebase.auth
                ? firebase.auth().currentUser
                : null;
        } catch (error) {
            return false;
        }

        // A resolved signed-out session has no cloud score to wait for; local zero
        // is legitimate. Signed-in data is ready only after both paid-for snapshots
        // are authoritative (not cache-only and not pending writes).
        if (!currentUser) return true;
        return window._firstServerPayloadReceived === true
            && window._visitedPlacesServerSnapshotReceived === true;
    }

    const parkRepo = getParkRepo();
    if (parkRepo && typeof parkRepo.subscribe === 'function') {
        parkRepo.subscribe(() => {
            if (getParkCount() > 0) markParkDataReady();
        });
    }

    window.addEventListener('offline', () => {
        if (getParkCount() > 0 || parkState === 'idle') return;
        clearSlowTimer();
        parkState = 'offline';
        renderParkStatus();
    });

    window.addEventListener('online', () => {
        if (getParkCount() > 0 || parkState === 'idle') return;
        beginParkLoad();
    });

    window.BARK.loadState = Object.freeze({
        beginParkLoad,
        markParkDataReady,
        markParkDataUnavailable,
        isProfileDataReady,
        getParkState: () => parkState,
        getParkCount
    });
})();
