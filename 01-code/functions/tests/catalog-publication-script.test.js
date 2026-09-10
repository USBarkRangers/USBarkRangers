"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const script = fs.readFileSync(path.resolve(__dirname, "../../../05-tools/google-apps-script/catalog-publication/Code.js"), "utf8");
function setup() {
    const properties = new Map([["BARK_SHEET_ID", "synthetic-sheet"], ["BARK_SHEET_NAME", "Parks"],
        ["BARK_SIGNAL_URL", "https://us-central1-barkrangermap-auth.cloudfunctions.net/nativeCatalogEditSignal"], ["BARK_SIGNAL_SECRET", "test-secret"]]);
    let now = 1000000, code = 200, calls = 0, unlocked = 0, duringFetch = () => {};
    const props = { getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value), deleteProperty: key => properties.delete(key) };
    const context = vm.createContext({ Date: { now: () => now }, PropertiesService: { getScriptProperties: () => props },
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => unlocked++ }) },
        Utilities: { getUuid: () => "12345678-1234-1234-1234-123456789012", computeHmacSha256Signature: (data, key) => [...createHmac("sha256", key).update(data).digest()] },
        UrlFetchApp: { fetch: (url, options) => {
            calls++; const body = JSON.parse(options.payload);
            assert.equal(options.headers["X-Bark-Catalog-Signature"], createHmac("sha256", "test-secret").update(`${body.timestamp}.${body.nonce}`).digest("hex"));
            duringFetch(); return { getResponseCode: () => code };
        } } });
    vm.runInContext(script, context);
    return { context, properties, calls: () => calls, unlocked: () => unlocked, setTime: value => now = value,
        setCode: value => code = value, duringFetch: fn => duringFetch = fn,
        event: { source: { getId: () => "synthetic-sheet" }, range: { getSheet: () => ({ getName: () => "Parks" }) } } };
}
test("edit signals only the configured sheet and clears acknowledged pending work", () => {
    const h = setup(); h.context.catalogEdited({ ...h.event, source: { getId: () => "other-sheet" } });
    assert.equal(h.calls(), 0); h.context.catalogEdited(h.event); assert.equal(h.calls(), 1);
    assert.equal(h.properties.has("BARK_PENDING"), false); assert.equal(h.unlocked(), 1);
});
test("failed and busy publications retry, with debounce and no new triggers installed", () => {
    const h = setup(); h.setCode(503); h.context.catalogEdited(h.event);
    assert.equal(h.calls(), 1); assert.ok(h.properties.has("BARK_PENDING"));
    h.context.flushCatalogSignal(); assert.equal(h.calls(), 1);
    h.setTime(1011000); h.setCode(202); h.context.flushCatalogSignal(); assert.ok(h.properties.has("BARK_PENDING"));
    h.setTime(1022000); h.setCode(200); h.context.flushCatalogSignal(); assert.equal(h.properties.has("BARK_PENDING"), false);
});
test("an edit arriving during publication remains pending after the older acknowledgement", () => {
    const h = setup(); h.duringFetch(() => h.properties.set("BARK_PENDING", "new-edit"));
    h.context.catalogEdited(h.event); assert.equal(h.properties.get("BARK_PENDING"), "new-edit");
});
test("wrong-project endpoint is rejected without delivery and releases the lock", () => {
    const h = setup(); h.properties.set("BARK_SIGNAL_URL", "https://us-central1-just-dee-dee-music-map.cloudfunctions.net/nativeCatalogEditSignal");
    assert.throws(() => h.context.catalogEdited(h.event)); assert.equal(h.calls(), 0); assert.equal(h.unlocked(), 1);
});
test("admin publication hook follows accepted writes and does not alter old success contracts", () => {
    const index = fs.readFileSync(path.resolve(__dirname, "../index.js"), "utf8");
    for (const method of ["update", "append"]) {
        const start = index.lastIndexOf(`await sheets.spreadsheets.values.${method}(`);
        const signal = index.indexOf("await nativeCatalog.afterAcceptedSheetWrite();", start);
        const result = index.indexOf("return { success: true", start);
        assert.ok(start > 0 && signal > start && result > signal);
    }
    assert.match(index, /exports\.catalogSnapshot = functions/);
    assert.match(index, /exports\.weeklyCatalogSnapshot = functions/);
});
