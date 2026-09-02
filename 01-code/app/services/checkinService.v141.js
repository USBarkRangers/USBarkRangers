/**
 * checkinService.js - GPS check-in validation and visit record construction.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

const FREE_VISIT_LIMIT = 5;

// Hard upper bound on the initial Firebase write attempt before the UI moves
// from "Locating..." to the indefinite "Verifying..." server-confirmation wait.
// The confirmation wait itself does not time out.
const FIREBASE_WRITE_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_SENTINEL = '__BARK_WRITE_TIMEOUT__';
const SERVER_CONFIRMATION_RETRY_MS = 5000;
const SERVER_READ_ATTEMPT_TIMEOUT_MS = 12000;
const FREE_RECOVERY_SIGNAL_DELAY_MS = 1000;
const VISIT_SYNC_TOKEN_FIELD = 'syncToken';
const AUTHORITATIVE_VISIT_IDS_KEY_PREFIX = 'bark.authoritativeVisitIds.';
const AUTHORITATIVE_VISITS_KEY_PREFIX = 'bark.authoritativeVisits.';
const AUTHORITATIVE_VISITS_SCHEMA_VERSION = 1;
const STALE_CHECKIN_VISIT_COMMIT_RESULT_FLAG = '__barkStaleVisitCommitResult';
let legacyOfflineBaselineUid = null;
let legacyOfflineBaselineVisitIds = new Set();

function createVisitSyncToken() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getVisitId(placeOrId) {
    if (placeOrId && typeof placeOrId === 'object') {
        return placeOrId.id || placeOrId.placeId || null;
    }
    return placeOrId || null;
}

function cloneVisitRecord(visit) {
    return visit && typeof visit === 'object' ? { ...visit } : null;
}

function ensureVisitSyncToken(visit) {
    const nextVisit = cloneVisitRecord(visit);
    if (!nextVisit || !getVisitId(nextVisit)) return nextVisit;
    if (!nextVisit[VISIT_SYNC_TOKEN_FIELD]) {
        nextVisit[VISIT_SYNC_TOKEN_FIELD] = createVisitSyncToken();
    }
    return nextVisit;
}

function stringifyVisitValue(value) {
    if (value && typeof value === 'object') {
        const sorted = {};
        Object.keys(value).sort().forEach(key => { sorted[key] = value[key]; });
        return JSON.stringify(sorted);
    }
    return JSON.stringify(value);
}

// A confirmation must prove the exact mutation, not merely the park ID. The
// sync token distinguishes a new manual/GPS action from an older server record
// for the same park. Comparing every expected field also keeps legacy stashed
// visits (created before sync tokens existed) recoverable without weakening the
// proof for new visits.
function visitRecordsMatchForConfirmation(serverVisit, expectedVisit) {
    if (!serverVisit || !expectedVisit) return false;
    if (getVisitId(serverVisit) !== getVisitId(expectedVisit)) return false;

    const expectedKeys = Object.keys(expectedVisit);
    if (expectedKeys.length === 0) return false;
    for (const key of expectedKeys) {
        if (stringifyVisitValue(serverVisit[key]) !== stringifyVisitValue(expectedVisit[key])) return false;
    }
    return true;
}

function isExplicitAuthoritativeSnapshot(snapshot) {
    const metadata = snapshot && snapshot.metadata;
    return Boolean(
        metadata
        && metadata.fromCache === false
        && metadata.hasPendingWrites === false
    );
}

// localStorage key holding visits that have been added locally but not yet
// confirmed by an authoritative Firestore snapshot. Survives PWA close so that
// writes which never reached the server (Maddy's Edgar Evins case) can be
// replayed on the next launch.
function getUnconfirmedVisitsKey(uid) {
    return uid ? `bark.unconfirmedVisits.${uid}` : null;
}

function getAuthoritativeVisitIdsKey(uid) {
    return uid ? `${AUTHORITATIVE_VISIT_IDS_KEY_PREFIX}${uid}` : null;
}

function getAuthoritativeVisitsKey(uid) {
    return uid ? `${AUTHORITATIVE_VISITS_KEY_PREFIX}${uid}` : null;
}

const authoritativeEvidenceGenerationByUid = new Map();

function getAuthoritativeEvidenceGeneration(uid) {
    return uid ? (authoritativeEvidenceGenerationByUid.get(String(uid)) || 0) : 0;
}

function noteAuthoritativeEvidence(uid) {
    if (!uid) return 0;
    const key = String(uid);
    const next = getAuthoritativeEvidenceGeneration(key) + 1;
    authoritativeEvidenceGenerationByUid.set(key, next);
    return next;
}

function getAuthoritativeBaselineFingerprint(uid) {
    const key = getAuthoritativeVisitsKey(uid);
    if (!key) return null;
    try {
        return localStorage.getItem(key);
    } catch (_error) {
        return null;
    }
}

// The last complete server-confirmed array is the offline display baseline.
// `null` means no trusted baseline has ever been stored; an empty array is a
// real, authoritative "this account has no visits" checkpoint.
function loadAuthoritativeVisits(uid) {
    const key = getAuthoritativeVisitsKey(uid);
    if (!key) return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed
            || parsed.schemaVersion !== AUTHORITATIVE_VISITS_SCHEMA_VERSION
            || parsed.uid !== String(uid)
            || !Array.isArray(parsed.visits)) {
            return null;
        }
        return parsed.visits
            .filter(visit => visit && getVisitId(visit))
            .map(cloneVisitRecord);
    } catch (error) {
        console.warn('[checkinService] unable to read authoritative visits:', error);
        return null;
    }
}

function persistAuthoritativeVisits(uid, visits) {
    const key = getAuthoritativeVisitsKey(uid);
    if (!key || !Array.isArray(visits)) return false;
    try {
        const envelope = {
            schemaVersion: AUTHORITATIVE_VISITS_SCHEMA_VERSION,
            uid: String(uid),
            visits: visits
                .filter(visit => visit && getVisitId(visit))
                .map(cloneVisitRecord)
        };
        const serialized = JSON.stringify(envelope);
        localStorage.setItem(key, serialized);
        // Do not clear an orange journal unless the exact baseline survived a
        // storage round trip. This makes a quota/private-mode failure fail safe.
        return localStorage.getItem(key) === serialized;
    } catch (error) {
        console.warn('[checkinService] unable to persist authoritative visits:', error);
        return false;
    }
}

function loadAuthoritativeVisitIds(uid) {
    const key = getAuthoritativeVisitIdsKey(uid);
    if (!key) return [];
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? Array.from(new Set(parsed.map(String).filter(Boolean)))
            : [];
    } catch (error) {
        console.warn('[checkinService] unable to read authoritative visit IDs:', error);
        return [];
    }
}

function buildLegacyAuthoritativeVisitBaseline(uid) {
    const key = getAuthoritativeVisitIdsKey(uid);
    if (!key) return null;
    let ids;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        ids = Array.from(new Set(parsed.filter(Boolean).map(String)));
    } catch (_error) {
        return null;
    }
    const parkRepo = window.BARK && window.BARK.repos && window.BARK.repos.ParkRepo;

    return ids.map(id => {
        const park = parkRepo && typeof parkRepo.getById === 'function'
            ? parkRepo.getById(id)
            : null;
        return {
            id,
            name: park && park.name ? park.name : 'Saved Park',
            lat: park && park.lat !== undefined ? park.lat : null,
            lng: park && park.lng !== undefined ? park.lng : null,
            verified: false,
            ts: null,
            legacyOfflineBaseline: true
        };
    });
}

// Keep only opaque park IDs from the latest server-confirmed user document.
// A free account can then enforce its five-park ceiling during a cold offline
// restart before Firestore has had a chance to restore the full user snapshot.
function rememberAuthoritativeVisitIds(uid, visits) {
    const key = getAuthoritativeVisitIdsKey(uid);
    if (!key || !Array.isArray(visits)) return false;
    // Count every fresh authoritative observation, including one whose local
    // checkpoint cannot be stored. Older reads may not overtake this evidence.
    noteAuthoritativeEvidence(uid);
    if (legacyOfflineBaselineUid === String(uid)) {
        legacyOfflineBaselineUid = null;
        legacyOfflineBaselineVisitIds = new Set();
    }
    const ids = Array.from(new Set(visits.map(getVisitId).filter(Boolean).map(String)));
    const baselineSaved = persistAuthoritativeVisits(uid, visits);
    if (!baselineSaved) return false;
    try {
        localStorage.setItem(key, JSON.stringify(ids));
        return baselineSaved;
    } catch (error) {
        console.warn('[checkinService] unable to persist authoritative visit IDs:', error);
        // The full baseline is the durable source of truth. The ID-only cache
        // is merely a cold-start free-plan shortcut.
        return baselineSaved;
    }
}

function clearAuthoritativeVisitIds(uid) {
    const key = getAuthoritativeVisitIdsKey(uid);
    const baselineKey = getAuthoritativeVisitsKey(uid);
    if (!key && !baselineKey) return;
    try {
        if (key) localStorage.removeItem(key);
        if (baselineKey) localStorage.removeItem(baselineKey);
        if (legacyOfflineBaselineUid === String(uid)) {
            legacyOfflineBaselineUid = null;
            legacyOfflineBaselineVisitIds = new Set();
        }
    } catch (error) {
        console.warn('[checkinService] unable to clear authoritative visits:', error);
    }
}

const LAST_AUTHENTICATED_VISIT_UID_KEY = 'bark.lastAuthenticatedVisitUid';
let preAuthHydratedUid = null;
let preAuthHydratedVisitIds = new Set();

function getRememberedAuthenticatedVisitUid() {
    try {
        return String(localStorage.getItem(LAST_AUTHENTICATED_VISIT_UID_KEY) || '').trim() || null;
    } catch (_error) {
        return null;
    }
}

function rememberAuthenticatedVisitUid(uid) {
    if (!uid) return false;
    try {
        localStorage.setItem(LAST_AUTHENTICATED_VISIT_UID_KEY, String(uid));
        return true;
    } catch (_error) {
        return false;
    }
}

function forgetAuthenticatedVisitUid() {
    try {
        localStorage.removeItem(LAST_AUTHENTICATED_VISIT_UID_KEY);
    } catch (_error) { /* account isolation remains fail-closed */ }
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
    if (!key) return false;
    try {
        if (!map || Object.keys(map).length === 0) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(map));
        }
        return true;
    } catch (error) {
        console.warn('[checkinService] unable to persist unconfirmed visits cache:', error);
        return false;
    }
}

