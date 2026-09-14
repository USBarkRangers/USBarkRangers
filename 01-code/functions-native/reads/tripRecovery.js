'use strict';

const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { planningNoteID } = require('../trips/identity');
const { encode, serverTime } = require('./encoding');

function parseRecovery(input) {
    v.object(input, ['version', 'tripID', 'stopIDs']);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
    v.identifier(input.tripID);
    if (!Array.isArray(input.stopIDs) || input.stopIDs.length > 502
        || new Set(input.stopIDs).size !== input.stopIDs.length) throw new NativeError('invalid', 'Invalid recovery references.');
    input.stopIDs.forEach(v.identifier);
    return input;
}
function createTripRecoveryReader(db) {
    return async (uid, input) => {
        parseRecovery(input);
        const user = db.collection('users').doc(uid);
        return db.runTransaction(async tx => {
            const refs = input.stopIDs.map(id => user.collection('notes').doc(planningNoteID(input.tripID, id)));
            const snapshots = await tx.getAll(user.collection('trips').doc(input.tripID), ...refs);
            const [metadata, ...notes] = snapshots;
            const existing = notes.filter(note => note.exists);
            if (existing.some(note => note.get('tripID') !== input.tripID || !input.stopIDs.includes(note.get('stopID')))) {
                throw new NativeError('unavailable', 'These note references need recovery.');
            }
            // Explicit conflict recovery may reference a removed stop. Read only the requested
            // owner/context IDs, not all historical notes for the place or trip.
            return { version: 1, tripID: input.tripID, metadata: metadata.exists ? encode(metadata.data()) : null,
                notes: existing.map(note => encode(note.data())), readTime: serverTime(metadata.readTime) };
        }, { readOnly: true });
    };
}
module.exports = { createTripRecoveryReader, parseRecovery };
