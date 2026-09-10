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
const rows = parseCSV(fs.readFileSync(path.join(root, "01-code/app/assets/data/bark-fallback-0.142.csv"), "utf8"));
const parks = rows.map(normalizePark);
const options = { revision: 1788339349000, publishedAt: "2026-09-02T08:55:49.000Z" };
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
    assert.equal(parks.length, 393);
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
