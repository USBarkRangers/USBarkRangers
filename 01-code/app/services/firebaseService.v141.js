/**
 * firebaseService.js - Firestore CRUD and Firebase-backed user data helpers.
 * Saved-route DOM rendering lives in renderers/routeRenderer.js.
 *
 * Future personal-data model notes:
 *   `visitedPlaces` is currently the compact progress/check-in record used by
 *   scoring, achievements, profile rendering, and marker visited state. Keep it
 *   small. It should answer "has this user visited this official BARK place?"
 *   and basic timestamp/verification questions only.
 *
 *   Do not expand visitedPlaces into a scrapbook. User photos, personal notes,
 *   dog/BARK gear memories, per-trip notes, and future reviews should move into
 *   separate user-owned records, for example:
 *
 *     users/{uid}/placeMemories/{placeId}
 *       Official-place memories keyed by canonical BARK place id.
 *
 *     users/{uid}/customPlaces/{customPlaceId}
 *       User-created/geocoded towns or other non-BARK places.
 *
 *     users/{uid}/tripStopMemories/{tripStopId}
 *       Notes/photos tied to one stop inside one saved/current route.
 *
 *   Store uploaded image bytes in Firebase Storage, not Firestore. Firestore
 *   should hold metadata only: storage paths, thumbnail URLs, captions,
 *   visibility, createdAt/updatedAt, and ownership. Load these lazily when the
 *   place card opens so map pan/zoom and marker sync never pay photo costs.
 *
 *   Critical future questions before implementing:
 *     - Can one user have both a general memory for a park and a separate note
 *       for the same park inside a specific trip? Recommended answer: yes.
 *     - Are reviews public, private, or moderated? This changes security rules.
 *     - Can custom towns be reused across trips? If yes, give them customPlaceId.
 *     - Can shared trips include private memories? Recommended default: no,
 *       share route geometry/stops separately from personal media.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

let visitedPlacesWriteInFlightCount = 0;
const visitedPlacesWriteCoordinators = new Map();
const VISIT_WRITE_RECOVERY_PREFIX = 'bark.visitWriteRecovery.';
const STALE_VISIT_COMMIT_RESULT_FLAG = '__barkStaleVisitCommitResult';
let preAuthHydratedDeleteUid = null;
let preAuthHydratedDeleteIds = new Set();
let legacyVisitCoordinateIndex = new Map();
let legacyVisitCoordinateIndexRevision = null;
let legacyVisitCoordinateIndexRepo = null;
const VISIT_COORDINATE_BUCKET_SIZE = 0.0001;

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getCurrentUser() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;
    try {
        if (Array.isArray(firebase.apps) && firebase.apps.length === 0) return null;
        return firebase.auth().currentUser;
    } catch (_error) {
        // The compatibility SDK may be present before initializeApp finishes
        // on fake cellular service. That is unresolved auth, not a UI error.
        return null;
    }
}

function isPremiumActive() {
    const premiumService = window.BARK.services && window.BARK.services.premium;
    return Boolean(
        premiumService &&
        typeof premiumService.isPremium === 'function' &&
        premiumService.isPremium()
    );
}

function requireSavedRoutesPremium() {
    if (isPremiumActive()) return;
    throw new Error('Saved routes are a Premium feature.');
}

function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function readCompletedExpeditionsFromUserData(data) {
    if (!data || typeof data !== 'object') return [];

    if (Array.isArray(data.completed_expeditions)) return data.completed_expeditions;
    if (Array.isArray(data.completedExpeditions)) return data.completedExpeditions;
    return [];
}

const CANONICAL_PARK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function refreshVisitedCache(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedCache === 'function') {
        coordinator.refreshVisitedCache(reason);
        return true;
    }

    if (window.BARK && typeof window.BARK.invalidateVisitedIdsCache === 'function') {
        window.BARK.invalidateVisitedIdsCache();
        return true;
    }

    return false;
}

function refreshVisitedVisuals(reason, scope = null) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedVisuals === 'function') {
        coordinator.refreshVisitedVisuals(reason, scope);
        return true;
    }

    refreshVisitedVisualState(scope);
    return true;
}

function cleanValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function cloneVisitedPlace(place) {
    return place && typeof place === 'object' ? { ...place } : place;
}

function hasVisitedPlaceId(place) {
    return place && typeof place === 'object' && place.id !== undefined && place.id !== null;
}

function isCanonicalParkId(id) {
    return CANONICAL_PARK_ID_PATTERN.test(cleanValue(id));
}

function makeVisitedPlaceMap(placeList) {
    const visitedMap = new Map();
    if (!Array.isArray(placeList)) return visitedMap;

    placeList.forEach(place => {
        if (hasVisitedPlaceId(place)) visitedMap.set(place.id, cloneVisitedPlace(place));
    });
    return visitedMap;
}

function getVisitedPlacesArray() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.getVisits === 'function') {
        return vaultRepo.getVisits().map(cloneVisitedPlace);
    }

    return [];
}

function getVisitedPlaceEntryPairs() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.entries === 'function') {
        return vaultRepo.entries().map(([id, record]) => [id, cloneVisitedPlace(record)]);
    }

    return [];
}

function getVisitedRecordById(placeId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.getVisit === 'function') {
        return cloneVisitedPlace(vaultRepo.getVisit(placeId));
    }

    return null;
}

function getLegacyParkIdFromCoords(lat, lng) {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
    return `${parsedLat.toFixed(2)}_${parsedLng.toFixed(2)}`;
}

function coordsMatch(leftLat, leftLng, rightLat, rightLng) {
    const aLat = Number(leftLat);
    const aLng = Number(leftLng);
    const bLat = Number(rightLat);
    const bLng = Number(rightLng);
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return false;
    return Math.abs(aLat - bLat) < 0.0001 && Math.abs(aLng - bLng) < 0.0001;
}

function getCoordinateBucketPart(value) {
    return Math.floor(Number(value) / VISIT_COORDINATE_BUCKET_SIZE);
}

function getCoordinateBucketKey(latPart, lngPart) {
    return `${latPart}:${lngPart}`;
}

function rebuildLegacyVisitCoordinateIndex(vaultRepo) {
    const nextIndex = new Map();
    const visitedEntries = vaultRepo && typeof vaultRepo.entries === 'function'
        ? vaultRepo.entries()
        : [];

    visitedEntries.forEach(([visitedId, visitedRecord]) => {
        const storedId = cleanValue((visitedRecord && visitedRecord.id) || visitedId);
        if (isCanonicalParkId(storedId) || isCanonicalParkId(visitedId)) return;

        const lat = Number(visitedRecord && visitedRecord.lat);
        const lng = Number(visitedRecord && visitedRecord.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const key = getCoordinateBucketKey(getCoordinateBucketPart(lat), getCoordinateBucketPart(lng));
        const bucket = nextIndex.get(key) || [];
        bucket.push(Object.freeze({ id: visitedId, lat, lng }));
        nextIndex.set(key, bucket);
    });

    legacyVisitCoordinateIndex = nextIndex;
    legacyVisitCoordinateIndexRepo = vaultRepo;
    legacyVisitCoordinateIndexRevision = vaultRepo && typeof vaultRepo.getRevision === 'function'
        ? vaultRepo.getRevision()
        : null;
}

function getLegacyVisitCoordinateCandidates(lat, lng) {
    const vaultRepo = getVaultRepo();
    if (!vaultRepo) return [];

    const revision = typeof vaultRepo.getRevision === 'function' ? vaultRepo.getRevision() : null;
    if (
        legacyVisitCoordinateIndexRepo !== vaultRepo ||
        revision === null ||
        legacyVisitCoordinateIndexRevision !== revision
    ) {
        rebuildLegacyVisitCoordinateIndex(vaultRepo);
    }

    const latPart = getCoordinateBucketPart(lat);
    const lngPart = getCoordinateBucketPart(lng);
    const candidates = [];
    for (let latOffset = -1; latOffset <= 1; latOffset++) {
        for (let lngOffset = -1; lngOffset <= 1; lngOffset++) {
            const key = getCoordinateBucketKey(latPart + latOffset, lngPart + lngOffset);
            const bucket = legacyVisitCoordinateIndex.get(key);
            if (bucket) candidates.push(...bucket);
        }
    }
    return candidates;
}

function getVisitedPlaceEntries(placeOrId) {
    const place = placeOrId && typeof placeOrId === 'object' ? placeOrId : { id: placeOrId };
    const entries = [];
    const seenIds = new Set();

    function addEntry(visitedId) {
        if (!visitedId || seenIds.has(visitedId)) return;
        const record = getVisitedRecordById(visitedId);
        if (!record) return;
        seenIds.add(visitedId);
        entries.push({ id: visitedId, record });
    }

    const candidateIds = [place.id, getLegacyParkIdFromCoords(place.lat, place.lng)]
        .filter(id => id !== undefined && id !== null && id !== '');

    for (const candidateId of candidateIds) {
        addEntry(candidateId);
    }

    if (place && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng))) {
        for (const candidate of getLegacyVisitCoordinateCandidates(place.lat, place.lng)) {
            if (coordsMatch(place.lat, place.lng, candidate.lat, candidate.lng)) {
                addEntry(candidate.id);
            }
        }
    }

    return entries;
}

function getVisitedPlaceEntry(placeOrId) {
    const entries = getVisitedPlaceEntries(placeOrId);
    return entries.length > 0 ? entries[0] : null;
}

function isParkVisited(placeOrId) {
    const place = placeOrId && typeof placeOrId === 'object' ? placeOrId : { id: placeOrId };
    const vaultRepo = getVaultRepo();
    const candidateIds = [place.id, getLegacyParkIdFromCoords(place.lat, place.lng)]
        .filter(id => id !== undefined && id !== null && id !== '');

    for (const candidateId of candidateIds) {
        if (vaultRepo && typeof vaultRepo.hasVisit === 'function' && vaultRepo.hasVisit(candidateId)) return true;
        if ((!vaultRepo || typeof vaultRepo.hasVisit !== 'function') && getVisitedRecordById(candidateId)) return true;
    }

    if (!Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return false;
    return getLegacyVisitCoordinateCandidates(place.lat, place.lng)
        .some(candidate => coordsMatch(place.lat, place.lng, candidate.lat, candidate.lng));
}

function getCanonicalParkCandidates(visit) {
    const parkRepo = getParkRepo();
    const points = parkRepo ? parkRepo.getAll() : [];
    if (!visit || points.length === 0) return [];

    const visitId = cleanValue(visit.id);
    const legacyId = getLegacyParkIdFromCoords(visit.lat, visit.lng);
    const visitName = cleanValue(visit.name).toLowerCase();
    const normalizedVisitName = visitName.replace(/[^a-z0-9]/g, '');

    return points.filter(point => {
        if (!point || !point.id) return false;
        if (point.id === visitId) return true;
        if (visitId && getLegacyParkIdFromCoords(point.lat, point.lng) === visitId) return true;
        if (legacyId && getLegacyParkIdFromCoords(point.lat, point.lng) === legacyId) return true;
        if (coordsMatch(visit.lat, visit.lng, point.lat, point.lng)) return true;
        if (normalizedVisitName) {
            const normalizedPointName = cleanValue(point.name).toLowerCase().replace(/[^a-z0-9]/g, '');
            return normalizedPointName === normalizedVisitName;
        }
        return false;
    });
}

function pickCanonicalParkForVisit(visit) {
    const candidates = getCanonicalParkCandidates(visit);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const normalizedVisitName = cleanValue(visit && visit.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedVisitName) {
        const exact = candidates.find(point => cleanValue(point.name).toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedVisitName);
        if (exact) return exact;
    }

    return null;
}

function canonicalizeVisitRecord(visit, point) {
    const canonicalRecord = {
        id: point.id,
        name: point.name,
        lat: point.lat,
        lng: point.lng,
        state: point.state || visit.state || '',
        verified: Boolean(visit.verified),
        ts: Number.isFinite(Number(visit.ts)) ? Number(visit.ts) : Date.now()
    };

    // Preserve the per-mutation proof token used by checkinService. Historical
    // records intentionally remain token-free until they are changed again.
    if (visit.syncToken) canonicalRecord.syncToken = visit.syncToken;
    return canonicalRecord;
}

function mergeCanonicalVisitRecords(existing, incoming) {
    if (!existing) return incoming;
    const existingTs = Number(existing.ts);
    const incomingTs = Number(incoming.ts);
    return {
        ...existing,
        ...incoming,
        verified: Boolean(existing.verified || incoming.verified),
        ts: Number.isFinite(existingTs) && Number.isFinite(incomingTs)
            ? Math.min(existingTs, incomingTs)
            : (Number.isFinite(existingTs) ? existing.ts : incoming.ts)
    };
}

function canonicalizeVisitedPlacesMap(options = {}) {
    const visitedEntries = getVisitedPlaceEntryPairs();

    const parkRepo = getParkRepo();
    const points = parkRepo ? parkRepo.getAll() : [];
    if (points.length === 0) {
        return { changed: false, unresolvedLegacyIds: [], canonicalReplacements: [], nextMap: new Map(visitedEntries) };
    }

    const dropUnresolved = options.dropUnresolved === true;
    const nextMap = new Map();
    const unresolvedLegacyIds = [];
    const canonicalReplacements = [];
    let changed = false;

    visitedEntries.forEach(([sourceId, rawVisit]) => {
        const visit = { ...(rawVisit || {}), id: cleanValue((rawVisit && rawVisit.id) || sourceId) };
        const point = pickCanonicalParkForVisit(visit);

        if (!point) {
            const legacy = !CANONICAL_PARK_ID_PATTERN.test(cleanValue(visit.id));
            if (legacy) {
                unresolvedLegacyIds.push(visit.id);
                if (dropUnresolved) {
                    changed = true;
                    return;
                }
            }
            nextMap.set(sourceId, rawVisit);
            return;
        }

        const canonicalRecord = canonicalizeVisitRecord(visit, point);
        nextMap.set(point.id, mergeCanonicalVisitRecords(nextMap.get(point.id), canonicalRecord));
        if (sourceId !== point.id || visit.id !== point.id) {
            canonicalReplacements.push({
                sourceId,
                visitId: visit.id,
                targetId: point.id
            });
            changed = true;
        }
        if (
            visit.name !== canonicalRecord.name ||
            Number(visit.lat) !== Number(canonicalRecord.lat) ||
            Number(visit.lng) !== Number(canonicalRecord.lng) ||
            (visit.state || '') !== (canonicalRecord.state || '')
        ) {
            changed = true;
        }
    });

    if (nextMap.size !== visitedEntries.length) changed = true;
    return { changed, unresolvedLegacyIds, canonicalReplacements, nextMap };
}

function assertCanonicalizationIsNotDestructive(result) {
    const currentCount = getVisitedPlaceEntryPairs().length;
    const nextCount = result && result.nextMap instanceof Map ? result.nextMap.size : 0;
    const droppedCount = currentCount - nextCount;
    const destructiveDropThreshold = Math.max(3, Math.ceil(currentCount * 0.25));

    if (currentCount >= 3 && droppedCount >= destructiveDropThreshold) {
        throw new Error(`Refusing destructive visitedPlaces canonicalization: ${droppedCount} visit(s) would be collapsed.`);
    }
}

async function normalizeLocalVisitedPlacesToCanonical(options = {}) {
    const result = canonicalizeVisitedPlacesMap(options);
    if (!result.changed) return result;

    assertCanonicalizationIsNotDestructive(result);

    replaceLocalVisitedPlaces(result.nextMap, {
        canonicalReplacements: result.canonicalReplacements
    });

    if (options.writeBack === true && result.unresolvedLegacyIds.length === 0) {
        await updateCurrentUserVisitedPlaces(getVisitedPlacesArray());
    }

    return result;
}

function getVisitedPlaceIdsFromArray(placeList) {
    return new Set((Array.isArray(placeList) ? placeList : [])
        .filter(hasVisitedPlaceId)
        .map(place => place.id));
}

function assertVisitedWriteIsNotDestructive(nextVisitedArray) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.assertWriteIsNotDestructive === 'function') {
        vaultRepo.assertWriteIsNotDestructive(nextVisitedArray);
    } else {
        console.warn('[firebaseService] VaultRepo unavailable; destructive visitedPlaces guard skipped.');
    }
}

function canRestoreVaultSnapshot(token, expectedUid) {
    const user = getCurrentUser();
    return Boolean(user && token && (!expectedUid || user.uid === expectedUid));
}

function stringifyVisitValue(value) {
    if (value && typeof value === 'object') {
        const sorted = {};
        Object.keys(value).sort().forEach(key => { sorted[key] = value[key]; });
        return JSON.stringify(sorted);
    }
    return JSON.stringify(value);
}

function visitedPlaceRecordsMatch(left, right) {
    if (!left || !right) return false;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (stringifyVisitValue(left[key]) !== stringifyVisitValue(right[key])) return false;
    }
    return true;
}

function isAuthoritativeSnapshot(metadata = {}) {
    return metadata.fromCache === false && metadata.hasPendingWrites === false;
}

function getVisitMutationCoordinatorService() {
    return window.BARK && window.BARK.visitMutationCoordinator;
}

function makeVisitedWriteError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isTransientVisitedStorageError(error) {
    const message = String(error && (error.message || error.name) || '');
    return /(?:indexed\s*database|indexeddb|object store|database server|in-progress transaction)/i.test(message)
        || /connection\s+to\s+.+database.+lost/i.test(message);
}

function isRetryableVisitedWriteError(error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const code = error && error.code ? String(error.code) : '';
    if ([
        'aborted',
        'cancelled',
        'deadline-exceeded',
        'internal',
        'network-request-failed',
        'resource-exhausted',
        'unknown',
        'unavailable'
    ].includes(code)) return true;

    // iOS Safari can report a temporary IndexedDB transaction failure with a
    // numeric code of 0 while navigator.onLine remains true. The real Carter
    // Swarm client history contains this exact resume error. It must be queued
    // like flaky cell service, never interpreted as a rejected deletion.
    if (isTransientVisitedStorageError(error)) return true;

    // Firestore occasionally wraps an offline transaction as
    // failed-precondition. Keep real configuration/precondition failures fatal.
    return code === 'failed-precondition'
        && /offline|network|connection|transaction|cache/i.test(String(error && error.message || ''));
}

function normalizeVisitedWriteErrorCode(error) {
    const raw = String(error && error.code || '').toLowerCase();
    const pieces = raw.split('/');
    return pieces[pieces.length - 1];
}

function visitWriteRecoveryKey(uid) {
    return uid ? `${VISIT_WRITE_RECOVERY_PREFIX}${uid}` : null;
}

function hasRecentVisitWriteRecovery(uid) {
    const key = visitWriteRecoveryKey(uid);
    if (!key) return false;
    try {
        const timestamp = Number(localStorage.getItem(key));
        return Number.isFinite(timestamp) && timestamp > 0 && Date.now() - timestamp < 30 * 24 * 60 * 60 * 1000;
    } catch (_error) {
        return false;
    }
}

function rememberVisitWriteRecovery(uid) {
    const key = visitWriteRecoveryKey(uid);
    if (!key) return;
    try {
        localStorage.setItem(key, String(Date.now()));
    } catch (_error) { /* the durable deletion journal remains the primary copy */ }
}

