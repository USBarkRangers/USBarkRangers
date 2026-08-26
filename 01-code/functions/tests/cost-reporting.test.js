"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");

process.env.NODE_ENV = "test";

const costMetrics = require("../costMetrics.js");
const costReporting = require("../costReporting.js");
const opsDiscord = require("../opsDiscord.js");

const HOOK = "https://discord.com/api/webhooks/123/abc";

function fullConfig() {
    const channels = {};
    opsDiscord.KNOWN_CHANNELS.forEach(channel => { channels[channel] = `${HOOK}-${channel}`; });
    return { channels, adminRoleId: "999" };
}

function pointSeries(value, metric = {}, resource = {}) {
    return [{
        metric: { labels: metric },
        resource: { labels: resource },
        points: [{ value: { int64Value: String(value) }, interval: { endTime: "2026-08-26T16:00:00Z" } }]
    }];
}

function fakeFirestore({ lastDailyDate = "2026-08-26" } = {}) {
    const stats = { stateReads: 0, orsReads: 0, aggregateReads: 0, writes: [] };
    const state = { lastDailyDate, alerts: {} };
    const db = {
        stats,
        doc(path) {
            return {
                path,
                async get() {
                    if (path === costReporting.COST_STATE_PATH) {
                        stats.stateReads += 1;
                        return { exists: true, data: () => state };
                    }
                    return { exists: false, data: () => ({}) };
                },
                async set(value, options) { stats.writes.push({ path, value, options }); }
            };
        },
        collection(name) {
            if (name === "_orsCircuitLimits") {
                return {
                    doc(endpoint) {
                        return { endpoint, async get() { stats.orsReads += 1; return { exists: true, data: () => ({ dailyCount: 3 }) }; } };
                    }
                };
            }
            if (name === "users") {
                const query = {
                    where() { return query; },
                    count() {
                        return { async get() { stats.aggregateReads += 1; return { data: () => ({ count: 10 }) }; } };
                    }
                };
                return query;
            }
            throw new Error(`unexpected collection ${name}`);
        },
        async getAll(...refs) {
            stats.orsReads += refs.length;
            return refs.map(() => ({ exists: true, data: () => ({ dailyCount: 3 }) }));
        }
    };
    return db;
}

function metricSource(metricType) {
    if (metricType === costMetrics.METRICS.appCheckVerifications) {
        return pointSeries(100, { result: "ALLOW", security: "VALID" });
    }
    if (metricType === costMetrics.METRICS.functionExecutions) {
        return pointSeries(30, { status: "ok" }, { function_name: "dailyOpsMetrics" });
    }
    if ([costMetrics.METRICS.hostingStorage,
        costMetrics.METRICS.loggingMonthlyIngested, costMetrics.METRICS.firestoreStorage,
        costMetrics.METRICS.firestorePitr, costMetrics.METRICS.firestoreBackups].includes(metricType)) {
        return pointSeries(1024);
    }
    if (metricType === costMetrics.METRICS.monthlyActiveUsers) return pointSeries(5);
    if (metricType === costMetrics.METRICS.recaptchaAssessments) return pointSeries(50);
    return pointSeries(100);
}

beforeEach(() => opsDiscord.resetDiscordState());
afterEach(() => opsDiscord.resetDiscordState());

describe("cost alert thresholds and deduplication", () => {
    it("raises critical alerts before the Firebase free ceiling", () => {
        const alerts = costReporting.evaluateGuardAlerts({
            firestore: { readsToday: 46_000, writesToday: 19_000 },
            recaptcha: { assessmentsMonth: 9_600 },
            appCheck: { total: 0, denyRate: 0 },
            functionsHour: { total: 0, errorRate: 0 }
        }, {
            directions: { requestsToday: 0 }, snap: { requestsToday: 0 }, geocoding: { requestsToday: 0 }
        });
        assert.equal(alerts.find(alert => alert.id === "firestore_reads").severity, "critical");
        assert.equal(alerts.find(alert => alert.id === "firestore_writes").severity, "critical");
        assert.equal(alerts.find(alert => alert.id === "recaptcha").severity, "critical");
    });

    it("does not repeat an unchanged alert inside 24 hours", () => {
        const alert = { id: "reads", severity: "important", details: "x" };
        const transitions = costReporting.getAlertTransitions([alert], {
            reads: { severity: "important", lastNotifiedAtMs: 1_000 }
        }, 1_000 + 60 * 60 * 1000);
        assert.equal(transitions.notify.length, 0);
        assert.equal(transitions.resolved.length, 0);
    });

    it("does not rewrite state when only suppressed alert counts change", () => {
        const previous = {
            reads: { severity: "important", lastNotifiedAtMs: 1_000, details: "35,001 reads" }
        };
        const transitions = costReporting.getAlertTransitions([
            { id: "reads", severity: "important", details: "35,400 reads" }
        ], previous, 1_000 + 60 * 60 * 1000);
        assert.deepEqual(transitions.next, previous);
        assert.equal(transitions.notify.length, 0);
    });

    it("reports a recovery exactly once", () => {
        const transitions = costReporting.getAlertTransitions([], {
            reads: { severity: "important", lastNotifiedAtMs: 1_000 }
        }, 2_000);
        assert.equal(transitions.resolved.length, 1);
        assert.deepEqual(transitions.next, {});
    });
});

