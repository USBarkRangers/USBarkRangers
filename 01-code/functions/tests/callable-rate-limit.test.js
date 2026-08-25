const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    BOUNDED_CALLABLE_RATE_LIMITS,
    GLOBAL_CALLABLE_RATE_LIMITS,
    enforceBoundedCallableRateLimit,
    warmConfiguredCallableRateLimitPath,
    enforcePremiumCallableRateLimits
} = require("../rateLimits.js");
const {
    ROUTE_PROVIDER_ATTEMPT_LIMIT,
    ORS_CIRCUIT_LIMITS,
    enforceOrsCircuitLimit,
    createProviderAttemptBudget
} = require("../orsSafety.js");
const { __test: { snapRouteCoordinates } } = require("../index.js");

function errorCode(error) {
    return String(error && error.code || "").replace(/^functions\//, "");
}

function makeCounterFirestore() {
    const docs = new Map();
    const state = { reads: 0, writes: 0, transactions: 0 };

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
            state.transactions += 1;
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
    it("warms the checkout user and global transaction path without consuming a limit", async () => {
        const firestore = makeCounterFirestore();

        await warmConfiguredCallableRateLimitPath("createCheckoutSession", {
            firestore,
            warmupUid: "checkout-startup"
        });

        assert.deepEqual(firestore.state, { reads: 2, writes: 0, transactions: 1 });
        assert.equal(firestore.docs.size, 0);
    });

    it("keeps the deployed route, provider, and shared ceilings unchanged", () => {
        assert.deepEqual(BOUNDED_CALLABLE_RATE_LIMITS.getPremiumRouteBurst, {
            shortMax: 12,
            shortWindowMs: 10 * 60 * 1000
        });
        assert.deepEqual(GLOBAL_CALLABLE_RATE_LIMITS.lemonApi, {
            shortMax: 200,
            shortWindowMs: 5 * 60 * 1000,
            dailyMax: 5000
        });
        assert.deepEqual(BOUNDED_CALLABLE_RATE_LIMITS.getCustomerPortalUrl, {
            shortMax: 30,
            shortWindowMs: 60 * 60 * 1000,
            dailyMax: 60
        });
        assert.equal(ROUTE_PROVIDER_ATTEMPT_LIMIT, 12);
        assert.deepEqual(ORS_CIRCUIT_LIMITS.directions, {
            shortMax: 32,
            shortWindowMs: 60 * 1000,
            dailyMax: 1600
        });
    });

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

    it("migrates active route counters once, then admits routes with one read and one write", async () => {
        const firestore = makeCounterFirestore();
        const uid = "route-migration-user";
        const nowMillis = Date.parse("2026-08-24T20:02:00.000Z");
        const premiumWindowStart = Date.parse("2026-08-24T20:00:00.000Z");
        const burstWindowStart = Date.parse("2026-08-24T20:00:00.000Z");
        firestore.docs.set(`_premiumCallableRateLimits/getPremiumRoute_${uid}_${premiumWindowStart}`, { count: 7 });
        firestore.docs.set(`_callableRateLimits/getPremiumRouteBurst_${uid}`, {
            shortWindowStartMs: burstWindowStart,
            shortCount: 3
        });
        const options = {
            firestore,
            nowMillis,
            premiumCallableRateLimits: {
                getPremiumRoute: { maxRequests: 30, windowMs: 60 * 60 * 1000 }
            },
            callableRateLimits: {
                getPremiumRouteBurst: { shortMax: 12, shortWindowMs: 10 * 60 * 1000 }
            }
        };

        await enforcePremiumCallableRateLimits(uid, "getPremiumRoute", options);
        const migrated = firestore.docs.get(`_premiumCallableRateLimits/getPremiumRoute_${uid}`);
        assert.equal(migrated.schemaVersion, 2);
        assert.equal(migrated.premiumCount, 8);
        assert.equal(migrated.burstCount, 4);
        assert.deepEqual(firestore.state, { reads: 3, writes: 1, transactions: 1 });

        await enforcePremiumCallableRateLimits(uid, "getPremiumRoute", options);
        const admittedAgain = firestore.docs.get(`_premiumCallableRateLimits/getPremiumRoute_${uid}`);
        assert.equal(admittedAgain.premiumCount, 9);
        assert.equal(admittedAgain.burstCount, 5);
        assert.deepEqual(firestore.state, { reads: 4, writes: 2, transactions: 2 });
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
