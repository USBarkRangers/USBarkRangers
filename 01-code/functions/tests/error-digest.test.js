const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        summarizeClientErrors,
        formatDigestEmailBody,
        runDailyErrorDigest
    }
} = require("../index.js");

describe("summarizeClientErrors", () => {
    it("counts totals, types, distinct users, and top messages", () => {
        const now = 1000000000;
        const since = now - 24 * 60 * 60 * 1000;
        const docs = [
            { type: "freeze", message: "UI stalled", uid: "a" },
            { type: "freeze", message: "UI stalled", uid: "b" },
            { type: "error", message: "TypeError x", uid: "a" }
        ];
        const s = summarizeClientErrors(docs, since, now);
        assert.equal(s.total, 3);
        assert.equal(s.distinctUsers, 2);
        assert.equal(s.byType.freeze, 2);
        assert.equal(s.byType.error, 1);
        assert.equal(s.windowHours, 24);
        assert.equal(s.topMessages[0].message, "UI stalled");
        assert.equal(s.topMessages[0].count, 2);
    });
});

describe("formatDigestEmailBody", () => {
    it("renders an explicit all-clear when there were no errors", () => {
        const body = formatDigestEmailBody({ total: 0, windowHours: 24, distinctUsers: 0, byType: {}, topMessages: [] });
        assert.ok(body.includes("All clear"));
        assert.ok(body.includes("pipeline is alive"));
    });

    it("lists counts and top issues when there were errors", () => {
        const body = formatDigestEmailBody({
            total: 3,
            windowHours: 24,
            distinctUsers: 2,
            byType: { freeze: 2, error: 1 },
            topMessages: [{ message: "UI stalled", count: 2 }]
        });
        assert.ok(body.includes("Total reports:   3"));
        assert.ok(body.includes("Distinct users:  2"));
        assert.ok(body.includes("UI stalled"));
    });
});

describe("runDailyErrorDigest", () => {
    function makeFirestore(docs) {
        return {
            collection() {
                return {
                    where() {
                        return {
                            async get() {
                                return { forEach: (fn) => docs.forEach((d) => fn({ data: () => d })) };
                            }
                        };
                    }
                };
            }
        };
    }

    it("queries, summarizes, and sends exactly one digest email", async () => {
        const sent = [];
        const summary = await runDailyErrorDigest({
            firestore: makeFirestore([
                { type: "error", message: "boom", uid: "a" },
                { type: "freeze", message: "stall", uid: "b" }
            ]),
            rawEmailSender: async (subject, text) => { sent.push({ subject, text }); }
        });
        assert.equal(summary.total, 2);
        assert.equal(sent.length, 1);
        assert.ok(sent[0].subject.includes("2 client error"));
    });

    it("still sends an all-clear digest when there were zero errors", async () => {
        const sent = [];
        const summary = await runDailyErrorDigest({
            firestore: makeFirestore([]),
            rawEmailSender: async (subject, text) => { sent.push({ subject, text }); }
        });
        assert.equal(summary.total, 0);
        assert.equal(sent.length, 1);
        assert.ok(sent[0].text.includes("All clear"));
    });
});
