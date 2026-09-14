'use strict';

const v = require('../shared/validation');
const { invalid } = require('../shared/errors');
const { uuid, optionalRun } = require('../activities/validation');
const records = require('./records');
const { readExpeditionState, readRun, requireActiveRun, revisions } = require('./context');
const { prepareProgress } = require('./progress');

function createAssignRun({ catalog }) {
    return { requiresPremium: true, rateGroup: 'expeditions', rateMaximum: 30,
        parse(payload) {
            v.object(payload, ['trailID', 'runID', 'expectedActiveRunID']);
            v.identifier(payload.trailID); uuid(payload.runID); optionalRun(payload.expectedActiveRunID);
            if (!records.trail(payload.trailID)) invalid('Unknown virtual trail.');
            return payload;
        },
        async prepare(context) {
            const { tx, user, payload, stamp, createdAtMs, expectedRevision } = context;
            const { state, progress: previousProgress } = await readExpeditionState(tx, user);
            const [active, existing] = await Promise.all([
                readRun(tx, user, state.activeRunID), readRun(tx, user, payload.runID),
            ]);
            requireActiveRun(state, active);
            if (state.selectionRevision !== expectedRevision || state.activeRunID !== payload.expectedActiveRunID || existing) {
                return { status: 'conflict', revisions: revisions(state, previousProgress, { run: existing }) };
            }
            const run = records.makeRun(records.trail(payload.trailID), payload.runID, stamp, createdAtMs);
            const next = { ...records.advanceState(state, stamp, { selection: true }), activeRunID: run.id };
            const progress = await prepareProgress(context, catalog, previousProgress, { kind: 'virtualRun', id: run.id });
            return { status: 'accepted', revisions: { ...revisions(next, previousProgress, { run }), progress: progress.revision },
                commit(transaction) {
                    transaction.create(user.collection('virtualRuns').doc(run.id), run);
                    if (active) transaction.set(user.collection('virtualRuns').doc(active.id),
                        records.advanceRun(active, stamp, { status: 'abandoned' }));
                    transaction.set(user.collection('state').doc('expedition'), next);
                    progress.commit(transaction);
                } };
        },
    };
}
module.exports = { createAssignRun };
