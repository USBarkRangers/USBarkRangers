'use strict';

// Local UI-test fixture only. No production credentials, SDK defaults or grant endpoint.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
const email = 'profile-ui@native.invalid';
const password = 'NativeOnly123!';
async function json(url, body, authorization) {
    const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const value = await response.json();
    if (response.status !== 200) {
        const error = new Error(`Fixture request failed (${response.status})`);
        error.code = value.error?.message;
        throw error;
    }
    return value;
}
(async () => {
    let account;
    try {
        account = await json('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
            { email, password, returnSecureToken: true });
    } catch (error) {
        if (error.code !== 'EMAIL_EXISTS') throw error;
        account = await json('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
            { email, password, returnSecureToken: true });
    }
    await json('http://127.0.0.1:5108/demo-bark-native/us-east1/nativeCommand', {
        data: { version: 1, operationID: randomUUID(), createdAtMs: Date.now(), kind: 'bootstrapAccount', expectedRevision: 0, payload: {} },
    }, `Bearer ${account.idToken}`);
    assert.match(account.localId, /^[a-zA-Z0-9_-]+$/);
    const entitlementURL = `http://127.0.0.1:8188/v1/projects/demo-bark-native/databases/(default)/documents/users/${account.localId}/state/entitlement`;
    const current = await fetch(entitlementURL, { headers: { authorization: 'Bearer owner' }, signal: AbortSignal.timeout(15_000) });
    assert.ok(current.status === 200 || current.status === 404);
    const revision = current.status === 200 ? Number((await current.json()).fields.revision.integerValue) + 1 : 1;
    assert.ok(Number.isSafeInteger(revision) && revision > 0);
    const response = await fetch(entitlementURL, {
        method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ fields: {
            schemaVersion: { integerValue: '1' }, revision: { integerValue: String(revision) },
            premium: { booleanValue: true }, source: { stringValue: 'app-store-production' },
            validUntil: { timestampValue: new Date(Date.now() + 3_600_000).toISOString() },
        } }),
    });
    assert.equal(response.status, 200);
    console.log('Isolated native profile UI account ready.');
})().catch(error => { console.error(error); process.exitCode = 1; });
