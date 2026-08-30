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
    let holdNextCommit = false;
    let releaseCommit = null;

    const db = {
        collection() {
            return { doc: uid => ({ path: `users/${uid}` }) };
        },
        async runTransaction(callback) {
            if (!available) throw Object.assign(new Error('offline'), { code: 'unavailable' });
            state.reads++;
            let staged = null;
            await callback({
                async get() {
                    return {
                        exists: true,
                        data: () => ({ visitedPlaces: state.visits.map(visit => ({ ...visit })) })
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
            state.visits = staged;
            state.version++;
            state.commits++;
        }
    };

    return {
        db,
        state,
        setAvailable(value) { available = value; },
        holdOneCommit() { holdNextCommit = true; },
        releaseCommit() { if (releaseCommit) releaseCommit(); }
    };
}

function loadHarness(server, storage = new Map(), { loadCheckin = false } = {}) {
    const handlers = new Map();
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
    context.alert = () => {};
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
    context.BARK.refreshCoordinator = {
        refreshVisitedCache() {},
        refreshVisitedVisuals() {}
    };
    context.BARK.renderManagePortal = () => {};
    context.dispatch = name => {
        const handler = handlers.get(name);
        if (handler) handler();
    };
    return { context, storage, repo: context.BARK.repos.VaultRepo, service: context.BARK.services.firebase };
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

test('50 rapid removals coalesce into one transaction without resurrecting visits', async () => {
    const visits = makeVisits(50);
    const server = makeServer(visits);
    const harness = loadHarness(server);
    seedRepo(harness.repo, visits);

    const removals = visits.map(visit => harness.service.removeVisitedEntries([{ id: visit.id, record: visit }]));
    await Promise.all(removals.map(result => result.syncPromise));

    assert.equal(server.state.commits, 1);
    assert.equal(server.state.visits.length, 0);
    assert.equal(harness.repo.size(), 0);
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(harness.storage.has('bark.pendingVisitDeletes.bulk-user'), false);
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

    assert.equal(server.state.commits, 2);
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
    assert.notEqual(storage.get('bark.pendingVisitDeletes.bulk-user'), undefined);
    assert.equal(sharedState.visits.length, 1, 'offline transaction must not pretend the server changed');

    const onlineServer = makeServer([], { state: sharedState, available: true });
    const reopened = loadHarness(onlineServer, storage);
    await reopened.service.replayPendingVisitDeletions('bulk-user');

    assert.equal(sharedState.visits.length, 0);
    assert.equal(storage.has('bark.pendingVisitDeletes.bulk-user'), false);
    assert.equal(reopened.repo.hasVisit(visit.id), false);

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
