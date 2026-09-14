'use strict';

const validation = require('./validation');
const { revision, nextRevision, noteBytes } = require('./records');
const { invalid } = require('../shared/errors');

const editNote = {
    parse: validation.editNote, requiresPremium: true, rateGroup: 'note', rateMaximum: 60, confirmationNeedsTimestamp: true,
    async prepare({ tx, user, payload, expectedRevision, stamp }) {
        const noteRef = user.collection('notes').doc(payload.noteID);
        const tripRef = user.collection('trips').doc(payload.tripID);
        const [noteSnapshot, tripSnapshot] = await tx.getAll(noteRef, tripRef);
        const note = noteSnapshot.data(), trip = tripSnapshot.data();
        const current = revision(note);
        const metadataRevision = revision(trip);
        const tripRevision = trip?.contentRevision ?? 0;
        if (!note || !trip || note.deleted === true || note.linkedToTrip !== true
            || trip.deleted === true || current !== expectedRevision) {
            return { status: 'conflict', revisions: { trip: tripRevision, notes: { [payload.noteID]: current } } };
        }
        if (note.tripID !== payload.tripID || note.stopID !== payload.stopID) invalid('Invalid note context.');
        const contentBytes = trip.contentBytes - noteBytes(note.text) + noteBytes(payload.text);
        if (!Number.isSafeInteger(contentBytes) || contentBytes < 0 || contentBytes > 350_000) invalid('Trip content exceeds the supported size.');
        const next = nextRevision(current);
        return { status: 'accepted', revisions: { trip: tripRevision, metadata: nextRevision(metadataRevision),
            notes: { [payload.noteID]: next } },
            confirmation: { ...trip, contentBytes, revision: nextRevision(metadataRevision), updatedAt: stamp }, commit(transaction) {
            transaction.update(noteRef, { text: payload.text, revision: next, updatedAt: stamp });
            // Do not touch itinerary/revision or route geometry for an independent note edit.
            transaction.update(tripRef, { contentBytes, revision: nextRevision(metadataRevision), updatedAt: stamp });
        } };
    },
};

module.exports = { editNote };
