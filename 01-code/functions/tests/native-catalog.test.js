"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");
const { parseCSV, readSourceRows } = require("../catalog/sourceSheet");
const { normalizePark, validateCatalog, encodeSnapshot, sha256 } = require("../catalog/catalogSchema");
const { createPublisher, cloudObjects, firestoreLease } = require("../catalog/publishCatalog");
const { verifySignal, claimEditSignal, createCatalogTriggers } = require("../catalog/catalogTriggers");
const root = path.resolve(__dirname, "../../..");
const rows = parseCSV(fs.readFileSync(path.join(root, "05-tools/catalog-source/native-catalog-2026-09-19.csv"), "utf8"));
const parks = rows.map(normalizePark);
const options = { revision: 1789776000000, publishedAt: "2026-09-19T00:00:00.000Z" };
const original = encodeSnapshot(parks, options);

function memoryStore() {
    const records = new Map(), events = [];
    let generation = 0;
    return { records, events,
        read: async name => records.get(name),
        create: async (name, bytes, cache) => {
            if (records.has(name)) throw Object.assign(new Error("exists"), { code: 412 });
            events.push(["create", name, cache]); records.set(name, { bytes, generation: String(++generation) });
        },
        replace: async (name, bytes, expected, cache) => {
            if ((records.get(name)?.generation || "0") !== expected) throw Object.assign(new Error("conflict"), { code: 412 });
            events.push(["replace", name, cache]); records.set(name, { bytes, generation: String(++generation) });
        }
    };
}
function harness(source = rows) {
    const objects = memoryStore();
    let owner, reads = 0;
    const lease = { acquire: async id => { if (owner) return false; owner = id; return true; },
        isOwner: async id => owner === id, release: async id => { if (owner === id) owner = null; } };
    const publisher = createPublisher({ objects, lease, readRows: async () => { reads++; return source; }, now: () => options.revision + 1000 });
    return { publisher, objects, lease, reads: () => reads };
}

