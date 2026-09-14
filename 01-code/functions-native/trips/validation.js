'use strict';

const v = require('../shared/validation');
const { invalid } = require('../shared/errors');
const { storageID } = require('../shared/placeIdentity');
const { planningNoteID } = require('./identity');

function optionalText(value, maximum) { if (value !== undefined && value !== null) v.text(value, { max: maximum }); }
function stop(value, tripID) {
    if (value == null) return null;
    v.object(value, ['id', 'placeIdentity', 'placeID', 'name', 'coordinate', 'state', 'city', 'category', 'arrivalTime', 'visitMinutes', 'noteID'],
        ['id', 'placeIdentity', 'placeID', 'name', 'coordinate', 'state']);
    v.identifier(value.id);
    const placeID = storageID(value.placeIdentity);
    if (value.placeID !== placeID) invalid('Place identity and reference disagree.');
    v.text(value.name, { min: 1, max: 500 });
    v.text(value.state, { max: 100 });
    optionalText(value.city, 200);
    if (value.category != null) v.choice(value.category, ['National', 'State', 'Other']);
    if (value.arrivalTime != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.arrivalTime)) invalid('Invalid arrival time.');
    if (value.visitMinutes != null && (!Number.isFinite(value.visitMinutes) || value.visitMinutes < 0 || value.visitMinutes > 1440)) {
        invalid('Invalid visit duration.');
    }
    v.object(value.coordinate, ['latitude', 'longitude']);
    const { latitude, longitude } = value.coordinate;
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        invalid('Invalid coordinate.');
    }
    if (value.noteID != null && value.noteID !== planningNoteID(tripID, value.id)) invalid('Invalid planning note reference.');
    return { ...value, placeID };
}

function saveTrip(payload) {
    v.object(payload, ['tripID', 'name', 'days', 'start', 'end', 'notes'], ['tripID', 'name', 'days', 'notes']);
    v.identifier(payload.tripID);
    v.text(payload.name, { min: 1, max: 100 });
    if (!payload.name.trim()) invalid('Name the trip before saving.');
    if (!Array.isArray(payload.days) || payload.days.length < 1 || payload.days.length > 50) invalid('Invalid day count.');
    const days = payload.days.map(day => {
        v.object(day, ['id', 'stops', 'notes', 'color', 'date'], ['id', 'stops', 'notes', 'color']);
        v.identifier(day.id); v.text(day.notes, { max: 1000 });
        if (!/^#[a-fA-F0-9]{6}$/.test(day.color)) invalid('Invalid day colour.');
        if (day.date != null) {
            if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
                || !Number.isFinite(Date.parse(`${day.date}T12:00:00Z`))
                || new Date(`${day.date}T12:00:00Z`).toISOString().slice(0, 10) !== day.date) invalid('Invalid day date.');
        }
        if (!Array.isArray(day.stops) || day.stops.length > 500 || day.stops.some(value => value == null)) invalid('Invalid stops.');
        return { ...day, stops: day.stops.map(value => stop(value, payload.tripID)) };
    });
    const start = stop(payload.start, payload.tripID), end = stop(payload.end, payload.tripID);
    const ordinary = days.flatMap(day => day.stops);
    const stops = [...ordinary, start, end].filter(Boolean);
    if (ordinary.length > 500 || new Set(days.map(day => day.id)).size !== days.length
        || new Set(stops.map(value => value.id)).size !== stops.length) invalid('Duplicate identity or too many stops.');
    if (!Array.isArray(payload.notes) || payload.notes.length > 502) invalid('Invalid note edits.');
    const referenced = new Set(stops.map(value => value.noteID).filter(Boolean));
    for (const note of payload.notes) {
        v.object(note, ['id', 'expectedRevision', 'text']);
        if (!referenced.has(note.id)) invalid('A note edit must belong to a referenced stop.');
        v.integer(note.expectedRevision); v.text(note.text, { max: 1000 });
    }
    if (new Set(payload.notes.map(note => note.id)).size !== payload.notes.length) invalid('Duplicate note edit.');
    return { tripID: payload.tripID, name: payload.name, days, start, end, notes: payload.notes, stops };
}

function editNote(payload) {
    v.object(payload, ['tripID', 'stopID', 'noteID', 'text']);
    v.identifier(payload.tripID); v.identifier(payload.stopID); v.text(payload.text, { max: 1000 });
    if (payload.noteID !== planningNoteID(payload.tripID, payload.stopID)) invalid('Invalid planning note.');
    return payload;
}

module.exports = { saveTrip, editNote };
