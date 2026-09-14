'use strict';

const v = require('../shared/validation');
const { invalid } = require('../shared/errors');
const MILE = 1609.344;

function uuid(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
        invalid('Invalid activity or run identity.');
    }
    return value;
}
function optionalRun(value) { if (value !== null) uuid(value); return value; }
function number(value, minimum, maximum) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) invalid('Invalid activity measurement.');
    return value;
}
function date(value) { return v.integer(value, 0, 253_402_300_799_999); }
function parseRecord(payload) {
    v.object(payload, ['activityID', 'source', 'startedAtMs', 'endedAtMs', 'meters', 'elapsedSeconds', 'runID']);
    uuid(payload.activityID); optionalRun(payload.runID);
    v.choice(payload.source, ['manual', 'gps', 'pedometer', 'health']);
    date(payload.startedAtMs); date(payload.endedAtMs);
    const duration = payload.endedAtMs - payload.startedAtMs;
    if (duration < 0 || duration > 7 * 86_400_000) invalid('Invalid activity interval.');
    number(payload.meters, Number.MIN_VALUE, 500_000);
    number(payload.elapsedSeconds, 0, duration / 1000 + 1);
    if (payload.source === 'manual') {
        if (payload.meters > 15 * MILE + 0.01) invalid('Manual entries allow at most 15 miles.');
    } else if (payload.elapsedSeconds <= 0 || payload.meters / payload.elapsedSeconds > 8.94) {
        invalid('Invalid recorded activity speed.');
    }
    return payload;
}
function parseEdit(payload) {
    v.object(payload, ['activityID', 'meters', 'happenedAtMs', 'trailName']);
    uuid(payload.activityID); number(payload.meters, 0, 500_000); date(payload.happenedAtMs);
    v.text(payload.trailName, { min: 1, max: 200 });
    return payload;
}
function parseDelete(payload) {
    v.object(payload, ['activityID']); uuid(payload.activityID); return payload;
}
function requireNotFuture(milliseconds, nowMs) {
    if (milliseconds > nowMs + 300_000) invalid('Activity date is in the future.');
}
module.exports = { MILE, uuid, optionalRun, number, date, parseRecord, parseEdit, parseDelete, requireNotFuture };
