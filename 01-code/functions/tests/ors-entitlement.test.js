const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        normalizeEntitlement,
        isEffectivePremium,
        isFunctionFlagEnabled,
        getPremiumCallableRateLimit,
        requirePremiumCallable,
        handlePremiumRoute,
        handlePremiumGeocode,
        normalizeRouteCoordinates,
        extractSnappedRouteCoordinates
    }
} = require("../index.js");

function authedContext(uid = "user-a", token = {}) {
    return { auth: { uid, token } };
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

async function assertRejectsCode(promise, code) {
    await assert.rejects(
        promise,
        (error) => getHttpsErrorCode(error) === code
    );
}

function makeFirestore({ entitlement, exists = true, data, rateLimitCount } = {}) {
    const rateLimitDocs = new Map();
    const state = {
        reads: 0,
        writes: 0,
        userReads: 0,
        rateLimitReads: 0,
        rateLimitWrites: 0,
        requestedCollection: null,
        requestedDoc: null,
        lastRateLimitDoc: null
    };

    function makeDocRef(collectionName, docId) {
        return {
            async get() {
                state.reads += 1;
                state.requestedCollection = collectionName;
                state.requestedDoc = docId;

                if (collectionName === "users") {
                    state.userReads += 1;
                    return {
                        exists,
                        data: () => data || { entitlement }
                    };
                }

                if (collectionName === "_premiumCallableRateLimits") {
                    state.rateLimitReads += 1;
                    state.lastRateLimitDoc = docId;
                    const stored = rateLimitDocs.has(docId)
                        ? rateLimitDocs.get(docId)
                        : rateLimitCount === undefined
                            ? null
                            : { count: rateLimitCount };
                    return {
                        exists: stored !== null,
                        data: () => stored || {}
                    };
                }

                return {
                    exists: false,
                    data: () => ({})
                };
            },
            async set(value, options = {}) {
                state.writes += 1;
                if (collectionName === "_premiumCallableRateLimits") {
                    state.rateLimitWrites += 1;
                    state.lastRateLimitDoc = docId;
                    const previous = rateLimitDocs.get(docId) || {};
                    rateLimitDocs.set(docId, options.merge ? { ...previous, ...value } : { ...value });
                }
            }
        };
    }

    return {
        state,
        collection(collectionName) {
            state.requestedCollection = collectionName;
            return {
                doc(docId) {
                    state.requestedDoc = docId;
                    return makeDocRef(collectionName, docId);
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                get(ref) {
                    return ref.get();
                },
                set(ref, value, options) {
                    return ref.set(value, options);
                }
            });
        }
    };
}

const premiumEntitlement = {
    premium: true,
    status: "manual_active",
    source: "admin_override",
    manualOverride: true,
    currentPeriodEnd: null
};

describe("ORS premium callable entitlement helpers", () => {
    it("normalizes missing and malformed entitlements to non-premium", () => {
        assert.deepEqual(normalizeEntitlement(null), {
            premium: false,
            status: "free",
            source: "none",
            manualOverride: false,
            currentPeriodEnd: null,
            expiresAt: null,
            expiresAtMs: null
        });
        assert.equal(isEffectivePremium("premium"), false);
        assert.equal(isEffectivePremium({ premium: true, status: "free" }), false);
    });

    it("allows active, manual, past-due grace, and cancelled-but-active entitlements", () => {
        assert.equal(isEffectivePremium({ premium: true, status: "active" }), true);
        assert.equal(isEffectivePremium({ premium: true, status: "manual_active" }), true);
        assert.equal(isEffectivePremium({ premium: true, status: "past_due" }), true);
        assert.equal(isEffectivePremium({ premium: true, status: "cancelled_active" }), true);

        for (const status of ["canceled", "expired", "refunded", "trialing", "free"]) {
            assert.equal(isEffectivePremium({ premium: true, status }), false, status);
        }
    });

    it("allows non-expired access_code entitlement and rejects expired access_code entitlement", () => {
        const nowMs = Date.parse("2026-05-09T12:00:00.000Z");
        assert.equal(isEffectivePremium({
            premium: true,
            status: "access_code_active",
            source: "access_code",
            expiresAt: "2026-05-10T12:00:00.000Z"
        }, { nowMs }), true);

        assert.equal(isEffectivePremium({
            premium: true,
            status: "access_code_active",
            source: "access_code",
            expiresAt: "2026-05-08T12:00:00.000Z"
        }, { nowMs }), false);
    });

    it("rejects unauthenticated premium callable requests", async () => {
        await assertRejectsCode(
            requirePremiumCallable({}, "getPremiumRoute", {
                firestore: makeFirestore({ entitlement: premiumEntitlement })
            }),
            "unauthenticated"
        );
    });

    it("rejects unverified email/password premium callable requests before entitlement reads", async () => {
        const firestore = makeFirestore({ entitlement: premiumEntitlement });

        await assertRejectsCode(
            requirePremiumCallable(
                authedContext("unverified-premium-user", {
                    email: "unverified@example.test",
                    email_verified: false,
                    firebase: { sign_in_provider: "password" }
                }),
                "getPremiumRoute",
                { firestore }
            ),
            "failed-precondition"
        );

        assert.equal(firestore.state.reads, 0);
    });

    it("allows verified Google premium callable requests", async () => {
        const result = await requirePremiumCallable(
            authedContext("google-premium-user", {
                email: "google@example.test",
                email_verified: true,
                firebase: { sign_in_provider: "google.com" }
            }),
            "getPremiumRoute",
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement })
            }
        );

        assert.equal(result.uid, "google-premium-user");
        assert.equal(result.entitlement.premium, true);
    });

    it("rejects signed-in free users", async () => {
        const firestore = makeFirestore({
            entitlement: { premium: false, status: "free", source: "none" }
        });

        await assertRejectsCode(
            requirePremiumCallable(authedContext("free-user"), "getPremiumRoute", { firestore }),
            "permission-denied"
        );

        assert.equal(firestore.state.requestedCollection, "users");
        assert.equal(firestore.state.requestedDoc, "free-user");
        assert.equal(firestore.state.reads, 1);
    });

    it("rejects malformed and inactive premium entitlements", async () => {
        for (const entitlement of [
            "premium",
            { premium: true },
            { premium: true, status: "canceled" },
            { premium: true, status: "expired" },
            { premium: true, status: "refunded" }
        ]) {
            await assertRejectsCode(
                requirePremiumCallable(authedContext("inactive-user"), "getPremiumGeocode", {
                    firestore: makeFirestore({ entitlement })
                }),
                "permission-denied"
            );
        }
    });

    it("allows premium manual override users", async () => {
        const result = await requirePremiumCallable(authedContext("premium-user"), "getPremiumRoute", {
            firestore: makeFirestore({ entitlement: premiumEntitlement })
        });

        assert.equal(result.uid, "premium-user");
        assert.equal(result.entitlement.premium, true);
        assert.equal(result.entitlement.status, "manual_active");
    });

    it("allows Lemon Squeezy past_due grace users", async () => {
        const result = await requirePremiumCallable(authedContext("past-due-user"), "getPremiumRoute", {
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "past_due",
                    source: "lemon_squeezy"
                }
            })
        });

        assert.equal(result.uid, "past-due-user");
        assert.equal(result.entitlement.premium, true);
        assert.equal(result.entitlement.status, "past_due");
    });
});

