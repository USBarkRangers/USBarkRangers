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
            const query = {
                where() {
                    return query;
                },
                count() {
                    return {
                        async get() {
                            if (failing.has(name)) throw new Error(`${name} exploded`);
                            return { data: () => ({ count: counts[name] }) };
                        }
                    };
                }
            };
            return query;
        }
    };
}

beforeEach(() => opsDiscord.resetDiscordState());
afterEach(() => opsDiscord.resetDiscordState());

describe("toIsoHour", () => {
    it("preserves the requested hour while rounding sub-hour values", () => {
        assert.equal(opsMetrics.toIsoHour(Date.UTC(2026, 7, 7, 13, 45)), "2026-08-07T13:00:00.000Z");
    });
});

describe("fetchGoatCounterStats", () => {
    const now = Date.UTC(2026, 7, 8);
    const since = now - 24 * 60 * 60 * 1000;

    it("returns null when no API token is configured", async () => {
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, { env: {} });
        assert.equal(stats, null);
    });

    it("isolates app visits, environments, repeat opens, and funnel events", async () => {
        const calls = [];
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, {
            env: { GOATCOUNTER_API_TOKEN: "t" },
            httpGet: async (url, config) => {
                calls.push({ url, config });
                if (url.endsWith("/stats/total")) {
                    const exact = {
                        "event-app-open-production": config.params.start === opsMetrics.TRAFFIC_TRACKING_START_ISO ? 31 : 21,
                        "event-app-open-beta": config.params.start === opsMetrics.TRAFFIC_TRACKING_START_ISO ? 12 : 9
                    };
                    return { data: { total: exact[config.params.include_paths], total_events: exact[config.params.include_paths] } };
                }
                return { data: { hits: [
                    { path: "/", title: "US BARK Rangers", count: 8 },
                    { path: "/?checkout=success", title: "US BARK Rangers", count: 1 },
                    { path: "/USBarkRangers/01-code/app", title: "US BARK Rangers", count: 4 },
                    { path: "/Just-Dee-Dee-Music-Map", title: "Just Dee Dee", count: 99 },
                    { path: "event-app-session-production", event: true, count: 7 },
                    { path: "event-app-session-beta", event: true, count: 3 },
                    { path: "event-app-open-production", event: true, count: 13 },
                    { path: "event-app-open-beta", event: true, count: 6 },
                    { path: "event-audience-production-logged-out", event: true, count: 5 },
                    { path: "event-audience-production-free", event: true, count: 3 },
                    { path: "event-audience-beta-premium", event: true, count: 2 },
                    { path: "event-checkout-clicked", event: true, count: 4 },
                    { path: "event-premium-confirmation-timeout", event: true, count: 1 }
                ] } };
            }
        });

        assert.equal(stats.appVisits, 10);
        assert.equal(stats.productionVisits, 7);
        assert.equal(stats.betaVisits, 3);
        assert.equal(stats.appOpens, 30);
        assert.equal(stats.productionOpens, 21);
        assert.equal(stats.betaOpens, 9);
        assert.equal(stats.repeatOpens, 20);
        assert.equal(stats.openCoverage.complete, true);
        assert.equal(stats.allTime.appOpens, 43);
        assert.equal(stats.allTime.pageVisits, null);
        assert.deepEqual(stats.audience, { loggedOut: 5, free: 3, premium: 2 });
        assert.deepEqual(stats.topPages, [
            { path: "/", count: 8 },
            { path: "/?checkout=success", count: 1 },
            { path: "/USBarkRangers/01-code/app", count: 4 }
        ]);
        assert.equal(stats.paymentFunnel["checkout-clicked"], 4);
        assert.equal(stats.paymentFunnel["premium-confirmation-timeout"], 1);
        assert.equal(calls.length, 6);
        assert.ok(calls[0].url.startsWith(opsMetrics.DEFAULT_GOATCOUNTER_SITE));
        assert.equal(calls[0].config.headers.Authorization, "Bearer t");
        assert.equal(calls[0].config.params.start, "2026-08-07T00:00:00.000Z");
    });

    it("does not claim zero opens before the new client event exists", async () => {
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, {
            env: { GOATCOUNTER_API_TOKEN: "t" },
            httpGet: async () => ({ data: { hits: [
                { path: "/", title: "US BARK Rangers", count: 3 }
            ] } })
        });
        assert.equal(stats.appVisits, 3);
        assert.equal(stats.appOpens, null);
        assert.equal(stats.repeatOpens, null);
    });

    it("does not label a Beta-only open counter as an all-environment total", async () => {
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, {
            env: { GOATCOUNTER_API_TOKEN: "t" },
            httpGet: async (url, config) => {
                if (url.endsWith("/stats/total")) return { data: { total_events: 12 } };
                return { data: { hits: [
                    { path: "/", title: "US BARK Rangers", count: 8 },
                    { path: "/USBarkRangers/01-code/app", title: "US BARK Rangers", count: 4 },
                    { path: "event-app-session-production", event: true, count: 7 },
                    { path: "event-app-session-beta", event: true, count: 3 },
                    { path: "event-app-open-beta", event: true, count: 6 }
                ] } };
            }
        });
        assert.equal(stats.appOpens, null);
        assert.equal(stats.repeatOpens, null);
        assert.equal(stats.productionOpens, null);
        assert.equal(stats.betaOpens, 12);
        assert.deepEqual(stats.openCoverage, {
            complete: false,
            production: false,
            beta: true,
            knownAppOpens: 12,
            knownRepeatOpens: 9
        });
    });

    it("returns null instead of throwing when the API fails", async () => {
        const stats = await opsMetrics.fetchGoatCounterStats(since, now, {
            env: { GOATCOUNTER_API_TOKEN: "t" },
            httpGet: async () => { throw new Error("502"); }
        });
        assert.equal(stats, null);
    });

    it("waits past a rounded GoatCounter rate-limit window", async () => {
        let attempts = 0;
        const waits = [];
        const result = await opsMetrics.fetchExactEventTotal(
            opsMetrics.DEFAULT_GOATCOUNTER_SITE,
            "t",
            "event-app-open-beta",
            "2026-08-07T00:00:00.000Z",
            "2026-08-08T00:00:00.000Z",
            {
                httpGet: async () => {
                    attempts += 1;
                    if (attempts === 1) {
                        const error = new Error("429");
                        error.response = { status: 429, headers: { "x-rate-limit-reset": "0" } };
                        throw error;
                    }
                    return { data: { total_events: 12 } };
                },
                sleep: async (ms) => { waits.push(ms); }
            }
        );
        assert.equal(result, 12);
        assert.deepEqual(waits, [1100]);
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

describe("countBetween", () => {
    it("returns the aggregation count for a closed period", async () => {
        const db = fakeFirestore({ feedback: 9 });
        assert.equal(
            await opsMetrics.countBetween(db, "feedback", "createdAt", new Date(0), new Date(1)),
            9
        );
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
            { windowHours: 24, kind: "daily" },
            {
                firestore: fakeFirestore({ feedback: 2, clientErrors: 5, _lemonSqueezyWebhookEvents: 1 }),
                env: { GOATCOUNTER_API_TOKEN: "t" },
                httpGet: async (url, config) => url.endsWith("/stats/total")
                    ? ({ data: { total: config.params.include_paths.endsWith("production") ? 99 : 0, total_events: config.params.include_paths.endsWith("production") ? 99 : 0 } })
                    : ({ data: { hits: [
                        { path: "/", title: "US BARK Rangers", count: 40 },
                        { path: "event-app-session-production", event: true, count: 31 },
                        { path: "event-app-session-beta", event: true, count: 0 },
                        { path: "event-app-open-production", event: true, count: 99 },
                        { path: "event-app-open-beta", event: true, count: 0 }
                    ] } }),
                discordConfig: fullConfig(),
                discordSender: async (url, payload) => { sent.push({ url, payload }); }
            }
        );

        assert.equal(summary.feedback, 2);
        assert.equal(summary.clientErrors, 5);
        assert.equal(summary.billingEvents, 1);
        assert.equal(summary.traffic.appOpens, 99);
        assert.equal(summary.traffic.appVisits, 31);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-dailyBriefing`);
        assert.equal(sent[0].payload.embeds[0].color, opsDiscord.TIERS.routine.color);
        // A routine rollup must never ping.
        assert.equal(sent[0].payload.content, undefined);
    });

    it("still posts when every data source fails", async () => {
        const sent = [];
        const summary = await runOpsMetricsRollup(
            { windowHours: 168, kind: "weekly" },
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

    it("does not repeat daily payment warnings in the weekly report", async () => {
        const sent = [];
        await runOpsMetricsRollup(
            { windowHours: 168, kind: "weekly" },
            {
                firestore: fakeFirestore({ feedback: 0, clientErrors: 0, _lemonSqueezyWebhookEvents: 0 }),
                env: { GOATCOUNTER_API_TOKEN: "t" },
                httpGet: async (url) => url.endsWith("/stats/total")
                    ? ({ data: { total_events: 0 } })
                    : ({ data: { hits: [{ path: "event-checkout-start-failed", event: true, count: 2 }] } }),
                discordConfig: fullConfig(),
                discordSender: async (url, payload) => { sent.push({ url, payload }); }
            }
        );

        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-weeklyReport`);
    });

    it("posts the daily report only once without a launch-monitoring duplicate", async () => {
        const sent = [];
        await runOpsMetricsRollup(
            {
                windowHours: 24,
                kind: "daily"
            },
            {
                firestore: fakeFirestore({ feedback: 1, clientErrors: 0, _lemonSqueezyWebhookEvents: 1 }),
                env: {},
                discordConfig: fullConfig(),
                discordSender: async (url, payload) => { sent.push({ url, payload }); }
            }
        );

        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-dailyBriefing`);
        assert.match(sent[0].payload.embeds[0].title, /Morning briefing — yesterday finalized/);
    });

    it("routes the evening live report to Daily Metrics", async () => {
        const sent = [];
        await runOpsMetricsRollup(
            { windowHours: 24, kind: "daily", reportMode: "live" },
            {
                nowMs: Date.parse("2026-08-28T23:15:00Z"),
                firestore: fakeFirestore({ feedback: 0, clientErrors: 0, _lemonSqueezyWebhookEvents: 0 }),
                env: {},
                discordConfig: fullConfig(),
                discordSender: async (url, payload) => { sent.push({ url, payload }); }
            }
        );

        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-dailyMetrics`);
        assert.match(sent[0].payload.embeds[0].title, /Today so far/);
    });

    it("fails visibly when the scheduled Discord destination is missing", async () => {
        await assert.rejects(
            runOpsMetricsRollup(
                { windowHours: 24, kind: "daily" },
                {
                    firestore: fakeFirestore({ feedback: 0, clientErrors: 0, _lemonSqueezyWebhookEvents: 0 }),
                    env: {},
                    discordConfig: { channels: {}, adminRoleId: null }
                }
            ),
            /not delivered to Discord \(not_configured\)/
        );
    });
});
