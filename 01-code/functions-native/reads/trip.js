'use strict';

const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { noteIDs } = require('../trips/save');
const { encode, serverTime } = require('./encoding');

function createTripReader(db) {
    return async (uid, input) => {
        v.object(input, ['version', 'tripID']);
        if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
        v.identifier(input.tripID);
        const user = db.collection('users').doc(uid), ref = user.collection('trips').doc(input.tripID);
        return db.runTransaction(async tx => {
            const [metadata, content] = await tx.getAll(ref, ref.collection('content').doc('itinerary'));
            if (!metadata.exists || metadata.get('deleted') === true) {
                return { version: 1, tripID: input.tripID, metadata: metadata.exists ? encode(metadata.data()) : null,
                    content: null, notes: [], readTime: serverTime(metadata.readTime) };
            }
            if (!content.exists || content.get('revision') !== metadata.get('contentRevision')) {
                throw new NativeError('unavailable', 'Trip content is being recovered.');
            }
            const ids = [...noteIDs(content.data())];
            if (ids.length > 502) throw new NativeError('unsupported-contract', 'Trip exceeds this app version.');
            const notes = ids.length ? await tx.getAll(...ids.map(id => user.collection('notes').doc(id))) : [];
            if (notes.some(note => !note.exists || note.get('deleted') === true || note.get('linkedToTrip') !== true)) {
                throw new NativeError('unavailable', 'Trip notes are being recovered.');
            }
            return { version: 1, tripID: input.tripID, metadata: encode(metadata.data()), content: encode(content.data()),
                notes: notes.map(note => encode(note.data())), readTime: serverTime(metadata.readTime) };
        }, { readOnly: true });
    };
}

module.exports = { createTripReader };
