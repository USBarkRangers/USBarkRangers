'use strict';

// Explicit, small live acceptance run. Creates one disposable account and one
// private debug registration; no owner password, service-account key or public grant API.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { existsSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { assertNativeProject } = require('./check-native-firebase-project.cjs');
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const { planningNoteID } = require('../../01-code/functions-native/trips/identity');
const { storageID } = require('../../01-code/functions-native/shared/placeIdentity');

async function main() {
    assertNativeProject(process.argv[2]);
    assert.equal(process.argv.length, 3);
    assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
    assert(!existsSync('06-config/native-ios/cloud-acceptance.local.json'),
        'An acceptance fixture already exists; reuse or explicitly retire it before creating another.');
    const owner = auth.getProjectDefaultAccount(process.cwd());
    auth.setRefreshToken(owner.tokens.refresh_token);
    const apiKey = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :API_KEY',
        '06-config/native-ios/GoogleService-Info.plist'], { encoding: 'utf8' }).trim();
    const check = new Client({ urlPrefix: 'https://firebaseappcheck.googleapis.com', auth: true });
    const base = '/v1/projects/360077919845/apps/1:360077919845:ios:cd94b1ea6899f95da6e88c';
    const debugToken = randomUUID();
    const registration = (await check.post(base + '/debugTokens', {
        displayName: 'Disposable cloud acceptance — 2026-09-14', token: debugToken })).body.name;
    const exchange = await fetch(`https://firebaseappcheck.googleapis.com${base}:exchangeDebugToken?key=${apiKey}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ debugToken }) });
    assert.equal(exchange.status, 200, 'App Check exchange');
    const appCheckToken = (await exchange.json()).token;
    const email = `cloud-acceptance-${randomUUID()}@native.invalid`, password = randomUUID() + randomUUID();
    const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }) });
    assert.equal(signUp.status, 200, 'Live email registration');
    const account = await signUp.json(), uid = account.localId;
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${account.idToken}`,
        'X-Firebase-AppCheck': appCheckToken };
    async function send(endpoint, data, requestHeaders = headers) {
        const response = await fetch(`https://us-east1-bark-ranger-ios.cloudfunctions.net/${endpoint}`, {
            method: 'POST', headers: requestHeaders, body: JSON.stringify({ data }) });
        const body = await response.json();
        return { status: response.status, body };
    }
    const command = (kind, expectedRevision = 0, payload = {}) => ({ version: 1,
        operationID: randomUUID(), createdAtMs: Date.now(), kind, expectedRevision, payload });
    assert.equal((await send('nativeCommand', command('bootstrapAccount'),
        { 'content-type': 'application/json', authorization: headers.authorization })).status, 401);
    assert.equal((await send('nativeCommand', command('bootstrapAccount'),
        { 'content-type': 'application/json', 'X-Firebase-AppCheck': appCheckToken })).status, 401);
    const bootstrap = await send('nativeCommand', command('bootstrapAccount'));
    assert.equal(bootstrap.body.result?.status, 'accepted', JSON.stringify(bootstrap));
    assert.equal((await send('nativeCommand', command('updateProfile', 1, { displayName: 'Must stay free' }))).status, 403);
    const documents = 'https://firestore.googleapis.com/v1/projects/bark-ranger-ios/databases/(default)/documents';
    const forged = await fetch(`${documents}/users/${uid}/state/entitlement`, {
        method: 'PATCH', headers, body: JSON.stringify({ fields: { premium: { booleanValue: true } } }) });
    assert.equal(forged.status, 403, 'Client cannot grant paid access');
    const admin = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true });
    const now = new Date(), expiry = new Date(now.getTime() + 3600_000);
    await admin.post('/v1/projects/bark-ranger-ios/databases/(default)/documents:commit', { writes: [{
        update: { name: `projects/bark-ranger-ios/databases/(default)/documents/users/${uid}/state/entitlement`, fields: {
            schemaVersion: { integerValue: '1' }, revision: { integerValue: '2' }, premium: { booleanValue: true },
            source: { stringValue: 'development' }, developmentUID: { stringValue: uid },
            developmentGrantedAt: { timestampValue: now.toISOString() }, validUntil: { timestampValue: expiry.toISOString() },
            updatedAt: { timestampValue: now.toISOString() } } }, currentDocument: { exists: true } }] });
    const tripID = randomUUID(), stopID = 'acceptance-stop', noteID = planningNoteID(tripID, stopID);
    const place = { kind: 'custom', id: randomUUID() };
    const trip = { tripID, name: 'Cloud acceptance evidence', start: null, end: null,
        days: [{ id: 'day-one', notes: '', color: '#475569', stops: [{ id: stopID, placeIdentity: place,
            placeID: storageID(place), name: 'Private acceptance pin', coordinate: { latitude: 41, longitude: -81 }, state: 'Ohio', noteID }] }],
        notes: [{ id: noteID, expectedRevision: 0, text: 'Saved on the real backend 🐕' }] };
    const saved = await send('nativeCommand', command('saveTrip', 0, trip));
    assert.equal(saved.body.result?.status, 'accepted', JSON.stringify(saved));
    const noteCommand = command('saveTripNotes', 1, { tripID,
        notes: [{ id: noteID, stopID, expectedRevision: 1, text: 'Note-only cloud acceptance' }] });
    const note = await send('nativeCommand', noteCommand);
    assert.equal(note.body.result?.status, 'accepted', JSON.stringify(note));
    assert.deepEqual((await send('nativeCommand', noteCommand)).body, note.body, 'Receipt retry is exact');
    const detail = await send('nativeRead', { kind: 'trip', query: { version: 1, tripID } });
    assert.equal(detail.body.result?.notes[0]?.text, 'Note-only cloud acceptance', JSON.stringify(detail));
    const fixture = { project: 'bark-ranger-ios', uid, email, password, debugToken, registration, expiresAt: expiry.toISOString(), tripID };
    writeFileSync('06-config/native-ios/cloud-acceptance.local.json', JSON.stringify(fixture), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ cloudAcceptance: 'passed', uid, tripID, expiresAt: expiry.toISOString(),
        verified: ['real sign-up', 'App Check required', 'authentication required', 'free write denied',
            'direct entitlement write denied', 'trip and note save', 'exact replay', 'server persistence'],
        privateFixture: '06-config/native-ios/cloud-acceptance.local.json' }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
