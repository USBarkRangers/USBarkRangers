'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const examples = require('../../ios/Packages/BarkDomain/Tests/BarkDomainTests/Fixtures/native-savedpins-v1.json');
const { parseBookmark } = require('../places/bookmarks');
const { storageID } = require('../shared/placeIdentity');
for (const [i, example] of examples.entries()) test(`shared saved pin field ${i}: ${example.field}`, () => {
    const identity = { kind: 'custom', id: 'fixture' };
    const payload = { pinID: storageID(identity), saved: true, place: { identity, name: 'Place', state: 'Ohio',
        coordinate: { latitude: 41, longitude: -81 }, subtitle: '', stopID: 'stop-a', savedAtMs: 1_800_000_000_000 } };
    const value = example.number ?? (example.text ?? '').repeat(example.repeat ?? 1);
    if (example.field === 'pinID') payload.pinID = value;
    else if (example.field === 'latitude') payload.place.coordinate.latitude = value;
    else payload.place[example.field] = value;
    if (example.valid) assert.doesNotThrow(() => parseBookmark(payload));
    else assert.throws(() => parseBookmark(payload));
});
