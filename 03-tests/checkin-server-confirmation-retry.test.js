const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadCheckinService(options = {}) {
    const storage = new Map();
    const windowListeners = new Map();
    const documentListeners = new Map();
    const connectionListeners = new Map();
    const schedule = options.fastRecoverySignals === true
        ? (callback, delay, ...args) => setTimeout(callback, delay === 1000 ? 5 : delay, ...args)
        : setTimeout;
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
        setTimeout: schedule,
        clearTimeout,
        setInterval,
        clearInterval
    };

    context.window = context;
    context.global = context;
    context.navigator = {
        onLine: true,
        geolocation: null,
        connection: {
            addEventListener(type, listener) {
                connectionListeners.set(type, listener);
            }
        }
    };
    context.document = {
        visibilityState: 'visible',
        addEventListener(type, listener) {
            documentListeners.set(type, listener);
        }
    };
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
    context.addEventListener = (type, listener) => {
        windowListeners.set(type, listener);
    };
    context.__dispatchWindowEvent = (type) => {
        const listener = windowListeners.get(type);
        if (listener) listener({ type });
    };
    context.__dispatchDocumentEvent = (type) => {
        const listener = documentListeners.get(type);
        if (listener) listener({ type });
    };
    context.__dispatchConnectionEvent = (type) => {
        const listener = connectionListeners.get(type);
        if (listener) listener({ type });
    };
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
    const repo = preparePendingVisit(context, expected);
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

test('ordinary Premium orange visit replays after an authoritative server miss', async () => {
    const context = loadCheckinService();
    const uid = 'premium-control-user';
    const expected = {
        id: 'premium-control-park',
        verified: false,
        ts: 275,
        syncToken: 'premium-control-token'
    };
    const repo = preparePendingVisit(context, expected);
    let recoveryWrites = 0;
    let serverVisits = [];

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
                            return { async get() { return makeSnapshot(serverVisits); } };
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
    assert.equal(recoveryWrites, 1, 'ordinary Premium visits should use the same durable recovery as Free visits');
    assert.equal(repo.hasPendingMutation(expected.id), false);
    assert.equal(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
});

test('Premium foreground and connection signals coalesce into one durable recovery cycle', async () => {
    const context = loadCheckinService({ fastRecoverySignals: true });
    const uid = 'premium-lifecycle-user';
    const expected = {
        id: 'premium-lifecycle-park',
        verified: false,
        ts: 280,
        syncToken: 'premium-lifecycle-token'
    };
    const repo = preparePendingVisit(context, expected);
    let recoveryWrites = 0;
    let serverVisits = [];

    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 280, offlinePremiumProvisional: false }
    }));
    context.window.BARK.services.premium = { isPremium: () => true };
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
                            return { get: async () => makeSnapshot(serverVisits) };
                        }
                    };
                }
            };
        }
    };

    context.__dispatchWindowEvent('focus');
    context.__dispatchWindowEvent('pageshow');
    context.__dispatchDocumentEvent('visibilitychange');
    context.__dispatchConnectionEvent('change');

    await new Promise(resolve => setTimeout(resolve, 40));

    assert.equal(recoveryWrites, 1, 'a signal burst should coalesce into one recovery replay');
    assert.equal(repo.hasPendingMutation(expected.id), false);
    assert.equal(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
});

test('foreground recovery never uploads an offline-provisional Premium visit', async () => {
    const context = loadCheckinService({ fastRecoverySignals: true });
    const uid = 'provisional-lifecycle-user';
    const expected = {
        id: 'provisional-lifecycle-park',
        verified: false,
        ts: 282,
        syncToken: 'provisional-lifecycle-token'
    };
    const repo = preparePendingVisit(context, expected);
    let recoveryWrites = 0;

    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 282, offlinePremiumProvisional: true }
    }));
    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        async updateCurrentUserVisitedPlaces() {
            recoveryWrites++;
            return [];
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        },
        firestore() {
            throw new Error('provisional recovery must not touch Firestore');
        }
    };

    context.__dispatchWindowEvent('focus');
    context.__dispatchWindowEvent('pageshow');
    context.__dispatchDocumentEvent('visibilitychange');
    context.__dispatchConnectionEvent('change');

    await new Promise(resolve => setTimeout(resolve, 30));

    assert.equal(recoveryWrites, 0);
    assert.equal(repo.hasPendingMutation(expected.id), true);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
});

