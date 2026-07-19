const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        handleReportClientError,
        cleanClientErrorType,
        resetAlertThrottle
    }
} = require("../index.js");

function authedContext(uid = "reporter-1", token = { email: "tester@example.com" }) {
    return { auth: { uid, token } };
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

// Minimal Firestore double: records clientErrors adds and simulates the
// per-uid email rate-limit collection via runTransaction.
function makeFirestore({ rateLimitCount } = {}) {
    const rateLimitDocs = new Map();
    const state = { adds: [], rateLimitWrites: 0 };

    function makeDocRef(collectionName, docId) {
        return {
            async get() {
                if (collectionName === "_clientErrorEmailLimits") {
                    const stored = rateLimitDocs.has(docId)
                        ? rateLimitDocs.get(docId)
                        : rateLimitCount === undefined ? null : { count: rateLimitCount };
                    return { exists: stored !== null, data: () => stored || {} };
                }
                return { exists: false, data: () => ({}) };
            },
            async set(value, options = {}) {
                if (collectionName === "_clientErrorEmailLimits") {
                    state.rateLimitWrites += 1;
                    const previous = rateLimitDocs.get(docId) || {};
                    rateLimitDocs.set(docId, options.merge ? { ...previous, ...value } : { ...value });
                }
            }
        };
    }

    return {
        state,
        collection(collectionName) {
            return {
                doc(docId) { return makeDocRef(collectionName, docId); },
                async add(value) {
                    if (collectionName !== "clientErrors") {
                        throw new Error(`unexpected add collection ${collectionName}`);
                    }
                    state.adds.push(value);
                    return { id: `clientError-${state.adds.length}` };
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                get(ref) { return ref.get(); },
                set(ref, value, options) { return ref.set(value, options); }
            });
        }
    };
}

beforeEach(() => resetAlertThrottle());

describe("cleanClientErrorType", () => {
    it("passes known types and coerces the rest to 'error'", () => {
        assert.equal(cleanClientErrorType("freeze"), "freeze");
        assert.equal(cleanClientErrorType("UnhandledRejection"), "unhandledrejection");
        assert.equal(cleanClientErrorType("nonsense"), "error");
        assert.equal(cleanClientErrorType(undefined), "error");
    });
});

describe("handleReportClientError", () => {
    it("persists the report and emails when under the per-user cap", async () => {
        const firestore = makeFirestore();
        const sent = [];
        const result = await handleReportClientError(
            {
                type: "error",
                message: "Cannot read properties of undefined",
                stack: "TypeError: ...\n at foo.js:1",
                path: "/#map",
                userAgent: "TestBrowser/1.0",
                appVersion: 55
            },
            authedContext(),
            { firestore, emailSender: async (p) => { sent.push(p); } }
        );

        assert.deepEqual(result, { ok: true });
        assert.equal(firestore.state.adds.length, 1);
        assert.equal(firestore.state.adds[0].type, "error");
        assert.equal(firestore.state.adds[0].source, "client");
        assert.equal(firestore.state.adds[0].appVersion, "55");
        assert.equal(sent.length, 1);
        assert.equal(sent[0].fn, "client/error");
        assert.equal(sent[0].source, "client");
    });

    it("flags freezes as critical and carries the duration", async () => {
        const firestore = makeFirestore();
        const sent = [];
        await handleReportClientError(
            { type: "freeze", message: "UI unresponsive", durationMs: 6200 },
            authedContext(),
            { firestore, emailSender: async (p) => { sent.push(p); } }
        );
        assert.equal(sent[0].fn, "client/freeze");
        assert.equal(sent[0].critical, true);
        assert.equal(sent[0].durationMs, 6200);
    });

    it("still persists but does NOT email once the per-user cap is hit", async () => {
        const firestore = makeFirestore({ rateLimitCount: 6 });
        const sent = [];
        const result = await handleReportClientError(
            { type: "error", message: "looping error" },
            authedContext(),
            {
                firestore,
                emailSender: async (p) => { sent.push(p); },
                clientErrorRateLimit: { maxRequests: 6 }
            }
        );
        assert.deepEqual(result, { ok: true });
        assert.equal(firestore.state.adds.length, 1);
        assert.equal(sent.length, 0);
    });

    it("rejects unauthenticated reports", async () => {
        await assert.rejects(
            () => handleReportClientError({ type: "error", message: "x" }, { auth: null }, { firestore: makeFirestore() }),
            (error) => getHttpsErrorCode(error) === "unauthenticated"
        );
    });
});