function stashUnconfirmedVisit(uid, visit, options = {}) {
    if (!uid || !visit || !visit.id) return false;
    rememberAuthenticatedVisitUid(uid);
    const map = loadUnconfirmedVisitsMap(uid);
    map[visit.id] = {
        visit,
        stashedAt: Date.now(),
        offlinePremiumProvisional: options.offlinePremiumProvisional === true
    };
    if (!saveUnconfirmedVisitsMap(uid, map)) return false;

    // Verify the exact recovery record can be read back before the operation is
    // allowed to continue. A full/private browser store must fail closed here;
    // otherwise a later SDK error could clear the in-memory pending marker and
    // make a local-only visit look durably green.
    const persistedVisit = getUnconfirmedVisit(uid, visit.id);
    return visitRecordsMatchForConfirmation(persistedVisit, visit);
}

// When cloud auth is still unresolved at the ten-second boot fallback, restore
// only the last authenticated account's durable safety-net visits. This is a
// visual/local hydration only: it stages the records orange but performs no
// network write and supplies no server proof. Normal auth replay owns syncing.
function hydrateRememberedUnconfirmedVisits() {
    const currentUid = getCurrentFirebaseUid();
    const uid = currentUid || getRememberedAuthenticatedVisitUid();
    if (!uid) return 0;

    const storedBaseline = loadAuthoritativeVisits(uid);
    // v0.140 and earlier remembered only server-proven IDs. Preserve those
    // confirmed parks visually during the first weak-cell boot after upgrade;
    // the next fresh server snapshot replaces these display-only placeholders
    // with complete records. Intent-only transactions never upload this base.
    const baseline = Array.isArray(storedBaseline)
        ? storedBaseline
        : buildLegacyAuthoritativeVisitBaseline(uid);
    if (!Array.isArray(storedBaseline) && Array.isArray(baseline)) {
        legacyOfflineBaselineUid = String(uid);
        legacyOfflineBaselineVisitIds = new Set(baseline.map(getVisitId).filter(Boolean).map(String));
    } else if (legacyOfflineBaselineUid === String(uid)) {
        legacyOfflineBaselineUid = null;
        legacyOfflineBaselineVisitIds = new Set();
    }
    const entries = Object.values(loadUnconfirmedVisitsMap(uid));
    if (!Array.isArray(baseline) && entries.length === 0) return 0;

    const vaultRepo = getVaultRepo();
    if (!vaultRepo
        || typeof vaultRepo.addVisit !== 'function'
        || typeof vaultRepo.stageUpsert !== 'function'
        || typeof vaultRepo.reconcileSnapshot !== 'function') {
        return 0;
    }

    const hydratedIds = new Set();
    if (Array.isArray(baseline)) {
        // A stored baseline is trusted for display, but it is not a fresh server
        // response and therefore cannot confirm/clear today's orange mutations.
        vaultRepo.reconcileSnapshot(baseline, {
            fromCache: false,
            hasPendingWrites: false,
            canConfirmPending: false,
            persistedBaseline: true
        });
        baseline.forEach(visit => {
            const id = getVisitId(visit);
            if (id) hydratedIds.add(String(id));
        });
    }
    entries.forEach(entry => {
        const visit = entry && entry.visit;
        if (!visit || !visit.id) return;
        vaultRepo.addVisit(visit);
        vaultRepo.stageUpsert(visit);
        hydratedIds.add(visit.id);
    });
    if (hydratedIds.size === 0 && !Array.isArray(baseline)) return 0;

    preAuthHydratedUid = uid;
    preAuthHydratedVisitIds = hydratedIds;
    // This can run either before or after cached park data. Refreshing is a
    // harmless no-op before markers exist and is required when offline-first
    // boot has already painted the public pins ahead of cloud authentication.
    refreshVisitedCache('checkin-preauth-hydration');
    refreshVisitedVisuals('checkin-preauth-hydration', getFirebaseService());
    return hydratedIds.size;
}

// Auth must approve the account before preloaded state can survive. A mismatch
// removes only the records introduced by pre-auth hydration, preventing one
// account's orange pins from flashing in another account or a signed-out view.
function reconcilePreAuthVisitHydration(authenticatedUid) {
    if (!preAuthHydratedUid) return false;

    const matches = Boolean(authenticatedUid && authenticatedUid === preAuthHydratedUid);
    const vaultRepo = getVaultRepo();
    if (!matches && vaultRepo) {
        // The pre-auth projection now includes a complete account baseline, not
        // just orange additions. Clear it atomically before another UID paints.
        if (typeof vaultRepo.clear === 'function') vaultRepo.clear();
        refreshVisitedCache('checkin-preauth-account-mismatch');
        refreshVisitedVisuals('checkin-preauth-account-mismatch', getFirebaseService());
    }

    preAuthHydratedUid = null;
    preAuthHydratedVisitIds = new Set();
    if (!matches && legacyOfflineBaselineUid) {
        legacyOfflineBaselineUid = null;
        legacyOfflineBaselineVisitIds = new Set();
    }
    return matches;
}

