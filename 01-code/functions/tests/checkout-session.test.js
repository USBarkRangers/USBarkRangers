const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        buildCheckoutReturnUrl,
        buildLemonSqueezyCheckoutPayload,
        getLemonSqueezyModeConfig,
        shouldAcceptLemonSqueezyWebhookMode,
        handleGetCustomerPortalUrl,
        handleCreateCheckoutSession,
        buildLemonSqueezySubscriptionsListUrl,
        selectRestorableLemonSqueezySubscription,
        handleRestorePremiumPurchase,
        isFunctionFlagEnabled
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

const config = {
    apiKey: "test-api-key",
    storeId: "363425",
    annualVariantId: "1604336",
    appBaseUrl: "https://outswarming.github.io/bark-ranger-map/"
};

function makeUserFirestore(userData = {}) {
    let storedUserData = { ...userData };
    const eventDocs = new Map();
    const state = {
        reads: 0,
        writes: [],
        eventWrites: [],
        transactions: 0,
        requestedCollection: null,
        requestedDoc: null,
        lastEventDoc: null
    };
    function makeDocRef(collectionName, docId) {
        return {
            collectionName,
            docId,
            async get() {
                state.reads += 1;
                if (collectionName === "users") {
                    state.requestedCollection = collectionName;
                    state.requestedDoc = docId;
                    return {
                        exists: true,
                        data: () => ({ ...storedUserData })
                    };
                }
                if (collectionName === "_lemonSqueezyWebhookEvents") {
                    state.lastEventDoc = docId;
                    const eventData = eventDocs.get(docId);
                    return {
                        exists: eventData !== undefined,
                        data: () => eventData || {}
                    };
                }
                return {
                    exists: false,
                    data: () => ({})
                };
            },
            async set(value, options = {}) {
                if (collectionName === "users") {
                    storedUserData = options.merge ? { ...storedUserData, ...value } : { ...value };
                    state.requestedCollection = collectionName;
                    state.requestedDoc = docId;
                    state.writes.push({ collectionName, docId, data: value, options });
                    return;
                }
                if (collectionName === "_lemonSqueezyWebhookEvents") {
                    const previous = eventDocs.get(docId) || {};
                    const next = options.merge ? { ...previous, ...value } : { ...value };
                    eventDocs.set(docId, next);
                    state.lastEventDoc = docId;
                    state.eventWrites.push({ collectionName, docId, data: value, options });
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
            state.transactions += 1;
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

describe("Lemon Squeezy checkout session helpers", () => {
    it("keeps Lemon live mode locked even if live approval env is absent or present", () => {
        const defaultMode = getLemonSqueezyModeConfig({ env: {} });
        assert.equal(defaultMode.checkoutTestMode, true);
        assert.equal(defaultMode.acceptLiveWebhooks, false);
        assert.equal(defaultMode.liveModeApproved, false);
        assert.match(defaultMode.lockReason, /Carter/i);

        const approvedButStillCodeLocked = getLemonSqueezyModeConfig({
            env: { BARK_LEMON_LIVE_MODE_APPROVAL: "CARTER_APPROVED_LIVE_RC" }
        });
        assert.equal(approvedButStillCodeLocked.liveModeApproved, true);
        assert.equal(approvedButStillCodeLocked.checkoutTestMode, true);
        assert.equal(approvedButStillCodeLocked.acceptLiveWebhooks, false);

        assert.equal(shouldAcceptLemonSqueezyWebhookMode({ test_mode: true }, { env: {} }), true);
        assert.equal(shouldAcceptLemonSqueezyWebhookMode({ test_mode: false }, {
            env: { BARK_LEMON_LIVE_MODE_APPROVAL: "CARTER_APPROVED_LIVE_RC" }
        }), false);
    });

    it("builds checkout return URLs from the app base URL", () => {
        assert.equal(
            buildCheckoutReturnUrl(config.appBaseUrl, "success"),
            "https://outswarming.github.io/bark-ranger-map/?checkout=success&provider=lemonsqueezy"
        );
        assert.equal(
            buildCheckoutReturnUrl(config.appBaseUrl, "canceled"),
            "https://outswarming.github.io/bark-ranger-map/?checkout=canceled&provider=lemonsqueezy"
        );
    });

    it("builds restore subscription lookup URLs by signed-in email", () => {
        const url = new URL(buildLemonSqueezySubscriptionsListUrl(config, "ranger@example.test"));
        assert.equal(url.origin + url.pathname, "https://api.lemonsqueezy.com/v1/subscriptions");
        assert.equal(url.searchParams.get("filter[store_id]"), "363425");
        assert.equal(url.searchParams.get("filter[variant_id]"), "1604336");
        assert.equal(url.searchParams.get("filter[user_email]"), "ranger@example.test");
        assert.equal(url.searchParams.get("page[size]"), "10");
    });

    it("selects the newest active restorable subscription for an email", () => {
        const subscription = selectRestorableLemonSqueezySubscription([
            {
                id: "sub_old",
                type: "subscriptions",
                attributes: {
                    test_mode: true,
                    store_id: 363425,
                    variant_id: 1604336,
                    user_email: "ranger@example.test",
                    status: "active",
                    updated_at: "2026-01-01T00:00:00.000Z"
                }
            },
            {
                id: "sub_new",
                type: "subscriptions",
                attributes: {
                    test_mode: true,
                    store_id: 363425,
                    variant_id: 1604336,
                    user_email: "RANGER@example.test",
                    status: "active",
                    updated_at: "2026-01-05T00:00:00.000Z"
                }
            },
            {
                id: "sub_refunded",
                type: "subscriptions",
                attributes: {
                    test_mode: true,
                    store_id: 363425,
                    variant_id: 1604336,
                    user_email: "ranger@example.test",
                    status: "refunded",
                    updated_at: "2026-01-10T00:00:00.000Z"
                }
            }
        ], "ranger@example.test");

        assert.equal(subscription.id, "sub_new");
    });

    it("builds a test-mode annual checkout payload with Firebase UID custom data", () => {
        const payload = buildLemonSqueezyCheckoutPayload({
            uid: "real-user",
            token: {
                email: "ranger@example.test",
                name: "Ranger Tester"
            },
            config
        });

        assert.equal(payload.data.type, "checkouts");
        assert.equal(payload.data.attributes.test_mode, true);
        assert.deepEqual(payload.data.attributes.product_options.enabled_variants, [1604336]);
        assert.equal(
            payload.data.attributes.product_options.redirect_url,
            "https://outswarming.github.io/bark-ranger-map/?checkout=success&provider=lemonsqueezy"
        );
        assert.equal(payload.data.attributes.checkout_data.email, "ranger@example.test");
        assert.equal(payload.data.attributes.checkout_data.name, "Ranger Tester");
        assert.equal(payload.data.attributes.checkout_data.custom.firebase_uid, "real-user");
        assert.equal(payload.data.attributes.checkout_data.custom.plan, "annual");
        assert.equal(payload.data.relationships.store.data.id, "363425");
        assert.equal(payload.data.relationships.variant.data.id, "1604336");
    });
});

describe("Lemon Squeezy checkout session callable", () => {
    it("can disable checkout server-side without touching Lemon Squeezy test mode", async () => {
        let postCalls = 0;

        assert.equal(isFunctionFlagEnabled("createCheckoutSession", {
            env: { BARK_ENABLE_CHECKOUT: "false" }
        }), false);

        await assertRejectsCode(
            handleCreateCheckoutSession(
                {},
                authedContext("checkout-paused-user"),
                {
                    env: { BARK_ENABLE_CHECKOUT: "false" },
                    axiosPost: async () => {
                        postCalls += 1;
                        throw new Error("should not call Lemon Squeezy when checkout is paused");
                    }
                }
            ),
            "failed-precondition"
        );

        assert.equal(postCalls, 0);
    });

    it("rejects unauthenticated checkout requests", async () => {
        await assertRejectsCode(
            handleCreateCheckoutSession({}, {}, {
                ...config,
                axiosPost: async () => {
                    throw new Error("should not call Lemon Squeezy");
                }
            }),
            "unauthenticated"
        );
    });

    it("rejects unverified email/password checkout requests before Lemon Squeezy is called", async () => {
        let postCalls = 0;

        await assertRejectsCode(
            handleCreateCheckoutSession(
                {},
                authedContext("unverified-email-user", {
                    email: "unverified@example.test",
                    email_verified: false,
                    firebase: { sign_in_provider: "password" }
                }),
                {
                    ...config,
                    axiosPost: async () => {
                        postCalls += 1;
                    }
                }
            ),
            "failed-precondition"
        );

        assert.equal(postCalls, 0);
    });

    it("allows verified Google users to start checkout", async () => {
        let postCalls = 0;

        const result = await handleCreateCheckoutSession(
            {},
            authedContext("google-verified-user", {
                email: "google@example.test",
                email_verified: true,
                firebase: { sign_in_provider: "google.com" }
            }),
            {
                ...config,
                axiosPost: async () => {
                    postCalls += 1;
                    return {
                        data: {
                            data: {
                                attributes: {
                                    url: "https://usbarkrangers.lemonsqueezy.com/checkout/test-session"
                                }
                            }
                        }
                    };
                }
            }
        );

        assert.equal(postCalls, 1);
        assert.equal(result.checkoutUrl, "https://usbarkrangers.lemonsqueezy.com/checkout/test-session");
    });

    it("returns only the hosted checkout URL for signed-in users", async () => {
        let captured = null;

        const result = await handleCreateCheckoutSession(
            {
                uid: "client-forged",
                variantId: "client-variant",
                price: "free",
                test_mode: false
            },
            authedContext("server-user", {
                email: "server-user@example.test",
                name: "Server User"
            }),
            {
                apiKey: config.apiKey,
                axiosPost: async (url, body, requestConfig) => {
                    captured = { url, body, requestConfig };
                    return {
                        data: {
                            data: {
                                attributes: {
                                    url: "https://usbarkrangers.lemonsqueezy.com/checkout/test-session"
                                }
                            }
                        }
                    };
                }
            }
        );

        assert.deepEqual(result, {
            checkoutUrl: "https://usbarkrangers.lemonsqueezy.com/checkout/test-session"
        });
        assert.equal(captured.url, "https://api.lemonsqueezy.com/v1/checkouts");
        assert.equal(captured.requestConfig.headers.Accept, "application/vnd.api+json");
        assert.equal(captured.requestConfig.headers["Content-Type"], "application/vnd.api+json");
        assert.equal(captured.requestConfig.headers.Authorization, "Bearer test-api-key");
        assert.equal(captured.body.data.attributes.test_mode, true);
        assert.deepEqual(captured.body.data.attributes.product_options.enabled_variants, [1604336]);
        assert.equal(captured.body.data.relationships.store.data.id, "363425");
        assert.equal(captured.body.data.relationships.variant.data.id, "1604336");
        assert.equal(captured.body.data.attributes.checkout_data.custom.firebase_uid, "server-user");
        assert.equal(captured.body.data.attributes.checkout_data.email, "server-user@example.test");
        assert.equal(captured.body.data.attributes.checkout_data.name, "Server User");
    });

    it("ignores client-provided uid, price, variant, and test mode", async () => {
        let capturedBody = null;

        await handleCreateCheckoutSession(
            {
                uid: "attacker",
                firebase_uid: "attacker",
                storeId: "1",
                variantId: "2",
                price: 0,
                test_mode: false
            },
            authedContext("trusted-uid"),
            {
                apiKey: config.apiKey,
                axiosPost: async (_url, body) => {
                    capturedBody = body;
                    return {
                        data: {
                            data: {
                                attributes: {
                                    url: "https://usbarkrangers.lemonsqueezy.com/checkout/test-session"
                                }
                            }
                        }
                    };
                }
            }
        );

        assert.equal(capturedBody.data.attributes.checkout_data.custom.firebase_uid, "trusted-uid");
        assert.equal(capturedBody.data.relationships.store.data.id, "363425");
        assert.equal(capturedBody.data.relationships.variant.data.id, "1604336");
        assert.deepEqual(capturedBody.data.attributes.product_options.enabled_variants, [1604336]);
        assert.equal(capturedBody.data.attributes.test_mode, true);
    });

    it("forces backend store, variant, and app URL even if options/env try to override them", async () => {
        let capturedBody = null;

        await handleCreateCheckoutSession(
            {},
            authedContext("forced-config-user"),
            {
                apiKey: config.apiKey,
                storeId: "wrong-store",
                annualVariantId: "wrong-variant",
                appBaseUrl: "https://example.invalid/wrong",
                env: {
                    LEMONSQUEEZY_API_KEY: "wrong-env-key",
                    LEMONSQUEEZY_STORE_ID: "wrong-env-store",
                    LEMONSQUEEZY_ANNUAL_VARIANT_ID: "wrong-env-variant",
                    APP_BASE_URL: "https://example.invalid/env"
                },
                axiosPost: async (_url, body) => {
                    capturedBody = body;
                    return {
                        data: {
                            data: {
                                attributes: {
                                    url: "https://usbarkrangers.lemonsqueezy.com/checkout/test-session"
                                }
                            }
                        }
                    };
                }
            }
        );

        assert.equal(capturedBody.data.relationships.store.data.id, "363425");
        assert.equal(capturedBody.data.relationships.variant.data.id, "1604336");
        assert.deepEqual(capturedBody.data.attributes.product_options.enabled_variants, [1604336]);
        assert.equal(
            capturedBody.data.attributes.product_options.redirect_url,
            "https://outswarming.github.io/bark-ranger-map/?checkout=success&provider=lemonsqueezy"
        );
        assert.equal(
            capturedBody.data.attributes.checkout_data.custom.cancel_url,
            "https://outswarming.github.io/bark-ranger-map/?checkout=canceled&provider=lemonsqueezy"
        );
    });

    it("fails closed when the Lemon Squeezy API key is missing", async () => {
        await assertRejectsCode(
            handleCreateCheckoutSession(
                {},
                authedContext("user-without-config"),
                {
                    env: {}
                }
            ),
            "failed-precondition"
        );
    });

    it("returns a safe error when Lemon Squeezy fails", async () => {
        await assertRejectsCode(
            handleCreateCheckoutSession(
                {},
                authedContext("api-failure-user"),
                {
                    apiKey: config.apiKey,
                    axiosPost: async () => {
                        const error = new Error("provider failed");
                        error.response = { status: 500, data: { secret: "do-not-leak" } };
                        throw error;
                    }
                }
            ),
            "internal"
        );
    });

    it("returns a safe error when Lemon Squeezy omits the checkout URL", async () => {
        await assertRejectsCode(
            handleCreateCheckoutSession(
                {},
                authedContext("invalid-response-user"),
                {
                    apiKey: config.apiKey,
                    axiosPost: async () => ({ data: { data: { attributes: {} } } })
                }
            ),
            "internal"
        );
    });

    it("does not write entitlement during checkout creation", async () => {
        let firestoreTouched = false;

        await handleCreateCheckoutSession(
            { entitlement: { premium: true, status: "active" } },
            authedContext("no-entitlement-write"),
            {
                apiKey: config.apiKey,
                firestore: {
                    collection() {
                        firestoreTouched = true;
                        throw new Error("checkout creation must not touch Firestore");
                    }
                },
                axiosPost: async () => ({
                    data: {
                        data: {
                            attributes: {
                                url: "https://usbarkrangers.lemonsqueezy.com/checkout/test-session"
                            }
                        }
                    }
                })
            }
        );

        assert.equal(firestoreTouched, false);
    });
});

describe("Lemon Squeezy customer portal callable", () => {
    it("rejects unauthenticated customer portal requests", async () => {
        await assertRejectsCode(
            handleGetCustomerPortalUrl({}, {}, {
                firestore: makeUserFirestore()
            }),
            "unauthenticated"
        );
    });

    it("rejects access-code users because they have no Lemon billing subscription", async () => {
        await assertRejectsCode(
            handleGetCustomerPortalUrl(
                {},
                authedContext("access-code-user"),
                {
                    firestore: makeUserFirestore({
                        entitlement: {
                            premium: true,
                            status: "access_code_active",
                            source: "access_code",
                            providerSubscriptionId: null
                        }
                    })
                }
            ),
            "failed-precondition"
        );
    });

    it("retrieves a signed customer_portal URL for Lemon subscription users", async () => {
        let captured = null;
        const firestore = makeUserFirestore({
            entitlement: {
                premium: true,
                status: "cancelled_active",
                source: "lemon_squeezy",
                providerSubscriptionId: "sub_test_123"
            }
        });

        const result = await handleGetCustomerPortalUrl(
            {},
            authedContext("paid-user"),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async (url, requestConfig) => {
                    captured = { url, requestConfig };
                    return {
                        data: {
                            data: {
                                attributes: {
                                    store_id: 363425,
                                    urls: {
                                        customer_portal: "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=test"
                                    }
                                }
                            }
                        }
                    };
                }
            }
        );

        assert.equal(firestore.state.requestedCollection, "users");
        assert.equal(firestore.state.requestedDoc, "paid-user");
        assert.equal(captured.url, "https://api.lemonsqueezy.com/v1/subscriptions/sub_test_123");
        assert.equal(captured.requestConfig.headers.Authorization, "Bearer test-api-key");
        assert.equal(
            result.url,
            "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=test"
        );
        assert.equal(
            result.customerPortalUrl,
            "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=test"
        );
    });

    it("falls back to the Lemon customer record when no subscription id is stored", async () => {
        let captured = null;
        const firestore = makeUserFirestore({
            lemonSqueezyCustomerId: "cus_test_123",
            entitlement: {
                premium: true,
                status: "active",
                source: "lemon_squeezy",
                providerSubscriptionId: null
            }
        });

        const result = await handleGetCustomerPortalUrl(
            {},
            authedContext("paid-user"),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async (url, requestConfig) => {
                    captured = { url, requestConfig };
                    return {
                        data: {
                            data: {
                                attributes: {
                                    store_id: 363425,
                                    urls: {
                                        customer_portal: "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=customer"
                                    }
                                }
                            }
                        }
                    };
                }
            }
        );

        assert.equal(captured.url, "https://api.lemonsqueezy.com/v1/customers/cus_test_123");
        assert.equal(captured.requestConfig.headers.Authorization, "Bearer test-api-key");
        assert.equal(
            result.url,
            "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=customer"
        );
        assert.equal(firestore.state.writes.length, 0);
    });

    it("rejects customer portal responses without a customer_portal URL", async () => {
        await assertRejectsCode(
            handleGetCustomerPortalUrl(
                {},
                authedContext("paid-user"),
                {
                    firestore: makeUserFirestore({
                        entitlement: {
                            premium: true,
                            status: "active",
                            source: "lemon_squeezy",
                            providerSubscriptionId: "sub_missing_portal"
                        }
                    }),
                    apiKey: config.apiKey,
                    axiosGet: async () => ({
                        data: {
                            data: {
                                attributes: {
                                    store_id: 363425,
                                    urls: {}
                                }
                            }
                        }
                    })
                }
            ),
            "failed-precondition"
        );
    });

    it("returns Lemon root portal responses so the frontend debug guard can show the exact URL", async () => {
        const result = await handleGetCustomerPortalUrl(
            {},
            authedContext("paid-user"),
            {
                firestore: makeUserFirestore({
                    entitlement: {
                        premium: true,
                        status: "active",
                        source: "lemon_squeezy",
                        providerSubscriptionId: "sub_root_portal"
                    }
                }),
                apiKey: config.apiKey,
                axiosGet: async () => ({
                    status: 200,
                    data: {
                        data: {
                            attributes: {
                                store_id: 363425,
                                urls: {
                                    customer_portal: "https://usbarkrangers.lemonsqueezy.com/"
                                }
                            }
                        }
                    }
                })
            }
        );

        assert.equal(result.url, "https://usbarkrangers.lemonsqueezy.com/");
    });

    it("syncs cancelled Lemon subscription state while retrieving a portal URL", async () => {
        const firestore = makeUserFirestore({
            entitlement: {
                premium: true,
                status: "active",
                source: "lemon_squeezy",
                providerSubscriptionId: "sub_cancelled_sync",
                lastProviderEventAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
                lastProviderEventRank: 100
            }
        });

        const result = await handleGetCustomerPortalUrl(
            {},
            authedContext("paid-user"),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async () => ({
                    data: {
                        data: {
                            id: "sub_cancelled_sync",
                            type: "subscriptions",
                            attributes: {
                                test_mode: true,
                                store_id: 363425,
                                status: "cancelled",
                                ends_at: "2099-02-01T00:00:00.000Z",
                                updated_at: "2026-01-10T00:00:00.000Z",
                                urls: {
                                    customer_portal: "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=cancelled"
                                }
                            }
                        }
                    }
                })
            }
        );

        assert.equal(result.entitlement.status, "cancelled_active");
        assert.equal(result.entitlement.premium, true);
        assert.equal(result.entitlement.currentPeriodEnd, "2099-02-01T00:00:00.000Z");
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "cancelled_active");
        assert.equal(firestore.state.eventWrites.length, 1);
    });

    it("syncs resumed Lemon subscription state while retrieving a portal URL", async () => {
        const firestore = makeUserFirestore({
            entitlement: {
                premium: true,
                status: "cancelled_active",
                source: "lemon_squeezy",
                providerSubscriptionId: "sub_resumed_sync",
                lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                lastProviderEventRank: 300
            }
        });

        const result = await handleGetCustomerPortalUrl(
            {},
            authedContext("paid-user"),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async () => ({
                    data: {
                        data: {
                            id: "sub_resumed_sync",
                            type: "subscriptions",
                            attributes: {
                                test_mode: true,
                                store_id: 363425,
                                status: "active",
                                renews_at: "2099-02-01T00:00:00.000Z",
                                updated_at: "2026-01-10T00:00:00.000Z",
                                urls: {
                                    customer_portal: "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=resumed"
                                }
                            }
                        }
                    }
                })
            }
        );

        assert.equal(result.entitlement.status, "active");
        assert.equal(result.entitlement.premium, true);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
        assert.equal(firestore.state.eventWrites.length, 1);
    });

    it("syncs paused Lemon subscription state while retrieving a portal URL", async () => {
        const firestore = makeUserFirestore({
            entitlement: {
                premium: true,
                status: "active",
                source: "lemon_squeezy",
                providerSubscriptionId: "sub_paused_sync",
                lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                lastProviderEventRank: 100
            }
        });

        const result = await handleGetCustomerPortalUrl(
            {},
            authedContext("paid-user"),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async () => ({
                    data: {
                        data: {
                            id: "sub_paused_sync",
                            type: "subscriptions",
                            attributes: {
                                test_mode: true,
                                store_id: 363425,
                                status: "paused",
                                renews_at: "2099-02-01T00:00:00.000Z",
                                updated_at: "2026-01-10T00:00:00.000Z",
                                urls: {
                                    customer_portal: "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=paused"
                                }
                            }
                        }
                    }
                })
            }
        );

        assert.equal(result.entitlement.status, "paused");
        assert.equal(result.entitlement.premium, true);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "paused");
        assert.equal(firestore.state.eventWrites.length, 1);
    });

    it("rejects customer portal responses from a different store", async () => {
        await assertRejectsCode(
            handleGetCustomerPortalUrl(
                {},
                authedContext("wrong-store-user"),
                {
                    firestore: makeUserFirestore({
                        entitlement: {
                            premium: true,
                            status: "active",
                            source: "lemon_squeezy",
                            providerSubscriptionId: "sub_wrong_store"
                        }
                    }),
                    apiKey: config.apiKey,
                    axiosGet: async () => ({
                        data: {
                            data: {
                                attributes: {
                                    store_id: 999,
                                    urls: {
                                        customer_portal: "https://example.lemonsqueezy.com/billing?signature=test"
                                    }
                                }
                            }
                        }
                    })
                }
            ),
            "permission-denied"
        );
    });
});

