"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    publishCatalogSnapshot,
    handleCatalogRequest,
    CATALOG_DOCUMENT_PATH,
    MAX_CATALOG_BYTES,
    MIN_CATALOG_ROWS,
    ENDPOINT_CACHE_CONTROL
} = require("../catalogSnapshot.js");

function snapshotFor(data) {
    const copy = data ? { ...data } : null;
    return {
        exists: Boolean(copy),
        data() {
            return copy ? { ...copy } : undefined;
        }
    };
}

function makeFirestore() {
    let stored = null;
    let version = 0;
    let heldCommit = null;
    let failNextCommit = null;
    const writes = [];
    const reads = [];
    const ref = {
        path: CATALOG_DOCUMENT_PATH,
        async get() {
            reads.push({ kind: "direct", version });
            return snapshotFor(stored);
        }
    };

    return {
        writes,
        reads,
        doc(path) {
            assert.equal(path, CATALOG_DOCUMENT_PATH);
            return ref;
        },
        async runTransaction(callback) {
            for (let attempt = 1; attempt <= 5; attempt += 1) {
                const readVersion = version;
                const readData = stored ? { ...stored } : null;
                let pendingWrite = null;
                const transaction = {
                    async get(requestedRef) {
                        assert.equal(requestedRef, ref);
                        reads.push({ kind: "transaction", version: readVersion, attempt });
                        return snapshotFor(readData);
                    },
                    set(requestedRef, value) {
                        assert.equal(requestedRef, ref);
                        pendingWrite = { ...value };
                    }
                };

                const result = await callback(transaction);
                if (heldCommit && heldCommit.claimed === false) {
                    heldCommit.claimed = true;
                    heldCommit.reachedResolve();
                    await heldCommit.releasePromise;
                }
                if (version !== readVersion) continue;
                if (pendingWrite && failNextCommit) {
                    const error = failNextCommit;
                    failNextCommit = null;
                    throw error;
                }
                if (pendingWrite) {
                    stored = { ...pendingWrite };
                    version += 1;
                    writes.push({ path: ref.path, data: { ...pendingWrite }, version });
                }
                return result;
            }
            throw new Error("transaction retry limit exceeded");
        },
        getStored() {
            return stored ? { ...stored } : null;
        },
        setFailNextCommit(error) {
            failNextCommit = error;
        },
        holdNextCommit() {
            let reachedResolve;
            let releaseResolve;
            const reached = new Promise(resolve => { reachedResolve = resolve; });
            const releasePromise = new Promise(resolve => { releaseResolve = resolve; });
            heldCommit = { claimed: false, reachedResolve, releasePromise };
            return { reached, release: releaseResolve };
        }
    };
}

function makeCsv(count, prefix = "park") {
    const rows = ["Location,State,lat,lng,Park ID"];
    for (let index = 0; index < count; index += 1) {
        rows.push([
            `${prefix} ${index + 1}`,
            index % 2 ? "VA" : "MD",
            (35 + index * 0.01).toFixed(5),
            (-80 - index * 0.01).toFixed(5),
            `${prefix}-id-${index + 1}`
        ].join(","));
    }
    return rows.join("\n");
}

function quietLogger() {
    return { info() {}, warn() {}, error() {} };
}

function makeResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        ended: false,
        set(name, value) {
            this.headers[String(name).toLowerCase()] = String(value);
            return this;
        },
        status(value) {
            this.statusCode = value;
            return this;
        },
        send(value) {
            this.body = value;
            this.ended = true;
            return this;
        },
        end(value) {
            if (value !== undefined) this.body = value;
            this.ended = true;
            return this;
        }
    };
}

