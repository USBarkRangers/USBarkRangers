'use strict';

const validation = require('./validation');
const { requireActivity, editActivity, deleteActivity } = require('./records');
const { readExpeditionState, readRun, requireActiveRun, revisions } = require('../expeditions/context');
const { advanceState, advanceRun } = require('../expeditions/records');
const { prepareProgress } = require('../expeditions/progress');

function createActivityEdits({ catalog }) {
    function handler(remove) {
        return { parse: remove ? validation.parseDelete : validation.parseEdit, requiresPremium: true,
            rateGroup: 'activities', rateMaximum: 60,
            async prepare(context) {
                const { tx, user, payload, expectedRevision, stamp, nowMs } = context;
                if (!remove) validation.requireNotFuture(payload.happenedAtMs, nowMs);
                const { state, progress: previousProgress } = await readExpeditionState(tx, user);
                const previous = (await tx.get(user.collection('activities').doc(payload.activityID))).data();
                requireActivity(previous, payload.activityID);
                if (!previous || previous.deleted || previous.revision !== expectedRevision) {
                    return { status: 'conflict', revisions: revisions(state, previousProgress, { activity: previous }) };
                }
                const run = await readRun(tx, user, state.activeRunID);
                requireActiveRun(state, run);
                const activity = remove ? deleteActivity(previous, stamp, nowMs) : editActivity(previous, payload, stamp);
                const delta = (remove ? 0 : activity.miles) - previous.miles;
                const next = advanceState(state, stamp, { miles: delta });
                // Attribution is the immutable run ID, never an editable display name.
                // A correction to an older run of the same trail cannot affect this run.
                const nextRun = run && previous.runID === run.id ? advanceRun(run, stamp, { miles: delta }) : null;
                const progress = await prepareProgress(context, catalog, previousProgress, { kind: 'activity', id: activity.id });
                return { status: 'accepted', revisions: { ...revisions(next, previousProgress, { activity, run: nextRun, claimed: true }),
                    progress: progress.revision }, commit(transaction) {
                    transaction.set(user.collection('activities').doc(activity.id), activity);
                    transaction.set(user.collection('state').doc('expedition'), next);
                    if (nextRun) transaction.set(user.collection('virtualRuns').doc(nextRun.id), nextRun);
                    progress.commit(transaction);
                } };
            },
        };
    }
    return { updateActivity: handler(false), deleteActivity: handler(true) };
}
module.exports = { createActivityEdits };
