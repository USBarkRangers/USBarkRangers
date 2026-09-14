'use strict';

const { invalid } = require('../shared/errors');
const { revision } = require('../shared/records');
const validation = require('./validation');
const { requireVisit, makeVisit, makePlaceProgress } = require('./records');
const { visitProgress, readProgress } = require('../progress/summary');
const { evaluateAwards } = require('../progress/awards');
const { marathonEvidence, firstPlaceEvidence, projection, stageAwards } = require('../progress/evidence');
const { publicEntryID } = require('../profile/commands');
const { createDeleteVisits } = require('./delete');

function createVisitHandlers({ catalog }) {
    function handler(action, parse) {
        return { parse, requiresPremium: true, rateGroup: 'visits', rateMaximum: 60,
            async prepare(context) {
                const { tx, db, user, uid, profile, payload, expectedRevision, stamp, nowMs, createdAtMs } = context;
                const park = catalog.park(payload.officialPlaceID);
                if (!park || park.id !== payload.officialPlaceID) invalid('Use a canonical official place.');
                if (action === 'mark' && park.isRetired) invalid('This official place is retired.');
                validation.requireVisitDate(payload, nowMs);
                if (payload.proximity) validation.requireProximity(payload.proximity, park, createdAtMs);
                const visitRef = user.collection('visits').doc(payload.visitID);
                const placeRef = user.collection('placeProgress').doc(park.siteID);
                const progressRef = user.collection('state').doc('progress');
                const [visitSnapshot, placeSnapshot, progressSnapshot] = await tx.getAll(visitRef, placeRef, progressRef);
                const previous = visitSnapshot.data(), place = placeSnapshot.data(), oldProgress = progressSnapshot.data();
                requireVisit(previous, payload, park);
                const revisions = { visit: revision(previous), placeProgress: revision(place), progress: revision(oldProgress) };
                const conflicts = revisions.visit !== expectedRevision || previous?.deleted
                    || (action === 'mark' && revisions.placeProgress !== payload.expectedPlaceRevision)
                    || (previous ? place?.visitID !== payload.visitID : place?.visitID != null)
                    || (action !== 'mark' && !previous);
                if (conflicts) return { status: 'conflict', revisions };
                if (action === 'mark' && previous && (!payload.proximity || previous.verified)) {
                    // A second mark is not a repeat event and cannot increment points.
                    return { status: 'accepted', revisions };
                }
                const visit = makeVisit({ previous, payload, park, action, stamp, nowMs, catalogRevision: catalog.revision });
                const nextPlace = makePlaceProgress(place, visit, stamp);
                const progress = visitProgress(oldProgress, previous, visit);
                const [marathon, first] = await Promise.all([
                    marathonEvidence(tx, user, visit, progress.awards.marathoner),
                    firstPlaceEvidence(tx, db, uid, progress),
                ]);
                const awards = evaluateAwards(progress, catalog, { visit, marathon, first, nowMs });
                const board = projection(progress, profile.displayName);
                const oldBoard = projection(readProgress(oldProgress), profile.displayName);
                const boardChanged = !oldProgress || JSON.stringify(board) !== JSON.stringify(oldBoard);
                return { status: 'accepted', revisions: { visit: visit.revision, placeProgress: nextPlace.revision,
                    progress: progress.revision }, commit(transaction) {
                    transaction.set(visitRef, visit);
                    transaction.set(placeRef, nextPlace);
                    transaction.set(progressRef, { ...progress, updatedAt: stamp });
                    stageAwards(transaction, user, awards, { kind: 'visit', id: visit.id }, stamp);
                    if (boardChanged) transaction.set(db.collection('leaderboard').doc(publicEntryID(uid)),
                        { ...board, updatedAt: stamp });
                } };
            },
        };
    }
    // J2: visit IDs are independent of place IDs. Only one current official-site visit
    // is allowed today. Repeat visits need an explicit policy change, not another UUID.
    return { markVisit: handler('mark', validation.parseMark), updateVisitDate: handler('date', validation.parseDate),
        ...createDeleteVisits({ catalog }) };
}

module.exports = { createVisitHandlers };
