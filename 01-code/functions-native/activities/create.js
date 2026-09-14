'use strict';

const { NativeError, invalid } = require('../shared/errors');
const validation = require('./validation');
const { requireActivity, makeActivity } = require('./records');
const { activityFingerprint, requireNoOverlap, stageIdentity } = require('./overlap');
const { readExpeditionState, readRun, requireActiveRun, revisions } = require('../expeditions/context');
const { advanceState, advanceRun } = require('../expeditions/records');
const { prepareProgress } = require('../expeditions/progress');

function createRecordActivity({ catalog }) {
    return { parse: validation.parseRecord, requiresPremium: true, rateGroup: 'activities', rateMaximum: 60,
        async prepare(context) {
            const { tx, user, payload, stamp, nowMs, expectedRevision } = context;
            if (expectedRevision !== 0) invalid('A recorded activity must use a new identity.');
            validation.requireNotFuture(payload.endedAtMs, nowMs);
            const { state, progress: previousProgress } = await readExpeditionState(tx, user);
            const [claim, activitySnapshot] = await tx.getAll(user.collection('activityClaims').doc(payload.activityID),
                user.collection('activities').doc(payload.activityID));
            const previous = activitySnapshot.data();
            requireActivity(previous, payload.activityID);
            const run = await readRun(tx, user, state.activeRunID);
            requireActiveRun(state, run);
            if (claim.exists) {
                if (claim.get('schemaVersion') !== 1 || claim.get('fingerprint') !== activityFingerprint(payload)) {
                    throw new NativeError('activity-reused', 'This activity identity already belongs to another summary.');
                }
                // This independent identity survives receipt/tombstone expiration and
                // recovery of a local recording file. Deleted activities are not recreated.
                const assignedRun = payload.runID === state.activeRunID ? run : await readRun(tx, user, payload.runID);
                return { status: 'accepted', revisions: revisions(state, previousProgress,
                    { activity: previous, run: assignedRun, claimed: true }) };
            }
            if (previous) throw new NativeError('unsupported-contract', 'Activity identity requires recovery.');
            if (payload.runID !== state.activeRunID) {
                const requestedRun = await readRun(tx, user, payload.runID);
                return { status: 'conflict', revisions: revisions(state, previousProgress, { run: requestedRun }) };
            }
            await requireNoOverlap(tx, user, payload);
            const activity = makeActivity(payload, run, stamp);
            const next = advanceState(state, stamp, { miles: activity.miles });
            const nextRun = run ? advanceRun(run, stamp, { miles: activity.miles }) : null;
            const progress = await prepareProgress(context, catalog, previousProgress, { kind: 'activity', id: activity.id });
            return { status: 'accepted', revisions: { ...revisions(next, previousProgress, { activity, run: nextRun, claimed: true }),
                progress: progress.revision }, commit(transaction) {
                transaction.create(user.collection('activities').doc(activity.id), activity);
                stageIdentity(transaction, user, payload, stamp);
                transaction.set(user.collection('state').doc('expedition'), next);
                if (nextRun) transaction.set(user.collection('virtualRuns').doc(nextRun.id), nextRun);
                progress.commit(transaction);
            } };
        },
    };
}
module.exports = { createRecordActivity };
