'use strict';

const { createHash } = require('node:crypto');

const MANIFEST_BYTES = 16_384, CATALOG_BYTES = 12 * 1024 * 1024;

// Keeps the backend on the catalog the publisher serves. Nothing here runs inside a Firestore
// transaction, and nothing here can fail a command: any problem leaves the current view in force.
function createCatalogRefresher({ catalog, manifestURL, fetch = globalThis.fetch, now = Date.now,
    report = () => {}, freshForMs = 60_000, missEveryMs = 30_000, timeoutMs = 2_500 }) {
    let etag = null, checkedAt = -Infinity, missAt = -Infinity, inFlight = null;

    async function read(url, maximum, headers = {}) {
        const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        if (response.status === 304) return { unchanged: true };
        if (response.status !== 200) throw new Error(`status ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > maximum) throw new Error('too large');
        return { bytes, etag: response.headers.get('etag') };
    }

    async function refresh() {
        const pointer = await read(manifestURL, MANIFEST_BYTES, etag ? { 'If-None-Match': etag } : {});
        if (pointer.unchanged) return;
        const manifest = JSON.parse(pointer.bytes);
        if (manifest?.schemaVersion !== 1 || !Number.isSafeInteger(manifest.revision)
            || !/^revisions\/\d+-[a-f0-9]{64}\.json$/.test(manifest.path) || !/^[a-f0-9]{64}$/.test(manifest.sha256)
            || !Number.isSafeInteger(manifest.bytes) || manifest.bytes > CATALOG_BYTES) throw new Error('manifest');
        if (manifest.revision > catalog.revision) {
            const payload = await read(new URL(manifest.path, manifestURL).href, CATALOG_BYTES);
            if (payload.bytes.length !== manifest.bytes
                || createHash('sha256').update(payload.bytes).digest('hex') !== manifest.sha256) throw new Error('hash');
            const source = JSON.parse(payload.bytes);
            if (source.revision !== manifest.revision) throw new Error('revision mismatch');
            report({ event: 'native-catalog-updated', revision: catalog.accept(source) });
        }
        etag = pointer.etag;   // Only after the catalog it names is in force.
    }

    function run() {
        inFlight ??= refresh().catch(error => report({ event: 'native-catalog-refresh-failed', reason: String(error.message).slice(0, 80) }))
            .finally(() => { checkedAt = now(); inFlight = null; });
        return inFlight;
    }

    return {
        // Before ordinary work: at most one small conditional request a minute per instance.
        async ifStale() { if (inFlight || now() - checkedAt >= freshForMs) await run(); },
        // A phone named a park this view has never seen, most likely a row added minutes ago.
        // Look once before refusing it, but never more than once per missEveryMs.
        async forUnknown(ids) {
            if (!ids.some(id => catalog.park(id) === null)) return;
            if (inFlight) return void await inFlight;
            if (now() - missAt < missEveryMs) return;
            missAt = now();
            await run();
        },
    };
}

// Every official place a command or read names, wherever its payload carries one.
function officialPlaceIDs(input) {
    const body = input?.payload ?? input?.query ?? {}, ids = [];
    if (typeof body.officialPlaceID === 'string') ids.push(body.officialPlaceID);
    for (const item of Array.isArray(body.visits) ? body.visits.slice(0, 500) : []) {
        if (typeof item?.officialPlaceID === 'string') ids.push(item.officialPlaceID);
    }
    for (const stop of Array.isArray(body.stops) ? body.stops.slice(0, 600) : []) {
        if (stop?.placeIdentity?.kind === 'official' && typeof stop.placeIdentity.id === 'string') ids.push(stop.placeIdentity.id);
    }
    return ids;
}

module.exports = { createCatalogRefresher, officialPlaceIDs };
