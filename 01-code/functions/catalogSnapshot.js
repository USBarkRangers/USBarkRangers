"use strict";

const axios = require("axios");
const { createHash } = require("crypto");
const { TextDecoder } = require("util");
const dataIntegrity = require("./dataIntegrity.js");

const CATALOG_DOCUMENT_PATH = "_catalogSnapshots/latest";
const MAX_CATALOG_BYTES = 800 * 1024;
const MIN_CATALOG_ROWS = 300;
const MAX_SHRINK_FRACTION = 0.10;
const ENDPOINT_CACHE_CONTROL = "public,max-age=300,stale-while-revalidate=86400";
const seedPromises = new WeakMap();

class CatalogSnapshotError extends Error {
    constructor(code, message, details = null) {
        super(message);
        this.name = "CatalogSnapshotError";
        this.code = code;
        if (details) this.details = details;
    }
}

function toBuffer(value) {
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (typeof value === "string") return Buffer.from(value, "utf8");
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new CatalogSnapshotError("invalid_source_body", "The published catalog did not return CSV bytes.");
}

function decodeUtf8(bytes) {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
        throw new CatalogSnapshotError("invalid_source_encoding", "The published catalog is not valid UTF-8 CSV.");
    }
}

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function requireFirestore(options) {
    const db = options && options.firestore;
    if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function") {
        throw new CatalogSnapshotError("firestore_unavailable", "An Admin Firestore instance is required.");
    }
    return db;
}

function normalizeCatalogDocument(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new CatalogSnapshotError("invalid_catalog_document", "The stored catalog document is malformed.");
    }

    const csv = typeof value.csv === "string" ? value.csv : null;
    const sha = String(value.sha256 || "").toLowerCase();
    const rowCount = Number(value.rowCount);
    const bytes = Number(value.bytes);
    const sourceFetchedAtMs = Number(value.sourceFetchedAtMs);
    const sourceFetchedAt = String(value.sourceFetchedAt || "");
    const publishedAt = String(value.publishedAt || "");
    if (Number(value.schemaVersion) !== 1
        || csv === null
        || !/^[a-f0-9]{64}$/.test(sha)
        || !Number.isSafeInteger(rowCount)
        || rowCount < MIN_CATALOG_ROWS
        || !Number.isSafeInteger(bytes)
        || bytes < 1
        || bytes > MAX_CATALOG_BYTES
        || !Number.isSafeInteger(sourceFetchedAtMs)
        || sourceFetchedAtMs < 0
        || Number.isNaN(Date.parse(sourceFetchedAt))
        || Date.parse(sourceFetchedAt) !== sourceFetchedAtMs
        || Number.isNaN(Date.parse(publishedAt))) {
        throw new CatalogSnapshotError("invalid_catalog_document", "The stored catalog document is malformed.");
    }

    const csvBytes = Buffer.from(csv, "utf8");
    if (csvBytes.length !== bytes || sha256(csvBytes) !== sha) {
        throw new CatalogSnapshotError(
            "catalog_document_integrity_failure",
            "The stored catalog does not match its byte count and hash."
        );
    }

    return {
        schemaVersion: Number(value.schemaVersion) || 1,
        csv,
        sha256: sha,
        rowCount,
        bytes,
        sourceFetchedAtMs,
        sourceFetchedAt,
        publishedAt
    };
}

async function readPublishedCatalog(firestore) {
    const snapshot = await firestore.doc(CATALOG_DOCUMENT_PATH).get();
    if (!snapshot || snapshot.exists !== true) return null;
    return normalizeCatalogDocument(snapshot.data());
}

