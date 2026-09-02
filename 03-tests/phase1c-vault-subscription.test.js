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
        fs.readFileSync(path.join(ROOT, '01-code', 'app', 'repos/VaultRepo.v141.js'), 'utf8'),
        context,
        { filename: 'repos/VaultRepo.v141.js' }
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
        // Production persists and read-verifies the complete authoritative
        // baseline before a server snapshot may clear pending state.
        rememberAuthoritativeVisitIds() { return true; },
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

function testUnchangedSnapshotSkipsDerivedRefreshWork() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';
    const calls = { invalidate: 0, refresh: 0, normalize: 0, onChange: 0 };
    const visit = { id: 'steady', name: 'Steady Visit', ts: 5 };

    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid, {
        invalidateVisitedIdsCache() { calls.invalidate++; },
        refreshVisitedVisualState() { calls.refresh++; },
        normalizeLocalVisitedPlacesToCanonical() { calls.normalize++; },
        onChange() { calls.onChange++; }
    }));

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [visit] }));
    const revisionAfterHydration = vaultRepo.getRevision();
    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [{ ...visit }] }));

    assert.equal(vaultRepo.getRevision(), revisionAfterHydration, 'no-op snapshots must not advance the vault revision');
    assert.deepEqual(calls, {
        invalidate: 1,
        refresh: 1,
        normalize: 1,
        onChange: 2
    });
}

function testConfirmationRefreshesOnlyPendingState() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';
    const visit = { id: 'pending-confirmation', name: 'Pending Confirmation', ts: 6 };
    let invalidateCount = 0;
    let normalizeCount = 0;
    const visualChanges = [];

    vaultRepo.addVisit(visit);
    vaultRepo.stageUpsert(visit);
    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid, {
        invalidateVisitedIdsCache() { invalidateCount++; },
        refreshVisitedVisualState(change) { visualChanges.push(change); },
        normalizeLocalVisitedPlacesToCanonical() { normalizeCount++; }
    }));

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [] }, {
        fromCache: true,
        hasPendingWrites: false
    }));
    assertPending(vaultRepo, visit.id, true);
    assert.equal(visualChanges.length, 0, 'cached snapshots must not confirm or repaint the pending visit');

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [visit] }, {
        fromCache: false,
        hasPendingWrites: false
    }));

    assertPending(vaultRepo, visit.id, false);
    assert.equal(invalidateCount, 0, 'confirmation does not change visited membership');
    assert.equal(normalizeCount, 0, 'confirmation alone should not rerun canonical migration');
    assert.equal(visualChanges.length, 1);
    assert.equal(visualChanges[0].recordsChanged, false);
    assert.equal(visualChanges[0].pendingChanged.has(visit.id), true);
}

function testAuthoritativeVisitMemoryReceivesServerRecordsWithoutPendingOverlay() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';
    const remembered = [];
    const pendingVisit = { id: 'pending-local', name: 'Pending Local', ts: 10 };
    const serverVisit = { id: 'server-confirmed', name: 'Server Confirmed', ts: 9 };

    vaultRepo.addVisit(pendingVisit);
    vaultRepo.stageUpsert(pendingVisit);
    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid, {
        rememberAuthoritativeVisitIds(uid, visits) {
            remembered.push({ uid, ids: visits.map(visit => visit.id) });
        }
    }));

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [serverVisit] }, {
        fromCache: true,
        hasPendingWrites: false
    }));
    assert.deepEqual(remembered, [], 'cached data must not replace the last confirmed limit baseline');

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [serverVisit] }, {
        fromCache: false,
        hasPendingWrites: false
    }));
    assert.deepEqual(remembered, [{ uid: 'A', ids: ['server-confirmed'] }]);
    assert.equal(vaultRepo.hasVisit(pendingVisit.id), true, 'the local orange overlay remains independent');
}