test('a slow confirmation read is circuit-broken until the raw read settles, then retries', async () => {
    const context = loadCheckinService();
    const user = { uid: 'user-1' };
    const expected = {
        id: 'hung-confirmation-read',
        verified: true,
        ts: 285,
        syncToken: 'hung-confirmation-token'
    };
    const repo = preparePendingVisit(context, expected);
    let serverReads = 0;
    let resolveFirstRead;
    const firstRead = new Promise(resolve => { resolveFirstRead = resolve; });

    context.firebase = {
        auth() {
            return { currentUser: user };
        },
        firestore() {
            return {
                collection() {
                    return {
                        doc() {
                            return {
                                get() {
                                    serverReads++;
                                    if (serverReads === 1) return firstRead;
                                    return Promise.resolve(makeSnapshot([expected]));
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    setTimeout(() => resolveFirstRead(makeSnapshot([])), 35);

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        serverReadTimeoutMs: 20
    });

    assert.equal(result.confirmed, true);
    assert.equal(serverReads, 2, 'a fresh read should run only after the abandoned raw read settles');
    assert.equal(repo.hasPendingMutation(expected.id), false);
});

test('a never-settling confirmation read cannot accumulate orphaned Firestore requests', async () => {
    const context = loadCheckinService();
    const user = { uid: 'forever-read-user' };
    const expected = {
        id: 'forever-read-park',
        verified: false,
        ts: 288,
        syncToken: 'forever-read-token'
    };
    const repo = preparePendingVisit(context, expected);
    let serverReads = 0;

    context.firebase = {
        auth() {
            return { currentUser: user };
        },
        firestore() {
            return {
                collection() {
                    return {
                        doc() {
                            return {
                                get() {
                                    serverReads++;
                                    return new Promise(() => {});
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    setTimeout(() => context.__dispatchWindowEvent('focus'), 40);
    setTimeout(() => context.__dispatchWindowEvent('pageshow'), 50);
    setTimeout(() => context.__dispatchDocumentEvent('visibilitychange'), 60);
    setTimeout(() => context.__dispatchConnectionEvent('change'), 70);
    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, {
        retryMs: 10,
        serverReadTimeoutMs: 20,
        timeoutMs: 100
    });

    assert.equal(result.confirmed, false);
    assert.equal(serverReads, 1, 'lifecycle storms must reuse the one uncancellable raw read');
    assert.equal(repo.hasPendingMutation(expected.id), true);
});

test('force recovery releases its latch but does not overlap a stalled server read', async () => {
    const context = loadCheckinService();
    const user = { uid: 'user-1' };
    const expected = {
        id: 'hung-force-read',
        verified: false,
        ts: 290,
        syncToken: 'hung-force-token'
    };
    const repo = preparePendingVisit(context, expected);
    let serverReads = 0;
    let resolveFirstRead;
    const firstRead = new Promise(resolve => { resolveFirstRead = resolve; });

    context.firebase = {
        auth() {
            return { currentUser: user };
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
                                get() {
                                    serverReads++;
                                    if (serverReads === 1) return firstRead;
                                    return Promise.resolve(makeSnapshot([expected]));
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    await context.window.BARK.services.checkin.forceServerSyncRecovery('hung-read-1', {
        serverReadTimeoutMs: 20
    });
    assert.equal(repo.hasPendingMutation(expected.id), true, 'a guarded read must not clear orange state');

    await context.window.BARK.services.checkin.forceServerSyncRecovery('hung-read-2', {
        serverReadTimeoutMs: 20
    });
    assert.equal(serverReads, 1, 'a second cycle must not create another uncancellable read');
    assert.equal(repo.hasPendingMutation(expected.id), true);

    resolveFirstRead(makeSnapshot([]));
    await new Promise(resolve => setTimeout(resolve, 0));
    await context.window.BARK.services.checkin.forceServerSyncRecovery('recovered-read-3', {
        serverReadTimeoutMs: 20
    });
    assert.equal(serverReads, 2, 'a new read is allowed after the abandoned raw read settles');
    assert.equal(repo.hasPendingMutation(expected.id), false);
});

test('a completed recovery that still lacks server proof offers reload without clearing the visit', async () => {
    const context = loadCheckinService();
    const uid = 'still-pending-user';
    const expected = {
        id: 'still-pending-park',
        verified: false,
        ts: 292,
        syncToken: 'still-pending-token'
    };
    const repo = preparePendingVisit(context, expected);
    const notices = [];

    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 292, offlinePremiumProvisional: false }
    }));
    context.window.BARK.showAuthFailure = message => notices.push(message);
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        replayPendingVisitDeletions() {
            return Promise.resolve([]);
        },
        updateCurrentUserVisitedPlaces() {
            return Promise.resolve([]);
        },
        reconcileVisitedPlacesSnapshot(placeList, metadata) {
            return repo.reconcileSnapshot(placeList, metadata);
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
                            return { get: async () => makeSnapshot([]) };
                        }
                    };
                }
            };
        }
    };

    await context.window.BARK.services.checkin.forceServerSyncRecovery('still-pending', {
        serverReadTimeoutMs: 20
    });

    assert.equal(repo.hasPendingMutation(expected.id), true);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
    assert.deepEqual(notices, [
        'Saved visits will keep retrying. If syncing looks stuck, reload here.'
    ]);
});

test('foreground recovery is inert before the default Firebase app exists', async () => {
    const context = loadCheckinService({ fastRecoverySignals: true });
    context.firebase = {
        apps: [],
        auth() {
            throw new Error("Firebase: No Firebase App '[DEFAULT]'");
        }
    };

    assert.doesNotThrow(() => {
        context.__dispatchWindowEvent('focus');
        context.__dispatchWindowEvent('pageshow');
        context.__dispatchDocumentEvent('visibilitychange');
        context.__dispatchConnectionEvent('change');
    });
    await new Promise(resolve => setTimeout(resolve, 20));
});

test('account switch during force recovery cannot replay the old UID journal', async () => {
    const context = loadCheckinService();
    const uidA = 'recovery-account-a';
    const uidB = 'recovery-account-b';
    const expected = {
        id: 'account-a-park',
        verified: false,
        ts: 294,
        syncToken: 'account-a-token'
    };
    let currentUid = uidA;
    let releaseDeletionReplay;
    let markDeletionReplayStarted;
    const deletionReplayStarted = new Promise(resolve => { markDeletionReplayStarted = resolve; });
    const deletionReplayPaused = new Promise(resolve => { releaseDeletionReplay = resolve; });
    let stagedAdds = 0;
    let cloudWrites = 0;

    context.localStorage.setItem(`bark.unconfirmedVisits.${uidA}`, JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 294, offlinePremiumProvisional: false }
    }));
    context.window.BARK.services.firebase = {
        replayPendingVisitDeletions() {
            markDeletionReplayStarted();
            return deletionReplayPaused;
        },
        stageVisitedPlaceUpsert() {
            stagedAdds++;
        },
        updateCurrentUserVisitedPlaces() {
            cloudWrites++;
            return Promise.resolve([]);
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: currentUid ? { uid: currentUid } : null };
        },
        firestore() {
            return {};
        }
    };

    const recovery = context.window.BARK.services.checkin.forceServerSyncRecovery('account-switch');
    await deletionReplayStarted;
    currentUid = uidB;
    releaseDeletionReplay([]);
    await recovery;

    assert.equal(stagedAdds, 0);
    assert.equal(cloudWrites, 0);
    assert.equal(context.window.BARK.repos.VaultRepo.hasVisit(expected.id), false);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uidA}`), null);
});

test('late old-account replay completion cannot reconcile the active account', async () => {
    const context = loadCheckinService();
    const uidA = 'late-replay-account-a';
    const uidB = 'late-replay-account-b';
    const expected = {
        id: 'late-account-a-park',
        verified: true,
        ts: 296,
        syncToken: 'late-account-a-token'
    };
    let currentUid = uidA;
    let resolveWrite;
    let markWriteStarted;
    const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
    const pausedWrite = new Promise(resolve => { resolveWrite = resolve; });
    let reconciliations = 0;

    context.localStorage.setItem(`bark.unconfirmedVisits.${uidA}`, JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 296, offlinePremiumProvisional: false }
    }));
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert() {},
        updateCurrentUserVisitedPlaces() {
            markWriteStarted();
            return pausedWrite;
        },
        reconcileVisitedPlacesSnapshot() {
            reconciliations++;
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: currentUid ? { uid: currentUid } : null };
        }
    };

    const replay = context.window.BARK.services.checkin.replayUnconfirmedVisits(uidA);
    await writeStarted;
    currentUid = uidB;
    resolveWrite([expected]);
    await replay;

    assert.equal(reconciliations, 0);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uidA}`), null);
});