describe("ORS premium callable handlers", () => {
    it("uses conservative default per-user premium callable limits", () => {
        assert.deepEqual(getPremiumCallableRateLimit("getPremiumRoute", { env: {} }), {
            maxRequests: 30,
            windowMs: 60 * 60 * 1000,
            message: "Route generation limit reached. Please try again shortly."
        });
        assert.deepEqual(getPremiumCallableRateLimit("getPremiumGeocode", { env: {} }), {
            maxRequests: 120,
            windowMs: 60 * 60 * 1000,
            message: "Global town search limit reached. Please try again shortly."
        });
    });

    it("can disable route generation server-side before entitlement reads or ORS calls", async () => {
        let postCalls = 0;
        const firestore = makeFirestore({ entitlement: premiumEntitlement });

        assert.equal(isFunctionFlagEnabled("getPremiumRoute", {
            env: { BARK_ENABLE_PREMIUM_ROUTE: "false" }
        }), false);

        await assertRejectsCode(
            handlePremiumRoute(
                {
                    data: {
                        coordinates: [[-122.4, 37.8], [-122.5, 37.9]]
                    }
                },
                authedContext("premium-user"),
                {
                    env: { BARK_ENABLE_PREMIUM_ROUTE: "false" },
                    firestore,
                    getOrsApiKey: () => "test-key",
                    axiosPost: async () => {
                        postCalls += 1;
                        return { data: { ok: true } };
                    }
                }
            ),
            "failed-precondition"
        );

        assert.equal(firestore.state.reads, 0);
        assert.equal(postCalls, 0);
    });

    it("can disable premium geocode server-side before entitlement reads or ORS calls", async () => {
        let getCalls = 0;
        const firestore = makeFirestore({ entitlement: premiumEntitlement });

        assert.equal(isFunctionFlagEnabled("getPremiumGeocode", {
            env: { BARK_ENABLE_PREMIUM_GEOCODE: "off" }
        }), false);

        await assertRejectsCode(
            handlePremiumGeocode(
                { data: { text: "Seattle" } },
                authedContext("premium-user"),
                {
                    env: { BARK_ENABLE_PREMIUM_GEOCODE: "off" },
                    firestore,
                    getOrsApiKey: () => "test-key",
                    axiosGet: async () => {
                        getCalls += 1;
                        return { data: { features: [] } };
                    }
                }
            ),
            "failed-precondition"
        );

        assert.equal(firestore.state.reads, 0);
        assert.equal(getCalls, 0);
    });

    it("rejects unverified email/password route requests before rate-limit, entitlement, or ORS work", async () => {
        let postCalls = 0;
        const firestore = makeFirestore({ entitlement: premiumEntitlement });

        await assertRejectsCode(
            handlePremiumRoute(
                {
                    data: {
                        coordinates: [[-122.4, 37.8], [-122.5, 37.9]]
                    }
                },
                authedContext("unverified-route-user", {
                    email: "unverified@example.test",
                    email_verified: false,
                    firebase: { sign_in_provider: "password" }
                }),
                {
                    firestore,
                    getOrsApiKey: () => "test-key",
                    axiosPost: async () => {
                        postCalls += 1;
                        return { data: { ok: true } };
                    }
                }
            ),
            "failed-precondition"
        );

        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes, 0);
        assert.equal(postCalls, 0);
    });

    it("rejects unverified email/password geocode requests before rate-limit, entitlement, or ORS work", async () => {
        let getCalls = 0;
        const firestore = makeFirestore({ entitlement: premiumEntitlement });

        await assertRejectsCode(
            handlePremiumGeocode(
                { data: { text: "Seattle" } },
                authedContext("unverified-geocode-user", {
                    email: "unverified@example.test",
                    email_verified: false,
                    firebase: { sign_in_provider: "password" }
                }),
                {
                    firestore,
                    getOrsApiKey: () => "test-key",
                    axiosGet: async () => {
                        getCalls += 1;
                        return { data: { features: [] } };
                    }
                }
            ),
            "failed-precondition"
        );

        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes, 0);
        assert.equal(getCalls, 0);
    });

    it("rate-limits premium routes before entitlement reads or ORS calls", async () => {
        let postCalls = 0;
        const firestore = makeFirestore({
            entitlement: premiumEntitlement,
            rateLimitCount: 2
        });

        await assertRejectsCode(
            handlePremiumRoute(
                {
                    data: {
                        coordinates: [[-122.4, 37.8], [-122.5, 37.9]]
                    }
                },
                authedContext("premium-user"),
                {
                    firestore,
                    nowMillis: 1700000000000,
                    premiumCallableRateLimits: {
                        getPremiumRoute: { maxRequests: 2, windowMs: 60 * 1000 }
                    },
                    getOrsApiKey: () => "test-key",
                    axiosPost: async () => {
                        postCalls += 1;
                        return { data: { ok: true } };
                    }
                }
            ),
            "resource-exhausted"
        );

        assert.equal(firestore.state.rateLimitReads, 1);
        assert.equal(firestore.state.rateLimitWrites, 0);
        assert.equal(firestore.state.userReads, 0);
        assert.equal(postCalls, 0);
    });

    it("rate-limits premium geocode before entitlement reads or ORS calls", async () => {
        let getCalls = 0;
        const firestore = makeFirestore({
            entitlement: premiumEntitlement,
            rateLimitCount: 1
        });

        await assertRejectsCode(
            handlePremiumGeocode(
                { data: { text: "Seattle" } },
                authedContext("premium-user"),
                {
                    firestore,
                    nowMillis: 1700000000000,
                    premiumCallableRateLimits: {
                        getPremiumGeocode: { maxRequests: 1, windowMs: 60 * 1000 }
                    },
                    getOrsApiKey: () => "test-key",
                    axiosGet: async () => {
                        getCalls += 1;
                        return { data: { features: [] } };
                    }
                }
            ),
            "resource-exhausted"
        );

        assert.equal(firestore.state.rateLimitReads, 1);
        assert.equal(firestore.state.rateLimitWrites, 0);
        assert.equal(firestore.state.userReads, 0);
        assert.equal(getCalls, 0);
    });

    it("resets premium geocode counters when the rate-limit window changes", async () => {
        let getCalls = 0;
        const firestore = makeFirestore({ entitlement: premiumEntitlement });
        const options = {
            firestore,
            premiumCallableRateLimits: {
                getPremiumGeocode: { maxRequests: 1, windowMs: 60 * 1000 }
            },
            getOrsApiKey: () => "test-key",
            axiosGet: async () => {
                getCalls += 1;
                return { data: { features: [] } };
            }
        };

        await handlePremiumGeocode(
            { data: { text: "Seattle" } },
            authedContext("premium-user"),
            { ...options, nowMillis: 1700000000000 }
        );

        await assertRejectsCode(
            handlePremiumGeocode(
                { data: { text: "Portland" } },
                authedContext("premium-user"),
                { ...options, nowMillis: 1700000001000 }
            ),
            "resource-exhausted"
        );

        await handlePremiumGeocode(
            { data: { text: "Tacoma" } },
            authedContext("premium-user"),
            { ...options, nowMillis: 1700000060000 }
        );

        assert.equal(getCalls, 2);
    });

    it("normalizes route coordinate pairs and rejects malformed waypoint lists", () => {
        assert.deepEqual(
            normalizeRouteCoordinates([["-86.3447388", "46.5482534"], [-86.65, 46.41]]),
            [[-86.3447388, 46.5482534], [-86.65, 46.41]]
        );
        assert.equal(normalizeRouteCoordinates([[-86.3447388], [-86.65, 46.41]]), null);
        assert.equal(normalizeRouteCoordinates([["nope", 46.5482534], [-86.65, 46.41]]), null);
    });

    it("uses snapped route-network coordinates when ORS snap resolves off-road pins", () => {
        const picturedRocksPin = [-86.3447388, 46.5482534];
        const munisingPin = [-86.647936, 46.411512];
        const snappedPicturedRocks = [-86.3601, 46.5488];
        const snappedMunising = [-86.6495, 46.412];

        assert.deepEqual(
            extractSnappedRouteCoordinates(
                [picturedRocksPin, munisingPin],
                {
                    locations: [
                        { location: snappedPicturedRocks, snapped_distance: 1240 },
                        { location: snappedMunising, snapped_distance: 18 }
                    ]
                }
            ),
            [snappedPicturedRocks, snappedMunising]
        );
    });

    it("falls back per waypoint when ORS snap cannot resolve a coordinate", () => {
        const rawCoordinates = [[-86.3447388, 46.5482534], [-86.647936, 46.411512]];
        const snappedSecond = [-86.6495, 46.412];

        assert.deepEqual(
            extractSnappedRouteCoordinates(rawCoordinates, {
                locations: [
                    null,
                    { location: snappedSecond, snapped_distance: 18 }
                ]
            }),
            [rawCoordinates[0], snappedSecond]
        );
    });

    it("rejects free route requests before ORS is called and ignores client isPremium", async () => {
        let postCalls = 0;

        await assertRejectsCode(
            handlePremiumRoute(
                {
                    data: {
                        coordinates: [[-122.4, 37.8], [-122.5, 37.9]],
                        isPremium: true
                    }
                },
                authedContext("free-user"),
                {
                    firestore: makeFirestore({
                        entitlement: { premium: false, status: "free", source: "none" }
                    }),
                    getOrsApiKey: () => "test-key",
                    axiosPost: async () => {
                        postCalls += 1;
                        return { data: { ok: true } };
                    }
                }
            ),
            "permission-denied"
        );

        assert.equal(postCalls, 0);
    });

    it("rejects free geocode requests before ORS is called and ignores client isPremium", async () => {
        let getCalls = 0;

        await assertRejectsCode(
            handlePremiumGeocode(
                { text: "San Francisco", isPremium: true },
                authedContext("free-user"),
                {
                    firestore: makeFirestore({
                        entitlement: { premium: false, status: "free", source: "none" }
                    }),
                    getOrsApiKey: () => "test-key",
                    axiosGet: async () => {
                        getCalls += 1;
                        return { data: { features: [] } };
                    }
                }
            ),
            "permission-denied"
        );

        assert.equal(getCalls, 0);
    });

    it("allows premium route requests through to the ORS transport path", async () => {
        const capturedRequests = [];
        const picturedRocksPin = [-86.3447388, 46.5482534];
        const munisingPin = [-86.647936, 46.411512];
        const snappedPicturedRocks = [-86.3601, 46.5488];
        const snappedMunising = [-86.6495, 46.412];

        const result = await handlePremiumRoute(
            {
                data: {
                    coordinates: [picturedRocksPin, munisingPin],
                    radiuses: [-1, -1]
                }
            },
            authedContext("premium-user"),
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement }),
                getOrsApiKey: () => "test-key",
                axiosPost: async (url, body, config) => {
                    capturedRequests.push({ url, body, config });
                    if (/\/snap\//.test(url)) {
                        return {
                            data: {
                                locations: [
                                    { location: snappedPicturedRocks, snapped_distance: 1240 },
                                    { location: snappedMunising, snapped_distance: 18 }
                                ]
                            }
                        };
                    }
                    return { data: { type: "FeatureCollection" } };
                }
            }
        );

        assert.deepEqual(result, { type: "FeatureCollection" });
        assert.equal(capturedRequests.length, 2);
        assert.match(capturedRequests[0].url, /openrouteservice\.org\/v2\/snap\/driving-car/);
        assert.deepEqual(capturedRequests[0].body.locations, [picturedRocksPin, munisingPin]);
        assert.equal(capturedRequests[0].body.radius, 2000);
        assert.match(capturedRequests[1].url, /openrouteservice\.org\/v2\/directions/);
        assert.deepEqual(capturedRequests[1].body.coordinates, [snappedPicturedRocks, snappedMunising]);
        assert.deepEqual(capturedRequests[1].body.radiuses, [-1, -1]);
        assert.equal(capturedRequests[1].config.headers.Authorization, "test-key");
    });

    it("retries rate-limited ORS route requests before returning a route", async () => {
        const rawCoordinates = [[-83.4161, 36.2124], [-82.5508, 35.5953]];
        const snappedCoordinates = [[-83.4164, 36.2127], [-82.5506, 35.5954]];
        let directionAttempts = 0;

        const result = await handlePremiumRoute(
            {
                data: {
                    coordinates: rawCoordinates,
                    radiuses: [-1, -1]
                }
            },
            authedContext("premium-user"),
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement }),
                getOrsApiKey: () => "test-key",
                orsRetryMaxAttempts: 3,
                orsRetryBaseDelayMs: 0,
                disableOrsRetryJitter: true,
                axiosPost: async (url) => {
                    if (/\/snap\//.test(url)) {
                        return {
                            data: {
                                locations: snappedCoordinates.map(location => ({ location }))
                            }
                        };
                    }

                    directionAttempts += 1;
                    if (directionAttempts < 3) {
                        const error = new Error("Request failed with status code 429");
                        error.response = {
                            status: 429,
                            headers: { "retry-after": "0" }
                        };
                        throw error;
                    }

                    return {
                        data: {
                            type: "FeatureCollection",
                            features: [{
                                properties: {
                                    summary: {
                                        distance: 1000,
                                        duration: 600
                                    }
                                }
                            }]
                        }
                    };
                }
            }
        );

        assert.equal(directionAttempts, 3);
        assert.equal(result.type, "FeatureCollection");
        assert.deepEqual(result.features[0].properties.summary, { distance: 1000, duration: 600 });
    });

    it("uses a local geocode fallback when ORS cannot snap a named park pin", async () => {
        const capturedPosts = [];
        const capturedGets = [];
        const picturedRocksPin = [-86.3186376, 46.5687756];
        const munisingPin = [-86.623367, 46.423864];
        const snappedPicturedRocksCandidate = [-86.304249, 46.550672];
        const snappedMunising = [-86.624276, 46.423711];

        const result = await handlePremiumRoute(
            {
                data: {
                    coordinates: [picturedRocksPin, munisingPin],
                    radiuses: [-1, -1],
                    waypoints: [
                        {
                            name: "Pictured Rocks National Lakeshore",
                            state: "Michigan"
                        },
                        {
                            name: "Munising Falls Visitor Center",
                            state: "Michigan"
                        }
                    ]
                }
            },
            authedContext("premium-user"),
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement }),
                getOrsApiKey: () => "test-key",
                axiosGet: async (url) => {
                    capturedGets.push(url);
                    return {
                        data: {
                            features: [
                                {
                                    type: "Feature",
                                    properties: {
                                        label: "Pictured Rocks National Lakeshore, Burt, MI, USA",
                                        confidence: 0.8
                                    },
                                    geometry: {
                                        type: "Point",
                                        coordinates: [-86.31647, 46.56424]
                                    }
                                },
                                {
                                    type: "Feature",
                                    properties: {
                                        label: "Unrelated Trailhead, Burt, MI, USA",
                                        confidence: 1
                                    },
                                    geometry: {
                                        type: "Point",
                                        coordinates: [-86.4, 46.5]
                                    }
                                }
                            ]
                        }
                    };
                },
                axiosPost: async (url, body, config) => {
                    capturedPosts.push({ url, body, config });
                    if (/\/snap\//.test(url) && body.locations.length === 2) {
                        return {
                            data: {
                                locations: [
                                    null,
                                    { location: snappedMunising, snapped_distance: 71.77 }
                                ]
                            }
                        };
                    }
                    if (/\/snap\//.test(url)) {
                        return {
                            data: {
                                locations: [
                                    { location: snappedPicturedRocksCandidate, snapped_distance: 1774.68 }
                                ]
                            }
                        };
                    }
                    return { data: { type: "FeatureCollection" } };
                }
            }
        );

        assert.deepEqual(result, { type: "FeatureCollection" });
        assert.equal(capturedGets.length, 1);
        assert.match(capturedGets[0], /geocode\/search/);
        assert.match(capturedGets[0], /Pictured\+Rocks\+National\+Lakeshore/);
        assert.match(capturedGets[0], /boundary\.circle\.radius=50/);
        assert.equal(capturedPosts.length, 3);
        assert.deepEqual(capturedPosts[2].body.coordinates, [snappedPicturedRocksCandidate, snappedMunising]);
        assert.deepEqual(capturedPosts[2].body.radiuses, [-1, -1]);
    });

    it("falls back to original route coordinates when ORS snap is unavailable", async () => {
        const rawCoordinates = [[-122.4, 37.8], [-122.5, 37.9]];
        const capturedRequests = [];

        const result = await handlePremiumRoute(
            {
                data: {
                    coordinates: rawCoordinates,
                    radiuses: [350, 350]
                }
            },
            authedContext("premium-user"),
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement }),
                getOrsApiKey: () => "test-key",
                orsRetryMaxAttempts: 1,
                axiosPost: async (url, body, config) => {
                    capturedRequests.push({ url, body, config });
                    if (/\/snap\//.test(url)) {
                        throw new Error("snap service temporarily unavailable");
                    }
                    return { data: { type: "FeatureCollection" } };
                }
            }
        );

        assert.deepEqual(result, { type: "FeatureCollection" });
        assert.equal(capturedRequests.length, 2);
        assert.match(capturedRequests[0].url, /openrouteservice\.org\/v2\/snap\/driving-car/);
        assert.match(capturedRequests[1].url, /openrouteservice\.org\/v2\/directions/);
        assert.deepEqual(capturedRequests[1].body.coordinates, rawCoordinates);
    });

    it("allows premium geocode requests through to the ORS transport path", async () => {
        let capturedUrl = "";

        const result = await handlePremiumGeocode(
            { data: { text: "Seattle", size: 3, country: "US" } },
            authedContext("premium-user"),
            {
                firestore: makeFirestore({ entitlement: premiumEntitlement }),
                getOrsApiKey: () => "test-key",
                axiosGet: async (url) => {
                    capturedUrl = url;
                    return { data: { features: [{ properties: { label: "Seattle" } }] } };
                }
            }
        );

        assert.equal(result.features[0].properties.label, "Seattle");
        assert.match(capturedUrl, /openrouteservice\.org\/geocode\/search/);
        assert.match(capturedUrl, /text=Seattle/);
        assert.match(capturedUrl, /size=3/);
        assert.match(capturedUrl, /boundary\.country=US/);
    });
});
