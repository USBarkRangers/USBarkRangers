const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function makeServer(initialVisits, options = {}) {
    const state = options.state || {
        visits: initialVisits.map(visit => ({ ...visit })),
        version: 0,
        commits: 0,
        reads: 0
    };
    let available = options.available !== false;
    let entitlement = options.entitlement === null
        ? null
        : (options.entitlement || { premium: true, status: 'active' });
    let holdNextCommit = false;
    let heldCommitResolve = null;
    let releaseCommit = null;
    let holdNextResponse = false;
    let heldResponseResolve = null;
    let releaseResponse = null;
    const queuedFailures = [];
    const enforceLargeShrinkRule = options.enforceLargeShrinkRule !== false;

    const db = {
        collection() {
            return {
                doc: uid => ({
                    path: `users/${uid}`,
                    async get() {
                        state.reads++;
                        return {
                            exists: true,
                            metadata: { fromCache: false, hasPendingWrites: false },
                            data: () => ({
                                visitedPlaces: state.visits.map(visit => ({ ...visit })),
                                ...(entitlement ? { entitlement: { ...entitlement } } : {})
                            })
                        };
                    }
                })
            };
        },
        async runTransaction(callback) {
            if (!available) throw Object.assign(new Error('offline'), { code: 'unavailable' });
            if (queuedFailures.length > 0) throw queuedFailures.shift();
            state.reads++;
            let staged = null;
            await callback({
                async get() {
                    return {
                        exists: true,
                        data: () => ({
                            visitedPlaces: state.visits.map(visit => ({ ...visit })),
                            ...(entitlement ? { entitlement: { ...entitlement } } : {})
                        })
                    };
                },
                set(_ref, payload) {
                    staged = payload.visitedPlaces.map(visit => ({ ...visit }));
                }
            });
            if (holdNextCommit) {
                holdNextCommit = false;
                if (heldCommitResolve) {
                    const resolveHeld = heldCommitResolve;
                    heldCommitResolve = null;
                    resolveHeld();
                }
                await new Promise(resolve => { releaseCommit = resolve; });
            }
            if (
                enforceLargeShrinkRule
                && state.visits.length >= 3
                && staged.length <= state.visits.length - 3
            ) {
                throw Object.assign(
                    new Error('Missing or insufficient permissions: visitedPlaces shrink exceeds two records.'),
                    { code: 'permission-denied' }
                );
            }
            state.visits = staged;
            state.version++;
            state.commits++;
            if (holdNextResponse) {
                holdNextResponse = false;
                if (heldResponseResolve) {
                    const resolveHeld = heldResponseResolve;
                    heldResponseResolve = null;
                    resolveHeld();
                }
                await new Promise(resolve => { releaseResponse = resolve; });
            }
        }
    };

    return {
        db,
        state,
        setAvailable(value) { available = value; },
        setEntitlement(value) { entitlement = value; },
        failNext(error) { queuedFailures.push(error); },
        holdOneCommit() {
            holdNextCommit = true;
            return new Promise(resolve => { heldCommitResolve = resolve; });
        },
        releaseCommit() {
            if (!releaseCommit) return;
            const release = releaseCommit;
            releaseCommit = null;
            release();
        },
        holdOneResponse() {
            holdNextResponse = true;
            return new Promise(resolve => { heldResponseResolve = resolve; });
        },
        releaseResponse() {
            if (!releaseResponse) return;
            const release = releaseResponse;
            releaseResponse = null;
            release();
        }
    };
}

function loadHarness(server, storage = new Map(), { loadCheckin = false, premium = true } = {}) {
    const handlers = new Map();
    const alerts = [];
    const sessionRefreshes = { auth: 0, appCheck: 0 };
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
    context.navigator = { onLine: true };
    context.alert = message => alerts.push(String(message));
    context.confirm = () => true;
    context.syncState = () => {};
    context.addEventListener = (name, handler) => handlers.set(name, handler);
    context.localStorage = {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    };
    context.firebase = {
        auth: () => ({
            currentUser: {
                uid: 'bulk-user',
                async getIdToken() {
                    sessionRefreshes.auth++;
                    return 'refreshed-test-token';
                }
            }
        }),
        appCheck: () => ({
            async getToken() {
                sessionRefreshes.appCheck++;
                return { token: 'refreshed-app-check-token' };
            }
        }),
        firestore: () => server.db
    };
    server.setEntitlement(premium ? { premium: true, status: 'active' } : { premium: false, status: 'inactive' });

    vm.createContext(context);
    const scripts = [
        '01-code/app/repos/ParkRepo.js',
        '01-code/app/repos/VaultRepo.v141.js',
        '01-code/app/services/visitMutationCoordinator.v141.js',
        '01-code/app/services/firebaseService.v141.js'
    ];
    if (loadCheckin) scripts.push('01-code/app/services/checkinService.v141.js');
    scripts.forEach(relativePath => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), context, { filename: relativePath });
    });
    context.BARK.incrementRequestCount = () => {};
    context.BARK.invalidateVisitedIdsCache = () => {};
    context.BARK.services.premium = { isPremium: () => premium };
    context.allowUncheck = true;
    context.BARK.refreshCoordinator = {
        refreshVisitedCache() {},
        refreshVisitedVisuals() {}
    };
    context.BARK.renderManagePortal = () => {};
    context.dispatch = name => {
        const handler = handlers.get(name);
        if (handler) handler();
    };
    return {
        context,
        storage,
        alerts,
        sessionRefreshes,
        repo: context.BARK.repos.VaultRepo,
        service: context.BARK.services.firebase
    };
}

