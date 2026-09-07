const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../01-code/app/core/app.v145.js'), 'utf8');

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

for (const authReady of [false, true]) {
    test(`early offline editing activates while auth setup ready=${authReady}`, async () => {
        const h = harness({ ready: true, authReady });
        h.events.DOMContentLoaded();
        for (let i = 0; i < 40; i++) await Promise.resolve();
        h.advance(999);
        assert.deepEqual(h.calls, ['parks-requested']);
        h.advance(1);
        assert.deepEqual(h.calls, ['parks-requested', 'premium', 'baseline-and-adds', 'deletes:account-a']);
    });
}
test('offline entitlement UI failure does not block saved pin recovery', () => {
    const h = harness({ ready: true });
    h.context.BARK.services.auth.activateOfflinePremiumSession = () => { throw new Error('UI unavailable'); };
    h.start(); h.advance(1000);
    assert.deepEqual(h.calls, ['baseline-and-adds', 'deletes:account-a']);
});
test('resolved sign-out cannot activate early offline access', () => {
    const h = harness({ ready: true });
    h.start(); h.context._authStateResolved = true; h.advance(1000);
    assert.deepEqual(h.calls, []);
});
