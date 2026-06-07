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

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getCurrentUser() {
    if (typeof firebase === 'undefined') return null;
    return firebase.auth().currentUser;
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

function refreshVisitedVisuals(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedVisuals === 'function') {
        coordinator.refreshVisitedVisuals(reason);
        return true;
    }

    refreshVisitedVisualState();
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
        for (const [visitedId, visitedRecord] of getVisitedPlaceEntryPairs()) {
            const storedId = cleanValue((visitedRecord && visitedRecord.id) || visitedId);
            const requestedId = cleanValue(place.id);
            const storedIsCanonical = isCanonicalParkId(storedId) || isCanonicalParkId(visitedId);
            if (storedIsCanonical && storedId !== requestedId && cleanValue(visitedId) !== requestedId) continue;
            if (coordsMatch(place.lat, place.lng, visitedRecord && visitedRecord.lat, visitedRecord && visitedRecord.lng)) {
                addEntry(visitedId);
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
    return getVisitedPlaceEntries(placeOrId).length > 0;
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
    return {
        id: point.id,
        name: point.name,
        lat: point.lat,
        lng: point.lng,
        state: point.state || visit.state || '',
        verified: Boolean(visit.verified),
        ts: Number.isFinite(Number(visit.ts)) ? Number(visit.ts) : Date.now()
    };
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
    return metadata.fromCache !== true && metadata.hasPendingWrites !== true;
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

async function mergeServerVisitedPlacesForSafeWrite(userRef, nextVisitedArray) {
    if (!userRef || typeof userRef.get !== 'function') return nextVisitedArray;

    let serverVisitedArray = [];
    try {
        window.BARK.incrementRequestCount();
        const doc = await userRef.get();
        const data = doc && doc.exists && typeof doc.data === 'function' ? (doc.data() || {}) : {};
        serverVisitedArray = Array.isArray(data.visitedPlaces) ? data.visitedPlaces.map(cloneVisitedPlace) : [];
    } catch (error) {
        console.warn('[firebaseService] Could not verify server visitedPlaces before write; local destructive guard still applies.', error);
        return nextVisitedArray;
    }

    if (serverVisitedArray.length === 0) return nextVisitedArray;

    const nextMap = makeVisitedPlaceMap(nextVisitedArray);
    const serverMap = makeVisitedPlaceMap(serverVisitedArray);
    const missingServerVisits = [];

    serverMap.forEach((serverVisit, id) => {
        if (nextMap.has(id)) return;

        const pendingMutation = getVisitedPlacePendingMutation(id);
        if (pendingMutation && pendingMutation.type === 'delete') return;
        missingServerVisits.push(serverVisit);
    });

    if (missingServerVisits.length === 0) return nextVisitedArray;

    const destructiveDropThreshold = Math.max(3, Math.ceil(serverMap.size * 0.25));
    if (serverMap.size >= 3 && missingServerVisits.length >= destructiveDropThreshold) {
        console.warn('[firebaseService] Preserving server visitedPlaces during sparse local write.', {
            serverCount: serverMap.size,
            localCount: nextMap.size,
            preservedCount: missingServerVisits.length
        });
    }

    missingServerVisits.forEach((visit) => {
        if (visit && visit.id) nextMap.set(visit.id, cloneVisitedPlace(visit));
    });

    return Array.from(nextMap.values());
}

function reconcileVisitedPlacesSnapshot(placeList, metadata = {}) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.reconcileSnapshot === 'function') {
        const result = vaultRepo.reconcileSnapshot(placeList, metadata);
        refreshVisitedCache('firebase-reconcile-snapshot');
        refreshVisitedVisuals('firebase-reconcile-snapshot');
        return result;
    }
    return makeVisitedPlaceMap(placeList);
}

function refreshVisitedVisualState() {
    const markerManager = window.BARK.markerManager;
    if (markerManager && typeof markerManager.refreshMarkerStyles === 'function') {
        markerManager.refreshMarkerStyles();
    }
    const tripLayer = window.BARK.tripLayer;
    if (tripLayer && typeof tripLayer.refreshBadgeStyles === 'function') {
        tripLayer.refreshBadgeStyles();
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
    let visitedArray = [];
    let endVisitedPlacesWrite = null;
    try {
        const user = getCurrentUser();
        if (!user) return;

        const db = firebase.firestore();
        window.BARK.incrementRequestCount();

        visitedArray = getVisitedPlacesArray();
        // Callers stage the specific visit they changed. Bulk-staging every
        // record here breaks the pending/orange confirmation state.
        visitedArray = await mergeServerVisitedPlacesForSafeWrite(db.collection('users').doc(user.uid), visitedArray);
        assertVisitedWriteIsNotDestructive(visitedArray);
        endVisitedPlacesWrite = beginVisitedPlacesWrite();
        await db.collection('users').doc(user.uid).set({
            visitedPlaces: visitedArray
        }, { merge: true });
        replaceLocalVisitedPlaces(makeVisitedPlaceMap(visitedArray), {
            source: 'sync-user-progress-merged-write'
        });

        window.syncState();
    } catch (error) {
        visitedArray.forEach(place => clearVisitedPlacePendingMutation(place && place.id));
        console.error("[firebaseService] syncUserProgress failed:", error);
        throw error;
    } finally {
        if (endVisitedPlacesWrite) endVisitedPlacesWrite();
    }
}

async function updateCurrentUserVisitedPlaces(visitedArray) {
    let nextVisitedArray = [];
    let endVisitedPlacesWrite = null;
    try {
        const user = getCurrentUser();
        if (!user) return;

        nextVisitedArray = Array.isArray(visitedArray) ? visitedArray.map(cloneVisitedPlace) : [];
        const userRef = firebase.firestore().collection('users').doc(user.uid);
        nextVisitedArray = await mergeServerVisitedPlacesForSafeWrite(userRef, nextVisitedArray);
        assertVisitedWriteIsNotDestructive(nextVisitedArray);
        // Do not bulk-stage here; verify/mark/update callers own pending state.
        window.BARK.incrementRequestCount();
        endVisitedPlacesWrite = beginVisitedPlacesWrite();
        await userRef.update({ visitedPlaces: nextVisitedArray });
        replaceLocalVisitedPlaces(makeVisitedPlaceMap(nextVisitedArray), {
            source: 'update-current-user-visited-merged-write'
        });
        if (typeof window.syncState === 'function') window.syncState();
    } catch (error) {
        nextVisitedArray.forEach(place => clearVisitedPlacePendingMutation(place && place.id));
        console.error("[firebaseService] updateCurrentUserVisitedPlaces failed:", error);
        throw error;
    } finally {
        if (endVisitedPlacesWrite) endVisitedPlacesWrite();
    }
}

async function updateVisitDate(parkId, newTs) {
    const vaultRepo = getVaultRepo();
    const tokenUid = getCurrentUser() ? getCurrentUser().uid : null;
    const token = vaultRepo && typeof vaultRepo.snapshot === 'function' ? vaultRepo.snapshot() : null;
    let rollbackToken = null;
    try {
        const visitedEntry = getVisitedPlaceEntry(parkId);
        if (visitedEntry) {
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
            window.BARK.renderManagePortal();
        }
    } catch (error) {
        if (vaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof vaultRepo.restore === 'function') {
            vaultRepo.restore(rollbackToken || token);
        } else {
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

async function removeVisitedPlace(placeOrId) {
    const placeId = getVisitedPlaceId(placeOrId);
    const vaultRepo = getVaultRepo();
    const tokenUid = getCurrentUser() ? getCurrentUser().uid : null;
    const token = vaultRepo && typeof vaultRepo.snapshot === 'function' ? vaultRepo.snapshot() : null;
    let rollbackToken = null;
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
            const entryIds = entriesToRemove.map(entry => entry.id);

            if (vaultRepo && typeof vaultRepo.removeVisits === 'function') {
                vaultRepo.removeVisits(entryIds);
            } else {
                throw new Error('VaultRepo unavailable for removeVisitedPlace.');
            }
            if (typeof vaultRepo.createRollbackToken === 'function') {
                rollbackToken = vaultRepo.createRollbackToken(token, entryIds);
            }
            entryIds.forEach(stageVisitedPlaceDelete);
            refreshVisitedCache('firebase-remove-visit');
            refreshVisitedVisuals('firebase-remove-visit');
            await syncUserProgress();
            window.syncState();
            window.BARK.renderManagePortal();
        }
    } catch (error) {
        if (vaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof vaultRepo.restore === 'function') {
            vaultRepo.restore(rollbackToken || token);
        } else {
            clearVisitedPlacePendingMutation(placeId);
        }
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
