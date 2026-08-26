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

describe("countBetween", () => {
    it("returns the aggregation count for a closed period", async () => {
        const db = fakeFirestore({ feedback: 9 });
        assert.equal(
            await opsMetrics.countBetween(db, "feedback", "createdAt", new Date(0), new Date(1)),
            9
        );
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
        assert.equal(byName["Raw app loads (reloads count)"], "n/a");
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
                traffic: {
                    appOpens: 10,
                    appVisits: 6,
                    repeatOpens: 4,
                    productionVisits: 5,
                    betaVisits: 1,
                    topPages: [{ path: "/", count: 6 }]
                }
            },
            { channel: "dailyMetrics", title: "t" }
        );
        assert.match(message.description, /Top pages/);
        assert.match(message.description, /`6` \/$/m);
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
                httpGet: async (url, config) => url.endsWith("/stats/total")
                    ? ({ data: { total: 99, total_events: 99 } })
                    : ({ data: { hits: [
                        { path: "/", title: "US BARK Rangers", count: 40 },
                        { path: "event-app-session-production", event: true, count: 31 },
                        { path: "event-app-open-production", event: true, count: 99 }
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

    it("reuses one collected summary for a launch-monitoring mirror", async () => {
        const sent = [];
        await runOpsMetricsRollup(
            {
                windowHours: 24,
                channel: "dailyMetrics",
                title: "Daily metrics",
                mirrors: [{ channel: "launchMonitoring", title: "Daily launch health pulse" }]
            },
            {
                firestore: fakeFirestore({ feedback: 1, clientErrors: 0, _lemonSqueezyWebhookEvents: 1 }),
                env: {},
                discordConfig: fullConfig(),
                discordSender: async (url, payload) => { sent.push({ url, payload }); }
            }
        );

        assert.equal(sent.length, 2);
        assert.equal(sent[0].url, `${HOOK}-dailyMetrics`);
        assert.equal(sent[1].url, `${HOOK}-launchMonitoring`);
        assert.equal(sent[1].payload.embeds[0].title, "Daily launch health pulse");
    });
});
