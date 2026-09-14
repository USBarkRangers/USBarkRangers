'use strict';

const v = require('../shared/validation');
const { NativeError, invalid } = require('../shared/errors');
const { encode, serverTime } = require('./encoding');

function parseVisitSelection(input) {
    v.object(input, ['version', 'visits']);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
    if (!Array.isArray(input.visits) || input.visits.length < 1 || input.visits.length > 500) invalid('Invalid visit selection.');
    const ids = new Set();
    for (const item of input.visits) {
        v.object(item, ['visitID', 'officialPlaceID']);
        v.identifier(item.visitID); v.identifier(item.officialPlaceID);
        if (ids.has(item.visitID)) invalid('Duplicate visit selection.');
        ids.add(item.visitID);
    }
    return input;
}
function createVisitSelectionReader(db, catalog) {
    return async (uid, input) => {
        parseVisitSelection(input);
        const requests = input.visits.map(item => {
            const park = catalog.park(item.officialPlaceID);
            if (!park || park.id !== item.officialPlaceID) invalid('Use canonical official places.');
            return { ...item, siteID: park.siteID };
        });
        const siteIDs = [...new Set(requests.map(item => item.siteID))];
        const user = db.collection('users').doc(uid);
        return db.runTransaction(async tx => {
            const results = await tx.getAll(user.collection('state').doc('progress'),
                ...requests.map(item => user.collection('visits').doc(item.visitID)),
                ...siteIDs.map(id => user.collection('placeProgress').doc(id)));
            const visits = results.slice(1, 1 + requests.length), places = results.slice(1 + requests.length);
            for (const [index, visit] of visits.entries()) {
                if (visit.exists && visit.get('officialPlaceID') !== requests[index].officialPlaceID) invalid('Visit identity does not match.');
            }
            return { version: 1, requests, visits: visits.filter(row => row.exists).map(row => encode(row.data())),
                places: places.filter(row => row.exists).map(row => encode(row.data())),
                progress: results[0].exists ? encode(results[0].data()) : null,
                readTime: serverTime(results[0].readTime) };
        }, { readOnly: true });
    };
}

module.exports = { parseVisitSelection, createVisitSelectionReader };