function isLegacyAuthoritativeVisitPlaceholder(placeOrId) {
    const visitId = getVisitId(placeOrId);
    return Boolean(
        visitId
        && legacyOfflineBaselineUid
        && legacyOfflineBaselineVisitIds.has(String(visitId))
    );
}

function clearUnconfirmedVisit(uid, visitId, expectedVisit = null) {
    if (!uid || !visitId) return false;
    const map = loadUnconfirmedVisitsMap(uid);
    if (!map[visitId]) return true;
    if (expectedVisit
        && !visitRecordsMatchForConfirmation(map[visitId].visit, expectedVisit)) {
        return false;
    }
    delete map[visitId];
    if (!saveUnconfirmedVisitsMap(uid, map)) return false;
    return !getUnconfirmedVisit(uid, visitId);
}

function clearUnconfirmedVisits(uid) {
    const key = getUnconfirmedVisitsKey(uid);
    if (!key) return;
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.warn('[checkinService] unable to clear unconfirmed visits cache:', error);
    }
}

function discardPendingVisitAdditions(uid, visitsOrIds) {
    const entries = Array.isArray(visitsOrIds) ? visitsOrIds : [visitsOrIds];
    entries.forEach(entry => {
        const visitId = getVisitId(entry);
        if (!visitId) return;
        const expectedVisit = entry && typeof entry === 'object' ? entry : null;
        if (expectedVisit
            && !visitRecordsMatchForConfirmation(getUnconfirmedVisit(uid, visitId), expectedVisit)) {
            return;
        }

        const vaultRepo = getVaultRepo();
        const shouldCancel = getCurrentFirebaseUid() === uid
            && (!expectedVisit || isCurrentPendingUpsert(uid, expectedVisit, vaultRepo));
        if (!clearUnconfirmedVisit(uid, visitId, expectedVisit)) return;
        // Confirmations are runtime/global and keyed by park ID. Never let an
        // old account or superseded operation cancel the active account's work.
        if (shouldCancel) {
            cancelPendingServerConfirmation(visitId, 'visit-rejected');
        }
    });
}

function getUnconfirmedVisit(uid, visitId) {
    if (!uid || !visitId) return null;
    const entry = loadUnconfirmedVisitsMap(uid)[visitId];
    return entry && entry.visit ? cloneVisitRecord(entry.visit) : null;
}

function hasUnconfirmedVisit(uid, visitId) {
    return Boolean(getUnconfirmedVisit(uid, visitId));
}

function filterSyncableVisitedPlaces(uid, visits) {
    const placeList = Array.isArray(visits) ? visits : [];
    if (!uid) return placeList.slice();
    const provisionalIds = new Set(
        Object.entries(loadUnconfirmedVisitsMap(uid))
            .filter(([, entry]) => entry && entry.offlinePremiumProvisional === true)
            .map(([visitId]) => visitId)
    );
    if (provisionalIds.size === 0) return placeList.slice();
    return placeList.filter(visit => !provisionalIds.has(getVisitId(visit)));
}

function isVisitAwaitingServerProof(placeOrId) {
    const visitId = getVisitId(placeOrId);
    if (!visitId) return true;

    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.hasPendingMutation !== 'function') return true;
    if (vaultRepo.hasPendingMutation(visitId)) return true;

    const uid = getCurrentFirebaseUid();
    return Boolean(uid && hasUnconfirmedVisit(uid, visitId));
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
        const expectedVisit = map[id] && map[id].visit;
        const currentVisit = typeof vaultRepo.getVisit === 'function' ? vaultRepo.getVisit(id) : null;
        const isServerConfirmed = currentVisit
            && visitRecordsMatchForConfirmation(currentVisit, expectedVisit)
            && typeof vaultRepo.hasPendingMutation === 'function'
            && !vaultRepo.hasPendingMutation(id);
        if (isServerConfirmed) {
            delete map[id];
            mutated = true;
        }
    });
    if (mutated) {
        saveUnconfirmedVisitsMap(uid, map);
        hideOfflineSyncNoticeIfRecovered();
    }
}

// Called from authService once the user's session is restored. Re-adds any
// visits that weren't confirmed before the PWA last closed, and re-stages the
// Firebase write so they sync as soon as connectivity allows.
const replayUnconfirmedVisitsInFlight = new Map();

async function replayUnconfirmedVisitsInternal(uid, options = {}) {
    if (!uid || getCurrentFirebaseUid() !== uid) return;
    const map = loadUnconfirmedVisitsMap(uid);
    const entries = Object.values(map).filter(entry => (
        options.allowOfflinePremiumProvisional === true
        || !entry
        || entry.offlinePremiumProvisional !== true
    ));
    if (entries.length === 0) return;

    const vaultRepo = getVaultRepo();
    const firebaseService = getFirebaseService();
    if (!vaultRepo || !firebaseService) return;

    let replayed = 0;
    let migrated = false;
    const replayedVisits = [];
    entries.forEach(entry => {
        const originalVisit = entry && entry.visit;
        const visit = ensureVisitSyncToken(originalVisit);
        if (!visit || !visit.id) return;

        if (!originalVisit || !originalVisit[VISIT_SYNC_TOKEN_FIELD]) {
            map[visit.id] = { ...entry, visit };
            migrated = true;
        }

        // Always restage a safety-net visit. A same-ID record in the vault can
        // be an older manual/unverified server value and must never suppress a
        // later verified mutation during reopen recovery.
        vaultRepo.addVisit(visit);
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(visit);
        }
        replayedVisits.push(visit);
        replayed++;
    });

    if (migrated) saveUnconfirmedVisitsMap(uid, map);

    if (replayed > 0) {
        console.log(`[checkinService] Replayed ${replayed} unconfirmed visit(s) from local cache.`);
        refreshVisitedCache('checkin-unconfirmed-replay');
        refreshVisitedVisuals('checkin-unconfirmed-replay', firebaseService);
        try {
            if (typeof firebaseService.updateCurrentUserVisitedPlaces === 'function') {
                const committedVisits = await firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray());
                if (getCurrentFirebaseUid() !== uid) return;
                replayedVisits.forEach(visit => {
                    confirmVisitFromCommittedWrite(visit, committedVisits, 'reopen-replay', uid);
                });
            }
        } catch (error) {
            // Persistence layer will keep retrying; localStorage stash still protects us.
            console.warn('[checkinService] replay write deferred (offline/flaky network):', error);
        }
    }
}

function replayUnconfirmedVisits(uid, options = {}) {
    if (!uid) return Promise.resolve();
    const replayKey = `${uid}:${options.allowOfflinePremiumProvisional === true ? 'all' : 'confirmed-session'}`;
    const existingReplay = replayUnconfirmedVisitsInFlight.get(replayKey);
    if (existingReplay) return existingReplay;

    const replayPromise = Promise.resolve()
        .then(() => replayUnconfirmedVisitsInternal(uid, options))
        .finally(() => replayUnconfirmedVisitsInFlight.delete(replayKey));
    replayUnconfirmedVisitsInFlight.set(replayKey, replayPromise);
    return replayPromise;
}

