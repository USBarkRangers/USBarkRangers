'use strict';

// Retires only the disposable native QA fixture after both CLI and iOS SDK checks.
// Keeps synthetic evidence documents; never disables an owner/beta account.
const assert = require('node:assert/strict');
const { readFileSync, unlinkSync } = require('node:fs');
const { resolve } = require('node:path');
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const { assertNativeProject } = require('./check-native-firebase-project.cjs');

async function main() {
    assertNativeProject(process.argv[2]);
    assert.equal(process.argv.length, 3);
    assert.equal(process.cwd(), resolve(__dirname, '../..'));
    assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
    const path = resolve('06-config/native-ios/cloud-acceptance.local.json');
    const fixture = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(fixture.project, 'bark-ranger-ios');
    assert(/^cloud-acceptance-[a-f0-9-]+@native\.invalid$/.test(fixture.email));
    const base = 'projects/360077919845/apps/1:360077919845:ios:cd94b1ea6899f95da6e88c/debugTokens/';
    assert(fixture.registration.startsWith(base));
    assert(/^[A-Za-z0-9_-]+$/.test(fixture.uid));
    auth.setRefreshToken(auth.getProjectDefaultAccount(process.cwd()).tokens.refresh_token);
    const identity = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', auth: true });
    const accountPath = '/v1/projects/bark-ranger-ios/accounts:';
    const users = (await identity.post(accountPath + 'lookup', { localId: [fixture.uid] })).body.users;
    assert.equal(users?.length, 1);
    assert.equal(users[0].email, fixture.email, 'Fixture identity must still match exactly');
    const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true });
    const entitlement = 'projects/bark-ranger-ios/databases/(default)/documents/users/'
        + fixture.uid + '/state/entitlement';
    const document = (await firestore.get('/v1/' + entitlement)).body;
    assert.equal(document.fields.source.stringValue, 'development');
    assert.equal(document.fields.developmentUID.stringValue, fixture.uid);
    const revision = Number(document.fields.revision.integerValue);
    assert(Number.isSafeInteger(revision) && revision < Number.MAX_SAFE_INTEGER);
    await firestore.post('/v1/projects/bark-ranger-ios/databases/(default)/documents:commit', { writes: [{
        update: { name: entitlement, fields: { premium: { booleanValue: false },
            revision: { integerValue: String(revision + 1) }, updatedAt: { timestampValue: new Date().toISOString() } } },
        updateMask: { fieldPaths: ['premium', 'revision', 'updatedAt'] },
        currentDocument: { updateTime: document.updateTime },
    }] });
    await identity.post(accountPath + 'update', { localId: fixture.uid, disableUser: true,
        validSince: Math.floor(Date.now() / 1000) });
    const check = new Client({ urlPrefix: 'https://firebaseappcheck.googleapis.com', auth: true });
    try { await check.delete('/v1/' + fixture.registration); }
    catch (error) { if (error.status !== 404) throw error; }
    const confirmed = (await identity.post(accountPath + 'lookup', { localId: [fixture.uid] })).body.users;
    assert.equal(confirmed?.[0]?.disabled, true);
    unlinkSync(path);
    console.log('Disposable native QA account disabled, grant revoked, debug registration removed; private fixture deleted. Evidence documents retained.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
