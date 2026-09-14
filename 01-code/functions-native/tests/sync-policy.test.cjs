'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireFreshIntent } = require('../commands/envelope');
const { requirePremium } = require('../commands/access');
const { ACCEPTANCE_WINDOW_MS, PREMIUM_UPLOAD_GRACE_MS } = require('../shared/syncPolicy');
const day = 86_400_000;
test('first acceptance includes day 45 and rejects older or future-dated intent', () => {
    const now = 1_800_000_000_000;
    assert.equal(ACCEPTANCE_WINDOW_MS, 45 * day);
    assert.doesNotThrow(() => requireFreshIntent({ createdAtMs: now - 45 * day }, now));
    assert.throws(() => requireFreshIntent({ createdAtMs: now - 45 * day - 1 }, now), { code: 'intent-expired' });
    assert.throws(() => requireFreshIntent({ createdAtMs: now + 300_001 }, now), { code: 'invalid' });
});
test('Premium uploads use server expiry plus 45 days; revoked and development access have no extension', () => {
    const expiry = 1_800_000_000_000;
    const access = { schemaVersion: 1, premium: true, source: 'app-store-production', validUntil: { toMillis: () => expiry } };
    assert.equal(PREMIUM_UPLOAD_GRACE_MS, 45 * day);
    assert.doesNotThrow(() => requirePremium(access, expiry + 45 * day - 1, 'owner'));
    assert.throws(() => requirePremium(access, expiry + 45 * day, 'owner'), { code: 'premium-required' });
    assert.throws(() => requirePremium({ ...access, premium: false }, expiry, 'owner'), { code: 'premium-required' });
    const development = { ...access, source: 'development', developmentUID: 'owner', developmentGrantedAt: { toMillis: () => expiry - day } };
    assert.throws(() => requirePremium(development, expiry, 'owner'), { code: 'premium-required' });
    assert.throws(() => requirePremium(development, expiry - 1, 'other'), { code: 'premium-required' });
});