function clearVisitWriteRecovery(uid) {
    const key = visitWriteRecoveryKey(uid);
    if (!key) return;
    try {
        localStorage.removeItem(key);
    } catch (_error) { /* an expired marker is harmless */ }
}

function getPendingVisitDeleteCount(uid) {
    const mutationService = getVisitMutationCoordinatorService();
    if (!mutationService || typeof mutationService.getPendingDeleteIds !== 'function') return 0;
    return mutationService.getPendingDeleteIds(uid).length;
}

function getPendingSyncableVisitUpsertCount(uid) {
    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.snapshot !== 'function') return 0;
    const snapshot = vaultRepo.snapshot();
    const pending = snapshot && snapshot.pending instanceof Map
        ? snapshot.pending
        : new Map();
    const upserts = [];
    pending.forEach(mutation => {
        if (mutation && mutation.type === 'upsert' && mutation.place) {
            upserts.push(cloneVisitedPlace(mutation.place));
        }
    });
    const checkinService = window.BARK.services && window.BARK.services.checkin;
    const syncable = checkinService && typeof checkinService.filterSyncableVisitedPlaces === 'function'
        ? checkinService.filterSyncableVisitedPlaces(uid, upserts)
        : upserts;
    return syncable.length;
}

function getPendingVisitedIntentCount(uid) {
    return getPendingVisitDeleteCount(uid) + getPendingSyncableVisitUpsertCount(uid);
}

