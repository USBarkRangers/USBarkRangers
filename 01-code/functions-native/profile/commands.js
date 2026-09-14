'use strict';

const { createHash } = require('node:crypto');
const validate = require('../shared/validation');
const { invalid } = require('../shared/errors');

function publicEntryID(uid) {
    return createHash('sha256').update(`bark-native-leaderboard:${uid}`).digest('hex');
}

function profileRevision(profile) {
    return profile?.revision ?? 0;
}

function updateHandler(parse, update) {
    return {
        parse, requiresPremium: true, rateGroup: 'profile', rateMaximum: 30,
        async prepare(context) {
            const { tx, db, user, profile, uid, payload, stamp } = context;
            const revision = profileRevision(profile);
            // Name and map style are independent field updates: last accepted save
            // wins only its own field. Keep IDs/receipts; no profile conflict screen.
            validate.integer(revision, 1, Number.MAX_SAFE_INTEGER - 1);
            const patch = update(payload);
            const boardRef = db.collection('leaderboard').doc(publicEntryID(uid));
            const board = Object.hasOwn(patch, 'displayName') ? await tx.get(boardRef) : null;
            return { status: 'accepted', revisions: { profile: revision + 1 }, commit(transaction) {
                transaction.update(user, { ...patch, revision: revision + 1, updatedAt: stamp });
                if (board?.exists) transaction.update(boardRef, { displayName: patch.displayName });
            } };
        },
    };
}

const bootstrapAccount = {
    parse(payload) { return validate.object(payload, []); },
    allowCreation: true, requiresPremium: false, rateGroup: 'bootstrap', rateMaximum: 10,
    async prepare({ user, profile, expectedRevision, stamp }) {
        if (profile) return { status: 'accepted', revisions: { profile: profile.revision } };
        if (expectedRevision !== 0) return { status: 'conflict', revisions: { profile: 0 } };
        return { status: 'accepted', revisions: { profile: 1, entitlement: 1 }, commit(tx) {
            tx.create(user, { schemaVersion: 1, revision: 1, status: 'active', displayName: 'Ranger',
                mapStyle: 'default', createdAt: stamp, updatedAt: stamp });
            tx.create(user.collection('state').doc('entitlement'), { schemaVersion: 1, revision: 1,
                premium: false, source: 'none', validUntil: null, updatedAt: stamp });
        } };
    },
};

const updateProfile = updateHandler(payload => {
    validate.object(payload, ['displayName']);
    validate.text(payload.displayName, { min: 2, max: 30, trim: true });
    if (/[\p{Cc}\p{Cf}<>]/u.test(payload.displayName)) invalid('Use a display name of 2–30 characters.');
    return payload;
}, payload => ({ displayName: payload.displayName }));

const updateMapStyle = updateHandler(payload => {
    validate.object(payload, ['mapStyle']);
    validate.choice(payload.mapStyle, ['default', 'satellite']);
    return payload;
}, payload => ({ mapStyle: payload.mapStyle }));

module.exports = { bootstrapAccount, updateProfile, updateMapStyle, publicEntryID };
