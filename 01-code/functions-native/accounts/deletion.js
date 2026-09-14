'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { accountID } = require('../commands/access');
const { object } = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { publicEntryID } = require('../profile/commands');

const RECENT_AUTH_MS = 5 * 60_000;
// Completed jobs are only a short-lived UID fence, not an archive of deleted data.
// Two days exceeds Firebase's one-hour ID-token lifetime. Pending jobs NEVER expire.
const DELETION_FENCE_MS = 2 * 24 * 3600_000;

function createDeletionService({ db, auth, clock = Date.now }) {
    const jobs = db.collection('nativeAccountDeletions');
    async function request(uid, input, context) {
        accountID(uid);
        object(input, ['version', 'confirmed']);
        if (input.version !== 1 || input.confirmed !== true) throw new NativeError('invalid', 'Confirm account deletion.');
        const now = clock(), signedInAt = context?.authTime * 1000;
        if (!Number.isSafeInteger(signedInAt) || signedInAt > now + 60_000 || now - signedInAt > RECENT_AUTH_MS) {
            throw new NativeError('recent-auth-required', 'Confirm your password or sign-in provider before deleting your account.');
        }
        const user = db.collection('users').doc(uid), job = jobs.doc(uid);
        return db.runTransaction(async tx => {
            const [profile, existing] = await tx.getAll(user, job);
            if (!existing.exists) {
                const revision = profile.get('revision') ?? 0;
                if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
                    throw new NativeError('unavailable', 'Account deletion needs support.');
                }
                tx.set(user, { schemaVersion: 1, revision: revision + 1, status: 'deleting',
                    updatedAt: FieldValue.serverTimestamp() }, { merge: true });
                tx.create(job, { schemaVersion: 1, status: 'pending', requestedAt: FieldValue.serverTimestamp(),
                    nextAttemptAt: Timestamp.fromMillis(now) });
            }
            return { version: 1, status: existing.get('status') === 'complete' ? 'complete' : 'accepted' };
        });
    }

    async function runNext() {
        const candidates = await jobs.where('nextAttemptAt', '<=', Timestamp.fromMillis(clock()))
            .orderBy('nextAttemptAt').limit(1).get();
        const job = candidates.docs[0]?.ref;
        if (!job) return false;
        const claimed = await db.runTransaction(async tx => {
            const value = await tx.get(job);
            if (value.get('status') !== 'pending' || value.get('nextAttemptAt')?.toMillis() > clock()) return false;
            // A crashed invocation releases itself without needing the phone to reopen.
            tx.update(job, { nextAttemptAt: Timestamp.fromMillis(clock() + 10 * 60_000) });
            return true;
        });
        if (!claimed) return false;
        const uid = accountID(job.id);
        try {
            try { await auth.deleteUser(uid); }
            catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
            // The user tree includes nested trip content, notes, places, visits, walks,
            // replay claims, rate rows, cursors, access and rank caches. New private
            // features must stay under this owner root or extend this explicit list.
            await db.recursiveDelete(db.collection('users').doc(uid));
            await db.collection('leaderboard').doc(publicEntryID(uid)).delete();
            // Receipts predate owner-root storage. Query the exact UID; never scan all users.
            for (;;) {
                const page = await db.collection('nativeOperationReceipts').where('uid', '==', uid).limit(200).get();
                if (page.empty) break;
                const batch = db.batch();
                for (const receipt of page.docs) batch.delete(receipt.ref);
                await batch.commit();
            }
            await job.set({ schemaVersion: 1, status: 'complete',
                expiresAt: Timestamp.fromMillis(clock() + DELETION_FENCE_MS) });
            return true;
        } catch (error) {
            // Keep the fence and remaining work. Do not store/log private SDK error text.
            await job.update({ nextAttemptAt: Timestamp.fromMillis(clock() + 60_000) });
            throw error;
        }
    }
    return { request, runNext };
}

module.exports = { createDeletionService, RECENT_AUTH_MS, DELETION_FENCE_MS };
