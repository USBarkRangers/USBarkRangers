const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, getDoc, runTransaction, setDoc } = require('firebase/firestore');

const ROOT = path.resolve(__dirname, '../..');
const RULES_PATH = path.join(ROOT, '06-config/firestore.rules');
const PROJECT_ID = 'demo-bark-bulk-removal-rules-test';
const UID = 'bulk-premium-user';
let testEnv;

function makeVisits(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `rule-park-${index}`,
        name: `Rule Park ${index}`,
        verified: false,
        ts: index + 1
    }));
}

function createCompatAdapter(nativeDb, transactionCount) {
    function wrapRef(nativeRef) {
        return { nativeRef, path: nativeRef.path };
    }

    return {
        collection(name) {
            return {
                doc(id) {
                    return wrapRef(doc(nativeDb, name, id));
                }
            };
        },
        async runTransaction(callback) {
            transactionCount.value++;
            return runTransaction(nativeDb, nativeTransaction => callback({
                async get(ref) {
                    const snapshot = await nativeTransaction.get(ref.nativeRef);
                    return {
                        exists: snapshot.exists(),
                        data: () => snapshot.data()
                    };
                },
                set(ref, payload, options) {
                    // Values crossing out of the VM have a different Object
                    // prototype. Convert them to ordinary JSON records before
                    // handing them to the modular Firestore test client.
                    nativeTransaction.set(
                        ref.nativeRef,
                        JSON.parse(JSON.stringify(payload)),
                        options
                    );
                }
            }));
        }
    };
}

function loadAppService(nativeDb) {
    const storage = new Map();
    const handlers = new Map();
    const alerts = [];
    const transactionCount = { value: 0 };
    const compatDb = createCompatAdapter(nativeDb, transactionCount);
    const context = {
        console, Date, Map, Set, Promise, Math, Number, String, Boolean,
        Object, Array, JSON, RegExp, setTimeout, clearTimeout
    };
    context.window = context;
    context.global = context;
    context.navigator = { onLine: true };
    context.alert = message => alerts.push(String(message));
    context.confirm = () => true;
    context.addEventListener = (name, handler) => handlers.set(name, handler);
    context.syncState = () => {};
    context.localStorage = {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    };
    context.firebase = {
        auth: () => ({ currentUser: { uid: UID } }),
        firestore: () => compatDb
    };

    vm.createContext(context);
    [
        '01-code/app/repos/ParkRepo.js',
        '01-code/app/repos/VaultRepo.v141.js',
        '01-code/app/services/visitMutationCoordinator.v141.js',
        '01-code/app/services/firebaseService.v141.js'
    ].forEach(relativePath => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), context, { filename: relativePath });
    });
    context.BARK.incrementRequestCount = () => {};
    context.BARK.invalidateVisitedIdsCache = () => {};
    context.BARK.refreshCoordinator = {
        refreshVisitedCache() {},
        refreshVisitedVisuals() {}
    };
    context.BARK.renderManagePortal = () => {};

    return {
        alerts,
        repo: context.BARK.repos.VaultRepo,
        service: context.BARK.services.firebase,
        storage,
        transactionCount
    };
}

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8') }
    });
});

after(async () => {
    await testEnv.cleanup();
});

test('the real app bulk-removal path crosses the real Firestore rules in safe pairs', async () => {
    const visits = makeVisits(10);
    await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'users', UID), {
            entitlement: { premium: true, status: 'active' },
            visitedPlaces: visits
        });
    });

    const ownerDb = testEnv.authenticatedContext(UID).firestore();
    const harness = loadAppService(ownerDb);
    visits.forEach(visit => harness.repo.addVisit(visit));

    const removal = harness.service.removeVisitedEntries(
        visits.map(visit => ({ id: visit.id, record: visit }))
    );
    await removal.syncPromise;

    const snapshot = await getDoc(doc(ownerDb, 'users', UID));
    assert.equal(snapshot.exists(), true);
    assert.deepEqual(snapshot.data().visitedPlaces, []);
    assert.equal(harness.transactionCount.value, 5);
    assert.equal(harness.repo.size(), 0);
    assert.equal(harness.repo.snapshot().pending.size, 0);
    assert.equal(harness.storage.has(`bark.pendingVisitDeletes.${UID}`), false);
    assert.deepEqual(harness.alerts, []);
});
