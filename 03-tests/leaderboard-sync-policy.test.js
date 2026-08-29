const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', '01-code', 'app', 'modules', 'leaderboardSyncPolicy.js'),
    'utf8'
);

function createPolicy(options = {}) {
    const sandbox = { window: { BARK: {} } };
    vm.runInNewContext(source, sandbox, { filename: 'modules/leaderboardSyncPolicy.js' });
    return sandbox.window.BARK.createLeaderboardSyncPolicy(options);
}

test('duplicate snapshots do not look like bulk park entry', () => {
    const policy = createPolicy({ quietMs: 10, bulkThreshold: 5, bulkWindowMs: 300, bulkIntervalMs: 180 });
    for (let index = 0; index < 20; index++) policy.request('same-score', index * 5);
    const state = policy.snapshot(100);
    assert.equal(state.distinctChanges, 1);
    assert.equal(state.bulkMode, false);
});

test('first four distinct score changes use the ten-second quiet window', () => {
    const policy = createPolicy({ quietMs: 10_000, bulkThreshold: 5, bulkWindowMs: 300_000, bulkIntervalMs: 180_000 });
    for (let index = 0; index < 4; index++) {
        const now = index * 20_000;
        const result = policy.request(`score-${index}`, now);
        assert.equal(result.bulkMode, false);
        assert.equal(result.dueAt, now + 10_000);
    }
});

test('fifth change enters bulk mode and continuous entry cannot postpone past the three-minute sync', () => {
    const policy = createPolicy({ quietMs: 10_000, bulkThreshold: 5, bulkWindowMs: 300_000, bulkIntervalMs: 180_000 });
    policy.request('score-0', 0);
    policy.markSuccessfulSync(10_000, 'score-0');

    let result;
    for (let index = 1; index <= 100; index++) {
        const now = 10_000 + index * 2_000;
        result = policy.request(`score-${index}`, now);
        if (now < 190_000) assert.ok(result.dueAt <= 190_000);
    }

    assert.equal(result.bulkMode, true);
    assert.equal(result.dueAt, 190_000);
});

test('bulk entry flushes ten seconds after the user stops', () => {
    const policy = createPolicy({ quietMs: 10_000, bulkThreshold: 5, bulkWindowMs: 300_000, bulkIntervalMs: 180_000 });
    for (let index = 0; index < 5; index++) policy.request(`score-${index}`, index * 1_000);
    const finalChange = policy.request('score-final', 8_000);
    assert.equal(finalChange.bulkMode, true);
    assert.equal(finalChange.dueAt, 18_000);
});

test('bulk detection expires after its rolling window', () => {
    const policy = createPolicy({ quietMs: 10, bulkThreshold: 5, bulkWindowMs: 100, bulkIntervalMs: 50 });
    for (let index = 0; index < 5; index++) policy.request(`score-${index}`, index * 10);
    assert.equal(policy.snapshot(40).bulkMode, true);
    const later = policy.request('later-score', 200);
    assert.equal(later.bulkMode, false);
    assert.equal(later.distinctChanges, 1);
});
