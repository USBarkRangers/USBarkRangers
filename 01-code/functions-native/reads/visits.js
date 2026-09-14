'use strict';

const { FieldPath } = require('firebase-admin/firestore');
const v = require('../shared/validation');
const { NativeError, invalid } = require('../shared/errors');
const { encode, serverTime } = require('./encoding');

function version(input, allowed, required = allowed) {
    v.object(input, allowed, required);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
}
function parseVisit(input) {
    version(input, ['version', 'visitID', 'officialPlaceID']);
    v.identifier(input.visitID); v.identifier(input.officialPlaceID);
    return input;
}
function createVisitReader(db, catalog) {
    return async (uid, input) => {
        parseVisit(input);
        const park = catalog.park(input.officialPlaceID);
        if (!park || park.id !== input.officialPlaceID) invalid('Use a canonical official place.');
        const user = db.collection('users').doc(uid);
        return db.runTransaction(async tx => {
            const [visit, place, progress] = await tx.getAll(user.collection('visits').doc(input.visitID),
                user.collection('placeProgress').doc(park.siteID), user.collection('state').doc('progress'));
            if (visit.exists && visit.get('officialPlaceID') !== input.officialPlaceID) invalid('Visit identity does not match.');
            return { version: 1, visitID: input.visitID, officialPlaceID: input.officialPlaceID, siteID: park.siteID,
                visit: visit.exists ? encode(visit.data()) : null, placeProgress: place.exists ? encode(place.data()) : null,
                progress: progress.exists ? encode(progress.data()) : null, readTime: serverTime(visit.readTime) };
        }, { readOnly: true });
    };
}
function parseVisitHistory(input) {
    version(input, ['version', 'before'], ['version']);
    if (input.before != null) {
        v.object(input.before, ['happenedAtMs', 'id']);
        v.integer(input.before.happenedAtMs); v.identifier(input.before.id);
    }
    return input;
}
function createVisitHistoryReader(db) {
    return async (uid, input) => {
        parseVisitHistory(input);
        let query = db.collection('users').doc(uid).collection('visits').where('deleted', '==', false)
            .orderBy('happenedAtMs', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(51);
        if (input.before) query = query.startAfter(input.before.happenedAtMs, input.before.id);
        const snapshot = await query.get(), visible = snapshot.docs.slice(0, 50), last = visible.at(-1);
        return { version: 1, items: visible.map(doc => encode(doc.data())), readTime: serverTime(snapshot.readTime),
            next: snapshot.size > 50 ? { happenedAtMs: last.get('happenedAtMs'), id: last.id } : null };
    };
}
const parseProgress = input => { version(input, ['version']); return input; };
const createProgressReader = db => async (uid, input) => {
    parseProgress(input);
    const snapshot = await db.collection('users').doc(uid).collection('state').doc('progress').get();
    return { version: 1, progress: snapshot.exists ? encode(snapshot.data()) : null, readTime: serverTime(snapshot.readTime) };
};

module.exports = { parseVisit, createVisitReader, parseVisitHistory, createVisitHistoryReader, parseProgress, createProgressReader };
