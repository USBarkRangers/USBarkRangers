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
const VISIT_SYNC_TOKEN_FIELD = 'syncToken';

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

function stashUnconfirmedVisit(uid, visit) {
    if (!uid || !visit || !visit.id) return false;
    rememberAuthenticatedVisitUid(uid);
    const map = loadUnconfirmedVisitsMap(uid);
    map[visit.id] = { visit, stashedAt: Date.now() };
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

    const entries = Object.values(loadUnconfirmedVisitsMap(uid));
    if (entries.length === 0) return 0;

    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.addVisit !== 'function' || typeof vaultRepo.stageUpsert !== 'function') {
        return 0;
    }

    const hydratedIds = new Set();
    entries.forEach(entry => {
        const visit = entry && entry.visit;
        if (!visit || !visit.id) return;
        vaultRepo.addVisit(visit);
        vaultRepo.stageUpsert(visit);
        hydratedIds.add(visit.id);
    });
    if (hydratedIds.size === 0) return 0;

    preAuthHydratedUid = uid;
    preAuthHydratedVisitIds = hydratedIds;
    // Do not refresh map visuals here. This method runs before cached park data
    // renders and Firebase may not have initialized at all on fake service.
    // loadData() immediately follows and paints the hydrated orange state in
    // the same render pass as the cached pins.
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
        if (typeof vaultRepo.removeVisits === 'function') {
            vaultRepo.removeVisits(Array.from(preAuthHydratedVisitIds));
        }
        if (typeof vaultRepo.clearPendingMutation === 'function') {
            preAuthHydratedVisitIds.forEach(id => vaultRepo.clearPendingMutation(id));
        }
        refreshVisitedCache('checkin-preauth-account-mismatch');
        refreshVisitedVisuals('checkin-preauth-account-mismatch', getFirebaseService());
    }

    preAuthHydratedUid = null;
    preAuthHydratedVisitIds = new Set();
    return matches;
}

function clearUnconfirmedVisit(uid, visitId) {
    if (!uid || !visitId) return;
    const map = loadUnconfirmedVisitsMap(uid);
    if (!map[visitId]) return;
    delete map[visitId];
    saveUnconfirmedVisitsMap(uid, map);
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

function discardPendingVisitAdditions(uid, visitIds) {
    const ids = Array.from(new Set((Array.isArray(visitIds) ? visitIds : [visitIds])
        .map(getVisitId)
        .filter(Boolean)));
    ids.forEach(visitId => {
        clearUnconfirmedVisit(uid, visitId);
        cancelPendingServerConfirmation(visitId, 'visit-deleted');
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
    if (mutated) saveUnconfirmedVisitsMap(uid, map);
}

// Called from authService once the user's session is restored. Re-adds any
// visits that weren't confirmed before the PWA last closed, and re-stages the
// Firebase write so they sync as soon as connectivity allows.
const replayUnconfirmedVisitsInFlight = new Map();

async function replayUnconfirmedVisitsInternal(uid) {
    if (!uid) return;
    const map = loadUnconfirmedVisitsMap(uid);
    const entries = Object.values(map);
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
                replayedVisits.forEach(visit => {
                    confirmVisitFromCommittedWrite(visit, committedVisits, 'reopen-replay');
                });
            }
        } catch (error) {
            // Persistence layer will keep retrying; localStorage stash still protects us.
            console.warn('[checkinService] replay write deferred (offline/flaky network):', error);
        }
    }
}

