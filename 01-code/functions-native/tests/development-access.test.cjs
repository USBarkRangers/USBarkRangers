'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requirePremium } = require('../commands/access');
const now = 1_800_000_000_000;
const stamp = value => ({ toMillis: () => value });
const grant = { schemaVersion: 1, premium: true, source: 'development', developmentUID: 'owner',
    developmentGrantedAt: stamp(now), validUntil: stamp(now + 3600_000) };

test('permanent owner access is bound to the account and cannot be inferred from free or development access', () => {
    const owner = { schemaVersion: 1, premium: true, source: 'owner', ownerUID: 'owner', validUntil: null };
    assert.doesNotThrow(() => requirePremium(owner, now + 100 * 365 * 86400_000, 'owner'));
    for (const uid of [undefined, '', 'another-owner']) assert.throws(() => requirePremium(owner, now, uid));
    for (const patch of [{ premium: false }, { schemaVersion: 2 }, { source: 'none' },
        { source: 'development' }, { ownerUID: undefined }, { validUntil: undefined },
        { validUntil: stamp(now + 3600_000) }]) {
        assert.throws(() => requirePremium({ ...owner, ...patch }, now, 'owner'));
    }
});

test('development access requires a finite administrator grant bound to the authenticated UID', () => {
    assert.doesNotThrow(() => requirePremium(grant, now, 'owner'));
    for (const uid of [undefined, '', 'another-owner']) assert.throws(() => requirePremium(grant, now, uid));
    for (const patch of [{ premium: false }, { schemaVersion: 2 }, { source: 'xcode-local' },
        { developmentUID: undefined }, { developmentGrantedAt: undefined },
        { developmentGrantedAt: stamp(now + 60_001) }, { validUntil: stamp(now) },
        { validUntil: stamp(now + 14 * 24 * 3600_000 + 1) }, { validUntil: stamp(Infinity) }]) {
        assert.throws(() => requirePremium({ ...grant, ...patch }, now, 'owner'));
    }
    assert.throws(() => requirePremium(grant, now + 3600_000, 'owner'));
});
