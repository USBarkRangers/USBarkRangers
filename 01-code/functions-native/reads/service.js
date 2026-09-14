'use strict';

const v = require('../shared/validation');
const { accountID, requireWritableProfile, nextRate } = require('../commands/access');
const { NativeError } = require('../shared/errors');
const { createTripReader } = require('./trip');
const { createLibraryReader, parseLibrary } = require('./library');
const { createTripChangesReader, parseChanges } = require('./tripChanges');
const { createTripRecoveryReader, parseRecovery } = require('./tripRecovery');
const { createEntityChangesReader } = require('./entityChanges');
const visits = require('./visits');
const catalog = require('../catalog');
const { parseVisitSelection, createVisitSelectionReader } = require('./visitSelection');
const expedition = require('./expedition');
const { parseActivityHistory, createActivityHistoryReader } = require('./activityHistory');
const { parseLeaderboard, createLeaderboardReader } = require('./leaderboard');

function createReadService(db) {
    const handlers = {
        savedPinChanges: { read: createEntityChangesReader(db, { collection: 'places', retentionDays: null }),
            parse: parseChanges, maximum: 60 },
        leaderboard: { read: createLeaderboardReader(db), parse: parseLeaderboard, maximum: 12 },
        trip: { read: createTripReader(db), maximum: 30 },
        library: { read: createLibraryReader(db), parse: parseLibrary, maximum: 60 },
        tripChanges: { read: createTripChangesReader(db), parse: parseChanges, maximum: 60 },
        tripRecovery: { read: createTripRecoveryReader(db), parse: parseRecovery, maximum: 10 },
        visit: { read: visits.createVisitReader(db, catalog), parse: visits.parseVisit, maximum: 60 },
        visitSelection: { read: createVisitSelectionReader(db, catalog), parse: parseVisitSelection, maximum: 10 },
        visitHistory: { read: visits.createVisitHistoryReader(db), parse: visits.parseVisitHistory, maximum: 60 },
        progress: { read: visits.createProgressReader(db), parse: visits.parseProgress, maximum: 30 },
        placeProgressChanges: { read: createEntityChangesReader(db, { collection: 'placeProgress', retentionDays: null }),
            parse: parseChanges, maximum: 60 },
        expedition: { read: expedition.createExpeditionReader(db), parse: expedition.parseExpedition, maximum: 60 },
        activityHistory: { read: createActivityHistoryReader(db), parse: parseActivityHistory, maximum: 60 },
        activityChanges: { read: createEntityChangesReader(db, { collection: 'activities', retentionDays: 89 }),
            parse: parseChanges, maximum: 60 },
        activityClaims: { read: expedition.createActivityClaimsReader(db), parse: expedition.parseActivityClaims, maximum: 10 },
        completedTrails: { read: expedition.createCompletedTrailsReader(db), parse: expedition.parseCompletedTrails, maximum: 30 },
    };
    return async (uid, input) => {
        accountID(uid);
        v.object(input, ['kind', 'query']);
        v.choice(input.kind, Object.keys(handlers));
        const handler = handlers[input.kind];
        if (handler.parse) handler.parse(input.query);
        else {
            v.object(input.query, ['version', 'tripID']);
            if (input.query.version !== 1) throw new NativeError('unsupported-contract', 'Update the app.');
            v.identifier(input.query.tripID);
        }
        const user = db.collection('users').doc(uid), rate = user.collection('readLimits').doc(input.kind);
        // Admit before expensive reads. Per-account limits isolate abuse without a global hot row.
        await db.runTransaction(async tx => {
            const [profile, previous] = await tx.getAll(user, rate);
            requireWritableProfile(profile.data(), false); // Active free accounts retain read access.
            tx.set(rate, nextRate(previous.data(), Date.now(), handler.maximum));
        });
        return handler.read(uid, input.query);
    };
}
module.exports = { createReadService };
