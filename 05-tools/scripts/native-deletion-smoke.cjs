'use strict';

// Consumes ONLY the disposable account created by native-cloud-smoke.cjs.
// Never accepts a caller-supplied UID/email or targets an owner/beta account.
const assert = require('node:assert/strict');
const { readFileSync, unlinkSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const { publicEntryID } = require('../../01-code/functions-native/profile/commands');
const { assertNativeProject } = require('./check-native-firebase-project.cjs');

async function main() {
    assertNativeProject(process.argv[2]);
    assert.equal(process.argv.length, 3);
    assert.equal(process.cwd(), resolve(__dirname, '../..'));
    assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
    const file = '06-config/native-ios/cloud-acceptance.local.json';
    const fixture = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(fixture.project, 'bark-ranger-ios');
    assert(/^cloud-acceptance-[a-f0-9-]+@native\.invalid$/.test(fixture.email));
    assert(/^[A-Za-z0-9_-]+$/.test(fixture.uid));
    assert(Date.parse(fixture.expiresAt) > Date.now());
    const app = '/v1/projects/360077919845/apps/1:360077919845:ios:cd94b1ea6899f95da6e88c';
    assert(fixture.registration.startsWith(app.slice(4) + '/debugTokens/'));
    auth.setRefreshToken(auth.getProjectDefaultAccount(process.cwd()).tokens.refresh_token);
    const identity = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', auth: true });
    const users = (await identity.post('/v1/projects/bark-ranger-ios/accounts:lookup', { localId: [fixture.uid] })).body.users;
    assert.equal(users?.length, 1);
    assert.equal(users[0].email, fixture.email);
    const apiKey = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :API_KEY',
        '06-config/native-ios/GoogleService-Info.plist'], { encoding: 'utf8' }).trim();
    async function json(url, body, headers = {}) {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
        return { status: response.status, body: await response.json() };
    }
    const signIn = await json(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        { email: fixture.email, password: fixture.password, returnSecureToken: true });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.localId, fixture.uid);
    const check = await json(`https://firebaseappcheck.googleapis.com${app}:exchangeDebugToken?key=${apiKey}`, { debugToken: fixture.debugToken });
    assert.equal(check.status, 200);
    const headers = { authorization: `Bearer ${signIn.body.idToken}`, 'X-Firebase-AppCheck': check.body.token };
    const endpoint = 'https://us-east1-bark-ranger-ios.cloudfunctions.net/nativeDeleteAccount';
    assert.equal((await json(endpoint, { data: { version: 1, confirmed: true } })).status, 401);
    assert.equal((await json(endpoint, { data: { version: 1, confirmed: false } }, headers)).status, 400);
    assert.equal((await json(endpoint, { data: { version: 1, confirmed: true, uid: 'not-this-account' } }, headers)).status, 400);
    const accepted = await json(endpoint, { data: { version: 1, confirmed: true } }, headers);
    assert.equal(accepted.body.result?.status, 'accepted');
    assert(['accepted', 'complete'].includes((await json(endpoint, { data: { version: 1, confirmed: true } }, headers)).body.result?.status));
    const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true });
    const documents = '/v1/projects/bark-ranger-ios/databases/(default)/documents';
    const jobPath = `${documents}/nativeAccountDeletions/${fixture.uid}`;
    try {
        const profile = (await firestore.get(`${documents}/users/${fixture.uid}`)).body;
        assert.equal(profile.fields.status.stringValue, 'deleting');
    } catch (error) { assert.equal(error.status, 404, 'Only already-finished deletion can remove the profile'); }
    const pending = (await firestore.post(documents + ':runQuery', { structuredQuery: {
        from: [{ collectionId: 'nativeAccountDeletions' }], where: { fieldFilter: {
            field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } }, limit: 2,
    } })).body.filter(row => row.document).map(row => row.document.name.split('/').pop());
    assert(pending.every(uid => uid === fixture.uid), 'Do not manually advance cleanup for another account during QA.');
    const scheduler = new Client({ urlPrefix: 'https://cloudscheduler.googleapis.com', auth: true });
    const schedules = (await scheduler.get('/v1/projects/bark-ranger-ios/locations/us-east1/jobs')).body.jobs ?? [];
    const schedule = schedules.find(job => job.name.endsWith('/firebase-schedule-nativeAccountCleanup-us-east1'));
    assert(schedule, 'Find the actual deployed cleanup schedule, not a guessed job target.');
    const unauthenticated = await fetch(schedule.httpTarget.uri, { method: 'POST', signal: AbortSignal.timeout(40_000) });
    assert([401, 403].includes(unauthenticated.status), 'Cleanup worker must not be publicly invocable');
    if (pending.length) await scheduler.post('/v1/' + schedule.name + ':run', {});
    let completed = false;
    for (let attempt = 0; attempt < 60; attempt++) {
        const job = (await firestore.get(jobPath)).body;
        if (job.fields.status.stringValue === 'complete') { completed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    assert(completed, 'Cleanup did not finish; retain the disposable fixture for investigation.');
    const remainingAuth = (await identity.post('/v1/projects/bark-ranger-ios/accounts:lookup', { localId: [fixture.uid] })).body.users ?? [];
    assert.equal(remainingAuth.length, 0);
    async function missing(path) {
        try { await firestore.get(path); assert.fail('Expected deleted document: ' + path); }
        catch (error) { assert.equal(error.status, 404); }
    }
    await missing(`${documents}/users/${fixture.uid}`);
    await missing(`${documents}/users/${fixture.uid}/trips/${fixture.tripID}/content/itinerary`);
    await missing(`${documents}/leaderboard/${publicEntryID(fixture.uid)}`);
    const subcollections = (await firestore.post(`${documents}/users/${fixture.uid}:listCollectionIds`, {})).body.collectionIds ?? [];
    assert.deepEqual(subcollections, []);
    const receipts = (await firestore.post(documents + ':runQuery', { structuredQuery: {
        from: [{ collectionId: 'nativeOperationReceipts' }], where: { fieldFilter: {
            field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: fixture.uid } } }, limit: 1,
    } })).body.filter(row => row.document);
    assert.equal(receipts.length, 0);
    // Already-issued ID tokens cannot recreate the deleted account while still cryptographically valid.
    const replay = await json('https://us-east1-bark-ranger-ios.cloudfunctions.net/nativeCommand', {
        data: { version: 1, operationID: randomUUID(), createdAtMs: Date.now(), kind: 'bootstrapAccount', expectedRevision: 0, payload: {} },
    }, headers);
    assert(['account-deleting', 'unauthenticated'].includes(replay.body.error?.details?.reason) || replay.status === 401);
    await missing(`${documents}/users/${fixture.uid}`);
    const appCheck = new Client({ urlPrefix: 'https://firebaseappcheck.googleapis.com', auth: true });
    await appCheck.delete('/v1/' + fixture.registration);
    unlinkSync(file);
    console.log('Native live deletion passed: guarded callable, private worker, Auth, nested data, receipts and token replay. Disposable fixture and debug registration removed.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
