'use strict';

const { nextRevision } = require('../shared/records');
const { readProgress, score } = require('../progress/summary');
const { evaluateAwards } = require('../progress/awards');
const { firstPlaceEvidence, projection, stageAwards } = require('../progress/evidence');
const { publicEntryID } = require('../profile/commands');

async function prepareProgress(context, catalog, previous, source, pointDelta = 0) {
    const { tx, db, user, uid, profile, stamp, nowMs } = context;
    const progress = readProgress(previous);
    if (pointDelta) progress.walkPoints = nextRevision(progress.walkPoints); // One completion point only.
    score(progress); // Validate aggregate integer bounds before any write.
    const first = await firstPlaceEvidence(tx, db, uid, progress);
    const awards = evaluateAwards(progress, catalog, { first, nowMs });
    const changed = !previous || pointDelta !== 0 || awards.length > 0;
    if (changed) progress.revision = nextRevision(progress.revision);
    return { revision: progress.revision, commit(transaction) {
        if (changed) transaction.set(user.collection('state').doc('progress'), { ...progress, updatedAt: stamp });
        stageAwards(transaction, user, awards, source, stamp);
        if (!previous || pointDelta !== 0) transaction.set(db.collection('leaderboard').doc(publicEntryID(uid)),
            { ...projection(progress, profile.displayName), updatedAt: stamp });
    } };
}
module.exports = { prepareProgress };
