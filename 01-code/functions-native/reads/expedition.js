'use strict';

const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { uuid } = require('../activities/validation');
const { encode, serverTime } = require('./encoding');
const trails = require('../expeditions/trails.json');

function version(input, allowed, required = allowed) {
    v.object(input, allowed, required);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
}
function parseExpedition(input) {
    version(input, ['version', 'activityID', 'runID'], ['version']);
    if (input.activityID != null) uuid(input.activityID);
    if (input.runID != null) uuid(input.runID);
    return input;
}
function createExpeditionReader(db) {
    return async (uid, input) => {
        parseExpedition(input);
        const user = db.collection('users').doc(uid);
        return db.runTransaction(async tx => {
            const refs = [user.collection('state').doc('expedition'), user.collection('state').doc('progress')];
            if (input.activityID) refs.push(user.collection('activities').doc(input.activityID), user.collection('activityClaims').doc(input.activityID));
            const [state, progress, activity, claim] = await tx.getAll(...refs);
            const runIDs = [...new Set([state.get('activeRunID'), input.runID,
                activity?.get('runID')].filter(id => id != null))];
            for (const id of runIDs) uuid(id);
            const runs = runIDs.length ? await tx.getAll(...runIDs.map(id => user.collection('virtualRuns').doc(id))) : [];
            return { version: 1, activityID: input.activityID ?? null, runID: input.runID ?? null,
                state: state.exists ? encode(state.data()) : null,
                progress: progress.exists ? encode(progress.data()) : null,
                activity: activity?.exists ? encode(activity.data()) : null, activityClaimed: claim?.exists ?? false,
                runs: runs.filter(row => row.exists).map(row => encode(row.data())), readTime: serverTime(state.readTime) };
        }, { readOnly: true });
    };
}
function parseActivityClaims(input) {
    version(input, ['version', 'activityIDs']);
    if (!Array.isArray(input.activityIDs) || input.activityIDs.length < 1 || input.activityIDs.length > 100
        || new Set(input.activityIDs).size !== input.activityIDs.length) {
        throw new NativeError('invalid', 'Select at most 100 activity identities.');
    }
    for (const id of input.activityIDs) uuid(id);
    return input;
}
function createActivityClaimsReader(db) {
    return async (uid, input) => {
        parseActivityClaims(input);
        const user = db.collection('users').doc(uid);
        const rows = await db.getAll(...input.activityIDs.map(id => user.collection('activityClaims').doc(id)));
        return { version: 1, activityIDs: input.activityIDs, claimedIDs: rows.filter(row => row.exists).map(row => row.id),
            readTime: serverTime(rows[0].readTime) };
    };
}
const parseCompletedTrails = input => { version(input, ['version']); return input; };
const createCompletedTrailsReader = db => async (uid, input) => {
    parseCompletedTrails(input);
    const snapshot = await db.collection('users').doc(uid).collection('completedTrails').orderBy('updatedAt').limit(trails.length + 1).get();
    if (snapshot.size > trails.length) throw new NativeError('unsupported-contract', 'Completed-trail catalog requires review.');
    return { version: 1, items: snapshot.docs.map(row => encode(row.data())), readTime: serverTime(snapshot.readTime) };
};
module.exports = { parseExpedition, createExpeditionReader, parseActivityClaims, createActivityClaimsReader,
    parseCompletedTrails, createCompletedTrailsReader };
