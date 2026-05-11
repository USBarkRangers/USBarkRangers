/**
 * ParkRepo.js - Canonical park record repository.
 *
 * Phase 1A owns the canonical park array. Consumers read through this repo.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.repos = window.BARK.repos || {};

    const DATA_REFRESH_SAFETY_MIN_PREVIOUS_COUNT = 50;
    const DATA_REFRESH_SAFETY_MAX_COUNT_DROP_RATIO = 0.10;
    const DATA_REFRESH_SAFETY_MIN_ID_DROP_COUNT = 25;
    const DATA_REFRESH_SAFETY_MAX_ID_DROP_RATIO = 0.10;

    let allPoints = [];
    let markerDataRevision = 0;
    const lookup = new Map();
    const listeners = new Set();

    function cleanValue(value) {
        if (value === undefined || value === null) return '';
        return String(value).trim();
    }

    function isLegacyParkId(id) {
        return /^-?\d+\.\d{2}_-?\d+\.\d{2}$/.test(cleanValue(id));
    }

    function isCanonicalParkId(id) {
        const value = cleanValue(id);
        return Boolean(value && value.toLowerCase() !== 'unknown' && !isLegacyParkId(value));
    }

    function shouldRejectDataRefresh(previousCount, nextCount, droppedIdCount) {
        if (previousCount < DATA_REFRESH_SAFETY_MIN_PREVIOUS_COUNT || droppedIdCount === 0) return false;

        const countDrop = Math.max(0, previousCount - nextCount);
        const rejectedByCountCollapse = (countDrop / previousCount) >= DATA_REFRESH_SAFETY_MAX_COUNT_DROP_RATIO;
        const rejectedByIdCollapse = droppedIdCount >= Math.max(
            DATA_REFRESH_SAFETY_MIN_ID_DROP_COUNT,
            Math.ceil(previousCount * DATA_REFRESH_SAFETY_MAX_ID_DROP_RATIO)
        );

        return rejectedByCountCollapse || rejectedByIdCollapse;
    }

    function getAll() {
        return allPoints;
    }

    function getById(id) {
        return lookup.get(id) || null;
    }

    function getLookup() {
        return lookup;
    }

    function getRevision() {
        return markerDataRevision;
    }

    function setMarkerBackedPark(point) {
        if (!point || !point.id) return;
        lookup.set(point.id, point);
    }

    function removePark(id) {
        lookup.delete(id);
    }

    function pruneToIds(ids) {
        if (!(ids instanceof Set)) return;
        lookup.forEach((_, id) => {
            if (!ids.has(id)) lookup.delete(id);
        });
    }

    function notify(change) {
        listeners.forEach((listener) => {
            try {
                listener(change);
            } catch (error) {
                console.error('[ParkRepo] subscriber failed.', error);
            }
        });
    }

    function replaceAll(nextPoints, options = {}) {
        const previousPoints = allPoints;
        const incomingPoints = Array.isArray(nextPoints) ? nextPoints : [];
        const previousById = new Map(previousPoints.filter(point => point && point.id).map(point => [point.id, point]));
        const nextById = new Map(incomingPoints.filter(point => point && point.id).map(point => [point.id, point]));
        const nextIds = new Set(incomingPoints.map(point => point && point.id));
        const droppedCanonicalIds = previousPoints
            .map(point => point && point.id)
            .filter(isCanonicalParkId)
            .filter(id => !nextIds.has(id));
        const added = new Set();
        const removed = new Set();
        const changed = new Set();

        nextById.forEach((point, id) => {
            if (!previousById.has(id)) {
                added.add(id);
            } else if (previousById.get(id) !== point) {
                changed.add(id);
            }
        });
        previousById.forEach((_, id) => {
            if (!nextById.has(id)) removed.add(id);
        });

        if (shouldRejectDataRefresh(previousPoints.length, incomingPoints.length, droppedCanonicalIds.length)) {
            console.warn('[ParkRepo] Rejected destructive data refresh. A background CSV poll attempted to drop existing Park IDs.', {
                previousCount: previousPoints.length,
                nextCount: incomingPoints.length,
                droppedCount: droppedCanonicalIds.length,
                sampleDroppedIds: droppedCanonicalIds.slice(0, 10)
            });
            return {
                accepted: false,
                previousPoints,
                points: previousPoints,
                droppedCanonicalIds
            };
        }

        if (droppedCanonicalIds.length > 0 && options.debug === true) {
            console.info('[ParkRepo] Accepted data refresh with minor Park ID changes.', {
                previousCount: previousPoints.length,
                nextCount: incomingPoints.length,
                changedCount: droppedCanonicalIds.length,
                sampleChangedIds: droppedCanonicalIds.slice(0, 10)
            });
        }

        allPoints = incomingPoints;
        lookup.clear();
        allPoints.forEach((point) => {
            if (point && point.id) lookup.set(point.id, point);
        });

        markerDataRevision++;
        window.BARK._markerDataRevision = markerDataRevision;

        const change = Object.freeze({
            type: 'replaceAll',
            added,
            removed,
            changed,
            previousPoints,
            points: allPoints,
            revision: markerDataRevision
        });
        notify(change);

        return {
            accepted: true,
            previousPoints,
            points: allPoints,
            droppedCanonicalIds,
            added,
            removed,
            changed,
            revision: markerDataRevision
        };
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new Error('[ParkRepo] subscribe(listener) requires a function.');
        }
        listeners.add(listener);
        return function unsubscribe() {
            listeners.delete(listener);
        };
    }

    window.BARK.repos.ParkRepo = {
        getAll,
        getById,
        getLookup,
        getRevision,
        setMarkerBackedPark,
        removePark,
        pruneToIds,
        replaceAll,
        subscribe
    };
})();
