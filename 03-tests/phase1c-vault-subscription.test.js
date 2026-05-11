const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadVaultRepo(consoleRef = console) {
    const context = {
        console: consoleRef,
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
        RegExp
    };
    context.window = context;
    context.global = context;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, '01-code', 'app', 'repos/VaultRepo.js'), 'utf8'),
        context,
        { filename: 'repos/VaultRepo.js' }
    );

    return context.window.BARK.repos.VaultRepo;
}

function createFakeFirebase() {
    const listeners = [];

    const firebase = {
        firestore() {
            return {
                collection(collectionName) {
                    assert.equal(collectionName, 'users');
                    return {
                        doc(uid) {
                            return {
                                onSnapshot(onNext, onError) {
                                    const listener = {
                                        uid,
                                        onNext,
                                        onError,
                                        unsubscribed: false,
                                        unsubscribeCount: 0
                                    };
                                    listeners.push(listener);
                                    return () => {
                                        listener.unsubscribed = true;
                                        listener.unsubscribeCount += 1;
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    return { firebase, listeners };
}

function makeDoc(exists, data = {}, metadata = {}) {
    return {
        exists,
        data() {
            return data;
        },
        metadata: {
            fromCache: metadata.fromCache === true,
            hasPendingWrites: metadata.hasPendingWrites === true
        }
    };
}

function subscriptionOptions(fake, getCurrentUid, extra = {}) {
    return {
        firebase: fake.firebase,
        getCurrentUid,
        ...extra
    };
}

function assertPending(vaultRepo, id, expected) {
    assert.equal(
        vaultRepo.snapshot().pending.has(id),
        expected,
        `Expected pending state for ${id} to be ${expected}`
    );
}

function testSameUidIdempotency() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';

    const first = vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));
    const second = vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(fake.listeners.length, 1, 'same uid should create only one listener');
    assert.equal(fake.listeners[0].unsubscribed, false);
}

function testDifferentUidReplacementAndStaleSnapshot() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';

    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));
    vaultRepo.addVisit({ id: 'old', name: 'Old Visit', ts: 1 });
    vaultRepo.stageUpsert({ id: 'old', name: 'Old Visit', ts: 1 });

    currentUid = 'B';
    vaultRepo.startSubscription('B', subscriptionOptions(fake, () => currentUid));

    assert.equal(fake.listeners.length, 2);
    assert.equal(fake.listeners[0].unsubscribed, true, 'old listener should be stopped');
    assert.equal(vaultRepo.size(), 0, 'uid switch should clear visit state');
    assert.equal(vaultRepo.snapshot().pending.size, 0, 'uid switch should clear pending mutations');

    fake.listeners[0].onNext(makeDoc(true, {
        visitedPlaces: [{ id: 'stale-a', name: 'A', ts: 1 }]
    }));
    assert.equal(vaultRepo.hasVisit('stale-a'), false, 'stale A snapshot must be ignored');

    fake.listeners[1].onNext(makeDoc(true, {
        visitedPlaces: [{ id: 'fresh-b', name: 'B', ts: 2 }]
    }));
    assert.equal(vaultRepo.hasVisit('fresh-b'), true, 'active B snapshot should hydrate');
}

function testMissingDocBecomesEmptyVisits() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';

    vaultRepo.addVisit({ id: 'existing', name: 'Existing', ts: 1 });
    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));
    fake.listeners[0].onNext(makeDoc(false));

    assert.equal(vaultRepo.size(), 0, 'missing user doc should hydrate empty visits');
}

function testCurrentUidMismatchIgnored() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'other-user';

    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));
    fake.listeners[0].onNext(makeDoc(true, {
        visitedPlaces: [{ id: 'wrong-user', name: 'Wrong User', ts: 1 }]
    }));

    assert.equal(vaultRepo.hasVisit('wrong-user'), false, 'current uid mismatch should ignore snapshot');

    currentUid = 'A';
    fake.listeners[0].onNext(makeDoc(true, {
        visitedPlaces: [{ id: 'right-user', name: 'Right User', ts: 2 }]
    }));

    assert.equal(vaultRepo.hasVisit('right-user'), true, 'matching current uid should hydrate snapshot');
}