function testCachedSnapshotsMergeOnlyBeforeAuthority() {
    const vaultRepo = loadVaultRepo();
    const localVisit = { id: 'local-existing', name: 'Newer Local Record', ts: 20 };
    const cachedOverwrite = { id: localVisit.id, name: 'Older Cached Record', ts: 10 };
    const cachedOnly = { id: 'cached-only', name: 'Cached Only', ts: 11 };
    const persistedOnly = { id: 'persisted-only', name: 'Persisted Only', ts: 9 };

    vaultRepo.addVisit(localVisit);
    vaultRepo.reconcileSnapshot([cachedOverwrite, cachedOnly], {
        fromCache: true,
        hasPendingWrites: false
    });

    assert.deepEqual(
        { ...vaultRepo.getVisit(localVisit.id) },
        localVisit,
        'pre-authority cache must not overwrite an existing runtime record'
    );
    assert.deepEqual(
        { ...vaultRepo.getVisit(cachedOnly.id) },
        cachedOnly,
        'pre-authority cache may hydrate a record missing from runtime state'
    );

    vaultRepo.reconcileSnapshot([cachedOverwrite, persistedOnly], {
        persistedBaseline: true
    });
    assert.deepEqual(
        { ...vaultRepo.getVisit(localVisit.id) },
        cachedOverwrite,
        'the durable server baseline must replace an unproven cached/runtime record'
    );
    assert.equal(
        vaultRepo.hasVisit(cachedOnly.id),
        false,
        'the complete durable baseline must remove an unproven cached-only record'
    );
    assert.deepEqual(
        { ...vaultRepo.getVisit(persistedOnly.id) },
        persistedOnly,
        'a historical baseline may still hydrate records missing from runtime state'
    );

    vaultRepo.reconcileSnapshot([], {
        fromCache: true,
        hasPendingWrites: false
    });
    assert.equal(vaultRepo.hasVisit(localVisit.id), true, 'pre-authority cache must not remove runtime records');
    assert.equal(vaultRepo.hasVisit(cachedOnly.id), false, 'discarded cached-only data must stay discarded');
    assert.equal(vaultRepo.hasVisit(persistedOnly.id), true, 'trusted baseline records must survive late cache');
}

function testNonAuthoritativeSnapshotsCannotRegressTrustedBaseline() {
    const vaultRepo = loadVaultRepo();
    const kept = { id: 'trusted-kept', name: 'Trusted Current', ts: 30 };
    const removed = { id: 'trusted-deleted', name: 'Deleted On Server', ts: 29 };
    const staleOverwrite = { id: kept.id, name: 'Stale Cached Value', ts: 1 };
    const staleResurrection = { ...removed };

    vaultRepo.reconcileSnapshot([kept, removed], {
        fromCache: false,
        hasPendingWrites: false
    });
    vaultRepo.reconcileSnapshot([kept], {
        fromCache: false,
        hasPendingWrites: false
    });

    vaultRepo.reconcileSnapshot([staleOverwrite, staleResurrection], {
        fromCache: true,
        hasPendingWrites: false
    });
    assert.deepEqual(
        { ...vaultRepo.getVisit(kept.id) },
        kept,
        'cached snapshots must not overwrite an authoritative record'
    );
    assert.equal(
        vaultRepo.hasVisit(removed.id),
        false,
        'cached snapshots must not resurrect a server-deleted record'
    );

    vaultRepo.reconcileSnapshot([staleOverwrite, staleResurrection], {
        fromCache: false,
        hasPendingWrites: true
    });
    assert.deepEqual({ ...vaultRepo.getVisit(kept.id) }, kept);
    assert.equal(
        vaultRepo.hasVisit(removed.id),
        false,
        'latency-compensated snapshots must not overwrite or resurrect authoritative records'
    );

    vaultRepo.reconcileSnapshot([], {
        persistedBaseline: true
    });
    assert.deepEqual(
        vaultRepo.getVisits().map(visit => visit.id),
        [kept.id],
        'late persisted hydration must not replace a fresher authoritative baseline'
    );
}