function showVisitedSyncRecoveryNotice(uid) {
    const currentUser = getCurrentUser();
    if (!uid || !currentUser || currentUser.uid !== uid || getPendingVisitedIntentCount(uid) === 0) return;
    if (window.BARK && typeof window.BARK.showOfflineRecoveryNotice === 'function') {
        window.BARK.showOfflineRecoveryNotice(
            'Pending park changes stay saved on this device. Reload here to restart sync.'
        );
    }
}

function hideVisitedSyncRecoveryNoticeIfRecovered(uid) {
    const currentUser = getCurrentUser();
    if (!uid || !currentUser || currentUser.uid !== uid || getPendingVisitedIntentCount(uid) > 0) return;
    if (window.BARK && typeof window.BARK.hideOfflineRecoveryNotice === 'function') {
        window.BARK.hideOfflineRecoveryNotice({ resetDismissal: true });
    }
}

function refreshVisitedWriteSessionProof(uid) {
    const user = getCurrentUser();
    if (!user || user.uid !== uid) return Promise.resolve(false);
    const refreshes = [];
    if (typeof user.getIdToken === 'function') {
        refreshes.push(Promise.resolve().then(() => user.getIdToken(true)));
    }
    try {
        if (firebase.appCheck && typeof firebase.appCheck === 'function') {
            const appCheck = firebase.appCheck();
            if (appCheck && typeof appCheck.getToken === 'function') {
                refreshes.push(Promise.resolve().then(() => appCheck.getToken(true)));
            }
        }
    } catch (_error) { /* the next Firestore retry still validates auth */ }
    if (refreshes.length === 0) return Promise.resolve(false);
    return Promise.allSettled(refreshes).then(() => true);
}

function stageVisitedPlaceUpsert(place) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.stageUpsert === 'function') vaultRepo.stageUpsert(place);
}

function stageVisitedPlaceDelete(placeId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.stageDelete === 'function') vaultRepo.stageDelete(placeId);
}

function clearVisitedPlacePendingMutation(placeId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.clearPendingMutation === 'function') vaultRepo.clearPendingMutation(placeId);
}

function clearVisitedPlacePendingMutations() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.clearPendingMutations === 'function') vaultRepo.clearPendingMutations();
}

function rememberAuthoritativeVisitedBaseline(uid, visits) {
    const checkinService = window.BARK.services && window.BARK.services.checkin;
    if (checkinService && typeof checkinService.rememberAuthoritativeVisitIds === 'function') {
        return checkinService.rememberAuthoritativeVisitIds(uid, visits) === true;
    }
    if (!uid || !Array.isArray(visits)) return false;

    // Keep the durability invariant even in a partial/module-test boot where
    // checkinService is unavailable. This uses the same schema/key it owns.
    try {
        const envelope = {
            schemaVersion: 1,
            uid: String(uid),
            visits: visits.filter(visit => visit && getVisitedPlaceId(visit)).map(cloneVisitedPlace)
        };
        const key = `bark.authoritativeVisits.${uid}`;
        const serialized = JSON.stringify(envelope);
        localStorage.setItem(key, serialized);
        if (localStorage.getItem(key) !== serialized) return false;
        localStorage.setItem(
            `bark.authoritativeVisitIds.${uid}`,
            JSON.stringify(envelope.visits.map(getVisitedPlaceId).filter(Boolean).map(String))
        );
        return true;
    } catch (error) {
        console.warn('[firebaseService] unable to persist authoritative visit baseline:', error);
        return false;
    }
}

function readAuthoritativeVisitedBaselineFingerprint(uid) {
    if (!uid) return null;
    try {
        return localStorage.getItem(`bark.authoritativeVisits.${uid}`);
    } catch (_error) {
        return null;
    }
}

// A transaction response and a Firestore listener are independent async
// authority channels. Capture both an in-memory observation generation and the
// durable baseline bytes so an older transaction response cannot overtake a
// newer listener callback after the backend commit has already completed.
function captureAuthoritativeVisitEvidence(uid) {
    const checkinService = window.BARK.services && window.BARK.services.checkin;
    const hasGeneration = Boolean(
        checkinService
        && typeof checkinService.getAuthoritativeEvidenceGeneration === 'function'
    );
    const generation = hasGeneration
        ? checkinService.getAuthoritativeEvidenceGeneration(uid)
        : null;
    const fingerprint = checkinService
        && typeof checkinService.getAuthoritativeBaselineFingerprint === 'function'
        ? checkinService.getAuthoritativeBaselineFingerprint(uid)
        : readAuthoritativeVisitedBaselineFingerprint(uid);
    return Object.freeze({ hasGeneration, generation, fingerprint });
}

function authoritativeVisitEvidenceMatches(uid, expectedEvidence) {
    if (!expectedEvidence) return false;
    const currentEvidence = captureAuthoritativeVisitEvidence(uid);
    if (
        expectedEvidence.hasGeneration
        && (!currentEvidence.hasGeneration || currentEvidence.generation !== expectedEvidence.generation)
    ) {
        return false;
    }
    return currentEvidence.fingerprint === expectedEvidence.fingerprint;
}

