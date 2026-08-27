const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        handleReportClientError,
        cleanClientErrorType,
        redactSensitiveDiagnosticText,
        cleanDiagnosticPath,
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

describe("diagnostic credential redaction", () => {
    it("removes URL secrets, bearer credentials, and JWT-shaped values", () => {
        const jwt = "eyJabcdefghijk.abcdefghijk.abcdefghijk";
        assert.equal(cleanDiagnosticPath(`/map?oobCode=secret#id_token=${jwt}`), "/map");
        const redacted = redactSensitiveDiagnosticText(`Authorization=Bearer-secret Bearer abc.def ${jwt}`, 500);
        assert.doesNotMatch(redacted, /Bearer-secret|abc\.def|eyJabcdefghijk/);
        assert.match(redacted, /Authorization=\[REDACTED\]/);
        assert.match(redacted, /Bearer \[REDACTED\]/);
        assert.match(redacted, /\[REDACTED_JWT\]/);
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
                path: "/?mode=debug#id_token=must-not-persist",
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
        assert.equal(firestore.state.adds[0].path, "/");
        assert.equal(sent.length, 1);
        assert.equal(sent[0].fn, "client/error");
        assert.equal(sent[0].source, "client");
    });

    it("reports severe freezes in seconds with structured context, without the payment-critical flag", async () => {
        const firestore = makeFirestore();
        const sent = [];
        await handleReportClientError(
            {
                type: "freeze",
                message: "UI unresponsive",
                durationMs: 16200,
                durationSeconds: 16.2,
                severity: "severe",
                likelyArea: "map interaction",
                releaseChannel: "beta",
                pinCount: 389,
                context: "vis=visible;sinceVisChange=45s;crumbs=marker-sync:1987+2s"
            },
            authedContext(),
            { firestore, emailSender: async (p) => { sent.push(p); } }
        );
        assert.equal(sent[0].fn, "client/freeze");
        assert.ok(!sent[0].critical);
        assert.equal(sent[0].durationMs, 16200);
        assert.equal(sent[0].durationSeconds, 16.2);
        assert.equal(sent[0].likelyArea, "map interaction");
        assert.equal(sent[0].pinCount, 389);
        assert.equal(sent[0].clientContext, "vis=visible;sinceVisChange=45s;crumbs=marker-sync:1987+2s");
        assert.equal(firestore.state.adds[0].context, "vis=visible;sinceVisChange=45s;crumbs=marker-sync:1987+2s");
    });

    it("persists a short freeze without spending a rate-limit transaction or immediate alert", async () => {
        const firestore = makeFirestore();
        const sent = [];
        await handleReportClientError(
            { type: "freeze", message: "UI stalled for 6.2 seconds", durationSeconds: 6.2 },
            authedContext(),
            { firestore, emailSender: async (payload) => sent.push(payload) }
        );

        assert.equal(firestore.state.adds.length, 1);
        assert.equal(firestore.state.adds[0].severity, "noticeable");
        assert.equal(firestore.state.rateLimitWrites, 0);
        assert.equal(sent.length, 0);
    });

    it("stores a routine Safari resume warning without sending an immediate alert", async () => {
        const firestore = makeFirestore();
        const sent = [];
        await handleReportClientError(
            {
                type: "unhandledrejection",
                message: "Attempt to get records from database without an in-progress transaction",
                likelyArea: "iOS Safari storage resume warning",
                severity: "routine",
                fingerprint: "ios-safari-storage-resume-warning",
                deviceFamily: "iOS",
                browserFamily: "Safari iOS"
            },
            authedContext(),
            { firestore, emailSender: async (payload) => sent.push(payload) }
        );

        assert.equal(firestore.state.adds.length, 1);
        assert.equal(firestore.state.adds[0].likelyArea, "iOS Safari storage resume warning");
        assert.equal(firestore.state.adds[0].severity, "routine");
        assert.equal(firestore.state.adds[0].fingerprint, "ios-safari-storage-resume-warning");
        assert.equal(firestore.state.rateLimitWrites, 0);
        assert.equal(sent.length, 0);
    });

    it("immediately alerts on a checkout failure reported by the browser", async () => {
        const firestore = makeFirestore();
        const sent = [];
        await handleReportClientError(
            {
                type: "other",
                message: "The browser could not start Premium checkout.",
                likelyArea: "payment/upgrade",
                severity: "important",
                fingerprint: "payment:checkout-start:unavailable"
            },
            authedContext(),
            { firestore, emailSender: async (payload) => sent.push(payload) }
        );

        assert.equal(firestore.state.adds.length, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].fn, "client/other");
        assert.equal(sent[0].likelyArea, "payment/upgrade");
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
