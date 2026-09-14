'use strict';

const { FieldPath } = require('firebase-admin/firestore');
const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { uuid, date } = require('../activities/validation');
const { encode, serverTime } = require('./encoding');

function parseActivityHistory(input) {
    v.object(input, ['version', 'before'], ['version']);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
    if (input.before != null) {
        v.object(input.before, ['happenedAtMs', 'id']); date(input.before.happenedAtMs); uuid(input.before.id);
    }
    return input;
}
function createActivityHistoryReader(db) {
    return async (uid, input) => {
        parseActivityHistory(input);
        let query = db.collection('users').doc(uid).collection('activities').where('deleted', '==', false)
            .orderBy('happenedAtMs', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(51);
        if (input.before) query = query.startAfter(input.before.happenedAtMs, input.before.id);
        const snapshot = await query.get(), visible = snapshot.docs.slice(0, 50), last = visible.at(-1);
        return { version: 1, items: visible.map(row => encode(row.data())), readTime: serverTime(snapshot.readTime),
            next: snapshot.size > 50 ? { happenedAtMs: last.get('happenedAtMs'), id: last.id } : null };
    };
}
module.exports = { parseActivityHistory, createActivityHistoryReader };
