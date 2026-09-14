'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandCallable, IOS_APP_ID } = require('../runtime/callable');
const { NativeError } = require('../shared/errors');

const runtime = { projectID: 'bark-ranger-ios', emulator: false };
function request() {
    return { auth: { uid: 'caller', token: { aud: runtime.projectID,
        iss: `https://securetoken.google.com/${runtime.projectID}`, firebase: { sign_in_provider: 'password' } } },
    app: { appId: IOS_APP_ID }, rawRequest: { rawBody: Buffer.from('{"data":{}}') }, data: { version: 1 } };
}

test('callable refuses missing/cross-project/anonymous auth, unregistered apps and oversized bodies before storage', async () => {
    let calls = 0;
    const handler = createCommandCallable({ runtime, execute: async () => { calls++; } });
    const changes = [r => { r.auth = null; }, r => { r.auth.token.aud = 'barkrangermap-auth'; },
        r => { r.auth.token.iss = 'other'; }, r => { r.auth.token.firebase.sign_in_provider = 'anonymous'; },
        r => { r.app = null; }, r => { r.app.appId = 'another-app'; }, r => { r.auth.uid = 'users/injected'; },
        r => { r.rawRequest.rawBody = Buffer.alloc(401_025); }];
    for (const change of changes) {
        const value = request(); change(value);
        await assert.rejects(handler(value), error => ['unauthenticated', 'permission-denied', 'invalid-argument'].includes(error.code));
    }
    assert.equal(calls, 0);
});

test('callable forwards only verified identity and gives a versioned, privacy-safe failure contract', async () => {
    const value = request();
    const handler = createCommandCallable({ runtime, execute: async (uid, input) => ({ uid, input }) });
    assert.deepEqual(await handler(value), { uid: 'caller', input: value.data });
    const rejected = createCommandCallable({ runtime, execute: async () => {
        throw new NativeError('rate-limited', 'Retry shortly.', { retryAfterMs: 1000 });
    } });
    await assert.rejects(rejected(value), error => error.code === 'resource-exhausted'
        && error.details.reason === 'rate-limited' && error.details.retryAfterMs === 1000);
    const logged = [];
    const failed = createCommandCallable({ runtime, execute: async () => { throw new Error('private payload'); },
        reportFailure: event => logged.push(event) });
    await assert.rejects(failed(value), error => error.code === 'unavailable' && !error.message.includes('private'));
    assert.deepEqual(logged, [{ event: 'native-command-failed', reason: 'internal' }]);
});
