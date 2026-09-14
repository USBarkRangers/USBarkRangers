'use strict';

const validation = require('./validation');
const { revision, nextRevision, logicalSize, assertPlanningNote } = require('./records');
const { canonicalJSON } = require('../shared/validation');
const { invalid } = require('../shared/errors');
const { detachedPlanningNote } = require('./retention');

function noteIDs(content) {
    if (!content) return new Set();
    return new Set([...content.days.flatMap(day => day.stops), content.start, content.end]
        .filter(Boolean).map(stop => stop.noteID).filter(Boolean));
}

function createSaveTrip({ catalog }) {
    return { parse: validation.saveTrip, requiresPremium: true, rateGroup: 'trip', rateMaximum: 30, confirmationNeedsTimestamp: true,
        async prepare({ tx, user, payload, expectedRevision, stamp, nowMs }) {
            const tripRef = user.collection('trips').doc(payload.tripID);
            const contentRef = tripRef.collection('content').doc('itinerary');
            const [metadataSnapshot, contentSnapshot] = await tx.getAll(tripRef, contentRef);
            const metadata = metadataSnapshot.data();
            const currentMetadataRevision = revision(metadata);
            const previousContent = contentSnapshot.data();
            const currentRevision = metadata?.deleted === true ? metadata.contentRevision : revision(previousContent);
            if ((metadata != null) !== (previousContent != null) && metadata?.deleted !== true) invalid('Trip content is incomplete.');
            if (metadata && metadata.contentRevision !== currentRevision && metadata.deleted !== true) invalid('Trip revisions are inconsistent.');
            if (currentRevision !== expectedRevision || metadata?.deleted === true) {
                return { status: 'conflict', revisions: { trip: currentRevision } };
            }
            const places = new Map(payload.stops.map(stop => [stop.placeID, stop]));
            // Validate approved official IDs/aliases against the public native catalog, never
            // against client names or an old account database. Unknown official IDs fail closed.
            for (const stop of places.values()) {
                if (stop.placeIdentity.kind === 'official'
                    && catalog.canonicalID(stop.placeIdentity.id) !== stop.placeIdentity.id) {
                    invalid('Use the current canonical official place identity.');
                }
            }
            const noteStops = new Map(payload.stops.filter(stop => stop.noteID).map(stop => [stop.noteID, stop]));
            const placeRefs = [...places.keys()].map(id => user.collection('places').doc(id));
            const noteRefs = [...noteStops.keys()].map(id => user.collection('notes').doc(id));
            const refs = [...placeRefs, ...noteRefs];
            const snapshots = refs.length ? await tx.getAll(...refs) : [];
            const existing = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot.data()]));
            const noteEdits = new Map(payload.notes.map(note => [note.id, note]));
            const noteRevisions = {};
            const noteWrites = [];
            const texts = [];
            for (const [id, stop] of noteStops) {
                const ref = user.collection('notes').doc(id);
                const prior = existing.get(ref.path);
                const priorRevision = revision(prior);
                if (prior) assertPlanningNote(prior, payload.tripID, stop);
                const edit = noteEdits.get(id);
                if (!prior && !edit) invalid('Create a referenced note in the same saved operation.');
                if (edit && edit.expectedRevision !== priorRevision) {
                    return { status: 'conflict', revisions: { trip: currentRevision, notes: { [id]: priorRevision } } };
                }
                const text = edit?.text ?? prior.text;
                validation.editNote({ tripID: payload.tripID, stopID: stop.id, noteID: id, text });
                texts.push(text);
                const changed = edit || prior?.linkedToTrip !== true;
                noteRevisions[id] = changed ? nextRevision(priorRevision) : priorRevision;
                if (changed) noteWrites.push({ ref, value: { schemaVersion: 1, revision: noteRevisions[id],
                    tripID: payload.tripID, stopID: stop.id, placeID: stop.placeID, text, linkedToTrip: true,
                    deleted: false, createdAt: prior?.createdAt ?? stamp, updatedAt: stamp } });
            }
            const next = nextRevision(currentRevision);
            const nextMetadata = nextRevision(currentMetadataRevision);
            const content = { schemaVersion: 1, revision: next, tripID: payload.tripID,
                name: payload.name, days: payload.days, start: payload.start, end: payload.end };
            const contentBytes = logicalSize(content, texts);
            const placeWrites = [];
            for (const [id, stop] of places) {
                const ref = user.collection('places').doc(id);
                const prior = existing.get(ref.path);
                if (prior) {
                    revision(prior);
                    if (prior.deleted === true || canonicalJSON(prior.identity) !== canonicalJSON(stop.placeIdentity)) {
                        invalid('This place reference is unavailable.');
                    }
                } else {
                    placeWrites.push({ ref, value: { schemaVersion: 1, revision: 1, identity: stop.placeIdentity,
                        name: stop.name, coordinate: stop.coordinate, state: stop.state,
                        deleted: false, createdAt: stamp, updatedAt: stamp } });
                }
            }
            const removedNoteIDs = [...noteIDs(previousContent)].filter(id => !noteStops.has(id));
            const confirmedMetadata = { id: payload.tripID, schemaVersion: 1, revision: nextMetadata, contentRevision: next, title: payload.name,
                dayCount: payload.days.length, stopCount: payload.stops.length,
                contentBytes, deleted: false, createdAt: metadata?.createdAt ?? stamp, updatedAt: stamp };
            return { status: 'accepted', revisions: { trip: next, metadata: nextMetadata, notes: noteRevisions },
                confirmation: confirmedMetadata, commit(transaction) {
                transaction.set(tripRef, confirmedMetadata);
                transaction.set(contentRef, { ...content, updatedAt: stamp });
                for (const { ref, value } of [...placeWrites, ...noteWrites]) transaction.set(ref, value);
                for (const id of removedNoteIDs) transaction.update(user.collection('notes').doc(id),
                    detachedPlanningNote(stamp, nowMs));
                // Private place references have independent ownership. Only detached
                // trip-owned planning notes enter bounded recovery retention.
            } };
        },
    };
}

module.exports = { createSaveTrip, noteIDs };
