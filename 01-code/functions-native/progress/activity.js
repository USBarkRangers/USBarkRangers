'use strict';

const v = require('../shared/validation');
const { invalid } = require('../shared/errors');
const { nextRevision } = require('../shared/records');
const { readProgress } = require('./summary');
const { evaluateAwards } = require('./awards');
const { firstPlaceEvidence, projection, stageAwards } = require('./evidence');
const { publicEntryID } = require('../profile/commands');

function dayKey(nowMs, timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
}
function createDailyActivity({ catalog }) {
    return { requiresPremium: true, rateGroup: 'activity', rateMaximum: 10,
        parse(payload) {
            v.object(payload, ['day', 'timeZone']);
            if (typeof payload.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.day)) invalid('Invalid activity day.');
            v.text(payload.timeZone, { min: 1, max: 100 });
            try { new Intl.DateTimeFormat('en', { timeZone: payload.timeZone }); }
            catch { invalid('Invalid activity time zone.'); }
            return payload;
        },
        async prepare({ tx, db, user, uid, profile, payload, expectedRevision, nowMs, stamp }) {
            if (expectedRevision !== 0) invalid('Activity is a day-idempotent command.');
            const ref = user.collection('state').doc('progress');
            const previous = (await tx.get(ref)).data(), progress = readProgress(previous);
            // Acceptance time, not a client-controlled creation time, decides a competitive streak.
            const today = dayKey(nowMs, payload.timeZone);
            if (payload.day !== today || (progress.lastStreakDay && progress.lastStreakDay >= today)) {
                return { status: 'accepted', revisions: { progress: progress.revision } };
            }
            const yesterday = new Date(`${today}T12:00:00Z`);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            progress.streakCount = progress.lastStreakDay === yesterday.toISOString().slice(0, 10)
                ? nextRevision(progress.streakCount) : 1;
            progress.lastStreakDay = today;
            progress.revision = nextRevision(progress.revision);
            const first = await firstPlaceEvidence(tx, db, uid, progress);
            const awards = evaluateAwards(progress, catalog, { first, nowMs });
            return { status: 'accepted', revisions: { progress: progress.revision }, commit(transaction) {
                transaction.set(ref, { ...progress, updatedAt: stamp });
                stageAwards(transaction, user, awards, { kind: 'dailyActivity', day: today }, stamp);
                if (!previous) transaction.set(db.collection('leaderboard').doc(publicEntryID(uid)),
                    { ...projection(progress, profile.displayName), updatedAt: stamp });
            } };
        },
    };
}

module.exports = { createDailyActivity, dayKey };
