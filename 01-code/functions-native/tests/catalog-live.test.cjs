'use strict';

// Add a row to the sheet -> the publisher serves a new catalog -> this backend accepts a visit at
// the new park without being redeployed.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { buildSnapshot } = require('../catalog/snapshot');
const { createCatalogRefresher, officialPlaceIDs } = require('../catalog/remote');
const bundled = require('../catalog/catalog.json');

const MANIFEST = 'https://catalog.example/native-catalog/v1/manifest.json';
const NEW_PARK = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
// The same facade catalog/index.js exports, over a private view so tests do not share state.
function facade() {
    let current = buildSnapshot(bundled);
    return { get revision() { return current.revision; }, get siteCount() { return current.siteCount; },
        get stateTotals() { return current.stateTotals; },
        park(id) { return current.byID.get(current.byID.has(id) ? id : current.aliases.get(id)) ?? null; },
        accept(source) { current = buildSnapshot(source, current); return current.revision; } };
}
function published(change, revision = bundled.revision + 1000) {
    const source = { ...bundled, revision, parks: change(bundled.parks.map(park => ({ ...park }))) };
    const bytes = Buffer.from(JSON.stringify(source)), sha256 = createHash('sha256').update(bytes).digest('hex');
    return { bytes, manifest: { schemaVersion: 1, revision, publishedAt: source.publishedAt, sourceRevision: source.sourceRevision,
        count: source.parks.length, bytes: bytes.length, sha256, path: `revisions/${revision}-${sha256}.json` } };
}
function network(state) {
    const calls = [];
    const fetch = async (url, options = {}) => {
        calls.push(url.endsWith('manifest.json') ? 'manifest' : 'catalog');
        if (state.down) throw new Error('offline');
        const reply = (status, bytes, etag) => ({ status, headers: { get: () => etag ?? null }, arrayBuffer: async () => bytes });
        if (url === MANIFEST) {
            const etag = `"${state.current.manifest.revision}"`;
            if (options.headers?.['If-None-Match'] === etag) return reply(304, Buffer.alloc(0));
            return reply(200, Buffer.from(JSON.stringify(state.manifest ?? state.current.manifest)), etag);
        }
        return reply(200, state.payload ?? state.current.bytes);
    };
    return { fetch, calls };
}
const withNewPark = parks => parks.concat([{ ...parks[0], id: NEW_PARK, siteID: NEW_PARK, name: 'Brand New State Park', aliases: [],
    coordinate: { latitude: 44.123456, longitude: -93.654321 } }]);

test('a park added to the sheet becomes markable without a redeploy, on the first request that names it', async () => {
    const catalog = facade(), state = { current: published(parks => parks) };
    let clock = 1_000_000;
    const net = network(state);
    const live = createCatalogRefresher({ catalog, manifestURL: MANIFEST, fetch: net.fetch, now: () => clock });
    await live.ifStale();
    assert.equal(catalog.park(NEW_PARK), null);
    state.current = published(withNewPark, bundled.revision + 2000);      // the row is added and published
    clock += 5_000;                                                        // well inside the 60 s freshness window
    await live.ifStale();
    assert.equal(catalog.park(NEW_PARK), null, 'an ordinary request inside the window does not look again');
    await live.forUnknown(officialPlaceIDs({ kind: 'markVisit', payload: { officialPlaceID: NEW_PARK } }));
    assert.equal(catalog.park(NEW_PARK)?.name, 'Brand New State Park');
    assert.equal(catalog.siteCount, bundled.parks.length + 1);
    // A made-up park cannot make the backend fetch on every request.
    const before = net.calls.length;
    for (let i = 0; i < 20; i++) await live.forUnknown(['no-such-park']);
    assert.equal(net.calls.length, before);
});

test('the steady state is one small conditional request a minute, and an unchanged catalog downloads nothing', async () => {
    const catalog = facade(), state = { current: published(parks => parks) };
    let clock = 0;
    const net = network(state);
    const live = createCatalogRefresher({ catalog, manifestURL: MANIFEST, fetch: net.fetch, now: () => clock });
    await live.ifStale();
    assert.deepEqual(net.calls, ['manifest', 'catalog']);
    for (let second = 1; second <= 59; second++) { clock = second * 1000; await live.ifStale(); }
    assert.equal(net.calls.length, 2);
    clock = 61_000; await live.ifStale();
    assert.deepEqual(net.calls.slice(2), ['manifest']);                    // 304: no catalog download
    await Promise.all([1, 2, 3].map(() => { clock = 200_000; return live.ifStale(); }));
    assert.equal(net.calls.length, 4);                                     // concurrent callers share one request
});

test('a park marked retired keeps resolving and stops counting toward totals', async () => {
    const catalog = facade(), gone = bundled.parks[3];
    const state = { current: published(parks => parks.map(park => park.id === gone.id ? { ...park, isRetired: true } : park)) };
    const live = createCatalogRefresher({ catalog, manifestURL: MANIFEST, fetch: network(state).fetch, now: () => 0 });
    await live.ifStale();
    assert.equal(catalog.park(gone.id).isRetired, true);                   // old visits there can still be edited or removed
    assert.equal(catalog.siteCount, bundled.parks.length - 1);
    assert.equal(catalog.stateTotals[gone.stateCodes[0]], buildSnapshot(bundled).stateTotals[gone.stateCodes[0]] - 1);
});

test('a bad, older, tampered or unreachable catalog never replaces the current view and never throws', async () => {
    const good = published(parks => parks);
    const cases = {
        'a known park vanished': { current: published(parks => parks.slice(1)) },
        'garbage identity': { current: published(parks => [{ ...parks[0], id: '2 days ago', siteID: '2 days ago' }, ...parks.slice(1)]) },
        'older revision': { current: published(parks => parks, bundled.revision - 5) },
        'tampered bytes': { current: good, payload: Buffer.from(good.bytes.toString().replace('"schemaVersion":1', '"schemaVersion":1 ')) },
        'manifest names another host': { current: good, manifest: { ...good.manifest, path: '../../evil.json' } },
        'network down': { current: good, down: true },
    };
    for (const [name, state] of Object.entries(cases)) {
        const catalog = facade(), reports = [];
        const live = createCatalogRefresher({ catalog, manifestURL: MANIFEST, fetch: network(state).fetch, now: () => 0,
            report: detail => reports.push(detail) });
        await live.ifStale();
        assert.equal(catalog.revision, bundled.revision, name);
        assert.equal(catalog.park(bundled.parks[0].id)?.id, bundled.parks[0].id, name);
        if (name !== 'older revision') assert.equal(reports[0]?.event, 'native-catalog-refresh-failed', name);
    }
});

test('every official place a command or read names is found, wherever the payload carries it', () => {
    assert.deepEqual(officialPlaceIDs({ payload: { officialPlaceID: 'a' } }), ['a']);
    assert.deepEqual(officialPlaceIDs({ query: { visits: [{ officialPlaceID: 'b' }, { officialPlaceID: 'c' }] } }), ['b', 'c']);
    assert.deepEqual(officialPlaceIDs({ payload: { stops: [{ placeIdentity: { kind: 'official', id: 'd' } },
        { placeIdentity: { kind: 'custom', id: 'e' } }] } }), ['d']);
    for (const junk of [null, undefined, 7, 'x', {}, { payload: null }, { payload: { visits: 'no' } }]) assert.deepEqual(officialPlaceIDs(junk), []);
});