function markVisitedCommitResultStale(committedVisitedArray) {
    if (!Array.isArray(committedVisitedArray)) return;
    try {
        Object.defineProperty(committedVisitedArray, STALE_VISIT_COMMIT_RESULT_FLAG, {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false
        });
    } catch (_error) {
        // Arrays returned by this module are normally extensible. Keep a safe
        // fallback for partial test/runtime shims without changing array items.
        committedVisitedArray[STALE_VISIT_COMMIT_RESULT_FLAG] = true;
    }
}

function getVisitedPlacePendingMutation(placeId) {
    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.snapshot !== 'function') return null;

    const token = vaultRepo.snapshot();
    if (!token || !(token.pending instanceof Map)) return null;
    return token.pending.get(placeId) || null;
}

function beginVisitedPlacesWrite() {
    visitedPlacesWriteInFlightCount++;
    return function endVisitedPlacesWrite() {
        visitedPlacesWriteInFlightCount = Math.max(0, visitedPlacesWriteInFlightCount - 1);
    };
}

function hasVisitedPlacesWriteInFlight() {
    return visitedPlacesWriteInFlightCount > 0;
}

function captureVisitedPlaceIntents(uid) {
    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.snapshot !== 'function') {
        return Object.freeze({ pending: new Map() });
    }

    const snapshot = vaultRepo.snapshot();
    const sourcePending = snapshot && snapshot.pending instanceof Map
        ? snapshot.pending
        : new Map();
    const pendingUpserts = [];
    sourcePending.forEach(mutation => {
        if (mutation && mutation.type === 'upsert' && mutation.place) {
            pendingUpserts.push(cloneVisitedPlace(mutation.place));
        }
    });
    const checkinService = window.BARK.services && window.BARK.services.checkin;
    const syncableUpserts = checkinService && typeof checkinService.filterSyncableVisitedPlaces === 'function'
        ? checkinService.filterSyncableVisitedPlaces(uid, pendingUpserts)
        : pendingUpserts;
    const syncableIds = new Set(syncableUpserts
        .map(getVisitedPlaceId)
        .filter(Boolean)
        .map(String));
    const capturedPending = new Map();

    sourcePending.forEach((mutation, id) => {
        if (!mutation) return;
        const normalizedId = String(id);
        if (mutation.type === 'delete') {
            capturedPending.set(normalizedId, Object.freeze({ type: 'delete', place: null }));
            return;
        }
        if (mutation.type === 'upsert' && mutation.place && syncableIds.has(normalizedId)) {
            capturedPending.set(normalizedId, Object.freeze({
                type: 'upsert',
                place: Object.freeze(cloneVisitedPlace(mutation.place))
            }));
        }
    });

    return Object.freeze({ pending: capturedPending });
}

// Writes are always rebuilt from the transaction's fresh server document.
// The local Vault is a display projection and may contain an old offline
// baseline, so only explicit captured intents are allowed to change the server.
function mergeVisitedPlacesForSafeWrite(serverVisitedArray, capturedIntent) {
    const nextMap = makeVisitedPlaceMap(serverVisitedArray);
    const pending = capturedIntent && capturedIntent.pending instanceof Map
        ? capturedIntent.pending
        : new Map();

    pending.forEach((mutation, id) => {
        if (!mutation) return;
        if (mutation.type === 'delete') {
            nextMap.delete(String(id));
            return;
        }
        if (mutation.type === 'upsert' && mutation.place) {
            nextMap.set(String(id), cloneVisitedPlace(mutation.place));
        }
    });

    return Array.from(nextMap.values());
}

function hasServerPremiumVisitedAccess(data) {
    const entitlement = data && data.entitlement;
    if (!entitlement || entitlement.premium !== true) return false;
    if (['active', 'manual_active', 'past_due', 'paused', 'cancelled_active'].includes(entitlement.status)) {
        return true;
    }
    if (entitlement.status !== 'access_code_active' || entitlement.source !== 'access_code') return false;

    const expiresAt = entitlement.expiresAt;
    const expiresAtMs = expiresAt && typeof expiresAt.toMillis === 'function'
        ? expiresAt.toMillis()
        : Number(expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

function capFreeVisitedPlaces(serverVisitedArray, mergedVisitedArray) {
    const FREE_VISIT_LIMIT = 5;
    const serverIds = new Set(serverVisitedArray.map(getVisitedPlaceId).filter(Boolean).map(String));
    const existing = [];
    const additions = [];

    mergedVisitedArray.forEach(visit => {
        const id = getVisitedPlaceId(visit);
        if (id && serverIds.has(String(id))) existing.push(visit);
        else additions.push(visit);
    });

    additions.sort((left, right) => {
        const leftTs = Number(left && left.ts);
        const rightTs = Number(right && right.ts);
        if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) return leftTs - rightTs;
        return String(getVisitedPlaceId(left) || '').localeCompare(String(getVisitedPlaceId(right) || ''));
    });

    const availableSlots = Math.max(0, FREE_VISIT_LIMIT - existing.length);
    const acceptedAdditions = additions.slice(0, availableSlots);
    const rejectedVisitIds = additions.slice(availableSlots).map(getVisitedPlaceId).filter(Boolean);
    return {
        visits: [...existing, ...acceptedAdditions],
        rejectedVisitIds
    };
}

function discardRejectedFreeVisitAdditions(uid, visitIds, capturedIntent) {
    const ids = Array.from(new Set((Array.isArray(visitIds) ? visitIds : []).filter(Boolean).map(String)));
    if (ids.length === 0) return;
    const capturedPending = capturedIntent && capturedIntent.pending instanceof Map
        ? capturedIntent.pending
        : new Map();
    const rejectedVisits = ids.map(id => {
        const mutation = capturedPending.get(id);
        return mutation && mutation.type === 'upsert' && mutation.place
            ? cloneVisitedPlace(mutation.place)
            : null;
    }).filter(Boolean);

    const checkinService = window.BARK.services && window.BARK.services.checkin;
    if (checkinService && typeof checkinService.discardPendingVisitAdditions === 'function') {
        checkinService.discardPendingVisitAdditions(uid, rejectedVisits);
    }

    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.uid !== uid) return;

    const vaultRepo = getVaultRepo();
    if (vaultRepo) {
        const activeRejectedIds = rejectedVisits.filter(expectedVisit => {
            const id = String(getVisitedPlaceId(expectedVisit));
            const pendingMutation = getVisitedPlacePendingMutation(id);
            const currentVisit = typeof vaultRepo.getVisit === 'function'
                ? vaultRepo.getVisit(id)
                : null;
            return pendingMutation
                && pendingMutation.type === 'upsert'
                && visitedPlaceRecordsMatch(pendingMutation.place, expectedVisit)
                && visitedPlaceRecordsMatch(currentVisit, expectedVisit);
        }).map(getVisitedPlaceId).filter(Boolean).map(String);
        if (activeRejectedIds.length === 0) return;
        if (typeof vaultRepo.removeVisits === 'function') vaultRepo.removeVisits(activeRejectedIds);
        if (typeof vaultRepo.clearPendingMutation === 'function') {
            activeRejectedIds.forEach(id => vaultRepo.clearPendingMutation(id));
        }
        refreshVisitedCache('firebase-free-limit-reconcile');
        refreshVisitedVisuals('firebase-free-limit-reconcile');
    }
}

