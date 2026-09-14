'use strict';

const { createHash } = require('node:crypto');

// Current planning notes belong to one trip occurrence. J1 shared place notes will
// be a different explicit context; duplicating planning notes must stay independent.
function planningNoteID(tripID, stopID) {
    const parts = [tripID, stopID].map(value => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('');
    return createHash('sha256').update(`bark-native-planning-note:${parts}`).digest('hex');
}

module.exports = { planningNoteID };
