'use strict';

const { invalid } = require('../shared/errors');
const { canonicalJSON } = require('../shared/validation');
const { revision, nextRevision } = require('../shared/records');

function noteBytes(text) { return Buffer.byteLength(JSON.stringify(text), 'utf8'); }
function logicalSize(content, texts) {
    const bytes = Buffer.byteLength(canonicalJSON(content), 'utf8')
        + texts.reduce((sum, text) => sum + noteBytes(text), 0);
    if (bytes > 350_000) invalid('Trip content exceeds the supported size.');
    return bytes;
}
function assertPlanningNote(note, tripID, stop) {
    revision(note);
    if (note.deleted === true || note.tripID !== tripID || note.stopID !== stop.id || note.placeID !== stop.placeID) {
        invalid('The note does not belong to this trip stop.');
    }
}

module.exports = { revision, nextRevision, logicalSize, noteBytes, assertPlanningNote };
