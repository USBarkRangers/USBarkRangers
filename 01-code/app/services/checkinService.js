/**
 * checkinService.js - GPS check-in validation and visit record construction.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

const FREE_VISIT_LIMIT = 5;

// Hard upper bound on how long we wait for the Firebase visit-write to acknowledge
// before assuming the network is too slow/flaky and treating the visit as "saved
// locally, will sync when online". With Firestore offline persistence enabled the
// write is durably queued in IndexedDB regardless of network state, so this
// timeout never causes data loss — it just frees the UI to give the user honest
// feedback instead of spinning forever on a dead/weak connection.
const FIREBASE_WRITE_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_SENTINEL = '__BARK_WRITE_TIMEOUT__';

// localStorage key holding visits that have been added locally but not yet
// confirmed by an authoritative Firestore snapshot. Survives PWA close so that
// writes which never reached the server (Maddy's Edgar Evins case) can be
// replayed on the next launch.
function getUnconfirmedVisitsKey(uid) {
    return uid ? `bark.unconfirmedVisits.${uid}` : null;
}

function loadUnconfirmedVisitsMap(uid) {
    const key = getUnconfirmedVisitsKey(uid);
    if (!key) return {};
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.warn('[checkinService] unable to read unconfirmed visits cache:', error);
        return {};
    }
}

function saveUnconfirmedVisitsMap(uid, map) {
    const key = getUnconfirmedVisitsKey(uid);
    if (!key) return;
    try {
        if (!map || Object.keys(map).length === 0) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(map));
        }
    } catch (error) {
        console.warn('[checkinService] unable to persist unconfirmed visits cache:', error);
    }
}

function stashUnconfirmedVisit(uid, visit) {
    if (!uid || !visit || !visit.id) return;
    const map = loadUnconfirmedVisitsMap(uid);
    map[visit.id] = { visit, stashedAt: Date.now() };
    saveUnconfirmedVisitsMap(uid, map);
}

function clearUnconfirmedVisit(uid, visitId) {
    if (!uid || !visitId) return;
    const map = loadUnconfirmedVisitsMap(uid);
    if (!map[visitId]) return;
    delete map[visitId];
    saveUnconfirmedVisitsMap(uid, map);
}

// Called from the authoritative Firestore snapshot handler in authService. Any
// visit that the server now knows about can be safely removed from the local
// safety net. Visits still missing from the server stay queued for replay.
function reconcileUnconfirmedVisits(uid) {
    if (!uid) return;
    const map = loadUnconfirmedVisitsMap(uid);
    const ids = Object.keys(map);
    if (ids.length === 0) return;

    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.hasVisit !== 'function') return;

    let mutated = false;
    ids.forEach(id => {
        const isServerConfirmed = vaultRepo.hasVisit(id)
            && typeof vaultRepo.hasPendingMutation === 'function'
            && !vaultRepo.hasPendingMutation(id);
        if (isServerConfirmed) {
            delete map[id];
            mutated = true;
        }
    });
    if (mutated) saveUnconfirmedVisitsMap(uid, map);
}

// Called from authService once the user's session is restored. Re-adds any
// visits that weren't confirmed before the PWA last closed, and re-stages the
// Firebase write so they sync as soon as connectivity allows.
async function replayUnconfirmedVisits(uid) {
    if (!uid) return;
    const map = loadUnconfirmedVisitsMap(uid);
    const entries = Object.values(map);
    if (entries.length === 0) return;

    const vaultRepo = getVaultRepo();
    const firebaseService = getFirebaseService();
    if (!vaultRepo || !firebaseService) return;

    let restored = 0;
    entries.forEach(entry => {
        const visit = entry && entry.visit;
        if (!visit || !visit.id) return;
        if (vaultRepo.hasVisit(visit.id)) return;
        vaultRepo.addVisit(visit);
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(visit);
        }
        restored++;
    });

    if (restored > 0) {
        console.log(`[checkinService] Replayed ${restored} unconfirmed visit(s) from local cache.`);
        refreshVisitedCache('checkin-unconfirmed-replay');
        refreshVisitedVisuals('checkin-unconfirmed-replay', firebaseService);
        try {
            if (typeof firebaseService.updateCurrentUserVisitedPlaces === 'function') {
                await firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray());
            }
        } catch (error) {
            // Persistence layer will keep retrying; localStorage stash still protects us.
            console.warn('[checkinService] replay write deferred (offline/flaky network):', error);
        }
    }
}

function isNetworkLikeError(error) {
    if (error === WRITE_TIMEOUT_SENTINEL) return true;
    if (!navigator.onLine) return true;
    const code = error && error.code ? String(error.code) : '';
    return code === 'unavailable'
        || code === 'deadline-exceeded'
        || code === 'cancelled'
        || code === 'aborted';
}

function awaitWithFirebaseWriteTimeout(writePromiseFactory) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(WRITE_TIMEOUT_SENTINEL);
        }, FIREBASE_WRITE_TIMEOUT_MS);

        Promise.resolve()
            .then(writePromiseFactory)
            .then(value => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(value);
            })
            .catch(error => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

// Pending confirmations live here while their visit IDs wait to appear in an
// authoritative server snapshot. authService calls notifyAuthoritativeSnapshot()
// whenever such a snapshot arrives so we can resolve any matching promises and
// flip the UI from "verifying…" (yellow) to "verified" (green).
const pendingServerConfirmations = new Map();

// A visit is "server-confirmed" only when an authoritative Firestore snapshot
// has arrived AND the snapshot itself contained the visit (so the reconcile
// dropped the pending mutation). hasVisit() alone is not enough — it returns
// true even for purely-local optimistic adds (e.g. airplane-mode taps).
function isVisitServerConfirmed(vaultRepo, visitId) {
    if (!vaultRepo || typeof vaultRepo.hasVisit !== 'function') return false;
    if (!vaultRepo.hasVisit(visitId)) return false;
    // If pending introspection isn't available, fall back to a conservative
    // "not confirmed" — we'd rather time out to orange than lie green.
    if (typeof vaultRepo.hasPendingMutation !== 'function') return false;
    return !vaultRepo.hasPendingMutation(visitId);
}

function awaitServerConfirmation(visitId, options = {}) {
    return new Promise(resolve => {
        if (!visitId) {
            resolve({ confirmed: false, reason: 'no-visit-id' });
            return;
        }

        const vaultRepo = getVaultRepo();
        if (!vaultRepo) {
            resolve({ confirmed: false, reason: 'unavailable' });
            return;
        }

        // Only resolve immediately if BOTH conditions hold: a prior
        // authoritative snapshot arrived AND that snapshot actually contained
        // the visit (so the pending mutation was cleared by reconcile).
        // Critically, in airplane mode the pending mutation is still set, so
        // this short-circuit will not fire — preventing the false-positive
        // "Verified & Secured" we just hit.
        if (window._visitedPlacesServerSnapshotReceived && isVisitServerConfirmed(vaultRepo, visitId)) {
            resolve({ confirmed: true });
            return;
        }

        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;

        let resolved = false;
        let timeoutHandle = null;
        const settle = (result) => {
            if (resolved) return;
            resolved = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            pendingServerConfirmations.delete(visitId);
            resolve(result);
        };

        timeoutHandle = setTimeout(() => {
            settle({ confirmed: false, reason: 'timeout' });
        }, timeoutMs);

        // Path 1: snapshot listener fires (notifyAuthoritativeSnapshot → matching pending cleared)
        pendingServerConfirmations.set(visitId, { resolve: settle, timeoutHandle });

        // Path 2: Firestore.waitForPendingWrites() — resolves the moment the
        // server has acknowledged all locally-queued writes. On fast wifi
        // this is typically the FIRST signal to arrive (faster than the
        // snapshot listener, which can be debounced for a second or two in
        // WKWebView). When it resolves we proactively clear the pending
        // mutation so the marker can re-style green without waiting for the
        // potentially-laggy snapshot. Safe because the server has confirmed
        // the write — same level of certainty as the snapshot path.
        if (typeof firebase !== 'undefined' && firebase.firestore
            && typeof firebase.firestore().waitForPendingWrites === 'function') {
            firebase.firestore().waitForPendingWrites()
                .then(() => {
                    if (resolved) return;
                    const firebaseService = getFirebaseService();
                    if (firebaseService && typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
                        firebaseService.clearVisitedPlacePendingMutation(visitId);
                        refreshVisitedVisuals('checkin-pending-writes-flushed', firebaseService);
                    }
                    settle({ confirmed: true });
                })
                .catch(error => {
                    // Don't fail the whole confirmation — the snapshot path
                    // (or the timeout) will still resolve us.
                    console.warn('[checkinService] waitForPendingWrites rejected:', error);
                });
        }
    });
}

function notifyAuthoritativeSnapshot() {
    if (pendingServerConfirmations.size === 0) return;
    const vaultRepo = getVaultRepo();
    if (!vaultRepo) return;

    pendingServerConfirmations.forEach((entry, visitId) => {
        // Same gate as the immediate-check path: server snapshot must have
        // included the visit (pending mutation cleared by reconcile).
        if (!isVisitServerConfirmed(vaultRepo, visitId)) return;
        clearTimeout(entry.timeoutHandle);
        pendingServerConfirmations.delete(visitId);
        entry.resolve({ confirmed: true });
    });
}

function cancelPendingServerConfirmations(reason) {
    if (pendingServerConfirmations.size === 0) return;
    pendingServerConfirmations.forEach(entry => {
        clearTimeout(entry.timeoutHandle);
        entry.resolve({ confirmed: false, reason: reason || 'cancelled' });
    });
    pendingServerConfirmations.clear();
}

// Force a full server-sync recovery cycle. Called when the browser detects
// it just came back online (window 'online' event) to bypass any WKWebView
// quirk that suppresses Firestore's metadata-change snapshot. Sequence:
//   1. Wait for all queued writes to flush to the server.
//   2. Force a fresh `doc.get({source: 'server'})` — this guarantees the
//      snapshot listener fires with authoritative metadata.
//   3. If waitForPendingWrites resolves, clear local pending mutations because
//      the SDK has confirmed the queued writes reached the backend.
//   4. Refresh all visited visuals so orange pins flip green.
let forceSyncRecoveryInFlight = false;
async function forceServerSyncRecovery(reason) {
    if (forceSyncRecoveryInFlight) return;
    forceSyncRecoveryInFlight = true;
    try {
        if (typeof firebase === 'undefined' || !firebase.firestore) return;

        const firestore = firebase.firestore();
        let pendingWritesFlushed = false;
        if (typeof firestore.waitForPendingWrites === 'function') {
            await Promise.race([
                firestore.waitForPendingWrites(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('waitForPendingWrites timeout')), 20000))
            ]).then(() => {
                pendingWritesFlushed = true;
            }).catch(error => console.warn(`[checkinService] waitForPendingWrites (${reason}) failed:`, error));
        }

        if (firebase.auth) {
            const user = firebase.auth().currentUser;
            if (user) {
                await firestore.collection('users').doc(user.uid)
                    .get({ source: 'server' })
                    .catch(error => console.warn(`[checkinService] server doc fetch (${reason}) failed:`, error));
            }
        }

        const vaultRepo = getVaultRepo();
        if (pendingWritesFlushed && vaultRepo && typeof vaultRepo.clearPendingMutations === 'function') {
            vaultRepo.clearPendingMutations();
        }

        // Wake any in-flight awaitServerConfirmation promises that match
        // visits the server now has, then refresh all visuals so orange
        // pins/buttons flip green.
        notifyAuthoritativeSnapshot();
        refreshVisitedCache(`force-sync-recovery-${reason}`);
        refreshVisitedVisuals(`force-sync-recovery-${reason}`, getFirebaseService());
    } catch (error) {
        console.warn(`[checkinService] forceServerSyncRecovery (${reason}) failed:`, error);
    } finally {
        forceSyncRecoveryInFlight = false;
    }
}

if (typeof window !== 'undefined' && !window._barkOnlineRecoveryBound) {
    window._barkOnlineRecoveryBound = true;
    window.addEventListener('online', () => {
        // Small delay so Firestore's own network detector wakes up first.
        setTimeout(() => forceServerSyncRecovery('browser-online'), 1500);
    });
}

function getLocationCoords(userLocation) {
    const source = userLocation && userLocation.coords ? userLocation.coords : userLocation;
    if (!source) return null;

    const latitude = Number(source.latitude);
    const longitude = Number(source.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return { latitude, longitude };
}

function getFirebaseService() {
    return window.BARK.services && window.BARK.services.firebase;
}

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getPremiumService() {
    return window.BARK.services && window.BARK.services.premium;
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

function refreshVisitedVisuals(reason, firebaseService = null) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedVisuals === 'function') {
        coordinator.refreshVisitedVisuals(reason);
        return true;
    }

    const fallbackFirebaseService = firebaseService || (window.BARK.services && window.BARK.services.firebase);
    if (fallbackFirebaseService && typeof fallbackFirebaseService.refreshVisitedVisualState === 'function') {
        fallbackFirebaseService.refreshVisitedVisualState();
        return true;
    }

    return false;
}

function requestVisitStateSync(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.requestVisitStateSync === 'function') {
        coordinator.requestVisitStateSync(reason);
        return true;
    }

    if (typeof window.syncState === 'function') {
        window.syncState();
        return true;
    }

    return false;
}

function getCheckinVisitedPlacesArray() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.getVisits === 'function') {
        return vaultRepo.getVisits();
    }

    return [];
}

function getCheckinVisitedPlaceEntries(parkData) {
    if (typeof window.BARK.getVisitedPlaceEntries === 'function') {
        return window.BARK.getVisitedPlaceEntries(parkData);
    }

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function' && typeof vaultRepo.getVisit === 'function') {
        return vaultRepo.hasVisit(parkData)
            ? [{ id: parkData.id, record: vaultRepo.getVisit(parkData) }]
            : [];
    }

    return [];
}

function getCurrentFirebaseUser() {
    return typeof firebase !== 'undefined' && firebase.auth
        ? firebase.auth().currentUser
        : null;
}

function canRestoreVaultSnapshot(token, expectedUid) {
    const user = getCurrentFirebaseUser();
    return Boolean(user && token && (!expectedUid || user.uid === expectedUid));
}

function getCurrentFirebaseUid() {
    const user = getCurrentFirebaseUser();
    return user ? user.uid : null;
}

function isCurrentUserPremium() {
    const premiumService = getPremiumService();
    return Boolean(
        premiumService &&
        typeof premiumService.isPremium === 'function' &&
        premiumService.isPremium()
    );
}

function getCurrentVisitCount() {
    return getCheckinVisitedPlacesArray()
        .filter(place => place && place.id !== undefined && place.id !== null && place.id !== '')
        .length;
}

function getFreeVisitLimitBlock(visitedEntries) {
    if (!getCurrentFirebaseUser()) return null;
    if (isCurrentUserPremium()) return null;
    if (Array.isArray(visitedEntries) && visitedEntries.length > 0) return null;

    const currentCount = getCurrentVisitCount();
    if (currentCount < FREE_VISIT_LIMIT) return null;

    return {
        success: false,
        error: 'FREE_VISIT_LIMIT',
        limit: FREE_VISIT_LIMIT,
        currentCount
    };
}

function createVisitRecord(parkData, verified) {
    return {
        id: parkData.id,
        name: parkData.name,
        lat: parkData.lat,
        lng: parkData.lng,
        verified,
        ts: Date.now()
    };
}

function getCurrentPosition(options) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            resolve({ error: 'GEOLOCATION_UNSUPPORTED' });
            return;
        }

        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
}

function queueDailyStreakIncrement(firebaseService) {
    if (firebaseService && typeof firebaseService.attemptDailyStreakIncrement === 'function') {
        firebaseService.attemptDailyStreakIncrement()
            .catch(error => console.error('[checkinService] daily streak increment failed:', error));
    }
}

function verifyAndProcessCheckin(parkData, userLocation) {
    const result = {
        success: false,
        distance: 0,
        visitRecord: null,
        error: null
    };

    try {
        const coords = getLocationCoords(userLocation);
        if (!coords) {
            result.error = 'INVALID_USER_LOCATION';
            return result;
        }

        if (!parkData) {
            result.error = 'MISSING_PARK_DATA';
            return result;
        }

        const parkLat = Number(parkData.lat);
        const parkLng = Number(parkData.lng);
        if (!Number.isFinite(parkLat) || !Number.isFinite(parkLng)) {
            result.error = 'INVALID_PARK_LOCATION';
            return result;
        }

        const haversine = window.BARK.utils && window.BARK.utils.geo && window.BARK.utils.geo.haversine;
        if (typeof haversine !== 'function') {
            result.error = 'GEO_UTIL_UNAVAILABLE';
            return result;
        }

        const radiusKm = window.BARK.config ? Number(window.BARK.config.CHECKIN_RADIUS_KM) : NaN;
        if (!Number.isFinite(radiusKm)) {
            result.error = 'CHECKIN_RADIUS_UNAVAILABLE';
            return result;
        }

        const distance = haversine(coords.latitude, coords.longitude, parkLat, parkLng);
        result.distance = distance;

        if (distance > radiusKm) {
            result.error = 'OUT_OF_RANGE';
            return result;
        }

        result.success = true;
        result.visitRecord = createVisitRecord(parkData, true);
        return result;
    } catch (error) {
        console.error('[checkinService] verifyAndProcessCheckin failed:', error);
        result.error = 'CHECKIN_FAILED';
        return result;
    }
}

async function verifyGpsCheckin(parkData) {
    const firebaseService = getFirebaseService();

    if (!firebaseService || typeof firebaseService.updateCurrentUserVisitedPlaces !== 'function') {
        return { success: false, error: 'SERVICE_UNAVAILABLE' };
    }

    let position;
    try {
        position = await getCurrentPosition({ enableHighAccuracy: true });
    } catch (error) {
        if (error && error.code === error.PERMISSION_DENIED) {
            return { success: false, error: 'PERMISSION_DENIED' };
        }

        return { success: false, error: 'LOCATION_FAILED' };
    }

    if (position && position.error) return { success: false, error: position.error };

    let token = null;
    let tokenUid = null;
    let rollbackToken = null;
    let stashedVisitId = null;
    try {
        const checkinResult = verifyAndProcessCheckin(parkData, position.coords);
        if (!checkinResult.success) return checkinResult;

        const vaultRepo = getVaultRepo();
        if (!vaultRepo) return { success: false, error: 'VISITED_PLACES_UNAVAILABLE' };
        tokenUid = getCurrentFirebaseUid();
        token = vaultRepo.snapshot();

        const visitedEntries = getCheckinVisitedPlaceEntries(parkData);
        const limitBlock = getFreeVisitLimitBlock(visitedEntries);
        if (limitBlock) return limitBlock;

        const existingEntry = visitedEntries.length > 0 ? visitedEntries[0] : null;
        const touchedIds = [parkData.id];
        if (existingEntry && existingEntry.id !== parkData.id) {
            touchedIds.push(existingEntry.id);
            vaultRepo.removeVisit(existingEntry.id);
            if (typeof firebaseService.stageVisitedPlaceDelete === 'function') {
                firebaseService.stageVisitedPlaceDelete(existingEntry.id);
            }
        }

        vaultRepo.addVisit(checkinResult.visitRecord);
        // Persist the visit to localStorage IMMEDIATELY — before any Firebase
        // call — so that a write which never reaches Google's servers (poor
        // cell signal at a state park) can be replayed on the next app launch.
        if (tokenUid && checkinResult.visitRecord) {
            stashUnconfirmedVisit(tokenUid, checkinResult.visitRecord);
            stashedVisitId = checkinResult.visitRecord.id;
        }
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, touchedIds);
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(checkinResult.visitRecord);
        }
        refreshVisitedCache('checkin-verified-add');
        refreshVisitedVisuals('checkin-verified-add', firebaseService);
        requestVisitStateSync('checkin-verified-add');

        // Race the Firebase write against a 15s timeout. With offline persistence
        // enabled, the write is durably queued in IndexedDB even if the timeout
        // wins — the timeout only governs how long the UI waits before telling
        // the user "saved, will sync when online" instead of "saved to cloud".
        let syncStatus = 'cloud';
        try {
            await awaitWithFirebaseWriteTimeout(() => firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray()));
        } catch (writeError) {
            if (isNetworkLikeError(writeError)) {
                // Visit is in the vault, in localStorage, and (with persistence
                // enabled) in Firestore's offline queue. The next authoritative
                // snapshot will clear the localStorage entry. DO NOT roll back —
                // that's exactly the bug that lost Maddy's Edgar Evins visit.
                syncStatus = 'pending';
                console.warn('[checkinService] Verified visit queued for sync (network unavailable):', writeError);
            } else {
                throw writeError;
            }
        }

        queueDailyStreakIncrement(firebaseService);

        return {
            ...checkinResult,
            action: 'verified',
            syncStatus
        };
    } catch (error) {
        // Reaching here means we hit a non-network error (auth, permission,
        // service-internal). Roll back local state AND clear the localStorage
        // stash so we don't replay a write that was rejected for a real reason.
        const vaultRepo = getVaultRepo();
        if (vaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof vaultRepo.restore === 'function') {
            vaultRepo.restore(rollbackToken || token);
        } else if (parkData && typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
            firebaseService.clearVisitedPlacePendingMutation(parkData.id);
        }
        if (tokenUid && stashedVisitId) {
            clearUnconfirmedVisit(tokenUid, stashedVisitId);
        }
        console.error('[checkinService] verifyGpsCheckin failed:', error);
        return { success: false, error: 'CHECKIN_FAILED' };
    }
}

async function markAsVisited(parkData) {
    const firebaseService = getFirebaseService();

    if (!firebaseService) return { success: false, error: 'SERVICE_UNAVAILABLE' };

    let token = null;
    let tokenUid = null;
    let rollbackToken = null;
    let stashedVisitId = null;
    try {
        const vaultRepo = getVaultRepo();
        if (!vaultRepo) return { success: false, error: 'VISITED_PLACES_UNAVAILABLE' };
        tokenUid = getCurrentFirebaseUid();
        token = vaultRepo.snapshot();

        const visitedEntries = getCheckinVisitedPlaceEntries(parkData);

        if (visitedEntries.length > 0) {
            if (visitedEntries.some(entry => entry.record && entry.record.verified)) {
                return { success: false, error: 'ALREADY_VERIFIED' };
            }
            if (!window.allowUncheck) return { success: false, error: 'UNCHECK_LOCKED' };
            if (typeof firebaseService.updateCurrentUserVisitedPlaces !== 'function') {
                return { success: false, error: 'SERVICE_UNAVAILABLE' };
            }

            const entryIds = visitedEntries.map(entry => entry.id);
            vaultRepo.removeVisits(entryIds);
            if (typeof vaultRepo.createRollbackToken === 'function') {
                rollbackToken = vaultRepo.createRollbackToken(token, entryIds);
            }
            if (typeof firebaseService.stageVisitedPlaceDelete === 'function') {
                entryIds.forEach(firebaseService.stageVisitedPlaceDelete);
            }
            refreshVisitedCache('checkin-unmark-remove');
            refreshVisitedVisuals('checkin-unmark-remove', firebaseService);
            requestVisitStateSync('checkin-unmark-remove');
            await firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray());
            return { success: true, action: 'removed' };
        }

        const limitBlock = getFreeVisitLimitBlock(visitedEntries);
        if (limitBlock) return limitBlock;

        const canSyncProgress = typeof firebaseService.syncUserProgress === 'function';
        const canUpdateVisitedPlaces = typeof firebaseService.updateCurrentUserVisitedPlaces === 'function';
        if (!canSyncProgress && !canUpdateVisitedPlaces) {
            return { success: false, error: 'SERVICE_UNAVAILABLE' };
        }

        const visitRecord = createVisitRecord(parkData, false);
        vaultRepo.addVisit(visitRecord);
        if (tokenUid && visitRecord) {
            stashUnconfirmedVisit(tokenUid, visitRecord);
            stashedVisitId = visitRecord.id;
        }
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, [parkData.id]);
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(visitRecord);
        }
        refreshVisitedCache('checkin-mark-add');
        refreshVisitedVisuals('checkin-mark-add', firebaseService);
        requestVisitStateSync('checkin-mark-add');

        let syncStatus = 'cloud';
        try {
            if (canSyncProgress) {
                await awaitWithFirebaseWriteTimeout(() => firebaseService.syncUserProgress());
            } else {
                await awaitWithFirebaseWriteTimeout(() => firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray()));
            }
        } catch (writeError) {
            if (isNetworkLikeError(writeError)) {
                syncStatus = 'pending';
                console.warn('[checkinService] Visit queued for sync (network unavailable):', writeError);
            } else {
                throw writeError;
            }
        }

        queueDailyStreakIncrement(firebaseService);
        return { success: true, action: 'added', visitRecord, syncStatus };
    } catch (error) {
        const vaultRepo = getVaultRepo();
        if (vaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof vaultRepo.restore === 'function') {
            vaultRepo.restore(rollbackToken || token);
        } else if (parkData && typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
            firebaseService.clearVisitedPlacePendingMutation(parkData.id);
        }
        if (tokenUid && stashedVisitId) {
            clearUnconfirmedVisit(tokenUid, stashedVisitId);
        }
        console.error('[checkinService] markAsVisited failed:', error);
        return { success: false, error: 'VISIT_UPDATE_FAILED' };
    }
}

window.BARK.services.checkin = {
    verifyAndProcessCheckin,
    verifyGpsCheckin,
    markAsVisited,
    replayUnconfirmedVisits,
    reconcileUnconfirmedVisits,
    awaitServerConfirmation,
    notifyAuthoritativeSnapshot,
    cancelPendingServerConfirmations,
    forceServerSyncRecovery
};
