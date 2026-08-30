const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', '01-code', 'app', 'core', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_PATH, 'utf8');

function createHarness(initFirebase, calls = [], checkinService = null, firebaseService = null) {
    let domReadyHandler = null;
    const timers = [];
    const clearedTimers = new Set();

    const context = {
        window: {
            map: {},
            BARK: {
                services: {
                    auth: { initFirebase },
                    ...(checkinService ? { checkin: checkinService } : {}),
                    ...(firebaseService ? { firebase: firebaseService } : {})
                },
                loadData() { calls.push('loadData'); }
            }
        },
        document: {
            body: { classList: { add() {}, remove() {} } },
            addEventListener(type, handler) {
                if (type === 'DOMContentLoaded') domReadyHandler = handler;
            },
            getElementById() { return null; }
        },
        console: { log() {}, warn() {}, error() {} },
        setTimeout(callback, delay) {
            const id = timers.length + 1;
            timers.push({ id, callback, delay });
            return id;
        },
        clearTimeout(id) { clearedTimers.add(id); },
        Promise
    };
    context.window.window = context.window;
    vm.runInNewContext(APP_SOURCE, context, { filename: APP_PATH });

    return {
        calls,
        timers,
        clearedTimers,
        start() {
            assert.equal(typeof domReadyHandler, 'function');
            return domReadyHandler();
        }
    };
}

async function flushPromises() {
    // The real boot intentionally awaits each optional initializer in order.
    // Most are absent in this focused harness, but each await still consumes a
    // microtask before Firebase is reached.
    for (let index = 0; index < 30; index++) await Promise.resolve();
}

test('fake-online Firebase stall releases cached park loading after ten seconds', async () => {
    const harness = createHarness(() => new Promise(() => {}));
    const bootPromise = harness.start();
    await flushPromises();

    assert.deepEqual(harness.calls, []);
    const firebaseTimeout = harness.timers.find(timer => timer.delay === 10000);
    assert.ok(firebaseTimeout, 'boot must install the bounded Firebase wait');

    firebaseTimeout.callback();
    await bootPromise;
    assert.deepEqual(harness.calls, ['loadData']);
});

test('normal Firebase startup preserves the existing auth-before-data order', async () => {
    const calls = [];
    const harness = createHarness(async () => { calls.push('firebase'); }, calls);

    await harness.start();
    assert.deepEqual(calls, ['firebase', 'loadData']);
});

test('Firebase recovery after the timeout does not reload or replace cached park data', async () => {
    let finishFirebase;
    const harness = createHarness(() => new Promise(resolve => { finishFirebase = resolve; }));
    const bootPromise = harness.start();
    await flushPromises();

    harness.timers.find(timer => timer.delay === 10000).callback();
    await bootPromise;
    assert.deepEqual(harness.calls, ['loadData']);

    finishFirebase();
    await flushPromises();
    assert.deepEqual(harness.calls, ['loadData']);
});

test('fake-service timeout hydrates pending orange visits before cached park data', async () => {
    const calls = [];
    const harness = createHarness(
        () => new Promise(() => {}),
        calls,
        {
            getRememberedAuthenticatedVisitUid() { return 'remembered-user'; },
            hydrateRememberedUnconfirmedVisits() { calls.push('hydrateOrange'); }
        },
        {
            hydrateRememberedPendingVisitDeletions(uid) { calls.push(`hydrateDelete:${uid}`); }
        }
    );
    const bootPromise = harness.start();
    await flushPromises();

    harness.timers.find(timer => timer.delay === 10000).callback();
    await bootPromise;
    assert.deepEqual(calls, ['hydrateOrange', 'hydrateDelete:remembered-user', 'loadData']);
});
