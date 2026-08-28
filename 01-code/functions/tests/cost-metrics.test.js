"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const costMetrics = require("../costMetrics.js");

function series(value, { metric = {}, resource = {}, stamp = "2026-08-26T14:00:00Z" } = {}) {
    return [{
        metric: { labels: metric },
        resource: { labels: resource },
        points: [{ value: { int64Value: String(value) }, interval: { endTime: stamp } }]
    }];
}

describe("cost metric primitives", () => {
    it("sums delta series and only the latest point in gauges", () => {
        assert.equal(costMetrics.sumDeltaSeries([
            ...series(4),
            ...series(6)
        ]), 10);
        assert.equal(costMetrics.sumLatestGaugeSeries([{
            points: [
                { value: { int64Value: "8" }, interval: { endTime: "2026-08-26T12:00:00Z" } },
                { value: { int64Value: "5" }, interval: { endTime: "2026-08-26T11:00:00Z" } }
            ]
        }]), 8);
    });

    it("uses the Pacific Firebase quota-day boundaries across daylight saving time", () => {
        const summer = costMetrics.getReportingBoundaries(Date.parse("2026-08-26T16:00:00Z"));
        assert.equal(new Date(summer.dayStartMs).toISOString(), "2026-08-26T07:00:00.000Z");
        const winter = costMetrics.getReportingBoundaries(Date.parse("2026-01-26T16:00:00Z"));
        assert.equal(new Date(winter.dayStartMs).toISOString(), "2026-01-26T08:00:00.000Z");
        assert.equal(summer.timeZone, costMetrics.FIRESTORE_BILLING_TIME_ZONE);
    });

    it("builds exact completed-day and current-day Firestore report windows", () => {
        const nowMs = Date.parse("2026-08-26T16:00:00Z");
        const morning = costMetrics.getFirestoreReportWindow(nowMs, "morning");
        assert.equal(morning.dateKey, "2026-08-25");
        assert.equal(new Date(morning.startMs).toISOString(), "2026-08-25T07:00:00.000Z");
        assert.equal(new Date(morning.endMs).toISOString(), "2026-08-26T07:00:00.000Z");
        assert.equal(morning.complete, true);

        const evening = costMetrics.getFirestoreReportWindow(nowMs, "evening");
        assert.equal(evening.dateKey, "2026-08-26");
        assert.equal(new Date(evening.startMs).toISOString(), "2026-08-26T07:00:00.000Z");
        assert.equal(evening.endMs, nowMs);
        assert.equal(evening.complete, false);
    });

    it("matches the published reCAPTCHA tier boundaries", () => {
        assert.equal(costMetrics.calculateRecaptchaCost(10_000), 0);
        assert.equal(costMetrics.calculateRecaptchaCost(10_001), 8);
        assert.equal(costMetrics.calculateRecaptchaCost(100_000), 8);
        assert.equal(costMetrics.calculateRecaptchaCost(101_000), 9);
    });
});

describe("collectGuardMetrics", () => {
    it("uses a fixed six-query monitoring budget", async () => {
        const calls = [];
        const values = {
            [costMetrics.METRICS.firestoreReads]: 120,
            [costMetrics.METRICS.firestoreWrites]: 20,
            [costMetrics.METRICS.firestoreDeletes]: 2,
            [costMetrics.METRICS.recaptchaAssessments]: 50
        };
        const result = await costMetrics.collectGuardMetrics({
            nowMs: Date.parse("2026-08-26T16:00:00Z"),
            listTimeSeries: async metricType => {
                calls.push(metricType);
                if (metricType === costMetrics.METRICS.appCheckVerifications) {
                    return series(100, { metric: { result: "ALLOW", security: "VALID" } });
                }
                if (metricType === costMetrics.METRICS.functionExecutions) {
                    return series(30, { metric: { status: "ok" }, resource: { function_name: "getPremiumRoute" } });
                }
                return series(values[metricType] || 0);
            }
        });

        assert.equal(calls.length, 6);
        assert.equal(result.firestore.readsToday, 120);
        assert.equal(result.recaptcha.assessmentsMonth, 50);
        assert.equal(result.appCheck.allowed, 100);
        assert.equal(result.functionsHour.total, 30);
        assert.equal(result.sourceErrors.length, 0);
    });

    it("degrades missing metrics to null instead of inventing zero", async () => {
        const result = await costMetrics.collectGuardMetrics({
            listTimeSeries: async () => { throw new Error("permission denied"); }
        });
        assert.equal(result.firestore.readsToday, null);
        assert.equal(result.functionsHour.total, null);
        assert.equal(result.sourceErrors.length, 6);
    });

    it("keeps legacy counters as a daily-only reconciliation source", async () => {
        const calls = [];
        const result = await costMetrics.collectGuardMetrics({
            nowMs: Date.parse("2026-08-26T16:00:00Z"),
            includeLegacy: true,
            listTimeSeries: async metricType => {
                calls.push(metricType);
                return series(metricType.endsWith("read_count") ? 119 : 120);
            }
        });
        assert.equal(calls.length, 9);
        assert.equal(result.firestore.readsToday, 120);
        assert.equal(result.firestore.legacy.readsToday, 119);
    });
});

describe("collectFirestoreOperations", () => {
    it("uses canonical billing-oriented counters and keeps legacy metrics diagnostic-only", async () => {
        const calls = [];
        const result = await costMetrics.collectFirestoreOperations({ startMs: 1, endMs: 2 }, {
            includeLegacy: true,
            listTimeSeries: async metricType => {
                calls.push(metricType);
                return series(metricType.endsWith("read_ops_count") ? 120 : metricType.endsWith("read_count") ? 119 : 5);
            }
        });
        assert.equal(calls.length, 6);
        assert.equal(result.reads, 120);
        assert.equal(result.legacy.reads, 119);
        assert.equal(result.sourceErrors.length, 0);
    });
});

describe("function and App Check summaries", () => {
    it("identifies errors and top functions", () => {
        const summary = costMetrics.buildFunctionSummary([
            ...series(8, { metric: { status: "ok" }, resource: { function_name: "a" } }),
            ...series(2, { metric: { status: "error" }, resource: { function_name: "a" } }),
            ...series(4, { metric: { status: "ok" }, resource: { function_name: "b" } })
        ]);
        assert.equal(summary.total, 14);
        assert.equal(summary.errors, 2);
        assert.equal(summary.top[0].name, "a");
        assert.equal(summary.top[0].count, 10);
    });

    it("keeps billing assessments separate from App Check denials", () => {
        const summary = costMetrics.buildAppCheckSummary([
            ...series(90, { metric: { result: "ALLOW", security: "VALID" } }),
            ...series(10, { metric: { result: "DENY", security: "INVALID" } })
        ]);
        assert.equal(summary.total, 100);
        assert.equal(summary.denied, 10);
        assert.equal(summary.denyRate, 0.1);
        assert.equal(summary.invalid, 10);
    });
});
