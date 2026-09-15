'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createDeletionService, DELETION_FENCE_MS } = require('../../accounts/deletion');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount, publicEntryID } = require('../../profile/commands');
const { createCommandCallable, IOS_APP_ID } = require('../../runtime/callable');
const { createLeaderboardReader } = require('../../reads/leaderboard');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
const app = initializeApp({ projectId: 'demo-bark-native' }, `deletion-${randomUUID()}`);
// A fresh emulator database isolates this worker's queue from concurrently running UI fixtures.
const db = getFirestore(app, `native-deletion-tests-${randomUUID()}`), auth = getAuth(app);
after(async () => { await db.terminate(); await deleteApp(app); });
const command = () => ({ version: 1, operationID: randomUUID(), createdAtMs: Date.now(),
    kind: 'bootstrapAccount', expectedRevision: 0, payload: {} });

async function fixture() {
    const uid = `deletion-${randomUUID()}`;
    await auth.createUser({ uid, email: `${uid}@native.invalid`, password: 'SyntheticOnly123!' });
    await createExecutor({ db, handlers: { bootstrapAccount } })(uid, command());
    return { uid, user: db.collection('users').doc(uid), context: { authTime: Math.floor(Date.now() / 1000) } };
}

test('deletion requires server-token recent authentication and explicit confirmation, never a payload UID', async () => {
    const f = await fixture(), service = createDeletionService({ db, auth });
    const input = { version: 1, confirmed: true };
    for (const context of [null, {}, { authTime: 0 }, { authTime: Date.now() }, { authTime: Math.floor(Date.now() / 1000) - 301 }]) {
        await assert.rejects(service.request(f.uid, input, context), e => e.code === 'recent-auth-required');
    }
    await assert.rejects(service.request(f.uid, { ...input, uid: 'other' }, f.context), e => e.code === 'invalid');
    await assert.rejects(service.request(f.uid, { version: 1, confirmed: false }, f.context), e => e.code === 'invalid');
    const callable = createCommandCallable({ runtime: { emulator: false, projectID: 'bark-ranger-ios' }, execute: service.request });
    await assert.rejects(callable({ data: input, rawRequest: { rawBody: Buffer.from('{}') },
        app: { appId: IOS_APP_ID }, auth: { uid: f.uid, token: { aud: 'bark-ranger-ios',
            iss: 'https://securetoken.google.com/bark-ranger-ios', firebase: { sign_in_provider: 'password' }, auth_time: 0 } } }),
    e => e.details.reason === 'recent-auth-required');
    assert.equal((await f.user.get()).get('status'), 'active');
    assert.equal((await db.collection('nativeAccountDeletions').doc(f.uid).get()).exists, false);
});

test('resumable deletion removes nested records, paged receipts and leaderboard but preserves other owners', async () => {
    const f = await fixture(), other = await fixture();
    const batch = db.batch();
    for (let i = 0; i < 405; i++) batch.set(db.collection('nativeOperationReceipts').doc(`delete-${f.uid}-${i}`), { uid: f.uid });
    batch.set(f.user.collection('trips').doc('a').collection('content').doc('itinerary'), { private: true });
    for (const name of ['notes', 'places', 'visits', 'activities', 'activityClaims', 'activityIntervals',
        'completedTrails', 'readLimits', 'commandLimits', 'leaderboardCache', 'purchases', 'futureJournal']) {
        batch.set(f.user.collection(name).doc('private'), { private: true });
    }
    batch.set(db.collection('leaderboard').doc(publicEntryID(f.uid)), { totalPoints: 5 });
    await batch.commit();
    const appleOwners = db.batch();
    for (let i = 0; i < 405; i++) appleOwners.set(db.collection('nativeAppleOwners').doc(`${f.uid}-${i}`), {uid:f.uid});
    appleOwners.set(db.collection('nativeAppleOwners').doc(other.uid), {uid:other.uid});
    await appleOwners.commit();
    let now = Date.now(), fail = true;
    const tracked = { collection: p => db.collection(p), runTransaction: work => db.runTransaction(work), batch: () => db.batch(),
        async recursiveDelete(ref) { if (fail) { fail = false; throw new Error('Injected interruption after Auth deletion'); } return db.recursiveDelete(ref); } };
    const service = createDeletionService({ db: tracked, auth, clock: () => now });
    const input = { version: 1, confirmed: true };
    assert.deepEqual(await service.request(f.uid, input, f.context), { version: 1, status: 'accepted' });
    assert.deepEqual(await service.request(f.uid, input, f.context), { version: 1, status: 'accepted' });
    const job = db.collection('nativeAccountDeletions').doc(f.uid);
    assert.equal((await job.get()).get('expiresAt'), undefined);
    assert.equal((await f.user.get()).get('status'), 'deleting');
    await assert.rejects(service.runNext(), /Injected interruption/);
    await assert.rejects(auth.getUser(f.uid), e => e.code === 'auth/user-not-found');
    assert.equal((await job.get()).get('status'), 'pending');
    now += 61_000;
    assert.equal(await service.runNext(), true);
    assert.equal((await f.user.get()).exists, false);
    assert.deepEqual(await f.user.listCollections(), []);
    assert.equal((await db.collection('nativeOperationReceipts').where('uid', '==', f.uid).get()).empty, true);
    assert.equal((await db.collection('nativeAppleOwners').where('uid', '==', f.uid).get()).empty, true);
    assert.equal((await db.collection('nativeAppleOwners').doc(other.uid).get()).get('uid'),other.uid);
    assert.equal((await db.collection('leaderboard').doc(publicEntryID(f.uid)).get()).exists, false);
    assert.equal((await other.user.get()).get('status'), 'active');
    assert.equal((await auth.getUser(other.uid)).uid, other.uid);
    const fence = await job.get();
    assert.equal(fence.get('status'), 'complete');
    assert.equal(fence.get('expiresAt').toMillis(), now + DELETION_FENCE_MS);
    assert.equal(fence.get('nextAttemptAt'), undefined);
    await assert.rejects(createExecutor({ db, handlers: { bootstrapAccount } })(f.uid, command()), e => e.code === 'account-deleting');
    assert.equal(await service.runNext(), false);
});

test('in-flight standings cannot recreate cache after account deletion starts', async () => {
    const f = await fixture(), service = createDeletionService({ db, auth });
    const board = db.collection('leaderboard');
    for (let i = 0; i < 5; i++) await board.doc(publicEntryID(`deletion-leader-${i}`)).set({ schemaVersion: 1, totalPoints: 999999 + i, displayName: 'Synthetic' });
    await board.doc(publicEntryID(f.uid)).set({ schemaVersion: 1, totalPoints: 1, displayName: 'Synthetic owner' });
    const tracked = { collection: p => db.collection(p), getAll: (...refs) => db.getAll(...refs),
        async runTransaction(work) {
            await service.request(f.uid, { version: 1, confirmed: true }, f.context);
            await service.runNext();
            return db.runTransaction(work);
        } };
    const result = await createLeaderboardReader(tracked)(f.uid);
    assert.equal(result.entries.length, 5);
    assert.equal(result.standingUnavailable, true);
    assert.equal((await f.user.collection('leaderboardCache').doc('standing').get()).exists, false);
    assert.deepEqual(await f.user.listCollections(), []);
});
