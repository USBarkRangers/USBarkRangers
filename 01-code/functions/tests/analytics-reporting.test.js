"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const reporting = require("../analyticsReporting.js");

function summary({ users = 5, opens = 8, screens = 20, goatSessions = 4 } = {}) {
    return {
        ga4: {
            trackingStartDate: "2026-08-26",
            period: { totalUsers: users, appOpens: opens, screenViews: screens },
            allTime: { totalUsers: users, appOpens: opens, screenViews: screens }
        },
        traffic: {
            appVisits: goatSessions,
            appOpens: opens,
            repeatOpens: Math.max(0, opens - goatSessions),
            allTime: {
                trackingStartDate: "2026-01-01",
                sessions: goatSessions,
                appOpens: opens,
                pageVisits: screens,
                partial: false
            }
        }
    };
}

describe("analytics reporting periods", () => {
    it("schedules exactly two Eastern reports: 9:15 AM and 7:15 PM", () => {
        assert.equal(reporting.DAILY_REPORT_CRON, "15 9,19 * * *");
        assert.equal(reporting.getDailyReportMode(Date.parse("2026-08-28T13:15:00Z")), "finalized");
        assert.equal(reporting.getDailyReportMode(Date.parse("2026-08-28T23:15:00Z")), "live");
    });

    it("uses the last completed Eastern calendar day across DST", () => {
        const period = reporting.getCompletedCalendarPeriod(Date.parse("2026-08-27T16:00:00Z"), 1);
        assert.equal(period.startDate, "2026-08-26");
        assert.equal(period.endDate, "2026-08-26");
        assert.equal(new Date(period.startMs).toISOString(), "2026-08-26T04:00:00.000Z");
        assert.equal(new Date(period.endMs).toISOString(), "2026-08-27T04:00:00.000Z");
        assert.equal(period.completed, true);
    });

    it("uses Eastern midnight through collection time for the live report", () => {
        const nowMs = Date.parse("2026-08-28T19:15:00Z");
        const period = reporting.getCurrentCalendarPeriod(nowMs);
        assert.equal(period.startDate, "2026-08-28");
        assert.equal(period.endDate, "2026-08-28");
        assert.equal(new Date(period.startMs).toISOString(), "2026-08-28T04:00:00.000Z");
        assert.equal(new Date(period.endMs).toISOString(), "2026-08-28T19:15:00.000Z");
        assert.equal(period.completed, false);
        assert.match(period.label, /3:15 PM EDT/);
    });
});

describe("analytics cumulative snapshot", () => {
    it("keeps observed cumulative values monotonic while retaining raw provider values", () => {
        const period = reporting.getCompletedCalendarPeriod(Date.parse("2026-08-27T16:00:00Z"), 1);
        const first = reporting.buildAnalyticsSnapshot({}, summary({ users: 10, opens: 15, screens: 40, goatSessions: 9 }), period, "2026-08-27T20:00:00Z");
        const second = reporting.buildAnalyticsSnapshot(first, summary({ users: 9, opens: 14, screens: 39, goatSessions: 8 }), period, "2026-08-27T21:00:00Z");

        assert.equal(second.cumulative.providerReported.ga4.totalUsers, 9);
        assert.equal(second.cumulative.monotonicObserved.ga4.totalUsers, 10);
        assert.equal(second.cumulative.monotonicObserved.ga4.screenViews, 40);
        assert.equal(second.cumulative.monotonicObserved.goatCounter.sessions, 9);
        assert.ok(second.finalizedDays["2026-08-26"]);
    });

    it("never saves an in-progress day as finalized", () => {
        const period = reporting.getCurrentCalendarPeriod(Date.parse("2026-08-28T19:15:00Z"));
        const snapshot = reporting.buildAnalyticsSnapshot({}, summary(), period, "2026-08-28T19:15:00Z");
        assert.deepEqual(snapshot.finalizedDays, {});
    });
});

describe("account-source reconciliation", () => {
    it("compares Firestore raw-minus-deleted with Firebase Authentication", async () => {
        const query = (count) => ({
            where() { return query(40); },
            count() { return { get: async () => ({ data: () => ({ count }) }) }; }
        });
        const db = { collection: () => query(129) };
        const pages = [
            { users: Array.from({ length: 60 }), pageToken: "next" },
            { users: Array.from({ length: 29 }) }
        ];
        const authClient = { listUsers: async () => pages.shift() };
        const result = await reporting.collectAccountReconciliation(db, authClient);

        assert.deepEqual(result, {
            rawDocuments: 129,
            deletedDocuments: 40,
            firestoreActive: 89,
            authActive: 89,
            difference: 0
        });
    });
});