describe("hourly cost job read/write ceiling", () => {
    it("uses six Monitoring queries, four Firestore reads, and zero writes in a healthy non-daily hour", async () => {
        const db = fakeFirestore({ lastDailyDate: "2026-08-26" });
        const monitoringCalls = [];
        const sent = [];
        const result = await costReporting.runHourlyCostMonitoring({
            nowMs: Date.parse("2026-08-26T16:20:00Z"), // 12:20 ET
            firestore: db,
            listTimeSeries: async metricType => { monitoringCalls.push(metricType); return metricSource(metricType); },
            discordConfig: fullConfig(),
            discordSender: async (url, payload) => { sent.push({ url, payload }); }
        });
        assert.equal(monitoringCalls.length, 6);
        assert.equal(db.stats.stateReads, 1);
        assert.equal(db.stats.orsReads, 3);
        assert.equal(db.stats.aggregateReads, 0);
        assert.equal(db.stats.writes.length, 0);
        assert.equal(sent.length, 0);
        assert.equal(result.alerts.length, 0);
    });

    it("posts and caches one daily snapshot without scanning users", async () => {
        const db = fakeFirestore({ lastDailyDate: "2026-08-25" });
        const monitoringCalls = [];
        const sent = [];
        const result = await costReporting.runHourlyCostMonitoring({
            nowMs: Date.parse("2026-08-26T16:20:00Z"),
            firestore: db,
            listTimeSeries: async metricType => { monitoringCalls.push(metricType); return metricSource(metricType); },
            billingCost: { available: true, actualMtd: 5, byService: [{ service: "Cloud Functions", cost: 5 }], freshestExportAt: "2026-08-26T15:00:00Z" },
            discordConfig: fullConfig(),
            discordSender: async (url, payload) => { sent.push({ url, payload }); }
        });
        assert.equal(monitoringCalls.length, 20); // 6 guard + 14 daily, fixed regardless of users.
        assert.equal(db.stats.aggregateReads, 3); // count() aggregations, not document scans.
        assert.equal(db.stats.writes.length, 2); // one snapshot + one state update.
        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-costs`);
        assert.match(sent[0].payload.embeds[0].title, /Daily cost status/);
        assert.equal(result.dailyPosted, true);
    });
});

describe("daily cost message", () => {
    it("labels Lemon and delayed billing figures honestly", () => {
        const message = costReporting.buildDailyCostMessage({
            dateKey: "2026-08-26",
            costs: { cloudActualMtd: null, cloudForecast: 7, allInMonthlyRunRate: 15, costPerActiveUser: 0.2, denominator: "monthly active user" },
            users: { registered: 75, monthlyActive: 60, premium: 63, paid: 63 },
            firestore: { readsToday: 10, writesToday: 5, deletesToday: 0, readsMonth: 100, writesMonth: 50, deletesMonth: 1, readsPerActiveUser: 2, writesPerActiveUser: 1, storageBytes: 1, pitrBytes: 1, backupBytes: 1 },
            functions: { total: 20, errors: 0, egressBytes: 0, top: [] },
            hosting: { sentBytesMonth: 1, storageBytes: 1 },
            logging: { ingestedBytesMonth: 1 },
            recaptcha: { assessmentsMonth: 3 },
            appCheck: { allowed: 3, denied: 0, denyRate: 0, invalid: 0, invalidRate: 0 },
            ors: { directions: { requestsToday: 0, dailyLimit: 2000 }, snap: { requestsToday: 0, dailyLimit: 2000 }, geocoding: { requestsToday: 0, dailyLimit: 1000 } },
            billing: { available: false, byService: [] },
            sourceErrors: []
        });
        assert.match(message.description, /conservative base-fee run-rate/);
        assert.equal(message.channel, "costs");
        assert.equal(message.tier, "routine");
    });
});
