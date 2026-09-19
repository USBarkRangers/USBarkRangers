'use strict';

// One immutable view of the public park catalog. The bundled copy and every catalog fetched from
// the publisher go through the same checks, so a bad download can never replace a good view.
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/;
const refuse = message => { throw new Error(`Native public catalog refused: ${message}`); };

function buildSnapshot(source, previous = null) {
    if (source?.schemaVersion !== 1 || !Number.isSafeInteger(source.revision) || source.revision <= 0
        || !Array.isArray(source.parks) || source.parks.length > 10_000) refuse('metadata');
    const byID = new Map(), aliases = new Map(), sites = new Set(), stateSites = new Map();
    for (const park of source.parks) {
        if (typeof park?.id !== 'string' || !IDENTIFIER.test(park.id) || typeof park.siteID !== 'string'
            || !IDENTIFIER.test(park.siteID) || !Array.isArray(park.stateCodes) || !Array.isArray(park.aliases)) refuse('park identity');
        if (byID.has(park.id)) refuse('duplicate identity');
        byID.set(park.id, Object.freeze(park));
        for (const alias of park.aliases) {
            if (typeof alias !== 'string' || aliases.has(alias)) refuse('duplicate alias');
            aliases.set(alias, park.id);
        }
        // A retired park keeps resolving, so old visits can still be edited or removed, but it is
        // off the map and must not count toward totals nobody can reach any more.
        if (park.isRetired === true) continue;
        sites.add(park.siteID);
        for (const state of park.stateCodes) {
            if (!stateSites.has(state)) stateSites.set(state, new Set());
            stateSites.get(state).add(park.siteID);
        }
    }
    if ([...aliases.keys()].some(id => byID.has(id))) refuse('alias shadows an identity');
    if (previous) {
        if (source.revision <= previous.revision) refuse('revision did not advance');
        // The publisher never drops a park without an alias or an entry in its retirement list.
        // A known park that vanishes any other way means the download is wrong.
        const retired = new Set(Array.isArray(source.retiredParkIDs) ? source.retiredParkIDs : []);
        for (const id of previous.byID.keys()) {
            if (!byID.has(id) && !aliases.has(id) && !retired.has(id)) refuse('a known park disappeared');
        }
    }
    return Object.freeze({ revision: source.revision, byID, aliases, siteCount: sites.size,
        stateTotals: Object.freeze(Object.fromEntries([...stateSites].map(([key, value]) => [key, value.size]))) });
}

module.exports = { buildSnapshot, IDENTIFIER };