async function fetchValidatedCatalog(options = {}) {
    const httpGet = options.httpGet || axios.get;
    const csvUrl = options.csvUrl || dataIntegrity.DEFAULT_PARK_CSV_URL;
    const nowMs = Number.isFinite(options.nowMs) ? Math.trunc(options.nowMs) : Date.now();
    let response;
    try {
        response = await httpGet(csvUrl, {
            timeout: dataIntegrity.FETCH_TIMEOUT_MS,
            responseType: "arraybuffer",
            headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
            params: { snapshot: nowMs }
        });
    } catch (error) {
        throw new CatalogSnapshotError(
            "source_unavailable",
            "The published catalog could not be downloaded.",
            { cause: String(error && error.message || error) }
        );
    }

    const receivedBytes = toBuffer(response && response.data);
    if (!receivedBytes.length || receivedBytes.length > MAX_CATALOG_BYTES) {
        throw new CatalogSnapshotError(
            "catalog_size_rejected",
            `The published catalog must be between 1 and ${MAX_CATALOG_BYTES} UTF-8 bytes.`
        );
    }

    const csv = decodeUtf8(receivedBytes);
    const bytes = Buffer.from(csv, "utf8");
    // A fatal UTF-8 decode plus an exact round trip keeps the stored Firestore
    // string, its byte count, its ETag, and the HTTP response identical.
    if (!bytes.equals(receivedBytes)) {
        throw new CatalogSnapshotError("invalid_source_encoding", "The published catalog is not canonical UTF-8 CSV.");
    }

    const integrity = dataIntegrity.analyzePublishedParkCsv(csv);
    if (!integrity.ok || !Number.isSafeInteger(integrity.validMapRows)) {
        throw new CatalogSnapshotError(
            "catalog_validation_failed",
            "The published catalog failed data-integrity validation.",
            { integrity }
        );
    }
    if (integrity.validMapRows < MIN_CATALOG_ROWS) {
        throw new CatalogSnapshotError(
            "catalog_below_minimum",
            `The published catalog has ${integrity.validMapRows} rows; at least ${MIN_CATALOG_ROWS} are required.`,
            { integrity, minimumRows: MIN_CATALOG_ROWS }
        );
    }

    return {
        csv,
        bytes,
        integrity,
        sha256: sha256(bytes),
        sourceFetchedAtMs: nowMs,
        sourceFetchedAt: new Date(nowMs).toISOString()
    };
}

function assertSafeCatalogSize(previous, next) {
    if (!previous) return;
    const previousRows = previous.rowCount;
    const nextRows = next.integrity.validMapRows;
    const shrinkFraction = (previousRows - nextRows) / previousRows;
    if (shrinkFraction > MAX_SHRINK_FRACTION) {
        throw new CatalogSnapshotError(
            "catalog_shrink_rejected",
            `Catalog row count fell from ${previousRows} to ${nextRows}.`,
            { previousRows, nextRows, shrinkFraction }
        );
    }
}

function buildCatalogDocument(source, nowMs) {
    return {
        schemaVersion: 1,
        csv: source.csv,
        sha256: source.sha256,
        rowCount: source.integrity.validMapRows,
        bytes: source.bytes.length,
        sourceFetchedAtMs: source.sourceFetchedAtMs,
        sourceFetchedAt: source.sourceFetchedAt,
        publishedAt: new Date(nowMs).toISOString()
    };
}

async function publishCatalogSnapshot(options = {}) {
    const firestore = requireFirestore(options);
    const logger = options.logger || console;
    const nowMs = Number.isFinite(options.nowMs) ? Math.trunc(options.nowMs) : Date.now();
    const source = await fetchValidatedCatalog({ ...options, nowMs });
    const ref = firestore.doc(CATALOG_DOCUMENT_PATH);

    const result = await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const previous = snapshot && snapshot.exists === true
            ? normalizeCatalogDocument(snapshot.data())
            : null;

        if (previous && previous.sha256 === source.sha256) {
            return { status: "unchanged", catalog: previous };
        }

        // Firestore retries this callback after a concurrent commit. Comparing
        // source capture time on every retry prevents an older invocation from
        // replacing a newer seed or weekly publication.
        if (previous && source.sourceFetchedAtMs <= previous.sourceFetchedAtMs) {
            return { status: "superseded", catalog: previous };
        }

        assertSafeCatalogSize(previous, source);
        const catalog = buildCatalogDocument(source, nowMs);
        transaction.set(ref, catalog);
        return { status: "published", catalog };
    });

    if (result.status === "published") {
        logger.info("[catalog-snapshot] Published validated Firestore fallback catalog.", {
            sha256: result.catalog.sha256,
            rowCount: result.catalog.rowCount,
            bytes: result.catalog.bytes
        });
    } else {
        logger.info(`[catalog-snapshot] Catalog publication ${result.status}.`, {
            sha256: result.catalog.sha256,
            rowCount: result.catalog.rowCount
        });
    }
    return result;
}

async function seedPublishedCatalog(options) {
    const firestore = requireFirestore(options);
    let pending = seedPromises.get(firestore);
    if (!pending) {
        pending = publishCatalogSnapshot(options).finally(() => {
            if (seedPromises.get(firestore) === pending) seedPromises.delete(firestore);
        });
        seedPromises.set(firestore, pending);
    }
    await pending;
}