describe("validated Firestore fallback catalog", () => {
    it("atomically stores the validated CSV and its exact integrity metadata in one hidden document", async () => {
        const firestore = makeFirestore();
        const csv = makeCsv(MIN_CATALOG_ROWS + 12);
        const result = await publishCatalogSnapshot({
            firestore,
            nowMs: Date.parse("2026-09-06T08:15:00.000Z"),
            httpGet: async () => ({ data: Buffer.from(csv) }),
            logger: quietLogger()
        });

        assert.equal(result.status, "published");
        assert.equal(firestore.writes.length, 1);
        assert.equal(firestore.writes[0].path, CATALOG_DOCUMENT_PATH);
        const stored = firestore.getStored();
        assert.equal(stored.csv, csv);
        assert.equal(stored.rowCount, MIN_CATALOG_ROWS + 12);
        assert.equal(stored.bytes, Buffer.byteLength(csv));
        assert.match(stored.sha256, /^[a-f0-9]{64}$/);
        assert.equal(stored.sourceFetchedAtMs, Date.parse("2026-09-06T08:15:00.000Z"));
        assert.equal(stored.publishedAt, "2026-09-06T08:15:00.000Z");
    });

    it("does no Firestore write when the validated source hash is unchanged", async () => {
        const firestore = makeFirestore();
        const csv = makeCsv(MIN_CATALOG_ROWS + 8);
        const options = {
            firestore,
            httpGet: async () => ({ data: csv }),
            logger: quietLogger()
        };
        await publishCatalogSnapshot({ ...options, nowMs: 1000 });
        const writesAfterFirstPublish = firestore.writes.length;

        const result = await publishCatalogSnapshot({ ...options, nowMs: 2000 });

        assert.equal(result.status, "unchanged");
        assert.equal(firestore.writes.length, writesAfterFirstPublish);
        assert.equal(firestore.getStored().sourceFetchedAtMs, 1000);
    });

    it("rejects malformed CSV without creating the fallback document", async () => {
        const firestore = makeFirestore();

        await assert.rejects(
            publishCatalogSnapshot({
                firestore,
                httpGet: async () => ({ data: "wrong,headers\none,two" }),
                logger: quietLogger()
            }),
            error => error && error.code === "catalog_validation_failed"
        );

        assert.equal(firestore.getStored(), null);
        assert.equal(firestore.writes.length, 0);
    });

    it("rejects a valid but implausibly small first snapshot", async () => {
        const firestore = makeFirestore();

        await assert.rejects(
            publishCatalogSnapshot({
                firestore,
                httpGet: async () => ({ data: makeCsv(MIN_CATALOG_ROWS - 1) }),
                logger: quietLogger()
            }),
            error => error
                && error.code === "catalog_below_minimum"
                && error.details.minimumRows === MIN_CATALOG_ROWS
        );

        assert.equal(MIN_CATALOG_ROWS, 300);
        assert.equal(firestore.getStored(), null);
    });

    it("rejects source bytes above the 800 KiB Firestore safety ceiling before parsing or writing", async () => {
        const firestore = makeFirestore();
        const oversized = Buffer.alloc(MAX_CATALOG_BYTES + 1, 0x61);

        await assert.rejects(
            publishCatalogSnapshot({
                firestore,
                httpGet: async () => ({ data: oversized }),
                logger: quietLogger()
            }),
            error => error && error.code === "catalog_size_rejected"
        );

        assert.equal(MAX_CATALOG_BYTES, 800 * 1024);
        assert.equal(firestore.writes.length, 0);
    });

    it("preserves the last good document when the next catalog shrinks by more than ten percent", async () => {
        const firestore = makeFirestore();
        let csv = makeCsv(400, "old");
        const options = {
            firestore,
            httpGet: async () => ({ data: csv }),
            logger: quietLogger()
        };
        await publishCatalogSnapshot({ ...options, nowMs: 1000 });
        const previous = firestore.getStored();
        csv = makeCsv(350, "new");

        await assert.rejects(
            publishCatalogSnapshot({ ...options, nowMs: 2000 }),
            error => error
                && error.code === "catalog_shrink_rejected"
                && error.details.previousRows === 400
                && error.details.nextRows === 350
        );

        assert.deepEqual(firestore.getStored(), previous);
        assert.equal(firestore.writes.length, 1);
    });

    it("allows an exact ten-percent shrink", async () => {
        const firestore = makeFirestore();
        let csv = makeCsv(400, "old");
        const options = {
            firestore,
            httpGet: async () => ({ data: csv }),
            logger: quietLogger()
        };
        await publishCatalogSnapshot({ ...options, nowMs: 1000 });
        csv = makeCsv(360, "new");

        const result = await publishCatalogSnapshot({ ...options, nowMs: 2000 });

        assert.equal(result.status, "published");
        assert.equal(firestore.getStored().rowCount, 360);
        assert.equal(firestore.writes.length, 2);
    });

    it("retries a paused older transaction and cannot overwrite a newer concurrent publication", async () => {
        const firestore = makeFirestore();
        const held = firestore.holdNextCommit();
        const older = publishCatalogSnapshot({
            firestore,
            nowMs: 1000,
            httpGet: async () => ({ data: makeCsv(MIN_CATALOG_ROWS, "older") }),
            logger: quietLogger()
        });
        await held.reached;

        const newer = await publishCatalogSnapshot({
            firestore,
            nowMs: 2000,
            httpGet: async () => ({ data: makeCsv(MIN_CATALOG_ROWS, "newer") }),
            logger: quietLogger()
        });
        held.release();
        const olderResult = await older;

        assert.equal(newer.status, "published");
        assert.equal(olderResult.status, "superseded");
        assert.equal(firestore.getStored().sourceFetchedAtMs, 2000);
        assert.match(firestore.getStored().csv, /newer 1/);
        assert.doesNotMatch(firestore.getStored().csv, /older 1/);
        assert.equal(firestore.writes.length, 1);
    });

    it("leaves the prior catalog intact when the Firestore commit fails", async () => {
        const firestore = makeFirestore();
        let csv = makeCsv(MIN_CATALOG_ROWS, "first");
        const options = {
            firestore,
            httpGet: async () => ({ data: csv }),
            logger: quietLogger()
        };
        await publishCatalogSnapshot({ ...options, nowMs: 1000 });
        const previous = firestore.getStored();
        csv = makeCsv(MIN_CATALOG_ROWS, "second");
        firestore.setFailNextCommit(new Error("simulated Firestore failure"));

        await assert.rejects(
            publishCatalogSnapshot({ ...options, nowMs: 2000 }),
            /simulated Firestore failure/
        );

        assert.deepEqual(firestore.getStored(), previous);
        assert.equal(firestore.writes.length, 1);
    });
});

