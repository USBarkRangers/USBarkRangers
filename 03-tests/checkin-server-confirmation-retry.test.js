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

    const result = await context.window.BARK.services.checkin.awaitServerConfirmation(visit.id, { retryMs: 10 });

    assert.equal(result && result.confirmed, true);
    assert.equal(serverReadCount >= 2, true, 'confirmation should wait for a retry with server data');
    assert.equal(
        context.window.BARK.repos.VaultRepo.snapshot().pending.has(visit.id),
        false,
        'server confirmation should clear the local pending mutation'
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
