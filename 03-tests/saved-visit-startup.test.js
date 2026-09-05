const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../01-code/app/core/app.v144.js'), 'utf8');

function harness({ ready = false, remembered = 'account-a', authReady = false } = {}) {
    let now = 0;
    let parks = ready ? [{ id: 'park' }] : [];
    let rememberedUid = remembered;
    let user = null;
    const timers = new Map();
    let nextTimer = 0;
    const listeners = new Set();
    const events = {};
    const calls = [];
    const context = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            addEventListener(name, fn) { events[name] = fn; },
            getElementById() { return null; },
            body: { classList: { add() {}, remove() {} } }
        },
        firebase: { auth: () => ({ currentUser: user }) },
        setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        map: {},
        BARK: {
            loadData() { calls.push('parks-requested'); },
            repos: { ParkRepo: {
                getAll: () => parks,
                subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
            } },
            services: {
                auth: {
                    initFirebase: () => authReady ? Promise.resolve() : new Promise(() => {}),
                    activateOfflinePremiumSession() { calls.push('premium'); }
                },
                checkin: {
                    getRememberedAuthenticatedVisitUid: () => rememberedUid,
                    forgetAuthenticatedVisitUid() { rememberedUid = null; },
                    hydrateRememberedUnconfirmedVisits() { calls.push('baseline-and-adds'); }
                },
                firebase: {
                    hydrateRememberedPendingVisitDeletions(uid) { calls.push(`deletes:${uid}`); }
                }
            }
        }
    };
    context.window = context;
    vm.runInNewContext(source, context);
    return {
        context, calls, events, listeners,
        get rememberedUid() { return rememberedUid; },
        setUser(uid) { user = uid ? { uid } : null; },
        remember(uid) { rememberedUid = uid; },
        start: () => context.BARK.savedVisitStartup.start(),
        parksReady() { parks = [{ id: 'park' }]; for (const fn of listeners) fn(); },
        advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) { timers.delete(id); timer.fn(); }
            }
        }
    };
}

test('saved projection waits one second after parks, independently of stalled cloud initialization', async () => {
    const h = harness();
    h.events.DOMContentLoaded();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    h.advance(3000);
    assert.deepEqual(h.calls, ['parks-requested']);
    h.parksReady();
    h.advance(999);
    assert.deepEqual(h.calls, ['parks-requested']);
    h.advance(1);
    assert.deepEqual(h.calls, ['parks-requested', 'baseline-and-adds', 'deletes:account-a']);
    h.advance(10000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(h.calls.filter(x => x === 'baseline-and-adds').length, 1);
    assert.equal(h.calls.at(-1), 'premium', 'Premium keeps its existing later deadline');
});

test('Firebase setup returning before auth does not bypass the one-second grace', async () => {
    const h = harness({ ready: true, authReady: true });
    await h.events.DOMContentLoaded();
    assert.deepEqual(h.calls, ['parks-requested']);
    h.advance(1000);
    assert.deepEqual(h.calls, ['parks-requested', 'baseline-and-adds', 'deletes:account-a']);
});

test('fast server confirmation prevents stale local restoration', () => {
    const h = harness({ ready: true });
    h.start();
    h.setUser('account-a');
    h.context._authStateResolved = true;
    h.context._visitedPlacesServerSnapshotReceived = true;
    h.advance(1000);
    assert.deepEqual(h.calls, []);
});

test('cached auth for the same account still allows saved display while server is unavailable', () => {
    const h = harness({ ready: true });
    h.start();
    h.setUser('account-a');
    h.context._authStateResolved = true;
    h.advance(1000);
    assert.deepEqual(h.calls, ['baseline-and-adds', 'deletes:account-a']);
});

for (const change of ['different-user', 'signed-out', 'forgotten', 'changed-pointer', 'account-chooser']) {
    test(`startup cannot restore old history after ${change}`, () => {
        const h = harness({ ready: true });
        h.start();
        if (change === 'different-user') h.setUser('account-b');
        if (change === 'signed-out') h.context._authStateResolved = true;
        if (change === 'forgotten') h.remember(null);
        if (change === 'changed-pointer') h.remember('account-b');
        if (change === 'account-chooser') h.context.BARK.auth = { forceGoogleAccountChooserOnNextSignIn: true };
        h.advance(1000);
        assert.deepEqual(h.calls, []);
    });
}

test('sign-out click cancels pending restoration and prevents remembered hydration on reload', () => {
    const h = harness({ ready: true });
    h.start();
    h.events.click({ target: { closest: () => ({ id: 'account-signout-btn' }) } });
    h.advance(1000);
    assert.deepEqual(h.calls, []);
    assert.equal(h.rememberedUid, null);
    const reloaded = harness({ ready: true, remembered: h.rememberedUid });
    reloaded.start();
    reloaded.advance(1000);
    assert.deepEqual(reloaded.calls, []);
});

test('first install without remembered account does not invent visits', () => {
    const h = harness({ remembered: null });
    h.start();
    h.parksReady();
    h.advance(10000);
    assert.deepEqual(h.calls, []);
    assert.equal(h.listeners.size, 0);
});

test('repeated catalog refresh does not reschedule or repeat restoration', () => {
    const h = harness();
    h.start();
    h.parksReady();
    h.advance(500);
    h.parksReady();
    h.advance(500);
    h.parksReady();
    h.advance(5000);
    assert.deepEqual(h.calls, ['baseline-and-adds', 'deletes:account-a']);
    assert.equal(h.listeners.size, 0);
});