async function confirmOfflinePremiumProvisionalVisits(uid) {
    if (!uid) return 0;
    const map = loadUnconfirmedVisitsMap(uid);
    let promoted = 0;
    Object.values(map).forEach(entry => {
        if (!entry || entry.offlinePremiumProvisional !== true) return;
        entry.offlinePremiumProvisional = false;
        promoted++;
    });
    if (promoted === 0) return 0;

    if (!saveUnconfirmedVisitsMap(uid, map)) return 0;
    await replayUnconfirmedVisits(uid, { allowOfflinePremiumProvisional: true });
    return promoted;
}

function rejectOfflinePremiumProvisionalVisits(uid) {
    if (!uid) return 0;
    const map = loadUnconfirmedVisitsMap(uid);
    const rejectedIds = Object.entries(map)
        .filter(([, entry]) => entry && entry.offlinePremiumProvisional === true)
        .map(([visitId]) => visitId);
    if (rejectedIds.length === 0) return 0;

    rejectedIds.forEach(visitId => { delete map[visitId]; });
    saveUnconfirmedVisitsMap(uid, map);

    const vaultRepo = getVaultRepo();
    if (vaultRepo) {
        if (typeof vaultRepo.removeVisits === 'function') vaultRepo.removeVisits(rejectedIds);
        if (typeof vaultRepo.clearPendingMutation === 'function') {
            rejectedIds.forEach(visitId => vaultRepo.clearPendingMutation(visitId));
        }
    }
    refreshVisitedCache('checkin-offline-premium-rejected');
    refreshVisitedVisuals('checkin-offline-premium-rejected', getFirebaseService());
    requestVisitStateSync('checkin-offline-premium-rejected');
    return rejectedIds.length;
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

function awaitWithTimeout(promise, timeoutMs, timeoutErrorMessage = null) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            if (timeoutErrorMessage) {
                reject(new Error(timeoutErrorMessage));
            } else {
                resolve(undefined);
            }
        }, timeoutMs);

        Promise.resolve(promise)
            .then(value => {
                clearTimeout(timeoutId);
                resolve(value);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

function queueVisitedPlacesWrite(label, expectedVisit, writePromiseFactory, writeUid = null) {
    const durableWritePromise = Promise.resolve().then(writePromiseFactory);

    // Observe the underlying transaction independently of the 15-second UI
    // timeout. A slow transaction may commit after the UI has moved to orange;
    // its eventual resolution is still authoritative server acknowledgement.
    durableWritePromise.then(committedVisits => {
        confirmVisitFromCommittedWrite(expectedVisit, committedVisits, 'transaction-commit', writeUid);
    }, () => {});

    awaitWithFirebaseWriteTimeout(() => durableWritePromise)
        .catch(error => {
            // Once the exact mutation has passed the durable local read-back,
            // every provider/auth/transport failure is preservation-only. The
            // visit remains orange and retryable; only fresh server proof may
            // clear it. This also prevents an older failed attempt from erasing
            // an identical replay queued behind it.
            const currentUid = getCurrentFirebaseUid();
            if (writeUid && currentUid && currentUid !== writeUid) return;
            const suffix = isNetworkLikeError(error) ? 'network unavailable' : 'cloud write deferred';
            console.warn(`[checkinService] ${label} queued for sync (${suffix}):`, error);
            schedulePendingFreeVisitRecovery('write-deferred');
            showOfflineSyncNotice();
        });
}

// Pending confirmations live here while their visit IDs wait to appear in an
// authoritative server snapshot. authService calls notifyAuthoritativeSnapshot()
// whenever such a snapshot arrives so we can resolve any matching promises and
// flip the UI from "verifying..." (yellow) to "verified" (green).
const pendingServerConfirmations = new Map();

// A visit is "server-confirmed" only when an authoritative Firestore snapshot
// has arrived AND the snapshot itself contained the visit (so the reconcile
// dropped the pending mutation). hasVisit() alone is not enough — it returns
// true even for purely-local optimistic adds (e.g. airplane-mode taps).
function resolveExpectedVisit(visitOrId, options = {}) {
    if (visitOrId && typeof visitOrId === 'object') return cloneVisitRecord(visitOrId);
    if (options.expectedVisit && typeof options.expectedVisit === 'object') {
        return cloneVisitRecord(options.expectedVisit);
    }

    const visitId = getVisitId(visitOrId);
    if (!visitId) return null;

    const uid = getCurrentFirebaseUid();
    const stashedVisit = uid ? getUnconfirmedVisit(uid, visitId) : null;
    if (stashedVisit) return stashedVisit;

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.snapshot === 'function') {
        const snapshot = vaultRepo.snapshot();
        const pendingMutation = snapshot && snapshot.pending instanceof Map
            ? snapshot.pending.get(visitId)
            : null;
        if (pendingMutation && pendingMutation.type === 'upsert' && pendingMutation.place) {
            return cloneVisitRecord(pendingMutation.place);
        }
    }

    return null;
}

function isVisitServerConfirmed(vaultRepo, expectedVisit) {
    const visitId = getVisitId(expectedVisit);
    if (!visitId || !expectedVisit || typeof expectedVisit !== 'object') return false;
    if (!vaultRepo || typeof vaultRepo.getVisit !== 'function') return false;
    const currentVisit = vaultRepo.getVisit(visitId);
    if (!visitRecordsMatchForConfirmation(currentVisit, expectedVisit)) return false;
    // If pending introspection isn't available, fall back to a conservative
    // "not confirmed" so we keep waiting instead of lying green.
    if (typeof vaultRepo.hasPendingMutation !== 'function') return false;
    return !vaultRepo.hasPendingMutation(visitId);
}

function isCurrentPendingUpsert(uid, expectedVisit, vaultRepo) {
    const visitId = getVisitId(expectedVisit);
    if (!uid || !visitId || getCurrentFirebaseUid() !== uid) return false;
    if (!visitRecordsMatchForConfirmation(getUnconfirmedVisit(uid, visitId), expectedVisit)) return false;
    if (!vaultRepo
        || typeof vaultRepo.getVisit !== 'function'
        || typeof vaultRepo.snapshot !== 'function') {
        return false;
    }

    const currentVisit = vaultRepo.getVisit(visitId);
    const snapshot = vaultRepo.snapshot();
    const pendingMutation = snapshot && snapshot.pending instanceof Map
        ? snapshot.pending.get(visitId)
        : null;
    return Boolean(
        visitRecordsMatchForConfirmation(currentVisit, expectedVisit)
        && pendingMutation
        && pendingMutation.type === 'upsert'
        && visitRecordsMatchForConfirmation(pendingMutation.place, expectedVisit)
    );
}

function getServerReadAttemptTimeoutMs(options = {}) {
    return Number.isFinite(options.serverReadTimeoutMs) && options.serverReadTimeoutMs > 0
        ? Math.max(10, Number(options.serverReadTimeoutMs))
        : SERVER_READ_ATTEMPT_TIMEOUT_MS;
}

async function probeServerForVisitConfirmation(expectedVisit, reason = 'confirmation-probe', options = {}) {
    const visitId = getVisitId(expectedVisit);
    const deferred = (stalled = false) => Object.freeze({ confirmed: false, stalled });
    if (!visitId || !expectedVisit || typeof expectedVisit !== 'object') return deferred();
    if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.auth) return deferred();

    const user = firebase.auth().currentUser;
    if (!user) return deferred();
    const evidenceGenerationBeforeRead = getAuthoritativeEvidenceGeneration(user.uid);
    const baselineBeforeRead = getAuthoritativeBaselineFingerprint(user.uid);

    try {
        if (window.BARK && typeof window.BARK.incrementRequestCount === 'function') {
            window.BARK.incrementRequestCount();
        }

        const doc = await awaitWithTimeout(
            firebase.firestore().collection('users').doc(user.uid).get({ source: 'server' }),
            getServerReadAttemptTimeoutMs(options),
            'server confirmation read stalled'
        );
        const currentUser = firebase.auth().currentUser;
        if (!currentUser || currentUser.uid !== user.uid) return deferred();
        if (getAuthoritativeEvidenceGeneration(user.uid) !== evidenceGenerationBeforeRead
            || getAuthoritativeBaselineFingerprint(user.uid) !== baselineBeforeRead) {
            return deferred();
        }
        // `source: 'server'` still applies Firestore latency compensation. A
        // pending local mutation can therefore appear in doc.data(). Only
        // explicit metadata proving no cache and no pending writes is durable
        // server confirmation.
        if (!isExplicitAuthoritativeSnapshot(doc)) return deferred();

        const data = doc && doc.exists && typeof doc.data === 'function' ? (doc.data() || {}) : {};
        const serverVisits = Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
        const confirmedVisit = serverVisits.find(place => visitRecordsMatchForConfirmation(place, expectedVisit));
        const firebaseService = getFirebaseService();
        const vaultRepo = getVaultRepo();
        const checkpointSaved = rememberAuthoritativeVisitIds(user.uid, serverVisits);
        if (firebaseService && typeof firebaseService.reconcileVisitedPlacesSnapshot === 'function') {
            firebaseService.reconcileVisitedPlacesSnapshot(serverVisits, {
                fromCache: false,
                hasPendingWrites: false,
                canConfirmPending: checkpointSaved
            });
        } else if (vaultRepo && typeof vaultRepo.reconcileSnapshot === 'function') {
            vaultRepo.reconcileSnapshot(serverVisits, {
                fromCache: false,
                hasPendingWrites: false,
                canConfirmPending: checkpointSaved
            });
        }

        if (checkpointSaved) {
            reconcileUnconfirmedVisits(user.uid);
            window._visitedPlacesServerSnapshotReceived = true;
            notifyAuthoritativeSnapshot();
        }

        if (!confirmedVisit) {
            schedulePendingFreeVisitRecovery('authoritative-miss', {
                delayMs: 0,
                oncePerJournal: true
            });
            return deferred();
        }

        // The complete read was freshness-guarded above. It may acknowledge
        // this target only while that exact durable operation is still current.
        if (!checkpointSaved || !isCurrentPendingUpsert(user.uid, expectedVisit, vaultRepo)) {
            // Reconciliation may already have cleared the matching pending
            // mutation. In that case the exact journal was also retired by
            // reconcileUnconfirmedVisits and the proof is complete.
            if (checkpointSaved && isVisitServerConfirmed(vaultRepo, expectedVisit)
                && !hasUnconfirmedVisit(user.uid, visitId)) {
                refreshVisitedCache(`checkin-server-confirmed-${reason}`);
                refreshVisitedVisuals(`checkin-server-confirmed-${reason}`, firebaseService);
                return Object.freeze({ confirmed: true, stalled: false });
            }
            return deferred();
        }
        if (!clearUnconfirmedVisit(user.uid, visitId, expectedVisit)) return deferred();
        if (!vaultRepo || typeof vaultRepo.confirmPendingUpsert !== 'function') return deferred();
        vaultRepo.confirmPendingUpsert(expectedVisit);

        // Reconciliation must independently agree that the exact mutation is
        // no longer pending before the local safety copy or UI can turn green.
        if (!isVisitServerConfirmed(vaultRepo, expectedVisit)) return deferred();

        window._visitedPlacesServerSnapshotReceived = true;
        refreshVisitedCache(`checkin-server-confirmed-${reason}`);
        refreshVisitedVisuals(`checkin-server-confirmed-${reason}`, firebaseService);
        return Object.freeze({ confirmed: true, stalled: false });
    } catch (error) {
        // Expected while the phone has weak/no service. The interval will try again.
        console.debug('[checkinService] server confirmation probe deferred:', error);
        showOfflineSyncNotice();
        return deferred(/read stalled/i.test(String(error && error.message || '')));
    }
}

