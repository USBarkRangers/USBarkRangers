const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadCheckinService(storage = new Map()) {
    const eventHandlers = new Map();
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
    context.addEventListener = (name, handler) => {
        const handlers = eventHandlers.get(name) || [];
        handlers.push(handler);
        eventHandlers.set(name, handlers);
    };
    context.alert = () => {};
    context.confirm = () => true;

    vm.createContext(context);
    [
        '01-code/app/repos/VaultRepo.v141.js',
        '01-code/app/services/checkinService.v141.js'
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
    context.dispatch = name => {
        (eventHandlers.get(name) || []).forEach(handler => handler());
    };
    return context;
}

test('server confirmation retries until a fresh server doc contains the visit', async () => {
    const context = loadCheckinService();
    const visit = { id: 'visit-1', name: 'Retry Park', verified: true, ts: 100 };
    let serverReadCount = 0;

    context.window.BARK.repos.VaultRepo.addVisit(visit);
    context.window.BARK.repos.VaultRepo.stageUpsert(visit);
    context.localStorage.setItem('bark.unconfirmedVisits.user-1', JSON.stringify({
        [visit.id]: { visit, stashedAt: Date.now(), offlinePremiumProvisional: false }
    }));
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

test('an upgraded weak-cell boot keeps legacy server-confirmed park IDs visible', () => {
    const context = loadCheckinService();
    const uid = 'legacy-id-upgrade-user';
    context.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    context.localStorage.setItem(
        `bark.authoritativeVisitIds.${uid}`,
        JSON.stringify(['legacy-confirmed-one', 'legacy-confirmed-two'])
    );

    const restored = context.window.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    const repo = context.window.BARK.repos.VaultRepo;

    assert.equal(restored, 2);
    assert.equal(repo.hasVisit('legacy-confirmed-one'), true);
    assert.equal(repo.hasVisit('legacy-confirmed-two'), true);
    assert.equal(repo.hasPendingMutation('legacy-confirmed-one'), false);
    assert.equal(
        context.localStorage.getItem(`bark.authoritativeVisits.${uid}`),
        null,
        'display-only migration must not fabricate a full authoritative checkpoint'
    );

    repo.reconcileSnapshot([], { fromCache: true, hasPendingWrites: false });
    assert.equal(repo.hasVisit('legacy-confirmed-one'), true);
    assert.equal(repo.hasVisit('legacy-confirmed-two'), true);
});

test('an explicit legacy empty checkpoint blocks stale cache resurrection', () => {
    const context = loadCheckinService();
    const uid = 'legacy-empty-upgrade-user';
    context.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    context.localStorage.setItem(`bark.authoritativeVisitIds.${uid}`, '[]');

    const restored = context.window.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    const repo = context.window.BARK.repos.VaultRepo;

    assert.equal(restored, 0);
    repo.reconcileSnapshot([
        { id: 'stale-deleted-park', name: 'Stale Deleted Park', ts: 1 }
    ], { fromCache: true, hasPendingWrites: false });
    assert.equal(
        repo.hasVisit('stale-deleted-park'),
        false,
        'the last server-confirmed empty list must remain the display floor while offline'
    );
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

test('offline Premium visit is durable and orange but performs no cloud write before revalidation', async () => {
    const context = loadCheckinService();
    const uid = 'offline-paid-user';
    let cloudWrites = 0;
    context.window.BARK.services.premium = {
        isPremium() { return true; },
        getActiveOfflineSession() { return { uid, displayName: 'Offline Ranger' }; }
    };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            context.window.BARK.repos.VaultRepo.stageUpsert(visit);
        },
        cancelPendingVisitDeletion() {},
        syncUserProgress() {
            cloudWrites++;
            return Promise.resolve();
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: 'offline-premium-park',
        name: 'Offline Premium Park',
        lat: 35,
        lng: -84
    });

    assert.equal(result.success, true);
    assert.equal(result.offlinePremiumProvisional, true);
    assert.equal(result.syncStatus, 'pending');
    assert.equal(cloudWrites, 0, 'cached Premium proof must never authorize a server mutation');
    assert.equal(context.window.BARK.repos.VaultRepo.hasPendingMutation('offline-premium-park'), true);
    const journal = JSON.parse(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`));
    assert.equal(journal['offline-premium-park'].offlinePremiumProvisional, true);
});

test('same UID plus authoritative Premium promotes and replays provisional visits', async () => {
    const context = loadCheckinService();
    const uid = 'offline-paid-user';
    const visit = { id: 'promoted-park', name: 'Promoted Park', verified: false, ts: 10, syncToken: 'token-1' };
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [visit.id]: { visit, stashedAt: 11, offlinePremiumProvisional: true }
    }));
    context.window.BARK.repos.VaultRepo.addVisit(visit);
    context.window.BARK.repos.VaultRepo.stageUpsert(visit);
    let cloudWrites = 0;
    context.firebase = {
        auth() { return { currentUser: { uid } }; }
    };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(nextVisit) {
            context.window.BARK.repos.VaultRepo.stageUpsert(nextVisit);
        },
        async updateCurrentUserVisitedPlaces(visits) {
            cloudWrites++;
            return visits;
        }
    };

    const promoted = await context.window.BARK.services.checkin.confirmOfflinePremiumProvisionalVisits(uid);

    assert.equal(promoted, 1);
    assert.equal(cloudWrites, 1);
    assert.equal(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
});

test('other visit syncs cannot smuggle a provisional offline Premium visit to Firestore', () => {
    const context = loadCheckinService();
    const uid = 'offline-paid-user';
    const safeVisit = { id: 'already-authorized', verified: false, ts: 1 };
    const provisionalVisit = { id: 'awaiting-premium-proof', verified: false, ts: 2 };
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [provisionalVisit.id]: {
            visit: provisionalVisit,
            stashedAt: 3,
            offlinePremiumProvisional: true
        }
    }));

    const filtered = context.window.BARK.services.checkin.filterSyncableVisitedPlaces(uid, [
        safeVisit,
        provisionalVisit
    ]);

    assert.deepEqual(JSON.parse(JSON.stringify(filtered)), [safeVisit]);
});

function preparePendingVisit(context, visit, uid = 'user-1') {
    const repo = context.window.BARK.repos.VaultRepo;
    repo.addVisit(visit);
    repo.stageUpsert(visit);
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [visit.id]: { visit, stashedAt: Date.now(), offlinePremiumProvisional: false }
    }));
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

test('free orange visit replays when Firestore returns after fake service without an online event', async () => {
    const context = loadCheckinService();
    const uid = 'free-fake-service-user';
    const expected = {
        id: 'free-recovery-park',
        name: 'Free Recovery Park',
        verified: false,
        ts: 250,
        syncToken: 'free-recovery-token'
    };
    const repo = preparePendingVisit(context, expected, uid);
    let serverVisits = [];
    let recoveryWrites = 0;

    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 250, offlinePremiumProvisional: false }
    }));
    context.window.BARK.services.premium = { isPremium: () => false };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        reconcileVisitedPlacesSnapshot(placeList, metadata) {
            return repo.reconcileSnapshot(placeList, metadata);
        },
        replayPendingVisitDeletions() {
            return Promise.resolve([]);
        },
        async updateCurrentUserVisitedPlaces(visits) {
            recoveryWrites++;
            serverVisits = visits.map(visit => ({ ...visit }));
            return serverVisits;
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
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
                                    return makeSnapshot(serverVisits);
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        timeoutMs: 500
    });

    assert.equal(result.confirmed, true);
    assert.equal(recoveryWrites, 1, 'one existing recovery write should restage the missing free visit');
    assert.equal(repo.hasPendingMutation(expected.id), false);
    assert.equal(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
});

test('ordinary Premium orange visits use the same weak-cell recovery path', async () => {
    const context = loadCheckinService();
    const uid = 'premium-control-user';
    const expected = {
        id: 'premium-control-park',
        verified: false,
        ts: 275,
        syncToken: 'premium-control-token'
    };
    const repo = preparePendingVisit(context, expected, uid);
    let recoveryWrites = 0;

    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 275, offlinePremiumProvisional: false }
    }));
    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        reconcileVisitedPlacesSnapshot(placeList, metadata) {
            return repo.reconcileSnapshot(placeList, metadata);
        },
        async updateCurrentUserVisitedPlaces() {
            recoveryWrites++;
            return [expected];
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        },
        firestore() {
            return {
                waitForPendingWrites() {
                    return Promise.resolve();
                },
                collection() {
                    return {
                        doc() {
                            return { async get() { return makeSnapshot([]); } };
                        }
                    };
                }
            };
        }
    };

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        timeoutMs: 60
    });

    assert.equal(result.confirmed, true);
    assert.equal(recoveryWrites, 1, 'ordinary Premium must recover without requiring an online event');
    assert.equal(repo.hasPendingMutation(expected.id), false);
});

test('a persisted server baseline survives weak-cell reload and stale cached snapshots', () => {
    const storage = new Map();
    const uid = 'baseline-reload-user';
    const confirmed = { id: 'confirmed-before-reload', name: 'Confirmed', ts: 100 };
    const pending = {
        id: 'orange-before-reload',
        name: 'Orange',
        ts: 101,
        syncToken: 'orange-before-reload-token'
    };

    const first = loadCheckinService(storage);
    assert.equal(first.window.BARK.services.checkin.rememberAuthoritativeVisitIds(uid, [confirmed]), true);
    first.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    first.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [pending.id]: { visit: pending, stashedAt: 101, offlinePremiumProvisional: false }
    }));

    const reopened = loadCheckinService(storage);
    const checkin = reopened.window.BARK.services.checkin;
    const repo = reopened.window.BARK.repos.VaultRepo;
    assert.equal(checkin.hydrateRememberedUnconfirmedVisits(), 2);
    assert.deepEqual(JSON.parse(JSON.stringify(repo.getVisit(confirmed.id))), confirmed);
    assert.equal(repo.hasPendingMutation(confirmed.id), false);
    assert.deepEqual(JSON.parse(JSON.stringify(repo.getVisit(pending.id))), pending);
    assert.equal(repo.hasPendingMutation(pending.id), true);

    repo.reconcileSnapshot([], { fromCache: true, hasPendingWrites: false });
    assert.equal(repo.hasVisit(confirmed.id), true, 'stale cache must not erase confirmed history');
    assert.equal(repo.hasVisit(pending.id), true, 'stale cache must not erase the orange overlay');
    assert.equal(repo.hasPendingMutation(pending.id), true);
});

test('a fresh exact proof replaces the complete stale baseline before turning green', async () => {
    const context = loadCheckinService();
    const uid = 'full-proof-replacement-user';
    const kept = { id: 'full-proof-kept', name: 'Kept', ts: 100 };
    const removed = { id: 'full-proof-removed', name: 'Removed', ts: 101 };
    const addedElsewhere = { id: 'full-proof-added', name: 'Added Elsewhere', ts: 102 };
    const expected = {
        id: 'full-proof-target',
        name: 'Target',
        ts: 103,
        syncToken: 'full-proof-target-token'
    };
    const checkin = context.window.BARK.services.checkin;
    const repo = context.window.BARK.repos.VaultRepo;
    assert.equal(checkin.rememberAuthoritativeVisitIds(uid, [kept, removed]), true);
    repo.reconcileSnapshot([kept, removed], { persistedBaseline: true });
    preparePendingVisit(context, expected, uid);
    context.firebase = {
        auth() { return { currentUser: { uid } }; },
        firestore() {
            return {
                collection() {
                    return { doc() { return { async get() {
                        return makeSnapshot([kept, addedElsewhere, expected]);
                    } }; } };
                }
            };
        }
    };

    const result = await checkin.awaitServerConfirmation(expected, { retryMs: 10, timeoutMs: 250 });
    assert.equal(result.confirmed, true);
    assert.deepEqual(
        repo.getVisits().map(visit => visit.id).sort(),
        [kept.id, addedElsewhere.id, expected.id].sort()
    );
    const baseline = JSON.parse(context.localStorage.getItem(`bark.authoritativeVisits.${uid}`));
    assert.deepEqual(
        baseline.visits.map(visit => visit.id).sort(),
        [kept.id, addedElsewhere.id, expected.id].sort()
    );
});

test('an authoritative miss still refreshes the full baseline while the target stays orange', async () => {
    const context = loadCheckinService();
    const uid = 'full-miss-replacement-user';
    const kept = { id: 'full-miss-kept', name: 'Kept', ts: 104 };
    const removed = { id: 'full-miss-removed', name: 'Removed', ts: 105 };
    const addedElsewhere = { id: 'full-miss-added', name: 'Added Elsewhere', ts: 106 };
    const expected = {
        id: 'full-miss-target',
        name: 'Target',
        ts: 107,
        syncToken: 'full-miss-target-token'
    };
    const checkin = context.window.BARK.services.checkin;
    const repo = context.window.BARK.repos.VaultRepo;
    assert.equal(checkin.rememberAuthoritativeVisitIds(uid, [kept, removed]), true);
    repo.reconcileSnapshot([kept, removed], { persistedBaseline: true });
    preparePendingVisit(context, expected, uid);
    context.firebase = {
        auth() { return { currentUser: { uid } }; },
        firestore() {
            return {
                collection() {
                    return { doc() { return { async get() {
                        return makeSnapshot([kept, addedElsewhere]);
                    } }; } };
                }
            };
        }
    };

    const result = await checkin.awaitServerConfirmation(expected, { retryMs: 10, timeoutMs: 60 });
    assert.equal(result.confirmed, false);
    assert.equal(repo.hasPendingMutation(expected.id), true);
    assert.deepEqual(
        repo.getVisits().map(visit => visit.id).sort(),
        [kept.id, addedElsewhere.id, expected.id].sort()
    );
    const baseline = JSON.parse(context.localStorage.getItem(`bark.authoritativeVisits.${uid}`));
    assert.deepEqual(
        baseline.visits.map(visit => visit.id).sort(),
        [kept.id, addedElsewhere.id].sort()
    );
});

test('a delayed visit proof cannot overtake newer authoritative state', async () => {
    const context = loadCheckinService();
    const uid = 'delayed-proof-user';
    const expected = {
        id: 'delayed-proof-target',
        name: 'Delayed Target',
        ts: 110,
        syncToken: 'delayed-proof-token'
    };
    const newer = { id: 'newer-unrelated-visit', name: 'Newer Visit', ts: 111 };
    const repo = preparePendingVisit(context, expected, uid);
    let releaseRead;
    let markReadStarted;
    const readStarted = new Promise(resolve => { markReadStarted = resolve; });
    context.firebase = {
        auth() { return { currentUser: { uid } }; },
        firestore() {
            return {
                collection() {
                    return {
                        doc() {
                            return {
                                get() {
                                    markReadStarted();
                                    return new Promise(resolve => { releaseRead = resolve; });
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const confirmation = context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        timeoutMs: 500,
        serverReadTimeoutMs: 200
    });
    await readStarted;

    repo.addVisit(newer);
    assert.equal(
        context.window.BARK.services.checkin.rememberAuthoritativeVisitIds(uid, [newer]),
        true
    );
    releaseRead(makeSnapshot([expected]));

    assert.equal((await confirmation).confirmed, false);
    assert.equal(repo.hasPendingMutation(expected.id), true, 'stale proof must leave the target orange');
    assert.equal(repo.hasVisit(newer.id), true, 'old target proof must not replace the whole Vault');
    const baseline = JSON.parse(context.localStorage.getItem(`bark.authoritativeVisits.${uid}`));
    assert.deepEqual(
        baseline.visits.map(visit => visit.id).sort(),
        [newer.id],
        'target proof must not change a newer durable baseline'
    );
});

test('a delayed add proof cannot resurrect a newer confirmed deletion on reload', async () => {
    const storage = new Map();
    const context = loadCheckinService(storage);
    const uid = 'delayed-proof-delete-user';
    const expected = {
        id: 'delayed-proof-deleted-target',
        name: 'Deleted Target',
        ts: 111,
        syncToken: 'delayed-proof-deleted-token'
    };
    const repo = preparePendingVisit(context, expected, uid);
    let releaseRead;
    let markReadStarted;
    const readStarted = new Promise(resolve => { markReadStarted = resolve; });
    context.firebase = {
        auth() { return { currentUser: { uid } }; },
        firestore() {
            return {
                collection() {
                    return {
                        doc() {
                            return {
                                get() {
                                    markReadStarted();
                                    return new Promise(resolve => { releaseRead = resolve; });
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const confirmation = context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        timeoutMs: 80,
        serverReadTimeoutMs: 200
    });
    await readStarted;

    context.window.BARK.services.checkin.discardPendingVisitAdditions(uid, [expected]);
    repo.removeVisit(expected.id);
    repo.stageDelete(expected.id);
    assert.equal(
        context.window.BARK.services.checkin.rememberAuthoritativeVisitIds(uid, []),
        true
    );
    repo.reconcileSnapshot([], {
        fromCache: false,
        hasPendingWrites: false,
        canConfirmPending: true
    });
    releaseRead(makeSnapshot([expected]));

    assert.equal((await confirmation).confirmed, false);
    assert.equal(repo.hasVisit(expected.id), false);
    assert.equal(repo.hasPendingMutation(expected.id), false);
    const baseline = JSON.parse(context.localStorage.getItem(`bark.authoritativeVisits.${uid}`));
    assert.deepEqual(baseline.visits, [], 'the stale add proof must not rewrite the confirmed empty baseline');

    context.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    const reopened = loadCheckinService(storage);
    reopened.window.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    assert.equal(reopened.window.BARK.repos.VaultRepo.hasVisit(expected.id), false);
});

test('server proof stays orange when the authoritative baseline cannot be stored', async () => {
    const context = loadCheckinService();
    const uid = 'baseline-storage-failure-user';
    const expected = {
        id: 'baseline-storage-failure-park',
        name: 'Baseline Failure',
        ts: 112,
        syncToken: 'baseline-storage-failure-token'
    };
    const repo = preparePendingVisit(context, expected, uid);
    const originalSetItem = context.localStorage.setItem;
    context.localStorage.setItem = (key, value) => {
        if (String(key).startsWith('bark.authoritativeVisits.')) {
            throw new Error('simulated authoritative baseline quota failure');
        }
        return originalSetItem.call(context.localStorage, key, value);
    };
    context.firebase = {
        auth() { return { currentUser: { uid } }; },
        firestore() {
            return {
                collection() {
                    return { doc() { return { async get() { return makeSnapshot([expected]); } }; } };
                }
            };
        }
    };

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        timeoutMs: 50,
        serverReadTimeoutMs: 20
    });
    assert.equal(result.confirmed, false);
    assert.equal(repo.hasPendingMutation(expected.id), true, 'failed checkpoint must remain orange');
});

test('a stalled server read waits for a real recovery signal and then confirms', async () => {
    const context = loadCheckinService();
    const uid = 'stalled-read-user';
    const expected = {
        id: 'stalled-read-park',
        name: 'Stalled Read',
        ts: 113,
        syncToken: 'stalled-read-token'
    };
    const repo = preparePendingVisit(context, expected, uid);
    let reads = 0;
    context.firebase = {
        auth() { return { currentUser: { uid } }; },
        firestore() {
            return {
                collection() {
                    return {
                        doc() {
                            return {
                                get() {
                                    reads++;
                                    return reads === 1
                                        ? new Promise(() => {})
                                        : Promise.resolve(makeSnapshot([expected]));
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const confirmation = context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        timeoutMs: 250,
        serverReadTimeoutMs: 20
    });
    await new Promise(resolve => setTimeout(resolve, 55));
    assert.equal(reads, 1, 'an uncancellable stalled read must not multiply in a polling loop');
    assert.equal(repo.hasPendingMutation(expected.id), true);

    context.dispatch('focus');
    assert.equal((await confirmation).confirmed, true);
    assert.equal(reads, 2);
    assert.equal(repo.hasPendingMutation(expected.id), false);
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

test('the first exact proof checkpoints the complete server visit list', async () => {
    const storage = new Map();
    const context = loadCheckinService(storage);
    const uid = 'first-full-checkpoint-user';
    const existingOne = { id: 'existing-one', verified: true, ts: 590 };
    const existingTwo = { id: 'existing-two', verified: false, ts: 591 };
    const expected = {
        id: 'first-full-checkpoint-target',
        verified: true,
        ts: 592,
        syncToken: 'first-full-checkpoint-token'
    };
    const repo = preparePendingVisit(context, expected, uid);
    context.firebase = {
        auth() { return { currentUser: { uid } }; },
        firestore() {
            return {
                collection() {
                    return { doc() { return { async get() {
                        return makeSnapshot([existingOne, existingTwo, expected]);
                    } }; } };
                }
            };
        }
    };

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        timeoutMs: 250,
        retryMs: 10
    });
    assert.equal(result.confirmed, true);
    assert.equal(repo.hasPendingMutation(expected.id), false);

    const baseline = JSON.parse(context.localStorage.getItem(`bark.authoritativeVisits.${uid}`));
    assert.deepEqual(
        baseline.visits.map(visit => visit.id).sort(),
        [existingOne.id, existingTwo.id, expected.id].sort()
    );

    context.localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
    const reopened = loadCheckinService(storage);
    reopened.window.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    assert.deepEqual(
        reopened.window.BARK.repos.VaultRepo.getVisits().map(visit => visit.id).sort(),
        [existingOne.id, existingTwo.id, expected.id].sort()
    );
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
    const storage = new Map();
    const context = loadCheckinService(storage);
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
    assert.notEqual(context.localStorage.getItem(`bark.authoritativeVisits.${uid}`), null);
    assert.deepEqual(
        JSON.parse(JSON.stringify(await context.window.BARK.services.checkin.awaitServerConfirmation(result.visitRecord))),
        { confirmed: true }
    );

    const reopened = loadCheckinService(storage);
    reopened.window.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    const reopenedRepo = reopened.window.BARK.repos.VaultRepo;
    assert.equal(reopenedRepo.hasVisit(result.visitRecord.id), true);
    assert.equal(reopenedRepo.hasPendingMutation(result.visitRecord.id), false);
    reopenedRepo.reconcileSnapshot([], { fromCache: true, hasPendingWrites: false });
    assert.equal(
        reopenedRepo.hasVisit(result.visitRecord.id),
        true,
        'a cached empty response after reload cannot erase a committed green visit'
    );
});

test('a provider rejection cannot erase a durably accepted orange addition', async () => {
    const context = loadCheckinService();
    const uid = 'preserved-add-user';
    const repo = context.window.BARK.repos.VaultRepo;
    context.window.BARK.services.premium = { isPremium: () => true };
    context.firebase = { auth() { return { currentUser: { uid } }; } };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) { repo.stageUpsert(visit); },
        cancelPendingVisitDeletion() {},
        syncUserProgress() {
            return Promise.reject(Object.assign(new Error('proof not ready'), { code: 'permission-denied' }));
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: 'preserved-add-park',
        name: 'Preserved Add',
        lat: 35,
        lng: -84
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(result.success, true);
    assert.equal(repo.hasVisit(result.visitRecord.id), true);
    assert.equal(repo.hasPendingMutation(result.visitRecord.id), true);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
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
        '01-code/app/services/authService.v141.js'
    ].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        assert.equal(
            source.includes('isVisitAwaitingServerProof'),
            true,
            `${relativePath} must consult durable pending state before painting green`
        );
    });
});
