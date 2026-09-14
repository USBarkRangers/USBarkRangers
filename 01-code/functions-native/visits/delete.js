'use strict';

const v = require('../shared/validation');
const { invalid } = require('../shared/errors');
const { revision, nextRevision } = require('../shared/records');
const { requireVisit, makeVisit, makePlaceProgress } = require('./records');
const { parseDelete } = require('./validation');
const { readProgress, applyVisitDelta } = require('../progress/summary');
const { evaluateAwards } = require('../progress/awards');
const { firstPlaceEvidence, projection, stageAwards } = require('../progress/evidence');
const { publicEntryID } = require('../profile/commands');

function createDeleteVisits({ catalog }) {
    const bulk = { requiresPremium: true, rateGroup: 'visit-removal', rateMaximum: 10,
        parse(payload) {
            v.object(payload, ['visits']);
            if (!Array.isArray(payload.visits) || payload.visits.length < 1 || payload.visits.length > 500) invalid('Select up to 500 visits.');
            const ids = new Set(), sites = new Set();
            for (const item of payload.visits) {
                v.object(item, ['visitID', 'officialPlaceID', 'expectedRevision']);
                v.identifier(item.visitID); v.identifier(item.officialPlaceID); v.integer(item.expectedRevision, 1);
                const park = catalog.park(item.officialPlaceID);
                if (!park || park.id !== item.officialPlaceID || ids.has(item.visitID) || sites.has(park.siteID)) invalid('Invalid visit selection.');
                ids.add(item.visitID); sites.add(park.siteID);
            }
            return payload;
        },
        async prepare(context) {
            const { tx, db, user, uid, profile, payload, stamp, nowMs, expectedRevision } = context;
            if (expectedRevision !== 0) invalid('Use each selected visit revision.');
            const entries = payload.visits.map(item => ({ payload: item, park: catalog.park(item.officialPlaceID),
                visitRef: user.collection('visits').doc(item.visitID),
                placeRef: user.collection('placeProgress').doc(catalog.park(item.officialPlaceID).siteID) }));
            const progressRef = user.collection('state').doc('progress');
            const snapshots = await tx.getAll(progressRef, ...entries.flatMap(entry => [entry.visitRef, entry.placeRef]));
            const progress = readProgress(snapshots[0].data()), revisions = { visits: {}, places: {}, progress: progress.revision };
            let conflict = false;
            for (const [index, entry] of entries.entries()) {
                entry.previous = snapshots[index * 2 + 1].data();
                entry.place = snapshots[index * 2 + 2].data();
                requireVisit(entry.previous, entry.payload, entry.park);
                revisions.visits[entry.payload.visitID] = revision(entry.previous);
                revisions.places[entry.park.siteID] = revision(entry.place);
                if (!entry.previous || entry.previous.deleted || revision(entry.previous) !== entry.payload.expectedRevision
                    || entry.place?.visitID !== entry.payload.visitID) conflict = true;
            }
            if (conflict) return { status: 'conflict', revisions };
            for (const entry of entries) {
                entry.visit = makeVisit({ ...entry, action: 'delete', stamp, nowMs });
                entry.nextPlace = makePlaceProgress(entry.place, entry.visit, stamp);
                applyVisitDelta(progress, entry.previous, entry.visit);
                revisions.visits[entry.visit.id] = entry.visit.revision;
                revisions.places[entry.park.siteID] = entry.nextPlace.revision;
            }
            progress.revision = nextRevision(progress.revision);
            revisions.progress = progress.revision;
            const first = await firstPlaceEvidence(tx, db, uid, progress);
            const awards = evaluateAwards(progress, catalog, { first, nowMs });
            return { status: 'accepted', revisions, commit(transaction) {
                for (const entry of entries) {
                    transaction.set(entry.visitRef, entry.visit);
                    transaction.set(entry.placeRef, entry.nextPlace);
                }
                transaction.set(progressRef, { ...progress, updatedAt: stamp });
                stageAwards(transaction, user, awards, { kind: 'visitRemoval' }, stamp);
                transaction.set(db.collection('leaderboard').doc(publicEntryID(uid)), { ...projection(progress, profile.displayName), updatedAt: stamp });
            } };
        },
    };
    const single = { ...bulk, parse: parseDelete, rateGroup: 'visits', rateMaximum: 60,
        async prepare(context) {
            const payload = bulk.parse({ visits: [{ ...context.payload, expectedRevision: context.expectedRevision }] });
            const result = await bulk.prepare({ ...context, payload, expectedRevision: 0 });
            const siteID = catalog.park(context.payload.officialPlaceID).siteID;
            return { ...result, revisions: { visit: result.revisions.visits[context.payload.visitID],
                placeProgress: result.revisions.places[siteID], progress: result.revisions.progress } };
        },
    };
    // Current bulk removal remains one atomic selection. J2 must explicitly define how
    // removing one repeat event differs from clearing an official visited marker.
    return { deleteVisit: single, deleteVisits: bulk };
}

module.exports = { createDeleteVisits };
