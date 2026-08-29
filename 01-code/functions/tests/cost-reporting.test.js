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

function fakeFirestore({ lastMorningReportDate = "2026-08-26", lastEveningReportDate = "2026-08-26", alerts = {} } = {}) {
    const stats = { stateReads: 0, orsReads: 0, aggregateReads: 0, writes: [] };
    const state = { lastMorningReportDate, lastEveningReportDate, alerts };
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
    if (metricType === costMetrics.METRICS.monthlyNewSignIns) return pointSeries(5);
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

    it("clears recovered state without turning recovery into another alert", () => {
        const transitions = costReporting.getAlertTransitions([], {
            reads: { severity: "important", lastNotifiedAtMs: 1_000 }
        }, 2_000);
        assert.equal(transitions.resolved.length, 1);
        assert.deepEqual(transitions.next, {});
    });

    it("does not repeat a still-active alert after 24 hours", () => {
        const alert = { id: "reads", severity: "important", details: "x" };
        const transitions = costReporting.getAlertTransitions([alert], {
            reads: { severity: "important", lastNotifiedAtMs: 1_000, details: "x" }
        }, 1_000 + 48 * 60 * 60 * 1000);
        assert.equal(transitions.notify.length, 0);
    });

    it("routes function errors to detected bugs instead of the costs channel", () => {
        const alerts = costReporting.evaluateGuardAlerts({
            firestore: { readsToday: 0, writesToday: 0 },
            recaptcha: { assessmentsMonth: 0 },
            appCheck: { total: 0, denyRate: 0 },
            functionsHour: { total: 100, errors: 10, errorRate: 0.10 }
        }, {
            directions: { requestsToday: 0 }, snap: { requestsToday: 0 }, geocoding: { requestsToday: 0 }
        });
        assert.equal(alerts.find(alert => alert.id === "function_error_rate").channel, "bugs");
        assert.ok(opsDiscord.KNOWN_CHANNELS.includes(alerts.find(alert => alert.id === "function_error_rate").channel));
    });

    it("separates missing client coverage from actually denied or invalid traffic", () => {
        const alerts = costReporting.evaluateGuardAlerts({
            firestore: { readsToday: 0, writesToday: 0 },
            recaptcha: { assessmentsMonth: 0 },
            appCheck: {
                total: 100,
                denied: 0,
                denyRate: 0,
                invalid: 0,
                invalidRate: 0,
                missingOutdatedClient: 25,
                missingUnknownOrigin: 5,
                unverifiedRate: 0.30
            },
            functionsHour: { total: 100, errors: 0, errorRate: 0 }
        }, {
            directions: { requestsToday: 0 }, snap: { requestsToday: 0 }, geocoding: { requestsToday: 0 }
        });
        assert.equal(alerts.some(alert => alert.id === "app_check_security"), false);
        assert.equal(alerts.find(alert => alert.id === "app_check_coverage").severity, "important");
    });

    it("explains App Check alerts with exact percentages, customer impact, and cost context", () => {
        const alerts = costReporting.evaluateGuardAlerts({
            firestore: { readsToday: 4_301, writesToday: 959 },
            recaptcha: { assessmentsMonth: 0 },
            appCheck: {
                total: 593,
                allowed: 593,
                denied: 0,
                denyRate: 0,
                invalid: 30,
                invalidRate: 30 / 593,
                missingOutdatedClient: 0,
                missingUnknownOrigin: 0,
                unverifiedRate: 30 / 593
            },
            functionsHour: { total: 100, errors: 0, errorRate: 0 }
        }, {
            directions: { requestsToday: 0 }, snap: { requestsToday: 0 }, geocoding: { requestsToday: 0 }
        });
        const alert = alerts.find(item => item.id === "app_check_security");
        assert.equal(alert.severity, "important");
        const message = costReporting.buildCostAlertMessage(alert);
        const fields = Object.fromEntries(message.fields.map(field => [field.name, field.value]));
        assert.match(fields["What happened"], /30 invalid \(5\.06%\)/);
        assert.match(fields["What happened"], /0 denied \(0\.00%\)/);
        assert.match(fields["Customer impact"], /No requests were blocked/);
        assert.match(fields.Response, /No immediate action is required/);
        assert.match(fields["Likely cost"], /\$0 likely/);
        assert.match(fields["Likely cost"], /4,301 reads \(8\.60%/);
        assert.match(fields["Signs of a real incident"], /payments or routing turning red/);
    });

    it("keeps a stable second App Check sample yellow and turns worsening traffic red", () => {
        const baseGuard = {
            firestore: { readsToday: 4_301, writesToday: 959 },
            recaptcha: { assessmentsMonth: 0 },
            appCheck: {
                total: 600,
                allowed: 600,
                denied: 0,
                denyRate: 0,
                invalid: 30,
                invalidRate: 0.05,
                missingOutdatedClient: 0,
                missingUnknownOrigin: 0,
                unverifiedRate: 0.05
            },
            functionsHour: { total: 100, errors: 0, errorRate: 0 }
        };
        const ors = {
            directions: { requestsToday: 0 }, snap: { requestsToday: 0 }, geocoding: { requestsToday: 0 }
        };
        const previous = { app_check_security: { severity: "important", value: 0.05 } };
        const stable = costReporting.evaluateGuardAlerts(baseGuard, ors, previous)
            .find(item => item.id === "app_check_security");
        const worsening = costReporting.evaluateGuardAlerts({
            ...baseGuard,
            appCheck: { ...baseGuard.appCheck, invalid: 48, invalidRate: 0.08 }
        }, ors, previous).find(item => item.id === "app_check_security");
        assert.equal(stable.severity, "important");
        assert.equal(worsening.severity, "critical");
    });

    it("requires a second App Check sample even when the first sample is above ten percent", () => {
        const guard = {
            firestore: { readsToday: 0, writesToday: 0 },
            recaptcha: { assessmentsMonth: 0 },
            appCheck: {
                total: 600,
                allowed: 600,
                denied: 0,
                denyRate: 0,
                invalid: 72,
                invalidRate: 0.12,
                missingOutdatedClient: 0,
                missingUnknownOrigin: 0,
                unverifiedRate: 0.12
            },
            functionsHour: { total: 100, errors: 0, errorRate: 0 }
        };
        const ors = {
            directions: { requestsToday: 0 }, snap: { requestsToday: 0 }, geocoding: { requestsToday: 0 }
        };
        assert.equal(costReporting.evaluateGuardAlerts(guard, ors)
            .find(item => item.id === "app_check_security").severity, "important");
        assert.equal(costReporting.evaluateGuardAlerts(guard, ors, {
            app_check_security: { severity: "important", value: 0.12 }
        }).find(item => item.id === "app_check_security").severity, "critical");
    });

    it("builds one green reset message with current percentages and a fresh watch cycle", () => {
        const message = costReporting.buildAppCheckRecoveryMessage([
            { id: "app_check_security", previous: { severity: "important" } }
        ], {
            firestore: { readsToday: 4_000, writesToday: 800 },
            appCheck: {
                total: 500,
                allowed: 500,
                denied: 0,
                invalid: 0
            }
        }, {});
        assert.equal(message.tier, "routine");
        assert.match(message.title, /stable again/);
        assert.match(message.fields.find(field => field.name === "Reset status").value, /new yellow Watching cycle/);
    });
});

