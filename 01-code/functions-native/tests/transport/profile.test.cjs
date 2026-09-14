'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { planningNoteID } = require('../../trips/identity');

// All addresses are fixed loopback demo resources; this suite never uses owner credentials.
assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
const commandURL = 'http://127.0.0.1:5108/demo-bark-native/us-east1/nativeCommand';
const documents = 'http://127.0.0.1:8188/v1/projects/demo-bark-native/databases/(default)/documents';

async function account() {
    const response = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${randomUUID()}@bark-native.invalid`, password: randomUUID(), returnSecureToken: true }),
    });
    assert.equal(response.status, 200);
    const value = await response.json();
    return { uid: value.localId, headers: { authorization: `Bearer ${value.idToken}`, 'content-type': 'application/json' } };
}
function command(kind, expectedRevision = 0, payload = {}) {
    return { version: 1, operationID: randomUUID(), createdAtMs: Date.now(), kind, expectedRevision, payload };
}
async function send(actor, input) {
    const response = await fetch(commandURL, { method: 'POST', headers: actor?.headers ?? { 'content-type': 'application/json' },
        body: JSON.stringify({ data: input }) });
    return { status: response.status, body: await response.json() };
}

test('actual callable auth and Firestore rules isolate native profiles end to end', async () => {
    const a = await account();
    const b = await account();
    const create = command('bootstrapAccount');
    assert.equal((await send(null, create)).status, 401);
    const first = await send(a, create);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.result.status, 'accepted');
    assert.deepEqual(await send(a, create), first);
    const own = await fetch(`${documents}/users/${a.uid}`, { headers: a.headers });
    assert.equal(own.status, 200);
    assert.equal((await own.json()).fields.displayName.stringValue, 'Ranger');
    const entitlement = await fetch(`${documents}/users/${a.uid}/state/entitlement`, { headers: a.headers });
    assert.equal(entitlement.status, 200);
    assert.equal((await entitlement.json()).fields.premium.booleanValue, false);
    assert.equal((await fetch(`${documents}/users/${a.uid}`, { headers: b.headers })).status, 403);
    assert.equal((await fetch(`${documents}/users/${a.uid}`)).status, 403);
    assert.equal((await fetch(`${documents}/users`, { headers: a.headers })).status, 403);
    assert.equal((await fetch(`${documents}/users/${a.uid}/commandLimits/bootstrap`, { headers: a.headers })).status, 403);
    assert.equal((await fetch(`${documents}/nativeOperationReceipts`, { headers: a.headers })).status, 403);
    for (const resource of ['visits', 'activities', 'activityClaims', 'virtualRuns', 'leaderboardCache', 'trips', 'notes', 'places']) {
        // Native history/rank access goes through owner-validated bounded reads;
        // client SDKs cannot bypass paging/admission or forge private authority.
        assert.equal((await fetch(`${documents}/users/${a.uid}/${resource}`, { headers: a.headers })).status, 403);
        assert.equal((await fetch(`${documents}/users/${a.uid}/${resource}/forged`, {
            method: 'PATCH', headers: a.headers, body: JSON.stringify({ fields: { revision: { integerValue: '1' } } }),
        })).status, 403);
    }
    const forge = await fetch(`${documents}/users/${a.uid}/state/entitlement`, { method: 'PATCH', headers: a.headers,
        body: JSON.stringify({ fields: { premium: { booleanValue: true } } }) });
    assert.equal(forge.status, 403);
    const freeEdit = await send(a, command('updateProfile', 1, { displayName: 'Not paid' }));
    assert.equal(freeEdit.status, 403);
    assert.equal(freeEdit.body.error.details.reason, 'premium-required');
    const noteSave = command('saveTripNotes', 1, { tripID: 'trip', notes: [
        { id: planningNoteID('trip', 'stop'), stopID: 'stop', expectedRevision: 1, text: 'Private' }] });
    assert.equal((await send(null, noteSave)).status, 401);
    const freeNoteSave = await send(a, noteSave);
    assert.equal(freeNoteSave.status, 403);
    assert.equal(freeNoteSave.body.error.details.reason, 'premium-required');
    assert.equal((await send(a, { ...create, payload: { uid: b.uid } })).status, 400);
});
