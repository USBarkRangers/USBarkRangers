'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../purchases/policy');
const { createAppleGateway } = require('../purchases/apple');
const { requirePremium } = require('../commands/access');
const fixture = require('../../ios/Packages/BarkDomain/Tests/BarkDomainTests/Fixtures/native-apple-access-v1.json');
const now = 1_800_000_000_000;
const value = { bundleId: policy.BUNDLE_ID, productId: policy.PRODUCT_ID,
    environment: 'Sandbox', type: 'Auto-Renewable Subscription', inAppOwnershipType: 'PURCHASED',
    appAccountToken: '1a2b3c4d-1111-4111-8111-111111111111', originalTransactionId: '100', transactionId: '101',
    purchaseDate: now - 1000, expiresDate: now + 3600_000, signedDate: now };
const renewal = { originalTransactionId: '100', productId: policy.PRODUCT_ID, environment: 'Sandbox',
    autoRenewStatus: 1, signedDate: now };

test('Apple-signed payload policy rejects wrong app/product/type/owner/token/environment and malformed times', () => {
    assert.equal(policy.transaction(value, now).environment, 'Sandbox');
    for (const patch of [{ bundleId: 'wrong' }, { productId: 'wrong' }, { environment: 'Xcode' },
        { environment: 'LocalTesting' }, { inAppOwnershipType: 'FAMILY_SHARED' }, { type: 'Consumable' },
        { appAccountToken: 'not-a-uuid' }, { originalTransactionId: '../100' },
        { transactionId: 101 }, { expiresDate: NaN }, { expiresDate: now - 2000 },
        { purchaseDate: now + 100_000 }, { signedDate: now + 100_000 }, { revocationDate: NaN }]) {
        assert.throws(() => policy.transaction({ ...value, ...patch }, now), e => e.code === 'invalid-purchase');
    }
});
test('tokenless offer evidence is parsed without inventing an account token; ownership is decided atomically by the store', () => {
    const code = policy.transaction({ ...value, appAccountToken: undefined, offerType: 3 }, now);
    assert.equal(code.appAccountToken, null);
    assert.equal(code.isOfferCode, true);
    // A later renewal can omit both fields. It is usable only by an existing owner.
    const renewed = policy.transaction({ ...value, appAccountToken: null }, now);
    assert.equal(renewed.appAccountToken, null);
    assert.equal(renewed.isOfferCode, false);
    assert.throws(() => policy.transaction({ ...value, offerType: 3, appAccountToken: '' }, now));
});
test('refund denies access; ordinary expiry preserves original expiry, never Apple billing grace', () => {
    const expired = policy.currentState({ ...value, purchaseDate: now - 3000, expiresDate: now - 1000 }, renewal, 2, now);
    assert.equal(expired.premium, true);
    assert.equal(expired.expiresAtMs, now - 1000);
    assert.equal(policy.currentState({ ...value, revocationDate: now }, renewal, 5, now).premium, false);
    for (const patch of [{ originalTransactionId: '999' }, { environment: 'Production' }, { productId: 'other' }, { autoRenewStatus: 42 }]) {
        assert.throws(() => policy.currentState(value, { ...renewal, ...patch }, 1, now));
    }
});
test('production evidence takes precedence and delayed subscription periods cannot roll back a renewal', () => {
    const current = policy.currentState(value, renewal, 1, now);
    assert.equal(policy.newer({ ...current, purchasedAtMs: current.purchasedAtMs - 1, signedAtMs: now + 1 }, current), false);
    assert.equal(policy.newer({ ...current, signedAtMs: now - 1 }, current), false);
    assert.equal(policy.selected({ production: { ...current, premium: false }, sandbox: current }).premium, false);
});
test('live verifier rejects unsigned, forged and Xcode-local JWS without any Apple API credentials', async () => {
    const gateway = createAppleGateway({});
    const forged = environment => [Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
        Buffer.from(JSON.stringify({ ...value, environment })).toString('base64url'), 'not-a-signature'].join('.');
    for (const environment of ['Production', 'Sandbox', 'Xcode', 'LocalTesting']) {
        await assert.rejects(gateway.proof(forged(environment)), e => e.code === 'invalid-purchase');
        await assert.rejects(gateway.notification(forged(environment)), e => e.code === 'invalid-purchase');
    }
});
for (const example of fixture.cases) test(`Shared Apple upload boundary: ${example.id}`, () => {
    const access = { schemaVersion: 1, premium: example.premium, source: example.source,
        validUntil: { toMillis: () => now } };
    const check = () => requirePremium(access, now + example.daysAfterExpiry * 86_400_000, 'owner');
    if (example.upload) assert.doesNotThrow(check); else assert.throws(check);
});
