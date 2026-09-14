'use strict';

const v = require('../shared/validation');
const { NativeError } = require('../shared/errors');
const { uuid } = require('../activities/validation');
const { advanceState, advanceRun } = require('./records');
const { MILE } = require('../activities/validation');
const { readExpeditionState, readRun, requireActiveRun, revisions } = require('./context');
const { prepareProgress } = require('./progress');

function createClaimRun({ catalog }) {
    return { requiresPremium: true, rateGroup: 'expeditions', rateMaximum: 30,
        parse(payload) { v.object(payload, ['runID']); uuid(payload.runID); return payload; },
        async prepare(context) {
            const { tx, user, payload, expectedRevision, stamp, createdAtMs } = context;
            const { state, progress: previousProgress } = await readExpeditionState(tx, user);
            const run = await readRun(tx, user, payload.runID);
            if (!run || run.revision !== expectedRevision || state.activeRunID !== payload.runID || run.status !== 'active') {
                return { status: 'conflict', revisions: revisions(state, previousProgress, { run }) };
            }
            requireActiveRun(state, run);
            if (run.miles < run.totalMiles) throw new NativeError('incomplete-expedition', 'This virtual run is not complete.');
            const completed = { ...advanceRun(run, stamp, { status: 'completed' }), completedAtMs: createdAtMs,
                completedAt: stamp, completionPoints: 1 };
            const next = { ...advanceState(state, stamp, { selection: true }), activeRunID: null };
            const progress = await prepareProgress(context, catalog, previousProgress, { kind: 'virtualRun', id: run.id }, 1);
            return { status: 'accepted', revisions: { ...revisions(next, previousProgress, { run: completed }), progress: progress.revision },
                commit(transaction) {
                    transaction.set(user.collection('virtualRuns').doc(run.id), completed);
                    transaction.set(user.collection('state').doc('expedition'), next);
                    // Preserve today's latest-completion-per-trail display. The run itself
                    // retains its independent identity; no growing completed-run array.
                    // Use this run's server-created catalog snapshot. A later catalog
                    // length/name update must not reinterpret a run already in progress.
                    transaction.set(user.collection('completedTrails').doc(run.trailID), {
                        schemaVersion: 1, id: run.trailID, runID: run.id, name: run.name,
                        trailRevision: run.trailRevision, meters: run.totalMiles * MILE,
                        completedAtMs: createdAtMs, updatedAt: stamp,
                    });
                    progress.commit(transaction);
                } };
        },
    };
}
module.exports = { createClaimRun };