function confirmVisitFromCommittedWrite(expectedVisit, committedVisits, reason = 'transaction-commit', expectedUid = null) {
    const visitId = getVisitId(expectedVisit);
    if (!visitId || !expectedVisit || !Array.isArray(committedVisits)) return false;
    // The write coordinator may resolve an older transaction after a newer
    // authoritative listener snapshot has already advanced this account. Such
    // a result is useful only as completion of that caller's network request;
    // it must never retire the durable orange journal or replace the newer
    // baseline through this direct transaction-confirmation path.
    if (committedVisits[STALE_CHECKIN_VISIT_COMMIT_RESULT_FLAG] === true) return false;

    const committedVisit = committedVisits.find(place => visitRecordsMatchForConfirmation(place, expectedVisit));
    if (!committedVisit) return false;

    const firebaseService = getFirebaseService();
    const vaultRepo = getVaultRepo();
    if (!vaultRepo) return false;
    const uid = expectedUid || getCurrentFirebaseUid();
    if (!uid || getCurrentFirebaseUid() !== uid) return false;

    // The backend result must become the durable offline baseline before its
    // orange safety journal can be retired.
    const checkpointSaved = rememberAuthoritativeVisitIds(uid, committedVisits);

    // A Firestore transaction promise resolves only after the backend accepts
    // the commit. Reconcile that exact server-returned array instead of waiting
    // for a later metadata-only listener event that some mobile PWAs delay.
    if (firebaseService && typeof firebaseService.reconcileVisitedPlacesSnapshot === 'function') {
        firebaseService.reconcileVisitedPlacesSnapshot(committedVisits, {
            fromCache: false,
            hasPendingWrites: false,
            canConfirmPending: checkpointSaved
        });
    } else if (typeof vaultRepo.reconcileSnapshot === 'function') {
        vaultRepo.reconcileSnapshot(committedVisits, {
            fromCache: false,
            hasPendingWrites: false,
            canConfirmPending: checkpointSaved
        });
    }

    if (!checkpointSaved || !isVisitServerConfirmed(vaultRepo, expectedVisit)) return false;

    if (!clearUnconfirmedVisit(uid, visitId, expectedVisit)) return false;
    window._visitedPlacesServerSnapshotReceived = true;
    notifyAuthoritativeSnapshot();
    refreshVisitedCache(`checkin-commit-confirmed-${reason}`);
    refreshVisitedVisuals(`checkin-commit-confirmed-${reason}`, firebaseService);
    hideOfflineSyncNoticeIfRecovered();
    return true;
}

function clearPendingConfirmationTimers(entry) {
    if (!entry) return;
    if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle);
    if (entry.retryHandle) clearTimeout(entry.retryHandle);
}

function getServerConfirmationRetryMs(options = {}) {
    return Number.isFinite(options.retryMs) && options.retryMs > 0
        ? Math.max(10, Number(options.retryMs))
        : SERVER_CONFIRMATION_RETRY_MS;
}

function isConfirmationSurfaceVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

let scheduledFreeRecoveryHandle = null;
let scheduledFreeRecoveryReason = null;
let lastAuthoritativeMissRecoveryFingerprint = null;