test("approved fallback round-trips every identity and produces the checked-in bytes", () => {
    assert.equal(parks.length, 402);
    assert.deepEqual(new Set(parks.map(p => p.id)), new Set(rows.map(r => r["park id"])));
    assert.deepEqual(original.bytes, fs.readFileSync(path.join(root, "01-code/ios/BarkRanger/Resources/catalog.json")));
    for (let i = 0; i < rows.length; i++) {
        assert.equal(parks[i].info, rows[i]["useful/important/other info"]);
        assert.equal(parks[i].entranceFees, rows[i]["entrance fees"]);
        assert.equal(parks[i].hazards, rows[i]["hazards & safety"]);
        assert.equal(parks[i].approvedTrails, rows[i]["approved trails (where can they go?)"]);
    }
});
test("header variants and swag precedence match the web contract", () => {
    const row = { ...rows[0], LATITUDE: "1", Longitude: "180", "Swag Type": "", "Park ID": "00042" };
    delete row.lat; delete row.lng; delete row["park id"];
    const park = normalizePark(row);
    assert.equal(park.id, "00042"); assert.equal(park.swag, "Other"); assert.equal(park.coordinate.longitude, 180);
    assert.throws(() => normalizePark({ ...row, Longitude: "Infinity" }) && encodeSnapshot([normalizePark({ ...row, Longitude: "Infinity" })], { ...options, minimum: 1 }));
    assert.equal(normalizePark({ ...rows[0], "useful/important/other info": "Heritage certificate" }).swag, "Certificate");
});
test("schema rejects ambiguous IDs, aliases, unsafe links, coordinates and unexplained removals", () => {
    const next = () => structuredClone({ ...original.snapshot, revision: options.revision + 1 });
    for (const mutate of [s => s.parks[0].id = s.parks[1].id, s => s.parks[0].coordinate.latitude = 91,
        s => s.parks[0].websites = ["javascript:alert(1)"], s => s.parks[0].aliases = [s.parks[1].id],
        s => s.parks.pop(), s => s.parks[0].id = "replacement-without-alias"]) {
        const value = next(); mutate(value); assert.throws(() => validateCatalog(value, original.snapshot));
    }
    const alias = next(); const oldID = alias.parks[0].id;
    alias.parks[0].id = "canonical-replacement"; alias.parks[0].aliases = [oldID];
    assert.doesNotThrow(() => validateCatalog(alias, original.snapshot));
    const retired = next(); retired.retiredParkIDs.push(retired.parks.pop().id);
    assert.doesNotThrow(() => validateCatalog(retired, original.snapshot));
});
test("authenticated Sheets read uses one request, bounded timeout, and rejects duplicate headers", async () => {
    let count = 0;
    const sheets = { spreadsheets: { values: { get: async (request, config) => {
        count++; assert.equal(config.timeout, 15000); assert.equal(request.valueRenderOption, "FORMATTED_VALUE");
        return { data: { values: [["Park ID", "Location"], ["042", "Example"]] } };
    } } } };
    const result = await readSourceRows({ sheets, spreadsheetId: "synthetic", range: "Parks!A:Z" });
    assert.equal(count, 1); assert.equal(result[0]["park id"], "042");
    sheets.spreadsheets.values.get = async () => ({ data: { values: [["Park ID", " park id "], ["a", "b"]] } });
    await assert.rejects(readSourceRows({ sheets, spreadsheetId: "synthetic", range: "Parks!A:Z" }));
});
test("publication coalesces, reads source once, uploads immutable content before atomic promotion", async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.publisher.publishCatalog(), h.publisher.publishCatalog()]);
    assert.equal(a.status, "published"); assert.deepEqual(a, b); assert.equal(h.reads(), 1);
    assert.equal(h.objects.events[0][0], "create"); assert.equal(h.objects.events[1][0], "replace");
    assert.equal(h.objects.events[1][2], "public,max-age=0,must-revalidate");
    assert.equal((await h.publisher.publishCatalog()).status, "unchanged");
    assert.equal(h.objects.events.length, 2);
});
test("invalid candidates and failed writes retain the accepted manifest", async () => {
    const h = harness(); await h.publisher.publishCatalog();
    const prior = h.objects.records.get("manifest.json");
    const bad = createPublisher({ objects: h.objects, lease: h.lease, readRows: async () => rows.slice(0, 300), now: () => options.revision + 2000 });
    await assert.rejects(bad.publishCatalog()); assert.equal(h.objects.records.get("manifest.json"), prior);
    const changed = structuredClone(rows); changed[0]["useful/important/other info"] += " test";
    h.objects.create = async () => { throw new Error("interrupted upload"); };
    const broken = createPublisher({ objects: h.objects, lease: h.lease, readRows: async () => changed, now: () => options.revision + 2000 });
    await assert.rejects(broken.publishCatalog()); assert.equal(h.objects.records.get("manifest.json"), prior);
});
test("generation conflicts and expired leases cannot promote stale data", async () => {
    const h = harness();
    h.objects.replace = async () => { throw Object.assign(new Error("CAS conflict"), { code: 412 }); };
    assert.equal((await h.publisher.publishCatalog()).status, "superseded");
    assert.equal(h.objects.records.has("manifest.json"), false);
    const other = harness(); other.lease.isOwner = async () => false;
    assert.equal((await other.publisher.publishCatalog()).status, "superseded");
    assert.equal(other.objects.events.some(e => e[0] === "replace"), false);
});
test("GCS adapter binds reads to generations and writes to preconditions", async () => {
    const calls = [];
    const bucket = { file: (name, options) => ({ getMetadata: async () => [{ generation: "42", size: 2 }],
        download: async () => { calls.push(["read", options]); return [Buffer.from("{}")] },
        save: async (bytes, options) => calls.push(["write", options]) }) };
    const store = cloudObjects(bucket); await store.read("manifest.json");
    await store.create("revisions/test.json", Buffer.from("{}"), "immutable");
    await store.replace("manifest.json", Buffer.from("{}"), "42", "no-cache");
    assert.equal(calls[0][1].generation, "42");
    assert.equal(calls[1][1].preconditionOpts.ifGenerationMatch, 0);
    assert.equal(calls[2][1].preconditionOpts.ifGenerationMatch, "42");
});
test("HMAC signals reject missing secrets, altered bodies and expired timestamps", () => {
    const body = { timestamp: 1000000, nonce: "12345678-1234-1234-1234-123456789012" };
    const signature = createHmac("sha256", "test-only-secret").update(`${body.timestamp}.${body.nonce}`).digest("hex");
    assert.equal(verifySignal(body, signature, "test-only-secret", body.timestamp), true);
    assert.equal(verifySignal(body, signature, "", body.timestamp), false);
    assert.equal(verifySignal({ ...body, timestamp: body.timestamp + 1 }, signature, "test-only-secret", body.timestamp), false);
    assert.equal(verifySignal(body, signature, "test-only-secret", body.timestamp + 120001), false);
});
test("disabled publication does not touch Firebase; admin authentication still runs", async () => {
    let calls = 0;
    const triggers = createCatalogTriggers({ admin: {}, google: {}, env: {}, requireAdmin: async () => { calls++; throw new Error("not_admin"); } });
    assert.equal((await triggers.reconcileCatalog()).status, "disabled");
    assert.equal((await triggers.afterAcceptedSheetWrite()).status, "disabled");
    await assert.rejects(triggers.publishNow({}, {}), /not_admin/); assert.equal(calls, 1);
});
test("signal replay mark and project check are enforced before source access", async () => {
    let stored, transactions = 0;
    const db = { doc: () => ({}), runTransaction: async fn => { transactions++; return fn({ get: async () => ({ data: () => stored }), set: (_, value) => { stored = value; } }); } };
    const env = { BARK_NATIVE_CATALOG_ENABLED: "true", GCLOUD_PROJECT: "wrong-project", BARK_CATALOG_EDIT_SECRET: "test" };
    const triggers = createCatalogTriggers({ admin: { firestore: () => db }, google: {}, env, requireAdmin: async () => {}, now: () => 1000 });
    const body = { timestamp: 1000, nonce: "12345678-1234-1234-1234-123456789012" };
    const signature = createHmac("sha256", "test").update(`${body.timestamp}.${body.nonce}`).digest("hex");
    const res = { set() {}, status(code) { this.code = code; return this; }, send() {}, json() {} };
    await triggers.handleEditSignal({ method: "POST", body, get: () => signature }, res);
    assert.equal(res.code, 503); assert.equal(transactions, 0);
});

