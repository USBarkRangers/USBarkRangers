/**
 * RefreshCoordinator.js - Additive refresh coordination seam.
 *
 * Phase 2B only: this delegates to existing refresh functions and does not
 * own data, subscribe to repositories, or replace current direct refresh calls.
 */
(function () {
    window.BARK = window.BARK || {};

    const stats = {
        visitedCacheRefreshCount: 0,
        visitedVisualRefreshCount: 0,
        visitDerivedUiRefreshCount: 0,
        allVisitDerivedRefreshCount: 0,
        stateSyncRequestCount: 0,
        visitStateSyncRequestCount: 0,
        lastReason: null
    };

    function normalizeReason(reason) {
        if (reason === undefined || reason === null || reason === '') return 'unspecified';
        return String(reason);
    }

    function debugEnabled() {
        return window.BARK.debugRefreshCoordinator === true ||
            window.BARK.debugRefresh === true ||
            window.BARK.debug === true;
    }

    function debugLog(message, details) {
        if (!debugEnabled() || !window.console || typeof window.console.debug !== 'function') return;
        window.console.debug('[RefreshCoordinator]', message, details || '');
    }

    function remember(reason) {
        stats.lastReason = normalizeReason(reason);
        return stats.lastReason;
    }

    function callExisting(label, callback) {
        if (typeof callback !== 'function') return false;

        try {
            callback();
            return true;
        } catch (error) {
            debugLog(`${label} failed`, error);
            return false;
        }
    }

    function getFirebaseRefresh() {
        const firebaseService = window.BARK.services && window.BARK.services.firebase;
        return firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function'
            ? () => firebaseService.refreshVisitedVisualState()
            : null;
    }

    function refreshVisitedCache(reason) {
        const lastReason = remember(reason);
        stats.visitedCacheRefreshCount++;
        debugLog('refreshVisitedCache', { reason: lastReason });

        callExisting('invalidateVisitedIdsCache', () => {
            if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
                window.BARK.invalidateVisitedIdsCache();
            }
        });
    }

    function refreshVisitedVisuals(reason) {
        const lastReason = remember(reason);
        stats.visitedVisualRefreshCount++;
        debugLog('refreshVisitedVisuals', { reason: lastReason });

        const existingFirebaseRefresh = getFirebaseRefresh();
        if (callExisting('refreshVisitedVisualState', existingFirebaseRefresh)) return;

        callExisting('markerManager.refreshMarkerStyles', () => {
            const markerManager = window.BARK.markerManager;
            if (markerManager && typeof markerManager.refreshMarkerStyles === 'function') {
                markerManager.refreshMarkerStyles();
            }
        });

        callExisting('tripLayer.refreshBadgeStyles', () => {
            const tripLayer = window.BARK.tripLayer;
            if (tripLayer && typeof tripLayer.refreshBadgeStyles === 'function') {
                tripLayer.refreshBadgeStyles();
            }
        });
    }

    function refreshVisitDerivedUi(reason) {
        const lastReason = remember(reason);
        stats.visitDerivedUiRefreshCount++;
        debugLog('refreshVisitDerivedUi', { reason: lastReason });

        callExisting('syncState', () => {
            if (typeof window.syncState === 'function') window.syncState();
        });

        callExisting('updateStatsUI', () => {
            if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
        });
    }

    function requestStateSync(reason) {
        const lastReason = remember(reason);
        stats.stateSyncRequestCount++;
        debugLog('requestStateSync', { reason: lastReason });

        callExisting('syncState', () => {
            if (typeof window.syncState === 'function') window.syncState();
        });
    }

    function requestVisitStateSync(reason) {
        const lastReason = remember(reason);
        stats.visitStateSyncRequestCount++;
        debugLog('requestVisitStateSync', { reason: lastReason });
        requestStateSync(lastReason);
    }

    function refreshAllVisitDerived(reason) {
        const lastReason = remember(reason);
        stats.allVisitDerivedRefreshCount++;
        debugLog('refreshAllVisitDerived', { reason: lastReason });

        refreshVisitedCache(lastReason);
        refreshVisitedVisuals(lastReason);
        refreshVisitDerivedUi(lastReason);
    }

    function getStats() {
        return Object.freeze({ ...stats });
    }

    window.BARK.refreshCoordinator = {
        refreshVisitedCache,
        refreshVisitedVisuals,
        refreshVisitDerivedUi,
        refreshAllVisitDerived,
        requestStateSync,
        requestVisitStateSync,
        getStats
    };
})();