function testPersistedBaselineDoesNotConfirmPendingMutations() {
    const vaultRepo = loadVaultRepo();
    const pendingAdd = { id: 'persisted-pending-add', name: 'Pending Add', ts: 40 };
    const pendingDelete = { id: 'persisted-pending-delete', name: 'Pending Delete', ts: 39 };

    vaultRepo.addVisit(pendingAdd);
    vaultRepo.stageUpsert(pendingAdd);
    vaultRepo.stageDelete(pendingDelete.id);
    vaultRepo.reconcileSnapshot([pendingAdd], {
        persistedBaseline: true
    });

    assert.equal(vaultRepo.hasVisit(pendingAdd.id), true);
    assertPending(vaultRepo, pendingAdd.id, true);
    assert.equal(
        vaultRepo.getPendingMutationType(pendingDelete.id),
        'delete',
        'persisted omission is historical and must not confirm a current deletion'
    );

    vaultRepo.reconcileSnapshot([{
        id: 'stale-after-persisted',
        name: 'Stale After Persisted',
        ts: 1
    }], {
        fromCache: true,
        hasPendingWrites: false
    });
    assert.equal(
        vaultRepo.hasVisit('stale-after-persisted'),
        false,
        'a persisted baseline must protect against later cached resurrection'
    );
    assertPending(vaultRepo, pendingAdd.id, true);
    assert.equal(vaultRepo.getPendingMutationType(pendingDelete.id), 'delete');

    vaultRepo.reconcileSnapshot([pendingAdd], {
        fromCache: false,
        hasPendingWrites: false
    });
    assertPending(vaultRepo, pendingAdd.id, false);
    assert.equal(
        vaultRepo.getPendingMutationType(pendingDelete.id),
        null,
        'only fresh authoritative omission may confirm the deletion'
    );
}

function testClearAndAccountSwitchResetTrustedBaseline() {
    const vaultRepo = loadVaultRepo();
    const trusted = { id: 'account-a-trusted', name: 'Account A', ts: 50 };
    const cachedAfterClear = { id: 'cached-after-clear', name: 'Cache After Clear', ts: 51 };

    vaultRepo.reconcileSnapshot([trusted], {
        fromCache: false,
        hasPendingWrites: false
    });
    vaultRepo.clear();
    vaultRepo.reconcileSnapshot([cachedAfterClear], {
        fromCache: true,
        hasPendingWrites: false
    });
    assert.equal(
        vaultRepo.hasVisit(cachedAfterClear.id),
        true,
        'clear must reset baseline ordering so a new account can hydrate from cache'
    );

    const fake = createFakeFirebase();
    let currentUid = 'A';
    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid));
    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [trusted] }, {
        fromCache: false,
        hasPendingWrites: false
    }));

    currentUid = 'B';
    vaultRepo.startSubscription('B', subscriptionOptions(fake, () => currentUid));
    fake.listeners[1].onNext(makeDoc(true, { visitedPlaces: [cachedAfterClear] }, {
        fromCache: true,
        hasPendingWrites: false
    }));

    assert.equal(vaultRepo.hasVisit(trusted.id), false, 'account switch must clear the previous baseline');
    assert.equal(
        vaultRepo.hasVisit(cachedAfterClear.id),
        true,
        'account switch must allow the new account cache to hydrate before authority'
    );
}

function testTargetedPendingUpsertConfirmationIsExactAndIsolated() {
    const vaultRepo = loadVaultRepo();
    const expected = {
        id: 'targeted-confirmation',
        name: 'Targeted Confirmation',
        ts: 60,
        syncToken: 'exact-token'
    };
    const unrelated = { id: 'unrelated-visit', name: 'Unrelated Visit', ts: 59 };
    const unrelatedPending = { id: 'unrelated-pending', name: 'Unrelated Pending', ts: 58 };
    const changes = [];
    vaultRepo.subscribe(change => changes.push(change));

    vaultRepo.addVisit(expected);
    vaultRepo.addVisit(unrelated);
    vaultRepo.addVisit(unrelatedPending);
    vaultRepo.stageUpsert(expected);
    vaultRepo.stageUpsert(unrelatedPending);
    const revisionBeforeMismatch = vaultRepo.getRevision();

    assert.equal(vaultRepo.confirmPendingUpsert({ ...expected, syncToken: 'wrong-token' }), false);
    assertPending(vaultRepo, expected.id, true);
    assert.equal(
        vaultRepo.getRevision(),
        revisionBeforeMismatch,
        'a mismatched proof must not change repository state'
    );

    const visitsBeforeConfirmation = vaultRepo.getVisits().map(visit => ({ ...visit }));
    const revisionBeforeConfirmation = vaultRepo.getRevision();
    assert.equal(vaultRepo.confirmPendingUpsert({ ...expected }), true);

    assertPending(vaultRepo, expected.id, false);
    assertPending(vaultRepo, unrelatedPending.id, true);
    assert.deepEqual(
        vaultRepo.getVisits().map(visit => ({ ...visit })),
        visitsBeforeConfirmation,
        'targeted confirmation must not replace or rewrite any visit record'
    );
    assert.equal(vaultRepo.getRevision(), revisionBeforeConfirmation + 1);

    const confirmationChange = changes.at(-1);
    assert.equal(confirmationChange.type, 'confirmPendingUpsert');
    assert.equal(confirmationChange.recordsChanged, false);
    assert.equal(confirmationChange.pendingChanged.has(expected.id), true);
    assert.equal(confirmationChange.pendingChanged.has(unrelatedPending.id), false);

    vaultRepo.stageDelete(unrelated.id);
    assert.equal(
        vaultRepo.confirmPendingUpsert(unrelated),
        false,
        'targeted upsert confirmation must not acknowledge a pending deletion'
    );
    assert.equal(vaultRepo.getPendingMutationType(unrelated.id), 'delete');
}