test("durable replay protection rejects duplicate and out-of-order signals", async () => {
    let value;
    const db = { doc: () => ({}), runTransaction: async fn => fn({
        get: async () => ({ data: () => value }), set: (_, next) => { value = next; }
    }) };
    assert.equal(await claimEditSignal(db, { timestamp: 100, nonce: "a" }), true);
    assert.equal(await claimEditSignal(db, { timestamp: 100, nonce: "b" }), false);
    assert.equal(await claimEditSignal(db, { timestamp: 99, nonce: "c" }), false);
    assert.equal(await claimEditSignal(db, { timestamp: 101, nonce: "d" }), true);
    assert.deepEqual(value, { timestamp: 101, nonce: "d" });
});
test("publication errors cannot turn an accepted sheet write into a retryable append failure", async () => {
    const handlers = createCatalogTriggers({ admin: {}, google: {}, requireAdmin: async () => {},
        env: { BARK_NATIVE_CATALOG_ENABLED: "true", GCLOUD_PROJECT: "wrong-project" } });
    assert.equal((await handlers.afterAcceptedSheetWrite()).status, "pending");
});

// The sheet's Park id cells for Mammoth Cave and Pocahontas once held a pasted relative date.
// They were corrected in the sheet without aliases, which stopped every later publication.
const MAMMOTH = "0b04a828-a089-49e3-8e97-8613574bfa08", POCAHONTAS = "417a203f-fd35-4e57-8417-f3a5a705a8eb";
const mistaken = { [MAMMOTH]: "1d ago", [POCAHONTAS]: "2 days ago" };
// What the publisher and old phones hold today: the same parks under the mistaken identities.
function publishedWithMistakes() {
    const old = parks.map(park => mistaken[park.id]
        ? { ...park, id: mistaken[park.id], siteID: mistaken[park.id], aliases: [] } : park)
        .sort((a, b) => a.id.localeCompare(b.id, "en"));
    const content = { parks: old, retiredParkIDs: [] };
    return validateCatalog({ schemaVersion: 1, revision: 1789329964653, publishedAt: "2026-09-13T20:06:04.750Z",
        sourceRevision: sha256(JSON.stringify(content)), ...content });
}

