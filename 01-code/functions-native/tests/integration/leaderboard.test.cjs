'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount, publicEntryID } = require('../../profile/commands');
const { createReadService } = require('../../reads/service');
const { createLeaderboardReader } = require('../../reads/leaderboard');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `board-${randomUUID()}`);
const db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });

test('five published leaders, shared-rank ties, owner-only standing and short rank-cache reuse', async t => {
    const uid = `board-${randomUUID()}`, user = db.collection('users').doc(uid);
    await createExecutor({ db, handlers: { bootstrapAccount } })(uid, { version: 1, operationID: randomUUID(),
        createdAtMs: Date.now(), kind: 'bootstrapAccount', expectedRevision: 0, payload: {} });
    const ids = [];
    async function seed(id, points) {
        ids.push(id);
        await db.collection('leaderboard').doc(id).set({ schemaVersion: 1, displayName: 'Synthetic ranger', totalPoints: points });
    }
    t.after(async () => {
        const batch = db.batch();
        for (const id of ids) batch.delete(db.collection('leaderboard').doc(id));
        await batch.commit();
    });
    for (let i = 0; i < 6; i++) await seed(publicEntryID(randomUUID()), 2_000_000 - i * 100_000);
    await seed(publicEntryID(uid), 1_400_000);
    await seed(publicEntryID(randomUUID()), 1_400_000);
    let at = Date.now();
    const read = createLeaderboardReader(db, { now: () => at });
    const first = await read(uid);
    assert.equal(first.entries.length, 5);
    assert.equal(first.standing.rank, 7); // Equal scores do not increase shared rank.
    assert.equal(first.ownID, publicEntryID(uid));
    assert.equal(first.standing.entry.id, first.ownID);
    assert.ok(!JSON.stringify(first).includes(uid));
    const cache = user.collection('leaderboardCache').doc('standing');
    const originalCache = (await cache.get()).data();
    await seed(publicEntryID(randomUUID()), 1_450_000);
    assert.equal((await read(uid)).standing.rank, 7);
    assert.deepEqual((await cache.get()).data(), originalCache);
    at += 60_001;
    assert.equal((await read(uid)).standing.rank, 8);
    await db.collection('leaderboard').doc(publicEntryID(uid)).update({ totalPoints: 2_100_000 });
    const top = await read(uid);
    assert.equal(top.entries[0].id, top.ownID);
    assert.equal(top.standing.rank, 1);
    assert.equal((await read(`missing-${randomUUID()}`)).standing, null);
    const admitted = createReadService(db);
    const request = { kind: 'leaderboard', query: { version: 1 } };
    assert.equal((await admitted(uid, request)).ownID, publicEntryID(uid));
    await assert.rejects(admitted(uid, { ...request, query: { version: 1, uid: 'someone-else' } }), { code: 'invalid' });
    for (let i = 1; i < 12; i++) await admitted(uid, request);
    await assert.rejects(admitted(uid, request), { code: 'rate-limited' });
    assert.deepEqual((await user.get()).data().displayName, 'Ranger');
    console.log(`NATIVE_LEADERBOARD_REPLY_BYTES=${Buffer.byteLength(JSON.stringify(first))}; leaders=5; standing=1; rank_reuse_ms=60000`);
});
