'use strict';

const { FieldPath } = require('firebase-admin/firestore');
const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { encode, timestamp, serverTime } = require('./encoding');

function parseLibrary(input) {
    v.object(input, ['version', 'before'], ['version']);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
    if (input.before != null) {
        v.object(input.before, ['createdAt', 'id']);
        timestamp(input.before.createdAt); v.identifier(input.before.id);
    }
    return input;
}

function createLibraryReader(db) {
    return async (uid, input) => {
        parseLibrary(input);
        let query = db.collection('users').doc(uid).collection('trips').where('deleted', '==', false)
            .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(11);
        if (input.before) query = query.startAfter(timestamp(input.before.createdAt), input.before.id);
        const snapshot = await query.get();
        const visible = snapshot.docs.slice(0, 10), last = visible.at(-1);
        return { version: 1, items: visible.map(doc => encode(doc.data())), readTime: serverTime(snapshot.readTime),
            next: snapshot.size > 10 ? { createdAt: serverTime(last.get('createdAt')), id: last.id } : null };
    };
}
module.exports = { createLibraryReader, parseLibrary };
