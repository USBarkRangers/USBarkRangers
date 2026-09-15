'use strict';

const { object } = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const policy = require('./policy');
const { signedValue } = require('./apple');

function createPurchaseService({ store, apple, clock = Date.now }) {
    // Only in-flight work is shared; no receipt per app launch and no unbounded cache.
    const refreshing = new Map();
    async function refresh(uid, reference, allowOfferClaim = false) {
        const key = `${uid}:${reference.environment}:${reference.originalID}:${allowOfferClaim}`;
        if (refreshing.has(key)) return refreshing.get(key);
        const task = (async () => {
            await store.reserve(uid);
            const current = await apple.current(reference);
            return store.apply(uid, current, { allowOfferClaim });
        })();
        refreshing.set(key, task);
        try { return await task; } finally { refreshing.delete(key); }
    }
    async function execute(uid, input) {
        object(input, ['version', 'kind', 'signedTransaction', 'claimOffer'], ['version', 'kind']);
        if (input.version !== 1 || !['context', 'verify', 'refresh'].includes(input.kind)) throw policy.invalidProof();
        if (input.kind !== 'verify' && Object.hasOwn(input, 'signedTransaction')) throw policy.invalidProof();
        if (Object.hasOwn(input, 'claimOffer')
            && (input.kind !== 'verify' || typeof input.claimOffer !== 'boolean')) throw policy.invalidProof();
        if (input.kind === 'context') return store.context(uid);
        const saved = await store.load(uid);
        if (input.kind === 'refresh') {
            const reference = policy.selected(saved.state);
            if (!reference || reference.expiresAtMs - clock() > policy.NEAR_EXPIRY_MS
                || clock() - reference.checkedAtMs < policy.REFRESH_INTERVAL_MS) return saved.reply;
            return refresh(uid, reference);
        }
        const proof = await apple.proof(signedValue(input.signedTransaction));
        if (proof.appAccountToken !== null && saved.state.appAccountToken !== proof.appAccountToken) {
            throw new NativeError('purchase-account-mismatch', 'This Apple subscription belongs to a different Bark account. Sign in to that account and restore.');
        }
        let allowOfferClaim = false;
        if (proof.appAccountToken === null) {
            const owner = await store.ownerFor(proof);
            if (owner && owner !== uid) throw new NativeError('purchase-account-mismatch', 'This Apple subscription is already linked to another Bark account.');
            allowOfferClaim = !owner && proof.isOfferCode === true && input.claimOffer === true;
            if (!owner && !allowOfferClaim) throw new NativeError('purchase-link-required', 'Confirm your Bark account using Restore Purchases before linking an Apple offer.');
        }
        // Replays don't create grants from device evidence. Always ask Apple for CURRENT
        // status (which may have renewed, expired or been refunded since the device signed it).
        return refresh(uid, proof, allowOfferClaim);
    }
    async function notification(signed) {
        const proof = await apple.notification(signedValue(signed));
        if (!proof) return;
        const uid = await store.ownerFor(proof);
        if (!uid) return; // Deleted/unknown token: never create an account from an Apple event.
        try { await refresh(uid, proof); }
        catch (error) {
            if (['account-deleting', 'account-unavailable'].includes(error.code)) return;
            throw error; // Apple gets non-2xx until durable acceptance (or a deleted owner).
        }
    }
    return { execute, notification };
}
module.exports = { createPurchaseService };