test('late direct visit commit cannot repaint after an account switch', async () => {
    const context = loadCheckinService();
    const uidA = 'late-commit-account-a';
    const uidB = 'late-commit-account-b';
    const users = {
        [uidA]: { uid: uidA },
        [uidB]: { uid: uidB }
    };
    let currentUid = uidA;
    let resolveWrite;
    let markWriteStarted;
    const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
    const pausedWrite = new Promise(resolve => { resolveWrite = resolve; });
    let reconciliations = 0;
    const repo = context.window.BARK.repos.VaultRepo;

    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        reconcileVisitedPlacesSnapshot() {
            reconciliations++;
        },
        syncUserProgress() {
            markWriteStarted();
            return pausedWrite;
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: currentUid ? users[currentUid] : null };
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: 'late-direct-commit-park',
        name: 'Late Direct Commit Park',
        lat: 35,
        lng: -84
    });
    assert.equal(result.success, true);
    await writeStarted;
    currentUid = uidB;
    resolveWrite([result.visitRecord]);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(reconciliations, 0);
    assert.equal(repo.hasPendingMutation(result.visitRecord.id), true);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uidA}`), null);
});

test('late old-account write failure cannot clear the new account same-park intent', async () => {
    const context = loadCheckinService();
    const uidA = 'late-failure-account-a';
    const uidB = 'late-failure-account-b';
    const parkId = 'shared-account-park';
    let currentUid = uidA;
    let rejectWrite;
    let markWriteStarted;
    const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
    const pausedWrite = new Promise((resolve, reject) => { rejectWrite = reject; });
    const clearedPendingIds = [];
    const repo = context.window.BARK.repos.VaultRepo;

    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        clearVisitedPlacePendingMutation(id) {
            clearedPendingIds.push(id);
            repo.clearPendingMutation(id);
        },
        syncUserProgress() {
            markWriteStarted();
            return pausedWrite;
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: currentUid ? { uid: currentUid } : null };
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: parkId,
        name: 'Account A Park',
        lat: 35,
        lng: -84
    });
    assert.equal(result.success, true);
    await writeStarted;

    currentUid = uidB;
    const accountBVisit = {
        ...result.visitRecord,
        name: 'Account B Park',
        syncToken: 'account-b-newer-token'
    };
    context.localStorage.setItem(`bark.unconfirmedVisits.${uidB}`, JSON.stringify({
        [parkId]: { visit: accountBVisit, stashedAt: 297, offlinePremiumProvisional: false }
    }));
    repo.addVisit(accountBVisit);
    repo.stageUpsert(accountBVisit);

    const staleAccountError = new Error('account changed');
    staleAccountError.code = 'stale-account';
    rejectWrite(staleAccountError);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(repo.hasPendingMutation(parkId), true);
    assert.deepEqual(JSON.parse(JSON.stringify(repo.getVisit(parkId))), accountBVisit);
    assert.deepEqual(clearedPendingIds, []);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uidA}`), null);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uidB}`), null);
});

test('late same-account write failure cannot clear a newer same-park intent', async () => {
    const context = loadCheckinService();
    const uid = 'same-account-newer-intent';
    const parkId = 'same-account-park';
    let rejectWrite;
    let markWriteStarted;
    const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
    const pausedWrite = new Promise((resolve, reject) => { rejectWrite = reject; });
    const clearedPendingIds = [];
    const repo = context.window.BARK.repos.VaultRepo;

    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        clearVisitedPlacePendingMutation(id) {
            clearedPendingIds.push(id);
            repo.clearPendingMutation(id);
        },
        syncUserProgress() {
            markWriteStarted();
            return pausedWrite;
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: parkId,
        name: 'Original Park Intent',
        lat: 35,
        lng: -84
    });
    assert.equal(result.success, true);
    await writeStarted;

    const newerVisit = {
        ...result.visitRecord,
        name: 'Newer Park Intent',
        syncToken: 'same-account-newer-token'
    };
    context.localStorage.setItem(`bark.unconfirmedVisits.${uid}`, JSON.stringify({
        [parkId]: { visit: newerVisit, stashedAt: 298, offlinePremiumProvisional: false }
    }));
    repo.addVisit(newerVisit);
    repo.stageUpsert(newerVisit);

    const rejectedError = new Error('old request rejected');
    rejectedError.code = 'permission-denied';
    rejectWrite(rejectedError);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(repo.hasPendingMutation(parkId), true);
    assert.deepEqual(JSON.parse(JSON.stringify(repo.getVisit(parkId))), newerVisit);
    assert.deepEqual(clearedPendingIds, []);
    const journal = JSON.parse(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`));
    assert.deepEqual(journal[parkId].visit, newerVisit);
});

