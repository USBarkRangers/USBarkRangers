'use strict';

const { NativeError } = require('../shared/errors');
const { text } = require('../shared/validation');

function accountID(uid) {
    text(uid, { min: 1, max: 128 });
    if (uid.includes('/') || uid === '.' || uid === '..' || /\p{Cc}/u.test(uid)) {
        throw new NativeError('unauthenticated', 'Sign in again.');
    }
    return uid;
}

function requireWritableProfile(profile, allowCreation) {
    if (!profile) {
        if (allowCreation) return;
        throw new NativeError('account-unavailable', 'Open the account before editing.');
    }
    if (profile.schemaVersion !== 1 || !Number.isSafeInteger(profile.revision) || profile.revision < 1) {
        throw new NativeError('unsupported-contract', 'This account requires a newer app.');
    }
    if (profile.status !== 'active') throw new NativeError('account-deleting', 'This account is being deleted.');
}

function requirePremium(entitlement, nowMs) {
    // APPLE-ACTIVATION: enrollment pending. A separate server verification boundary must
    // validate signed Apple transactions, bundle/product/environment, account ownership,
    // expiry/revocation and duplicate notification IDs before writing this entitlement.
    // Inactive wiring sketch for that future callable/notification handler, NOT this guard:
    // await purchaseVerifier.verifyAndApply({ signedTransaction, authenticatedUID });
    // Never enable a client-write/test-grant endpoint or import legacy payment providers.
    const validUntilMs = typeof entitlement?.validUntil?.toMillis === 'function'
        ? entitlement.validUntil.toMillis() : NaN;
    if (entitlement?.schemaVersion !== 1 || entitlement.premium !== true
        || entitlement.source !== 'app-store-production'
        || !Number.isFinite(validUntilMs) || validUntilMs <= nowMs) {
        throw new NativeError('premium-required', 'Premium is required to edit account data.');
    }
}

// One bounded rate record per account/command family, never a cross-account hot document.
function nextRate(previous, nowMs, maximum) {
    const windowStartMs = Math.floor(nowMs / 60_000) * 60_000;
    const count = previous?.windowStartMs === windowStartMs ? previous.count : 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new NativeError('unavailable', 'Retry shortly.');
    if (count >= maximum) throw new NativeError('rate-limited', 'Retry shortly.',
        { retryAfterMs: Math.max(1000, windowStartMs + 60_000 - nowMs) });
    return { windowStartMs, count: count + 1 };
}

module.exports = { accountID, requireWritableProfile, requirePremium, nextRate };
