const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', '01-code', 'app', 'modules', 'errorReporter.js'),
    'utf8'
);

test('freeze reporter records a 90-second visible stall in seconds', async () => {
    let now = 0;
    const intervals = [];
    const timeouts = [];
    const reports = [];
    const storage = new Map();
    class FakeDate extends Date { static now() { return now; } }
    const window = {
        BARK: {
            APP_VERSION: '0.50',
            monitoring: {
                snapshot: () => ({ likelyArea: 'map interaction', releaseChannel: 'beta', pinCount: 389 }),
                classifyFreeze: (durationMs, context) => ({
                    durationSeconds: durationMs / 1000,
                    severity: durationMs >= 45000 ? 'extreme' : 'severe',
                    likelyArea: context.likelyArea,
                    freezeCategory: `${context.likelyArea}:extreme`
                }),
                classifyError: () => ({ likelyArea: 'unknown', severity: 'important' })
            }
        },
        BARK_ERROR_REPORTER_CONFIG: { watchdogStartDelayMs: 0, pendingRetryDelayMs: 999999 },
        addEventListener() {}
    };
    const firebase = {
        auth: () => ({ currentUser: { uid: 'user-1' } }),
        functions: () => ({ httpsCallable: () => async (payload) => { reports.push(payload); } })
    };
    firebase.auth.currentUser = { uid: 'user-1' };
    window.firebase = firebase;
    const context = {
        window,
        firebase,
        document: { visibilityState: 'visible', addEventListener() {} },
        location: { pathname: '/USBarkRangers/01-code/app/', hash: '', hostname: 'usbarkrangers.github.io' },
        navigator: { userAgent: 'iPhone Safari' },
        localStorage: {
            getItem: (key) => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: (key) => storage.delete(key)
        },
        setTimeout: (fn, delay) => { timeouts.push({ fn, delay }); return timeouts.length; },
        setInterval: (fn) => { intervals.push(fn); return intervals.length; },
        Date: FakeDate,
        Math,
        Promise,
        console
    };
    window.window = window;
    vm.runInNewContext(source, context, { filename: 'modules/errorReporter.js' });
    timeouts.find((timer) => timer.delay === 0).fn();

    now = 90000;
    intervals[0]();
    await Promise.resolve();

    assert.equal(reports.length, 1);
    assert.equal(reports[0].durationSeconds, 90);
    assert.equal(reports[0].severity, 'extreme');
    assert.equal(reports[0].likelyArea, 'map interaction');
    assert.match(reports[0].message, /90\.0 seconds/);
    assert.doesNotMatch(reports[0].message, /ms/);
});

test('error reporter removes fragments and redacts bearer, OAuth, and JWT credentials', async () => {
    const reports = [];
    const window = {
        BARK: {
            APP_VERSION: '0.59',
            monitoring: {
                snapshot: () => ({}),
                classifyError: () => ({ likelyArea: 'authentication', severity: 'important' })
            }
        },
        BARK_ERROR_REPORTER_CONFIG: { watchdogStartDelayMs: 999999, pendingRetryDelayMs: 999999 },
        addEventListener() {}
    };
    const firebase = {
        auth: () => ({ currentUser: { uid: 'user-1' } }),
        functions: () => ({ httpsCallable: () => async (payload) => { reports.push(payload); } })
    };
    window.firebase = firebase;
    const context = {
        window,
        firebase,
        document: { visibilityState: 'visible', addEventListener() {} },
        location: {
            pathname: '/USBarkRangers/01-code/app/',
            hash: '#id_token=must-not-leak',
            hostname: 'usbarkrangers.github.io'
        },
        navigator: { userAgent: 'Test Browser' },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        setTimeout: () => 1,
        setInterval: () => 1,
        Date,
        Math,
        Promise,
        console
    };
    window.window = window;
    vm.runInNewContext(source, context, { filename: 'modules/errorReporter.js' });

    window.BARK.reportClientError(
        'error',
        'login failed id_token=secret-token',
        'Authorization: Bearer secret-bearer\neyJabcdefghijk.abcdefghijk.abcdefghijk'
    );
    await Promise.resolve();

    assert.equal(reports.length, 1);
    assert.equal(reports[0].path, '/USBarkRangers/01-code/app/');
    assert.doesNotMatch(JSON.stringify(reports[0]), /secret-token|secret-bearer|eyJabcdefghijk/);
    assert.match(reports[0].message, /id_token=\[REDACTED\]/);
    assert.match(reports[0].stack, /Bearer \[REDACTED\]/);
    assert.match(reports[0].stack, /\[REDACTED_JWT\]/);
});

test('error reporter supplies a confirmed foreground transition to narrow error classification', async () => {
    let now = 100000;
    const reports = [];
    const timeouts = [];
    const windowListeners = new Map();
    const documentListeners = new Map();
    let classificationContext = null;
    class FakeDate extends Date { static now() { return now; } }
    const window = {
        BARK: {
            APP_VERSION: '0.108',
            monitoring: {
                snapshot: () => ({ deviceFamily: 'iOS', browserFamily: 'Safari iOS' }),
                classifyError: (_message, context) => {
                    classificationContext = context;
                    return {
                        likelyArea: 'iOS Safari storage resume warning',
                        severity: 'routine',
                        fingerprint: 'ios-safari-storage-resume-warning'
                    };
                }
            }
        },
        BARK_ERROR_REPORTER_CONFIG: { watchdogStartDelayMs: 0, pendingRetryDelayMs: 999999 },
        addEventListener(name, listener) { windowListeners.set(name, listener); }
    };
    const firebase = {
        auth: () => ({ currentUser: { uid: 'user-1' } }),
        functions: () => ({ httpsCallable: () => async (payload) => { reports.push(payload); } })
    };
    window.firebase = firebase;
    const context = {
        window,
        firebase,
        document: {
            visibilityState: 'visible',
            addEventListener(name, listener) { documentListeners.set(name, listener); }
        },
        location: { pathname: '/USBarkRangers/01-code/app/', hostname: 'usbarkrangers.github.io' },
        navigator: { userAgent: 'iPhone Safari' },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        setTimeout: (fn, delay) => { timeouts.push({ fn, delay }); return timeouts.length; },
        setInterval: () => 1,
        Date: FakeDate,
        Math,
        Promise,
        console
    };
    window.window = window;
    vm.runInNewContext(source, context, { filename: 'modules/errorReporter.js' });
    timeouts.find((timer) => timer.delay === 0).fn();

    documentListeners.get('visibilitychange')();
    now += 1000;
    windowListeners.get('unhandledrejection')({
        reason: { message: 'Attempt to get records from database without an in-progress transaction', code: 0 }
    });
    await Promise.resolve();

    assert.equal(classificationContext.visibilityTransitionSeen, true);
    assert.equal(classificationContext.secondsSinceVisibilityChange, 1);
    assert.equal(classificationContext.deviceFamily, 'iOS');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].likelyArea, 'iOS Safari storage resume warning');
    assert.equal(reports[0].severity, 'routine');
    assert.equal(reports[0].fingerprint, 'ios-safari-storage-resume-warning');
});
