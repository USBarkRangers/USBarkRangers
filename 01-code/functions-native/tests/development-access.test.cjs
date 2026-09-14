'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requirePremium } = require('../commands/access');
const now = 1_800_000_000_000;
const stamp = value => ({ toMillis: () => value });
const grant = { schemaVersion: 1, premium: true, source: 'development', developmentUID: 'owner',
    developmentGrantedAt: stamp(now), validUntil: stamp(now + 3600_000) };

test('development access requires a finite administrator grant bound to the authenticated UID', () => {
    assert.doesNotThrow(() => requirePremium(grant, now, 'owner'));
    for (const uid of [undefined, '', 'another-owner']) assert.throws(() => requirePremium(grant, now, uid));
    for (const patch of [{ premium: false }, { schemaVersion: 2 }, { source: 'app-store-sandbox' },
        { developmentUID: undefined }, { developmentGrantedAt: undefined },
        { developmentGrantedAt: stamp(now + 60_001) }, { validUntil: stamp(now) },
        { validUntil: stamp(now + 14 * 24 * 3600_000 + 1) }, { validUntil: stamp(Infinity) }]) {
        assert.throws(() => requirePremium({ ...grant, ...patch }, now, 'owner'));
    }
    assert.throws(() => requirePremium(grant, now + 3600_000, 'owner'));
});
