'use strict';

const { Timestamp } = require('firebase-admin/firestore');
const { nextRevision, revision } = require('../shared/records');
const { NativeError } = require('../shared/errors');
const { MILE } = require('./validation');

function requireActivity(record, id) {
    if (!record) return;
    revision(record);
    if (record.id !== id || typeof record.deleted !== 'boolean') unsupported();
    if (!record.deleted && (!['manual', 'gps', 'pedometer', 'health'].includes(record.source)
        || !Number.isFinite(record.miles) || record.miles < 0
        || !Number.isFinite(record.originalMeters) || record.originalMeters <= 0)) unsupported();
}
function unsupported() { throw new NativeError('unsupported-contract', 'Activity data requires a compatible service.'); }
function makeActivity(payload, run, stamp) {
    return { schemaVersion: 1, id: payload.activityID, revision: 1, deleted: false,
        source: payload.source, startedAtMs: payload.startedAtMs, endedAtMs: payload.endedAtMs,
        originalMeters: payload.meters, elapsedSeconds: payload.elapsedSeconds, runID: payload.runID,
        miles: Math.round(payload.meters / MILE * 100) / 100, happenedAtMs: payload.endedAtMs,
        trailName: run?.name ?? 'General Walk', recordedAt: stamp, updatedAt: stamp };
}
function editActivity(previous, payload, stamp) {
    const cap = previous.source === 'manual' ? 15 * MILE : previous.originalMeters;
    if (payload.meters > cap + 0.01) {
        throw new NativeError('invalid', 'A correction cannot exceed the original measurement or manual-entry limit.');
    }
    return { ...previous, revision: nextRevision(previous.revision), miles: payload.meters / MILE,
        happenedAtMs: payload.happenedAtMs, trailName: payload.trailName, updatedAt: stamp };
}
function deleteActivity(previous, stamp, nowMs) {
    return { schemaVersion: 1, id: previous.id, revision: nextRevision(previous.revision), deleted: true,
        updatedAt: stamp, expiresAt: Timestamp.fromMillis(nowMs + 90 * 86_400_000) };
}
// J4/J5: an activity gets optional dog/trip/place associations and a private track-object
// reference at its milestone. Never put GPS samples, Health samples or photo bytes here.
module.exports = { requireActivity, makeActivity, editActivity, deleteActivity };
