'use strict';

const v = require('../shared/validation');
const { storageID } = require('../shared/placeIdentity');
const { invalid } = require('../shared/errors');
const { nextRevision, revision } = require('../trips/records');

function parseBookmark(value) {
    v.object(value, ['pinID', 'saved', 'place']);
    const p = value.place;
    v.object(p, ['identity', 'name', 'coordinate', 'state', 'subtitle', 'stopID', 'savedAtMs']);
    if (p.identity?.kind === 'official' || (p.identity?.kind === 'provider' && p.identity.provider !== 'apple')
        || storageID(p.identity) !== value.pinID) invalid('Invalid bookmark identity.');
    if (typeof value.saved !== 'boolean') invalid('Invalid saved state.');
    v.text(p.name, { min: 1, max: 200 }); v.text(p.state, { max: 100 });
    v.text(p.subtitle, { max: 500 }); v.identifier(p.stopID); v.integer(p.savedAtMs, 0, 253_402_300_799_999);
    v.object(p.coordinate, ['latitude', 'longitude']);
    const { latitude, longitude } = p.coordinate;
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
        || !Number.isFinite(longitude) || Math.abs(longitude) > 180) invalid('Invalid coordinate.');
    return value;
}

// A bookmark is membership on the existing private place, not a second place or
// journal document. Un-saving NEVER deletes place content, notes or trip references.
// Keep the tiny false membership for incremental offline sync; account deletion
// removes it with the owner tree. Journal text/photos belong in separate detail records.
function bookmarkView(value, id) {
    return { schemaVersion: 1, id, revision: value.revision, saved: value.bookmark.saved,
        place: { identity: value.identity, name: value.name, coordinate: value.coordinate, state: value.state,
            subtitle: value.bookmark.subtitle, stopID: value.bookmark.stopID, savedAtMs: value.bookmark.savedAtMs } };
}

const setSavedPin = { parse: parseBookmark, requiresPremium: true, rateGroup: 'savedPins', rateMaximum: 120,
    async prepare({ tx, user, payload, stamp }) {
        const ref = user.collection('places').doc(payload.pinID), prior = (await tx.get(ref)).data();
        if (prior && (prior.deleted === true || storageID(prior.identity) !== payload.pinID)) invalid('Unavailable place.');
        const next = nextRevision(revision(prior));
        const p = payload.place;
        // Remove only changes membership. A newer label on another device is not
        // overwritten by the older phone's removal preimage.
        const value = !payload.saved && prior?.bookmark
            ? { ...prior, revision: next, bookmark: { ...prior.bookmark, saved: false }, updatedAt: stamp }
            : { ...prior, schemaVersion: 1, revision: next, identity: p.identity, name: p.name,
                coordinate: p.coordinate, state: p.state, deleted: false,
                bookmark: { version: 1, saved: payload.saved, subtitle: p.subtitle,
                    stopID: p.stopID, savedAtMs: p.savedAtMs }, createdAt: prior?.createdAt ?? stamp, updatedAt: stamp };
        return { status: 'accepted', revisions: { savedPin: next }, confirmation: bookmarkView(value, ref.id),
            commit(transaction) { transaction.set(ref, value); } };
    } };

module.exports = { parseBookmark, bookmarkView, setSavedPin };
