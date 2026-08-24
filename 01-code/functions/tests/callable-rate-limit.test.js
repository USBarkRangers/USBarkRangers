const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        enforceBoundedCallableRateLimit,
        enforceOrsCircuitLimit,
        createProviderAttemptBudget,
        snapRouteCoordinates
    }
} = require("../index.js");

function errorCode(error) {
    return String(error && error.code || "").replace(/^functions\//, "");
}

function makeCounterFirestore() {
    const docs = new Map();
    const state = { reads: 0, writes: 0 };

    function ref(collectionName, docId) {
        const key = `${collectionName}/${docId}`;
        return {
            key,
            async get() {
                state.reads += 1;
                const value = docs.get(key);
                return { exists: value !== undefined, data: () => value || {} };
            }
        };
    }

    return {
        docs,
        state,
        collection(collectionName) {
            return { doc(docId) { return ref(collectionName, docId); } };
        },
        async runTransaction(callback) {
            return callback({
                get(target) { return target.get(); },
                set(target, value, options = {}) {
                    state.writes += 1;
                    const previous = docs.get(target.key) || {};
                    docs.set(target.key, options.merge ? { ...previous, ...value } : { ...value });
                }
            });
        }
    };
}

describe("bounded callable rate limits", () => {
    it("blocks the third call in a two-call short window with an exact reset timestamp", async () => {
        const firestore = makeCounterFirestore();
        const now = Date.parse("2026-08-24T20:01:00.000Z");
        const options = {
            firestore,
            nowMillis: now,
            callableRateLimits: {
                createCheckoutSession: { shortMax: 2, shortWindowMs: 15 * 60 * 1000, dailyMax: 20 }
            },
            globalCallableRateLimits: {
                lemonApi: { shortMax: 1000, shortWindowMs: 5 * 60 * 1000, dailyMax: 5000 }
            }
        };

        await enforceBoundedCallableRateLimit("ranger-a", "createCheckoutSession", options);
        await enforceBoundedCallableRateLimit("ranger-a", "createCheckoutSession", options);
        await assert.rejects(
            enforceBoundedCallableRateLimit("ranger-a", "createCheckoutSession", options),
            error => errorCode(error) === "resource-exhausted" &&
                /Are you a bot\?/.test(error.message) &&
                error.details.retryAt === "2026-08-24T20:15:00.000Z" &&
                error.details.scope === "user"
        );
    });

    it("keeps the daily ceiling even after short windows reset", async () => {
        const firestore = makeCounterFirestore();
        const dayStart = Date.parse("2026-08-24T00:00:00.000Z");
        const base = {
            firestore,
            callableRateLimits: {
                restorePremiumPurchase: { shortMax: 100, shortWindowMs: 60 * 1000, dailyMax: 2 }
            },
            globalCallableRateLimits: {
                lemonApi: { shortMax: 1000, shortWindowMs: 60 * 1000, dailyMax: 5000 }
            }
        };

        await enforceBoundedCallableRateLimit("ranger-b", "restorePremiumPurchase", { ...base, nowMillis: dayStart + 60_000 });
        await enforceBoundedCallableRateLimit("ranger-b", "restorePremiumPurchase", { ...base, nowMillis: dayStart + 3_600_000 });
        await assert.rejects(
            enforceBoundedCallableRateLimit("ranger-b", "restorePremiumPurchase", { ...base, nowMillis: dayStart + 7_200_000 }),
            error => errorCode(error) === "resource-exhausted" &&
                error.details.retryAt === "2026-08-25T00:00:00.000Z"
        );
    });

    it("shares the Lemon provider ceiling across different users", async () => {
        const firestore = makeCounterFirestore();
        const nowMillis = Date.parse("2026-08-24T20:02:00.000Z");
        const options = {
            firestore,
            nowMillis,
            callableRateLimits: {
                createCheckoutSession: { shortMax: 100, shortWindowMs: 15 * 60 * 1000, dailyMax: 100 }
            },
            globalCallableRateLimits: {
                lemonApi: { shortMax: 2, shortWindowMs: 5 * 60 * 1000, dailyMax: 100 }
            }
        };

        await enforceBoundedCallableRateLimit("ranger-a", "createCheckoutSession", options);
        await enforceBoundedCallableRateLimit("ranger-b", "createCheckoutSession", options);
        await assert.rejects(
            enforceBoundedCallableRateLimit("ranger-c", "createCheckoutSession", options),
            error => errorCode(error) === "resource-exhausted" && error.details.scope === "global"
        );
    });
});

describe("route provider work ceilings", () => {
    it("opens the directions circuit before exceeding the configured project budget", async () => {
        const firestore = makeCounterFirestore();
        const options = {
            orsCircuitFirestore: firestore,
            enforceOrsCircuitLimits: true,
            nowMillis: Date.parse("2026-08-24T20:02:00.000Z"),
            orsCircuitLimits: {
                directions: { shortMax: 2, shortWindowMs: 60 * 1000, dailyMax: 20 }
            }
        };

        await enforceOrsCircuitLimit("directions", options);
        await enforceOrsCircuitLimit("directions", options);
        await assert.rejects(
            enforceOrsCircuitLimit("directions", options),
            error => errorCode(error) === "resource-exhausted" &&
                error.details.action === "ors-directions" &&
                error.details.retryAt === "2026-08-24T20:03:00.000Z"
        );
    });

    it("reserves the requested final-route slot inside the provider-attempt budget", () => {
        const budget = createProviderAttemptBudget(3);
        assert.equal(budget.consume("directions", 1), 1);
        assert.equal(budget.consume("snap", 1), 2);
        assert.throws(
            () => budget.consume("geocoding", 1),
            error => errorCode(error) === "failed-precondition" && error.details.attemptLimit === 3
        );
        assert.equal(budget.consume("directions", 0), 3);
    });

    it("rejects more than four unresolved route points after one bulk snap call", async () => {
        let providerCalls = 0;
        const coordinates = Array.from({ length: 6 }, (_, index) => [-81 - index * 0.01, 30 + index * 0.01]);
        await assert.rejects(
            snapRouteCoordinates(coordinates, "test-key", {
                axiosPost: async () => {
                    providerCalls += 1;
                    return { data: { locations: coordinates.map(() => null) } };
                },
                waypoints: coordinates.map((_coordinate, index) => ({ name: `Stop ${index + 1}`, country: "US" })),
                providerAttemptBudget: createProviderAttemptBudget(12)
            }),
            error => errorCode(error) === "failed-precondition" &&
                error.details.reason === "too-many-off-road-stops" &&
                error.details.fallbackPointLimit === 4
        );
        assert.equal(providerCalls, 1);
    });
});