async function commitVisitedPlacesAtomically(db, userRef, capturedIntent, uid) {
    if (!db || typeof db.runTransaction !== 'function') {
        const error = new Error('Atomic visited-place transactions are unavailable.');
        error.code = 'failed-precondition';
        throw error;
    }

    // Firestore rules deliberately reject a client write that drops three or
    // more visits at once. That protects an account from an accidental empty
    // array, but rapid legitimate removals are coalesced by the coordinator and
    // therefore must be committed in rule-safe slices. Two exact deletions per
    // transaction preserves that server-side guard without rolling the user's
    // durable offline intent back.
    const MAX_DELETIONS_PER_TRANSACTION = 2;
    let committedVisitedArray = [];
    let rejectedFreeVisitIds = [];
    let deferredDeleteCount = 0;

    do {
        deferredDeleteCount = 0;
        if (window.BARK && typeof window.BARK.incrementRequestCount === 'function') {
            // Count each transaction write once. Firestore may rerun its
            // callback, and each rerun is counted as another document read.
            window.BARK.incrementRequestCount();
        }

        await db.runTransaction(async transaction => {
            rejectedFreeVisitIds = [];
            if (window.BARK && typeof window.BARK.incrementRequestCount === 'function') {
                window.BARK.incrementRequestCount();
            }
            const doc = await transaction.get(userRef);
            const data = doc && doc.exists && typeof doc.data === 'function' ? (doc.data() || {}) : {};
            const serverVisitedArray = Array.isArray(data.visitedPlaces)
                ? data.visitedPlaces.map(cloneVisitedPlace)
                : [];

            // Firestore retries this callback if another device changes the
            // user document. Rebuilding from that newest snapshot prevents the
            // last writer from erasing a visit committed by the other device.
            const requestedMerge = mergeVisitedPlacesForSafeWrite(
                serverVisitedArray,
                capturedIntent
            );

            // Validate the complete intended result before slicing it. The
            // slice may temporarily retain staged deletions, but can never add
            // an unstaged destructive drop.
            const requestedIds = new Set(requestedMerge.map(getVisitedPlaceId).filter(Boolean).map(String));
            const serverDeletes = serverVisitedArray.filter(visit => {
                const id = getVisitedPlaceId(visit);
                return id && !requestedIds.has(String(id));
            });
            const deferredDeletes = serverDeletes.slice(MAX_DELETIONS_PER_TRANSACTION);
            deferredDeleteCount = deferredDeletes.length;

            if (deferredDeleteCount > 0) {
                const mergedIds = new Set(requestedMerge.map(getVisitedPlaceId).filter(Boolean).map(String));
                committedVisitedArray = requestedMerge.concat(
                    deferredDeletes
                        .filter(visit => !mergedIds.has(String(getVisitedPlaceId(visit))))
                        .map(cloneVisitedPlace)
                );
            } else {
                committedVisitedArray = requestedMerge;
            }

            // The free-plan cap only rejects new local additions; it never
            // drops a record already present in the authoritative document.
            if (!hasServerPremiumVisitedAccess(data) && committedVisitedArray.length > 5) {
                const capped = capFreeVisitedPlaces(serverVisitedArray, committedVisitedArray);
                committedVisitedArray = capped.visits;
                rejectedFreeVisitIds = capped.rejectedVisitIds;
            }

            // set(..., { merge: true }) preserves syncUserProgress's prior
            // ability to initialize a missing user document without replacing
            // other fields.
            transaction.set(userRef, { visitedPlaces: committedVisitedArray }, { merge: true });
        });
    } while (deferredDeleteCount > 0);

    return Object.freeze({
        committedVisitedArray,
        rejectedFreeVisitIds: Object.freeze(rejectedFreeVisitIds.slice()),
        capturedIntent
    });
}

async function runPostCommitVisitStep(step, callback) {
    try {
        await callback();
    } catch (error) {
        console.error(`[firebaseService] post-commit ${step} failed; server data remains authoritative:`, error);
    }
}

async function reconcileCommittedVisitedPlaces(uid, committedVisitedArray, commitProof) {
    // The transaction itself committed, but its promise may have resumed after
    // a newer listener/read already established a later authoritative state.
    // Resolve the original caller while leaving all local baseline, Vault, and
    // journals untouched for that newer authority (or a later retry) to settle.
    if (
        !commitProof
        || !authoritativeVisitEvidenceMatches(uid, commitProof.authoritativeEvidence)
    ) {
        markVisitedCommitResultStale(committedVisitedArray);
        console.warn('[firebaseService] skipped stale visitedPlaces transaction reconciliation');
        return;
    }

    const checkinService = window.BARK.services && window.BARK.services.checkin;
    let checkpointSaved = false;
    try {
        checkpointSaved = rememberAuthoritativeVisitedBaseline(uid, committedVisitedArray);
    } catch (error) {
        console.error('[firebaseService] authoritative visit checkpoint failed:', error);
    }
    // Capture the evidence even when the first checkpoint write fails. The
    // repository reconciliation below may yield, and a newer listener can
    // advance authority during that gap. In that case the older transaction
    // result must be tagged stale before its caller gets a chance to retry the
    // checkpoint through the direct-confirmation path.
    const postCheckpointEvidence = captureAuthoritativeVisitEvidence(uid);

    const currentUser = getCurrentUser();
    if (currentUser && currentUser.uid === uid) {
        await runPostCommitVisitStep('repository reconciliation', () => (
            reconcileVisitedPlacesSnapshot(committedVisitedArray, {
                fromCache: false,
                hasPendingWrites: false,
                canConfirmPending: checkpointSaved
            })
        ));
    }

    // Repository reconciliation is wrapped as a best-effort async step. A
    // listener can advance authority while that await yields; do not let the
    // older continuation clear either journal or reach direct confirmation.
    if (!authoritativeVisitEvidenceMatches(uid, postCheckpointEvidence)) {
        markVisitedCommitResultStale(committedVisitedArray);
        console.warn('[firebaseService] skipped superseded visitedPlaces transaction acknowledgements');
        return;
    }

    // The durable full baseline must survive a read-back before either journal
    // is cleared. If origin storage is unavailable, the backend may already
    // have committed, but the UI deliberately stays orange and retries proof.
    if (!checkpointSaved) return;

    // A free-plan rejection is also a journal-clearing acknowledgement. Delay
    // it until the same generation guard and durable checkpoint have succeeded.
    discardRejectedFreeVisitAdditions(
        uid,
        commitProof.rejectedFreeVisitIds,
        commitProof.capturedIntent
    );

    const mutationService = getVisitMutationCoordinatorService();
    if (mutationService && typeof mutationService.reconcileCommittedDeletes === 'function') {
        await runPostCommitVisitStep('deletion acknowledgement', () => (
            mutationService.reconcileCommittedDeletes(uid, committedVisitedArray)
        ));
    }
    if (!authoritativeVisitEvidenceMatches(uid, postCheckpointEvidence)) {
        markVisitedCommitResultStale(committedVisitedArray);
        console.warn('[firebaseService] skipped superseded visitedPlaces transaction follow-up');
        return;
    }
    if (getPendingVisitDeleteCount(uid) === 0) clearVisitWriteRecovery(uid);

    const activeUser = getCurrentUser();
    if (!activeUser || activeUser.uid !== uid) return;
    hideVisitedSyncRecoveryNoticeIfRecovered(uid);

    // The combined transaction is the authoritative acknowledgement for every
    // exact visit it returned—not only the click whose promise happened to be
    // observing the coordinator. Each local follow-up is best-effort because
    // none is allowed to reverse a completed Firestore transaction.
    if (checkinService && typeof checkinService.reconcileUnconfirmedVisits === 'function') {
        await runPostCommitVisitStep('pending addition reconciliation', () => (
            checkinService.reconcileUnconfirmedVisits(uid)
        ));
    }
    if (checkinService && typeof checkinService.notifyAuthoritativeSnapshot === 'function') {
        await runPostCommitVisitStep('confirmation notification', () => (
            checkinService.notifyAuthoritativeSnapshot()
        ));
    }

    await runPostCommitVisitStep('visited marker refresh', () => (
        refreshVisitedVisuals('firebase-committed-visits')
    ));
    if (typeof window.syncState === 'function') {
        await runPostCommitVisitStep('screen refresh', () => window.syncState());
    }

    // The final UI callbacks above may yield too. If newer authoritative
    // evidence arrived during any of them, prevent the transaction caller's
    // direct-confirmation continuation from reapplying this older array.
    if (!authoritativeVisitEvidenceMatches(uid, postCheckpointEvidence)) {
        markVisitedCommitResultStale(committedVisitedArray);
        console.warn('[firebaseService] retired superseded visitedPlaces transaction result');
    }
}

