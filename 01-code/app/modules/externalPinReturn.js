/**
 * externalPinReturn.js — Restores a park card after an external-site return.
 *
 * The external handoff controller must fully hide and empty the live card while
 * Safari/Chrome owns the screen. This module remembers the stable park ID and the
 * card's scroll position, then rebuilds the card from the current marker as soon
 * as app return begins. Viewport recovery can then finish without making the card
 * slide away and back.
 */
(function initExternalPinReturn() {
    window.BARK = window.BARK || {};

    const STORAGE_KEY = 'bark_external_pin_return_v1';
    const RETURN_VISIBLE_CLASS = 'bark-external-pin-return-visible';
    const MAX_SNAPSHOT_AGE_MS = 4 * 60 * 60 * 1000;
    const RESTORE_RETRY_DELAYS_MS = [0, 120, 420, 900];
    const SCROLL_RESTORE_DELAYS_MS = [120, 420, 900, 1400];
    const MAX_SAVED_SCROLL_TOP = 10_000_000;

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

    function normalizeScrollTop(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return 0;
        return Math.min(numeric, MAX_SAVED_SCROLL_TOP);
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
            scrollTop: normalizeScrollTop(panelContent && panelContent.scrollTop),
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

    function schedulePanelScrollRestore(marker, savedScrollTop, generation) {
        const targetScrollTop = normalizeScrollTop(savedScrollTop);
        const apply = () => {
            if (generation !== restoreGeneration || window.BARK.activePinMarker !== marker) return;

            const panel = document.getElementById('slide-panel');
            const panelContent = panel && panel.querySelector('.panel-content');
            if (!panel || !panel.classList.contains('open') || !panelContent) return;

            const maxScrollTop = Math.max(0, panelContent.scrollHeight - panelContent.clientHeight);
            panelContent.scrollTop = Math.min(targetScrollTop, maxScrollTop);
        };

        // Render is synchronous, but mobile browser chrome and image/text layout can
        // settle over several frames after an external sheet closes. Reapply the
        // same absolute card position while the exact restored marker still owns it.
        apply();
        requestAnimationFrame(() => requestAnimationFrame(apply));
        SCROLL_RESTORE_DELAYS_MS.forEach(delay => setTimeout(apply, delay));
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
        document.body.classList.add(RETURN_VISIBLE_CLASS);
        schedulePanelScrollRestore(marker, snapshot.scrollTop, generation);
    }

    function requestRestore(options = {}) {
        const snapshot = readSnapshot();
        if (!snapshot) return false;

        const generation = ++restoreGeneration;
        if (options.immediate === true) {
            tryRestore(snapshot, generation, false);
        }

        RESTORE_RETRY_DELAYS_MS
            .filter(delay => options.immediate !== true || delay > 0)
            .forEach((delay, index, delays) => {
                setTimeout(() => {
                    tryRestore(snapshot, generation, index === delays.length - 1);
                }, delay);
            });
        return true;
    }

    function cancel() {
        restoreGeneration += 1;
        removeStoredSnapshot();
        document.body.classList.remove(RETURN_VISIBLE_CLASS);
    }

    window.addEventListener('bark:external-return-started', () => {
        // Rebuild while the handoff guard still owns the compositor. CSS reveals
        // the fresh card already in its final position, without a down/up slide.
        requestRestore({ immediate: true });
    });

    window.addEventListener('bark:external-return-settled', () => {
        document.body.classList.remove(RETURN_VISIBLE_CLASS);
        // Fallback for a return signal that arrived before markers were ready.
        // Defer one task so a newly clicked pin still wins the race.
        setTimeout(requestRestore, 0);
    });

    window.BARK.externalPinReturn = Object.freeze({
        cancel,
        capture,
        requestRestore
    });
})();