describe("Lemon Squeezy restore purchase callable", () => {
    it("restores active premium from the newest subscription for the signed-in email", async () => {
        const firestore = makeUserFirestore({
            entitlement: {
                premium: false,
                status: "refunded",
                source: "lemon_squeezy",
                providerOrderId: "order_old_refund",
                lastProviderEventAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
                lastProviderEventRank: 600
            }
        });
        let capturedUrl = null;

        const result = await handleRestorePremiumPurchase(
            {},
            authedContext("restore-user", {
                email: "ranger@example.test",
                email_verified: true,
                firebase: { sign_in_provider: "password" }
            }),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async (url) => {
                    capturedUrl = url;
                    return {
                        data: {
                            data: [
                                {
                                    id: "sub_restore_new",
                                    type: "subscriptions",
                                    attributes: {
                                        test_mode: true,
                                        store_id: 363425,
                                        variant_id: 1604336,
                                        customer_id: 7022381,
                                        user_email: "ranger@example.test",
                                        status: "active",
                                        renews_at: "2099-01-01T00:00:00.000Z",
                                        updated_at: "2026-01-12T00:00:00.000Z"
                                    }
                                }
                            ]
                        }
                    };
                },
                serverTimestamp: () => "SERVER_TIMESTAMP"
            }
        );

        const lookupUrl = new URL(capturedUrl);
        assert.equal(lookupUrl.searchParams.get("filter[user_email]"), "ranger@example.test");
        assert.equal(result.restored, true);
        assert.equal(result.entitlement.premium, true);
        assert.equal(result.entitlement.status, "active");
        assert.equal(result.entitlement.providerSubscriptionId, "sub_restore_new");
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.eventWrites.length, 1);
    });

    it("returns the existing entitlement when no active subscription can be restored", async () => {
        const existingEntitlement = {
            premium: false,
            status: "refunded",
            source: "lemon_squeezy",
            providerOrderId: "order_old_refund"
        };
        const firestore = makeUserFirestore({ entitlement: existingEntitlement });

        const result = await handleRestorePremiumPurchase(
            {},
            authedContext("restore-none-user", {
                email: "ranger@example.test",
                email_verified: true,
                firebase: { sign_in_provider: "password" }
            }),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async () => ({
                    data: {
                        data: [
                            {
                                id: "sub_restore_refunded",
                                type: "subscriptions",
                                attributes: {
                                    test_mode: true,
                                    store_id: 363425,
                                    variant_id: 1604336,
                                    user_email: "ranger@example.test",
                                    status: "refunded",
                                    updated_at: "2026-01-12T00:00:00.000Z"
                                }
                            }
                        ]
                    }
                })
            }
        );

        assert.equal(result.restored, false);
        assert.equal(result.entitlement.status, "refunded");
        assert.match(result.message, /No active Lemon Squeezy subscription/);
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites.length, 0);
    });

    it("restores active premium when Lemon currently shows the same refunded subscription as active", async () => {
        const firestore = makeUserFirestore({
            entitlement: {
                premium: false,
                status: "refunded",
                source: "lemon_squeezy",
                providerSubscriptionId: "sub_restore_same",
                lastProviderEventAtMs: Date.parse("2026-01-12T00:00:00.000Z"),
                lastProviderEventRank: 600
            }
        });

        const result = await handleRestorePremiumPurchase(
            {},
            authedContext("restore-same-user", {
                email: "ranger@example.test",
                email_verified: true,
                firebase: { sign_in_provider: "password" }
            }),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async () => ({
                    data: {
                        data: [
                            {
                                id: "sub_restore_same",
                                type: "subscriptions",
                                attributes: {
                                    test_mode: true,
                                    store_id: 363425,
                                    variant_id: 1604336,
                                    user_email: "ranger@example.test",
                                    status: "active",
                                    renews_at: "2099-01-01T00:00:00.000Z",
                                    updated_at: "2026-01-12T00:00:00.000Z"
                                }
                            }
                        ]
                    }
                }),
                serverTimestamp: () => "SERVER_TIMESTAMP"
            }
        );

        assert.equal(result.restored, true);
        assert.equal(result.entitlement.premium, true);
        assert.equal(result.entitlement.status, "active");
        assert.equal(result.entitlement.providerSubscriptionId, "sub_restore_same");
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.eventWrites.length, 1);
    });

    it("restores paused premium because Lemon still treats paused subscriptions as active access", async () => {
        const firestore = makeUserFirestore({
            entitlement: {
                premium: false,
                status: "free",
                source: "none"
            }
        });

        const result = await handleRestorePremiumPurchase(
            {},
            authedContext("restore-paused-user", {
                email: "ranger@example.test",
                email_verified: true,
                firebase: { sign_in_provider: "password" }
            }),
            {
                firestore,
                apiKey: config.apiKey,
                axiosGet: async () => ({
                    data: {
                        data: [
                            {
                                id: "sub_restore_paused",
                                type: "subscriptions",
                                attributes: {
                                    test_mode: true,
                                    store_id: 363425,
                                    variant_id: 1604336,
                                    user_email: "ranger@example.test",
                                    status: "paused",
                                    renews_at: "2099-01-01T00:00:00.000Z",
                                    updated_at: "2026-01-12T00:00:00.000Z"
                                }
                            }
                        ]
                    }
                }),
                serverTimestamp: () => "SERVER_TIMESTAMP"
            }
        );

        assert.equal(result.restored, true);
        assert.equal(result.entitlement.premium, true);
        assert.equal(result.entitlement.status, "paused");
        assert.equal(result.entitlement.providerSubscriptionId, "sub_restore_paused");
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.eventWrites.length, 1);
    });
});
