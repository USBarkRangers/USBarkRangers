const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        handleSubmitFeedback,
        getFeedbackConnectionKey,
        cleanContactEmail
    }
} = require("../index.js");

const PNG_BASE64 = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.alloc(32, 0x21)
]).toString("base64");

function screenshot(name = "shot.png", dataBase64 = PNG_BASE64) {
    return { name, mimeType: "image/png", dataBase64 };
}

// Captures the Discord POST instead of hitting the network.
function discordRecorder() {
    const sent = [];
    return {
        sent,
        options: {
            webhookMap: { bugs: "https://discord.com/api/webhooks/1/bugs", customerFeedback: "https://discord.com/api/webhooks/1/cf" },
            discordSender: async (url, payload, meta) => { sent.push({ url, payload, meta }); }
        }
    };
}

function authedContext(uid = "feedback-user", token = {}) {
    return { auth: { uid, token } };
}

// A signed-out call still arrives with an HTTP request behind it, which is the
// only thing standing in for a uid on that path.
function anonymousContext(ip = "203.0.113.9") {
    return { rawRequest: { ip, headers: { "x-forwarded-for": `${ip}, 70.41.3.18` } } };
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
        lastRateLimitDoc: null,
        rateLimitDocIds: []
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
                    state.rateLimitDocIds.push(docId);
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

        assert.deepEqual(result, { ok: true, screenshotCount: 0 });
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

    it("records a signed-in report as verified", async () => {
        const firestore = makeFirestore();
        await handleSubmitFeedback(
            { message: "Verified." },
            authedContext("alice", { email: "alice@example.test" }),
            { firestore }
        );
        assert.equal(firestore.state.adds[0].verifiedAccount, true);
        assert.equal(firestore.state.adds[0].source, "app_feedback");
    });

    it("never lets a signed-in reporter claim a different identity", async () => {
        const firestore = makeFirestore();
        await handleSubmitFeedback(
            {
                message: "Trying it on.",
                contactName: "Someone Else",
                contactEmail: "victim@example.test"
            },
            authedContext("alice", { email: "alice@example.test", name: "Alice Ranger" }),
            { firestore }
        );

        const feedback = firestore.state.adds[0];
        assert.equal(feedback.email, "alice@example.test");
        assert.equal(feedback.displayName, "Alice Ranger");
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

describe("signed-out feedback", () => {
    it("stores and posts the report, labelled unverified with a self-reported contact", async () => {
        const firestore = makeFirestore();
        const discord = discordRecorder();

        const result = await handleSubmitFeedback(
            {
                message: "The map will not load for me.",
                type: "bug",
                contactName: "Passing Visitor",
                contactEmail: "visitor@example.test"
            },
            anonymousContext(),
            { firestore, ...discord.options }
        );

        assert.deepEqual(result, { ok: true, screenshotCount: 0 });

        const feedback = firestore.state.adds[0];
        assert.equal(feedback.uid, null);
        assert.equal(feedback.verifiedAccount, false);
        assert.equal(feedback.source, "app_feedback_anonymous");
        assert.equal(feedback.email, "visitor@example.test");
        assert.equal(feedback.displayName, "Passing Visitor");

        const fields = discord.sent[0].payload.embeds[0].fields;
        assert.equal(fields.find((f) => f.name === "Reporter").value, "Signed out — unverified");
        assert.match(fields.find((f) => f.name === "Contact").value, /self-reported/);
        // #bugs is not Admin-only, so the address is still masked there.
        assert.match(fields.find((f) => f.name === "Contact").value, /^v\*\*\*@example\.test/);
    });

    it("says so plainly when a signed-out reporter left no way to reply", async () => {
        const firestore = makeFirestore();
        const discord = discordRecorder();

        await handleSubmitFeedback(
            { message: "No contact details.", contactEmail: "not-an-email" },
            anonymousContext(),
            { firestore, ...discord.options }
        );

        assert.equal(firestore.state.adds[0].email, null);
        assert.equal(
            discord.sent[0].payload.embeds[0].fields.find((f) => f.name === "Contact").value,
            "none given"
        );
    });

    it("refuses screenshots from a signed-out caller before spending anything", async () => {
        const firestore = makeFirestore();

        await assertRejectsCode(
            handleSubmitFeedback(
                { message: "With an image.", screenshots: [screenshot()] },
                anonymousContext(),
                { firestore }
            ),
            "invalid-argument"
        );

        assert.equal(firestore.state.adds.length, 0);
        assert.equal(firestore.state.rateLimitReads, 0);
    });

    it("counts against both the per-connection budget and the shared ceiling", async () => {
        const firestore = makeFirestore();

        await handleSubmitFeedback(
            { message: "One report." },
            anonymousContext(),
            { firestore, nowMillis: Date.parse("2026-08-08T12:00:00.000Z") }
        );

        assert.equal(firestore.state.rateLimitWrites, 2);
        assert.ok(firestore.state.rateLimitDocIds.some((id) => id.startsWith("anon_") && !id.startsWith("anon_global")));
        assert.ok(firestore.state.rateLimitDocIds.some((id) => id.startsWith("anon_global")));
        // The bucket key is a hash, never the address itself.
        assert.ok(!firestore.state.rateLimitDocIds.some((id) => id.includes("203.0.113.9")));
    });

    it("blocks a connection over its own budget without writing feedback", async () => {
        const firestore = makeFirestore({ rateLimitCount: 3 });

        await assertRejectsCode(
            handleSubmitFeedback(
                { message: "Flooding." },
                anonymousContext(),
                {
                    firestore,
                    nowMillis: Date.parse("2026-08-08T12:00:00.000Z"),
                    anonymousFeedbackRateLimit: { maxRequests: 3, windowMs: 60 * 60 * 1000 }
                }
            ),
            "resource-exhausted"
        );

        assert.equal(firestore.state.adds.length, 0);
        assert.equal(firestore.state.rateLimitWrites, 0);
    });

    it("blocks on the shared ceiling even when the connection is under its own budget", async () => {
        const firestore = makeFirestore();
        const options = {
            firestore,
            nowMillis: Date.parse("2026-08-08T12:00:00.000Z"),
            anonymousFeedbackRateLimit: { maxRequests: 50, windowMs: 60 * 60 * 1000 },
            anonymousFeedbackGlobalLimit: { maxRequests: 2, windowMs: 60 * 60 * 1000 }
        };

        await handleSubmitFeedback({ message: "One." }, anonymousContext("198.51.100.1"), options);
        await handleSubmitFeedback({ message: "Two." }, anonymousContext("198.51.100.2"), options);

        await assertRejectsCode(
            handleSubmitFeedback({ message: "Three." }, anonymousContext("198.51.100.3"), options),
            "resource-exhausted"
        );

        assert.equal(firestore.state.adds.length, 2);
    });
});

describe("feedback identity helpers", () => {
    it("buckets a connection by a hash of the forwarded address", () => {
        const key = getFeedbackConnectionKey(anonymousContext("203.0.113.9"));
        assert.match(key, /^[a-f0-9]{16}$/);
        assert.equal(key, getFeedbackConnectionKey(anonymousContext("203.0.113.9")));
        assert.notEqual(key, getFeedbackConnectionKey(anonymousContext("203.0.113.10")));
    });

    it("prefers the client hop of x-forwarded-for over the proxy address", () => {
        const forwarded = getFeedbackConnectionKey({
            rawRequest: { ip: "10.0.0.1", headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }
        });
        assert.equal(forwarded, getFeedbackConnectionKey({ rawRequest: { ip: "203.0.113.9", headers: {} } }));
    });

    it("falls back to one strict shared bucket when there is no address", () => {
        assert.equal(getFeedbackConnectionKey({}), "unknown");
        assert.equal(getFeedbackConnectionKey({ rawRequest: { headers: {} } }), "unknown");
    });

    it("only accepts a self-reported address that could actually be emailed", () => {
        assert.equal(cleanContactEmail("  visitor@example.test "), "visitor@example.test");
        assert.equal(cleanContactEmail("not-an-email"), null);
        assert.equal(cleanContactEmail("two words@example.test"), null);
        assert.equal(cleanContactEmail("break@example.test\nX-Injected: yes"), null);
        assert.equal(cleanContactEmail("nodomain@localhost"), null);
        assert.equal(cleanContactEmail(""), null);
        assert.equal(cleanContactEmail(`${"a".repeat(250)}@example.test`), null);
    });
});

describe("feedback screenshots", () => {
    it("relays screenshots to Discord and stores only the count", async () => {
        const firestore = makeFirestore();
        const discord = discordRecorder();

        const result = await handleSubmitFeedback(
            {
                message: "The pin is in the wrong spot.",
                type: "bug",
                subject: "Acadia National Park",
                parkId: "park-123",
                screenshots: [screenshot("map.png"), screenshot("closeup.png")]
            },
            authedContext("alice", { email: "alice@example.test", name: "Alice Ranger" }),
            { firestore, ...discord.options }
        );

        assert.equal(result.screenshotCount, 2);

        const feedback = firestore.state.adds[0];
        assert.equal(feedback.screenshotCount, 2);
        assert.equal(feedback.subject, "Acadia National Park");
        assert.equal(feedback.parkId, "park-123");
        assert.equal(feedback.files, undefined, "image buffers must never be written to Firestore");

        assert.equal(discord.sent.length, 1);
        const post = discord.sent[0];
        assert.equal(post.meta.channel, "bugs");
        assert.equal(post.meta.files.length, 2);
        assert.ok(Buffer.isBuffer(post.meta.files[0].buffer));
        assert.match(post.payload.embeds[0].title, /Acadia National Park/);
        assert.equal(post.payload.embeds[0].image.url, "attachment://map.png");
    });

    it("rejects bad screenshots before spending the rate limit or writing", async () => {
        const cases = [
            { label: "too many", screenshots: new Array(4).fill(screenshot()) },
            { label: "not an image", screenshots: [screenshot("evil.png", Buffer.from("#!/bin/sh", "ascii").toString("base64"))] },
            { label: "unreadable", screenshots: [screenshot("broken.png", "%%%not-base64%%%")] },
            { label: "not a list", screenshots: PNG_BASE64 }
        ];

        for (const testCase of cases) {
            const firestore = makeFirestore();
            await assertRejectsCode(
                handleSubmitFeedback(
                    { message: "Something is off.", screenshots: testCase.screenshots },
                    authedContext("alice"),
                    { firestore }
                ),
                "invalid-argument"
            );
            assert.equal(firestore.state.adds.length, 0, testCase.label);
            assert.equal(firestore.state.rateLimitReads, 0, testCase.label);
        }
    });

    it("keeps the Firestore write when Discord delivery throws", async () => {
        const firestore = makeFirestore();

        const result = await handleSubmitFeedback(
            { message: "Discord is down but this must still land.", screenshots: [screenshot()] },
            authedContext("alice", { email: "alice@example.test" }),
            {
                firestore,
                webhookMap: { customerFeedback: "https://discord.com/api/webhooks/1/cf" },
                discordSender: async () => { throw new Error("discord exploded"); }
            }
        );

        assert.deepEqual(result, { ok: true, screenshotCount: 1 });
        assert.equal(firestore.state.adds.length, 1);
        assert.equal(firestore.state.adds[0].screenshotCount, 1);
    });
});
