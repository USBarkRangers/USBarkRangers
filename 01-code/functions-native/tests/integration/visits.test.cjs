'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount, publicEntryID } = require('../../profile/commands');
const { createVisitHandlers } = require('../../visits/commands');
const { createVisitReader, createVisitHistoryReader } = require('../../reads/visits');
const { createEntityChangesReader } = require('../../reads/entityChanges');
const { createDailyActivity, dayKey } = require('../../progress/activity');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `visits-${randomUUID()}`);
const db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });
const parks = Array.from({ length: 12 }, (_, i) => ({ id: `official-${i}`, siteID: `site-${i}`,
    name: `Park ${i}`, state: 'Ohio', stateCodes: ['OH'], coordinate: { latitude: 41, longitude: -81 }, isRetired: i === 11 }));
const catalog = { revision: 1, siteCount: 12, stateTotals: { OH: 12 }, park: id => parks.find(p => p.id === id) };
const handlers = { bootstrapAccount, ...createVisitHandlers({ catalog }), recordDailyActivity: createDailyActivity({ catalog }) };
async function fixture() {
    const uid = `visit-${randomUUID()}`, reads = [], writes = [];
    const tracked = { collection: path => db.collection(path), runTransaction: work => db.runTransaction(tx => work({
        async get(ref) { const result = await tx.get(ref); reads.push({ path: ref.path || 'bounded-query', count: result.docs?.length ?? 1 }); return result; },
        getAll(...refs) { reads.push(...refs.map(ref => ({ path: ref.path, count: 1 }))); return tx.getAll(...refs); },
        set(ref, ...args) { writes.push(ref.path); return tx.set(ref, ...args); },
        create: tx.create.bind(tx), update: tx.update.bind(tx), delete: tx.delete.bind(tx),
    })) };
    const execute = createExecutor({ db: tracked, handlers });
    const command = (kind, payload, expectedRevision = 0) => ({ version: 1, operationID: randomUUID(),
        createdAtMs: Date.now(), kind, payload, expectedRevision });
    const user = db.collection('users').doc(uid);
    await execute(uid, command('bootstrapAccount', {}));
    await user.collection('state').doc('entitlement').set({ schemaVersion: 1, revision: 2,
        premium: true, source: 'app-store-production', validUntil: Timestamp.fromMillis(Date.now() + 3600_000) });
    reads.length = 0; writes.length = 0;
    return { uid, user, reads, writes, command, execute: input => execute(uid, input),
        send: (kind, payload, revision = 0) => execute(uid, command(kind, payload, revision)) };
}
function mark(index = 0, date = Date.now()) {
    return { visitID: randomUUID(), officialPlaceID: parks[index].id, expectedPlaceRevision: 0,
        happenedAtMs: date, timeZone: 'America/New_York' };
}

test('visit events, official-site credit, upgrade, date correction and removal commit independently of profile/history', async () => {
    const f = await fixture(), p = mark(), command = f.command('markVisit', p);
    const beforeProfile = (await f.user.get()).data();
    const first = await f.execute(command);
    assert.deepEqual(first.revisions, { visit: 1, placeProgress: 1, progress: 1 });
    assert.deepEqual(await f.execute(command), first);
    const duplicate = await f.send('markVisit', { ...mark(), expectedPlaceRevision: 1 });
    assert.equal(duplicate.status, 'conflict');
    const fix = { latitude: 41, longitude: -81, accuracy: 25, timestampMs: Date.now() };
    const upgraded = await f.send('markVisit', { ...p, expectedPlaceRevision: 1, proximity: fix }, 1);
    assert.equal(upgraded.revisions.visit, 2);
    const visitRef = f.user.collection('visits').doc(p.visitID);
    assert.equal((await visitRef.get()).get('happenedAtMs'), p.happenedAtMs);
    let progress = (await f.user.collection('state').doc('progress').get()).data();
    assert.equal(progress.sites, 1); assert.equal(progress.verifiedSites, 1);
    assert.equal((await db.collection('leaderboard').doc(publicEntryID(f.uid)).get()).get('totalPoints'), 2);
    const dateEdit = { visitID: p.visitID, officialPlaceID: p.officialPlaceID, happenedAtMs: Date.UTC(2025, 11, 25, 17), timeZone: 'UTC' };
    assert.equal((await f.send('updateVisitDate', dateEdit, 1)).status, 'conflict');
    f.writes.length = 0;
    await f.send('updateVisitDate', dateEdit, 2);
    assert.ok(!f.writes.some(path => path.startsWith('leaderboard/')));
    const earned = (await f.user.collection('awards').doc('loneWolf').get()).data();
    assert.equal(earned.tier, 'verified');
    const deletion = { visitID: p.visitID, officialPlaceID: p.officialPlaceID };
    await f.send('deleteVisit', deletion, 3);
    assert.equal((await visitRef.get()).get('deleted'), true);
    assert.equal((await visitRef.get()).get('proximity'), undefined);
    progress = (await f.user.collection('state').doc('progress').get()).data();
    assert.equal(progress.sites, 0); assert.equal(progress.verifiedSites, 0);
    assert.deepEqual(progress.states, {}); assert.deepEqual(progress.verifiedStates, {});
    assert.deepEqual((await f.user.collection('awards').doc('loneWolf').get()).data(), earned);
    assert.equal((await f.send('markVisit', { ...p, expectedPlaceRevision: 4 }, 4)).status, 'conflict');
    const nextEvent = { ...mark(), expectedPlaceRevision: 4 };
    await f.send('markVisit', nextEvent);
    assert.equal((await f.user.collection('state').doc('progress').get()).get('sites'), 1);
    assert.deepEqual((await f.user.get()).data(), beforeProfile);
    assert.ok(!f.reads.some(read => read.path.includes('/awards/')));
    assert.ok(f.reads.filter(read => read.path === 'bounded-query').every(read => read.count <= 4));
});