function getVisitedPlacesWriteCoordinator(uid) {
    if (visitedPlacesWriteCoordinators.has(uid)) return visitedPlacesWriteCoordinators.get(uid);

    const mutationService = getVisitMutationCoordinatorService();
    if (!mutationService || typeof mutationService.createCoordinator !== 'function') {
        throw makeVisitedWriteError('failed-precondition', 'Visit mutation coordinator is unavailable.');
    }

    let reconnectRecoveryActive = hasRecentVisitWriteRecovery(uid);
    let proofRefreshPromise = null;
    let completedCommitProof = null;
    const coordinator = mutationService.createCoordinator({
        debounceMs: 75,
        retryMs: 5000,
        capture() {
            const currentUser = getCurrentUser();
            if (!currentUser || currentUser.uid !== uid) {
                throw makeVisitedWriteError('stale-account', 'The signed-in account changed before visit sync completed.');
            }
            return captureVisitedPlaceIntents(uid);
        },
        async commit(capturedIntent) {
            completedCommitProof = null;
            const currentUser = getCurrentUser();
            if (!currentUser || currentUser.uid !== uid) {
                throw makeVisitedWriteError('stale-account', 'The signed-in account changed before visit sync completed.');
            }
            const db = firebase.firestore();
            const userRef = db.collection('users').doc(uid);
            const authoritativeEvidence = captureAuthoritativeVisitEvidence(uid);
            const commitResult = await commitVisitedPlacesAtomically(db, userRef, capturedIntent, uid);
            completedCommitProof = Object.freeze({
                authoritativeEvidence,
                rejectedFreeVisitIds: commitResult.rejectedFreeVisitIds,
                capturedIntent: commitResult.capturedIntent
            });
            return commitResult.committedVisitedArray;
        },
        onCommitted(committedVisitedArray) {
            const commitProof = completedCommitProof;
            completedCommitProof = null;
            return reconcileCommittedVisitedPlaces(uid, committedVisitedArray, commitProof);
        },
        onPostCommitError(error) {
            console.error('[firebaseService] committed visitedPlaces but could not finish local reconciliation:', error);
        },
        isRetryable(error) {
            if (isRetryableVisitedWriteError(error)) {
                if (getPendingVisitedIntentCount(uid) > 0) {
                    reconnectRecoveryActive = true;
                    rememberVisitWriteRecovery(uid);
                }
                return true;
            }

            const code = normalizeVisitedWriteErrorCode(error);
            const currentUser = getCurrentUser();

            if (code === 'permission-denied'
                && currentUser
                && currentUser.uid === uid
                && getPendingVisitedIntentCount(uid) > 0) {
                reconnectRecoveryActive = true;
                rememberVisitWriteRecovery(uid);
                return true;
            }

            if (!reconnectRecoveryActive || getPendingVisitedIntentCount(uid) === 0) return false;

            // iOS/Android PWAs can report online before Auth and App Check have
            // refreshed after fake cellular service. Preserve the orange
            // journal and retry these session-proof races instead of restoring
            // visits that the user intentionally removed.
            if (code === 'stale-account' && !currentUser) return true;
            return false;
        },
        getRetryDelay(error, attempt, defaultDelay) {
            const code = normalizeVisitedWriteErrorCode(error);
            if (code !== 'permission-denied' && code !== 'stale-account') return defaultDelay;
            const reconnectDelays = [1000, 2000, 5000, 10000, 30000, 60000];
            return reconnectDelays[Math.min(Math.max(1, attempt), reconnectDelays.length) - 1];
        },
        onDeferred(error) {
            console.warn('[firebaseService] visited-place write queued until service returns:', error);
            showVisitedSyncRecoveryNotice(uid);
            const code = normalizeVisitedWriteErrorCode(error);
            if (code === 'permission-denied' && !proofRefreshPromise) {
                proofRefreshPromise = refreshVisitedWriteSessionProof(uid)
                    .catch(refreshError => {
                        console.warn('[firebaseService] visit-write session refresh deferred:', refreshError);
                    })
                    .finally(() => { proofRefreshPromise = null; });
            }
        }
    });
    visitedPlacesWriteCoordinators.set(uid, coordinator);
    return coordinator;
}

function queueCurrentVisitedPlacesWrite() {
    const user = getCurrentUser();
    if (!user) return Promise.reject(makeVisitedWriteError('unauthenticated', 'Cannot sync visits while signed out.'));

    let coordinator;
    try {
        coordinator = getVisitedPlacesWriteCoordinator(user.uid);
    } catch (error) {
        return Promise.reject(error);
    }

    const endVisitedPlacesWrite = beginVisitedPlacesWrite();
    const stalledNoticeTimer = setTimeout(() => showVisitedSyncRecoveryNotice(user.uid), 15000);
    return coordinator.request().finally(() => {
        clearTimeout(stalledNoticeTimer);
        hideVisitedSyncRecoveryNoticeIfRecovered(user.uid);
        endVisitedPlacesWrite();
    });
}

function reconcileVisitedPlacesSnapshot(placeList, metadata = {}) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.reconcileSnapshot === 'function') {
        const result = vaultRepo.reconcileSnapshot(placeList, metadata);
        const change = result && result.change;
        if (change && change.recordsChanged) {
            refreshVisitedCache('firebase-reconcile-snapshot');
        }
        if (change && change.didChange) {
            refreshVisitedVisuals('firebase-reconcile-snapshot', change);
        }
        return result;
    }
    return makeVisitedPlaceMap(placeList);
}

function getAffectedParkIdsForVisitedChange(change) {
    if (!change || !(change.added instanceof Set)) return change || null;

    const affectedIds = new Set();
    [change.added, change.removed, change.changed, change.pendingChanged].forEach(ids => {
        if (!ids || typeof ids.forEach !== 'function') return;
        ids.forEach(id => affectedIds.add(id));
    });

    // Legacy coordinate-keyed visits can affect a canonical park with a different
    // ID. They are rare migration records, so use a full visual refresh for those
    // changes instead of risking a stale pin.
    for (const id of affectedIds) {
        if (!isCanonicalParkId(id)) return null;
    }
    return affectedIds;
}

function refreshVisitedVisualState(scope = null) {
    const parkIds = getAffectedParkIdsForVisitedChange(scope);
    const markerManager = window.BARK.markerManager;
    if (markerManager && typeof markerManager.refreshMarkerStyles === 'function') {
        markerManager.refreshMarkerStyles(parkIds);
    }
    const tripLayer = window.BARK.tripLayer;
    if (tripLayer && typeof tripLayer.refreshBadgeStyles === 'function') {
        tripLayer.refreshBadgeStyles(parkIds);
    }
}

function replaceLocalVisitedPlaces(visitedMap, options = {}) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.replaceAll === 'function') {
        vaultRepo.replaceAll(visitedMap, options);
    } else {
        throw new Error('VaultRepo unavailable for visited-place replacement.');
    }

    refreshVisitedCache('firebase-replace-local-visits');
    refreshVisitedVisuals('firebase-replace-local-visits');
}

async function attemptDailyStreakIncrement() {
    try {
        const user = getCurrentUser();
        if (!user) return { success: false, message: "Not logged in" };

        const today = getLocalDateKey();
        const docRef = firebase.firestore().collection('users').doc(user.uid);
        const doc = await docRef.get();
        const data = doc.exists ? doc.data() : {};

        const lastStreakDate = data.lastStreakDate || localStorage.getItem('lastStreakDate');
        if (lastStreakDate === today) return { success: false, message: "Already incremented today" };

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getLocalDateKey(yesterday);

        let currentStreak = parseInt(data.streakCount || localStorage.getItem('streakCount') || 0);

        if (lastStreakDate === yesterdayStr) {
            currentStreak += 1;
        } else {
            currentStreak = 1;
        }

        window.BARK.incrementRequestCount();
        await docRef.set({
            streakCount: currentStreak,
            lastStreakDate: today
        }, { merge: true });

        localStorage.setItem('lastStreakDate', today);
        localStorage.setItem('streakCount', currentStreak);

        const streakLabel = document.getElementById('streak-count-label');
        if (streakLabel) streakLabel.textContent = currentStreak;

        return { success: true, count: currentStreak };
    } catch (error) {
        console.error("[firebaseService] attemptDailyStreakIncrement failed:", error);
        return { success: false, message: error.message || "Failed to update streak" };
    }
}

async function syncUserProgress() {
    try {
        const user = getCurrentUser();
        if (!user) return;
        // The coordinator captures the newest VaultRepo state when its turn
        // begins. Rapid add/remove actions therefore coalesce instead of
        // launching competing transactions with stale arrays.
        return await queueCurrentVisitedPlacesWrite();
    } catch (error) {
        console.error("[firebaseService] syncUserProgress failed:", error);
        throw error;
    }
}

async function updateCurrentUserVisitedPlaces(visitedArray) {
    try {
        const user = getCurrentUser();
        if (!user) return;
        // `visitedArray` remains in the signature for compatibility. All
        // callers stage their mutation in VaultRepo first, so capture the live
        // repository at flush time rather than writing a stale caller snapshot.
        void visitedArray;
        return await queueCurrentVisitedPlacesWrite();
    } catch (error) {
        console.error("[firebaseService] updateCurrentUserVisitedPlaces failed:", error);
        throw error;
    }
}

