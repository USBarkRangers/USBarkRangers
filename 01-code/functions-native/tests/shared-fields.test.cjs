'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fixture = require('../../ios/Packages/BarkDomain/Tests/BarkDomainTests/Fixtures/native-fields-v1.json');
const { saveTrip } = require('../trips/validation');
const { storageID } = require('../shared/placeIdentity');
const { planningNoteID } = require('../trips/identity');
const { updateProfile } = require('../profile/commands');
const { ACCEPTANCE_WINDOW_MS } = require('../shared/syncPolicy');

test('shared native fixture policy version', () => {
    assert.equal(fixture.version, 1);
    assert.equal(ACCEPTANCE_WINDOW_MS, fixture.acceptanceDays * 86_400_000);
});
for (const example of fixture.cases) test(`Swift/JavaScript shared field: ${example.id}`, () => {
    const text = (example.value ?? '').repeat(example.repeat ?? 1);
    const validate = () => {
        if (example.field === 'profileName') return updateProfile.parse({ displayName: text });
        const tripID = example.field === 'tripID' ? text : 'trip-1';
        const placeIdentity = { kind: 'custom', id: 'place-1' };
        const stop = { id: example.field === 'stopID' ? text : 'stop-1', placeIdentity,
            placeID: storageID(placeIdentity), name: 'Place', state: '', coordinate: { latitude: 40, longitude: -75 } };
        const day = { id: example.field === 'dayID' ? text : 'day-1', stops: [stop], notes: '', color: '#475569' };
        const payload = { tripID, name: example.field === 'tripName' ? text : 'Trip', days: [day], notes: [] };
        switch (example.field) {
        case 'stopName': stop.name = text; break;
        case 'state': case 'city': case 'arrivalTime': stop[example.field] = text; break;
        case 'visitMinutes': stop.visitMinutes = example.number; break;
        case 'color': case 'date': day[example.field] = text; break;
        case 'notes': stop.noteID = planningNoteID(tripID, stop.id);
            payload.notes = [{ id: stop.noteID, expectedRevision: 0, text }]; break;
        case 'tripID': case 'dayID': case 'stopID': case 'tripName': break;
        default: assert.fail(`Unknown fixture field: ${example.field}`);
        }
        return saveTrip(payload);
    };
    if (example.valid) assert.doesNotThrow(validate);
    else assert.throws(validate);
});
