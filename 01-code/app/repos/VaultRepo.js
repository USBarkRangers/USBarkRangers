/**
 * VaultRepo.js - User visit repository.
 *
 * Owns the visit Map behind explicit repository APIs.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.repos = window.BARK.repos || {};

    let visits = new Map();
    const pending = new Map();
    const canonicalReplacementIds = new Map();
    let revision = 0;
    const listeners = new Set();
    let activeSubscriptionUid = null;
    let activeSubscriptionUnsubscribe = null;

    function getVisitId(placeOrId) {
        if (placeOrId && typeof placeOrId === 'object') return placeOrId.id || null;
        return placeOrId || null;
    }

    function cloneVisit(visit) {
        if (!visit || typeof visit !== 'object') return visit;
        return { ...visit };
    }

    function freezeVisit(visit) {
        const clone = cloneVisit(visit);
        return clone && typeof clone === 'object' ? Object.freeze(clone) : clone;
    }

    function clonePendingMutation(mutation) {
        if (!mutation || typeof mutation !== 'object') return mutation;
        return Object.freeze({
            ...mutation,
            place: freezeVisit(mutation.place)
        });
    }

    function normalizeVisitArray(nextVisits) {
        if (nextVisits instanceof Map) return Array.from(nextVisits.values());
        if (Array.isArray(nextVisits)) return nextVisits;
        return [];
    }

    function cloneMap(source) {
        const nextMap = new Map();
        normalizeVisitArray(source).forEach((visit) => {
            if (visit && visit.id) nextMap.set(visit.id, cloneVisit(visit));
        });
        return nextMap;
    }

    function replacePending(nextPending) {
        pending.clear();
        nextPending.forEach((mutation, id) => {
            pending.set(id, clonePendingMutation(mutation));
        });
    }

    function pruneCanonicalReplacementIds(activeVisits) {
        canonicalReplacementIds.forEach((targetId, sourceId) => {
            if (activeVisits.has(sourceId) || !activeVisits.has(targetId)) {
                canonicalReplacementIds.delete(sourceId);
            }
        });
    }

    function getCanonicalReplacementTarget(sourceId) {
        const targetId = canonicalReplacementIds.get(sourceId);
        if (!targetId || visits.has(sourceId) || !visits.has(targetId)) return null;
        return targetId;
    }

    function normalizeCanonicalReplacementIds(replacement) {
        if (!replacement || typeof replacement !== 'object') return [];
        return [replacement.sourceId, replacement.visitId, replacement.id]
            .map(getVisitId)
            .filter(id => id !== undefined && id !== null && id !== '');
    }

    function applyCanonicalReplacementCleanup(nextVisits, options = {}) {
        const replacements = Array.isArray(options.canonicalReplacements)
            ? options.canonicalReplacements
            : [];

        replacements.forEach((replacement) => {
            const targetId = getVisitId(replacement && replacement.targetId);
            if (!targetId || !nextVisits.has(targetId)) return;

            normalizeCanonicalReplacementIds(replacement).forEach((sourceId) => {
                if (!sourceId || sourceId === targetId || nextVisits.has(sourceId)) return;
                pending.delete(sourceId);
                canonicalReplacementIds.set(sourceId, targetId);
            });
        });

        pruneCanonicalReplacementIds(nextVisits);
    }

    function idsFromMap(map) {
        return new Set(map.keys());
    }

    function recordsMatch(left, right) {
        if (!left || !right) return false;
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) {
            if (stringifyVisitValue(left[key]) !== stringifyVisitValue(right[key])) return false;
        }
        return true;
    }

    function stringifyVisitValue(value) {
        if (value && typeof value === 'object') {
            const sorted = {};
            Object.keys(value).sort().forEach(key => { sorted[key] = value[key]; });
            return JSON.stringify(sorted);
        }
        return JSON.stringify(value);
    }

    function isAuthoritativeSnapshot(metadata = {}) {
        return metadata.fromCache !== true && metadata.hasPendingWrites !== true;
    }

    function buildChange(type, previousVisits, nextVisits) {
        const added = new Set();
        const removed = new Set();
        const changed = new Set();

        nextVisits.forEach((visit, id) => {
            if (!previousVisits.has(id)) {
                added.add(id);
            } else if (!recordsMatch(previousVisits.get(id), visit)) {
                changed.add(id);
            }
        });

        previousVisits.forEach((_, id) => {
            if (!nextVisits.has(id)) removed.add(id);
        });

        return Object.freeze({
            type,
            added,
            removed,
            changed,
            revision
        });
    }

    function notify(change) {
        listeners.forEach((listener) => {
            try {
                listener(change);
            } catch (error) {
                console.error('[VaultRepo] subscriber failed.', error);
            }
        });
    }

    function commit(type, nextVisits) {
        const previousVisits = visits;
        visits = nextVisits;
        pruneCanonicalReplacementIds(visits);
        revision++;
        const change = buildChange(type, previousVisits, visits);
        notify(change);
        return change;
    }

    function getVisits() {
        return Object.freeze(Array.from(visits.values()).map(freezeVisit));
    }

    function getVisit(parkId) {
        const id = getVisitId(parkId);
        return freezeVisit(visits.get(id) || null);
    }

    function hasVisit(parkId) {
        return visits.has(getVisitId(parkId));
    }

    function size() {
        return visits.size;
    }

    function getVisitedIds() {
        return Object.freeze(Array.from(visits.keys()));
    }

    function entries() {
        return Object.freeze(Array.from(visits.entries()).map(([id, visit]) => Object.freeze([id, freezeVisit(visit)])));
    }

    function addVisit(visit) {
        if (!visit || !visit.id) return null;
        const nextVisits = new Map(visits);
        nextVisits.set(visit.id, cloneVisit(visit));
        return commit('addVisit', nextVisits);
    }

    function removeVisit(parkId) {
        const id = getVisitId(parkId);
        const nextVisits = new Map(visits);
        nextVisits.delete(id);
        return commit('removeVisit', nextVisits);
    }

    function removeVisits(parkIds) {
        const ids = Array.isArray(parkIds) ? parkIds : [];
        const nextVisits = new Map(visits);
        ids.forEach((id) => nextVisits.delete(getVisitId(id)));
        return commit('removeVisits', nextVisits);
    }

    function replaceAll(nextVisitsArray, options = {}) {
        const nextVisits = cloneMap(nextVisitsArray);
        applyCanonicalReplacementCleanup(nextVisits, options);
        return commit('replaceAll', nextVisits);
    }

    function setVisits(nextVisitsArray) {
        return replaceAll(nextVisitsArray);
    }

    function clear() {
        pending.clear();
        canonicalReplacementIds.clear();
        return commit('clear', new Map());
    }

    function snapshot() {
        return Object.freeze({
            visits: cloneMap(visits),
            pending: new Map(pending),
            revision
        });
    }

    function createRollbackToken(baseToken, touchedIds) {
        if (!baseToken || !(baseToken.visits instanceof Map) || !Array.isArray(touchedIds)) {
            throw new Error('[VaultRepo] createRollbackToken(baseToken, touchedIds) requires a snapshot token and id array.');
        }

        const touched = new Map();
        touchedIds
            .map(getVisitId)
            .filter(id => id !== undefined && id !== null && id !== '')
            .forEach((id) => {
                if (touched.has(id)) return;
                const beforeExists = baseToken.visits.has(id);
                const optimisticExists = visits.has(id);
                const pendingBeforeExists = baseToken.pending instanceof Map && baseToken.pending.has(id);
                touched.set(id, Object.freeze({
                    beforeExists,
                    before: beforeExists ? freezeVisit(baseToken.visits.get(id)) : null,
                    optimisticExists,
                    optimistic: optimisticExists ? freezeVisit(visits.get(id)) : null,
                    pendingBeforeExists,
                    pendingBefore: pendingBeforeExists ? clonePendingMutation(baseToken.pending.get(id)) : null
                }));
            });

        return Object.freeze({
            kind: 'operationRollback',
            baseRevision: baseToken.revision,
            revisionAfterOptimistic: revision,
            touched
        });
    }

    function restore(token) {
        if (!token) {
            throw new Error('[VaultRepo] restore(token) requires a snapshot token.');
        }

        if (token.kind === 'operationRollback') {
            return restoreOperationRollback(token);
        }

        if (!(token.visits instanceof Map)) {
            throw new Error('[VaultRepo] restore(token) requires a snapshot token.');
        }

        if (revision !== token.revision) {
            console.warn('[VaultRepo] Refused stale full restore. Use createRollbackToken() for operation rollback.', {
                currentRevision: revision,
                tokenRevision: token.revision
            });
            return Object.freeze({
                restored: false,
                conflict: true,
                revision,
                tokenRevision: token.revision
            });
        }

        pending.clear();
        canonicalReplacementIds.clear();
        if (token.pending instanceof Map) {
            token.pending.forEach((value, key) => pending.set(key, clonePendingMutation(value)));
        }
        return commit('restore', cloneMap(token.visits));
    }

    function restoreOperationRollback(token) {
        // If newer state has landed, rollback may preserve pending local state until an authoritative snapshot reconciles it.
        const nextVisits = new Map(visits);
        const nextPending = new Map(pending);
        const restored = new Set();
        const skipped = new Set();
        const protectedCanonicalIds = new Set();
        let pendingChanged = false;

        token.touched.forEach((entry, id) => {
            if (!entry.beforeExists) return;
            const replacementId = getCanonicalReplacementTarget(id);
            if (replacementId) protectedCanonicalIds.add(replacementId);
        });

        token.touched.forEach((entry, id) => {
            const replacementId = getCanonicalReplacementTarget(id);
            if (entry.beforeExists && replacementId) {
                if (nextPending.delete(id)) pendingChanged = true;
                skipped.add(id);
                return;
            }

            if (!entry.beforeExists && protectedCanonicalIds.has(id)) {
                skipped.add(id);
                return;
            }

            const currentExists = visits.has(id);
            const currentValue = visits.get(id);
            const currentMatchesOptimistic = entry.optimisticExists
                ? (currentExists && recordsMatch(currentValue, entry.optimistic))
                : !currentExists;

            if (!currentMatchesOptimistic) {
                skipped.add(id);
                return;
            }

            if (entry.beforeExists) {
                nextVisits.set(id, cloneVisit(entry.before));
            } else {
                nextVisits.delete(id);
            }

            if (entry.pendingBeforeExists) {
                nextPending.set(id, clonePendingMutation(entry.pendingBefore));
            } else {
                nextPending.delete(id);
            }

            restored.add(id);
        });

        if (restored.size === 0) {
            if (pendingChanged) replacePending(nextPending);
            return Object.freeze({
                type: 'restoreConflictAware',
                restored,
                skipped,
                revision,
                conflict: skipped.size > 0,
                pendingChanged
            });
        }

        replacePending(nextPending);
        const change = commit('restoreConflictAware', nextVisits);
        return Object.freeze({
            change,
            restored,
            skipped,
            revision: change.revision,
            conflict: skipped.size > 0
        });
    }

    function assertWriteIsNotDestructive(nextVisitsArray) {
        const nextVisits = cloneMap(nextVisitsArray);
        const nextIds = idsFromMap(nextVisits);
        const unexpectedDrops = [];

        visits.forEach((visit, id) => {
            if (nextIds.has(id)) return;
            const staged = pending.get(id);
            if (!staged || staged.type !== 'delete') unexpectedDrops.push(id);
        });

        const destructiveDropThreshold = Math.max(3, Math.ceil(visits.size * 0.25));
        if (visits.size >= 3 && unexpectedDrops.length >= destructiveDropThreshold) {
            throw new Error(`Refusing destructive visitedPlaces write: ${unexpectedDrops.length} unstaged visit(s) would be removed.`);
        }

        return true;
    }

    function stageUpsert(visit) {
        if (!visit || !visit.id) return;
        pending.set(visit.id, Object.freeze({
            type: 'upsert',
            place: freezeVisit(visit),
            startedAt: Date.now()
        }));
    }

    function stageDelete(parkId) {
        const id = getVisitId(parkId);
        if (!id) return;
        pending.set(id, Object.freeze({
            type: 'delete',
            place: null,
            startedAt: Date.now()
        }));
    }

    function clearPendingMutation(parkId) {
        pending.delete(getVisitId(parkId));
    }

    function clearPendingMutations() {
        pending.clear();
    }

    function reconcileSnapshot(visitsArray, metadata = {}) {
        const nextVisits = cloneMap(visitsArray);
        const snapshotCanConfirm = isAuthoritativeSnapshot(metadata);

        pending.forEach((mutation, placeId) => {
            if (mutation.type === 'delete') {
                if (snapshotCanConfirm && !nextVisits.has(placeId)) {
                    pending.delete(placeId);
                    return;
                }
                nextVisits.delete(placeId);
                return;
            }

            const snapshotPlace = nextVisits.get(placeId);
            if (snapshotCanConfirm && recordsMatch(snapshotPlace, mutation.place)) {
                pending.delete(placeId);
                return;
            }

            nextVisits.set(placeId, cloneVisit(mutation.place));
        });

        const change = commit('reconcileSnapshot', nextVisits);
        return Object.freeze({
            change,
            visits: getVisits(),
            metadata: metadata ? Object.freeze({ ...metadata }) : Object.freeze({})
        });
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new Error('[VaultRepo] subscribe(listener) requires a function.');
        }
        listeners.add(listener);
        return function unsubscribe() {
            listeners.delete(listener);
        };
    }

    function assertNonEmptyUid(uid) {
        if (uid === undefined || uid === null || String(uid).trim() === '') {
            throw new Error('[VaultRepo] startSubscription(uid) requires a non-empty uid.');
        }
        return String(uid);
    }

    function getDb(options = {}) {
        if (options.db) return options.db;
        if (options.firebase && typeof options.firebase.firestore === 'function') {
            return options.firebase.firestore();
        }
        if (typeof firebase !== 'undefined' && firebase && typeof firebase.firestore === 'function') {
            return firebase.firestore();
        }
        return null;
    }

    function getUserDocRef(uid, options = {}) {
        const db = getDb(options);
        if (!db || typeof db.collection !== 'function') {
            throw new Error('[VaultRepo] Firestore dependency is required for startSubscription().');
        }

        const usersCollection = db.collection('users');
        if (!usersCollection || typeof usersCollection.doc !== 'function') {
            throw new Error('[VaultRepo] Firestore users collection is unavailable.');
        }

        const userDoc = usersCollection.doc(uid);
        if (!userDoc || typeof userDoc.onSnapshot !== 'function') {
            throw new Error('[VaultRepo] Firestore user document does not support onSnapshot().');
        }

        return userDoc;
    }

    function callOptionalCallback(name, callback, ...args) {
        if (typeof callback !== 'function') return undefined;
        try {
            return callback(...args);
        } catch (error) {
            console.error(`[VaultRepo] ${name} callback failed.`, error);
            return undefined;
        }
    }

    function isStaleSubscriptionCallback(uid, options = {}) {
        if (uid !== activeSubscriptionUid) return true;
        if (typeof options.getCurrentUid !== 'function') return false;

        let currentUid = null;
        try {
            currentUid = options.getCurrentUid();
        } catch (error) {
            console.error('[VaultRepo] getCurrentUid callback failed.', error);
            return true;
        }

        return currentUid !== uid;
    }

    function normalizeSnapshotMetadata(doc) {
        const metadata = doc && doc.metadata ? doc.metadata : {};
        return {
            fromCache: metadata.fromCache === true,
            hasPendingWrites: metadata.hasPendingWrites === true
        };
    }

    function getVisitedPlacesFromDoc(doc) {
        if (!doc || doc.exists !== true) return [];
        const data = typeof doc.data === 'function' ? (doc.data() || {}) : {};
        return Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
    }

    function handleVisitedSnapshot(uid, doc, options = {}) {
        if (isStaleSubscriptionCallback(uid, options)) return null;

        const metadata = normalizeSnapshotMetadata(doc);
        const placeList = getVisitedPlacesFromDoc(doc);
        const result = reconcileSnapshot(placeList, metadata);

        callOptionalCallback('invalidateVisitedIdsCache', options.invalidateVisitedIdsCache);
        callOptionalCallback('refreshVisitedVisualState', options.refreshVisitedVisualState);

        const canonicalResult = callOptionalCallback(
            'normalizeLocalVisitedPlacesToCanonical',
            options.normalizeLocalVisitedPlacesToCanonical,
            { writeBack: true }
        );
        if (canonicalResult && typeof canonicalResult.catch === 'function') {
            canonicalResult.catch(error => {
                console.error('[VaultRepo] visited-place canonicalization failed.', error);
            });
        }

        callOptionalCallback('onChange', options.onChange, Object.freeze({
            uid,
            result,
            metadata: Object.freeze({ ...metadata })
        }));

        return result;
    }

    function handleVisitSnapshotError(uid, error, options = {}) {
        if (uid !== activeSubscriptionUid) return;
        console.error('[VaultRepo] visitedPlaces snapshot failed.', error);
        callOptionalCallback('onError', options.onError, error);
    }

    function stopSubscription() {
        const unsubscribe = activeSubscriptionUnsubscribe;
        const uid = activeSubscriptionUid;
        activeSubscriptionUnsubscribe = null;
        activeSubscriptionUid = null;

        if (typeof unsubscribe === 'function') {
            try {
                unsubscribe();
            } catch (error) {
                console.error('[VaultRepo] visitedPlaces unsubscribe failed.', error);
            }
        }

        return Object.freeze({
            active: false,
            uid,
            stopped: typeof unsubscribe === 'function'
        });
    }

    function startSubscription(uid, options = {}) {
        const nextUid = assertNonEmptyUid(uid);

        if (activeSubscriptionUid === nextUid && typeof activeSubscriptionUnsubscribe === 'function') {
            return Object.freeze({
                active: true,
                uid: nextUid,
                reused: true
            });
        }

        if (activeSubscriptionUid && activeSubscriptionUid !== nextUid) {
            stopSubscription();
            clear();
        }

        if (typeof options.incrementRequestCount === 'function') {
            options.incrementRequestCount();
        }

        const userDoc = getUserDocRef(nextUid, options);
        activeSubscriptionUid = nextUid;

        try {
            activeSubscriptionUnsubscribe = userDoc.onSnapshot(
                doc => handleVisitedSnapshot(nextUid, doc, options),
                error => handleVisitSnapshotError(nextUid, error, options)
            );
        } catch (error) {
            activeSubscriptionUid = null;
            activeSubscriptionUnsubscribe = null;
            throw error;
        }

        return Object.freeze({
            active: true,
            uid: nextUid,
            reused: false
        });
    }

    window.BARK.repos.VaultRepo = {
        getVisits,
        getVisit,
        hasVisit,
        size,
        getVisitedIds,
        entries,
        addVisit,
        removeVisit,
        removeVisits,
        replaceAll,
        setVisits,
        clear,
        snapshot,
        createRollbackToken,
        restore,
        assertWriteIsNotDestructive,
        stageUpsert,
        stageDelete,
        clearPendingMutation,
        clearPendingMutations,
        reconcileSnapshot,
        subscribe,
        startSubscription,
        stopSubscription
    };
})();
