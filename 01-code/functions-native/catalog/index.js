'use strict';

const { buildSnapshot } = require('./snapshot');

// The bundled copy is the floor: what a cold start serves and what stays in force if the
// published catalog cannot be fetched or is refused. catalog/remote.js moves this view forward to
// the catalog the sheet publisher serves, which is the same one the phones read, so a park added
// to the sheet can be marked visited without redeploying this backend.
let current = buildSnapshot(require('./catalog.json'));

// Handlers hold this one object and read it synchronously inside their transactions. Replacing
// the view is a single assignment and only ever happens between awaits, outside a transaction.
module.exports = Object.freeze({
    get revision() { return current.revision; },
    get siteCount() { return current.siteCount; },
    get stateTotals() { return current.stateTotals; },
    canonicalID(id) { return current.byID.has(id) ? id : current.aliases.get(id) ?? null; },
    park(id) { return current.byID.get(current.byID.has(id) ? id : current.aliases.get(id)) ?? null; },
    // Throws, leaving the current view in force, unless the catalog is valid, newer, and still
    // resolves every park already known.
    accept(source) { current = buildSnapshot(source, current); return current.revision; },
});