function testErrorCallbackDoesNotClearLocalVisits() {
    const loggedErrors = [];
    const quietConsole = Object.create(console);
    quietConsole.error = (...args) => {
        loggedErrors.push(args);
    };
    const vaultRepo = loadVaultRepo(quietConsole);
    const fake = createFakeFirebase();
    let currentUid = 'A';
    let errorSeen = null;

    vaultRepo.addVisit({ id: 'local', name: 'Local Visit', ts: 1 });
    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid, {
        onError(error) {
            errorSeen = error;
        }
    }));

    const failure = new Error('forced listener failure');
    fake.listeners[0].onError(failure);

    assert.equal(errorSeen, failure);
    assert.equal(vaultRepo.hasVisit('local'), true, 'listener errors must not clear local visits');
    assert.equal(loggedErrors.length, 1, 'listener errors should be logged');
    assert.match(String(loggedErrors[0][0]), /\[VaultRepo\] visitedPlaces snapshot failed/);
}

function testStopWithoutClear() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';

    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));
    fake.listeners[0].onNext(makeDoc(true, {
        visitedPlaces: [{ id: 'persisted', name: 'Persisted', ts: 1 }]
    }));
    vaultRepo.stageUpsert({ id: 'pending', name: 'Pending', ts: 2 });

    vaultRepo.stopSubscription();

    assert.equal(fake.listeners[0].unsubscribed, true);
    assert.equal(vaultRepo.hasVisit('persisted'), true, 'stopSubscription should not clear visits');
    assertPending(vaultRepo, 'pending', true);
}

function testCachedSnapshotThenAuthoritativeConfirmation() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';
    const localVisit = { id: 'pending-upsert', name: 'Pending Upsert', ts: 3 };

    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));
    vaultRepo.addVisit(localVisit);
    vaultRepo.stageUpsert(localVisit);

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [] }, {
        fromCache: true,
        hasPendingWrites: false
    }));

    assert.equal(vaultRepo.hasVisit(localVisit.id), true, 'cached snapshot should preserve pending upsert');
    assertPending(vaultRepo, localVisit.id, true);

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [localVisit] }, {
        fromCache: false,
        hasPendingWrites: false
    }));

    assert.equal(vaultRepo.hasVisit(localVisit.id), true, 'authoritative snapshot should keep confirmed visit');
    assertPending(vaultRepo, localVisit.id, false);
}

function testOnChangeSeesReconciledState() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';
    let onChangeSawVisit = false;
    const callbackOrder = [];

    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid, {
        invalidateVisitedIdsCache() {
            callbackOrder.push('invalidate');
        },
        refreshVisitedVisualState() {
            callbackOrder.push('refresh');
        },
        normalizeLocalVisitedPlacesToCanonical() {
            callbackOrder.push('normalize');
        },
        onChange() {
            callbackOrder.push('onChange');
            onChangeSawVisit = vaultRepo.hasVisit('ordered');
        }
    }));

    fake.listeners[0].onNext(makeDoc(true, {
        visitedPlaces: [{ id: 'ordered', name: 'Ordered', ts: 4 }]
    }));

    assert.equal(onChangeSawVisit, true, 'onChange should run after repo reconciliation');
    assert.deepEqual(callbackOrder, ['invalidate', 'refresh', 'normalize', 'onChange']);
}

function run() {
    testSameUidIdempotency();
    testDifferentUidReplacementAndStaleSnapshot();
    testMissingDocBecomesEmptyVisits();
    testCurrentUidMismatchIgnored();
    testErrorCallbackDoesNotClearLocalVisits();
    testStopWithoutClear();
    testCachedSnapshotThenAuthoritativeConfirmation();
    testOnChangeSeesReconciledState();
    console.log('Phase 1C VaultRepo subscription tests passed.');
}

run();
