const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadCheckinService() {
    const storage = new Map();
    const context = {
        console,
        Date,
        Map,
        Set,
        Promise,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        RegExp,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };

    context.window = context;
    context.global = context;
    context.navigator = { onLine: true, geolocation: null };
    context.localStorage = {
        getItem(key) {
            return storage.has(key) ? storage.get(key) : null;
        },
        setItem(key, value) {
            storage.set(key, String(value));
        },
        removeItem(key) {
            storage.delete(key);
        }
    };
    context.addEventListener = () => {};
    context.alert = () => {};
    context.confirm = () => true;

    vm.createContext(context);
    [
        '01-code/app/repos/VaultRepo.js',
        '01-code/app/services/checkinService.js'
    ].forEach((relativePath) => {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    });

    context.window.BARK.invalidateVisitedIdsCache = () => {};
    context.window.BARK.refreshCoordinator = {
        refreshVisitedCache() {},
        refreshVisitedVisuals() {}
    };
    return context;
}

test('server confirmation retries until a fresh server doc contains the visit', async () => {
    const context = loadCheckinService();
    const visit = { id: 'visit-1', name: 'Retry Park', verified: true, ts: 100 };
    let serverReadCount = 0;

    context.window.BARK.repos.VaultRepo.addVisit(visit);
    context.window.BARK.repos.VaultRepo.stageUpsert(visit);
    context.window._visitedPlacesServerSnapshotReceived = true;
    context.firebase = {
        auth() {
            return { currentUser: { uid: 'user-1' } };
        },
        firestore() {
            return {
                waitForPendingWrites() {
                    return Promise.resolve();
                },
                collection(collectionName) {
                    assert.equal(collectionName, 'users');
                    return {
                        doc(uid) {
                            assert.equal(uid, 'user-1');
                            return {
                                async get(options) {
                                    assert.equal(options && options.source, 'server');
                                    serverReadCount++;
                                    return {
                                        exists: true,
                                        metadata: {
                                            fromCache: false,
                                            hasPendingWrites: false
                                        },
                                        data() {
                                            return {
                                                visitedPlaces: serverReadCount >= 2 ? [visit] : []
                                            };
                                        }
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(visit, { retryMs: 10 });

    assert.equal(result && result.confirmed, true);
    assert.equal(serverReadCount >= 2, true, 'confirmation should wait for a retry with server data');
    assert.equal(
        context.window.BARK.repos.VaultRepo.snapshot().pending.has(visit.id),
        false,
        'server confirmation should clear the local pending mutation'
    );

    const readsAtConfirmation = serverReadCount;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
        serverReadCount,
        readsAtConfirmation,
        'verification checks must stop immediately after exact server confirmation'
    );
});

test('account deletion cleanup removes the entire unconfirmed-visit safety net for that uid', () => {
    const context = loadCheckinService();
    const key = 'bark.unconfirmedVisits.deleted-user';
    context.localStorage.setItem(key, JSON.stringify({
        'visit-1': { visit: { id: 'visit-1' }, stashedAt: 1710000000000 }
    }));

    context.window.BARK.services.checkin.clearUnconfirmedVisits('deleted-user');

    assert.equal(context.localStorage.getItem(key), null);
});

test('fake-service boot restores remembered pending visits as orange without server proof', () => {
    const context = loadCheckinService();
    const uid = 'remembered-user';
    const visit = { id: 'orange-park', name: 'Orange Park', verified: false, ts: 1710000000000 };
    context.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [visit.id]: { visit, stashedAt: 1710000000100 }
    }));

    const restored = context.window.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    const repo = context.window.BARK.repos.VaultRepo;

    assert.equal(restored, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(repo.getVisit(visit.id))), visit);
    assert.equal(repo.hasPendingMutation(visit.id), true);
    assert.equal(context.window.BARK.services.checkin.isVisitAwaitingServerProof(visit.id), true);
});

test('pre-auth orange hydration survives only for the matching restored account', () => {
    const context = loadCheckinService();
    const uid = 'original-user';
    const visit = { id: 'private-orange-park', verified: true, ts: 1710000000200 };
    context.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [visit.id]: { visit, stashedAt: 1710000000300 }
    }));

    const checkin = context.window.BARK.services.checkin;
    const repo = context.window.BARK.repos.VaultRepo;
    checkin.hydrateRememberedUnconfirmedVisits();

    assert.equal(checkin.reconcilePreAuthVisitHydration('different-user'), false);
    assert.equal(repo.hasVisit(visit.id), false);
    assert.equal(repo.hasPendingMutation(visit.id), false);
    assert.notEqual(
        context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`),
        null,
        'the original account recovery record must remain available for its next real sign-in'
    );
});

test('matching auth keeps the hydrated visit pending until normal replay confirms it', () => {
    const context = loadCheckinService();
    const uid = 'same-user';
    const visit = { id: 'same-user-orange', verified: true, ts: 1710000000400 };
    context.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [visit.id]: { visit, stashedAt: 1710000000500 }
    }));

    const checkin = context.window.BARK.services.checkin;
    const repo = context.window.BARK.repos.VaultRepo;
    checkin.hydrateRememberedUnconfirmedVisits();

    assert.equal(checkin.reconcilePreAuthVisitHydration(uid), true);
    assert.equal(repo.hasVisit(visit.id), true);
    assert.equal(repo.hasPendingMutation(visit.id), true);
});

function preparePendingVisit(context, visit) {
    const repo = context.window.BARK.repos.VaultRepo;
    repo.addVisit(visit);
    repo.stageUpsert(visit);
    context.window.BARK.services.firebase = {
        reconcileVisitedPlacesSnapshot(placeList, metadata) {
            return repo.reconcileSnapshot(placeList, metadata);
        },
        stageVisitedPlaceUpsert(nextVisit) {
            repo.stageUpsert(nextVisit);
        }
    };
    return repo;
}

function installServerSnapshot(context, snapshotFactory) {
    context.firebase = {
        auth() {
            return { currentUser: { uid: 'user-1' } };
        },
        firestore() {
            return {
                waitForPendingWrites() {
                    return Promise.resolve();
                },
                collection() {
                    return {
                        doc() {
                            return {
                                async get() {
                                    return snapshotFactory();
                                }
                            };
                        }
                    };
                }
            };
        }
    };
}

function makeSnapshot(visits, metadata = { fromCache: false, hasPendingWrites: false }) {
    return {
        exists: true,
        metadata,
        data() {
            return { visitedPlaces: visits };
        }
    };
}

test('fresh visit cannot confirm until the exact server mutation exists', async () => {
    const context = loadCheckinService();
    const expected = { id: 'fresh-park', verified: true, ts: 200, syncToken: 'fresh-token' };
    const repo = preparePendingVisit(context, expected);
    installServerSnapshot(context, () => makeSnapshot([]));

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 40 });

    assert.deepEqual(JSON.parse(JSON.stringify(result)), { confirmed: false, reason: 'timeout' });
    assert.equal(repo.hasPendingMutation(expected.id), true);
});

test('same park ID with an older unverified server record cannot false-confirm a GPS upgrade', async () => {
    const context = loadCheckinService();
    const expected = { id: 'same-park', verified: true, ts: 300, syncToken: 'gps-upgrade-token' };
    const oldServerVisit = { id: 'same-park', verified: false, ts: 100 };
    const repo = preparePendingVisit(context, expected);
    installServerSnapshot(context, () => makeSnapshot([oldServerVisit]));

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 40 });

    assert.equal(result.confirmed, false);
    assert.equal(repo.hasPendingMutation(expected.id), true);
    assert.deepEqual(JSON.parse(JSON.stringify(repo.getVisit(expected.id))), expected);
});

test('server-sourced snapshots with pending writes cannot turn a visit green', async () => {
    const context = loadCheckinService();
    const expected = { id: 'pending-overlay', verified: true, ts: 400, syncToken: 'pending-token' };
    const repo = preparePendingVisit(context, expected);
    installServerSnapshot(context, () => makeSnapshot([expected], {
        fromCache: false,
        hasPendingWrites: true
    }));

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 40 });

    assert.equal(result.confirmed, false);
    assert.equal(repo.hasPendingMutation(expected.id), true);
});

test('cached snapshots cannot turn a visit green even when the record matches', async () => {
    const context = loadCheckinService();
    const expected = { id: 'cached-overlay', verified: true, ts: 500, syncToken: 'cached-token' };
    const repo = preparePendingVisit(context, expected);
    installServerSnapshot(context, () => makeSnapshot([expected], {
        fromCache: true,
        hasPendingWrites: false
    }));

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 40 });

    assert.equal(result.confirmed, false);
    assert.equal(repo.hasPendingMutation(expected.id), true);
});

test('exact authoritative server mutation confirms and clears pending state', async () => {
    const context = loadCheckinService();
    const expected = { id: 'secured-park', verified: true, ts: 600, syncToken: 'secured-token' };
    const repo = preparePendingVisit(context, expected);
    installServerSnapshot(context, () => makeSnapshot([expected]));

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 250 });

    assert.equal(result.confirmed, true);
    assert.equal(repo.hasPendingMutation(expected.id), false);
});

test('an exact manual visit can confirm without weakening the GPS proof contract', async () => {
    const context = loadCheckinService();
    const expected = { id: 'manual-park', verified: false, ts: 650, syncToken: 'manual-token' };
    const repo = preparePendingVisit(context, expected);
    installServerSnapshot(context, () => makeSnapshot([expected]));

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 250 });

    assert.equal(result.confirmed, true);
    assert.equal(repo.hasPendingMutation(expected.id), false);
});

test('a resolved Firestore transaction confirms the exact visit without waiting for a later listener snapshot', async () => {
    const context = loadCheckinService();
    const uid = 'commit-receipt-user';
    const repo = context.window.BARK.repos.VaultRepo;

    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        }
    };
    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        reconcileVisitedPlacesSnapshot(placeList, metadata) {
            return repo.reconcileSnapshot(placeList, metadata);
        },
        async syncUserProgress() {
            return repo.getVisits();
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: 'commit-park',
        name: 'Commit Park',
        lat: 35,
        lng: -84
    });
    assert.equal(result.success, true);

    // queueVisitedPlacesWrite observes the transaction on a microtask.
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(repo.hasPendingMutation(result.visitRecord.id), false);
    assert.equal(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
    assert.equal(context.window._visitedPlacesServerSnapshotReceived, true);
    assert.deepEqual(
        JSON.parse(JSON.stringify(await context.window.BARK.services.checkin.awaitServerConfirmation(result.visitRecord))),
        { confirmed: true }
    );
});

test('authoritative listener path ignores a stale same-ID record and resolves only on the exact mutation', async () => {
    const context = loadCheckinService();
    const expected = { id: 'listener-park', verified: true, ts: 675, syncToken: 'listener-token' };
    const stale = { id: 'listener-park', verified: false, ts: 100 };
    const repo = preparePendingVisit(context, expected);
    context.window._visitedPlacesServerSnapshotReceived = true;

    const confirmationPromise = context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 300 });
    repo.reconcileSnapshot([stale], { fromCache: false, hasPendingWrites: false });
    context.window.BARK.services.checkin.notifyAuthoritativeSnapshot();
    assert.equal(repo.hasPendingMutation(expected.id), true);

    setTimeout(() => {
        repo.reconcileSnapshot([expected], { fromCache: false, hasPendingWrites: false });
        context.window.BARK.services.checkin.notifyAuthoritativeSnapshot();
    }, 20);

    const result = await confirmationPromise;
    assert.equal(result.confirmed, true);
    assert.equal(repo.hasPendingMutation(expected.id), false);
});

test('ID-only confirmation with no stashed or staged mutation fails closed', async () => {
    const context = loadCheckinService();
    context.window.BARK.repos.VaultRepo.addVisit({ id: 'historical-park', verified: true, ts: 1 });
    context.window._visitedPlacesServerSnapshotReceived = true;

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation('historical-park');

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        confirmed: false,
        reason: 'no-expected-visit'
    });
});

test('reopen recovery restages a stale same-ID visit and keeps it pending until an exact match', async () => {
    const context = loadCheckinService();
    const uid = 'reopen-user';
    const key = `bark.unconfirmedVisits.${uid}`;
    const oldServerVisit = { id: 'reopen-park', verified: false, ts: 100 };
    const expectedLegacyVisit = { id: 'reopen-park', verified: true, ts: 700 };
    const writes = [];
    const repo = context.window.BARK.repos.VaultRepo;

    repo.addVisit(oldServerVisit);
    context.localStorage.setItem(key, JSON.stringify({
        [expectedLegacyVisit.id]: { visit: expectedLegacyVisit, stashedAt: 700 }
    }));
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        async updateCurrentUserVisitedPlaces(visits) {
            writes.push(visits);
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        },
        firestore() {
            return {};
        }
    };

    await context.window.BARK.services.checkin.replayUnconfirmedVisits(uid);

    const replayedVisit = repo.getVisit(expectedLegacyVisit.id);
    assert.equal(replayedVisit.verified, true);
    assert.equal(typeof replayedVisit.syncToken, 'string');
    assert.equal(replayedVisit.syncToken.length > 8, true);
    assert.equal(repo.hasPendingMutation(expectedLegacyVisit.id), true);
    assert.equal(writes.length, 1);
    assert.equal(context.window.BARK.services.checkin.isVisitAwaitingServerProof(expectedLegacyVisit.id), true);

    repo.reconcileSnapshot([oldServerVisit], { fromCache: false, hasPendingWrites: false });
    context.window.BARK.services.checkin.reconcileUnconfirmedVisits(uid);
    assert.equal(repo.hasPendingMutation(expectedLegacyVisit.id), true);
    assert.notEqual(context.localStorage.getItem(key), null);

    repo.reconcileSnapshot([replayedVisit], { fromCache: false, hasPendingWrites: false });
    context.window.BARK.services.checkin.reconcileUnconfirmedVisits(uid);
    assert.equal(repo.hasPendingMutation(expectedLegacyVisit.id), false);
    assert.equal(context.localStorage.getItem(key), null);
});

test('local safety stash keeps visuals pending if an SDK error clears the in-memory mutation', () => {
    const context = loadCheckinService();
    const uid = 'stash-user';
    const visit = { id: 'stash-park', verified: true, ts: 710, syncToken: 'stash-token' };
    const repo = context.window.BARK.repos.VaultRepo;
    repo.addVisit(visit);
    repo.stageUpsert(visit);
    repo.clearPendingMutation(visit.id);
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [visit.id]: { visit, stashedAt: 710 }
    }));
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        }
    };

    assert.equal(context.window.BARK.services.checkin.isVisitAwaitingServerProof(visit.id), true);
});

test('a visit fails closed and rolls back when its durable recovery copy cannot be stored', async () => {
    const context = loadCheckinService();
    const repo = context.window.BARK.repos.VaultRepo;
    let writeCount = 0;

    context.localStorage.setItem = () => {
        throw new Error('storage quota unavailable');
    };
    context.navigator.geolocation = {
        getCurrentPosition(resolve) {
            resolve({ coords: { latitude: 10, longitude: 20, accuracy: 5 } });
        }
    };
    context.window.BARK.config = { CHECKIN_RADIUS_KM: 25 };
    context.window.BARK.utils = {
        geo: { haversine: () => 0 }
    };
    context.window.BARK.services.firebase = {
        async updateCurrentUserVisitedPlaces() {
            writeCount++;
        },
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid: 'storage-failure-user' } };
        }
    };

    const result = await context.window.BARK.services.checkin.verifyGpsCheckin({
        id: 'storage-failure-park',
        name: 'Storage Failure Park',
        lat: 10,
        lng: 20
    });

    assert.equal(result.success, false);
    assert.equal(result.error, 'LOCAL_SAFETY_STORAGE_UNAVAILABLE');
    assert.equal(repo.hasVisit('storage-failure-park'), false, 'a local-only visit must not survive the failed safety copy');
    assert.equal(repo.hasPendingMutation('storage-failure-park'), false);
    assert.equal(writeCount, 0, 'Firebase must not be called after durable recovery storage fails');
});

test('online recovery refuses pending-write metadata and accepts the later authoritative snapshot', async () => {
    const context = loadCheckinService();
    const expected = { id: 'online-recovery', verified: true, ts: 720, syncToken: 'online-token' };
    const repo = preparePendingVisit(context, expected);
    let metadata = { fromCache: false, hasPendingWrites: true };
    context.firebase = {
        auth() {
            return { currentUser: { uid: 'user-1' } };
        },
        firestore() {
            return {
                waitForPendingWrites() {
                    return Promise.resolve();
                },
                collection() {
                    return {
                        doc() {
                            return {
                                async get() {
                                    return makeSnapshot([expected], metadata);
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    await context.window.BARK.services.checkin.forceServerSyncRecovery('test-pending-overlay');
    assert.equal(repo.hasPendingMutation(expected.id), true);
    assert.notEqual(context.window._visitedPlacesServerSnapshotReceived, true);

    metadata = { fromCache: false, hasPendingWrites: false };
    await context.window.BARK.services.checkin.forceServerSyncRecovery('test-authoritative');
    assert.equal(repo.hasPendingMutation(expected.id), false);
    assert.equal(context.window._visitedPlacesServerSnapshotReceived, true);
});

test('panel confirmation fallbacks fail closed instead of manufacturing green success', () => {
    const panelSource = fs.readFileSync(path.join(ROOT, '01-code/app/renderers/panelRenderer.js'), 'utf8');

    assert.equal(panelSource.includes(': { confirmed: true };'), false);
    assert.equal(panelSource.includes("{ confirmed: false, reason: 'confirmation-unavailable' }"), true);
    assert.equal(panelSource.includes('setMarkVisitedStatePending();\n                    return;'), true);
});

test('every green visit surface consults the durable server-proof predicate', () => {
    [
        '01-code/app/renderers/panelRenderer.js',
        '01-code/app/modules/renderEngine.js',
        '01-code/app/modules/MarkerLayerManager.js',
        '01-code/app/modules/TripLayerManager.js',
        '01-code/app/services/authService.js'
    ].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        assert.equal(
            source.includes('isVisitAwaitingServerProof'),
            true,
            `${relativePath} must consult durable pending state before painting green`
        );
    });
});