function getPendingFreeRecoveryFingerprint() {
    const uid = getCurrentFirebaseUid();
    if (!uid) return null;

    const pendingVisits = Object.values(loadUnconfirmedVisitsMap(uid))
        .filter(entry => (
            entry
            && entry.visit
            && getVisitId(entry.visit)
            && entry.offlinePremiumProvisional !== true
        ))
        .map(entry => `${getVisitId(entry.visit)}:${entry.visit[VISIT_SYNC_TOKEN_FIELD] || ''}`)
        .sort();
    const mutationService = window.BARK && window.BARK.visitMutationCoordinator;
    const pendingDeletes = mutationService && typeof mutationService.getPendingDeleteIds === 'function'
        ? mutationService.getPendingDeleteIds(uid).map(id => `delete:${id}`).sort()
        : [];
    const pendingOperations = [...pendingVisits, ...pendingDeletes];
    return pendingOperations.length > 0 ? `${uid}|${pendingOperations.join('|')}` : null;
}

function showOfflineSyncNotice() {
    if (!getPendingFreeRecoveryFingerprint() || !window.BARK) return;
    const showNotice = window.BARK.showOfflineRecoveryNotice || window.BARK.showAuthFailure;
    if (typeof showNotice !== 'function') return;
    showNotice('Pending park changes stay saved on this device. Reload here to restart sync.');
}

function hideOfflineSyncNoticeIfRecovered() {
    if (getPendingFreeRecoveryFingerprint()) return;
    if (!window.BARK || typeof window.BARK.hideOfflineRecoveryNotice !== 'function') return;
    window.BARK.hideOfflineRecoveryNotice({ resetDismissal: true });
}

// Fake cellular service often leaves navigator.onLine=true, so a later switch
// to working Wi-Fi may never emit "online". Reuse the existing full recovery
// for any authenticated account with durable orange visits. An authoritative probe
// that can reach Firestore but still cannot find the mutation schedules one
// recovery for that exact journal; ordinary focus/connection signals can wake
// it again without creating a new polling loop.
function schedulePendingFreeVisitRecovery(reason, options = {}) {
    const fingerprint = getPendingFreeRecoveryFingerprint();
    if (!fingerprint) return false;

    const oncePerJournal = options.oncePerJournal === true;
    if (oncePerJournal && lastAuthoritativeMissRecoveryFingerprint === fingerprint) return false;
    if (oncePerJournal) lastAuthoritativeMissRecoveryFingerprint = fingerprint;

    scheduledFreeRecoveryReason = reason || 'recovery-signal';
    if (scheduledFreeRecoveryHandle !== null) return true;

    const delayMs = Number.isFinite(options.delayMs)
        ? Math.max(0, Number(options.delayMs))
        : FREE_RECOVERY_SIGNAL_DELAY_MS;
    scheduledFreeRecoveryHandle = setTimeout(() => {
        scheduledFreeRecoveryHandle = null;
        const queuedReason = scheduledFreeRecoveryReason;
        scheduledFreeRecoveryReason = null;
        if (!getPendingFreeRecoveryFingerprint()) return;
        forceServerSyncRecovery(`pending-${queuedReason}`);
    }, delayMs);
    return true;
}

function triggerPendingServerConfirmationRecovery(reason = 'recovery-signal') {
    pendingServerConfirmations.forEach(entry => {
        if (entry && typeof entry.triggerRecovery === 'function') entry.triggerRecovery(reason);
    });
}

