"use strict";
const { HttpsError } = require("firebase-functions/v1/https");
const { enforceBoundedCallableRateLimitInTransaction } = require("../rateLimits");
const { validateOperation } = require("./profileMutations");
const { content, patch, premium } = require("./currentSchema");
const { canonical, fingerprint, priorReceipt } = require("../shared/mutationReceipts");

// One transaction: exact intent + current touched content + durable receipt. No provider/network calls.
function createUserMutations({ db, now = Date.now }) {
    return async (operation, context) => {
        const uid = context?.auth?.uid;
        if (!uid) throw new HttpsError("unauthenticated", "Sign in to save account changes.");
        validateOperation(operation);
        if (operation.uid !== uid) throw new HttpsError("permission-denied", "Account changed.");
        const userRef = db.doc(`users/${uid}`);
        const receiptRef = db.doc(`_nativeMutationReceipts/${uid}/operations/${operation.id}`);
        return db.runTransaction(async transaction => {
            const [deleted, previous, user] = await transaction.getAll(
                db.doc(`_deletedUsers/${uid}`), receiptRef, userRef);
            if (deleted.exists) throw new HttpsError("permission-denied", "This account has been deleted.");
            const receipt = priorReceipt(previous, operation);
            if (receipt) return receipt;
            const timestamp = now();
            await enforceBoundedCallableRateLimitInTransaction(transaction, uid, "applyUserMutation", {
                firestore: db, nowMillis: timestamp
            });
            const record = user.data() || {};
            const current = content(record, operation.kind);
            let outcome = "accepted";
            let reason = null;
            if (operation.createdAt > timestamp + 5 * 60_000 || operation.createdAt < timestamp - 30 * 86400_000) {
                outcome = "rejected"; reason = "expired-operation";
            } else if (operation.kind === "mapStyle" && !premium(record, timestamp)) {
                outcome = "rejected"; reason = "premium-required";
            } else if (canonical(current) !== canonical(operation.expected)) {
                outcome = "conflict"; reason = "changed-on-another-device";
            }
            const result = { operation, outcome, current, reason };
            if (outcome === "accepted") transaction.set(userRef, patch(operation, timestamp), { merge: true });
            transaction.set(receiptRef, {
                fingerprint: fingerprint(operation), receipt: result, acceptedAt: timestamp,
                // Retain longer than the replay window; TTL provisioning is a later deployment step.
                expiresAt: new Date(timestamp + 60 * 86400_000)
            });
            return result;
        });
    };
}

module.exports = { createUserMutations };
