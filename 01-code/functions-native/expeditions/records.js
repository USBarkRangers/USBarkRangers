'use strict';

const { revision, nextRevision } = require('../shared/records');
const { NativeError } = require('../shared/errors');
const { MILE } = require('../activities/validation');
const trails = require('./trails.json');
const byID = new Map(trails.map(trail => [trail.id, Object.freeze(trail)]));
if (byID.size !== trails.length || trails.some(trail => !Number.isFinite(trail.meters) || trail.meters <= 0)) {
    throw new Error('Native virtual-trail catalog is invalid.');
}
function unsupported() { throw new NativeError('unsupported-contract', 'Expedition data requires a compatible service.'); }
function readState(record) {
    if (!record) return { schemaVersion: 1, revision: 0, selectionRevision: 0, activeRunID: null, lifetimeMiles: 0 };
    revision(record);
    if (!Number.isSafeInteger(record.selectionRevision) || record.selectionRevision < 0
        || !Number.isFinite(record.lifetimeMiles) || record.lifetimeMiles < 0
        || (record.activeRunID !== null && typeof record.activeRunID !== 'string')) unsupported();
    return { ...record };
}
function requireRun(record, id) {
    if (!record) return;
    revision(record);
    if (record.id !== id || !['active', 'abandoned', 'completed'].includes(record.status)
        || !Number.isSafeInteger(record.trailRevision) || record.trailRevision < 1
        || !Number.isFinite(record.miles) || record.miles < 0
        || !Number.isFinite(record.totalMiles) || record.totalMiles <= 0
        || !byID.has(record.trailID)) unsupported();
}
function makeRun(trail, id, stamp, createdAtMs) {
    return { schemaVersion: 1, id, revision: 1, trailID: trail.id, name: trail.name,
        trailRevision: 1, totalMiles: trail.meters / MILE, miles: 0, status: 'active',
        startedAtMs: createdAtMs, createdAt: stamp, updatedAt: stamp };
}
function addMiles(previous, delta) {
    const value = previous + delta;
    if (!Number.isFinite(value) || value < -0.000001 || value > Number.MAX_SAFE_INTEGER) unsupported();
    return Math.max(0, value); // Only floating-point cancellation can fall just below zero.
}
function advanceState(record, stamp, { miles = 0, selection = false } = {}) {
    return { ...record, revision: nextRevision(record.revision),
        selectionRevision: selection ? nextRevision(record.selectionRevision) : record.selectionRevision,
        lifetimeMiles: addMiles(record.lifetimeMiles, miles), updatedAt: stamp };
}
function advanceRun(record, stamp, { miles = 0, status = record.status } = {}) {
    return { ...record, revision: nextRevision(record.revision), miles: addMiles(record.miles, miles), status, updatedAt: stamp };
}
// This is distance-based virtual progress, never physical completion of an official
// trail. J4 adds a separate versioned route-evidence claim, not a boolean on this run.
module.exports = { trail: id => byID.get(id), readState, requireRun, makeRun, advanceState, advanceRun };
