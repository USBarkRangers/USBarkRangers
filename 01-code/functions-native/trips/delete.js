'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const v = require('../shared/validation');
const { revision, nextRevision } = require('./records');
const { noteIDs } = require('./save');

const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const deleteTrip = {
    parse(payload) { v.object(payload, ['tripID']); v.identifier(payload.tripID); return payload; },
    requiresPremium: true, rateGroup: 'trip', rateMaximum: 30,
    async prepare({ tx, user, payload, expectedRevision, stamp, nowMs }) {
        const ref = user.collection('trips').doc(payload.tripID);
        const contentRef = ref.collection('content').doc('itinerary');
        const [tripSnapshot, contentSnapshot] = await tx.getAll(ref, contentRef);
        const trip = tripSnapshot.data();
        const current = trip?.contentRevision ?? 0;
        if (!trip || trip.deleted === true || current !== expectedRevision) {
            return { status: 'conflict', revisions: { trip: current } };
        }
        const next = nextRevision(current), metadataRevision = nextRevision(revision(trip));
        return { status: 'accepted', revisions: { trip: next, metadata: metadataRevision }, commit(transaction) {
            // Keep a bounded tombstone for incremental clients; never infer deletion from
            // leaving a ten-row library window. Retention exceeds the intent acceptance window.
            transaction.set(ref, { id: payload.tripID, schemaVersion: 1, revision: metadataRevision, contentRevision: next,
                deleted: true, createdAt: trip.createdAt, updatedAt: stamp,
                expiresAt: Timestamp.fromMillis(nowMs + TOMBSTONE_RETENTION_MS) });
            transaction.delete(contentRef);
            for (const id of noteIDs(contentSnapshot.data())) transaction.update(user.collection('notes').doc(id),
                { linkedToTrip: false, revision: FieldValue.increment(1), updatedAt: stamp });
            // J1: places and canonical notes have independent ownership. Trip deletion does
            // not erase them or future shared journal/media content.
        } };
    },
};

module.exports = { deleteTrip, TOMBSTONE_RETENTION_MS };