test('date-window badges use bounded neighboring events, including backdated and equal-time edits', async () => {
    const f = await fixture(), start = Date.UTC(2025, 5, 10, 12);
    const payloads = [mark(0, start), mark(1, start + 5 * 3600_000), mark(2, start + 10 * 3600_000), mark(3, start + 30 * 3600_000)];
    for (const payload of payloads) await f.send('markVisit', payload);
    assert.equal((await f.user.collection('awards').doc('marathoner').get()).exists, false);
    f.reads.length = 0;
    await f.send('updateVisitDate', { visitID: payloads[3].visitID, officialPlaceID: payloads[3].officialPlaceID,
        happenedAtMs: start, timeZone: 'UTC' }, 1);
    assert.equal((await f.user.collection('awards').doc('marathoner').get()).get('tier'), 'verified');
    assert.ok(f.reads.reduce((sum, row) => sum + row.count, 0) <= 17); // 7 exact + at most 8 neighbors + 2 leaders.
    const originalAward = (await f.user.collection('awards').doc('marathoner').get()).data();
    await f.send('deleteVisit', { visitID: payloads[3].visitID, officialPlaceID: payloads[3].officialPlaceID }, 2);
    assert.deepEqual((await f.user.collection('awards').doc('marathoner').get()).data(), originalAward);
});

test('visit admission rejects forged official facts, stale GPS, foreign identity and concurrent duplicate site credit', async () => {
    const f = await fixture(), p = mark();
    await assert.rejects(f.send('markVisit', { ...p, verified: true }), error => error.code === 'invalid');
    await assert.rejects(f.send('markVisit', mark(11)), error => error.code === 'invalid');
    await assert.rejects(f.send('markVisit', { ...p, proximity: { latitude: 41, longitude: -81,
        accuracy: 1, timestampMs: Date.now() - 120_000 } }), error => error.code === 'invalid');
    const results = await Promise.all([f.send('markVisit', p), f.send('markVisit', mark())]);
    assert.equal(results.filter(result => result.status === 'accepted').length, 1);
    assert.equal((await f.user.collection('state').doc('progress').get()).get('sites'), 1);
    const active = (await f.user.collection('placeProgress').doc('site-0').get()).get('visitID');
    await assert.rejects(f.send('deleteVisit', { visitID: active, officialPlaceID: 'official-1' }, 1), error => error.code === 'invalid');
    assert.equal((await f.user.collection('visits').doc(active).get()).get('deleted'), false);
});