describe("daily billing freshness alerts", () => {
    it("detects a stale numeric BigQuery timestamp", () => {
        const alerts = costReporting.evaluateDailyAlerts({
            collectedAt: "2026-08-28T20:00:00.000Z",
            costs: { allInMonthlyRunRate: 10 },
            billing: { available: true, freshestExportAt: "1.7877004E9" }
        });
        assert.equal(alerts.find(alert => alert.id === "billing_export_stale").severity, "important");
    });

    it("flags an unparseable freshness timestamp instead of silently accepting it", () => {
        const alerts = costReporting.evaluateDailyAlerts({
            collectedAt: "2026-08-28T20:00:00.000Z",
            costs: { allInMonthlyRunRate: 10 },
            billing: { available: true, freshestExportAt: "bad-time" }
        });
        assert.equal(alerts.find(alert => alert.id === "billing_export_timestamp_invalid").severity, "important");
    });
});

describe("cost report schedule", () => {
    it("posts the completed prior day after 9 AM and today-so-far after 11 PM Eastern", () => {
        const morning = costReporting.getDueCostReports({}, Date.parse("2026-08-26T13:20:00Z"));
        assert.deepEqual(morning.map(item => item.kind), ["morning"]);
        const evening = costReporting.getDueCostReports({ lastMorningReportDate: "2026-08-26" }, Date.parse("2026-08-27T03:20:00Z"));
        assert.deepEqual(evening.map(item => item.kind), ["evening"]);
    });
});

