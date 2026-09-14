'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createExecutor } = require('../../commands/executor');
const handlers = require('../../profile/commands');
const { receiptID, ACCEPTANCE_WINDOW_MS } = require('../../commands/envelope');

// Refuse to use ADC against any real project. These synthetic access grants exist only in this test.
assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `profile-test-${randomUUID()}`);
const db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });

function fixture() {
    const uid = `profile-${randomUUID()}`;
    let now = Date.now();
    const reads = [];
    const trackedDB = {
        collection: path => db.collection(path),
        runTransaction: work => db.runTransaction(tx => work({
            get(ref) { reads.push(ref.path); return tx.get(ref); },
            getAll(...refs) { reads.push(...refs.map(ref => ref.path)); return tx.getAll(...refs); },
            create: tx.create.bind(tx), set: tx.set.bind(tx), update: tx.update.bind(tx),
        })),
    };
    const execute = createExecutor({ db: trackedDB, handlers, clock: () => now });
    const command = (kind, expectedRevision = 0, payload = {}) => ({ version: 1,
        operationID: randomUUID(), createdAtMs: now, kind, expectedRevision, payload });
    const user = db.collection('users').doc(uid);
    return { uid, user, reads, command, execute: input => execute(uid, input),
        advance(ms) { now += ms; },
        async purchaseFixture() {
            await user.collection('state').doc('entitlement').set({ schemaVersion: 1, revision: 2,
                premium: true, source: 'app-store-production', validUntil: Timestamp.fromMillis(now + 3600_000) });
        } };
}

test('bootstrap is durable, replay is exact, and free accounts cannot forge access', async () => {
    const f = fixture();
    const bootstrap = f.command('bootstrapAccount');
    const first = await f.execute(bootstrap);
    assert.equal(first.status, 'accepted');
    assert.equal((await f.user.get()).get('revision'), 1);
    assert.equal((await f.user.collection('state').doc('entitlement').get()).get('premium'), false);
    const edit = f.command('updateProfile', 1, { displayName: 'New name' });
    await assert.rejects(f.execute(edit), error => error.code === 'premium-required');
    await assert.rejects(f.execute({ ...edit, payload: { displayName: 'New name', premium: true } }));
    f.advance(ACCEPTANCE_WINDOW_MS + 1);
    f.reads.length = 0;
    assert.deepEqual(await f.execute(bootstrap), first);
    assert.deepEqual(f.reads, [`nativeOperationReceipts/${receiptID(f.uid, bootstrap.operationID)}`]);
    await assert.rejects(f.execute({ ...bootstrap, operationID: randomUUID() }), error => error.code === 'intent-expired');
    await assert.rejects(f.execute({ ...bootstrap, expectedRevision: 1 }), error => error.code === 'operation-reused');
});

test('profile edits touch bounded records and race through revisions, not history scans', async () => {
    const f = fixture();
    await f.execute(f.command('bootstrapAccount'));
    await f.purchaseFixture();
    const board = db.collection('leaderboard').doc(handlers.publicEntryID(f.uid));
    await board.set({ displayName: 'Ranger', score: 100 });
    await f.user.collection('visits').doc('untouched-history').set({ sentinel: true });
    f.reads.length = 0;
    const a = f.command('updateProfile', 1, { displayName: 'Ranger A' });
    const b = f.command('updateProfile', 1, { displayName: 'Ranger B' });
    const outcomes = await Promise.all([f.execute(a), f.execute(b)]);
    assert.deepEqual(outcomes.map(result => result.status).sort(), ['accepted', 'conflict']);
    assert.equal((await f.user.get()).get('revision'), 2);
    assert.equal((await board.get()).get('score'), 100);
    assert.equal((await board.get()).get('displayName'), (await f.user.get()).get('displayName'));
    assert.equal((await f.user.collection('visits').doc('untouched-history').get()).get('sentinel'), true);
    const allowed = new Set([f.user.path, `${f.user.path}/state/entitlement`, `${f.user.path}/commandLimits/profile`,
        board.path, `nativeOperationReceipts/${receiptID(f.uid, a.operationID)}`,
        `nativeOperationReceipts/${receiptID(f.uid, b.operationID)}`]);
    assert.ok(f.reads.every(path => allowed.has(path)));
    assert.deepEqual(await f.execute(a), outcomes[0]);
    assert.deepEqual(await f.execute(b), outcomes[1]);
});

test('account deletion blocks new work; distinct account receipts cannot authorize another user', async () => {
    const f = fixture();
    const other = fixture();
    const sameEnvelope = f.command('bootstrapAccount');
    await f.execute(sameEnvelope);
    await other.execute(sameEnvelope);
    assert.equal((await other.user.get()).exists, true);
    await f.purchaseFixture();
    await f.user.update({ status: 'deleting' });
    await assert.rejects(f.execute(f.command('updateMapStyle', 1, { mapStyle: 'satellite' })),
        error => error.code === 'account-deleting');
    assert.equal((await f.user.get()).get('mapStyle'), 'default');
});