function awaitServerConfirmation(visitOrId, options = {}) {
    return new Promise(resolve => {
        const expectedVisit = resolveExpectedVisit(visitOrId, options);
        const visitId = getVisitId(expectedVisit || visitOrId);
        if (!visitId) {
            resolve({ confirmed: false, reason: 'no-visit-id' });
            return;
        }
        if (!expectedVisit) {
            resolve({ confirmed: false, reason: 'no-expected-visit' });
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
        if (window._visitedPlacesServerSnapshotReceived && isVisitServerConfirmed(vaultRepo, expectedVisit)) {
            resolve({ confirmed: true });
            return;
        }

        const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : null;
        const retryMs = getServerConfirmationRetryMs(options);

        let resolved = false;
        let timeoutHandle = null;
        let retryHandle = null;
        let probeInFlight = false;
        let probeBlockedUntilSignal = false;
        const settle = (result) => {
            if (resolved) return;
            resolved = true;
            clearPendingConfirmationTimers({ timeoutHandle, retryHandle });
            pendingServerConfirmations.delete(visitId);
            resolve(result);
        };

        if (timeoutMs) {
            timeoutHandle = setTimeout(() => {
                settle({ confirmed: false, reason: 'timeout' });
            }, timeoutMs);
        }

        const runServerProbe = async (reason = 'retry') => {
            if (resolved || probeInFlight || probeBlockedUntilSignal || !isConfirmationSurfaceVisible()) return false;
            probeInFlight = true;
            try {
                const result = await probeServerForVisitConfirmation(expectedVisit, reason, options);
                if (result && result.stalled) probeBlockedUntilSignal = true;
                if (result && result.confirmed) settle({ confirmed: true });
                return Boolean(result && result.confirmed);
            } finally {
                probeInFlight = false;
            }
        };

        const scheduleNextProbe = () => {
            if (resolved || retryHandle || probeBlockedUntilSignal || !isConfirmationSurfaceVisible()) return;
            retryHandle = setTimeout(async () => {
                retryHandle = null;
                await runServerProbe('scheduled-retry');
                scheduleNextProbe();
            }, retryMs);
        };

        const triggerRecovery = (reason = 'recovery-signal') => {
            if (resolved) return;
            // A read that never settled inside Firebase is abandoned until a
            // real lifecycle/connectivity signal. This avoids accumulating an
            // endless stack of uncancellable reads while the visit remains
            // safely orange.
            probeBlockedUntilSignal = false;
            if (retryHandle) {
                clearTimeout(retryHandle);
                retryHandle = null;
            }
            Promise.resolve(runServerProbe(reason)).finally(scheduleNextProbe);
        };

        // Path 1: snapshot listener fires (notifyAuthoritativeSnapshot → matching pending cleared)
        scheduleNextProbe();
        const existingEntry = pendingServerConfirmations.get(visitId);
        if (existingEntry && typeof existingEntry.resolve === 'function') {
            existingEntry.resolve({ confirmed: false, reason: 'superseded' });
        }
        pendingServerConfirmations.set(visitId, {
            resolve: settle,
            timeoutHandle,
            retryHandle,
            triggerRecovery,
            expectedVisit: Object.freeze(cloneVisitRecord(expectedVisit))
        });

        // Path 2: wait for pending writes, then require a fresh server doc read
        // that contains this visit. This avoids a false green if waitForPendingWrites
        // resolves before a slow/offline write has actually entered the queue.
        if (typeof firebase !== 'undefined' && firebase.firestore
            && typeof firebase.firestore().waitForPendingWrites === 'function') {
            firebase.firestore().waitForPendingWrites()
                .then(async () => {
                    if (resolved) return;
                    await runServerProbe('pending-writes-flushed');
                    scheduleNextProbe();
                })
                .catch(error => {
                    // Don't fail the whole confirmation; the snapshot path or
                    // retry probe will keep waiting for real server proof.
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
        if (!entry || !isVisitServerConfirmed(vaultRepo, entry.expectedVisit)) return;
        const uid = getCurrentFirebaseUid();
        if (uid && !clearUnconfirmedVisit(uid, visitId, entry.expectedVisit)) return;
        clearPendingConfirmationTimers(entry);
        pendingServerConfirmations.delete(visitId);
        entry.resolve({ confirmed: true });
    });
    hideOfflineSyncNoticeIfRecovered();
}

function cancelPendingServerConfirmation(visitId, reason) {
    if (!visitId || pendingServerConfirmations.size === 0) return;
    const entry = pendingServerConfirmations.get(visitId);
    if (!entry) return;
    clearPendingConfirmationTimers(entry);
    pendingServerConfirmations.delete(visitId);
    entry.resolve({ confirmed: false, reason: reason || 'cancelled' });
}

function cancelPendingServerConfirmations(reason) {
    if (pendingServerConfirmations.size === 0) return;
    pendingServerConfirmations.forEach(entry => {
        clearPendingConfirmationTimers(entry);
        entry.resolve({ confirmed: false, reason: reason || 'cancelled' });
    });
    pendingServerConfirmations.clear();
}

// Force a full server-sync recovery cycle. Called when the browser detects
// it just came back online (window 'online' event) to bypass any WKWebView
// quirk that suppresses Firestore's metadata-change snapshot. Orange pending
// state only clears through authoritative server data, never merely because
// waitForPendingWrites() resolved.
let forceSyncRecoveryInFlight = false;
async function forceServerSyncRecovery(reason) {
    if (forceSyncRecoveryInFlight) return;
    forceSyncRecoveryInFlight = true;
    try {
        if (typeof firebase === 'undefined' || !firebase.firestore) return;

        const firestore = firebase.firestore();
        const user = firebase.auth ? firebase.auth().currentUser : null;

        // Restage the local safety net first. This covers a cold reopen where
        // the original in-memory Firestore write queue no longer exists.
        if (user) {
            const firebaseService = getFirebaseService();
            if (firebaseService && typeof firebaseService.replayPendingVisitDeletions === 'function') {
                await awaitWithTimeout(firebaseService.replayPendingVisitDeletions(user.uid), FIREBASE_WRITE_TIMEOUT_MS);
            }
            await awaitWithTimeout(replayUnconfirmedVisits(user.uid), FIREBASE_WRITE_TIMEOUT_MS);
        }

        if (typeof firestore.waitForPendingWrites === 'function') {
            await awaitWithTimeout(
                firestore.waitForPendingWrites(),
                20000,
                'waitForPendingWrites timeout'
            ).catch(error => console.warn(`[checkinService] waitForPendingWrites (${reason}) failed:`, error));
        }

        let authoritativeSnapshotApplied = false;
        if (user) {
            const vaultRepo = getVaultRepo();
            const revisionBeforeRead = vaultRepo && typeof vaultRepo.getRevision === 'function'
                ? vaultRepo.getRevision()
                : null;
            const evidenceGenerationBeforeRead = getAuthoritativeEvidenceGeneration(user.uid);
            const baselineBeforeRead = getAuthoritativeBaselineFingerprint(user.uid);
            const doc = await awaitWithTimeout(
                firestore.collection('users').doc(user.uid).get({ source: 'server' }),
                SERVER_READ_ATTEMPT_TIMEOUT_MS,
                `server doc fetch (${reason}) stalled`
            ).catch(error => {
                    console.warn(`[checkinService] server doc fetch (${reason}) failed:`, error);
                    return null;
                });
            const currentUser = firebase.auth ? firebase.auth().currentUser : null;
            const revisionUnchanged = revisionBeforeRead === null
                || !vaultRepo
                || typeof vaultRepo.getRevision !== 'function'
                || vaultRepo.getRevision() === revisionBeforeRead;
            const evidenceUnchanged = getAuthoritativeEvidenceGeneration(user.uid) === evidenceGenerationBeforeRead
                && getAuthoritativeBaselineFingerprint(user.uid) === baselineBeforeRead;
            if (currentUser
                && currentUser.uid === user.uid
                && revisionUnchanged
                && evidenceUnchanged
                && isExplicitAuthoritativeSnapshot(doc)) {
                const data = doc && doc.exists && typeof doc.data === 'function' ? (doc.data() || {}) : {};
                const serverVisits = Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
                const firebaseService = getFirebaseService();
                const checkpointSaved = rememberAuthoritativeVisitIds(user.uid, serverVisits);
                if (checkpointSaved && firebaseService && typeof firebaseService.reconcileVisitedPlacesSnapshot === 'function') {
                    firebaseService.reconcileVisitedPlacesSnapshot(serverVisits, {
                        fromCache: false,
                        hasPendingWrites: false,
                        canConfirmPending: true
                    });
                    reconcileUnconfirmedVisits(user.uid);
                    window._visitedPlacesServerSnapshotReceived = true;
                    authoritativeSnapshotApplied = true;
                }
            }
        }

        // Wake any in-flight awaitServerConfirmation promises that match
        // visits the server now has, then refresh all visuals so orange
        // pins/buttons flip green.
        if (authoritativeSnapshotApplied) notifyAuthoritativeSnapshot();
        refreshVisitedCache(`force-sync-recovery-${reason}`);
        refreshVisitedVisuals(`force-sync-recovery-${reason}`, getFirebaseService());
        hideOfflineSyncNoticeIfRecovered();
    } catch (error) {
        console.warn(`[checkinService] forceServerSyncRecovery (${reason}) failed:`, error);
    } finally {
        forceSyncRecoveryInFlight = false;
    }
}

if (typeof window !== 'undefined' && !window._barkOnlineRecoveryBound) {
    window._barkOnlineRecoveryBound = true;
    window.addEventListener('online', () => {
        triggerPendingServerConfirmationRecovery('browser-online');
        // Small delay so Firestore's own network detector wakes up first.
        setTimeout(() => forceServerSyncRecovery('browser-online'), 1500);
    });

    window.addEventListener('focus', () => {
        triggerPendingServerConfirmationRecovery('window-focus');
        schedulePendingFreeVisitRecovery('window-focus');
    });
    window.addEventListener('pageshow', () => {
        triggerPendingServerConfirmationRecovery('page-show');
        schedulePendingFreeVisitRecovery('page-show');
    });
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'hidden') {
                triggerPendingServerConfirmationRecovery('visible');
                schedulePendingFreeVisitRecovery('visible');
            }
        });
    }
    const connection = typeof navigator !== 'undefined'
        ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection)
        : null;
    if (connection && typeof connection.addEventListener === 'function') {
        connection.addEventListener('change', () => {
            triggerPendingServerConfirmationRecovery('connection-change');
            schedulePendingFreeVisitRecovery('connection-change');
        });
    }
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

function getCheckinFirebaseUser() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;
    try {
        if (Array.isArray(firebase.apps) && firebase.apps.length === 0) return null;
        return firebase.auth().currentUser;
    } catch (_error) {
        // Fake cellular service can leave the SDK script present before a
        // default app exists. Treat that as unresolved auth, not a boot error.
        return null;
    }
}

function canRestoreVaultSnapshot(token, expectedUid) {
    const user = getCheckinFirebaseUser();
    return Boolean(user && token && (!expectedUid || user.uid === expectedUid));
}

function getCurrentFirebaseUid() {
    const user = getCheckinFirebaseUser();
    return user ? user.uid : null;
}

function getActiveOfflinePremiumVisitSession() {
    const premiumService = getPremiumService();
    if (!premiumService || typeof premiumService.getActiveOfflineSession !== 'function') return null;
    const session = premiumService.getActiveOfflineSession();
    if (!session || !session.uid || !isCurrentUserPremium()) return null;
    return session;
}

