const { test } = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// Regression coverage for the bug-#1 fix: when renderEngine failed to load,
// window.syncState is undefined. removeVisitedPlace/updateVisitDate used to call
// it unguarded AFTER the server write, so the throw hit the catch and rolled the
// vault back — resurrecting a visit that was already deleted on the server. The
// fix guards the syncState calls and makes the rollback commit-aware (only roll
// back when the server write itself failed).

function loadBark({ failWrite = false, failCode = 'unavailable' } = {}) {
    let shouldFailWrite = failWrite;
    const eventHandlers = new Map();
    const context = {
        console, Date, Map, Set, Promise, Math, Number, String, Boolean,
        Object, Array, JSON, RegExp, setTimeout, clearTimeout
    };
    context.window = context;
    context.global = context;
    context.alert = () => {};
    context.confirm = () => true;
    context.addEventListener = (name, handler) => eventHandlers.set(name, handler);

    const userDoc = {
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async () => { if (failWrite) throw Object.assign(new Error('write failed'), { code: 'unavailable' }); },
        update: async () => { if (shouldFailWrite) throw Object.assign(new Error('write failed'), { code: failCode }); }
    };
    const db = {
        collection: () => ({ doc: () => userDoc }),
        async runTransaction(callback) {
            let stagedPayload = null;
            await callback({
                get: () => userDoc.get(),
                set(_ref, payload) {
                    stagedPayload = payload;
                }
            });
            if (stagedPayload) await userDoc.update(stagedPayload);
        }
    };
    context.firebase = {
        auth: () => ({ currentUser: { uid: 'user-1' } }),
        firestore: () => db
    };

    vm.createContext(context);
    const storage = new Map();
    context.localStorage = {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    };

    ['01-code/app/repos/ParkRepo.js', '01-code/app/repos/VaultRepo.v141.js', '01-code/app/services/visitMutationCoordinator.v141.js', '01-code/app/services/firebaseService.v141.js']
        .forEach(rel => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), context, { filename: rel }));

    context.window.BARK.incrementRequestCount = () => {};
    context.window.BARK.invalidateVisitedIdsCache = () => {};
    context.window.__restoreWrites = () => {
        shouldFailWrite = false;
        const onlineHandler = eventHandlers.get('online');
        if (onlineHandler) onlineHandler();
    };
    return context.window;
}

const VISIT = { id: 'park-1', name: 'Test Park', lat: 12.34, lng: -56.78, verified: true, ts: 1000 };

function seed(win) {
    const vaultRepo = win.BARK.repos.VaultRepo;
    vaultRepo.clear();
    vaultRepo.addVisit(VISIT);
    assert.equal(vaultRepo.hasVisit('park-1'), true, 'precondition: visit present');
    return vaultRepo;
}

test('removeVisitedPlace: undefined syncState (renderEngine missing) does not roll back a committed delete', async () => {
    const win = loadBark();
    const vaultRepo = seed(win);
    win.syncState = undefined; // simulate renderEngine.js not loaded

    const result = await win.BARK.services.firebase.removeVisitedPlace('park-1'); // must not throw
    await result.syncPromise;
    assert.equal(vaultRepo.hasVisit('park-1'), false,
        'committed delete must survive an undefined syncState');
});

test('removeVisitedPlace: a render failure does not interrupt or resurrect the deletion', async () => {
    const win = loadBark();
    const vaultRepo = seed(win);
    win.syncState = undefined;
    win.BARK.renderManagePortal = () => { throw new Error('render blew up'); };

    const result = await win.BARK.services.firebase.removeVisitedPlace('park-1');
    await result.syncPromise;
    assert.equal(vaultRepo.hasVisit('park-1'), false,
        'a post-write render failure must not roll back the committed delete');
});

test('removeVisitedPlace: an offline write remains deleted locally and queued for recovery', async () => {
    const win = loadBark({ failWrite: true });
    const vaultRepo = seed(win);
    win.syncState = undefined;

    const result = await win.BARK.services.firebase.removeVisitedPlace('park-1');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(result.syncStatus, 'pending');
    assert.equal(vaultRepo.hasVisit('park-1'), false,
        'offline deletion must remain applied while its durable retry is pending');
    assert.notEqual(win.localStorage.getItem('bark.pendingVisitDeletes.user-1'), null);
    win.__restoreWrites();
    await result.syncPromise;
    assert.equal(win.localStorage.getItem('bark.pendingVisitDeletes.user-1'), null);
});

