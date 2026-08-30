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
    let releaseCommit = null;
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
        }
    };

    return {
        db,
        state,
        setAvailable(value) { available = value; },
        setEntitlement(value) { entitlement = value; },
        failNext(error) { queuedFailures.push(error); },
        holdOneCommit() { holdNextCommit = true; },
        releaseCommit() { if (releaseCommit) releaseCommit(); }
    };
}

function loadHarness(server, storage = new Map(), { loadCheckin = false, premium = true } = {}) {
    const handlers = new Map();
    const alerts = [];
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
        auth: () => ({ currentUser: { uid: 'bulk-user' } }),
        firestore: () => server.db
    };
    server.setEntitlement(premium ? { premium: true, status: 'active' } : { premium: false, status: 'inactive' });

    vm.createContext(context);
    const scripts = [
        '01-code/app/repos/ParkRepo.js',
        '01-code/app/repos/VaultRepo.js',
        '01-code/app/services/visitMutationCoordinator.js',
        '01-code/app/services/firebaseService.js'
    ];
    if (loadCheckin) scripts.push('01-code/app/services/checkinService.js');
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
    return { context, storage, alerts, repo: context.BARK.repos.VaultRepo, service: context.BARK.services.firebase };
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