test('late add failure cannot clear an orange visit after its date changed with the same token', async () => {
    const context = loadCheckinService();
    const uid = 'same-token-date-edit';
    const parkId = 'orange-date-edit-park';
    let rejectWrite;
    let markWriteStarted;
    const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
    const pausedWrite = new Promise((resolve, reject) => { rejectWrite = reject; });
    const clearedPendingIds = [];
    const repo = context.window.BARK.repos.VaultRepo;

    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        clearVisitedPlacePendingMutation(id) {
            clearedPendingIds.push(id);
            repo.clearPendingMutation(id);
        },
        syncUserProgress() {
            markWriteStarted();
            return pausedWrite;
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: parkId,
        name: 'Orange Date Edit Park',
        lat: 35,
        lng: -84
    });
    assert.equal(result.success, true);
    await writeStarted;

    // updateVisitDate currently retains the add's sync token and changes only
    // the Vault record. The older add no longer owns this visible mutation.
    const editedVisit = {
        ...result.visitRecord,
        ts: result.visitRecord.ts + 86400000
    };
    repo.addVisit(editedVisit);
    repo.stageUpsert(editedVisit);

    const rejectedError = new Error('old add rejected after date edit');
    rejectedError.code = 'permission-denied';
    rejectWrite(rejectedError);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(repo.hasPendingMutation(parkId), true);
    assert.deepEqual(JSON.parse(JSON.stringify(repo.getVisit(parkId))), editedVisit);
    assert.deepEqual(clearedPendingIds, []);
    const journal = JSON.parse(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`));
    assert.deepEqual(journal[parkId].visit, JSON.parse(JSON.stringify(result.visitRecord)));
});

test('a rejected cloud write keeps the exact durable visit orange for later recovery', async () => {
    const context = loadCheckinService();
    const uid = 'durable-rejection-user';
    const repo = context.window.BARK.repos.VaultRepo;

    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        syncUserProgress() {
            const error = new Error('credential proof was rejected');
            error.code = 'permission-denied';
            return Promise.reject(error);
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: 'durable-rejection-park',
        name: 'Durable Rejection Park',
        lat: 35,
        lng: -84
    });
    assert.equal(result.success, true);
    const confirmation = context.window.BARK.services.checkin.awaitServerConfirmation(result.visitRecord, {
        retryMs: 10000,
        timeoutMs: 30
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(repo.hasVisit(result.visitRecord.id), true);
    assert.equal(repo.hasPendingMutation(result.visitRecord.id), true);
    assert.notEqual(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
    assert.deepEqual(JSON.parse(JSON.stringify(await confirmation)), {
        confirmed: false,
        reason: 'timeout'
    });
});

test('an exact replay survives an older fatal rejection and later confirms', async () => {
    const context = loadCheckinService();
    const uid = 'exact-replay-race-user';
    const repo = context.window.BARK.repos.VaultRepo;
    let rejectOriginalWrite;
    let resolveReplayWrite;
    let markOriginalStarted;
    let markReplayStarted;
    const originalStarted = new Promise(resolve => { markOriginalStarted = resolve; });
    const replayStarted = new Promise(resolve => { markReplayStarted = resolve; });
    const originalWrite = new Promise((resolve, reject) => { rejectOriginalWrite = reject; });
    const replayWrite = new Promise(resolve => { resolveReplayWrite = resolve; });

    context.window.BARK.services.premium = { isPremium: () => true };
    context.window.BARK.services.firebase = {
        stageVisitedPlaceUpsert(visit) {
            repo.stageUpsert(visit);
        },
        syncUserProgress() {
            markOriginalStarted();
            return originalWrite;
        },
        updateCurrentUserVisitedPlaces() {
            markReplayStarted();
            return replayWrite;
        },
        reconcileVisitedPlacesSnapshot(placeList, metadata) {
            return repo.reconcileSnapshot(placeList, metadata);
        }
    };
    context.firebase = {
        auth() {
            return { currentUser: { uid } };
        }
    };

    const result = await context.window.BARK.services.checkin.markAsVisited({
        id: 'exact-replay-race-park',
        name: 'Exact Replay Race Park',
        lat: 35,
        lng: -84
    });
    assert.equal(result.success, true);
    await originalStarted;

    const replay = context.window.BARK.services.checkin.replayUnconfirmedVisits(uid);
    await replayStarted;

    const oldAttemptError = new Error('older attempt rejected');
    oldAttemptError.code = 'permission-denied';
    rejectOriginalWrite(oldAttemptError);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(repo.hasVisit(result.visitRecord.id), true);
    assert.equal(repo.hasPendingMutation(result.visitRecord.id), true);
    assert.notEqual(
        context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`),
        null,
        'the older failure must not erase the exact replay journal'
    );

    resolveReplayWrite([result.visitRecord]);
    await replay;

    assert.equal(repo.hasPendingMutation(result.visitRecord.id), false);
    assert.equal(context.localStorage.getItem(`bark.unconfirmedVisits.${uid}`), null);
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
    const hideCalls = [];
    context.localStorage.setItem('bark.unconfirmedVisits.user-1', JSON.stringify({
        [expected.id]: { visit: expected, stashedAt: 600, offlinePremiumProvisional: false }
    }));
    context.window.BARK.hideOfflineRecoveryNotice = options => hideCalls.push(options);
    installServerSnapshot(context, () => makeSnapshot([expected]));

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(expected, { timeoutMs: 250 });

    assert.equal(result.confirmed, true);
    assert.equal(repo.hasPendingMutation(expected.id), false);
    assert.equal(context.localStorage.getItem('bark.unconfirmedVisits.user-1'), null);
    assert.equal(hideCalls.some(options => options && options.resetDismissal === true), true);
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
