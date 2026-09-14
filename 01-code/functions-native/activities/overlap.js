'use strict';

const { createHash } = require('node:crypto');
const { canonicalJSON } = require('../shared/validation');
const { NativeError } = require('../shared/errors');

function activityFingerprint(payload) {
    return createHash('sha256').update(canonicalJSON(payload)).digest('hex');
}
async function requireNoOverlap(tx, user, payload) {
    if (payload.source === 'manual') return;
    // Accepted nonmanual intervals do not overlap, so the last start before this end
    // is the only candidate needed. End DESC handles a zero-length boundary interval
    // sharing a start with a positive-length interval. Strict inequalities retain the
    // existing adjacent-activity rule. Removal/correction never frees this evidence.
    const neighbors = await tx.get(user.collection('activityIntervals')
        .where('startMs', '<', payload.endedAtMs).orderBy('startMs', 'desc').orderBy('endMs', 'desc').limit(1));
    if (neighbors.docs.some(row => row.get('endMs') > payload.startedAtMs)) {
        throw new NativeError('overlapping-activity', 'This activity overlaps an already recorded interval.');
    }
    // Every accepted activity also writes the per-account expedition-state revision.
    // That serialization point makes concurrent overlapping inserts recheck this query;
    // do not rely on query-result/phantom locking or introduce a global user lock.
}
function stageIdentity(tx, user, payload, stamp) {
    tx.create(user.collection('activityClaims').doc(payload.activityID), {
        schemaVersion: 1, fingerprint: activityFingerprint(payload), acceptedAt: stamp,
    });
    if (payload.source !== 'manual') tx.create(user.collection('activityIntervals').doc(payload.activityID), {
        schemaVersion: 1, startMs: payload.startedAtMs, endMs: payload.endedAtMs,
    });
}
// Minimal private anti-duplication evidence outlives the visible event/tombstone.
// It is denied to direct client access, contains no path/location, and is removed by
// account deletion. The current Health picker checks at most its 100 candidate IDs.
module.exports = { activityFingerprint, requireNoOverlap, stageIdentity };
