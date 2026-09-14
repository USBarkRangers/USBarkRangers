'use strict';

const { revision } = require('../shared/records');
const { NativeError } = require('../shared/errors');
const { readState, requireRun } = require('./records');

async function readExpeditionState(tx, user) {
    const [state, progress] = await tx.getAll(user.collection('state').doc('expedition'), user.collection('state').doc('progress'));
    return { state: readState(state.data()), progress: progress.data() };
}
async function readRun(tx, user, id) {
    if (id === null) return null;
    const run = (await tx.get(user.collection('virtualRuns').doc(id))).data();
    requireRun(run, id);
    return run ?? null;
}
function requireActiveRun(state, run) {
    if (state.activeRunID !== null && (!run || run.id !== state.activeRunID || run.status !== 'active')) {
        throw new NativeError('unsupported-contract', 'The active expedition requires recovery.');
    }
}
function revisions(state, progress, { activity = null, run = null, claimed = false } = {}) {
    return { state: state.revision, selection: state.selectionRevision, progress: revision(progress),
        activity: revision(activity), run: revision(run), activityClaim: claimed ? 1 : 0 };
}
module.exports = { readExpeditionState, readRun, requireActiveRun, revisions };
