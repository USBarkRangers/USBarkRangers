'use strict';

const { FieldPath } = require('firebase-admin/firestore');
const { publicEntryID } = require('../profile/commands');
const { score } = require('./summary');

async function marathonEvidence(tx, user, visit, alreadyEarned) {
    if (alreadyEarned || !visit || visit.deleted) return false;
    const at = visit.happenedAtMs, day = 86_400_000;
    const base = user.collection('visits').where('deleted', '==', false);
    // Only the changed date can create a previously unearned four-visit window. The
    // nearest three neighbors on either side suffice; fetch four to exclude its old row.
    const [before, after] = await Promise.all([
        tx.get(base.where('happenedAtMs', '>=', Math.max(0, at - day)).where('happenedAtMs', '<=', at)
            .orderBy('happenedAtMs', 'desc').limit(4)),
        tx.get(base.where('happenedAtMs', '>', at).where('happenedAtMs', '<=', at + day)
            .orderBy('happenedAtMs', 'asc').limit(4)),
    ]);
    const neighbors = rows => rows.docs.filter(row => row.id !== visit.id).slice(0, 3).map(row => row.get('happenedAtMs'));
    const dates = [...neighbors(before), at, ...neighbors(after)].sort((a, b) => a - b);
    return dates.some((date, index) => index >= 3 && date - dates[index - 3] <= day);
}
async function firstPlaceEvidence(tx, db, uid, progress) {
    if (progress.awards.alphaDog?.tier === 'verified') return false;
    const id = publicEntryID(uid);
    const top = await tx.get(db.collection('leaderboard').orderBy('totalPoints', 'desc')
        .orderBy(FieldPath.documentId(), 'desc').limit(2));
    const rival = top.docs.find(row => row.id !== id);
    // Preserve the award's single stable winner when tied. The displayed personal
    // standing still counts strictly higher scores, as today's UI does.
    return !rival || score(progress) > rival.get('totalPoints')
        || (score(progress) === rival.get('totalPoints') && id > rival.id);
}
function projection(progress, displayName) {
    return { schemaVersion: 1, displayName, totalPoints: score(progress), totalVisited: progress.sites,
        hasVerified: progress.verifiedSites > 0 };
}
function stageAwards(tx, user, awards, source, stamp) {
    for (const award of awards) tx.set(user.collection('awards').doc(award.id), {
        schemaVersion: 1, ...award, source, updatedAt: stamp,
    });
}

module.exports = { marathonEvidence, firstPlaceEvidence, projection, stageAwards };
