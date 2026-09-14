'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount } = require('../../profile/commands');
const { setSavedPin } = require('../../places/bookmarks');
const { storageID } = require('../../shared/placeIdentity');
const { createReadService } = require('../../reads/service');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `pins-${randomUUID()}`), db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });
const command = (kind, payload) => ({ version: 1, operationID: randomUUID(), createdAtMs: Date.now(), kind, expectedRevision: 0, payload });
function pin(id = randomUUID()) {
    const identity = { kind: 'custom', id };
    return { pinID: storageID(identity), saved: true, place: { identity, name: 'Private saved place', state: 'Ohio',
        coordinate: { latitude: 41, longitude: -81 }, subtitle: 'Near the park', stopID: 'stop-a', savedAtMs: Date.now() } };
}
async function fixture() {
    const uid = `pins-${randomUUID()}`, reads = [], writes = [];
    const tracked = { collection: p => db.collection(p), runTransaction: (work, options) => db.runTransaction(tx => work({
        get(ref) { reads.push(ref.path); return tx.get(ref); }, getAll(...refs) { reads.push(...refs.map(r => r.path)); return tx.getAll(...refs); },
        ...Object.fromEntries(['set', 'create', 'update', 'delete'].map(method => [method, (ref, ...args) => {
            writes.push(ref.path); return tx[method](ref, ...args);
        }])),
    }), options) };
    const execute = createExecutor({ db: tracked, handlers: { bootstrapAccount, setSavedPin } });
    await execute(uid, command('bootstrapAccount', {}));
    reads.length = writes.length = 0;
    return { uid, user: db.collection('users').doc(uid), reads, writes, send: input => execute(uid, input),
        read: query => createReadService(db)(uid, { kind: 'savedPinChanges', query }) };
}
test('free bookmark save confirms in one command; replay cannot resurrect a later removal or erase journal content', async () => {
    const f = await fixture(), value = pin(), input = command('setSavedPin', value);
    const first = await f.send(input);
    assert.equal(first.confirmation.saved, true); assert.equal(first.confirmation.id, value.pinID);
    assert.equal(f.reads.length, 3); assert.equal(f.writes.length, 2);
    assert.ok(!JSON.stringify(first).includes('notes'));
    console.log(`SAVED_PIN_NEW reads=${f.reads.length} writes=${f.writes.length} functionCalls=1 confirmationBytes=${Buffer.byteLength(JSON.stringify(first))}`);
    f.reads.length = f.writes.length = 0;
    assert.deepEqual(await f.send(input), first);
    assert.equal(f.reads.length, 1); assert.equal(f.writes.length, 0);
    const ref = f.user.collection('places').doc(value.pinID), journal = f.user.collection('notes').doc('journal-owned');
    await journal.set({ placeID: value.pinID, text: 'Keep my writing', kind: 'journal' });
    await ref.update({ journalReference: 'journal-owned', name: 'Newer remote name' });
    const remove = await f.send(command('setSavedPin', { ...value, saved: false }));
    assert.equal(remove.confirmation.place.name, 'Newer remote name');
    assert.deepEqual(await f.send(input), first);
    assert.equal((await ref.get()).get('bookmark.saved'), false);
    assert.equal((await ref.get()).get('deleted'), false);
    assert.equal((await ref.get()).get('journalReference'), 'journal-owned');
    assert.equal((await journal.get()).get('text'), 'Keep my writing');
    assert.equal((await f.user.collection('places').get()).size, 1);
    assert.equal((await f.user.collection('trips').get()).size, 0);
});
test('changes page only bookmarked place metadata with exact resumable cursor, including remote un-save', async () => {
    const f = await fixture(), batch = db.batch(), at = Timestamp.fromMillis(Date.now() - 1000);
    for (let i = 0; i < 105; i++) {
        const value = pin(`page-${i}`), p = value.place;
        batch.set(f.user.collection('places').doc(value.pinID), { schemaVersion: 1, revision: 1,
            identity: p.identity, name: p.name, state: p.state, coordinate: p.coordinate, updatedAt: at, createdAt: at,
            bookmark: { version: 1, saved: true, subtitle: p.subtitle, stopID: p.stopID, savedAtMs: p.savedAtMs } });
    }
    batch.set(f.user.collection('places').doc('trip-only'), { name: 'Trip-only reference', updatedAt: at });
    await batch.commit();
    const first = await f.read({ version: 1 });
    assert.equal(first.items.length, 100); assert.ok(first.next);
    const second = await f.read({ version: 1, upper: first.upper, after: first.next });
    assert.equal(second.items.length, 5); assert.equal(second.next, null);
    assert.equal(new Set([...first.items, ...second.items].map(i => i.id)).size, 105);
    const target = first.items[0];
    await f.send(command('setSavedPin', { pinID: target.id, saved: false, place: target.place }));
    const change = await f.read({ version: 1, since: first.upper });
    assert.equal(change.items.length, 1); assert.equal(change.items[0].saved, false);
    assert.equal(change.items[0].revision, 2);
    assert.ok(!JSON.stringify(change).includes('journalReference'));
    const other = await fixture(); assert.equal((await other.read({ version: 1 })).items.length, 0);
});
test('forged identity, unexpected text/owner fields, old commands and deleting accounts cannot mutate pins', async () => {
    const f = await fixture(), value = pin();
    for (const payload of [{ ...value, pinID: 'forged' }, { ...value, uid: 'other' },
        { ...value, place: { ...value.place, notes: 'never in metadata' } },
        { ...value, place: { ...value.place, coordinate: { latitude: 91, longitude: 0 } } }]) {
        await assert.rejects(f.send(command('setSavedPin', payload)), e => e.code === 'invalid');
    }
    await assert.rejects(f.send({ ...command('setSavedPin', value), createdAtMs: Date.now() - 46 * 86_400_000 }), e => e.code === 'intent-expired');
    await f.user.update({ status: 'deleting' });
    await assert.rejects(f.send(command('setSavedPin', value)), e => e.code === 'account-deleting');
    assert.equal((await f.user.collection('places').get()).size, 0);
});
