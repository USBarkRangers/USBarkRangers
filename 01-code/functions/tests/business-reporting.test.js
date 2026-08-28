"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const reporting = require("../businessReporting.js");

function summary(overrides = {}) {
    return {
        periodLabel: "2026-08-26 finalized day",
        ga4: {
            period: { totalUsers: 12, newUsers: 7, returningUsers: 5, sessions: 18, screenViews: 45 },
            previousPeriod: { totalUsers: 10 }
        },
        traffic: {
            paymentFunnel: {
                "paywall-open": 4,
                "premium-confirmed": 2,
                "checkout-start-failed": 0,
                "premium-confirmation-timeout": 0
            }
        },
        costSnapshot: {
            users: { registered: 75, premium: 63 },
            costs: { allInMonthlyRunRate: 8.4, cloudActualMtd: 1.2, costPerActiveUser: 0.11 }
        },
        clientErrors: 0,
        feedback: 3,
        ...overrides
    };
}

describe("plain-language business reports", () => {
    it("builds one concise finalized report in Daily Metrics", () => {
        const message = reporting.buildBusinessReport(summary(), { kind: "daily" });
        const fields = Object.fromEntries(message.fields.map(field => [field.name, field.value]));
        assert.equal(message.channel, "dailyMetrics");
        assert.match(message.title, /Yesterday finalized/);
        assert.match(fields["Growing or shrinking?"], /Growing 20.0%/);
        assert.match(fields["App activity"], /app loads/);
        assert.match(fields.Premium, /63 of 75/);
        assert.match(fields.Premium, /50.0%/);
        assert.match(fields["Cost overview"], /\$8\.40\/month/);
        assert.doesNotMatch(JSON.stringify(message), /GA4|Firestore|GoatCounter/);
    });

    it("labels the afternoon report as live and does not compare a partial day to a full day", () => {
        const message = reporting.buildBusinessReport(summary(), { kind: "daily", reportMode: "live" });
        const trend = message.fields.find(field => field.name === "Growing or shrinking?");
        assert.match(message.title, /Today so far/);
        assert.match(trend.value, /still in progress/);
        assert.match(message.footer, /Google may finish processing/);
    });

    it("puts growth, conversion, engagement, and cost in the weekly report", () => {
        const message = reporting.buildBusinessReport(summary({ periodLabel: "2026-08-20 through 2026-08-26" }), { kind: "weekly" });
        const names = message.fields.map(field => field.name);
        assert.equal(message.channel, "weeklyReport");
        assert.ok(names.includes("Growing or shrinking?"));
        assert.ok(names.includes("Premium"));
        assert.ok(names.includes("Engagement"));
        assert.ok(names.includes("Cost overview"));
    });

    it("does not invent a trend when no prior period exists", () => {
        const message = reporting.buildBusinessReport(summary({
            ga4: { period: { totalUsers: 12, newUsers: 7, returningUsers: 5, sessions: 18, screenViews: 45 }, previousPeriod: null }
        }), { kind: "daily" });
        const trend = message.fields.find(field => field.name === "Growing or shrinking?");
        assert.match(trend.value, /No complete earlier day/);
    });

    it("reads only the single cached cost document", async () => {
        let reads = 0;
        const result = await reporting.loadCostSnapshot({
            doc(path) {
                assert.equal(path, reporting.COST_SNAPSHOT_PATH);
                return { get: async () => { reads += 1; return { exists: true, data: () => ({ costs: {} }) }; } };
            }
        });
        assert.deepEqual(result, { costs: {} });
        assert.equal(reads, 1);
    });
});
