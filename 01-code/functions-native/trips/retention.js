'use strict';
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
function detachedPlanningNote(stamp, nowMs) {
    // These records are owned by tripID/stopID, NOT independent journal entries.
    // Retain text for offline conflict recovery, then TTL removes it. Relinking uses
    // a full set without expiresAt. Future place-owned journal notes must not use this policy.
    return { linkedToTrip: false, revision: FieldValue.increment(1), updatedAt: stamp,
        expiresAt: Timestamp.fromMillis(nowMs + TOMBSTONE_RETENTION_MS) };
}
module.exports = { TOMBSTONE_RETENTION_MS, detachedPlanningNote };