describe("public fallback catalog endpoint", () => {
    it("seeds a missing document, serves CSV, and honors conditional GET and HEAD", async () => {
        const firestore = makeFirestore();
        const csv = makeCsv(MIN_CATALOG_ROWS + 6);
        let sourceFetches = 0;
        const options = {
            firestore,
            nowMs: Date.parse("2026-09-06T08:15:00.000Z"),
            httpGet: async () => {
                sourceFetches += 1;
                return { data: csv };
            },
            logger: quietLogger()
        };

        const getResponse = makeResponse();
        await handleCatalogRequest({ method: "GET", headers: {} }, getResponse, options);
        assert.equal(getResponse.statusCode, 200);
        assert.equal(Buffer.from(getResponse.body).toString("utf8"), csv);
        assert.equal(getResponse.headers["content-type"], "text/csv; charset=utf-8");
        assert.equal(getResponse.headers["cache-control"], ENDPOINT_CACHE_CONTROL);
        assert.match(getResponse.headers.etag, /^"[a-f0-9]{64}"$/);
        assert.equal(getResponse.headers["x-catalog-row-count"], String(MIN_CATALOG_ROWS + 6));
        assert.equal(getResponse.headers["x-catalog-published-at"], "2026-09-06T08:15:00.000Z");
        assert.equal(getResponse.headers["x-catalog-sha256"], getResponse.headers.etag.slice(1, -1));
        assert.match(getResponse.headers["access-control-expose-headers"], /X-Catalog-Published-At/);
        assert.equal(getResponse.headers["access-control-allow-origin"], "*");
        assert.equal(sourceFetches, 1);
        assert.equal(firestore.writes.length, 1);

        const cachedResponse = makeResponse();
        await handleCatalogRequest({
            method: "GET",
            headers: { "if-none-match": `W/${getResponse.headers.etag}` }
        }, cachedResponse, options);
        assert.equal(cachedResponse.statusCode, 304);
        assert.equal(cachedResponse.body, undefined);
        assert.equal(sourceFetches, 1);

        const headResponse = makeResponse();
        await handleCatalogRequest({ method: "HEAD", headers: {} }, headResponse, options);
        assert.equal(headResponse.statusCode, 200);
        assert.equal(headResponse.body, undefined);
        assert.equal(headResponse.headers["content-length"], String(Buffer.byteLength(csv)));
        assert.equal(sourceFetches, 1);
    });

    it("handles CORS preflight and rejects mutating methods without Firestore access", async () => {
        const firestore = makeFirestore();
        let sourceFetches = 0;
        const options = {
            firestore,
            httpGet: async () => {
                sourceFetches += 1;
                return { data: makeCsv(MIN_CATALOG_ROWS) };
            },
            logger: quietLogger()
        };

        const optionsResponse = makeResponse();
        await handleCatalogRequest({ method: "OPTIONS", headers: {} }, optionsResponse, options);
        assert.equal(optionsResponse.statusCode, 204);
        assert.equal(optionsResponse.headers.allow, "GET, HEAD, OPTIONS");

        const postResponse = makeResponse();
        await handleCatalogRequest({ method: "POST", headers: {} }, postResponse, options);
        assert.equal(postResponse.statusCode, 405);
        assert.equal(postResponse.body, "method_not_allowed");
        assert.equal(sourceFetches, 0);
        assert.equal(firestore.reads.length, 0);
        assert.equal(firestore.writes.length, 0);
    });
});

describe("catalog snapshot function wiring", () => {
    it("exports the weekly Sunday job and the bounded public catalogSnapshot endpoint", () => {
        process.env.NODE_ENV = "test";
        process.env.GCLOUD_PROJECT = "catalog-test-project";
        const functionsIndex = require("../index.js");

        assert.equal(functionsIndex.weeklyCatalogSnapshot.__trigger.schedule.schedule, "15 4 * * 0");
        assert.equal(
            functionsIndex.weeklyCatalogSnapshot.__trigger.schedule.timeZone,
            "America/New_York"
        );
        assert.equal(functionsIndex.weeklyCatalogSnapshot.__trigger.maxInstances, 1);
        assert.deepEqual(functionsIndex.catalogSnapshot.__trigger.httpsTrigger, {});
        assert.equal(functionsIndex.catalogSnapshot.__trigger.maxInstances, 5);
        assert.equal(functionsIndex.getCatalogSnapshot, undefined);
    });
});
