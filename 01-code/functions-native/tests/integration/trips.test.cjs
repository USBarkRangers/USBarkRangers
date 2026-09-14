'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount } = require('../../profile/commands');
const { createSaveTrip } = require('../../trips/save');
const { editNote } = require('../../trips/editNote');
const { saveTripNotes } = require('../../trips/saveNotes');
const { deleteTrip } = require('../../trips/delete');
const { planningNoteID } = require('../../trips/identity');
const { storageID } = require('../../shared/placeIdentity');
const { createTripRecoveryReader } = require('../../reads/tripRecovery');
const { createReadService } = require('../../reads/service');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `trips-${randomUUID()}`);
const db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });
const handlers = { bootstrapAccount, saveTrip: createSaveTrip({ catalog: { canonicalID: id => id === 'official-a' ? id : null } }),
    editNote, saveTripNotes, deleteTrip };

async function fixture() {
    const uid = `trip-${randomUUID()}`, reads = [], writes = [];
    const tracked = { collection: path => db.collection(path), runTransaction: (work, options) => db.runTransaction(tx => work({
        get(ref) { reads.push(ref.path); return tx.get(ref); },
        getAll(...refs) { reads.push(...refs.map(ref => ref.path)); return tx.getAll(...refs); },
        ...Object.fromEntries(['set', 'create', 'update', 'delete'].map(method => [method, (ref, ...args) => {
            writes.push(ref.path); return tx[method](ref, ...args);
        }])),
    }), options) };
    const execute = createExecutor({ db: tracked, handlers });
    const command = (kind, payload, expectedRevision = 0) => ({ version: 1, operationID: randomUUID(),
        createdAtMs: Date.now(), kind, payload, expectedRevision });
    const user = db.collection('users').doc(uid);
    await execute(uid, command('bootstrapAccount', {}));
    // Emulated fixture only; no live endpoint or client can grant this access.
    await user.collection('state').doc('entitlement').set({ schemaVersion: 1, revision: 2,
        premium: true, source: 'app-store-production', validUntil: Timestamp.fromMillis(Date.now() + 3600_000) });
    return { uid, user, reads, writes, command, execute: input => execute(uid, input),
        readTrip: tripID => createReadService(tracked)(uid, { kind: 'trip', query: { version: 1, tripID } }),
        send: (kind, payload, revision = 0) => execute(uid, command(kind, payload, revision)) };
}
function trip(id = randomUUID(), count = 1, noteText = 'Planning note') {
    const stops = Array.from({ length: count }, (_, i) => ({ id: `stop-${i}`,
        placeIdentity: { kind: 'provider', provider: 'apple', id: `provider-${i}` },
        name: `Place ${i}`, state: 'Ohio', coordinate: { latitude: 41, longitude: -81 }, noteID: planningNoteID(id, `stop-${i}`) }));
    for (const stop of stops) stop.placeID = storageID(stop.placeIdentity);
    return { tripID: id, name: 'Road trip', days: [{ id: 'day-1', stops, notes: 'Day planning', color: '#475569' }],
        notes: stops.map(stop => ({ id: stop.noteID, expectedRevision: 0, text: noteText })) };
}

test('trip/place/note creation is atomic, place identity is reused and duplication keeps planning text independent', async () => {
    const f = await fixture(), a = trip(), b = trip();
    const command = f.command('saveTrip', a);
    const accepted = await f.execute(command);
    assert.equal(accepted.revisions.trip, 1);
    assert.deepEqual(await f.execute(command), accepted);
    const content = (await f.user.collection('trips').doc(a.tripID).collection('content').doc('itinerary').get()).data();
    assert.equal(content.days[0].stops[0].notes, undefined);
    assert.equal((await f.user.collection('notes').doc(a.notes[0].id).get()).get('text'), 'Planning note');
    await f.send('saveTrip', b);
    assert.equal((await f.user.collection('places').get()).size, 1);
    assert.equal((await f.user.collection('notes').get()).size, 2);
    const placeRef = f.user.collection('places').doc(storageID(a.days[0].stops[0].placeIdentity));
    await placeRef.update({ name: 'Private retained title' });
    await f.send('saveTrip', { ...b, name: 'Renamed', notes: [] }, 1);
    assert.equal((await placeRef.get()).get('name'), 'Private retained title');
    const wrong = trip(); wrong.days[0].stops[0].placeIdentity = { kind: 'official', id: 'unapproved' };
    wrong.days[0].stops[0].placeID = storageID(wrong.days[0].stops[0].placeIdentity);
    await assert.rejects(f.send('saveTrip', wrong), error => error.code === 'invalid');
    assert.equal((await f.user.collection('trips').doc(wrong.tripID).get()).exists, false);
});

