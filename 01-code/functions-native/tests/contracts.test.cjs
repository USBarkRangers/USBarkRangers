'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { parseEnvelope, requireFreshIntent, receiptID, ACCEPTANCE_WINDOW_MS } = require('../commands/envelope');
const { storageID } = require('../shared/placeIdentity');
const now = 1_800_000_000_000;
const command = () => ({ version: 1, operationID: randomUUID(), createdAtMs: now,
    kind: 'updateProfile', expectedRevision: 0, payload: { displayName: 'Ranger' } });

test('fingerprints ignore object key order but bind every submitted field', () => {
    const first = command();
    const reordered = Object.fromEntries(Object.entries(first).reverse());
    assert.equal(parseEnvelope(first).fingerprint, parseEnvelope(reordered).fingerprint);
    assert.notEqual(parseEnvelope(first).fingerprint, parseEnvelope({ ...first, expectedRevision: 1 }).fingerprint);
    assert.notEqual(receiptID('a', first.operationID), receiptID('b', first.operationID));
});

test('malformed, unsupported, deep, oversized and expired intents fail explicitly', () => {
    for (const value of [{ ...command(), uid: 'somebody-else' }, { ...command(), version: 2 },
        { ...command(), operationID: '../x' }, { ...command(), expectedRevision: -1 },
        { ...command(), payload: { number: Infinity } },
        { ...command(), payload: { huge: '🐾'.repeat(200_000) } }]) assert.throws(() => parseEnvelope(value));
    let nested = {};
    for (let depth = 0; depth < 20; depth++) nested = { nested };
    assert.throws(() => parseEnvelope({ ...command(), payload: nested }));
    assert.throws(() => requireFreshIntent({ ...command(), createdAtMs: now - ACCEPTANCE_WINDOW_MS - 1 }, now),
        error => error.code === 'intent-expired');
    assert.doesNotThrow(() => requireFreshIntent({ ...command(), createdAtMs: now - ACCEPTANCE_WINDOW_MS }, now));
});

test('place identity distinguishes namespaces and ambiguous concatenations', () => {
    const official = { kind: 'official', id: 'park' };
    assert.equal(storageID(official), storageID({ id: 'park', kind: 'official' }));
    assert.notEqual(storageID(official), storageID({ kind: 'custom', id: 'park' }));
    assert.notEqual(storageID({ kind: 'provider', provider: 'ab', id: 'c' }),
        storageID({ kind: 'provider', provider: 'a', id: 'bc' }));
    assert.throws(() => storageID({ ...official, provider: 'apple' }));
    assert.throws(() => storageID({ kind: 'custom', id: '\u0000bad' }));
    assert.throws(() => storageID({ kind: 'custom', id: '\ud800' }));
    assert.doesNotThrow(() => storageID({ kind: 'custom', id: '👩‍👩‍👧' }));
    assert.equal(storageID({ kind: 'provider', provider: 'apple', id: 'place-🐾-é' }),
        '6fdb54e81f8101ce746c8b55ff00868013aaadb38740ca3c2f546ea5acb5c6ea');
});