function getVisitAccountContext() {
    const offlineSession = getActiveOfflinePremiumVisitSession();
    if (offlineSession) {
        return {
            uid: offlineSession.uid,
            offlinePremiumProvisional: true
        };
    }

    const uid = getCurrentFirebaseUid();
    return uid ? { uid, offlinePremiumProvisional: false } : null;
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

function getFreeVisitSlotUsage(uid) {
    const ids = new Set(loadAuthoritativeVisitIds(uid));
    getCheckinVisitedPlacesArray().forEach(place => {
        const id = getVisitId(place);
        if (id) ids.add(String(id));
    });

    // An offline deletion reserves a real removal. Excluding it lets a free
    // user replace that park without temporarily appearing to exceed five.
    const mutationService = window.BARK && window.BARK.visitMutationCoordinator;
    if (mutationService && typeof mutationService.getPendingDeleteIds === 'function') {
        mutationService.getPendingDeleteIds(uid).forEach(id => ids.delete(String(id)));
    }

    return ids.size;
}

function getFreeVisitLimitBlock(visitedEntries) {
    if (!getCheckinFirebaseUser()) return null;
    if (isCurrentUserPremium()) return null;
    if (Array.isArray(visitedEntries) && visitedEntries.length > 0) return null;

    const currentUser = getCheckinFirebaseUser();
    const currentCount = currentUser && currentUser.uid
        ? getFreeVisitSlotUsage(currentUser.uid)
        : getCurrentVisitCount();
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
        ts: Date.now(),
        [VISIT_SYNC_TOKEN_FIELD]: createVisitSyncToken()
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
        const accountContext = getVisitAccountContext();
        tokenUid = accountContext && accountContext.uid;
        if (!tokenUid) return { success: false, error: 'AUTH_REQUIRED' };
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
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, touchedIds);
        }
        // Persist the visit to localStorage IMMEDIATELY — before any Firebase
        // call — so that a write which never reaches Google's servers (poor
        // cell signal at a state park) can be replayed on the next app launch.
        if (tokenUid && checkinResult.visitRecord) {
            const safetyCopySaved = stashUnconfirmedVisit(tokenUid, checkinResult.visitRecord, accountContext);
            if (!safetyCopySaved) {
                if (typeof vaultRepo.restore === 'function') {
                    vaultRepo.restore(rollbackToken || token);
                }
                return { success: false, error: 'LOCAL_SAFETY_STORAGE_UNAVAILABLE' };
            }
            stashedVisitId = checkinResult.visitRecord.id;
        }
        if (typeof firebaseService.cancelPendingVisitDeletion === 'function') {
            const deletionCancellationSaved = typeof firebaseService.cancelPendingVisitDeletions === 'function'
                ? firebaseService.cancelPendingVisitDeletions(tokenUid, touchedIds) !== false
                : touchedIds.every(id => firebaseService.cancelPendingVisitDeletion(tokenUid, id) !== false);
            if (!deletionCancellationSaved) {
                clearUnconfirmedVisit(tokenUid, stashedVisitId);
                if (typeof vaultRepo.restore === 'function') vaultRepo.restore(rollbackToken || token);
                return { success: false, error: 'LOCAL_SAFETY_STORAGE_UNAVAILABLE' };
            }
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(checkinResult.visitRecord);
        }
        refreshVisitedCache('checkin-verified-add');
        refreshVisitedVisuals('checkin-verified-add', firebaseService);
        requestVisitStateSync('checkin-verified-add');

        if (accountContext.offlinePremiumProvisional) {
            return {
                ...checkinResult,
                action: 'verified',
                syncStatus: 'pending',
                offlinePremiumProvisional: true
            };
        }

        queueVisitedPlacesWrite(
            'Verified visit',
            checkinResult.visitRecord,
            () => firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray()),
            tokenUid
        );

        queueDailyStreakIncrement(firebaseService);

        return {
            ...checkinResult,
            action: 'verified',
            syncStatus: 'pending'
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
        const accountContext = getVisitAccountContext();
        tokenUid = accountContext && accountContext.uid;
        if (!tokenUid) return { success: false, error: 'AUTH_REQUIRED' };
        token = vaultRepo.snapshot();

        const visitedEntries = getCheckinVisitedPlaceEntries(parkData);

        if (visitedEntries.length > 0) {
            if (visitedEntries.some(entry => entry.record && entry.record.verified)) {
                return { success: false, error: 'ALREADY_VERIFIED' };
            }
            if (!window.allowUncheck) return { success: false, error: 'UNCHECK_LOCKED' };
            if (typeof firebaseService.removeVisitedEntries !== 'function') {
                return { success: false, error: 'SERVICE_UNAVAILABLE' };
            }
            const removal = firebaseService.removeVisitedEntries(visitedEntries);
            requestVisitStateSync('checkin-unmark-remove');
            return removal;
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
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, [parkData.id]);
        }
        if (tokenUid && visitRecord) {
            const safetyCopySaved = stashUnconfirmedVisit(tokenUid, visitRecord, accountContext);
            if (!safetyCopySaved) {
                if (typeof vaultRepo.restore === 'function') {
                    vaultRepo.restore(rollbackToken || token);
                }
                return { success: false, error: 'LOCAL_SAFETY_STORAGE_UNAVAILABLE' };
            }
            stashedVisitId = visitRecord.id;
        }
        if (typeof firebaseService.cancelPendingVisitDeletion === 'function'
            && firebaseService.cancelPendingVisitDeletion(tokenUid, visitRecord.id) === false) {
            clearUnconfirmedVisit(tokenUid, stashedVisitId);
            if (typeof vaultRepo.restore === 'function') vaultRepo.restore(rollbackToken || token);
            return { success: false, error: 'LOCAL_SAFETY_STORAGE_UNAVAILABLE' };
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(visitRecord);
        }
        refreshVisitedCache('checkin-mark-add');
        refreshVisitedVisuals('checkin-mark-add', firebaseService);
        requestVisitStateSync('checkin-mark-add');

        if (accountContext.offlinePremiumProvisional) {
            return {
                success: true,
                action: 'added',
                visitRecord,
                syncStatus: 'pending',
                offlinePremiumProvisional: true
            };
        }

        queueVisitedPlacesWrite(
            'Visit',
            visitRecord,
            () => canSyncProgress
                ? firebaseService.syncUserProgress()
                : firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray()),
            tokenUid
        );

        queueDailyStreakIncrement(firebaseService);
        return { success: true, action: 'added', visitRecord, syncStatus: 'pending' };
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
    confirmOfflinePremiumProvisionalVisits,
    rejectOfflinePremiumProvisionalVisits,
    filterSyncableVisitedPlaces,
    hydrateRememberedUnconfirmedVisits,
    reconcilePreAuthVisitHydration,
    getRememberedAuthenticatedVisitUid,
    getActiveOfflinePremiumVisitSession,
    rememberAuthenticatedVisitUid,
    rememberAuthoritativeVisitIds,
    getAuthoritativeEvidenceGeneration,
    getAuthoritativeBaselineFingerprint,
    clearAuthoritativeVisitIds,
    forgetAuthenticatedVisitUid,
    reconcileUnconfirmedVisits,
    clearUnconfirmedVisits,
    discardPendingVisitAdditions,
    isLegacyAuthoritativeVisitPlaceholder,
    isVisitAwaitingServerProof,
    awaitServerConfirmation,
    notifyAuthoritativeSnapshot,
    cancelPendingServerConfirmations,
    forceServerSyncRecovery
};

// Shared visual-state predicate for map pins, trip badges, and account UI.
// Consumers fail closed if this service is unavailable.
window.BARK.isVisitAwaitingServerProof = isVisitAwaitingServerProof;
