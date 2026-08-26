"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const ga4Metrics = require("../ga4Metrics.js");

function audienceReport(values) {
    const names = ["totalUsers", "activeUsers", "newUsers", "returningUsers", "sessions"];
    return {
        metricHeaders: names.map(name => ({ name })),
        rows: [{ metricValues: names.map(name => ({ value: String(values[name] || 0) })) }]
    };
}

function eventReport({ opens = 0, openUsers = 0, screens = 0, screenUsers = 0 }) {
    return {
        rows: [
            { dimensionValues: [{ value: "bark_app_opened" }], metricValues: [{ value: String(opens) }, { value: String(openUsers) }] },
            { dimensionValues: [{ value: "bark_screen_view" }], metricValues: [{ value: String(screens) }, { value: String(screenUsers) }] }
        ]
    };
}

describe("GA4 visitor metrics", () => {
    it("returns zeroes without querying GA4 before tracking began", async () => {
        let calls = 0;
        const result = await ga4Metrics.fetchGa4VisitorStats("2026-08-25", "2026-08-25", {
            gaRunReport: async () => { calls += 1; }
        });
        assert.equal(calls, 0);
        assert.equal(result.period.totalUsers, 0);
        assert.equal(result.allTime.screenViews, 0);
    });

    it("combines identity, session, open, and screen reports", () => {
        const combined = ga4Metrics.combineReports(
            audienceReport({ totalUsers: 10, activeUsers: 9, newUsers: 4, returningUsers: 6, sessions: 13 }),
            eventReport({ opens: 15, openUsers: 10, screens: 42, screenUsers: 9 })
        );
        assert.deepEqual(combined, {
            totalUsers: 10,
            activeUsers: 9,
            newUsers: 4,
            returningUsers: 6,
            sessions: 13,
            appOpens: 15,
            appOpenUsers: 10,
            screenViews: 42,
            screenViewUsers: 9
        });
    });

    it("collects both the requested day and cumulative tracked range", async () => {
        const requests = [];
        const reports = [
            audienceReport({ totalUsers: 3, sessions: 4 }),
            eventReport({ opens: 5, screens: 9 }),
            audienceReport({ totalUsers: 20, sessions: 30 }),
            eventReport({ opens: 35, screens: 90 })
        ];
        const result = await ga4Metrics.fetchGa4VisitorStats("2026-08-26", "2026-08-26", {
            gaRunReport: async (_property, request) => {
                requests.push(request);
                return reports[requests.length - 1];
            }
        });

        assert.equal(requests.length, 4);
        assert.equal(result.period.totalUsers, 3);
        assert.equal(result.period.screenViews, 9);
        assert.equal(result.allTime.totalUsers, 20);
        assert.equal(result.allTime.screenViews, 90);
        assert.equal(requests[2].dateRanges[0].startDate, ga4Metrics.GA4_TRACKING_START_DATE);
    });
});
