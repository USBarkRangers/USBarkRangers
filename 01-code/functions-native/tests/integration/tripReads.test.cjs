'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { createReadService } = require('../../reads/service');
const { createTripReader } = require('../../reads/trip');
const { createTripChangesReader, HORIZON_MS } = require('../../reads/tripChanges');
const { createLibraryReader } = require('../../reads/library');
const { serverTime, timestamp } = require('../../reads/encoding');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `reads-${randomUUID()}`);
const db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });

async function fixture(count = 205) {
    const uid = `read-${randomUUID()}`, user = db.collection('users').doc(uid);
    const time = new Timestamp(Math.floor(Date.now() / 1000) - 10, 123456000);
    const batch = db.batch();
    batch.set(user, { schemaVersion: 1, revision: 1, status: 'active' });
    for (let i = 0; i < count; i++) {
        const id = `trip-${String(i).padStart(4, '0')}`;
        batch.set(user.collection('trips').doc(id), { id, schemaVersion: 1, revision: 1, contentRevision: 1,
            title: id, dayCount: 1, stopCount: 0, contentBytes: 200, deleted: false, createdAt: time, updatedAt: time });
    }
    await batch.commit();
    return { uid, user, time };
}

test('library pages only ten metadata records with equal-time IDs and no content reads', async () => {
    const f = await fixture(23), read = createLibraryReader(db);
    const seen = [], first = await read(f.uid, { version: 1 });
    assert.equal(first.items.length, 10);
    assert.deepEqual(first.next.createdAt, serverTime(f.time));
    for (let page = first; ; page = await read(f.uid, { version: 1, before: page.next })) {
        seen.push(...page.items.map(item => item.id));
        assert.ok(page.items.every(item => !('content' in item) && !('notes' in item)));
        if (!page.next) break;
    }
    assert.equal(seen.length, 23); assert.equal(new Set(seen).size, 23);
    assert.deepEqual(seen, [...seen].sort().reverse());
});

test('incremental scan fixes server upper bound, retains equal-time rows and reconciles concurrent updates/deletes next scan', async () => {
    const f = await fixture(), read = createTripChangesReader(db);
    const first = await read(f.uid, { version: 1 });
    assert.equal(first.items.length, 100); assert.ok(first.next);
    const altered = f.user.collection('trips').doc('trip-0150');
    await altered.update({ revision: 2, contentRevision: 2, deleted: true, updatedAt: FieldValue.serverTimestamp() });
    assert.ok((await altered.get()).get('updatedAt').valueOf() > timestamp(first.upper).valueOf());
    const seen = [...first.items];
    let page = first;
    while (page.next) {
        page = await read(f.uid, { version: 1, upper: first.upper, after: page.next });
        assert.deepEqual(page.upper, first.upper);
        seen.push(...page.items);
    }
    assert.equal(seen.length, 204); assert.equal(new Set(seen.map(item => item.id)).size, 204);
    const next = await read(f.uid, { version: 1, since: first.upper });
    assert.equal(next.items.length, 1); assert.equal(next.items[0].id, 'trip-0150');
    assert.equal(next.items[0].deleted, true); assert.equal(next.items[0].revision, 2);
    const overlap = await read(f.uid, { version: 1, since: serverTime(f.time), upper: first.upper });
    assert.equal(overlap.items.length, 100); // Inclusive equal-time boundary is intentional.
    const expired = await read(f.uid, { version: 1, since: serverTime(Timestamp.fromMillis(Date.now() - HORIZON_MS - 60_000)) });
    assert.equal(expired.needsBootstrap, true); assert.deepEqual(expired.items, []);
});

test('ordinary owner reads have no throttle writes; expensive reads still require an active account', async () => {
    const f = await fixture(1), other = await fixture(2), read = createReadService(db);
    const result = await read(f.uid, { kind: 'library', query: { version: 1 } });
    assert.equal(result.items.length, 1);
    await assert.rejects(read(f.uid, { kind: 'library', query: { version: 1, uid: other.uid } }), error => error.code === 'invalid');
    const rate = f.user.collection('readLimits').doc('library');
    await rate.set({ windowStartMs: Math.floor(Date.now() / 60_000) * 60_000, count: 60 });
    const before = (await rate.get()).data();
    assert.equal((await read(f.uid, { kind: 'library', query: { version: 1 } })).items.length, 1);
    assert.deepEqual((await rate.get()).data(), before);
    await f.user.update({ status: 'deleting' });
    await assert.rejects(read(f.uid, { kind: 'tripRecovery', query: { version: 1, tripID: 'trip-0000', stopIDs: [] } }), error => error.code === 'account-deleting');
    // Like direct owner reads, a still-valid token may read its remaining data
    // during deletion. It cannot write it or address another account's path.
    assert.equal((await read(f.uid, { kind: 'library', query: { version: 1 } })).items.length, 1);
    const absent = await createTripReader(db)(other.uid, { version: 1, tripID: 'does-not-exist' });
    assert.equal(absent.metadata, null); assert.equal(absent.content, null); assert.deepEqual(absent.notes, []);
    assert.ok(timestamp(absent.readTime) instanceof Timestamp);
});
