const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createSharedTransactionalFirestore(initialVisits = []) {
    let serverVisits = initialVisits.map(visit => ({ ...visit }));
    let version = 0;
    let firstRoundReads = 0;
    let releaseFirstRound;
    const firstRoundBarrier = new Promise(resolve => { releaseFirstRound = resolve; });
    let retryCount = 0;

    const userRef = { path: 'users/shared-user' };
    const db = {
        collection() {
            return { doc: () => userRef };
        },
        async runTransaction(callback) {
            let attempt = 0;
            while (attempt < 5) {
                attempt++;
                let readVersion = null;
                let stagedVisits = null;
                await callback({
                    async get() {
                        readVersion = version;
                        const snapshotVisits = serverVisits.map(visit => ({ ...visit }));
                        if (attempt === 1) {
                            firstRoundReads++;
                            if (firstRoundReads === 2) releaseFirstRound();
                            await firstRoundBarrier;
                        }
                        return {
                            exists: true,
                            data: () => ({ visitedPlaces: snapshotVisits })
                        };
                    },
                    set(_ref, payload) {
                        stagedVisits = payload.visitedPlaces.map(visit => ({ ...visit }));
                    }
                });

                if (readVersion !== version) {
                    retryCount++;
                    continue;
                }
                serverVisits = stagedVisits;
                version++;
                return;
            }
            throw new Error('transaction retry budget exhausted');
        }
    };

    return {
        db,
        getVisits: () => serverVisits.map(visit => ({ ...visit })),
        getRetryCount: () => retryCount
    };
}

function loadDevice(sharedDb, localVisit) {
    const storage = new Map();
    const context = {
        console, Date, Map, Set, Promise, Math, Number, String, Boolean,
        Object, Array, JSON, RegExp, setTimeout, clearTimeout
    };
    context.window = context;
    context.global = context;
    context.alert = () => {};
    context.confirm = () => true;
    context.localStorage = {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    };
    context.firebase = {
        auth: () => ({ currentUser: { uid: 'shared-user' } }),
        firestore: () => sharedDb
    };

    vm.createContext(context);
    [
        '01-code/app/repos/ParkRepo.js',
        '01-code/app/repos/VaultRepo.js',
        '01-code/app/services/firebaseService.js'
    ].forEach(relativePath => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), context, { filename: relativePath });
    });

    context.BARK.incrementRequestCount = () => {};
    context.BARK.invalidateVisitedIdsCache = () => {};
    const repo = context.BARK.repos.VaultRepo;
    repo.addVisit(localVisit);
    repo.stageUpsert(localVisit);
    return context.BARK.services.firebase;
}

test('simultaneous visit writes from two devices preserve both visits through transaction retry', async () => {
    const baseline = { id: 'baseline', name: 'Baseline', verified: true, ts: 1 };
    const deviceAVisit = { id: 'device-a', name: 'Device A', verified: true, ts: 2, syncToken: 'a-token' };
    const deviceBVisit = { id: 'device-b', name: 'Device B', verified: true, ts: 3, syncToken: 'b-token' };
    const shared = createSharedTransactionalFirestore([baseline]);
    const deviceA = loadDevice(shared.db, deviceAVisit);
    const deviceB = loadDevice(shared.db, deviceBVisit);

    await Promise.all([
        deviceA.updateCurrentUserVisitedPlaces([deviceAVisit]),
        deviceB.updateCurrentUserVisitedPlaces([deviceBVisit])
    ]);

    assert.equal(shared.getRetryCount() >= 1, true, 'the collision must exercise an actual transaction retry');
    assert.deepEqual(
        shared.getVisits().map(visit => visit.id).sort(),
        ['baseline', 'device-a', 'device-b']
    );
});