function replayUnconfirmedVisits(uid) {
    if (!uid) return Promise.resolve();
    const existingReplay = replayUnconfirmedVisitsInFlight.get(uid);
    if (existingReplay) return existingReplay;

    const replayPromise = Promise.resolve()
        .then(() => replayUnconfirmedVisitsInternal(uid))
        .finally(() => replayUnconfirmedVisitsInFlight.delete(uid));
    replayUnconfirmedVisitsInFlight.set(uid, replayPromise);
    return replayPromise;
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

function queueVisitedPlacesWrite(label, expectedVisit, writePromiseFactory, onFatalError) {
    const visitId = getVisitId(expectedVisit);
    const durableWritePromise = Promise.resolve().then(writePromiseFactory);

    // Observe the underlying transaction independently of the 15-second UI
    // timeout. A slow transaction may commit after the UI has moved to orange;
    // its eventual resolution is still authoritative server acknowledgement.
    durableWritePromise.then(committedVisits => {
        confirmVisitFromCommittedWrite(expectedVisit, committedVisits, 'transaction-commit');
    }, () => {});

    awaitWithFirebaseWriteTimeout(() => durableWritePromise)
        .catch(error => {
            if (isNetworkLikeError(error)) {
                console.warn(`[checkinService] ${label} queued for sync (network unavailable):`, error);
                return;
            }

            console.error(`[checkinService] ${label} failed after local staging:`, error);
            if (typeof onFatalError === 'function') {
                try {
                    onFatalError(error);
                } catch (rollbackError) {
                    console.error(`[checkinService] ${label} rollback failed:`, rollbackError);
                }
            }
            cancelPendingServerConfirmation(visitId, 'write-failed');
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

async function probeServerForVisitConfirmation(expectedVisit, reason = 'confirmation-probe') {
    const visitId = getVisitId(expectedVisit);
    if (!visitId || !expectedVisit || typeof expectedVisit !== 'object') return false;
    if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.auth) return false;

    const user = firebase.auth().currentUser;
    if (!user) return false;

    try {
        if (window.BARK && typeof window.BARK.incrementRequestCount === 'function') {
            window.BARK.incrementRequestCount();
        }

        const doc = await firebase.firestore().collection('users').doc(user.uid).get({ source: 'server' });
        // `source: 'server'` still applies Firestore latency compensation. A
        // pending local mutation can therefore appear in doc.data(). Only
        // explicit metadata proving no cache and no pending writes is durable
        // server confirmation.
        if (!isExplicitAuthoritativeSnapshot(doc)) return false;

        const data = doc && doc.exists && typeof doc.data === 'function' ? (doc.data() || {}) : {};
        const serverVisits = Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
        const confirmedVisit = serverVisits.find(place => visitRecordsMatchForConfirmation(place, expectedVisit));
        if (!confirmedVisit) return false;

        const firebaseService = getFirebaseService();
        const vaultRepo = getVaultRepo();
        window._visitedPlacesServerSnapshotReceived = true;
        if (firebaseService && typeof firebaseService.reconcileVisitedPlacesSnapshot === 'function') {
            firebaseService.reconcileVisitedPlacesSnapshot(serverVisits, {
                fromCache: false,
                hasPendingWrites: false
            });
        } else if (vaultRepo && typeof vaultRepo.reconcileSnapshot === 'function') {
            vaultRepo.reconcileSnapshot(serverVisits, {
                fromCache: false,
                hasPendingWrites: false
            });
        }

        // Reconciliation must independently agree that the exact mutation is
        // no longer pending before the local safety copy or UI can turn green.
        if (!isVisitServerConfirmed(vaultRepo, expectedVisit)) return false;

        clearUnconfirmedVisit(user.uid, visitId);
        refreshVisitedCache(`checkin-server-confirmed-${reason}`);
        refreshVisitedVisuals(`checkin-server-confirmed-${reason}`, firebaseService);
        return true;
    } catch (error) {
        // Expected while the phone has weak/no service. The interval will try again.
        console.debug('[checkinService] server confirmation probe deferred:', error);
        return false;
    }
}

function confirmVisitFromCommittedWrite(expectedVisit, committedVisits, reason = 'transaction-commit') {
    const visitId = getVisitId(expectedVisit);
    if (!visitId || !expectedVisit || !Array.isArray(committedVisits)) return false;

    const committedVisit = committedVisits.find(place => visitRecordsMatchForConfirmation(place, expectedVisit));
    if (!committedVisit) return false;

    const firebaseService = getFirebaseService();
    const vaultRepo = getVaultRepo();
    if (!vaultRepo) return false;

    // A Firestore transaction promise resolves only after the backend accepts
    // the commit. Reconcile that exact server-returned array instead of waiting
    // for a later metadata-only listener event that some mobile PWAs delay.
    if (firebaseService && typeof firebaseService.reconcileVisitedPlacesSnapshot === 'function') {
        firebaseService.reconcileVisitedPlacesSnapshot(committedVisits, {
            fromCache: false,
            hasPendingWrites: false
        });
    } else if (typeof vaultRepo.reconcileSnapshot === 'function') {
        vaultRepo.reconcileSnapshot(committedVisits, {
            fromCache: false,
            hasPendingWrites: false
        });
    }

    if (!isVisitServerConfirmed(vaultRepo, expectedVisit)) return false;

    const uid = getCurrentFirebaseUid();
    if (uid) clearUnconfirmedVisit(uid, visitId);
    window._visitedPlacesServerSnapshotReceived = true;
    notifyAuthoritativeSnapshot();
    refreshVisitedCache(`checkin-commit-confirmed-${reason}`);
    refreshVisitedVisuals(`checkin-commit-confirmed-${reason}`, firebaseService);
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
            if (resolved || probeInFlight || !isConfirmationSurfaceVisible()) return false;
            probeInFlight = true;
            try {
                const confirmed = await probeServerForVisitConfirmation(expectedVisit, reason);
                if (confirmed) settle({ confirmed: true });
                return confirmed;
            } finally {
                probeInFlight = false;
            }
        };

        const scheduleNextProbe = () => {
            if (resolved || retryHandle || !isConfirmationSurfaceVisible()) return;
            retryHandle = setTimeout(async () => {
                retryHandle = null;
                await runServerProbe('scheduled-retry');
                scheduleNextProbe();
            }, retryMs);
        };

        const triggerRecovery = (reason = 'recovery-signal') => {
            if (resolved) return;
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
                    const confirmed = await probeServerForVisitConfirmation(expectedVisit, 'pending-writes-flushed');
                    if (confirmed) settle({ confirmed: true });
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
        clearPendingConfirmationTimers(entry);
        pendingServerConfirmations.delete(visitId);
        const uid = getCurrentFirebaseUid();
        if (uid) clearUnconfirmedVisit(uid, visitId);
        entry.resolve({ confirmed: true });
    });
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
            const doc = await firestore.collection('users').doc(user.uid)
                .get({ source: 'server' })
                .catch(error => {
                    console.warn(`[checkinService] server doc fetch (${reason}) failed:`, error);
                    return null;
                });
            if (isExplicitAuthoritativeSnapshot(doc)) {
                const data = doc && doc.exists && typeof doc.data === 'function' ? (doc.data() || {}) : {};
                const serverVisits = Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
                const firebaseService = getFirebaseService();
                if (firebaseService && typeof firebaseService.reconcileVisitedPlacesSnapshot === 'function') {
                    firebaseService.reconcileVisitedPlacesSnapshot(serverVisits, {
                        fromCache: false,
                        hasPendingWrites: false
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
    });
    window.addEventListener('pageshow', () => {
        triggerPendingServerConfirmationRecovery('page-show');
    });
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'hidden') {
                triggerPendingServerConfirmationRecovery('visible');
            }
        });
    }
    const connection = typeof navigator !== 'undefined'
        ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection)
        : null;
    if (connection && typeof connection.addEventListener === 'function') {
        connection.addEventListener('change', () => {
            triggerPendingServerConfirmationRecovery('connection-change');
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
    if (!getCheckinFirebaseUser()) return null;
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
        tokenUid = getCurrentFirebaseUid();
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

        if (typeof firebaseService.cancelPendingVisitDeletion === 'function') {
            touchedIds.forEach(id => firebaseService.cancelPendingVisitDeletion(tokenUid, id));
        }

        vaultRepo.addVisit(checkinResult.visitRecord);
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, touchedIds);
        }
        // Persist the visit to localStorage IMMEDIATELY — before any Firebase
        // call — so that a write which never reaches Google's servers (poor
        // cell signal at a state park) can be replayed on the next app launch.
        if (tokenUid && checkinResult.visitRecord) {
            const safetyCopySaved = stashUnconfirmedVisit(tokenUid, checkinResult.visitRecord);
            if (!safetyCopySaved) {
                if (typeof vaultRepo.restore === 'function') {
                    vaultRepo.restore(rollbackToken || token);
                }
                return { success: false, error: 'LOCAL_SAFETY_STORAGE_UNAVAILABLE' };
            }
            stashedVisitId = checkinResult.visitRecord.id;
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(checkinResult.visitRecord);
        }
        refreshVisitedCache('checkin-verified-add');
        refreshVisitedVisuals('checkin-verified-add', firebaseService);
        requestVisitStateSync('checkin-verified-add');

        queueVisitedPlacesWrite(
            'Verified visit',
            checkinResult.visitRecord,
            () => firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray()),
            () => {
                const currentVaultRepo = getVaultRepo();
                if (currentVaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof currentVaultRepo.restore === 'function') {
                    currentVaultRepo.restore(rollbackToken || token);
                } else if (typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
                    firebaseService.clearVisitedPlacePendingMutation(checkinResult.visitRecord.id);
                }
                if (tokenUid && stashedVisitId) {
                    clearUnconfirmedVisit(tokenUid, stashedVisitId);
                }
            }
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
        tokenUid = getCurrentFirebaseUid();
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
        if (typeof firebaseService.cancelPendingVisitDeletion === 'function') {
            firebaseService.cancelPendingVisitDeletion(tokenUid, visitRecord.id);
        }
        vaultRepo.addVisit(visitRecord);
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, [parkData.id]);
        }
        if (tokenUid && visitRecord) {
            const safetyCopySaved = stashUnconfirmedVisit(tokenUid, visitRecord);
            if (!safetyCopySaved) {
                if (typeof vaultRepo.restore === 'function') {
                    vaultRepo.restore(rollbackToken || token);
                }
                return { success: false, error: 'LOCAL_SAFETY_STORAGE_UNAVAILABLE' };
            }
            stashedVisitId = visitRecord.id;
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(visitRecord);
        }
        refreshVisitedCache('checkin-mark-add');
        refreshVisitedVisuals('checkin-mark-add', firebaseService);
        requestVisitStateSync('checkin-mark-add');

        queueVisitedPlacesWrite(
            'Visit',
            visitRecord,
            () => canSyncProgress
                ? firebaseService.syncUserProgress()
                : firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray()),
            () => {
                const currentVaultRepo = getVaultRepo();
                if (currentVaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof currentVaultRepo.restore === 'function') {
                    currentVaultRepo.restore(rollbackToken || token);
                } else if (typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
                    firebaseService.clearVisitedPlacePendingMutation(visitRecord.id);
                }
                if (tokenUid && stashedVisitId) {
                    clearUnconfirmedVisit(tokenUid, stashedVisitId);
                }
            }
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
    hydrateRememberedUnconfirmedVisits,
    reconcilePreAuthVisitHydration,
    rememberAuthenticatedVisitUid,
    forgetAuthenticatedVisitUid,
    reconcileUnconfirmedVisits,
    clearUnconfirmedVisits,
    discardPendingVisitAdditions,
    isVisitAwaitingServerProof,
    awaitServerConfirmation,
    notifyAuthoritativeSnapshot,
    cancelPendingServerConfirmations,
    forceServerSyncRecovery
};

// Shared visual-state predicate for map pins, trip badges, and account UI.
// Consumers fail closed if this service is unavailable.
window.BARK.isVisitAwaitingServerProof = isVisitAwaitingServerProof;
