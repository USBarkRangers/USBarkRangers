"use strict";

// The only row-to-native-catalog converter. Both the bundle builder and publisher use it.
const { createHash } = require("node:crypto");
const SCHEMA_VERSION = 1;
const MAX_BYTES = 12 * 1024 * 1024;
const MIN_PARKS = 300;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(`catalog_invalid: ${message}`); };
const clean = value => String(value ?? "").trim();
// The identifier rule every native command applies to an official place and site ID. A catalog
// identity that breaks it can be shown on a map but never marked visited, so it must not publish.
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/;
// Identities that were published by mistake (a relative date pasted into the Park id cell) and
// have since been corrected in the sheet. They are migration inputs only: each is carried as an
// alias of its corrected park so the publisher and every phone accept the transition and old
// references still resolve. None can ever be a current park or site ID again.
const CORRECTED_IDENTITIES = Object.freeze({
    "0b04a828-a089-49e3-8e97-8613574bfa08": Object.freeze(["1d ago"]),      // Mammoth Cave National Park
    "417a203f-fd35-4e57-8417-f3a5a705a8eb": Object.freeze(["2 days ago"]),  // Pocahontas State Park
});
const RETIRED_AS_CURRENT = new Set(Object.values(CORRECTED_IDENTITIES).flat());

function normalizeHeaders(row) {
    const result = {};
    for (const [key, value] of Object.entries(row)) {
        const header = clean(key).toLowerCase();
        if (Object.hasOwn(result, header)) fail(`duplicate header ${header}`);
        result[header] = clean(value);
    }
    return result;
}

function safeLinks(value) {
    return [...new Set((value.match(/https?:\/\/[^\s<>"']+/gi) || []).map(text => {
        const url = new URL(text);
        if (!url.hostname || url.username || url.password) fail("unsafe source link");
        return url.href;
    }))];
}

const states = "Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Virignia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY|Guam:GU|Puerto Rico:PR|American Samoa:AS|Northern Mariana Islands:MP|US Virgin Islands:VI|Washington, D.C.:DC".split("|").map(pair => pair.split(":"));

function normalizePark(input) {
    const row = normalizeHeaders(input);
    const get = (...keys) => { for (const key of keys) if (Object.hasOwn(row, key)) return row[key]; return ""; };
    const list = value => value.split("|").map(clean).filter(Boolean);
    const info = get("useful/important/other info");
    const type = get("type");
    const swagText = get("swag type", "swag", "swag available") ||
        (["swag type", "swag", "swag available"].some(key => Object.hasOwn(row, key)) ? "" : info);
    const lower = swagText.toLowerCase();
    const latitude = get("lat", "latitude"), longitude = get("lng", "long", "longitude");
    if (!latitude || !longitude) fail("missing coordinates");
    const id = get("park id");
    const state = get("state");
    const stateNames = state === "Washington, D.C." ? [state] : state.split(",").map(clean);
    const stateCodes = [...new Set(stateNames.map(name => states.find(([key, code]) => key.toLowerCase() === name.toLowerCase() || code === name)?.[1]).filter(Boolean))];
    if (!stateCodes.length) fail(`unknown state/territory for ${id}`);
    return {
        id, siteID: get("site id") || id, name: get("location"), state, stateCodes,
        coordinate: { latitude: Number(latitude), longitude: Number(longitude) },
        category: type.toLowerCase().includes("national") ? "National" : type.toLowerCase().includes("state") ? "State" : "Other",
        sourceType: type,
        swag: /\btags?\b/.test(lower) ? "Tag" : /bandana|vest/.test(lower) ? "Bandana" : /certificate|pledge/.test(lower) ? "Certificate" : "Other",
        swagCost: get("swag cost"), info,
        entranceFees: get("entrance fees", "entrance fee"), swagLocation: get("swag location"),
        approvedTrails: get("approved trails (where can they go?)", "approved trails"),
        restrictions: get("strict rules (where can't they go?)", "strict rules", "restrictions"),
        hazards: get("hazards & safety", "hazards"), extraSwag: get("extra swag"),
        websites: safeLinks(get("website")), pictures: safeLinks(get("swag pics - if available, and may not be current.")),
        videos: safeLinks(get("swearing-in video. not all sites do this, and ones that do only do it as time permits.", "swearing-in video")),
        aliases: [...new Set([...list(get("park id aliases", "aliases")), ...(CORRECTED_IDENTITIES[id] || [])])],
        isRetired: get("retired").toLowerCase() === "true"
    };
}

function validateCatalog(snapshot, previous = null, minimum = MIN_PARKS) {
    if (snapshot.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(snapshot.revision) || snapshot.revision <= 0 ||
        !/^[a-f0-9]{64}$/.test(snapshot.sourceRevision) || !Number.isFinite(Date.parse(snapshot.publishedAt)) ||
        !Array.isArray(snapshot.parks) || snapshot.parks.length < minimum || !Array.isArray(snapshot.retiredParkIDs)) fail("metadata/count");
    const ids = new Set(), aliases = new Set(), sites = new Map();
    for (const park of snapshot.parks) {
        if (typeof park.id !== "string" || !park.id.trim() || park.id.toLowerCase() === "unknown" || /^-?\d+\.\d{2}_-?\d+\.\d{2}$/.test(park.id) || ids.has(park.id)) fail("duplicate/invalid identity");
        ids.add(park.id);
        if (!park.siteID?.trim() || !park.name?.trim() || !["National", "State", "Other"].includes(park.category) || !["Tag", "Bandana", "Certificate", "Other"].includes(park.swag)) fail("park fields");
        const { latitude, longitude } = park.coordinate || {};
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) fail("coordinate");
        for (const field of ["sourceType", "state", "swagCost", "info", "entranceFees", "swagLocation", "approvedTrails", "restrictions", "hazards", "extraSwag"]) {
            if (typeof park[field] !== "string" || park[field].length > 100000) fail(`text ${field}`);
        }
        if (!Array.isArray(park.stateCodes) || !park.stateCodes.length || park.stateCodes.some(code => !states.some(pair => pair[1] === code)) || typeof park.isRetired !== "boolean") fail("state/retirement");
        for (const link of [...park.websites, ...park.pictures, ...park.videos]) {
            const url = new URL(link);
            if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) fail("link");
        }
        for (const alias of park.aliases) {
            if (typeof alias !== "string" || !alias.trim() || aliases.has(alias)) fail("ambiguous alias");
            aliases.add(alias);
        }
        // A retired park is history, not a live place: a park added later at the same spot is a
        // new park with its own site, so the one-site-per-place rule covers live parks only.
        if (park.isRetired) continue;
        const physical = physicalKey(park);
        if (sites.has(physical) && sites.get(physical) !== park.siteID) fail("inconsistent physical site identity");
        sites.set(physical, park.siteID);
    }
    if ([...aliases].some(id => ids.has(id))) fail("alias shadows canonical ID");
    const retired = new Set(snapshot.retiredParkIDs);
    if (retired.size !== snapshot.retiredParkIDs.length || [...retired].some(id => typeof id !== "string" || !id.trim() || ids.has(id) || aliases.has(id))) fail("retirement identities");
    if (previous) {
        if (snapshot.revision <= previous.revision) fail("revision did not advance");
        for (const park of previous.parks) if (!ids.has(park.id) && !aliases.has(park.id) && !retired.has(park.id)) fail("unexplained removed identity");
        for (const id of previous.retiredParkIDs) if (!retired.has(id)) fail("lost retirement history");
        for (const park of previous.parks) for (const alias of park.aliases) if (!aliases.has(alias) && !retired.has(alias)) fail("lost alias history");
    }
    return snapshot;
}