describe("hourly cost job read/write ceiling", () => {
    it("uses six Monitoring queries, four Firestore reads, and zero writes in a healthy non-daily hour", async () => {
        const db = fakeFirestore();
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

    it("replaces the alert map so recovered alerts are actually removed", async () => {
        const db = fakeFirestore({
            alerts: { function_error_rate: { severity: "important", lastNotifiedAtMs: 1, details: "old" } }
        });
        await costReporting.runHourlyCostMonitoring({
            nowMs: Date.parse("2026-08-26T16:20:00Z"),
            firestore: db,
            listTimeSeries: async metricType => metricSource(metricType),
            discordConfig: fullConfig(),
            discordSender: async () => ({})
        });
        assert.equal(db.stats.writes.length, 1);
        assert.deepEqual(db.stats.writes[0].value.alerts, {});
        assert.ok(db.stats.writes[0].options.mergeFields.includes("alerts"));
        assert.equal(db.stats.writes[0].options.merge, undefined);
    });

    it("posts and caches one daily snapshot without scanning users", async () => {
        const db = fakeFirestore({ lastMorningReportDate: "2026-08-25" });
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
        assert.equal(monitoringCalls.length, 29); // 6 guard + 17 monthly + 6 exact report-window counters.
        assert.equal(db.stats.aggregateReads, 4); // active count includes a deleted-account aggregation; no document scan.
        assert.equal(db.stats.writes.length, 2); // one snapshot + one state update.
        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-costs`);
        assert.match(sent[0].payload.embeds[0].title, /Previous-day cost report/);
        assert.equal(result.snapshot.costs.denominator, "active account");
        assert.equal(result.snapshot.users.registered, 0); // all four fake counts match, so all documents minus deleted is zero.
        assert.equal(result.snapshot.users.monthlyNewSignIns, 5);
        assert.equal(result.dailyPosted, true);
    });
});

describe("daily cost message", () => {
    it("labels Lemon and delayed billing figures honestly", () => {
        const message = costReporting.buildDailyCostMessage({
            dateKey: "2026-08-26",
            report: { kind: "morning", complete: true },
            costs: { cloudActualMtd: null, cloudForecast: 7, allInMonthlyRunRate: 15, costPerActiveUser: 0.2, denominator: "active account" },
            users: { registered: 75, allDocuments: 76, deleted: 1, monthlyNewSignIns: 60, premium: 63, paid: 63 },
            firestore: { report: { reads: 10, writes: 5, deletes: 0, legacy: { reads: 10, writes: 5, deletes: 0 } }, readsMonth: 100, writesMonth: 50, deletesMonth: 1, legacy: { readsMonth: 100, writesMonth: 50, deletesMonth: 1 }, readsPerActiveUser: 2, writesPerActiveUser: 1, storageBytes: 1, pitrBytes: 1, backupBytes: 1 },
            functions: { total: 20, errors: 0, egressBytes: 0, top: [] },
            hosting: { sentBytesMonth: 1, storageBytes: 1 },
            logging: { ingestedBytesMonth: 1 },
            recaptcha: { assessmentsMonth: 3 },
            appCheck: { allowed: 3, denied: 0, denyRate: 0, invalid: 0, invalidRate: 0, unverified: 0, unverifiedRate: 0 },
            ors: { directions: { requestsToday: 0, dailyLimit: 2000 }, snap: { requestsToday: 0, dailyLimit: 2000 }, geocoding: { requestsToday: 0, dailyLimit: 3000 } },
            billing: { available: false, byService: [] },
            sourceErrors: []
        });
        assert.match(message.description, /conservative base-fee run-rate/);
        assert.match(message.title, /Previous-day cost report/);
        assert.equal(message.channel, "costs");
        assert.equal(message.tier, "routine");
    });
});
