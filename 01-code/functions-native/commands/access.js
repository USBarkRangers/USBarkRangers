'use strict';

const { NativeError } = require('../shared/errors');
const { text } = require('../shared/validation');
const { PREMIUM_UPLOAD_GRACE_MS } = require('../shared/syncPolicy');

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

// Issued only by an administrator into the protected, account-owned entitlement.
// It is independent of Apple billing and never follows an editable email address.
function hasOwnerPremium(entitlement, uid) {
    return entitlement?.schemaVersion === 1 && entitlement.premium === true
        && entitlement.source === 'owner' && typeof uid === 'string' && uid.length > 0
        && entitlement.ownerUID === uid && entitlement.validUntil === null;
}

function requirePremium(entitlement, nowMs, uid) {
    if (hasOwnerPremium(entitlement, uid)) return;
    // purchases/ owns Apple verification and the one entitlement projection. Genuine
    // sandbox supports TestFlight/App Review; Xcode-local signatures never reach this row.
    const validUntilMs = typeof entitlement?.validUntil?.toMillis === 'function'
        ? entitlement.validUntil.toMillis() : NaN;
    const grantedAtMs = typeof entitlement?.developmentGrantedAt?.toMillis === 'function'
        ? entitlement.developmentGrantedAt.toMillis() : NaN;
    // Administrative development grants are distinct from purchase evidence, bound
    // to the exact account and limited to 14 days. No callable can issue these fields.
    const development = entitlement?.source === 'development'
        && typeof uid === 'string' && entitlement.developmentUID === uid
        && Number.isFinite(grantedAtMs) && grantedAtMs <= nowMs + 60_000
        && validUntilMs > grantedAtMs && validUntilMs <= grantedAtMs + 14 * 24 * 3600_000;
    // Explicitly revoked/disabled access has no grace. Development grants retain
    // their administrator-authorized hard expiry; they are not subscriptions.
    const apple = ['app-store-production', 'app-store-sandbox'].includes(entitlement?.source);
    const cutoff = validUntilMs + (apple ? PREMIUM_UPLOAD_GRACE_MS : 0);
    if (entitlement?.schemaVersion !== 1 || entitlement.premium !== true
        || (!apple && !development)
        || !Number.isFinite(validUntilMs) || cutoff <= nowMs) {
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

module.exports = { accountID, requireWritableProfile, hasOwnerPremium, requirePremium, nextRate };
