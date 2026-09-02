const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadBrowserScripts() {
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
        clearTimeout
    };
    context.window = context;
    context.global = context;
    context.alert = () => {};
    context.confirm = () => true;
    context.localStorage = {
        getItem() { return null; },
        setItem() {}
    };

    vm.createContext(context);
    [
        '01-code/app/repos/ParkRepo.js',
        '01-code/app/repos/VaultRepo.v141.js',
        '01-code/app/services/visitMutationCoordinator.v141.js',
        '01-code/app/services/firebaseService.v141.js'
    ].forEach((relativePath) => {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    });

    context.window.BARK.invalidateVisitedIdsCache = () => {};
    context.window.BARK.__testContext = context;
    return context.window.BARK;
}

test('canonicalization refuses to collapse many visits into a few records', async () => {
    const bark = loadBrowserScripts();
    const { ParkRepo, VaultRepo } = bark.repos;
    const firebaseService = bark.services.firebase;

    ParkRepo.replaceAll([
        { id: 'canonical-a', name: 'Canonical A', lat: 10, lng: 20, state: 'AA' },
        { id: 'canonical-b', name: 'Canonical B', lat: 30, lng: 40, state: 'BB' }
    ]);

    for (let index = 0; index < 4; index++) {
        VaultRepo.addVisit({
            id: `legacy-a-${index}`,
            name: `Legacy A ${index}`,
            lat: 10,
            lng: 20,
            verified: true,
            ts: 1000 + index
        });
        VaultRepo.addVisit({
            id: `legacy-b-${index}`,
            name: `Legacy B ${index}`,
            lat: 30,
            lng: 40,
            verified: true,
            ts: 2000 + index
        });
    }

    await assert.rejects(
        () => firebaseService.normalizeLocalVisitedPlacesToCanonical({ writeBack: false }),
        /Refusing destructive visitedPlaces canonicalization/
    );

    assert.equal(VaultRepo.size(), 8, 'local visit records should be preserved after refused normalization');
    assert.equal(VaultRepo.hasVisit('legacy-a-0'), true);
    assert.equal(VaultRepo.hasVisit('legacy-b-0'), true);
});

test('visitedPlaces writes preserve server visits when local state has not hydrated yet', async () => {
    const bark = loadBrowserScripts();
    const { VaultRepo } = bark.repos;
    const firebaseService = bark.services.firebase;
    const serverVisits = [
        { id: 'server-a', name: 'Server A', verified: true, ts: 100 },
        { id: 'server-b', name: 'Server B', verified: false, ts: 200 }
    ];
    const localVisit = { id: 'local-new', name: 'Local New', verified: true, ts: 300 };
    let writtenVisitedPlaces = null;

    VaultRepo.clear();
    VaultRepo.addVisit(localVisit);
    VaultRepo.stageUpsert(localVisit);

    bark.__testContext.firebase = {
        auth() {
            return { currentUser: { uid: 'user-1' } };
        },
        firestore() {
            const userRef = {
                async get() {
                    return {
                        exists: true,
                        data() {
                            return { visitedPlaces: serverVisits };
                        }
                    };
                }
            };
            return {
                async runTransaction(callback) {
                    let stagedPayload = null;
                    await callback({
                        get: () => userRef.get(),
                        set(_ref, payload) {
                            stagedPayload = payload;
                        }
                    });
                    writtenVisitedPlaces = stagedPayload && stagedPayload.visitedPlaces;
                },
                collection(collectionName) {
                    assert.equal(collectionName, 'users');
                    return {
                        doc(uid) {
                            assert.equal(uid, 'user-1');
                            return userRef;
                        }
                    };
                }
            };
        }
    };
    bark.incrementRequestCount = () => {};

    await firebaseService.updateCurrentUserVisitedPlaces([localVisit]);

    assert.equal(writtenVisitedPlaces.length, 3);
    assert.deepEqual(
        writtenVisitedPlaces.map(visit => visit.id).sort(),
        ['local-new', 'server-a', 'server-b']
    );
    assert.equal(VaultRepo.size(), 3, 'local visit repo should rehydrate from the protected merged write');
    assert.deepEqual(
        VaultRepo.getVisits().map(visit => visit.id).sort(),
        ['local-new', 'server-a', 'server-b']
    );
});