test('a note-only update has bounded reads, preserves itinerary revision and blocks stale bulk save atomically', async () => {
    const f = await fixture(), a = trip();
    await f.send('saveTrip', a);
    const tripRef = f.user.collection('trips').doc(a.tripID), contentRef = tripRef.collection('content').doc('itinerary');
    const before = (await contentRef.get()).data();
    f.reads.length = 0;
    const outcome = await f.send('editNote', { tripID: a.tripID, stopID: 'stop-0', noteID: a.notes[0].id, text: 'Edited' }, 1);
    assert.equal(outcome.revisions.trip, 1);
    assert.equal(outcome.revisions.metadata, 2);
    assert.equal(f.reads.length, 6);
    assert.ok(!f.reads.includes(contentRef.path));
    assert.deepEqual((await contentRef.get()).data(), before);
    const conflict = await f.send('saveTrip', { ...a, name: 'Must not commit', notes: [{ ...a.notes[0], expectedRevision: 1, text: 'Stale' }] }, 1);
    assert.equal(conflict.status, 'conflict');
    assert.equal((await tripRef.get()).get('title'), 'Road trip');
    assert.equal((await f.user.collection('notes').doc(a.notes[0].id).get()).get('text'), 'Edited');
});

test('removing stops and deleting trips preserve notes and keep deletion revisions', async () => {
    const f = await fixture(), a = trip();
    await f.send('saveTrip', a);
    await f.send('saveTrip', { ...a, days: [{ ...a.days[0], stops: [] }], notes: [] }, 1);
    const note = f.user.collection('notes').doc(a.notes[0].id);
    assert.equal((await note.get()).get('linkedToTrip'), false);
    const recovery = await createTripRecoveryReader(db)(f.uid, { version: 1, tripID: a.tripID, stopIDs: ['stop-0'] });
    assert.equal(recovery.notes.length, 1);
    assert.equal(recovery.notes[0].linkedToTrip, false);
    assert.equal(recovery.notes[0].revision, 2);
    assert.equal(recovery.metadata.contentRevision, 2);
    const unrelated = await createTripRecoveryReader(db)(f.uid, { version: 1, tripID: 'different-trip', stopIDs: ['stop-0'] });
    assert.deepEqual(unrelated.notes, []);
    const rejected = await f.send('editNote', { tripID: a.tripID, stopID: 'stop-0', noteID: a.notes[0].id, text: 'Detached' }, 2);
    assert.equal(rejected.status, 'conflict');
    const result = await f.send('deleteTrip', { tripID: a.tripID }, 2);
    assert.equal(result.revisions.trip, 3);
    const metadata = (await f.user.collection('trips').doc(a.tripID).get()).data();
    assert.equal(metadata.deleted, true);
    assert.ok(metadata.expiresAt.toMillis() > Date.now() + 89 * 24 * 3600_000);
    assert.equal((await note.get()).get('text'), 'Planning note');
    assert.equal((await f.send('saveTrip', a, 0)).revisions.trip, 3);
});

