const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const { getOrsEndpointName, getOrsQuotaObservation } = require("../orsTelemetry.js");
const { requestOrsWithRetry } = require("../orsSafety.js");

describe("ORS usage telemetry", () => {
    it("maps every HeiGIT routing URL to the CarterSwarm endpoint name", () => {
        assert.equal(getOrsEndpointName("https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson"), "directions");
        assert.equal(getOrsEndpointName("https://api.heigit.org/openrouteservice/v2/snap/driving-car/json"), "snap");
        assert.equal(getOrsEndpointName("https://api.heigit.org/pelias/v1/search"), "geocoding");
        assert.equal(getOrsEndpointName("https://api.heigit.org/health"), "other");
    });

    it("parses provider quota headers without inventing missing values", () => {
        assert.deepEqual(getOrsQuotaObservation({
            "x-ratelimit-limit": "2000",
            "x-ratelimit-remaining": "1999",
            "x-ratelimit-reset": "1786320000"
        }), { limit: 2000, remaining: 1999, reset: 1786320000 });
        assert.equal(getOrsQuotaObservation({}), null);
    });

    it("records every provider attempt, including retries", async () => {
        const events = [];
        let attempts = 0;
        const response = await requestOrsWithRetry(async () => {
            attempts += 1;
            if (attempts === 1) {
                const error = new Error("temporarily unavailable");
                error.response = { status: 503, headers: { "x-ratelimit-remaining": "1999" } };
                throw error;
            }
            return {
                data: { ok: true },
                headers: { "x-ratelimit-limit": "2000", "x-ratelimit-remaining": "1998" },
                status: 200
            };
        }, {
            disableOrsRetryJitter: true,
            nowMs: Date.parse("2026-08-21T12:00:00.000Z"),
            orsRetryBaseDelayMs: 0,
            recordOrsUsage: async event => events.push(event)
        }, "directions");

        assert.deepEqual(response.data, { ok: true });
        assert.deepEqual(events, [
            {
                date: "2026-08-21",
                endpoint: "directions",
                quota: { limit: null, remaining: 1999, reset: null },
                status: 503,
                success: false
            },
            {
                date: "2026-08-21",
                endpoint: "directions",
                quota: { limit: 2000, remaining: 1998, reset: null },
                status: 200,
                success: true
            }
        ]);
    });
});