test('removeVisitedPlace: a permission failure preserves the durable orange removal', async () => {
    const win = loadBark({ failWrite: true, failCode: 'permission-denied' });
    const vaultRepo = seed(win);

    const result = await win.BARK.services.firebase.removeVisitedPlace('park-1');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(vaultRepo.hasVisit('park-1'), false);
    assert.equal(vaultRepo.getPendingMutationType('park-1'), 'delete');
    assert.notEqual(win.localStorage.getItem('bark.pendingVisitDeletes.user-1'), null);
    win.__restoreWrites();
    await result.syncPromise;
    assert.equal(vaultRepo.getPendingMutationType('park-1'), null);
    assert.equal(win.localStorage.getItem('bark.pendingVisitDeletes.user-1'), null);
});

test('post-commit account switch skips stale-account reconciliation and UI side effects', async () => {
    const win = loadBark();
    let activeUid = 'user-1';
    win.firebase.auth = () => ({
        currentUser: activeUid ? { uid: activeUid } : null
    });

    const vaultRepo = seed(win);
    const checkinCalls = [];
    const markerRefreshes = [];
    let syncStateCalls = 0;
    win.BARK.services.checkin = {
        reconcileUnconfirmedVisits(uid) {
            checkinCalls.push({ type: 'reconcile', uid, activeUid });
        },
        notifyAuthoritativeSnapshot() {
            checkinCalls.push({ type: 'notify', activeUid });
        }
    };
    win.BARK.refreshCoordinator = {
        refreshVisitedCache() {},
        refreshVisitedVisuals(reason) {
            markerRefreshes.push({ reason, activeUid });
        }
    };
    win.syncState = () => { syncStateCalls++; };

    let markFirstStepStarted;
    const firstStepStarted = new Promise(resolve => { markFirstStepStarted = resolve; });
    let releaseFirstStep;
    const firstStepRelease = new Promise(resolve => { releaseFirstStep = resolve; });
    const vaultReconcileUids = [];
    const originalReconcileSnapshot = vaultRepo.reconcileSnapshot;
    vaultRepo.reconcileSnapshot = (...args) => {
        vaultReconcileUids.push(activeUid);
        const result = originalReconcileSnapshot(...args);
        markFirstStepStarted();
        return firstStepRelease.then(() => result);
    };

    const removal = await win.BARK.services.firebase.removeVisitedPlace(VISIT.id);
    await firstStepStarted;

    activeUid = 'user-2';
    vaultRepo.clear();
    const accountBVisit = {
        id: 'account-b-park',
        name: 'Account B Park',
        lat: 1,
        lng: 2,
        verified: false,
        ts: 2000,
        syncToken: 'account-b-token'
    };
    vaultRepo.addVisit(accountBVisit);
    vaultRepo.stageUpsert(accountBVisit);
    const accountBRevision = vaultRepo.getRevision();
    const markerCountAtSwitch = markerRefreshes.length;
    const syncStateCountAtSwitch = syncStateCalls;

    releaseFirstStep();
    await removal.syncPromise;

    const accountABaseline = JSON.parse(
        win.localStorage.getItem('bark.authoritativeVisits.user-1')
    );
    assert.deepEqual(accountABaseline.visits, [], 'the committed A baseline remains account-scoped');
    assert.equal(
        win.localStorage.getItem('bark.pendingVisitDeletes.user-1'),
        null,
        'A delete acknowledgement may finish after the account switch'
    );
    assert.deepEqual(vaultReconcileUids, ['user-1'], 'Vault reconciliation must run only while A is active');
    assert.deepEqual(checkinCalls, [], 'A pending additions and confirmations must not run under B');
    assert.equal(markerRefreshes.length, markerCountAtSwitch, 'A commit must not refresh B markers');
    assert.equal(syncStateCalls, syncStateCountAtSwitch, 'A commit must not refresh B screen state');
    assert.equal(vaultRepo.getRevision(), accountBRevision, 'A commit must not mutate B Vault state');
    assert.equal(vaultRepo.getVisit(accountBVisit.id).syncToken, accountBVisit.syncToken);
    assert.equal(vaultRepo.getPendingMutationType(accountBVisit.id), 'upsert');
});