test('maximum 500-stop creation and bulk note update fit the logical budget without a split commit', async () => {
    const f = await fixture(), a = trip(randomUUID(), 500, 'Text '.repeat(10));
    const first = await f.send('saveTrip', a);
    assert.equal(Object.keys(first.revisions.notes).length, 500);
    const metadata = (await f.user.collection('trips').doc(a.tripID).get()).data();
    assert.ok(metadata.contentBytes <= 350_000);
    assert.equal((await f.user.collection('notes').get()).size, 500);
    assert.equal((await f.user.collection('places').get()).size, 500);
    const edited = { ...a, notes: a.notes.map(note => ({ ...note, expectedRevision: 1, text: 'New '.repeat(10) })) };
    assert.equal((await f.send('saveTrip', edited, 1)).revisions.trip, 2);
    const tooLarge = { ...edited, notes: a.notes.map(note => ({ ...note, expectedRevision: 2, text: 'x'.repeat(1000) })) };
    await assert.rejects(f.send('saveTrip', tooLarge, 2), error => error.code === 'invalid');
    assert.equal((await f.user.collection('trips').doc(a.tripID).get()).get('contentRevision'), 2);
    const batch = { tripID: a.tripID, notes: a.notes.map((note, i) =>
        ({ ...note, stopID: `stop-${i}`, expectedRevision: 2, text: 'Batch update' })) };
    f.reads.length = 0; f.writes.length = 0;
    const accepted = await f.send('saveTripNotes', batch, 2);
    assert.equal(accepted.status, 'accepted');
    assert.equal(Object.keys(accepted.revisions.notes).length, 500);
    assert.equal(accepted.revisions.trip, 2);
    assert.equal(f.reads.length, 505); assert.equal(f.writes.length, 503);
});

test('reproduction: full-save path reads the entire 500-stop reference set for one existing note edit', async () => {
    const f = await fixture(), a = trip(randomUUID(), 500, 'Original');
    await f.send('saveTrip', a);
    f.reads.length = 0; f.writes.length = 0;
    await f.readTrip(a.tripID);
    const preflightReads = f.reads.length, preflightWrites = f.writes.length;
    assert.equal(preflightReads, 504); assert.equal(preflightWrites, 1);
    f.reads.length = 0; f.writes.length = 0;
    const outcome = await f.send('saveTrip', { ...a,
        notes: [{ ...a.notes[0], expectedRevision: 1, text: 'One changed note' }] }, 1);
    const itinerary = f.user.collection('trips').doc(a.tripID).collection('content').doc('itinerary');
    assert.equal(outcome.status, 'accepted');
    assert.equal(outcome.revisions.trip, 2);
    assert.equal(f.reads.length, 1006);
    assert.equal(f.writes.length, 5);
    assert.ok(f.reads.includes(itinerary.path) && f.writes.includes(itinerary.path));
    console.log(`FULL_SAVE_ONE_NOTE_500_STOPS reads=${f.reads.length} writes=${f.writes.length}`);
    await f.readTrip(a.tripID);
    assert.equal(preflightReads + f.reads.length, 2014);
    assert.equal(preflightWrites + f.writes.length, 7);
    console.log(`OLD_SAVE_PLUS_TWO_DETAILS reads=${preflightReads + f.reads.length} writes=${preflightWrites + f.writes.length}`);
    const before = (await itinerary.get()).data();
    f.reads.length = 0; f.writes.length = 0;
    const command = f.command('saveTripNotes', { tripID: a.tripID,
        notes: [{ id: a.notes[0].id, stopID: 'stop-0', expectedRevision: 2, text: '🐕 Second edit' }] }, 2);
    const result = await f.execute(command);
    assert.equal(result.status, 'accepted');
    assert.equal(result.revisions.trip, 2);
    assert.equal(result.revisions.metadata, 3);
    assert.equal(result.revisions.notes[a.notes[0].id], 3);
    assert.equal(f.reads.length, 6);
    assert.equal(f.writes.length, 4);
    assert.ok(![...f.reads, ...f.writes].some(path => path.includes('/places/') || path.includes('/content/')));
    assert.deepEqual((await itinerary.get()).data(), before);
    console.log(`NOTE_SAVE_ONE_NOTE_500_STOPS reads=${f.reads.length} writes=${f.writes.length}`);
    await f.readTrip(a.tripID);
    assert.equal(f.reads.length, 510); assert.equal(f.writes.length, 5);
    console.log(`NEW_SAVE_PLUS_ONE_DETAIL reads=${f.reads.length} writes=${f.writes.length}`);
    f.reads.length = 0; f.writes.length = 0;
    assert.deepEqual(await f.execute(command), result);
    assert.equal(f.reads.length, 1);
    assert.equal(f.writes.length, 0);
});

