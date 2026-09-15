'use strict';

const { randomUUID } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { accountID, requireWritableProfile, nextRate } = require('../commands/access');
const { NativeError } = require('../shared/errors');
const policy = require('./policy');

function projection(value) {
    if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision)) {
        throw new NativeError('unavailable', 'Membership could not be loaded.');
    }
    return { schemaVersion: 1, revision: value.revision, premium: value.premium, source: value.source,
        validUntilMs: value.validUntil?.toMillis() ?? null };
}
function reply(state, entitlement) {
    if (state?.schemaVersion !== 1) throw new NativeError('unavailable', 'Membership could not be loaded.');
    policy.token(state.appAccountToken);
    const membership = policy.selected(state);
    return { version: 1, appAccountToken: state.appAccountToken, productID: policy.PRODUCT_ID,
        entitlement: projection(entitlement), subscription: membership ? {
            environment: membership.environment, expiresAtMs: membership.expiresAtMs,
            autoRenews: membership.autoRenews, revoked: !membership.premium,
            checkedAtMs: membership.checkedAtMs,
        } : null };
}

function createPurchaseStore({ db, clock = Date.now }) {
    const owners = db.collection('nativeAppleOwners');
    const refs = uid => {
        const user = db.collection('users').doc(accountID(uid));
        return { user, state: user.collection('purchases').doc('apple'),
            entitlement: user.collection('state').doc('entitlement'),
            limit: user.collection('commandLimits').doc('appleVerification') };
    };
    async function context(uid) {
        const ref = refs(uid), newToken = randomUUID();
        return db.runTransaction(async tx => {
            const [profile, saved, entitlement] = await tx.getAll(ref.user, ref.state, ref.entitlement);
            requireWritableProfile(profile.data(), false);
            let state = saved.data();
            if (!state) {
                state = { schemaVersion: 1, appAccountToken: newToken };
                tx.create(ref.state, state);
                tx.create(owners.doc(policy.ownerKey('token', newToken)), { uid, kind: 'token' });
            } else { policy.token(state.appAccountToken); }
            return reply(state, entitlement.data());
        });
    }
    async function load(uid) {
        const ref = refs(uid);
        const [profile, saved, entitlement] = await db.getAll(ref.user, ref.state, ref.entitlement);
        requireWritableProfile(profile.data(), false);
        if (!saved.exists) throw new NativeError('account-unavailable', 'Open Upgrade to Premium first.');
        return { state: saved.data(), reply: reply(saved.data(), entitlement.data()) };
    }
    async function reserve(uid) {
        const ref = refs(uid);
        await db.runTransaction(async tx => {
            const [profile, limit] = await tx.getAll(ref.user, ref.limit);
            requireWritableProfile(profile.data(), false);
            tx.set(ref.limit, nextRate(limit.data(), clock(), 10));
        });
    }
    async function ownerFor(reference) {
        policy.environmentKey(reference.environment);
        const kind = reference.appAccountToken === null ? 'subscription' : 'token';
        const key = kind === 'token' ? policy.token(reference.appAccountToken)
            : `${reference.environment}:${policy.transactionID(reference.originalID)}`;
        const row = await owners.doc(policy.ownerKey(kind, key)).get();
        return row.get('kind') === kind && typeof row.get('uid') === 'string' ? row.get('uid') : null;
    }
    async function apply(uid, candidate, { allowOfferClaim = false } = {}) {
        const ref = refs(uid), key = policy.environmentKey(candidate.environment);
        const owner = owners.doc(policy.ownerKey('subscription', `${candidate.environment}:${candidate.originalID}`));
        return db.runTransaction(async tx => {
            const [profile, saved, entitlement, claim] = await tx.getAll(ref.user, ref.state, ref.entitlement, owner);
            // This profile read participates in the SAME transaction as writes. Deletion
            // racing an Apple response can never recreate a user's removed purchase state.
            requireWritableProfile(profile.data(), false);
            const state = saved.data();
            // A missing Apple token never means "any account". The one existing
            // owner wins; only service-verified offer evidence can create this claim.
            const matchesAccount = candidate.appAccountToken === null
                ? claim.get('uid') === uid || (!claim.exists && allowOfferClaim)
                : state?.appAccountToken === candidate.appAccountToken;
            if (!state || !matchesAccount
                || (claim.exists && claim.get('uid') !== uid)) {
                throw new NativeError('purchase-account-mismatch', 'This Apple subscription belongs to a different Bark account. Sign in to that account and restore.');
            }
            if (!claim.exists) tx.create(owner, { uid, kind: 'subscription' });
            const previous = state[key];
            if (!policy.newer(candidate, previous)) return reply(state, entitlement.data());
            // Monotonic signed evidence fences delayed responses, including refund reversal.
            if (previous && candidate.signedAtMs === previous.signedAtMs
                && candidate.transactionID === previous.transactionID && candidate.premium !== previous.premium) {
                throw new NativeError('unavailable', 'Apple membership is changing. Retry shortly.');
            }
            const next = { ...state, [key]: candidate };
            const selected = policy.selected(next), old = entitlement.data();
            const source = selected.environment === 'Production' ? 'app-store-production' : 'app-store-sandbox';
            let confirmed = old;
            const unchanged = old?.source === source && old.premium === selected.premium
                && old.validUntil?.toMillis() === selected.expiresAtMs;
            if (!unchanged) {
                if (!Number.isSafeInteger(old?.revision) || old.revision >= Number.MAX_SAFE_INTEGER) {
                    throw new NativeError('unavailable', 'Membership needs support.');
                }
                confirmed = { schemaVersion: 1, revision: old.revision + 1, premium: selected.premium,
                    source, validUntil: Timestamp.fromMillis(selected.expiresAtMs) };
                // Replace, not merge: an Apple purchase retires obsolete development-grant fields.
                tx.set(ref.entitlement, confirmed);
            }
            tx.set(ref.state, next);
            return reply(next, confirmed);
        });
    }
    return { context, load, reserve, ownerFor, apply };
}
module.exports = { createPurchaseStore, projection };
