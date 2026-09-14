'use strict';

const { FieldPath, Timestamp } = require('firebase-admin/firestore');
const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { encode, timestamp, serverTime } = require('./encoding');
const { bookmarkView } = require('../places/bookmarks');

function parseChanges(input) {
    v.object(input, ['version', 'since', 'upper', 'after'], ['version']);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
    const since = input.since == null ? null : timestamp(input.since);
    const upper = input.upper == null ? null : timestamp(input.upper);
    if (input.after != null) {
        v.object(input.after, ['updatedAt', 'id']);
        const after = timestamp(input.after.updatedAt); v.identifier(input.after.id);
        if (!upper || after.valueOf() > upper.valueOf() || (since && after.valueOf() < since.valueOf())) {
            throw new NativeError('invalid', 'Invalid synchronization cursor.');
        }
    }
    if (since && upper && since.valueOf() > upper.valueOf()) throw new NativeError('invalid', 'Invalid synchronization bounds.');
    return input;
}

// Shared wire pagination, not a generic domain repository. Collection names and retention
// are fixed by server construction, never accepted from the client.
function createEntityChangesReader(db, { collection, retentionDays }) {
    if (!['trips', 'placeProgress', 'activities', 'places'].includes(collection)
        || (retentionDays !== null && retentionDays !== 89)) throw new Error('Invalid native change source.');
    return async (uid, input) => {
        parseChanges(input);
        const user = db.collection('users').doc(uid);
        return db.runTransaction(async tx => {
            const account = await tx.get(user), readTime = account.readTime;
            const upper = input.upper ? timestamp(input.upper) : readTime;
            if (upper.valueOf() > readTime.valueOf()) throw new NativeError('invalid', 'Cursor exceeds server time.');
            const since = input.since ? timestamp(input.since) : null;
            if (retentionDays !== null) {
                const horizon = Timestamp.fromMillis(readTime.toMillis() - retentionDays * 86_400_000);
                if ((since && since.valueOf() < horizon.valueOf()) || upper.valueOf() < horizon.valueOf()) {
                    return { version: 1, needsBootstrap: true, items: [], upper: serverTime(readTime), next: null, retentionDays };
                }
            }
            let query = user.collection(collection).where('updatedAt', '<=', upper)
                .orderBy('updatedAt').orderBy(FieldPath.documentId()).limit(101);
            if (collection === 'places') query = query.where('bookmark.version', '==', 1);
            if (since) query = query.where('updatedAt', '>=', since); // Inclusive completed-boundary overlap.
            if (input.after) query = query.startAfter(timestamp(input.after.updatedAt), input.after.id);
            const page = await tx.get(query), items = page.docs.slice(0, 100), last = items.at(-1);
            return { version: 1, needsBootstrap: false, items: items.map(doc => collection === 'places'
                ? { ...bookmarkView(doc.data(), doc.id), updatedAt: serverTime(doc.get('updatedAt')) }
                : encode(doc.data())),
                upper: serverTime(upper), retentionDays,
                next: page.size > 100 ? { updatedAt: serverTime(last.get('updatedAt')), id: last.id } : null };
        }, { readOnly: true });
    };
}

module.exports = { createEntityChangesReader, parseChanges };
