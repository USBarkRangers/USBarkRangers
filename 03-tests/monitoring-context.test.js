const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(
    path.join(repoRoot, '01-code', 'app', 'modules', 'monitoringContext.js'),
    'utf8'
);

function makeHarness(options = {}) {
    let monotonic = 100;
    const analytics = [];
    const window = {
        BARK: {},
        map: { getZoom: () => 8 },
        matchMedia: (query) => ({ matches: options.displayMode === 'standalone' && query === '(display-mode: standalone)' }),
        ...(options.withAnalytics ? { goatcounter: { count: (item) => analytics.push(item) } } : {})
    };
    const context = {
        window,
        location: options.location || { hostname: 'outswarming.github.io', pathname: '/USBarkRangers/01-code/app/', protocol: 'https:' },
        navigator: { userAgent: options.userAgent || 'Mozilla/5.0 (iPhone) AppleWebKit Safari/604.1' },
        document: {
            querySelector: () => ({ id: 'map-view' }),
            querySelectorAll: () => ({ length: 389 })
        },
        performance: { now: () => monotonic },
        setTimeout: () => 1,
        clearTimeout() {},
        URL,
        Map,
        console
    };
    window.window = window;
    vm.runInNewContext(source, context, { filename: 'modules/monitoringContext.js' });
    return { window, analytics, advance: (ms) => { monotonic += ms; } };
}

test('monitoring context attributes freezes without changing map pins', () => {
    const harness = makeHarness();
    const token = harness.window.BARK.perfOperationStart('map-pin-render', '389 visible');
    harness.advance(46000);
    const snapshot = harness.window.BARK.monitoring.snapshot(46000);
    const classification = harness.window.BARK.monitoring.classifyFreeze(46000, snapshot);

    assert.equal(snapshot.likelyArea, 'map/pin rendering');
    assert.equal(snapshot.pinCount, 389);
    assert.equal(snapshot.mapZoom, 8);
    assert.equal(snapshot.releaseChannel, 'beta');
    assert.equal(snapshot.deviceFamily, 'iOS');
    assert.equal(classification.severity, 'extreme');
    assert.equal(classification.durationSeconds, 46);
    harness.window.BARK.perfOperationEnd(token, 'complete');
});

test('monitoring context relabels only the known iOS Safari resume transaction warning', () => {
    const harness = makeHarness();
    const result = harness.window.BARK.monitoring.classifyError(
        'Attempt to get records from database without an in-progress transaction',
        {
            deviceFamily: 'iOS',
            browserFamily: 'Safari iOS',
            visibilityTransitionSeen: true,
            secondsSinceVisibilityChange: 0
        }
    );
    assert.equal(result.likelyArea, 'iOS Safari storage resume warning');
    assert.equal(result.severity, 'routine');
    assert.equal(result.fingerprint, 'ios-safari-storage-resume-warning');
    assert.equal(result.lowInformation, false);
});

test('the same transaction message remains important without a confirmed Safari resume', () => {
    const harness = makeHarness();
    const message = 'Attempt to get records from database without an in-progress transaction';
    const cases = [
        {},
        {
            deviceFamily: 'iOS', browserFamily: 'Safari iOS',
            visibilityTransitionSeen: false, secondsSinceVisibilityChange: 0
        },
        {
            deviceFamily: 'iOS', browserFamily: 'Safari iOS',
            visibilityTransitionSeen: true, secondsSinceVisibilityChange: 30
        },
        {
            deviceFamily: 'Android', browserFamily: 'Chrome',
            visibilityTransitionSeen: true, secondsSinceVisibilityChange: 0
        }
    ];

    cases.forEach((context) => {
        const result = harness.window.BARK.monitoring.classifyError(message, context);
        assert.equal(result.likelyArea, 'storage/database');
        assert.equal(result.severity, 'important');
    });
});

test('serious companion storage failures keep their important classification', () => {
    const harness = makeHarness();
    const resumeContext = {
        deviceFamily: 'iOS',
        browserFamily: 'Safari iOS',
        visibilityTransitionSeen: true,
        secondsSinceVisibilityChange: 0
    };
    const messages = [
        'Connection to Indexed Database server lost. Refresh the page to try again',
        'FIRESTORE (10.12.0) INTERNAL ASSERTION FAILED: Unexpected state',
        'The transaction was aborted, so the request cannot be fulfilled'
    ];

    messages.forEach((message) => {
        const result = harness.window.BARK.monitoring.classifyError(message, resumeContext);
        assert.equal(result.likelyArea, 'storage/database');
        assert.equal(result.severity, 'important');
    });
});

test('non-storage errors keep their existing classifications', () => {
    const harness = makeHarness();
    const result = harness.window.BARK.monitoring.classifyError('Premium checkout failed');
    assert.equal(result.likelyArea, 'payment/upgrade');
    assert.equal(result.severity, 'important');
    assert.equal(result.lowInformation, false);
});

test('analytics separates every app open from deduplicated audience sessions', () => {
    const harness = makeHarness({ withAnalytics: true });
    assert.equal(harness.analytics[0].path, 'event-app-open-beta');
    assert.equal(harness.analytics[0].no_session, true);
    assert.equal(harness.analytics[1].path, 'event-app-session-beta');
    assert.equal(harness.analytics[1].no_session, false);

    harness.window.BARK.monitoring.trackSessionEvent('audience-beta-premium', 'Audience: beta premium');
    assert.equal(harness.analytics[2].path, 'event-audience-beta-premium');
    assert.equal(harness.analytics[2].no_session, false);
});

test('loading-screen analytics counts once across phone, desktop, and installed web-app runtimes', () => {
    const production = { hostname: 'usbarkrangersmap.com', pathname: '/', protocol: 'https:' };
    const beta = { hostname: 'usbarkrangers.github.io', pathname: '/USBarkRangers/01-code/app/', protocol: 'https:' };
    const devices = [
        {
            name: 'iPhone Safari',
            location: production,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
        },
        {
            name: 'iPhone installed web app',
            displayMode: 'standalone',
            location: production,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
        },
        {
            name: 'Android Chrome',
            location: production,
            userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S938U) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36'
        },
        {
            name: 'Android installed web app',
            displayMode: 'standalone',
            location: beta,
            userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36'
        },
        {
            name: 'desktop browser',
            location: production,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'
        }
    ];

    devices.forEach((device) => {
        const harness = makeHarness({ ...device, withAnalytics: true });
        const channel = device.location === beta ? 'beta' : 'production';
        assert.equal(harness.analytics.length, 2, `${device.name} should send one load and one session event`);
        assert.equal(harness.analytics[0].path, `event-app-open-${channel}`, device.name);
        assert.equal(harness.analytics[0].no_session, true, device.name);
        assert.equal(harness.analytics[1].path, `event-app-session-${channel}`, device.name);
        assert.equal(harness.analytics[1].no_session, false, device.name);
    });
});