function setHeader(res, name, value) {
    if (typeof res.set === "function") res.set(name, value);
    else if (typeof res.setHeader === "function") res.setHeader(name, value);
}

function setStatus(res, status) {
    if (typeof res.status === "function") return res.status(status);
    res.statusCode = status;
    return res;
}

function endResponse(res, body) {
    if (body !== undefined && typeof res.send === "function") return res.send(body);
    if (body !== undefined && typeof res.end === "function") return res.end(body);
    if (typeof res.end === "function") return res.end();
    return undefined;
}

function requestHeader(req, name) {
    if (req && typeof req.get === "function") return req.get(name);
    const headers = req && req.headers || {};
    return headers[String(name).toLowerCase()] || headers[name];
}

function etagMatches(value, etag) {
    if (!value) return false;
    return String(value).split(",").some(candidate => {
        const normalized = candidate.trim().replace(/^W\//, "");
        return normalized === "*" || normalized === etag;
    });
}

async function handleCatalogRequest(req, res, options = {}) {
    const method = String(req && req.method || "GET").toUpperCase();
    setHeader(res, "Access-Control-Allow-Origin", "*");
    setHeader(res, "Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    setHeader(res, "Access-Control-Allow-Headers", "If-None-Match");
    setHeader(
        res,
        "Access-Control-Expose-Headers",
        "ETag, Last-Modified, Content-Length, X-Catalog-Published-At, X-Catalog-Row-Count, X-Catalog-SHA256"
    );
    setHeader(res, "X-Content-Type-Options", "nosniff");

    if (method === "OPTIONS") {
        setHeader(res, "Access-Control-Max-Age", "86400");
        setHeader(res, "Allow", "GET, HEAD, OPTIONS");
        setStatus(res, 204);
        return endResponse(res);
    }
    if (method !== "GET" && method !== "HEAD") {
        setHeader(res, "Allow", "GET, HEAD, OPTIONS");
        setHeader(res, "Cache-Control", "no-store");
        setStatus(res, 405);
        return endResponse(res, "method_not_allowed");
    }

    try {
        const firestore = requireFirestore(options);
        let published = await readPublishedCatalog(firestore);
        if (!published) {
            await seedPublishedCatalog(options);
            published = await readPublishedCatalog(firestore);
        }
        if (!published) {
            throw new CatalogSnapshotError("catalog_unavailable", "No fallback catalog is available.");
        }

        const bytes = Buffer.from(published.csv, "utf8");
        const etag = `"${published.sha256}"`;
        setHeader(res, "ETag", etag);
        setHeader(res, "Cache-Control", ENDPOINT_CACHE_CONTROL);
        setHeader(res, "Content-Type", "text/csv; charset=utf-8");
        setHeader(res, "Content-Length", String(bytes.length));
        setHeader(res, "Content-Disposition", "inline; filename=\"bark-ranger-catalog.csv\"");
        setHeader(res, "X-Catalog-Published-At", published.publishedAt);
        setHeader(res, "X-Catalog-Row-Count", String(published.rowCount));
        setHeader(res, "X-Catalog-SHA256", published.sha256);
        setHeader(res, "Last-Modified", new Date(published.publishedAt).toUTCString());

        if (etagMatches(requestHeader(req, "If-None-Match"), etag)) {
            setStatus(res, 304);
            return endResponse(res);
        }
        setStatus(res, 200);
        return method === "HEAD" ? endResponse(res) : endResponse(res, bytes);
    } catch (error) {
        const logger = options.logger || console;
        logger.error("[catalog-snapshot] Public fallback catalog unavailable.", {
            code: error && error.code || "unknown",
            message: String(error && error.message || error)
        });
        setHeader(res, "Cache-Control", "no-store");
        setHeader(res, "Retry-After", "300");
        setStatus(res, 503);
        return endResponse(res, "catalog_unavailable");
    }
}

module.exports = {
    publishCatalogSnapshot,
    handleCatalogRequest,
    fetchValidatedCatalog,
    readPublishedCatalog,
    normalizeCatalogDocument,
    CatalogSnapshotError,
    CATALOG_DOCUMENT_PATH,
    MAX_CATALOG_BYTES,
    MIN_CATALOG_ROWS,
    MAX_SHRINK_FRACTION,
    ENDPOINT_CACHE_CONTROL
};
