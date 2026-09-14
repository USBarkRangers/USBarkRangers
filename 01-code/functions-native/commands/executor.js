'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { parseEnvelope, requireFreshIntent, receiptID, RECEIPT_RETENTION_MS } = require('./envelope');
const { accountID, requireWritableProfile, requirePremium, nextRate } = require('./access');
const { NativeError } = require('../shared/errors');
const { encode } = require('../reads/encoding');

// These bounded commands retain transactional ownership/entitlement checks and
// receipts, but do not write a separate throttle row on every ordinary edit.
// New or expensive commands remain rate-limited unless deliberately listed here.
const ordinary = new Set(['updateProfile', 'updateMapStyle', 'setSavedPin', 'editNote',
    'saveTripNotes', 'markVisit', 'updateVisitDate', 'deleteVisit', 'recordDailyActivity']);

function createExecutor({ db, handlers, clock = Date.now }) {
    return async function execute(uid, input) {
        accountID(uid); // The callable supplies this from verified auth, never from a payload field.
        const { command, fingerprint } = parseEnvelope(input);
        const handler = Object.hasOwn(handlers, command.kind) ? handlers[command.kind] : null;
        if (!handler) throw new NativeError('unsupported-contract', 'Unsupported command.');
        const payload = handler.parse(command.payload);
        const user = db.collection('users').doc(uid);
        const receiptRef = db.collection('nativeOperationReceipts').doc(receiptID(uid, command.operationID));
        const rateRef = ordinary.has(command.kind) ? null : user.collection('commandLimits').doc(handler.rateGroup);
        const nowMs = clock();
        const result = await db.runTransaction(async tx => {
            const receipt = await tx.get(receiptRef);
            if (receipt.exists) {
                if (receipt.get('fingerprint') !== fingerprint) {
                    throw new NativeError('operation-reused', 'This operation ID already belongs to different content.');
                }
                return { outcome: receipt.get('outcome') };
            }
            // Accepted retries may be older than the submission window. Check the receipt first.
            requireFreshIntent(command, nowMs);
            const refs = [user];
            if (handler.requiresPremium) refs.push(user.collection('state').doc('entitlement'));
            if (rateRef) refs.push(rateRef);
            const [profileSnapshot, ...admission] = await tx.getAll(...refs);
            const profile = profileSnapshot.data();
            requireWritableProfile(profile, handler.allowCreation === true);
            if (handler.requiresPremium) requirePremium(admission.shift().data(), nowMs, uid);
            const rate = rateRef ? nextRate(admission.shift().data(), nowMs, handler.rateMaximum) : null;
            // prepare performs all feature reads/validation, then returns a synchronous write closure.
            // External requests, side effects and account-wide scans never belong in this transaction.
            const decision = await handler.prepare({ tx, db, user, uid, profile, payload,
                expectedRevision: command.expectedRevision, createdAtMs: command.createdAtMs,
                nowMs, stamp: FieldValue.serverTimestamp() });
            const outcome = { version: 1, operationID: command.operationID,
                status: decision.status, revisions: decision.revisions };
            if (decision.confirmation) outcome.confirmation = decision.confirmation;
            decision.commit?.(tx);
            if (rateRef) tx.set(rateRef, rate);
            tx.create(receiptRef, { schemaVersion: 1, uid, fingerprint, outcome,
                createdAt: FieldValue.serverTimestamp(),
                expiresAt: Timestamp.fromMillis(nowMs + RECEIPT_RETENTION_MS) });
            return { outcome, resolve: !!decision.confirmation && handler.confirmationNeedsTimestamp === true };
        });
        // Resolve server transforms once, from the durable receipt, not from a later
        // entity read. Replays return that same commit's confirmation even after edits.
        // Trip receipts contain metadata/revisions only, never itinerary or note text.
        const outcome = result.resolve ? (await receiptRef.get()).get('outcome') : result.outcome;
        if (!outcome) throw new NativeError('unavailable', 'Confirmation is temporarily unavailable.');
        return encode(outcome);
    };
}

module.exports = { createExecutor };
