'use strict';

const { createHash } = require('node:crypto');
const { NativeError } = require('../shared/errors');

const BUNDLE_ID = 'swarm.USBARKRANGERS';
const APP_APPLE_ID = 6812160476;
const PRODUCT_ID = 'swarm.USBARKRANGERS.premium.annual';
const ENVIRONMENTS = Object.freeze(['Production', 'Sandbox']);
const REFRESH_INTERVAL_MS = 15 * 60_000;
const NEAR_EXPIRY_MS = 24 * 3600_000;

function invalidProof() { return new NativeError('invalid-purchase', 'Apple could not verify this purchase.'); }
function token(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw invalidProof();
    }
    return value.toLowerCase();
}
function transactionID(value) {
    if (typeof value !== 'string' || !/^[0-9]{1,128}$/.test(value)) throw invalidProof();
    return value;
}
function ownerKey(kind, value) { return createHash('sha256').update(`${kind}:${value}`).digest('hex'); }
function environmentKey(environment) {
    if (!ENVIRONMENTS.includes(environment)) throw invalidProof();
    return environment === 'Production' ? 'production' : 'sandbox';
}
function timestamp(value, now) {
    if (!Number.isSafeInteger(value) || value < 0 || value > now + 60_000) throw invalidProof();
    return value;
}

// Called only AFTER Apple's cryptographic verifier. No client booleans, environment flags,
// timestamps or locally signed StoreKit evidence can become entitlement authority.
function transaction(value, now) {
    if (value.bundleId !== BUNDLE_ID || value.productId !== PRODUCT_ID
        || value.type !== 'Auto-Renewable Subscription' || value.inAppOwnershipType !== 'PURCHASED'
        || !ENVIRONMENTS.includes(value.environment)
        || !Number.isSafeInteger(value.expiresDate) || value.expiresDate <= value.purchaseDate
        || value.expiresDate > 253_402_300_799_999 // Firestore's maximum timestamp.
        || value.isUpgraded === true) throw invalidProof();
    return { environment: value.environment, originalID: transactionID(value.originalTransactionId),
        transactionID: transactionID(value.transactionId),
        // Apple's code-redemption sheet can omit the app token. This is NOT an
        // ownership grant: service/store require explicit first-link consent and an
        // atomic original-subscription owner, including for later tokenless renewals.
        appAccountToken: value.appAccountToken == null ? null : token(value.appAccountToken),
        isOfferCode: value.offerType === 3,
        purchasedAtMs: timestamp(value.purchaseDate, now), expiresAtMs: value.expiresDate,
        signedAtMs: timestamp(value.signedDate, now),
        revokedAtMs: value.revocationDate == null ? null : timestamp(value.revocationDate, now) };
}

function currentState(value, renewal, status, now) {
    const result = transaction(value, now);
    if (renewal.originalTransactionId !== result.originalID || renewal.productId !== PRODUCT_ID
        || renewal.environment !== result.environment || ![1, 2, 3, 4, 5].includes(status)
        || ![0, 1].includes(renewal.autoRenewStatus)) throw invalidProof();
    return { ...result, signedAtMs: Math.min(result.signedAtMs, timestamp(renewal.signedDate, now)),
        // Billing grace is off. Normal expiry retains the ORIGINAL expiration for Bark's
        // separate 40/45-day offline policy; refunds/revocations grant no new grace.
        premium: status !== 5 && result.revokedAtMs === null,
        autoRenews: renewal.autoRenewStatus === 1, status, checkedAtMs: now };
}

function newer(candidate, previous) {
    if (!previous) return true;
    // A delayed event for an older subscription period cannot replace a later renewal.
    if (candidate.purchasedAtMs !== previous.purchasedAtMs) return candidate.purchasedAtMs > previous.purchasedAtMs;
    if (candidate.transactionID !== previous.transactionID) {
        return BigInt(candidate.transactionID) > BigInt(previous.transactionID);
    }
    return candidate.signedAtMs >= previous.signedAtMs;
}
function selected(state) {
    // Genuine sandbox is usable in TestFlight/App Review, but can NEVER overwrite a
    // production subscription (including a production refund/expired subscription).
    return state?.production ?? state?.sandbox ?? null;
}
module.exports = { BUNDLE_ID, APP_APPLE_ID, PRODUCT_ID, ENVIRONMENTS, REFRESH_INTERVAL_MS,
    NEAR_EXPIRY_MS, invalidProof, token, transactionID, ownerKey, environmentKey, transaction, currentState, newer, selected };