function testMissingMetadataCannotConfirmOrReplaceServerState() {
    const vaultRepo = loadVaultRepo();
    const trusted = { id: 'metadata-trusted', name: 'Trusted', ts: 70 };
    const pending = {
        id: 'metadata-pending',
        name: 'Pending',
        ts: 71,
        syncToken: 'metadata-token'
    };

    vaultRepo.reconcileSnapshot([trusted], {
        fromCache: false,
        hasPendingWrites: false
    });
    vaultRepo.addVisit(pending);
    vaultRepo.stageUpsert(pending);

    vaultRepo.reconcileSnapshot([pending], {});
    assert.equal(vaultRepo.hasVisit(trusted.id), true, 'missing metadata must not replace the trusted base');
    assertPending(vaultRepo, pending.id, true);

    vaultRepo.reconcileSnapshot([pending], {
        fromCache: false,
        hasPendingWrites: false
    });
    assert.equal(vaultRepo.hasVisit(trusted.id), false, 'explicit server metadata may replace the base');
    assertPending(vaultRepo, pending.id, false);
}

function testSubscriptionDocWithoutMetadataCannotConfirmPending() {
    const vaultRepo = loadVaultRepo();
    const fake = createFakeFirebase();
    let currentUid = 'A';
    const authoritativeSnapshots = [];
    const pendingVisit = {
        id: 'listener-metadata-pending',
        name: 'Listener Metadata Pending',
        ts: 72,
        syncToken: 'listener-metadata-token'
    };

    vaultRepo.addVisit(pendingVisit);
    vaultRepo.stageUpsert(pendingVisit);
    vaultRepo.startSubscription('A', subscriptionOptions(fake, () => currentUid, {
        rememberAuthoritativeVisitIds(uid, visits) {
            authoritativeSnapshots.push({ uid, ids: visits.map(visit => visit.id) });
            return true;
        }
    }));

    fake.listeners[0].onNext({
        exists: true,
        data() {
            return { visitedPlaces: [pendingVisit] };
        }
    });

    assertPending(vaultRepo, pendingVisit.id, true);
    assert.deepEqual(
        authoritativeSnapshots,
        [],
        'a raw listener document with missing metadata must not count as authoritative'
    );

    fake.listeners[0].onNext(makeDoc(true, { visitedPlaces: [pendingVisit] }, {
        fromCache: false,
        hasPendingWrites: false
    }));

    assertPending(vaultRepo, pendingVisit.id, false);
    assert.deepEqual(authoritativeSnapshots, [{
        uid: 'A',
        ids: [pendingVisit.id]
    }]);
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
    testUnchangedSnapshotSkipsDerivedRefreshWork();
    testConfirmationRefreshesOnlyPendingState();
    testAuthoritativeVisitMemoryReceivesServerRecordsWithoutPendingOverlay();
    testCachedSnapshotsMergeOnlyBeforeAuthority();
    testNonAuthoritativeSnapshotsCannotRegressTrustedBaseline();
    testPersistedBaselineDoesNotConfirmPendingMutations();
    testClearAndAccountSwitchResetTrustedBaseline();
    testTargetedPendingUpsertConfirmationIsExactAndIsolated();
    testMissingMetadataCannotConfirmOrReplaceServerState();
    testSubscriptionDocWithoutMetadataCannotConfirmPending();
    console.log('Phase 1C VaultRepo subscription tests passed.');
}

run();
