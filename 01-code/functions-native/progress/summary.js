'use strict';

const definitions = require('./definitions.json');
const { revision, nextRevision } = require('../shared/records');
const { NativeError } = require('../shared/errors');
const allowedAwards = new Set(definitions.map(item => item.id));

function unavailable() { throw new NativeError('unsupported-contract', 'Progress requires a compatible service.'); }
function count(value) { if (!Number.isSafeInteger(value) || value < 0) unavailable(); return value; }
function counts(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)
        || Object.keys(values).length > 64) unavailable();
    for (const [key, value] of Object.entries(values)) {
        if (!/^[A-Z]{2}$/.test(key)) unavailable();
        count(value);
    }
    return { ...values };
}
function readProgress(record) {
    if (!record) return { schemaVersion: 1, revision: 0, sites: 0, verifiedSites: 0, walkPoints: 0,
        states: {}, verifiedStates: {}, awards: {}, streakCount: 0, lastStreakDay: null };
    revision(record);
    count(record.sites); count(record.verifiedSites); count(record.walkPoints); count(record.streakCount);
    if (record.verifiedSites > record.sites || !record.awards || typeof record.awards !== 'object'
        || Array.isArray(record.awards) || Object.keys(record.awards).length > allowedAwards.size) unavailable();
    for (const [id, value] of Object.entries(record.awards)) {
        if (!allowedAwards.has(id) || !value || !['honor', 'verified'].includes(value.tier)) unavailable();
        count(value.earnedAtMs);
    }
    if (record.lastStreakDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(record.lastStreakDay)) unavailable();
    const states = counts(record.states), verifiedStates = counts(record.verifiedStates);
    for (const [state, value] of Object.entries(verifiedStates)) {
        if (value > (states[state] || 0)) unavailable();
    }
    return { ...record, states, verifiedStates, awards: { ...record.awards } };
}
function moveCount(map, key, delta) {
    const next = count((map[key] || 0) + delta);
    if (next === 0) delete map[key];
    else map[key] = next;
}
function applyVisitDelta(result, oldVisit, nextVisit) {
    const oldActive = oldVisit && !oldVisit.deleted, nextActive = nextVisit && !nextVisit.deleted;
    const delta = Number(Boolean(nextActive)) - Number(Boolean(oldActive));
    const verifiedDelta = Number(Boolean(nextActive && nextVisit.verified)) - Number(Boolean(oldActive && oldVisit.verified));
    result.sites = count(result.sites + delta);
    result.verifiedSites = count(result.verifiedSites + verifiedDelta);
    for (const state of oldActive ? oldVisit.stateCodes : []) {
        moveCount(result.states, state, -1);
        if (oldVisit.verified) moveCount(result.verifiedStates, state, -1);
    }
    for (const state of nextActive ? nextVisit.stateCodes : []) {
        moveCount(result.states, state, 1);
        if (nextVisit.verified) moveCount(result.verifiedStates, state, 1);
    }
    return result;
}
function visitProgress(previous, oldVisit, nextVisit) {
    const result = applyVisitDelta(readProgress(previous), oldVisit, nextVisit);
    result.revision = nextRevision(result.revision);
    return result;
}
function score(progress) { return count(progress.sites + progress.verifiedSites + progress.walkPoints); }

// This is fixed-size current progress, not event history. J2/J3: repeat visits and dog
// participation update distinct-site credit deliberately; neither implies extra points.
module.exports = { readProgress, visitProgress, applyVisitDelta, score };