test('multi-note Save is all-or-nothing, retains untouched remote notes and exact logical bytes', async () => {
    const f = await fixture(), a = trip(randomUUID(), 3);
    await f.send('saveTrip', a);
    const tripRef = f.user.collection('trips').doc(a.tripID);
    const before = (await tripRef.get()).get('contentBytes');
    const payload = { tripID: a.tripID, notes: a.notes.slice(0, 2).map((note, i) =>
        ({ ...note, stopID: `stop-${i}`, expectedRevision: 1, text: i === 0 ? '' : 'Café 🐕\n"Water"' })) };
    await f.send('editNote', { tripID: a.tripID, noteID: a.notes[2].id, stopID: 'stop-2', text: 'Remote' }, 1);
    f.reads.length = 0; f.writes.length = 0;
    const accepted = await f.send('saveTripNotes', payload, 1);
    assert.equal(accepted.status, 'accepted');
    assert.equal(f.reads.length, 7); assert.equal(f.writes.length, 5);
    assert.equal(accepted.revisions.trip, 1); assert.equal(accepted.revisions.metadata, 3);
    const size = text => Buffer.byteLength(JSON.stringify(text));
    assert.equal((await tripRef.get()).get('contentBytes'), before - 3 * size('Planning note')
        + size('') + size('Café 🐕\n"Water"') + size('Remote'));
    // Second edit is stale: the valid first edit must not partially commit.
    f.writes.length = 0;
    const conflict = await f.send('saveTripNotes', { ...payload, notes: [
        { ...payload.notes[0], expectedRevision: 2, text: 'Must not write' }, payload.notes[1]] }, 1);
    assert.equal(conflict.status, 'conflict');
    assert.ok(!f.writes.some(path => path.includes('/notes/') || path === tripRef.path));
    assert.equal((await f.user.collection('notes').doc(a.notes[0].id).get()).get('text'), '');
    assert.equal((await f.user.collection('notes').doc(a.notes[2].id).get()).get('text'), 'Remote');
    assert.equal((await tripRef.get()).get('revision'), 3);
    await f.send('saveTrip', { ...a, name: 'New itinerary', notes: [] }, 1);
    const staleTrip = await f.send('saveTripNotes', { ...payload,
        notes: payload.notes.map(note => ({ ...note, expectedRevision: 2 })) }, 1);
    assert.equal(staleTrip.status, 'conflict');
    assert.equal(staleTrip.revisions.trip, 2);
});

test('note batch rejects forged/new/duplicate notes, detached/deleted trips and excessive size without partial writes', async () => {
    const f = await fixture(), a = trip(randomUUID(), 2);
    await f.send('saveTrip', a);
    const edit = { ...a.notes[0], stopID: 'stop-0', expectedRevision: 1 };
    const payload = { tripID: a.tripID, notes: [edit] };
    const other = await fixture();
    assert.equal((await other.send('saveTripNotes', payload, 1)).status, 'conflict');
    assert.ok(!other.reads.some(path => path.startsWith(f.user.path)));
    for (const notes of [[], [edit, edit], [{ ...edit, expectedRevision: 0 }],
        [{ ...edit, stopID: 'forged' }], [{ ...edit, text: 'x'.repeat(1001) }]]) {
        await assert.rejects(f.send('saveTripNotes', { ...payload, notes }, 1), error => error.code === 'invalid');
    }
    await f.send('saveTrip', { ...a, days: [{ ...a.days[0], stops: a.days[0].stops.slice(1) }], notes: [] }, 1);
    assert.equal((await f.send('saveTripNotes', { ...payload, notes: [{ ...edit, expectedRevision: 2 }] }, 2)).status, 'conflict');
    const missing = { id: planningNoteID(a.tripID, 'missing'), stopID: 'missing', expectedRevision: 1, text: 'New' };
    assert.equal((await f.send('saveTripNotes', { ...payload, notes: [missing] }, 2)).status, 'conflict');
    const tripRef = f.user.collection('trips').doc(a.tripID);
    await tripRef.update({ contentBytes: 350_000 }); // Boundary fixture, never a public client write.
    const remaining = { ...a.notes[1], stopID: 'stop-1', expectedRevision: 1, text: 'x'.repeat(1000) };
    await assert.rejects(f.send('saveTripNotes', { ...payload, notes: [remaining] }, 2), error => error.code === 'invalid');
    assert.equal((await f.user.collection('notes').doc(remaining.id).get()).get('text'), 'Planning note');
    await f.send('deleteTrip', { tripID: a.tripID }, 2);
    assert.equal((await f.send('saveTripNotes', { ...payload, notes: [remaining] }, 3)).status, 'conflict');
});
