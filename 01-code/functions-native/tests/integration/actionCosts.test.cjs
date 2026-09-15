'use strict';
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { meter } = require('../support/meter.cjs');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount } = require('../../profile/commands');
const { createSaveTrip } = require('../../trips/save');
const { saveTripNotes } = require('../../trips/saveNotes');
const { createVisitHandlers } = require('../../visits/commands');
const { createDailyActivity, dayKey } = require('../../progress/activity');
const { createReadService } = require('../../reads/service');
const { planningNoteID } = require('../../trips/identity');
const { storageID } = require('../../shared/placeIdentity');
const catalog = require('../../catalog');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `costs-${randomUUID()}`);
const db = getFirestore(app, `costs-${randomUUID()}`), measured = meter(db);
after(async () => { await db.terminate(); await deleteApp(app); });

test('measure the same ten-note trip, first visit and Passport actions through real handlers', async () => {
    const uid = `cost-${randomUUID()}`, tripID = randomUUID();
    // The baseline excludes time-of-day awards. Running CI before 04:00 UTC used
    // to earn the night badge and add a real award write. Measure yesterday at noon.
    const day = 86_400_000, now = Math.floor(Date.now() / day) * day - day + 12 * 3600_000;
    const execute = createExecutor({ db: measured.db, handlers: { bootstrapAccount, saveTrip: createSaveTrip({ catalog }),
        saveTripNotes, ...createVisitHandlers({ catalog }), recordDailyActivity: createDailyActivity({ catalog }) }, clock: () => now });
    const read = createReadService(measured.db);
    let calls = 0;
    const send = async (kind, payload, expectedRevision = 0) => { calls++;
        return execute(uid, { version: 1, operationID: randomUUID(), kind, payload, expectedRevision, createdAtMs: now }); };
    const get = async (kind, query) => { calls++; return read(uid, { kind, query: { version: 1, ...query } }); };
    await send('bootstrapAccount', {});
    await db.doc(`users/${uid}/state/entitlement`).set({ schemaVersion: 1, revision: 2, premium: true,
        source: 'app-store-production', validUntil: Timestamp.fromMillis(Date.now() + 3600_000) });
    const stops = Array.from({ length: 10 }, (_, i) => {
        const identity = { kind: 'provider', provider: 'apple', id: `cost-place-${i}` };
        return { id: `stop-${i}`, placeID: storageID(identity), placeIdentity: identity, name: `Place ${i}`,
            state: 'Ohio', coordinate: { latitude: 41, longitude: -81 }, noteID: planningNoteID(tripID, `stop-${i}`) };
    });
    const trip = { tripID, name: 'Measured trip', days: [{ id: 'day-1', color: '#475569', notes: '', stops }],
        notes: stops.map(stop => ({ id: stop.noteID, text: 'Planning text', expectedRevision: 0 })) };
    const rows = [];
    async function action(name, work) {
        measured.reset(); calls = 0; await work();
        rows.push({ action: name, ...measured.totals(), calls,
            admission: measured.events.filter(e => /Receipts|Limits|\/entitlement$|^users\/[^/]+$/.test(e.path)) });
    }
    // Same-device warm preimage: the iOS SDK integration suite independently proves
    // these confirmations eliminate the follow-up request, including note content.
    const confirm = outcome => {
        assert.equal(outcome.status, 'accepted'); assert.ok(outcome.confirmation.updatedAt.nanoseconds >= 0);
        assert.equal(outcome.confirmation.revision, outcome.revisions.metadata);
        assert.ok(Buffer.byteLength(JSON.stringify(outcome)) < 2000);
        assert.ok(!JSON.stringify(outcome).includes('Planning text'));
    };
    await action('new ten-note trip', async () => confirm(await send('saveTrip', trip)));
    await action('rename ten-note trip', async () => confirm(await send('saveTrip', { ...trip, name: 'Renamed', notes: [] }, 1)));
    await action('one note edit', async () => confirm(await send('saveTripNotes', { tripID,
        notes: [{ id: stops[0].noteID, stopID: stops[0].id, expectedRevision: 1, text: 'Edited' }] }, 2)));
    await action('open ten-note trip', () => get('trip', { tripID }));
    const park = require('../../catalog/catalog.json').parks.find(p => !p.isRetired);
    const visit = { visitID: randomUUID(), officialPlaceID: park.id, expectedPlaceRevision: 0,
        happenedAtMs: now, timeZone: 'UTC' };
    await action('first unverified visit', async () => {
        const outcome = await send('markVisit', visit); assert.equal(outcome.confirmation.visit.id, visit.visitID);
    });
    await action('first Passport daily activity', async () => {
        await send('recordDailyActivity', { day: dayKey(now, 'UTC'), timeZone: 'UTC' });
        await measured.db.doc(`users/${uid}/state/progress`).get(); // Direct owner document; no function.
    });
    assert.deepEqual(rows.map(({ reads, writes, calls }) => [reads, writes, calls]), [
        [27, 24, 1], [27, 4, 1], [6, 3, 1], [12, 0, 1], [8, 6, 1], [5, 2, 1],
    ]);
    process.stdout.write(`ACTION_COSTS ${JSON.stringify(rows)}\n`);
});
