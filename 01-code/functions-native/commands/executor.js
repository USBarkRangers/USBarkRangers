'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { parseEnvelope, requireFreshIntent, receiptID, RECEIPT_RETENTION_MS } = require('./envelope');
const { accountID, requireWritableProfile, requirePremium, nextRate } = require('./access');
const { NativeError } = require('../shared/errors');

function createExecutor({ db, handlers, clock = Date.now }) {
    return async function execute(uid, input) {
        accountID(uid); // The callable supplies this from verified auth, never from a payload field.
        const { command, fingerprint } = parseEnvelope(input);
        const handler = Object.hasOwn(handlers, command.kind) ? handlers[command.kind] : null;
        if (!handler) throw new NativeError('unsupported-contract', 'Unsupported command.');
        const payload = handler.parse(command.payload);
        const user = db.collection('users').doc(uid);
        const receiptRef = db.collection('nativeOperationReceipts').doc(receiptID(uid, command.operationID));
        const rateRef = user.collection('commandLimits').doc(handler.rateGroup);
        const nowMs = clock();
        return db.runTransaction(async tx => {
            const receipt = await tx.get(receiptRef);
            if (receipt.exists) {
                if (receipt.get('fingerprint') !== fingerprint) {
                    throw new NativeError('operation-reused', 'This operation ID already belongs to different content.');
                }
                return receipt.get('outcome');
            }
            // Accepted retries may be older than the submission window. Check the receipt first.
            requireFreshIntent(command, nowMs);
            const [profileSnapshot, entitlementSnapshot, rateSnapshot] = await tx.getAll(
                user, user.collection('state').doc('entitlement'), rateRef);
            const profile = profileSnapshot.data();
            requireWritableProfile(profile, handler.allowCreation === true);
            if (handler.requiresPremium) requirePremium(entitlementSnapshot.data(), nowMs);
            const rate = nextRate(rateSnapshot.data(), nowMs, handler.rateMaximum);
            // prepare performs all feature reads/validation, then returns a synchronous write closure.
            // External requests, side effects and account-wide scans never belong in this transaction.
            const decision = await handler.prepare({ tx, db, user, uid, profile, payload,
                expectedRevision: command.expectedRevision, createdAtMs: command.createdAtMs,
                nowMs, stamp: FieldValue.serverTimestamp() });
            const outcome = { version: 1, operationID: command.operationID,
                status: decision.status, revisions: decision.revisions };
            decision.commit?.(tx);
            tx.set(rateRef, rate);
            tx.create(receiptRef, { schemaVersion: 1, uid, fingerprint, outcome,
                createdAt: FieldValue.serverTimestamp(),
                expiresAt: Timestamp.fromMillis(nowMs + RECEIPT_RETENTION_MS) });
            return outcome;
        });
    };
}

module.exports = { createExecutor };