// A row deleted from the sheet takes its pin off the map; it must never take anyone's visits or
// points with it, and it must never stop publication. The park stays in the catalog marked
// retired: phones hide it from the map and search, the backend refuses new visits there, and
// existing visits stay stored under its ID. Nothing is matched automatically: a park typed back
// in gets a new Park id and is a new park. Pasting the old Park id back makes it the same park
// again, and its visits with it. Aliases are for true ID corrections only.
// More than MAX_RETIRED_AT_ONCE disappearing together is a wiped or half-read sheet, not an edit.
const MAX_RETIRED_AT_ONCE = 10;
const physicalKey = park => `${park.name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${park.coordinate.latitude.toFixed(5)},${park.coordinate.longitude.toFixed(5)}`;
function carryDeletedRows(parks, previous) {
    if (!previous) return parks;
    const present = new Set(parks.flatMap(park => [park.id, ...park.aliases]));
    const gone = previous.parks.filter(park => !present.has(park.id) && IDENTIFIER.test(park.id));
    const newlyGone = gone.filter(park => park.isRetired !== true);
    if (newlyGone.length > MAX_RETIRED_AT_ONCE) {
        fail(`${newlyGone.length} parks disappeared at once; refusing to retire more than ${MAX_RETIRED_AT_ONCE} in one update`);
    }
    // An alias now claimed by a live row belongs to that row, not to the retired record.
    return parks.concat(gone.map(park => ({ ...park, isRetired: true,
        aliases: park.aliases.filter(alias => !present.has(alias)) })));
}

// New catalogs only. A previously published catalog is validated leniently by validateCatalog,
// because it may still contain the mistaken identities this rule exists to stop.
function requireCurrentIdentities(parks) {
    for (const park of parks) {
        for (const value of [park.id, park.siteID]) {
            if (typeof value !== "string" || !IDENTIFIER.test(value) || RETIRED_AS_CURRENT.has(value)) {
                fail(`identity is not a valid identifier: ${JSON.stringify(value)} (${park.name})`);
            }
        }
    }
}

function encodeSnapshot(parks, { revision, publishedAt, retiredParkIDs = [], previous = null, minimum = MIN_PARKS }) {
    requireCurrentIdentities(parks);
    const sorted = parks.slice().sort((a, b) => a.id.localeCompare(b.id, "en"));
    const content = { parks: sorted, retiredParkIDs: retiredParkIDs.slice().sort() };
    const snapshot = { schemaVersion: SCHEMA_VERSION, revision, publishedAt, sourceRevision: sha256(JSON.stringify(content)), ...content };
    validateCatalog(snapshot, previous, minimum);
    const bytes = Buffer.from(JSON.stringify(snapshot));
    if (bytes.length > MAX_BYTES) fail("payload size");
    const hash = sha256(bytes);
    const manifest = { schemaVersion: SCHEMA_VERSION, revision, publishedAt, sourceRevision: snapshot.sourceRevision,
        count: sorted.length, bytes: bytes.length, sha256: hash, path: `revisions/${revision}-${hash}.json` };
    return { snapshot, bytes, manifest };
}

module.exports = { normalizeHeaders, normalizePark, validateCatalog, encodeSnapshot, sha256, SCHEMA_VERSION, MAX_BYTES, MIN_PARKS,
    IDENTIFIER, CORRECTED_IDENTITIES, carryDeletedRows, MAX_RETIRED_AT_ONCE };
