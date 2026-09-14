'use strict';

const { revision, nextRevision } = require('../shared/records');
const { NativeError } = require('../shared/errors');
const { Timestamp } = require('firebase-admin/firestore');

function requireVisit(record, payload, park) {
    revision(record);
    if (!record) return;
    if (record.id !== payload.visitID || record.officialPlaceID !== payload.officialPlaceID
        || record.siteID !== park.siteID || typeof record.deleted !== 'boolean') {
        throw new NativeError('invalid', 'The visit does not belong to this official place.');
    }
    if (!record.deleted && (typeof record.verified !== 'boolean' || !Array.isArray(record.stateCodes)
        || record.stateCodes.length > 64 || new Set(record.stateCodes).size !== record.stateCodes.length
        || record.stateCodes.some(state => !/^[A-Z]{2}$/.test(state)))) {
        throw new NativeError('unsupported-contract', 'Visit requires a compatible service.');
    }
}
function makeVisit({ previous, payload, park, action, stamp, nowMs, catalogRevision }) {
    const base = { schemaVersion: 1, id: payload.visitID, revision: nextRevision(revision(previous)),
        officialPlaceID: park.id, siteID: park.siteID, updatedAt: stamp };
    if (action === 'delete') return { ...base, deleted: true,
        expiresAt: Timestamp.fromMillis(nowMs + 90 * 86_400_000) };
    if (previous) return { ...previous, ...base,
        ...(action === 'date' ? { happenedAtMs: payload.happenedAtMs, timeZone: payload.timeZone } : {}),
        ...(action === 'mark' && payload.proximity ? { verified: true, proximity: payload.proximity } : {}) };
    return { ...base, deleted: false, name: park.name, state: park.state,
        stateCodes: [...park.stateCodes], coordinate: park.coordinate, catalogRevision,
        happenedAtMs: payload.happenedAtMs, timeZone: payload.timeZone, recordedAt: stamp,
        source: 'manual', verified: payload.proximity !== undefined,
        ...(payload.proximity ? { proximity: payload.proximity } : {}) };
}
function makePlaceProgress(previous, visit, stamp) {
    return { schemaVersion: 1, id: visit.siteID, officialPlaceID: visit.officialPlaceID,
        revision: nextRevision(revision(previous)), visitID: visit.deleted ? null : visit.id,
        visitRevision: visit.deleted ? null : visit.revision,
        visited: !visit.deleted, verified: !visit.deleted && visit.verified, updatedAt: stamp };
}

module.exports = { requireVisit, makeVisit, makePlaceProgress };
