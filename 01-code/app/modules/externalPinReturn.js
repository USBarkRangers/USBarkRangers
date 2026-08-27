/**
 * externalPinReturn.js — Restores a park card after an external-site return.
 *
 * The external handoff controller must fully hide and empty the live card while
 * Safari/Chrome owns the screen. This module remembers only the stable park ID
 * and rebuilds the card from the current marker after viewport recovery settles.
 */
(function initExternalPinReturn() {
    window.BARK = window.BARK || {};

    const STORAGE_KEY = 'bark_external_pin_return_v1';
    const MAX_SNAPSHOT_AGE_MS = 4 * 60 * 60 * 1000;
    const RESTORE_RETRY_DELAYS_MS = [0, 120, 420, 900];

    let memorySnapshot = null;
    let restoreGeneration = 0;

    function removeStoredSnapshot() {
        memorySnapshot = null;
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (_error) {
            // In-memory state still covers browsers that restrict sessionStorage.
        }
    }

    function isValidSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return false;
        if (typeof snapshot.parkId !== 'string' || !snapshot.parkId.trim()) return false;
        const capturedAt = Number(snapshot.capturedAt);
        return Number.isFinite(capturedAt)
            && capturedAt > 0
            && (Date.now() - capturedAt) <= MAX_SNAPSHOT_AGE_MS;
    }

    function readSnapshot() {
        if (isValidSnapshot(memorySnapshot)) return memorySnapshot;

        try {
            const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
            if (isValidSnapshot(parsed)) {
                memorySnapshot = parsed;
                return parsed;
            }
        } catch (_error) {
            // A malformed or unavailable session store should behave as no snapshot.
        }

        removeStoredSnapshot();
        return null;
    }

    function writeSnapshot(snapshot) {
        memorySnapshot = snapshot;
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch (_error) {
            // The live document can still restore from memory.
        }
    }

    function capture(options = {}) {
        restoreGeneration += 1;
        removeStoredSnapshot();
        if (options.preservePinPopup !== true) return false;

        const panel = document.getElementById('slide-panel');
        const marker = window.BARK.activePinMarker;
        const parkData = marker && marker._parkData;
        const parkId = parkData && parkData.id != null ? String(parkData.id).trim() : '';
        if (!panel || !panel.classList.contains('open') || !parkId) return false;

        const panelContent = panel.querySelector('.panel-content');
        writeSnapshot({
            parkId,
            scrollTop: panelContent ? Math.max(0, Number(panelContent.scrollTop) || 0) : 0,
            capturedAt: Date.now()
        });
        return true;
    }

    function isMapViewActive() {
        if (typeof window.BARK.isMapVisibleByDefaultViewState === 'function') {
            return window.BARK.isMapVisibleByDefaultViewState();
        }
        return Boolean(document.querySelector('.nav-item.active[data-target="map-view"]'))
            && !document.querySelector('.ui-view.active');
    }

    function findMarkerByParkId(parkId) {
        const manager = window.BARK.markerManager;
        const markers = manager && manager.markers;
        if (!markers || typeof markers.get !== 'function') return null;

        const directMatch = markers.get(parkId);
        if (directMatch && directMatch._parkData) return directMatch;

        for (const marker of markers.values()) {
            if (marker && marker._parkData && String(marker._parkData.id) === parkId) return marker;
        }
        return null;
    }

    function tryRestore(snapshot, generation, isFinalAttempt) {
        if (generation !== restoreGeneration) return;

        const currentSnapshot = readSnapshot();
        if (!currentSnapshot || currentSnapshot.capturedAt !== snapshot.capturedAt) return;

        const panel = document.getElementById('slide-panel');
        if (!isMapViewActive() || window.BARK.activePinMarker || (panel && panel.classList.contains('open'))) {
            removeStoredSnapshot();
            return;
        }

        const manager = window.BARK.markerManager;
        const marker = findMarkerByParkId(snapshot.parkId);
        if (!manager || typeof manager.renderMarkerPanel !== 'function' || !marker) {
            if (isFinalAttempt) removeStoredSnapshot();
            return;
        }

        removeStoredSnapshot();
        manager.renderMarkerPanel(marker, { externalReturnRestore: true });

        requestAnimationFrame(() => {
            const panelContent = document.querySelector('#slide-panel .panel-content');
            if (panelContent && window.BARK.activePinMarker === marker) {
                const maxScroll = Math.max(0, panelContent.scrollHeight - panelContent.clientHeight);
                panelContent.scrollTop = Math.min(snapshot.scrollTop, maxScroll);
            }
        });
    }

    function requestRestore() {
        const snapshot = readSnapshot();
        if (!snapshot) return false;

        const generation = ++restoreGeneration;
        RESTORE_RETRY_DELAYS_MS.forEach((delay, index) => {
            setTimeout(() => {
                tryRestore(snapshot, generation, index === RESTORE_RETRY_DELAYS_MS.length - 1);
            }, delay);
        });
        return true;
    }

    function cancel() {
        restoreGeneration += 1;
        removeStoredSnapshot();
    }

    window.addEventListener('bark:external-return-settled', () => {
        // Defer one task so a pin clicked during Safari's return can win before
        // the remembered selection is considered for restoration.
        setTimeout(requestRestore, 0);
    });

    window.BARK.externalPinReturn = Object.freeze({
        cancel,
        capture,
        requestRestore
    });
})();