function makeVisits(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `park-${index}`,
        name: `Park ${index}`,
        verified: false,
        ts: index + 1
    }));
}

function seedRepo(repo, visits) {
    repo.clear();
    visits.forEach(visit => repo.addVisit(visit));
}

function stageOrangeVisit(harness, uid, visit) {
    harness.repo.addVisit(visit);
    harness.service.stageVisitedPlaceUpsert(visit);
    const key = `bark.unconfirmedVisits.${uid}`;
    const existing = harness.storage.has(key)
        ? JSON.parse(harness.storage.get(key))
        : {};
    existing[visit.id] = {
        visit,
        stashedAt: visit.ts,
        offlinePremiumProvisional: false
    };
    harness.storage.set(key, JSON.stringify(existing));
}

function getStashedVisit(harness, uid, visitId) {
    const raw = harness.storage.get(`bark.unconfirmedVisits.${uid}`);
    if (!raw) return null;
    const entry = JSON.parse(raw)[visitId];
    return entry && entry.visit ? entry.visit : null;
}

function applyAuthoritativeVisitSnapshot(harness, uid, visits) {
    const checkin = harness.context.BARK.services.checkin;
    const checkpointSaved = checkin.rememberAuthoritativeVisitIds(uid, visits);
    assert.equal(checkpointSaved, true);
    harness.service.reconcileVisitedPlacesSnapshot(visits, {
        fromCache: false,
        hasPendingWrites: false,
        canConfirmPending: checkpointSaved
    });
    checkin.reconcileUnconfirmedVisits(uid);
    harness.service.reconcilePendingVisitDeletions(uid);
}

function getAuthoritativeVisits(harness, uid) {
    const raw = harness.storage.get(`bark.authoritativeVisits.${uid}`);
    return raw ? JSON.parse(raw).visits : null;
}

test('a removal stays pending until the server confirms deletion', async () => {
    const visit = makeVisits(1)[0];
    const server = makeServer([visit]);
    const harness = loadHarness(server);
    seedRepo(harness.repo, [visit]);

    const removal = harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]);
    assert.equal(harness.repo.hasVisit(visit.id), false);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'delete');
    assert.equal(removal.syncStatus, 'pending');

    await removal.syncPromise;
    assert.equal(server.state.visits.length, 0);
    assert.equal(harness.repo.getPendingMutationType(visit.id), null);
});

test('cold fake-service boot hydrates only the remembered account deletion as pending', () => {
    const visit = makeVisits(1)[0];
    const storage = new Map();
    storage.set('bark.pendingVisitDeletes.remembered-user', JSON.stringify({
        [visit.id]: { id: visit.id, stagedAt: Date.now(), record: visit }
    }));
    const harness = loadHarness(makeServer([visit]), storage);

    assert.equal(harness.service.hydrateRememberedPendingVisitDeletions('remembered-user'), 1);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'delete');
    assert.equal(harness.service.reconcilePreAuthPendingVisitDeletions('different-user'), false);
    assert.equal(harness.repo.getPendingMutationType(visit.id), null);
    assert.notEqual(
        storage.get('bark.pendingVisitDeletes.remembered-user'),
        undefined,
        'account isolation must not erase the original account recovery journal'
    );
});

test('weak-cell reload overlays a durable deletion on the saved baseline', () => {
    const visit = makeVisits(1)[0];
    const storage = new Map([
        ['bark.lastAuthenticatedVisitUid', 'bulk-user'],
        ['bark.authoritativeVisits.bulk-user', JSON.stringify({
            schemaVersion: 1,
            uid: 'bulk-user',
            visits: [visit]
        })],
        ['bark.pendingVisitDeletes.bulk-user', JSON.stringify({
            [visit.id]: { id: visit.id, stagedAt: Date.now(), record: visit }
        })]
    ]);
    const harness = loadHarness(makeServer([visit]), storage, { loadCheckin: true });

    harness.context.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    assert.equal(harness.repo.hasVisit(visit.id), true);
    harness.service.hydrateRememberedPendingVisitDeletions('bulk-user');

    assert.equal(harness.repo.hasVisit(visit.id), false);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'delete');
    harness.repo.reconcileSnapshot([visit], { fromCache: true, hasPendingWrites: false });
    assert.equal(harness.repo.hasVisit(visit.id), false, 'stale cache must not undo the delete overlay');
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'delete');
});

test('a failed re-add safety copy cannot erase the durable pending deletion', async () => {
    const visit = makeVisits(1)[0];
    const storage = new Map();
    const harness = loadHarness(makeServer([visit]), storage, { loadCheckin: true });
    const mutationService = harness.context.BARK.visitMutationCoordinator;

    assert.equal(
        mutationService.stageDeletes('bulk-user', [{ id: visit.id, record: visit }]),
        true
    );
    harness.repo.removeVisit(visit.id);
    harness.repo.stageDelete(visit.id);

    const originalSetItem = harness.context.localStorage.setItem;
    harness.context.localStorage.setItem = (key, value) => {
        if (key === 'bark.unconfirmedVisits.bulk-user') {
            throw new Error('simulated add journal quota failure');
        }
        return originalSetItem(key, value);
    };

    const result = await harness.context.BARK.services.checkin.markAsVisited(visit);

    assert.equal(result.success, false);
    assert.equal(result.error, 'LOCAL_SAFETY_STORAGE_UNAVAILABLE');
    assert.equal(harness.repo.hasVisit(visit.id), false);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'delete');
    assert.notEqual(
        storage.get('bark.pendingVisitDeletes.bulk-user'),
        undefined,
        'the accepted removal must retain its durable journal'
    );

    const reopened = loadHarness(makeServer([visit]), storage);
    reopened.service.hydrateRememberedPendingVisitDeletions('bulk-user');
    assert.equal(reopened.repo.hasVisit(visit.id), false);
    assert.equal(reopened.repo.getPendingMutationType(visit.id), 'delete');
});