async function updateVisitDate(parkId, newTs) {
    const vaultRepo = getVaultRepo();
    const tokenUid = getCurrentUser() ? getCurrentUser().uid : null;
    const token = vaultRepo && typeof vaultRepo.snapshot === 'function' ? vaultRepo.snapshot() : null;
    let rollbackToken = null;
    let committed = false;
    try {
        const visitedEntry = getVisitedPlaceEntry(parkId);
        if (visitedEntry) {
            const checkinService = window.BARK.services && window.BARK.services.checkin;
            const isLegacyPlaceholder = visitedEntry.record
                && visitedEntry.record.legacyOfflineBaseline === true;
            const isRememberedLegacyPlaceholder = checkinService
                && typeof checkinService.isLegacyAuthoritativeVisitPlaceholder === 'function'
                && checkinService.isLegacyAuthoritativeVisitPlaceholder(parkId);
            const isAwaitingVisitProof = checkinService
                && typeof checkinService.isVisitAwaitingServerProof === 'function'
                && checkinService.isVisitAwaitingServerProof(parkId);
            if (isLegacyPlaceholder || isRememberedLegacyPlaceholder || isAwaitingVisitProof) {
                throw makeVisitedWriteError(
                    'failed-precondition',
                    'Wait for this visit to finish syncing before editing its date.'
                );
            }
            const updatedPlace = {
                ...visitedEntry.record,
                ts: newTs
            };
            if (vaultRepo && typeof vaultRepo.addVisit === 'function') {
                vaultRepo.addVisit(updatedPlace);
            } else {
                throw new Error('VaultRepo unavailable for updateVisitDate.');
            }
            if (typeof vaultRepo.createRollbackToken === 'function') {
                rollbackToken = vaultRepo.createRollbackToken(token, [visitedEntry.id]);
            }
            stageVisitedPlaceUpsert(updatedPlace);
            await updateCurrentUserVisitedPlaces(getVisitedPlacesArray());
            // Server write succeeded past this point. A post-write render failure
            // must NOT roll back a committed change.
            committed = true;
            if (typeof window.BARK.renderManagePortal === 'function') window.BARK.renderManagePortal();
        }
    } catch (error) {
        if (!committed && vaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof vaultRepo.restore === 'function') {
            vaultRepo.restore(rollbackToken || token);
        } else if (!committed) {
            clearVisitedPlacePendingMutation(parkId);
        }
        console.error("[firebaseService] updateVisitDate failed:", error);
        throw error;
    }
}

function getVisitedPlaceId(placeOrId) {
    if (placeOrId && typeof placeOrId === 'object') return placeOrId.id || null;
    return placeOrId || null;
}

function getLatestVisitedPlace(placeId) {
    return getVisitedRecordById(placeId);
}

function discardPendingVisitAdditions(uid, entryIds) {
    const checkinService = window.BARK.services && window.BARK.services.checkin;
    if (!checkinService || typeof checkinService.discardPendingVisitAdditions !== 'function') return;
    checkinService.discardPendingVisitAdditions(uid, entryIds);
}

function cancelPendingVisitDeletion(uid, placeId) {
    return cancelPendingVisitDeletions(uid, [placeId]);
}

function cancelPendingVisitDeletions(uid, placeIds) {
    const mutationService = getVisitMutationCoordinatorService();
    if (!mutationService || typeof mutationService.clearDeletes !== 'function') return true;
    return mutationService.clearDeletes(uid, placeIds) !== false;
}

function clearPendingVisitDeletions(uid) {
    const mutationService = getVisitMutationCoordinatorService();
    if (!mutationService || typeof mutationService.getPendingDeleteIds !== 'function' || typeof mutationService.clearDeletes !== 'function') return;
    mutationService.clearDeletes(uid, mutationService.getPendingDeleteIds(uid));
}

function stageDurableVisitDeletions(uid, entries) {
    const mutationService = getVisitMutationCoordinatorService();
    if (!mutationService || typeof mutationService.stageDeletes !== 'function') {
        throw makeVisitedWriteError('local-safety-unavailable', 'Offline deletion recovery is unavailable.');
    }
    if (!mutationService.stageDeletes(uid, entries)) {
        throw makeVisitedWriteError('local-safety-unavailable', 'Could not save an offline-safe deletion record.');
    }
    const checkinService = window.BARK.services && window.BARK.services.checkin;
    if (checkinService && typeof checkinService.rememberAuthenticatedVisitUid === 'function') {
        checkinService.rememberAuthenticatedVisitUid(uid);
    }
}

function rollbackVisitDeletion(uid, rollbackToken, entryIds, error) {
    const mutationService = getVisitMutationCoordinatorService();
    if (mutationService && typeof mutationService.clearDeletes === 'function') {
        mutationService.clearDeletes(uid, entryIds);
    }

    const vaultRepo = getVaultRepo();
    if (vaultRepo && canRestoreVaultSnapshot(rollbackToken, uid) && typeof vaultRepo.restore === 'function') {
        vaultRepo.restore(rollbackToken);
    } else {
        entryIds.forEach(clearVisitedPlacePendingMutation);
    }
    refreshVisitedCache('firebase-remove-visit-rollback');
    refreshVisitedVisuals('firebase-remove-visit-rollback');
    refreshVisitRemovalUi('rollback');
    console.error('[firebaseService] visit deletion could not be saved:', error);
    alert('Those removals could not be saved. Your previous visit data has been restored. Please sign in again and retry.');
}

function refreshVisitRemovalUi(reason) {
    try {
        if (typeof window.syncState === 'function') window.syncState();
    } catch (error) {
        console.error(`[firebaseService] visit-removal syncState (${reason}) failed:`, error);
    }
    try {
        if (typeof window.BARK.renderManagePortal === 'function') window.BARK.renderManagePortal();
    } catch (error) {
        console.error(`[firebaseService] visit-removal portal render (${reason}) failed:`, error);
    }
}

function removeVisitedEntries(entries) {
    const normalizedEntries = (Array.isArray(entries) ? entries : [])
        .filter(entry => entry && entry.id)
        .map(entry => ({ id: String(entry.id), record: cloneVisitedPlace(entry.record) }));
    if (normalizedEntries.length === 0) {
        return { success: true, action: 'removed', syncStatus: 'confirmed', removedIds: [] };
    }

    const user = getCurrentUser();
    if (!user) throw makeVisitedWriteError('unauthenticated', 'Cannot remove visits while signed out.');
    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.snapshot !== 'function' || typeof vaultRepo.removeVisits !== 'function') {
        throw makeVisitedWriteError('failed-precondition', 'VaultRepo unavailable for visit removal.');
    }

    const entryIds = normalizedEntries.map(entry => entry.id);
    const token = vaultRepo.snapshot();

    // Persist the user's intent before changing a pixel. Transactions cannot
    // run offline, so this journal is what makes a deletion survive a PWA close.
    stageDurableVisitDeletions(user.uid, normalizedEntries);
    discardPendingVisitAdditions(user.uid, entryIds);

    vaultRepo.removeVisits(entryIds);
    const rollbackToken = typeof vaultRepo.createRollbackToken === 'function'
        ? vaultRepo.createRollbackToken(token, entryIds)
        : token;
    entryIds.forEach(stageVisitedPlaceDelete);
    refreshVisitedCache('firebase-remove-visits');
    refreshVisitedVisuals('firebase-remove-visits');
    refreshVisitRemovalUi('optimistic-delete');

    // Match offline additions: return immediately with a durable pending
    // mutation while the single coordinator keeps retrying until Firestore
    // confirms the newest combined state.
    const syncPromise = syncUserProgress();
    syncPromise.catch(error => {
        // The deletion intent was durably journaled before the UI changed.
        // Provider/auth/rules failures must not resurrect it or discard that
        // journal; it remains orange and is replayed on the next recovery.
        console.warn('[firebaseService] visit deletion remains queued for sync:', error);
    });

    return {
        success: true,
        action: 'removed',
        syncStatus: 'pending',
        removedIds: entryIds,
        syncPromise
    };
}

function replayPendingVisitDeletions(uid) {
    const user = getCurrentUser();
    if (!uid || !user || user.uid !== uid) return Promise.resolve([]);
    const mutationService = getVisitMutationCoordinatorService();
    const vaultRepo = getVaultRepo();
    if (!mutationService || typeof mutationService.getPendingDeleteIds !== 'function' || !vaultRepo) {
        return Promise.resolve([]);
    }

    const pendingIds = Array.from(mutationService.getPendingDeleteIds(uid));
    if (pendingIds.length === 0) return Promise.resolve([]);

    discardPendingVisitAdditions(uid, pendingIds);
    vaultRepo.removeVisits(pendingIds);
    pendingIds.forEach(stageVisitedPlaceDelete);
    refreshVisitedCache('firebase-replay-pending-deletes');
    refreshVisitedVisuals('firebase-replay-pending-deletes');
    if (typeof window.syncState === 'function') window.syncState();
    return syncUserProgress();
}

