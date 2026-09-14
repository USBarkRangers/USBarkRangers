'use strict';

const { FieldPath } = require('firebase-admin/firestore');
const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { publicEntryID } = require('../profile/commands');
const { requireWritableProfile } = require('../commands/access');

function parseLeaderboard(query) {
    v.object(query, ['version']);
    if (query.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
}
function entry(document) {
    if (!document.exists) return null;
    const value = document.data();
    if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.totalPoints) || value.totalPoints < 0
        || typeof value.displayName !== 'string' || value.displayName.length > 80) {
        throw new NativeError('unsupported-contract', 'Standings require a compatible service.');
    }
    return { id: document.id, name: value.displayName.trim() || 'BARK Ranger', points: value.totalPoints };
}
function createLeaderboardReader(db, { now = Date.now } = {}) {
    return async uid => {
        const ownID = publicEntryID(uid), board = db.collection('leaderboard');
        const cache = db.collection('users').doc(uid).collection('leaderboardCache').doc('standing');
        const leaders = await board.orderBy('totalPoints', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(5).get();
        const entries = leaders.docs.map(entry), inTop = entries.find(item => item.id === ownID);
        if (inTop) return { version: 1, entries, ownID, standingUnavailable: false,
            standing: { entry: inTop, rank: entries.filter(item => item.points > inTop.points).length + 1 } };
        try {
            const [own, cached] = await db.getAll(board.doc(ownID), cache);
            const personal = entry(own), at = now();
            let standing = null;
            if (personal) {
                const previous = cached.data();
                let rank;
                if (previous?.schemaVersion === 1 && previous.points === personal.points
                    && Number.isSafeInteger(previous.rank) && previous.rank >= 1
                    && previous.calculatedAtMs <= at && previous.calculatedAtMs > at - 60_000) {
                    rank = previous.rank;
                } else {
                    // Aggregation scans index entries, not user/history documents. Its
                    // cost is proportional to higher-scoring accounts, not constant.
                    // One-minute per-account reuse + read admission bounds refresh abuse;
                    // never fan out rank writes when one ranger gains a point.
                    const higher = await board.where('totalPoints', '>', personal.points).count().get();
                    rank = higher.data().count + 1;
                    // One replaceable cache row per account, not an accumulating archive.
                    // Account deletion must include this private subcollection.
                    // Admission happened before the count. Serialize this delayed write
                    // with deletion so an in-flight read cannot resurrect a private cache.
                    await db.runTransaction(async tx => {
                        requireWritableProfile((await tx.get(cache.parent.parent)).data(), false);
                        tx.set(cache, { schemaVersion: 1, points: personal.points, rank, calculatedAtMs: at });
                    });
                }
                standing = { entry: personal, rank };
            }
            return { version: 1, entries, standing, ownID, standingUnavailable: false };
        } catch {
            // The five already-read leaders remain usable during an independent
            // personal lookup/cache failure. Never invent a personal rank of zero.
            return { version: 1, entries, standing: null, ownID, standingUnavailable: true };
        }
    };
}
module.exports = { parseLeaderboard, createLeaderboardReader };