test('visit reads remain owner-scoped and paged while unmarked slots survive the visit tombstone horizon', async () => {
    const f = await fixture(), p = mark();
    await f.send('markVisit', p);
    const read = createVisitReader(db, catalog);
    const query = { version: 1, visitID: p.visitID, officialPlaceID: p.officialPlaceID };
    const current = await read(f.uid, query);
    assert.equal(current.visit.id, p.visitID);
    assert.equal(current.placeProgress.visitID, p.visitID);
    assert.equal(current.progress.sites, 1);
    const foreign = await read(`other-${randomUUID()}`, query);
    assert.equal(foreign.visit, null); assert.equal(foreign.placeProgress, null); assert.equal(foreign.progress, null);
    await f.send('deleteVisit', { visitID: p.visitID, officialPlaceID: p.officialPlaceID }, 1);
    const batch = db.batch(), stamp = Timestamp.fromMillis(Date.now() - 1000);
    for (let index = 0; index < 103; index++) {
        const id = `history-${String(index).padStart(3, '0')}`;
        batch.set(f.user.collection('visits').doc(id), { ...current.visit, id, deleted: false,
            happenedAtMs: p.happenedAtMs - 1000, updatedAt: stamp, recordedAt: stamp });
        batch.set(f.user.collection('placeProgress').doc(id), { schemaVersion: 1, id, revision: 1,
            officialPlaceID: `official-${index}`, visitID: null, visited: false, verified: false, updatedAt: stamp });
    }
    await batch.commit();
    const history = createVisitHistoryReader(db);
    const first = await history(f.uid, { version: 1 });
    const second = await history(f.uid, { version: 1, before: first.next });
    const third = await history(f.uid, { version: 1, before: second.next });
    assert.deepEqual([first.items.length, second.items.length, third.items.length], [50, 50, 3]);
    assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 103);
    assert.equal(third.next, null);
    const changes = createEntityChangesReader(db, { collection: 'placeProgress', retentionDays: null });
    const since = { seconds: Math.floor(Date.now() / 1000) - 120 * 86400, nanoseconds: 0 };
    const page = await changes(f.uid, { version: 1, since });
    assert.equal(page.needsBootstrap, false); assert.equal(page.items.length, 100);
    const end = await changes(f.uid, { version: 1, since, upper: page.upper, after: page.next });
    assert.equal(end.items.length, 4); assert.equal(end.next, null);
    assert.equal([...page.items, ...end.items].find(item => item.id === 'site-0').visited, false);
});

test('daily activity is server-day-idempotent and cannot backfill a competitive streak', async () => {
    const f = await fixture(), payload = { day: dayKey(Date.now(), 'UTC'), timeZone: 'UTC' };
    const one = await f.send('recordDailyActivity', payload);
    const two = await f.send('recordDailyActivity', payload);
    assert.equal(two.revisions.progress, one.revisions.progress);
    const progressRef = f.user.collection('state').doc('progress'), saved = (await progressRef.get()).data();
    assert.equal(saved.streakCount, 1); assert.equal(saved.lastStreakDay, payload.day);
    const old = f.command('recordDailyActivity', { day: '2025-01-01', timeZone: 'UTC' });
    old.createdAtMs -= 86400_000;
    await f.execute(old);
    assert.deepEqual((await progressRef.get()).data(), saved);
    assert.equal((await f.user.get()).get('streakCount'), undefined);
});

test('bulk visit removal is one atomic revision-checked selection and does not erase earned awards', async () => {
    const f = await fixture(), selected = [mark(0), mark(1), mark(2)];
    for (const item of selected) await f.send('markVisit', item);
    const payload = { visits: selected.map(item => ({ visitID: item.visitID, officialPlaceID: item.officialPlaceID, expectedRevision: 1 })) };
    const stale = structuredClone(payload); stale.visits[1].expectedRevision = 2;
    assert.equal((await f.send('deleteVisits', stale)).status, 'conflict');
    assert.equal((await f.user.collection('visits').where('deleted', '==', false).get()).size, 3);
    const award = (await f.user.collection('awards').doc('theLocalLegend').get()).data();
    const command = f.command('deleteVisits', payload), outcome = await f.execute(command);
    assert.equal(outcome.status, 'accepted');
    assert.deepEqual(Object.values(outcome.revisions.visits), [2, 2, 2]);
    assert.deepEqual(await f.execute(command), outcome);
    assert.equal((await f.user.collection('visits').where('deleted', '==', false).get()).size, 0);
    assert.equal((await f.user.collection('state').doc('progress').get()).get('sites'), 0);
    assert.deepEqual((await f.user.collection('awards').doc('theLocalLegend').get()).data(), award);
    assert.equal((await f.user.get()).get('visitedPlaces'), undefined);
});