// During the bounded fake-service boot fallback, stage the durable deletion
// journal. No server call happens here: the pending class paints these
// otherwise-unvisited pins orange until normal auth replay can prove the
// deletion reached Firestore. Offline-first boot may have rendered the public
// pins already, so refresh the existing marker icons as well.
function hydrateRememberedPendingVisitDeletions(uid) {
    const mutationService = getVisitMutationCoordinatorService();
    const vaultRepo = getVaultRepo();
    if (!uid || !mutationService || !vaultRepo || typeof mutationService.getPendingDeleteIds !== 'function') {
        return 0;
    }

    const pendingIds = mutationService.getPendingDeleteIds(uid);
    if (pendingIds.length === 0) return 0;

    // Hydration applies the same projection order as live replay: trusted
    // server baseline first, then the durable local deletion overlay.
    vaultRepo.removeVisits(pendingIds);
    pendingIds.forEach(stageVisitedPlaceDelete);
    preAuthHydratedDeleteUid = uid;
    preAuthHydratedDeleteIds = new Set(pendingIds);
    refreshVisitedCache('firebase-preauth-delete-hydration');
    refreshVisitedVisuals('firebase-preauth-delete-hydration');
    return pendingIds.length;
}

// A pre-auth journal may remain visible only when Firebase restores the same
// account. A different account or signed-out result removes the temporary
// marker state without deleting the original account's durable journal.
function reconcilePreAuthPendingVisitDeletions(authenticatedUid) {
    if (!preAuthHydratedDeleteUid) return false;

    const matches = Boolean(authenticatedUid && authenticatedUid === preAuthHydratedDeleteUid);
    if (!matches) {
        const vaultRepo = getVaultRepo();
        preAuthHydratedDeleteIds.forEach(id => {
            const mutationType = vaultRepo && typeof vaultRepo.getPendingMutationType === 'function'
                ? vaultRepo.getPendingMutationType(id)
                : null;
            if (mutationType === 'delete') clearVisitedPlacePendingMutation(id);
        });
        refreshVisitedCache('firebase-preauth-delete-account-mismatch');
        refreshVisitedVisuals('firebase-preauth-delete-account-mismatch');
    }

    preAuthHydratedDeleteUid = null;
    preAuthHydratedDeleteIds = new Set();
    return matches;
}

function reconcilePendingVisitDeletions(uid) {
    const mutationService = getVisitMutationCoordinatorService();
    const vaultRepo = getVaultRepo();
    if (!uid || !mutationService || !vaultRepo || typeof mutationService.getPendingDeleteIds !== 'function') return [];

    const confirmedIds = mutationService.getPendingDeleteIds(uid).filter(id => (
        typeof vaultRepo.hasPendingMutation === 'function' &&
        !vaultRepo.hasPendingMutation(id) &&
        typeof vaultRepo.hasVisit === 'function' &&
        !vaultRepo.hasVisit(id)
    ));
    if (typeof mutationService.clearDeletes === 'function') mutationService.clearDeletes(uid, confirmedIds);
    return confirmedIds;
}

async function removeVisitedPlace(placeOrId) {
    const placeId = getVisitedPlaceId(placeOrId);
    try {
        const latestPlace = getLatestVisitedPlace(placeId);
        if (!latestPlace) {
            if (typeof window.BARK.renderManagePortal === 'function') {
                window.BARK.renderManagePortal();
            }
            alert("That visit is no longer in your Manage Portal. The list has been refreshed.");
            return;
        }

        if (window.confirm(`Remove ${latestPlace.name || 'this visit'}?`)) {
            const matchingEntries = getVisitedPlaceEntries(latestPlace);
            const entriesToRemove = matchingEntries.length > 0
                ? matchingEntries
                : [{ id: placeId, record: latestPlace }];
            return removeVisitedEntries(entriesToRemove);
        }
    } catch (error) {
        console.error("[firebaseService] removeVisitedPlace failed:", error);
        throw error;
    }
}

async function loadSavedRoutes(uid, cursor = null, limit = null) {
    try {
        requireSavedRoutesPremium();
        const fetchLimit = limit || (cursor ? 5 : 3);
        window.BARK.incrementRequestCount();

        let query = firebase.firestore()
            .collection('users').doc(uid)
            .collection('savedRoutes')
            .orderBy('createdAt', 'desc');

        if (cursor) query = query.startAfter(cursor);

        const snapshot = await query.limit(fetchLimit).get();
        const routes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return {
            routes,
            nextCursor: snapshot.empty ? null : snapshot.docs[snapshot.docs.length - 1],
            hasMore: snapshot.size === fetchLimit
        };
    } catch (error) {
        console.error("[firebaseService] loadSavedRoutes failed:", error);
        throw error;
    }
}

async function loadSavedRoute(uid, routeId) {
    try {
        requireSavedRoutesPremium();
        window.BARK.incrementRequestCount();
        const docSnap = await firebase.firestore()
            .collection('users').doc(uid)
            .collection('savedRoutes').doc(routeId).get();
        return docSnap.exists ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
        console.error("[firebaseService] loadSavedRoute failed:", error);
        throw error;
    }
}

async function deleteSavedRoute(uid, routeId) {
    try {
        window.BARK.incrementRequestCount();
        await firebase.firestore()
            .collection('users').doc(uid)
            .collection('savedRoutes').doc(routeId).delete();
    } catch (error) {
        console.error("[firebaseService] deleteSavedRoute failed:", error);
        throw error;
    }
}

async function getCompletedExpeditions(uid) {
    try {
        if (!uid) return [];

        window.BARK.incrementRequestCount();
        const docSnap = await firebase.firestore().collection('users').doc(uid).get();
        if (!docSnap.exists) return [];

        return readCompletedExpeditionsFromUserData(docSnap.data());
    } catch (error) {
        console.error("[firebaseService] getCompletedExpeditions failed:", error);
        throw error;
    }
}

async function saveUserSettings(uid, settingsPayload) {
    try {
        if (!uid) throw new Error("Cannot save settings without a user id.");

        window.BARK.incrementRequestCount();
        await firebase.firestore().collection('users').doc(uid).set({ settings: settingsPayload }, { merge: true });
    } catch (error) {
        console.error("[firebaseService] saveUserSettings failed:", error);
        throw error;
    }
}

async function adminEditPoints() {
    if (!window.isAdmin) return alert("Unauthorized: Admin credentials required.");

    const user = getCurrentUser();
    if (!user) return alert("Unauthorized: Admin credentials required.");

    const currentVal = window.currentWalkPoints || 0;
    const newScore = prompt("ADMIN: Manually override your Walk Points?", currentVal);

    if (newScore !== null && !isNaN(newScore)) {
        const finalPoints = parseFloat(newScore);
        try {
            window.BARK.incrementRequestCount();
            await firebase.firestore().collection('users').doc(user.uid).set({ walkPoints: finalPoints }, { merge: true });
            alert(`Admin Success: Walk Points set to ${finalPoints}`);
        } catch (error) {
            console.error("[firebaseService] adminEditPoints failed:", error);
            alert("Failed to override points.");
        }
    }
}

const firebaseService = {
    getCurrentUser,
    attemptDailyStreakIncrement,
    syncUserProgress,
    updateCurrentUserVisitedPlaces,
    updateVisitDate,
    removeVisitedPlace,
    removeVisitedEntries,
    replayPendingVisitDeletions,
    hydrateRememberedPendingVisitDeletions,
    reconcilePreAuthPendingVisitDeletions,
    reconcilePendingVisitDeletions,
    cancelPendingVisitDeletion,
    cancelPendingVisitDeletions,
    clearPendingVisitDeletions,
    reconcileVisitedPlacesSnapshot,
    replaceLocalVisitedPlaces,
    refreshVisitedVisualState,
    getVisitedPlaceEntry,
    getVisitedPlaceEntries,
    isParkVisited,
    normalizeLocalVisitedPlacesToCanonical,
    stageVisitedPlaceUpsert,
    stageVisitedPlaceDelete,
    clearVisitedPlacePendingMutation,
    clearVisitedPlacePendingMutations,
    hasVisitedPlacesWriteInFlight,
    loadSavedRoutes,
    loadSavedRoute,
    deleteSavedRoute,
    getCompletedExpeditions,
    saveUserSettings,
    adminEditPoints
};

window.BARK.services.firebase = firebaseService;
window.attemptDailyStreakIncrement = attemptDailyStreakIncrement;
window.BARK.syncUserProgress = syncUserProgress;
window.BARK.updateCurrentUserVisitedPlaces = updateCurrentUserVisitedPlaces;
window.BARK.updateVisitDate = updateVisitDate;
window.BARK.removeVisitedPlace = removeVisitedPlace;
window.BARK.getVisitedPlaceEntry = getVisitedPlaceEntry;
window.BARK.getVisitedPlaceEntries = getVisitedPlaceEntries;
window.BARK.isParkVisited = isParkVisited;
window.BARK.normalizeLocalVisitedPlacesToCanonical = normalizeLocalVisitedPlacesToCanonical;
window.BARK.getCompletedExpeditions = getCompletedExpeditions;
window.BARK.saveUserSettings = saveUserSettings;
window.adminEditPoints = adminEditPoints;
