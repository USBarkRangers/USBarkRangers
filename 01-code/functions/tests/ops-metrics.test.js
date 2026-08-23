const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");

process.env.NODE_ENV = "test";

const opsMetrics = require("../opsMetrics.js");
const opsDiscord = require("../opsDiscord.js");
const {
    __test: { runOpsMetricsRollup }
} = require("../index.js");

const HOOK = "https://discord.com/api/webhooks/123/abc";

function fullConfig() {
    const channels = {};
    for (const channel of opsDiscord.KNOWN_CHANNELS) {
        channels[channel] = `${HOOK}-${channel}`;
    }
    return { channels, adminRoleId: "999" };
}

// Minimal Firestore stand-in supporting only the aggregation path this uses.
function fakeFirestore(counts, failing = new Set()) {
    return {
        collection(name) {
            return {
                where() {
                    return {
                        count() {
                            return {
                                async get() {
                                    if (failing.has(name)) throw new Error(`${name} exploded`);
                                    return { data: () => ({ count: counts[name] }) };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
}

beforeEach(() => opsDiscord.resetDiscordState());
afterEach(() => opsDiscord.resetDiscordState());

describe("toIsoDate", () => {
    it("formats as a bare YYYY-MM-DD, which is what the API wants", () => {
        assert.equal(opsMetrics.toIsoDate(Date.UTC(2026, 7, 7, 13, 45)), "2026-08-07");
    });
});

describe("fetchGoatCounterStats", () => {
    const now = Date.UTC(2026, 7, 8);
    const since = now - 24 * 60 * 60 * 1000;

    it("returns null when no API token is configured", async () => {
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, { env: {} });
        assert.equal(stats, null);
    });

    it("reads pageviews, visitors, and top pages", async () => {
        const calls = [];
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, {
            env: { GOATCOUNTER_API_TOKEN: "t" },
            httpGet: async (url, config) => {
                calls.push({ url, config });
                if (url.endsWith("/stats/total")) return { data: { total: 120, total_unique: 45 } };
                return { data: { hits: [
                    { path: "/", count: 80 },
                    { path: "/map", count: 40 },
                    { path: "event-checkout-clicked", count: 4 },
                    { path: "event-premium-confirmation-timeout", count: 1 }
                ] } };
            }
        });

        assert.equal(stats.pageviews, 120);
        assert.equal(stats.visitors, 45);
        assert.deepEqual(stats.topPages, [{ path: "/", count: 80 }, { path: "/map", count: 40 }]);
        assert.equal(stats.paymentFunnel["checkout-clicked"], 4);
        assert.equal(stats.paymentFunnel["premium-confirmation-timeout"], 1);
        assert.ok(calls[0].url.startsWith(opsMetrics.DEFAULT_GOATCOUNTER_SITE));
        assert.equal(calls[0].config.headers.Authorization, "Bearer t");
        assert.equal(calls[0].config.params.start, "2026-08-07");
    });

    it("returns null instead of throwing when the API fails", async () => {
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, {
            env: { GOATCOUNTER_API_TOKEN: "t" },
            httpGet: async () => { throw new Error("502"); }
        });
        assert.equal(stats, null);
    });
});

describe("countSince", () => {
    it("returns the aggregation count", async () => {
        const db = fakeFirestore({ feedback: 7 });
        assert.equal(await opsMetrics.countSince(db, "feedback", "createdAt", new Date()), 7);
    });

    it("returns null instead of throwing when the query fails", async () => {
        const db = fakeFirestore({ feedback: 7 }, new Set(["feedback"]));
        assert.equal(await opsMetrics.countSince(db, "feedback", "createdAt", new Date()), null);
    });
});

describe("buildMetricsMessage", () => {
    it("posts at routine tier to the named channel", () => {
        const message = opsMetrics.buildMetricsMessage(
            { windowHours: 24, feedback: 2, clientErrors: 0, billingEvents: 1, traffic: null },
            { channel: "dailyMetrics", title: "Daily metrics" }
        );
        assert.equal(message.channel, "dailyMetrics");
        assert.equal(message.tier, "routine");
        assert.equal(message.title, "Daily metrics");
    });

    it("shows n/a rather than a wrong zero when a source is unavailable", () => {
        const message = opsMetrics.buildMetricsMessage(
            { windowHours: 24, feedback: null, clientErrors: 3, billingEvents: null, traffic: null },
            { channel: "dailyMetrics", title: "t" }
        );
        const byName = Object.fromEntries(message.fields.map((f) => [f.name, f.value]));
        assert.equal(byName.Feedback, "n/a");
        assert.equal(byName.Pageviews, "n/a");
        assert.equal(byName["Client errors"], "3");
        assert.match(message.description, /unavailable/);
    });

    it("lists top pages when traffic is available", () => {
        const message = opsMetrics.buildMetricsMessage(
            {
                windowHours: 24,
                feedback: 0,
                clientErrors: 0,
                billingEvents: 0,
                traffic: { pageviews: 10, visitors: 5, topPages: [{ path: "/map", count: 6 }] }
            },
            { channel: "dailyMetrics", title: "t" }
        );
        assert.match(message.description, /Top pages/);
        assert.match(message.description, /\/map/);
    });
});

describe("buildPaymentFunnelAlertMessage", () => {
    it("alerts only when checkout starts fail or confirmation is delayed", () => {
        assert.equal(opsMetrics.buildPaymentFunnelAlertMessage({ paymentFunnel: {} }), null);
        const message = opsMetrics.buildPaymentFunnelAlertMessage({
            paymentFunnel: {
                "checkout-start-failed": 2,
                "premium-confirmation-timeout": 1,
                "checkout-return-success": 3,
                "premium-confirmed": 2
            }
        });
        assert.equal(message.channel, "salesAndBilling");
        assert.equal(message.tier, "important");
        assert.equal(message.fields[0].value, "2");
    });
});

describe("runOpsMetricsRollup", () => {
    it("collects counts and posts one routine message", async () => {
        const sent = [];
        const summary = await runOpsMetricsRollup(
            { windowHours: 24, channel: "dailyMetrics", title: "Daily metrics" },
            {
                firestore: fakeFirestore({ feedback: 2, clientErrors: 5, _lemonSqueezyWebhookEvents: 1 }),
                env: { GOATCOUNTER_API_TOKEN: "t" },
                httpGet: async (url) => (url.endsWith("/stats/total")
                    ? { data: { total: 99, total_unique: 40 } }
                    : { data: { hits: [] } }),
                discordConfig: fullConfig(),
                discordSender: async (url, payload) => { sent.push({ url, payload }); }
            }
        );

        assert.equal(summary.feedback, 2);
        assert.equal(summary.clientErrors, 5);
        assert.equal(summary.billingEvents, 1);
        assert.equal(summary.traffic.pageviews, 99);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-dailyMetrics`);
        assert.equal(sent[0].payload.embeds[0].color, opsDiscord.TIERS.routine.color);
        // A routine rollup must never ping.
        assert.equal(sent[0].payload.content, undefined);
    });

    it("still posts when every data source fails", async () => {
        const sent = [];
        const summary = await runOpsMetricsRollup(
            { windowHours: 168, channel: "weeklyReport", title: "Weekly report" },
            {
                firestore: fakeFirestore({}, new Set(["feedback", "clientErrors", "_lemonSqueezyWebhookEvents"])),
                env: {},
                discordConfig: fullConfig(),
                discordSender: async (url, payload) => { sent.push({ url, payload }); }
            }
        );

        assert.equal(summary.feedback, null);
        assert.equal(summary.traffic, null);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-weeklyReport`);
    });
});
