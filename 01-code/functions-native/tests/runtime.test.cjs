'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveProject } = require('../runtime/project');
const { nextRate, requirePremium } = require('../commands/access');
const { updateProfile, updateMapStyle } = require('../profile/commands');

test('runtime refuses wrong projects and mixed live/emulator destinations', () => {
    assert.equal(resolveProject({ GCLOUD_PROJECT: 'bark-ranger-ios' }).region, 'us-east1');
    assert.equal(resolveProject({ GCLOUD_PROJECT: 'demo-bark-native', FUNCTIONS_EMULATOR: 'true',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8188' }).emulator, true);
    for (const env of [{}, { GCLOUD_PROJECT: 'barkrangermap-auth' },
        { GCLOUD_PROJECT: 'just-dee-dee-music-map' },
        { GCLOUD_PROJECT: 'bark-ranger-ios', FIREBASE_CONFIG: '{"projectId":"wrong"}' },
        { GCLOUD_PROJECT: 'bark-ranger-ios', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8188' },
        { GCLOUD_PROJECT: 'demo-bark-native', FUNCTIONS_EMULATOR: 'true' }]) {
        assert.throws(() => resolveProject(env));
    }
});

test('profile commands retain current product validation and reject broad patches', () => {
    assert.deepEqual(updateProfile.parse({ displayName: 'Ranger' }), { displayName: 'Ranger' });
    for (const displayName of ['x', 'x'.repeat(31), ' space', '<name>', '\u200bhidden']) {
        assert.throws(() => updateProfile.parse({ displayName }));
    }
    assert.throws(() => updateProfile.parse({ displayName: 'Name', premium: true }));
    assert.throws(() => updateMapStyle.parse({ mapStyle: 'overview' }));
});

test('access is finite, native-source-only and rate limits stay account-local', () => {
    const now = 1_800_000_000_000;
    const valid = { schemaVersion: 1, premium: true, source: 'app-store-production',
        validUntil: { toMillis: () => now + 1 } };
    assert.doesNotThrow(() => requirePremium(valid, now));
    for (const value of [undefined, { ...valid, source: 'legacy' }, { ...valid, source: 'app-store-sandbox' },
        { ...valid, validUntil: { toMillis: () => now } }]) assert.throws(() => requirePremium(value, now));
    const first = nextRate(null, now, 2);
    const second = nextRate(first, now, 2);
    assert.throws(() => nextRate(second, now, 2), error => error.code === 'rate-limited');
    assert.equal(nextRate(second, now + 60_000, 2).count, 1);
});