test('a legacy ID-only offline placeholder cannot overwrite the server through date edit', async () => {
    const visit = { ...makeVisits(1)[0], verified: true, ts: 12345 };
    const server = makeServer([visit]);
    const storage = new Map([
        ['bark.lastAuthenticatedVisitUid', 'bulk-user'],
        ['bark.authoritativeVisitIds.bulk-user', JSON.stringify([visit.id])]
    ]);
    const harness = loadHarness(server, storage, { loadCheckin: true });
    harness.context.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();

    const placeholder = harness.repo.getVisit(visit.id);
    assert.equal(placeholder.legacyOfflineBaseline, true);
    await assert.rejects(
        harness.service.updateVisitDate(visit.id, 99999),
        /finish syncing before editing/
    );

    assert.equal(server.state.commits, 0);
    assert.deepEqual(server.state.visits, [visit]);
    assert.equal(harness.repo.getPendingMutationType(visit.id), null);
});

test('an orange addition cannot create an undurable date edit', async () => {
    const visit = { ...makeVisits(1)[0], syncToken: 'orange-date-token' };
    const server = makeServer([]);
    const storage = new Map([
        ['bark.unconfirmedVisits.bulk-user', JSON.stringify({
            [visit.id]: { visit, stashedAt: Date.now(), offlinePremiumProvisional: false }
        })]
    ]);
    const harness = loadHarness(server, storage, { loadCheckin: true });
    harness.repo.addVisit(visit);
    harness.repo.stageUpsert(visit);

    await assert.rejects(
        harness.service.updateVisitDate(visit.id, 99999),
        /finish syncing before editing/
    );

    assert.equal(server.state.commits, 0);
    assert.deepEqual(JSON.parse(storage.get('bark.unconfirmedVisits.bulk-user'))[visit.id].visit, visit);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.repo.getVisit(visit.id))), visit);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'upsert');
});

