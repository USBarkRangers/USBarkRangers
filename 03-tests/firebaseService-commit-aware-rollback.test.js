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

function loadBark({ failWrite = false } = {}) {
    const context = {
        console, Date, Map, Set, Promise, Math, Number, String, Boolean,
        Object, Array, JSON, RegExp, setTimeout, clearTimeout
    };
    context.window = context;
    context.global = context;
    context.alert = () => {};
    context.confirm = () => true;

    const userDoc = {
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async () => { if (failWrite) throw Object.assign(new Error('write failed'), { code: 'unavailable' }); },
        update: async () => { if (failWrite) throw Object.assign(new Error('write failed'), { code: 'unavailable' }); }
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
    ['01-code/app/repos/ParkRepo.js', '01-code/app/repos/VaultRepo.js', '01-code/app/services/firebaseService.js']
        .forEach(rel => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), context, { filename: rel }));

    context.window.BARK.incrementRequestCount = () => {};
    context.window.BARK.invalidateVisitedIdsCache = () => {};
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

    await win.BARK.services.firebase.removeVisitedPlace('park-1'); // must not throw
    assert.equal(vaultRepo.hasVisit('park-1'), false,
        'committed delete must survive an undefined syncState');
});

test('removeVisitedPlace: a post-write render failure does not resurrect the deleted visit', async () => {
    const win = loadBark();
    const vaultRepo = seed(win);
    win.syncState = undefined;
    win.BARK.renderManagePortal = () => { throw new Error('render blew up'); };

    await assert.rejects(() => win.BARK.services.firebase.removeVisitedPlace('park-1'));
    assert.equal(vaultRepo.hasVisit('park-1'), false,
        'a post-write render failure must not roll back the committed delete');
});

test('removeVisitedPlace: a genuine server write failure still rolls the visit back', async () => {
    const win = loadBark({ failWrite: true });
    const vaultRepo = seed(win);
    win.syncState = undefined;

    await assert.rejects(() => win.BARK.services.firebase.removeVisitedPlace('park-1'));
    assert.equal(vaultRepo.hasVisit('park-1'), true,
        'a real write failure must still roll back (recovery preserved)');
});
