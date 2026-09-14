'use strict';

const v = require('../shared/validation');
const { invalid } = require('../shared/errors');

function identity(payload) {
    v.identifier(payload.visitID);
    v.identifier(payload.officialPlaceID);
    return payload;
}
function visitDate(payload) {
    v.integer(payload.happenedAtMs);
    v.text(payload.timeZone, { min: 1, max: 100 });
    try { new Intl.DateTimeFormat('en', { timeZone: payload.timeZone }); }
    catch { invalid('Invalid visit time zone.'); }
}
function parseMark(payload) {
    v.object(payload, ['visitID', 'officialPlaceID', 'expectedPlaceRevision', 'happenedAtMs', 'timeZone', 'proximity'],
        ['visitID', 'officialPlaceID', 'expectedPlaceRevision', 'happenedAtMs', 'timeZone']);
    identity(payload); visitDate(payload);
    v.integer(payload.expectedPlaceRevision);
    if (payload.proximity !== undefined) {
        const p = v.object(payload.proximity, ['latitude', 'longitude', 'accuracy', 'timestampMs']);
        if (!Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90
            || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180
            || !Number.isFinite(p.accuracy) || p.accuracy < 0 || p.accuracy > 5000) invalid('Invalid location fix.');
        v.integer(p.timestampMs);
    }
    return payload;
}
function parseDate(payload) {
    v.object(payload, ['visitID', 'officialPlaceID', 'happenedAtMs', 'timeZone']);
    identity(payload); visitDate(payload);
    return payload;
}
function parseDelete(payload) {
    return identity(v.object(payload, ['visitID', 'officialPlaceID']));
}
function requireVisitDate(payload, nowMs) {
    if (payload.happenedAtMs > nowMs + 60_000) invalid('Visit date is in the future.');
}
function requireProximity(fix, park, createdAtMs) {
    if (Math.abs(fix.timestampMs - createdAtMs) > 60_000) invalid('The location fix is stale.');
    const radians = Math.PI / 180;
    const dLat = (fix.latitude - park.coordinate.latitude) * radians;
    const dLng = (fix.longitude - park.coordinate.longitude) * radians;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(fix.latitude * radians)
        * Math.cos(park.coordinate.latitude * radians) * Math.sin(dLng / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a)));
    if (distance > 25_000) invalid('The location is outside the current visit radius.');
    // This preserves today's proximity policy. Client GPS is an observation, not proof of
    // physical attendance; it must never be reused as official trail-completion evidence.
}

module.exports = { parseMark, parseDate, parseDelete, requireVisitDate, requireProximity };
