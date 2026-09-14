'use strict';

const v = require('../shared/validation');
const { invalid } = require('../shared/errors');
const { planningNoteID } = require('./identity');
const { revision, nextRevision, noteBytes } = require('./records');

function parse(payload) {
    v.object(payload, ['tripID', 'notes']);
    v.identifier(payload.tripID);
    if (!Array.isArray(payload.notes) || payload.notes.length < 1 || payload.notes.length > 502) {
        invalid('Invalid note edits.');
    }
    for (const note of payload.notes) {
        v.object(note, ['id', 'stopID', 'expectedRevision', 'text']);
        v.identifier(note.stopID); v.integer(note.expectedRevision, 1);
        v.text(note.text, { max: 1000 });
        if (note.id !== planningNoteID(payload.tripID, note.stopID)) invalid('Invalid planning note.');
    }
    if (new Set(payload.notes.map(note => note.id)).size !== payload.notes.length) invalid('Duplicate note edit.');
    return payload;
}

// One explicit Save is one transaction, even when several existing notes changed.
// A first note, day notes or changed itinerary references still use saveTrip. Only
// that handler establishes links; clients cannot forge linkedToTrip or note ownership.
const saveTripNotes = {
    parse, requiresPremium: true, rateGroup: 'trip', rateMaximum: 30,
    async prepare({ tx, user, payload, expectedRevision, stamp }) {
        const tripRef = user.collection('trips').doc(payload.tripID);
        const noteRefs = payload.notes.map(note => user.collection('notes').doc(note.id));
        const [tripSnapshot, ...snapshots] = await tx.getAll(tripRef, ...noteRefs);
        const trip = tripSnapshot.data(), notes = snapshots.map(snapshot => snapshot.data());
        const tripRevision = trip?.contentRevision ?? 0;
        const noteRevisions = Object.fromEntries(payload.notes.map((edit, i) => [edit.id, revision(notes[i])]));
        if (!trip || trip.deleted === true || tripRevision !== expectedRevision
            || notes.some((note, i) => !note || note.deleted === true || note.linkedToTrip !== true
                || noteRevisions[payload.notes[i].id] !== payload.notes[i].expectedRevision)) {
            return { status: 'conflict', revisions: { trip: tripRevision, notes: noteRevisions } };
        }
        for (const [i, note] of notes.entries()) {
            if (note.tripID !== payload.tripID || note.stopID !== payload.notes[i].stopID) invalid('Invalid note context.');
        }
        const contentBytes = payload.notes.reduce((bytes, edit, i) =>
            bytes - noteBytes(notes[i].text) + noteBytes(edit.text), trip.contentBytes);
        if (!Number.isSafeInteger(contentBytes) || contentBytes < 0 || contentBytes > 350_000) {
            invalid('Trip content exceeds the supported size.');
        }
        const metadataRevision = nextRevision(revision(trip));
        const nextNotes = Object.fromEntries(payload.notes.map(edit => [edit.id, nextRevision(edit.expectedRevision)]));
        return { status: 'accepted', revisions: { trip: tripRevision, metadata: metadataRevision, notes: nextNotes },
            commit(transaction) {
                for (const [i, edit] of payload.notes.entries()) {
                    transaction.update(noteRefs[i], { text: edit.text, revision: nextNotes[edit.id], updatedAt: stamp });
                }
                transaction.update(tripRef, { contentBytes, revision: metadataRevision, updatedAt: stamp });
            } };
    },
};

module.exports = { saveTripNotes };