test('50 rapid removals commit in rule-safe pairs without resurrecting visits', async () => {
    const visits = makeVisits(50);
    const server = makeServer(visits);
    const harness = loadHarness(server);
    seedRepo(harness.repo, visits);

    const removals = visits.map(visit => harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    await Promise.all(removals.map(result => result.syncPromise));

    assert.equal(server.state.commits, 25);
    assert.equal(server.state.visits.length, 0);
    assert.equal(harness.repo.size(), 0);
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(harness.storage.has('bark.pendingVisitDeletes.bulk-user'), false);
});

test('a post-commit callback failure resolves the durable write and does not retry it', async () => {
    const harness = loadHarness(makeServer([]));
    const postCommitErrors = [];
    let commits = 0;
    const coordinator = harness.context.BARK.visitMutationCoordinator.createCoordinator({
        debounceMs: 0,
        capture: () => ['new-state'],
        async commit(value) {
            commits++;
            return value;
        },
        onCommitted() {
            throw new Error('simulated local renderer failure');
        },
        onPostCommitError(error) {
            postCommitErrors.push(error.message);
        },
        isRetryable: () => false
    });

    const committed = await coordinator.request();

    assert.deepEqual(Array.from(committed), ['new-state']);
    assert.equal(commits, 1);
    assert.deepEqual(postCommitErrors, ['simulated local renderer failure']);
    assert.equal(coordinator.snapshot().committedRevision, 1);
    assert.equal(coordinator.snapshot().waiting, 0);
    coordinator.dispose('test complete');
});

test('Premium bulk deletions stay committed when the post-save screen refresh throws', async () => {
    const visits = makeVisits(40);
    const server = makeServer(visits, { available: false });
    const harness = loadHarness(server, new Map(), { premium: true });
    seedRepo(harness.repo, visits);

    // Optimistic removal refreshes happen before the server commit. Reproduce
    // the real failure specifically after Firestore has accepted the batch.
    harness.context.syncState = () => {
        if (server.state.commits > 0) throw new Error('simulated post-commit screen refresh failure');
    };
    harness.context.console = { log() {}, warn() {}, error() {} };

    const removals = visits.map(visit => harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(server.state.commits, 0, 'fake service must leave the deletion batch pending');

    server.setAvailable(true);
    harness.context.dispatch('online');
    const results = await Promise.allSettled(removals.map(result => result.syncPromise));

    assert.equal(server.state.commits, 20);
    assert.equal(server.state.visits.length, 0);
    assert.equal(results.every(result => result.status === 'fulfilled'), true);
    assert.equal(harness.repo.size(), 0, 'a display failure must not restore server-deleted parks');
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(harness.storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    assert.deepEqual(harness.alerts, []);
});

test('offline reconnect permission race refreshes session proof and keeps removals queued', async () => {
    const visits = makeVisits(20);
    const server = makeServer(visits, { available: false });
    const harness = loadHarness(server, new Map(), { premium: true });
    seedRepo(harness.repo, visits);

    const removals = visits.map(visit => harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(server.state.commits, 0);
    assert.equal(harness.repo.size(), 0);

    // Reproduce the real PWA sequence: network transport returns, but the first
    // Firestore attempt arrives before refreshed Auth/App Check proof.
    server.setAvailable(true);
    server.failNext(Object.assign(new Error('Session proof has not refreshed yet'), { code: 'permission-denied' }));
    harness.context.dispatch('online');
    const results = await Promise.allSettled(removals.map(result => result.syncPromise));

    assert.equal(results.every(result => result.status === 'fulfilled'), true);
    assert.equal(server.state.visits.length, 0);
    assert.equal(harness.repo.size(), 0);
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(harness.storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    assert.equal(harness.storage.has('bark.visitWriteRecovery.bulk-user'), false);
    assert.equal(harness.sessionRefreshes.auth >= 1, true);
    assert.equal(harness.sessionRefreshes.appCheck >= 1, true);
    assert.deepEqual(harness.alerts, []);
});

test('a Premium addition retries after stale session proof and stays orange until commit', async () => {
    const server = makeServer([]);
    server.failNext(Object.assign(
        new Error('Session proof has not refreshed yet'),
        { code: 'permission-denied' }
    ));
    const harness = loadHarness(server, new Map(), { loadCheckin: true, premium: true });
    const park = {
        id: 'premium-proof-retry-park',
        name: 'Premium Proof Retry Park',
        lat: 35,
        lng: -84
    };

    const result = await harness.context.BARK.services.checkin.markAsVisited(park);
    assert.equal(result.success, true);
    assert.equal(result.syncStatus, 'pending');
    assert.equal(harness.repo.hasPendingMutation(park.id), true);
    assert.notEqual(harness.storage.get('bark.unconfirmedVisits.bulk-user'), undefined);

    const deadline = Date.now() + 2500;
    while (server.state.commits === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
    }

    assert.equal(server.state.commits, 1);
    assert.equal(server.state.visits.some(visit => visit.id === park.id), true);
    assert.equal(harness.repo.hasPendingMutation(park.id), false);
    assert.equal(harness.storage.has('bark.unconfirmedVisits.bulk-user'), false);
    assert.equal(harness.sessionRefreshes.auth >= 1, true);
    assert.equal(harness.sessionRefreshes.appCheck >= 1, true);
});

test('removals arriving during a write stay deleted and flush in one follow-up transaction', async () => {
    const visits = makeVisits(50);
    const server = makeServer(visits);
    server.holdOneCommit();
    const harness = loadHarness(server);
    seedRepo(harness.repo, visits);

    const first = visits.slice(0, 10).map(visit => harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    await new Promise(resolve => setTimeout(resolve, 100));
    const later = visits.slice(10).map(visit => harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    server.releaseCommit();
    await Promise.all([...first, ...later].map(result => result.syncPromise));

    assert.equal(server.state.commits, 25);
    assert.equal(server.state.visits.length, 0);
    assert.equal(harness.repo.size(), 0);
    assert.equal(harness.repo.snapshot().pending.size, 0);
});

test('an offline deletion survives app close and is removed from the server on reopen', async () => {
    const visit = makeVisits(1)[0];
    const sharedState = { visits: [visit], version: 0, commits: 0, reads: 0 };
    const storage = new Map();
    const offlineServer = makeServer([], { state: sharedState, available: false });
    const firstSession = loadHarness(offlineServer, storage);
    seedRepo(firstSession.repo, [visit]);

    const removal = firstSession.service.removeVisitedEntries([{ id: visit.id, record: visit }]);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(firstSession.repo.hasVisit(visit.id), false);
    assert.equal(firstSession.repo.getPendingMutationType(visit.id), 'delete');
    assert.notEqual(storage.get('bark.pendingVisitDeletes.bulk-user'), undefined);
    assert.equal(sharedState.visits.length, 1, 'offline transaction must not pretend the server changed');

    const onlineServer = makeServer([], { state: sharedState, available: true });
    const reopened = loadHarness(onlineServer, storage);
    await reopened.service.replayPendingVisitDeletions('bulk-user');

    assert.equal(sharedState.visits.length, 0);
    assert.equal(storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    assert.equal(reopened.repo.hasVisit(visit.id), false);
    assert.equal(reopened.repo.getPendingMutationType(visit.id), null);

    // Let the old page's still-pending promise finish cleanly so no retry timer
    // survives the test process. Its newest state is also the intended deletion.
    offlineServer.setAvailable(true);
    firstSession.context.dispatch('online');
    await removal.syncPromise;
});

test('a confirmed deletion persists an explicit empty baseline and stale cache cannot resurrect it', async () => {
    const visit = makeVisits(1)[0];
    const storage = new Map();
    const server = makeServer([visit]);
    const first = loadHarness(server, storage, { loadCheckin: true });
    seedRepo(first.repo, [visit]);

    const removal = first.service.removeVisitedEntries([{ id: visit.id, record: visit }]);
    await removal.syncPromise;
    assert.equal(server.state.visits.length, 0);
    assert.equal(storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    const storedBaseline = JSON.parse(storage.get('bark.authoritativeVisits.bulk-user'));
    assert.deepEqual(storedBaseline.visits, [], 'server-confirmed empty must be a real checkpoint');

    const reopened = loadHarness(server, storage, { loadCheckin: true });
    const restored = reopened.context.BARK.services.checkin.hydrateRememberedUnconfirmedVisits();
    reopened.service.hydrateRememberedPendingVisitDeletions('bulk-user');
    assert.equal(restored, 0, 'an explicit empty baseline contains zero visits but is still hydrated');
    assert.equal(reopened.repo.hasVisit(visit.id), false);

    reopened.repo.reconcileSnapshot([visit], { fromCache: true, hasPendingWrites: false });
    assert.equal(
        reopened.repo.hasVisit(visit.id),
        false,
        'cached pre-delete data must not resurrect a green park after reload'
    );
});

test('offline deletion survives restart and a first permission-denied reconnect response', async () => {
    const visits = makeVisits(12);
    const sharedState = { visits: visits.map(visit => ({ ...visit })), version: 0, commits: 0, reads: 0 };
    const storage = new Map();
    const offlineServer = makeServer([], { state: sharedState, available: false });
    const firstSession = loadHarness(offlineServer, storage);
    seedRepo(firstSession.repo, visits);

    const removals = visits.map(visit => firstSession.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(storage.has('bark.visitWriteRecovery.bulk-user'), true);
    assert.equal(sharedState.visits.length, 12);

    const reconnectServer = makeServer([], { state: sharedState, available: true });
    reconnectServer.failNext(Object.assign(new Error('App Check is still refreshing'), { code: 'permission-denied' }));
    const reopened = loadHarness(reconnectServer, storage);
    await reopened.service.replayPendingVisitDeletions('bulk-user');

    assert.equal(sharedState.visits.length, 0);
    assert.equal(storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    assert.equal(storage.has('bark.visitWriteRecovery.bulk-user'), false);
    assert.equal(reopened.sessionRefreshes.auth >= 1, true);
    assert.equal(reopened.sessionRefreshes.appCheck >= 1, true);
    assert.deepEqual(reopened.alerts, []);

    offlineServer.setAvailable(true);
    firstSession.context.dispatch('online');
    await Promise.all(removals.map(result => result.syncPromise));
});

test('deleting an orange pending visit clears its add-recovery record before syncing the delete', async () => {
    const visit = { ...makeVisits(1)[0], syncToken: 'pending-token' };
    const server = makeServer([visit]);
    const harness = loadHarness(server, new Map(), { loadCheckin: true });
    seedRepo(harness.repo, [visit]);
    harness.repo.stageUpsert(visit);
    harness.storage.set('bark.unconfirmedVisits.bulk-user', JSON.stringify({
        [visit.id]: { visit, stashedAt: Date.now() }
    }));

    const removal = harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]);
    assert.equal(harness.storage.has('bark.unconfirmedVisits.bulk-user'), false);
    await removal.syncPromise;

    assert.equal(server.state.visits.length, 0);
    assert.equal(harness.repo.hasVisit(visit.id), false);
    assert.equal(harness.storage.has('bark.pendingVisitDeletes.bulk-user'), false);
});

test('60 deletes, 70 adds, then 60 deletes stays warning-free and converges to the intended account state', async () => {
    const originalVisits = makeVisits(100);
    const addedParks = Array.from({ length: 70 }, (_, index) => ({
        id: `added-${index}`,
        name: `Added Park ${index}`,
        lat: 30 + (index / 1000),
        lng: -80 - (index / 1000)
    }));
    const server = makeServer(originalVisits);
    const harness = loadHarness(server, new Map(), { loadCheckin: true });
    seedRepo(harness.repo, originalVisits);
    harness.service.attemptDailyStreakIncrement = async () => ({ success: true });

    const checkin = harness.context.BARK.services.checkin;
    const firstDeletes = await Promise.all(originalVisits.slice(0, 60).map(park => checkin.markAsVisited(park)));
    const additions = await Promise.all(addedParks.map(park => checkin.markAsVisited(park)));
    const secondDeletes = await Promise.all(addedParks.slice(0, 60).map(park => checkin.markAsVisited(park)));
    await harness.service.syncUserProgress();

    assert.deepEqual(new Set(firstDeletes.map(result => result.action)), new Set(['removed']));
    assert.deepEqual(new Set(additions.map(result => result.action)), new Set(['added']));
    assert.deepEqual(new Set(secondDeletes.map(result => result.action)), new Set(['removed']));
    assert.equal(server.state.visits.length, 50);
    assert.deepEqual(
        new Set(server.state.visits.map(visit => visit.id)),
        new Set([
            ...originalVisits.slice(60).map(visit => visit.id),
            ...addedParks.slice(60).map(park => park.id)
        ])
    );
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(harness.storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    assert.deepEqual(harness.alerts, []);
});

test('iOS code-0 IndexedDB resume failure stays queued and retries without restoring deleted parks', async () => {
    const visits = makeVisits(60);
    const server = makeServer(visits);
    server.failNext(Object.assign(
        new Error('Attempt to get records from database without an in-progress transaction'),
        { code: 0 }
    ));
    const harness = loadHarness(server);
    seedRepo(harness.repo, visits);

    const removals = visits.map(visit => harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    await Promise.all(removals.map(result => result.syncPromise));

    assert.equal(server.state.commits, 30, 'the retry must finish every rule-safe deletion slice');
    assert.equal(server.state.visits.length, 0);
    assert.equal(harness.repo.size(), 0);
    assert.equal(harness.storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    assert.deepEqual(harness.alerts, []);
});

test('account A free-cap rejection cannot erase account B pending visit with the same park ID', async () => {
    const originalVisits = makeVisits(5);
    const server = makeServer(originalVisits);
    const harness = loadHarness(server, new Map(), { loadCheckin: true, premium: false });
    let currentUid = 'account-a';
    harness.context.firebase.auth = () => ({
        currentUser: currentUid ? { uid: currentUid } : null
    });

    const accountAVisit = {
        id: 'shared-free-cap-park',
        name: 'Account A Visit',
        verified: false,
        ts: 100,
        syncToken: 'account-a-token'
    };
    const accountBVisit = {
        ...accountAVisit,
        name: 'Account B Visit',
        ts: 200,
        syncToken: 'account-b-token'
    };

    stageOrangeVisit(harness, currentUid, accountAVisit);
    const commitHeld = server.holdOneCommit();
    const accountAWrite = harness.service.updateCurrentUserVisitedPlaces([]);
    await commitHeld;

    currentUid = 'account-b';
    harness.repo.clear();
    stageOrangeVisit(harness, currentUid, accountBVisit);

    server.releaseCommit();
    await accountAWrite;

    const currentVisit = harness.repo.getVisit(accountBVisit.id);
    const pending = harness.repo.snapshot().pending.get(accountBVisit.id);
    assert.equal(currentVisit && currentVisit.syncToken, accountBVisit.syncToken);
    assert.equal(pending && pending.type, 'upsert');
    assert.equal(pending && pending.place && pending.place.syncToken, accountBVisit.syncToken);
    assert.equal(
        getStashedVisit(harness, 'account-b', accountBVisit.id).syncToken,
        accountBVisit.syncToken
    );
    assert.equal(harness.storage.has('bark.unconfirmedVisits.account-a'), false);
    assert.equal(server.state.visits.some(visit => visit.id === accountBVisit.id), false);
});

test('same-UID free-cap rejection cannot erase a newer token for the same park', async () => {
    const originalVisits = makeVisits(5);
    const server = makeServer(originalVisits);
    const harness = loadHarness(server, new Map(), { loadCheckin: true, premium: false });
    const uid = 'bulk-user';
    const firstVisit = {
        id: 'superseded-free-cap-park',
        name: 'First Pending Visit',
        verified: false,
        ts: 100,
        syncToken: 'token-1'
    };
    const newerVisit = {
        ...firstVisit,
        name: 'Newer Pending Visit',
        ts: 200,
        syncToken: 'token-2'
    };

    stageOrangeVisit(harness, uid, firstVisit);
    const commitHeld = server.holdOneCommit();
    const firstWrite = harness.service.updateCurrentUserVisitedPlaces([]);
    await commitHeld;

    stageOrangeVisit(harness, uid, newerVisit);
    server.releaseCommit();
    await firstWrite;

    const currentVisit = harness.repo.getVisit(newerVisit.id);
    const pending = harness.repo.snapshot().pending.get(newerVisit.id);
    assert.equal(currentVisit && currentVisit.syncToken, newerVisit.syncToken);
    assert.equal(currentVisit && currentVisit.name, newerVisit.name);
    assert.equal(pending && pending.type, 'upsert');
    assert.equal(pending && pending.place && pending.place.syncToken, newerVisit.syncToken);
    assert.equal(getStashedVisit(harness, uid, newerVisit.id).syncToken, newerVisit.syncToken);
    assert.equal(server.state.visits.some(visit => visit.id === newerVisit.id), false);
});

test('a delayed delete result cannot overtake a newer authoritative re-add or acknowledge its journal', async () => {
    const uid = 'bulk-user';
    const visit = {
        id: 'newer-server-readd',
        name: 'Newer Server Re-add',
        verified: true,
        ts: 100
    };
    const server = makeServer([visit]);
    const harness = loadHarness(server, new Map(), { loadCheckin: true });
    seedRepo(harness.repo, [visit]);

    const responseHeld = server.holdOneResponse();
    const removal = harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]);
    await responseHeld;
    assert.deepEqual(server.state.visits, [], 'the delete committed before its response was paused');

    // Another authoritative write re-adds the visit while the older delete
    // promise is still unresolved. The durable delete remains the user's newer
    // local intent and must retry against that server re-add.
    server.state.visits = [{ ...visit }];
    applyAuthoritativeVisitSnapshot(harness, uid, [visit]);
    assert.equal(harness.repo.hasVisit(visit.id), false);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'delete');
    assert.notEqual(harness.storage.get(`bark.pendingVisitDeletes.${uid}`), undefined);

    server.releaseResponse();
    const staleResult = await removal.syncPromise;

    assert.equal(staleResult.__barkStaleVisitCommitResult, true);
    assert.deepEqual(getAuthoritativeVisits(harness, uid), [visit]);
    assert.equal(harness.repo.hasVisit(visit.id), false);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'delete');
    const deleteJournal = JSON.parse(harness.storage.get(`bark.pendingVisitDeletes.${uid}`));
    assert.equal(deleteJournal[visit.id].id, visit.id);
});

test('a delayed add result cannot overtake a newer authoritative delete or clear replay safety', async () => {
    const uid = 'bulk-user';
    const visit = {
        id: 'newer-server-delete',
        name: 'Newer Server Delete',
        verified: false,
        ts: 200,
        syncToken: 'newer-server-delete-token'
    };
    const server = makeServer([]);
    const harness = loadHarness(server, new Map(), { loadCheckin: true });
    const checkin = harness.context.BARK.services.checkin;
    stageOrangeVisit(harness, uid, visit);

    const responseHeld = server.holdOneResponse();
    const replay = checkin.replayUnconfirmedVisits(uid);
    await responseHeld;
    assert.equal(server.state.visits[0].syncToken, visit.syncToken);

    // A later authoritative deletion arrives before the old add transaction's
    // response. The pending upsert overlay must remain orange and durable; in
    // particular replay's direct confirm path must reject the tagged old array.
    server.state.visits = [];
    applyAuthoritativeVisitSnapshot(harness, uid, []);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'upsert');
    assert.equal(getStashedVisit(harness, uid, visit.id).syncToken, visit.syncToken);

    server.releaseResponse();
    await replay;

    assert.deepEqual(getAuthoritativeVisits(harness, uid), []);
    assert.equal(harness.repo.getVisit(visit.id).syncToken, visit.syncToken);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'upsert');
    assert.equal(getStashedVisit(harness, uid, visit.id).syncToken, visit.syncToken);
});

test('a failed first checkpoint cannot let a delayed transaction overtake newer authoritative state', async () => {
    const uid = 'bulk-user';
    const visit = {
        id: 'failed-checkpoint-delayed-add',
        name: 'Failed Checkpoint Delayed Add',
        verified: false,
        ts: 210,
        syncToken: 'failed-checkpoint-delayed-token'
    };
    const server = makeServer([]);
    const harness = loadHarness(server, new Map(), { loadCheckin: true });
    const checkin = harness.context.BARK.services.checkin;
    stageOrangeVisit(harness, uid, visit);

    // Fail only the transaction response's first full-baseline checkpoint.
    // A later listener checkpoint must be allowed to persist successfully.
    const originalSetItem = harness.context.localStorage.setItem;
    let remainingCheckpointFailures = 1;
    harness.context.localStorage.setItem = (key, value) => {
        if (key === `bark.authoritativeVisits.${uid}` && remainingCheckpointFailures > 0) {
            remainingCheckpointFailures--;
            throw new Error('simulated one-shot authoritative checkpoint failure');
        }
        return originalSetItem(key, value);
    };

    // Hold the transaction's repository reconciliation after it has applied
    // locally. This creates the exact yield where a newer listener observation
    // can advance the account's authoritative generation and durable baseline.
    const originalReconcileSnapshot = harness.repo.reconcileSnapshot;
    let releaseTransactionReconcile;
    let markTransactionReconcileStarted;
    const transactionReconcileStarted = new Promise(resolve => {
        markTransactionReconcileStarted = resolve;
    });
    const transactionReconcileRelease = new Promise(resolve => {
        releaseTransactionReconcile = resolve;
    });
    let holdFirstReconciliation = true;
    harness.repo.reconcileSnapshot = (...args) => {
        const result = originalReconcileSnapshot(...args);
        if (!holdFirstReconciliation) return result;
        holdFirstReconciliation = false;
        markTransactionReconcileStarted();
        return transactionReconcileRelease.then(() => result);
    };

    const replay = checkin.replayUnconfirmedVisits(uid);
    await transactionReconcileStarted;
    assert.equal(server.state.visits[0].syncToken, visit.syncToken);
    assert.equal(remainingCheckpointFailures, 0);

    // The transaction committed first, then a newer authoritative server state
    // removed it. The older response must not repaint that visit green or
    // replace this newer empty checkpoint when its delayed continuation runs.
    server.state.visits = [];
    applyAuthoritativeVisitSnapshot(harness, uid, []);
    releaseTransactionReconcile();
    await replay;

    assert.deepEqual(getAuthoritativeVisits(harness, uid), []);
    assert.equal(harness.repo.getVisit(visit.id).syncToken, visit.syncToken);
    assert.equal(harness.repo.getPendingMutationType(visit.id), 'upsert');
    assert.equal(getStashedVisit(harness, uid, visit.id).syncToken, visit.syncToken);
});

test('newer authority during the final postcommit UI await blocks stale direct confirmation', async () => {
    const uid = 'bulk-user';
    const visit = {
        id: 'final-ui-await-delayed-add',
        name: 'Final UI Await Delayed Add',
        verified: false,
        ts: 220,
        syncToken: 'final-ui-await-delayed-token'
    };
    const server = makeServer([]);
    const harness = loadHarness(server, new Map(), { loadCheckin: true });
    const checkin = harness.context.BARK.services.checkin;
    stageOrangeVisit(harness, uid, visit);

    let releaseFinalUiStep;
    let markFinalUiStepStarted;
    const finalUiStepStarted = new Promise(resolve => {
        markFinalUiStepStarted = resolve;
    });
    const finalUiStepRelease = new Promise(resolve => {
        releaseFinalUiStep = resolve;
    });
    harness.context.syncState = () => {
        markFinalUiStepStarted();
        return finalUiStepRelease;
    };

    const replay = checkin.replayUnconfirmedVisits(uid);
    await finalUiStepStarted;

    assert.equal(server.state.visits[0].syncToken, visit.syncToken);
    assert.deepEqual(getAuthoritativeVisits(harness, uid), [visit]);
    assert.equal(harness.repo.getPendingMutationType(visit.id), null);
    assert.equal(getStashedVisit(harness, uid, visit.id), null);

    // A newer authoritative deletion arrives while the older transaction is
    // still awaiting its last postcommit callback. When that callback resumes,
    // the returned array must be tagged stale before replay's direct confirmer
    // can repaint or persist the older add.
    server.state.visits = [];
    applyAuthoritativeVisitSnapshot(harness, uid, []);
    releaseFinalUiStep();
    await replay;

    assert.deepEqual(getAuthoritativeVisits(harness, uid), []);
    assert.equal(harness.repo.hasVisit(visit.id), false);
    assert.equal(harness.repo.hasPendingMutation(visit.id), false);
    assert.equal(getStashedVisit(harness, uid, visit.id), null);
    assert.deepEqual(server.state.visits, []);
});

test('free offline additions recover through the fifth park and reject only the sixth', async () => {
    const originalVisits = makeVisits(2);
    const offlineServer = makeServer(originalVisits, { available: false });
    const harness = loadHarness(offlineServer, new Map(), { loadCheckin: true, premium: false });
    seedRepo(harness.repo, originalVisits);
    harness.service.attemptDailyStreakIncrement = async () => ({ success: true });
    const checkin = harness.context.BARK.services.checkin;
    const additions = Array.from({ length: 4 }, (_, index) => ({
        id: `free-offline-${index}`,
        name: `Free Offline ${index}`,
        lat: 34 + (index / 100),
        lng: -84 - (index / 100)
    }));

    const firstThree = [];
    for (const park of additions.slice(0, 3)) {
        firstThree.push(await checkin.markAsVisited(park));
    }
    const sixthAttempt = await checkin.markAsVisited(additions[3]);

    assert.deepEqual(new Set(firstThree.map(result => result.action)), new Set(['added']));
    assert.equal(sixthAttempt.success, false);
    assert.equal(sixthAttempt.error, 'FREE_VISIT_LIMIT');
    assert.equal(harness.repo.size(), 5);
    firstThree.forEach(result => {
        assert.equal(harness.repo.hasPendingMutation(result.visitRecord.id), true);
    });

    offlineServer.setAvailable(true);
    harness.context.dispatch('online');
    await harness.service.syncUserProgress();

    assert.equal(offlineServer.state.visits.length, 5);
    assert.equal(harness.repo.size(), 5);
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(harness.storage.has('bark.unconfirmedVisits.bulk-user'), false);
    firstThree.forEach(result => {
        assert.equal(checkin.isVisitAwaitingServerProof(result.visitRecord.id), false);
    });
});

test('free cold offline restart remembers four confirmed parks and permits only one more', async () => {
    const originalVisits = makeVisits(4);
    const storage = new Map();
    const server = makeServer(originalVisits, { available: false });
    const priorSession = loadHarness(server, storage, { loadCheckin: true, premium: false });
    priorSession.context.BARK.services.checkin.rememberAuthoritativeVisitIds('bulk-user', originalVisits);

    const reopened = loadHarness(server, storage, { loadCheckin: true, premium: false });
    reopened.context.navigator.onLine = false;
    reopened.service.attemptDailyStreakIncrement = async () => ({ success: true });
    const checkin = reopened.context.BARK.services.checkin;
    const fifthPark = { id: 'offline-fifth', name: 'Offline Fifth', lat: 33, lng: -84 };
    const sixthPark = { id: 'offline-sixth', name: 'Offline Sixth', lat: 33.1, lng: -84.1 };

    const fifth = await checkin.markAsVisited(fifthPark);
    const sixth = await checkin.markAsVisited(sixthPark);

    assert.equal(fifth.action, 'added');
    assert.equal(sixth.success, false);
    assert.equal(sixth.error, 'FREE_VISIT_LIMIT');
    assert.equal(reopened.repo.size(), 1, 'only the new orange record is hydrated during the cold offline boot');

    server.setAvailable(true);
    reopened.context.navigator.onLine = true;
    reopened.context.dispatch('online');
    await reopened.service.syncUserProgress();

    assert.equal(server.state.visits.length, 5);
    assert.equal(reopened.repo.size(), 5);
    assert.equal(reopened.repo.snapshot().pending.size, 0);
    assert.equal(storage.has('bark.unconfirmedVisits.bulk-user'), false);
});

test('legacy free overfilled orange queue keeps only the available server slot on reconnect', async () => {
    const originalVisits = makeVisits(4);
    const storage = new Map();
    const server = makeServer(originalVisits, { available: false });
    const harness = loadHarness(server, storage, { loadCheckin: true, premium: false });
    harness.context.navigator.onLine = false;
    harness.service.attemptDailyStreakIncrement = async () => ({ success: true });
    const checkin = harness.context.BARK.services.checkin;
    const additions = Array.from({ length: 5 }, (_, index) => ({
        id: `legacy-orange-${index}`,
        name: `Legacy Orange ${index}`,
        lat: 33 + (index / 100),
        lng: -84 - (index / 100)
    }));

    for (const park of additions) {
        const result = await checkin.markAsVisited(park);
        assert.equal(result.action, 'added');
    }
    assert.equal(harness.repo.size(), 5);

    server.setAvailable(true);
    harness.context.navigator.onLine = true;
    harness.context.dispatch('online');
    await harness.service.syncUserProgress();

    const committedIds = new Set(server.state.visits.map(visit => visit.id));
    assert.equal(server.state.visits.length, 5);
    assert.equal(originalVisits.every(visit => committedIds.has(visit.id)), true);
    assert.equal(additions.filter(visit => committedIds.has(visit.id)).length, 1);
    assert.equal(harness.repo.size(), 5);
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(storage.has('bark.unconfirmedVisits.bulk-user'), false);
});
