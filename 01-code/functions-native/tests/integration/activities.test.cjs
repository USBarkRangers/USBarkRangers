'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount, publicEntryID } = require('../../profile/commands');
const { createAssignRun } = require('../../expeditions/assign');
const { createClaimRun } = require('../../expeditions/claim');
const { createRecordActivity } = require('../../activities/create');
const { createActivityEdits } = require('../../activities/edit');
const { createReadService } = require('../../reads/service');
const { MILE } = require('../../activities/validation');
const catalog = require('../../catalog');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({ projectId: 'demo-bark-native' }, `activities-${randomUUID()}`);
const db = getFirestore(app);
after(async () => { await db.terminate(); await deleteApp(app); });
const handlers = { bootstrapAccount, assignVirtualRun: createAssignRun({ catalog }),
    claimVirtualRun: createClaimRun({ catalog }), recordActivity: createRecordActivity({ catalog }), ...createActivityEdits({ catalog }) };
async function fixture() {
    const uid = `activity-${randomUUID()}`, reads = [], writes = [];
    const tracked = { collection: path => db.collection(path), runTransaction: work => db.runTransaction(tx => work({
        async get(ref) { const result = await tx.get(ref); reads.push({ path: ref.path || 'query', count: result.docs?.length ?? 1 }); return result; },
        getAll(...refs) { reads.push(...refs.map(ref => ({ path: ref.path, count: 1 }))); return tx.getAll(...refs); },
        set(ref, ...args) { writes.push(ref.path); return tx.set(ref, ...args); },
        create(ref, ...args) { writes.push(ref.path); return tx.create(ref, ...args); },
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
        send: (kind, payload, revision = 0) => execute(uid, command(kind, payload, revision)),
        read: (kind, query = {}) => createReadService(db)(uid, { kind, query: { version: 1, ...query } }) };
}
function walk({ source = 'manual', miles = 1, start = Date.now() - 3_600_000, end = Date.now() - 1_000, runID = null } = {}) {
    return { activityID: randomUUID(), source, startedAtMs: start, endedAtMs: end,
        meters: miles * MILE, elapsedSeconds: source === 'manual' ? 0 : (end - start) / 1000, runID };
}
async function assign(f, { trailID = 'angels_landing', expectedActiveRunID = null, selection = 0 } = {}) {
    const runID = randomUUID();
    const outcome = await f.send('assignVirtualRun', { trailID, runID, expectedActiveRunID }, selection);
    assert.equal(outcome.status, 'accepted');
    return runID;
}

test('native virtual runs keep zero mileage points, one completion point, frozen attribution and independent history', async () => {
    const f = await fixture(), profile = (await f.user.get()).data();
    const runID = await assign(f), payload = walk({ miles: 5, runID });
    const command = f.command('recordActivity', payload);
    const first = await f.execute(command);
    assert.equal(first.revisions.activity, 1); assert.equal(first.revisions.run, 2);
    assert.deepEqual(await f.execute(command), first);
    assert.equal((await f.user.collection('state').doc('progress').get()).get('walkPoints'), 0);
    assert.equal((await f.user.collection('virtualRuns').doc(runID).get()).get('miles'), 5);
    const claim = f.command('claimVirtualRun', { runID }, 2), earned = await f.execute(claim);
    assert.equal(earned.status, 'accepted'); assert.deepEqual(await f.execute(claim), earned);
    assert.equal((await f.send('claimVirtualRun', { runID }, 3)).status, 'conflict');
    assert.equal((await f.user.collection('state').doc('progress').get()).get('walkPoints'), 1);
    assert.equal((await db.collection('leaderboard').doc(publicEntryID(f.uid)).get()).get('totalPoints'), 1);
    const nextRun = await assign(f, { selection: 2 });
    const edit = await f.send('updateActivity', { activityID: payload.activityID, meters: MILE,
        happenedAtMs: payload.endedAtMs, trailName: 'Angels Landing' }, 1);
    assert.equal(edit.status, 'accepted');
    assert.equal((await f.user.collection('virtualRuns').doc(nextRun).get()).get('miles'), 0);
    assert.equal((await f.user.collection('virtualRuns').doc(runID).get()).get('miles'), 5);
    assert.equal((await f.user.collection('state').doc('expedition').get()).get('lifetimeMiles'), 1);
    assert.equal((await f.user.collection('state').doc('progress').get()).get('walkPoints'), 1);
    assert.deepEqual((await f.user.get()).data(), profile);
    const completed = await f.read('completedTrails');
    assert.equal(completed.items.length, 1); assert.equal(completed.items[0].runID, runID);
});

test('independent activity identity survives deletion and operation receipt loss without allowing altered reimports', async () => {
    const f = await fixture(), payload = walk();
    await f.send('recordActivity', payload);
    await f.send('deleteActivity', { activityID: payload.activityID }, 1);
    const deleted = (await f.user.collection('activities').doc(payload.activityID).get()).data();
    assert.equal(deleted.deleted, true); assert.equal(deleted.startedAtMs, undefined);
    assert.equal(deleted.originalMeters, undefined);
    const again = await f.send('recordActivity', payload);
    assert.equal(again.status, 'accepted'); assert.equal(again.revisions.activity, 2);
    assert.equal((await f.user.collection('state').doc('expedition').get()).get('lifetimeMiles'), 0);
    // Simulate only the reconstructible tombstone's TTL; private identity remains.
    await f.user.collection('activities').doc(payload.activityID).delete();
    await assign(f); // A newer selection is not the run whose revision this record command reports.
    const retired = await f.send('recordActivity', payload);
    assert.equal(retired.status, 'accepted'); assert.equal(retired.revisions.activity, 0);
    assert.equal(retired.revisions.activityClaim, 1);
    assert.equal(retired.revisions.run, 0);
    await assert.rejects(f.send('recordActivity', { ...payload, meters: payload.meters + 1 }), { code: 'activity-reused' });
    const claims = await f.read('activityClaims', { activityIDs: [payload.activityID, randomUUID()] });
    assert.deepEqual(claims.claimedIDs, [payload.activityID]);
    assert.equal(claims.fingerprint, undefined);
});

test('overlap checks inspect one interval, survive removal and serialize concurrent competing recordings', async () => {
    const f = await fixture(), start = Date.now() - 3_600_000, end = start + 600_000;
    const a = walk({ source: 'gps', miles: 0.5, start, end });
    const b = walk({ source: 'health', miles: 0.5, start: start + 1_000, end: end + 1_000 });
    const results = await Promise.allSettled([f.send('recordActivity', a), f.send('recordActivity', b)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'overlapping-activity');
    const winner = results[0].status === 'fulfilled' ? a : b;
    await f.send('deleteActivity', { activityID: winner.activityID }, 1);
    await assert.rejects(f.send('recordActivity', { ...winner, activityID: randomUUID() }), { code: 'overlapping-activity' });
    assert.ok(f.reads.filter(read => read.path === 'query').every(read => read.count <= 2)); // One interval or top-two award query.
    const neighbor = walk({ source: 'gps', miles: 0.5, start: winner.endedAtMs, end: winner.endedAtMs + 600_000 });
    assert.equal((await f.send('recordActivity', neighbor)).status, 'accepted');
});

test('zero-length boundary intervals cannot hide a positive interval with the same start', async () => {
    const f = await fixture(), start = Date.now() - 3_600_000;
    const point = { ...walk({ source: 'gps', miles: 0.001, start, end: start }), elapsedSeconds: 1 };
    await f.send('recordActivity', point);
    await f.send('recordActivity', walk({ source: 'gps', miles: 0.5, start, end: start + 600_000 }));
    await assert.rejects(f.send('recordActivity', walk({ source: 'gps', miles: 0.1,
        start: start + 60_000, end: start + 120_000 })), { code: 'overlapping-activity' });
});

test('selection revisions ignore distance changes while stale selections and forged completion facts fail', async () => {
    const f = await fixture(), run = await assign(f);
    await assert.rejects(f.send('claimVirtualRun', { runID: run }, 1), { code: 'incomplete-expedition' });
    await f.send('recordActivity', walk({ runID: run }));
    assert.equal((await f.user.collection('state').doc('expedition').get()).get('selectionRevision'), 1);
    const replacement = await assign(f, { expectedActiveRunID: run, selection: 1 });
    assert.equal((await f.user.collection('virtualRuns').doc(run).get()).get('status'), 'abandoned');
    assert.equal((await f.send('recordActivity', walk({ runID: run }))).status, 'conflict');
    assert.equal((await f.send('assignVirtualRun', { trailID: 'angels_landing', runID: randomUUID(), expectedActiveRunID: run }, 1)).status, 'conflict');
    await assert.rejects(f.send('recordActivity', { ...walk({ runID: replacement }), points: 1000 }), { code: 'invalid' });
    await assert.rejects(f.send('recordActivity', walk({ miles: 15.01, runID: replacement })), { code: 'invalid' });
});

test('recorded corrections cap against original measurement and cannot turn a display rename into new run credit', async () => {
    const f = await fixture(), runID = await assign(f);
    const payload = walk({ source: 'pedometer', runID });
    await f.send('recordActivity', payload);
    const edit = { activityID: payload.activityID, meters: 0.5 * MILE, happenedAtMs: payload.endedAtMs, trailName: 'Personal label' };
    assert.equal((await f.send('updateActivity', edit, 1)).status, 'accepted');
    assert.equal((await f.send('updateActivity', edit, 1)).status, 'conflict');
    await assert.rejects(f.send('updateActivity', { ...edit, meters: 2 * MILE }, 2), { code: 'invalid' });
    assert.equal((await f.send('updateActivity', { ...edit, meters: MILE }, 2)).status, 'accepted');
    const saved = (await f.user.collection('activities').doc(payload.activityID).get()).data();
    assert.equal(saved.originalMeters, MILE); assert.equal(saved.runID, runID);
    assert.equal((await f.user.collection('virtualRuns').doc(runID).get()).get('miles'), 1);
    assert.equal((await f.user.collection('state').doc('progress').get()).get('walkPoints'), 0);
});

test('owner reads contain bounded selected records, fifty-row history and only candidate import identities', async () => {
    const f = await fixture(), foreign = await fixture(), runID = await assign(f);
    const payload = walk({ runID });
    await f.send('recordActivity', payload);
    const current = await f.read('expedition', { activityID: payload.activityID });
    assert.equal(current.activityClaimed, true); assert.equal(current.activity.id, payload.activityID);
    assert.equal(current.runs.length, 1); assert.equal(current.runs[0].id, runID);
    assert.equal(current.activity.rawSamples, undefined);
    const other = await foreign.read('expedition', { activityID: payload.activityID, runID });
    assert.equal(other.activity, null); assert.equal(other.activityClaimed, false); assert.deepEqual(other.runs, []);
    await assert.rejects(f.read('activityClaims', { activityIDs: Array.from({ length: 101 }, randomUUID) }), { code: 'invalid' });
    const seed = db.batch(), now = Date.now();
    const seedRecord = (await f.user.collection('activities').doc(payload.activityID).get()).data();
    for (let index = 0; index < 60; index++) {
        const id = randomUUID();
        seed.set(f.user.collection('activities').doc(id), { ...seedRecord, id, happenedAtMs: now - index });
    }
    await seed.commit();
    const first = await f.read('activityHistory');
    const second = await f.read('activityHistory', { before: first.next });
    assert.equal(first.items.length, 50); assert.equal(second.items.length, 11); assert.equal(second.next, null);
    assert.ok(!f.reads.some(read => read.path.endsWith('/history')));
});
