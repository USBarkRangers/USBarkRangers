const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        handleSubmitFeedback
    }
} = require("../index.js");

function authedContext(uid = "feedback-user", token = {}) {
    return { auth: { uid, token } };
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

async function assertRejectsCode(promise, code) {
    await assert.rejects(
        promise,
        (error) => getHttpsErrorCode(error) === code
    );
}

function makeFirestore({ rateLimitCount } = {}) {
    const rateLimitDocs = new Map();
    const state = {
        adds: [],
        rateLimitReads: 0,
        rateLimitWrites: 0,
        lastRateLimitDoc: null
    };

    function makeDocRef(collectionName, docId) {
        return {
            async get() {
                if (collectionName === "_feedbackRateLimits") {
                    state.rateLimitReads += 1;
                    state.lastRateLimitDoc = docId;
                    const stored = rateLimitDocs.has(docId)
                        ? rateLimitDocs.get(docId)
                        : rateLimitCount === undefined
                            ? null
                            : { count: rateLimitCount };
                    return {
                        exists: stored !== null,
                        data: () => stored || {}
                    };
                }
                return {
                    exists: false,
                    data: () => ({})
                };
            },
            async set(value, options = {}) {
                if (collectionName === "_feedbackRateLimits") {
                    state.rateLimitWrites += 1;
                    state.lastRateLimitDoc = docId;
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
                doc(docId) {
                    return makeDocRef(collectionName, docId);
                },
                async add(value) {
                    if (collectionName !== "feedback") throw new Error(`unexpected add collection ${collectionName}`);
                    state.adds.push(value);
                    return { id: `feedback-${state.adds.length}` };
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                get(ref) {
                    return ref.get();
                },
                set(ref, value, options) {
                    return ref.set(value, options);
                }
            });
        }
    };
}

describe("feedback callable", () => {
    it("allows signed-in users to submit sanitized feedback", async () => {
        const firestore = makeFirestore();
        const result = await handleSubmitFeedback(
            {
                message: "  Please add a cleaner filter.  ",
                type: "BUG",
                secret: "client-forged",
                browser: {
                    userAgent: "Test Browser/1.0",
                    platform: "MacIntel",
                    language: "en-US",
                    path: "/bark-ranger-map/index.html",
                    viewportWidth: 390,
                    viewportHeight: 844,
                    rawToken: "should-not-be-copied"
                }
            },
            authedContext("alice", {
                email: "alice@example.test",
                name: "Alice Ranger"
            }),
            {
                firestore,
                nowMillis: Date.parse("2026-05-09T12:00:00.000Z")
            }
        );

        assert.deepEqual(result, { ok: true });
        assert.equal(firestore.state.rateLimitReads, 1);
        assert.equal(firestore.state.rateLimitWrites, 1);
        assert.equal(firestore.state.adds.length, 1);

        const feedback = firestore.state.adds[0];
        assert.equal(feedback.uid, "alice");
        assert.equal(feedback.message, "Please add a cleaner filter.");
        assert.equal(feedback.type, "bug");
        assert.equal(feedback.email, "alice@example.test");
        assert.equal(feedback.displayName, "Alice Ranger");
        assert.equal(feedback.source, "app_feedback");
        assert.equal(feedback.status, "new");
        assert.equal(feedback.secret, undefined);
        assert.equal(feedback.browser.rawToken, undefined);
        assert.equal(feedback.browser.viewportWidth, 390);
    });

    it("rejects signed-out feedback before writing anything", async () => {
        const firestore = makeFirestore();

        await assertRejectsCode(
            handleSubmitFeedback({ message: "Anonymous feedback" }, {}, { firestore }),
            "unauthenticated"
        );

        assert.equal(firestore.state.adds.length, 0);
        assert.equal(firestore.state.rateLimitReads, 0);
    });

    it("rejects empty and oversized feedback", async () => {
        const firestore = makeFirestore();

        await assertRejectsCode(
            handleSubmitFeedback({ message: "   " }, authedContext("alice"), { firestore }),
            "invalid-argument"
        );
        await assertRejectsCode(
            handleSubmitFeedback({ message: "x".repeat(2001) }, authedContext("alice"), { firestore }),
            "invalid-argument"
        );

        assert.equal(firestore.state.adds.length, 0);
        assert.equal(firestore.state.rateLimitReads, 0);
    });

    it("blocks users over the feedback rate limit before adding feedback", async () => {
        const firestore = makeFirestore({ rateLimitCount: 2 });

        await assertRejectsCode(
            handleSubmitFeedback(
                { message: "One more note." },
                authedContext("alice"),
                {
                    firestore,
                    nowMillis: Date.parse("2026-05-09T12:00:00.000Z"),
                    feedbackRateLimit: {
                        maxRequests: 2,
                        windowMs: 60 * 60 * 1000
                    }
                }
            ),
            "resource-exhausted"
        );

        assert.equal(firestore.state.rateLimitReads, 1);
        assert.equal(firestore.state.rateLimitWrites, 0);
        assert.equal(firestore.state.adds.length, 0);
    });
});
