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

function makeHarness() {
    let monotonic = 100;
    const window = { BARK: {}, map: { getZoom: () => 8 } };
    const context = {
        window,
        location: { hostname: 'outswarming.github.io', pathname: '/USBarkRangers/01-code/app/', protocol: 'https:' },
        navigator: { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit Safari/604.1' },
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
    return { window, advance: (ms) => { monotonic += ms; } };
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

test('monitoring context recognizes the recurring storage transaction error', () => {
    const harness = makeHarness();
    const result = harness.window.BARK.monitoring.classifyError(
        'Attempt to get records from database without an in-progress transaction'
    );
    assert.equal(result.likelyArea, 'storage/database');
    assert.equal(result.lowInformation, false);
});
