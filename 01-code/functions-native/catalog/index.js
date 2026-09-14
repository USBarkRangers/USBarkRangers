'use strict';

const snapshot = require('./catalog.json');
const byID = new Map(), aliases = new Map(), sites = new Set(), stateSites = new Map();
if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.parks) || snapshot.parks.length > 10_000) {
    throw new Error('Native public catalog is unavailable.');
}
for (const park of snapshot.parks) {
    if (byID.has(park.id)) throw new Error('Duplicate native catalog identity.');
    byID.set(park.id, Object.freeze(park));
    sites.add(park.siteID);
    for (const state of park.stateCodes) {
        if (!stateSites.has(state)) stateSites.set(state, new Set());
        stateSites.get(state).add(park.siteID);
    }
    for (const alias of park.aliases) {
        if (aliases.has(alias)) throw new Error('Duplicate native catalog alias.');
        aliases.set(alias, park.id);
    }
}
if ([...aliases.keys()].some(id => byID.has(id))) throw new Error('Ambiguous native catalog identity.');

// Approved bundled public facts only. This module never reads another project's database.
module.exports = Object.freeze({
    revision: snapshot.revision,
    siteCount: sites.size,
    stateTotals: Object.freeze(Object.fromEntries([...stateSites].map(([key, value]) => [key, value.size]))),
    canonicalID(id) { return byID.has(id) ? id : aliases.get(id) ?? null; },
    park(id) { return byID.get(byID.has(id) ? id : aliases.get(id)) ?? null; },
});