test("the corrected sheet publishes over a catalog that still holds the mistaken identities", async () => {
    const previous = publishedWithMistakes();
    assert.equal(previous.parks.filter(park => Object.values(mistaken).includes(park.id)).length, 2);
    const next = encodeSnapshot(parks, { revision: previous.revision + 1, publishedAt: options.publishedAt, previous });
    const two = next.snapshot.parks.filter(park => /Mammoth Cave National Park|Pocahontas State Park/.test(park.name));
    assert.deepEqual(two.map(park => [park.id, park.siteID, park.aliases]).sort(),
        [[MAMMOTH, MAMMOTH, ["1d ago"]], [POCAHONTAS, POCAHONTAS, ["2 days ago"]]]);
    assert.ok(next.snapshot.parks.every(park => !Object.values(mistaken).includes(park.id)));
    // End to end through the publisher: the stuck pointer advances from the mistaken catalog.
    const { publisher, objects } = harness();
    const bytes = Buffer.from(JSON.stringify(previous)), hash = sha256(bytes);
    assert.ok(options.revision + 1000 > previous.revision);
    const manifest = { schemaVersion: 1, revision: previous.revision, publishedAt: previous.publishedAt,
        sourceRevision: previous.sourceRevision, count: previous.parks.length, bytes: bytes.length, sha256: hash,
        path: `revisions/${previous.revision}-${hash}.json` };
    await objects.create(manifest.path, bytes);
    await objects.create("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const published = await publisher.publishCatalog();
    assert.equal(published.status, "published");
    assert.ok(published.manifest.revision > previous.revision);
});

test("a mistaken identity can never be a current park or site ID again, and garbage IDs cannot publish", () => {
    const withID = (id, siteID = id) => parks.map((park, index) => index === 0 ? { ...park, id, siteID } : park);
    for (const id of ["1d ago", "2 days ago", "3 hours ago", "", " leading-space", "has space", "caf\u00e9", "x".repeat(129)]) {
        assert.throws(() => encodeSnapshot(withID(id), options), /not a valid identifier|invalid identity|park fields/, JSON.stringify(id));
    }
    assert.throws(() => encodeSnapshot(withID(parks[0].id, "2 days ago"), options), /not a valid identifier/);
    // A correction typed back into the sheet by hand does not double the alias.
    const row = { ...rows.find(r => r["park id"] === MAMMOTH), "Park ID Aliases": "1d ago" };
    assert.deepEqual(normalizePark(row).aliases, ["1d ago"]);
});

test("a new valid sheet row publishes as a new revision without any app or pipeline change", async () => {
    const { publisher, objects } = harness();
    assert.equal((await publisher.publishCatalog()).status, "published");
    const added = { ...rows[0], "location": "Brand New State Park", "park id": "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
        "lat": "44.123456", "lng": "-93.654321" };
    const grown = harness([...rows, added]);
    for (const [name, record] of objects.records) await grown.objects.create(name, record.bytes);
    const second = await grown.publisher.publishCatalog();
    assert.equal(second.status, "published");
    assert.equal(second.manifest.count, 403);
    const payload = JSON.parse((await grown.objects.read(second.manifest.path)).bytes);
    assert.ok(payload.parks.some(park => park.id === "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"));
});


// Deleting a row takes the pin off the map. It never takes visits or points, and never stops publishing.
async function publishedThen(nextRows) {
    const first = harness();
    assert.equal((await first.publisher.publishCatalog()).status, "published");
    const next = harness(nextRows);
    for (const [name, record] of first.objects.records) await next.objects.create(name, record.bytes);
    const result = await next.publisher.publishCatalog();
    const payload = result.manifest && next.objects.records.get(result.manifest.path);
    return { result, catalog: payload ? JSON.parse(payload.bytes) : null };
}

test("a deleted row publishes, and its park stays in the catalog retired so visits and points survive", async () => {
    const deleted = rows[5], kept = rows.filter(row => row !== deleted);
    const { result, catalog } = await publishedThen(kept);
    assert.equal(result.status, "published");
    assert.equal(catalog.parks.length, 402);
    const park = catalog.parks.find(item => item.id === deleted["park id"]);
    assert.equal(park.isRetired, true);
    assert.equal(park.siteID, deleted["park id"]);
    assert.equal(catalog.parks.filter(item => item.isRetired).length, 1);
    // If the row comes back, it is an ordinary park again.
    const returned = harness(rows);
    returned.objects.records.set("manifest.json", { bytes: Buffer.from(JSON.stringify(result.manifest)), generation: "1" });
    returned.objects.records.set(result.manifest.path, { bytes: Buffer.from(JSON.stringify(catalog)), generation: "1" });
    // The harness clock is fixed, so the publisher advances by one past the previous revision.
    const back = await returned.publisher.publishCatalog();
    assert.equal(back.status, "published");
    const restored = JSON.parse(returned.objects.records.get(back.manifest.path).bytes);
    assert.equal(restored.parks.find(item => item.id === deleted["park id"]).isRetired, false);
    assert.equal(restored.parks.filter(item => item.isRetired).length, 0);
});

test("a park deleted and typed back in keeps its site, so existing visits stay on the new pin", async () => {
    const original = rows[7];
    const retyped = { ...original, "park id": "7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f" };
    const { result, catalog } = await publishedThen(rows.map(row => row === original ? retyped : row));
    assert.equal(result.status, "published");
    const park = catalog.parks.find(item => item.id === retyped["park id"]);
    assert.equal(park.siteID, original["park id"]);
    assert.ok(park.aliases.includes(original["park id"]));
    assert.equal(park.isRetired, false);
    assert.equal(catalog.parks.filter(item => item.name === park.name).length, 1);
    assert.equal(catalog.parks.length, 402);
});

test("a wiped or half-read sheet is refused instead of emptying the map", async () => {
    const { result, catalog } = await publishedThen(rows.slice(0, rows.length - 11)).catch(error => ({ result: { status: "rejected", error: error.message }, catalog: null }));
    assert.equal(catalog, null);
    assert.match(result.error || result.status, /disappeared at once|rejected|invalid/);
    // Ten at once is an edit, and publishes.
    const ten = await publishedThen(rows.slice(0, rows.length - 10));
    assert.equal(ten.result.status, "published");
    assert.equal(ten.catalog.parks.filter(item => item.isRetired).length, 10);
});
