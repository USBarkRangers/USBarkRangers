const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        buildLemonSqueezyEventDocId,
        handleLemonSqueezyWebhook
    }
} = require("../index.js");

const webhookSecret = "test-webhook-secret";
const serverTimestampValue = "SERVER_TIMESTAMP";
const defaultProviderEventAt = "2026-01-01T00:00:00.000Z";
const defaultProviderEventAtMs = Date.parse(defaultProviderEventAt);

function makePayload({
    eventName = "subscription_created",
    uid = "user-a",
    dataType = "subscriptions",
    dataId = "sub_123",
    attributes = {},
    eventId = "evt_123"
} = {}) {
    const meta = {
        event_name: eventName,
        event_id: eventId,
        custom_data: {}
    };

    if (uid !== undefined) {
        meta.custom_data.firebase_uid = uid;
    }

    return {
        meta,
        data: {
            type: dataType,
            id: dataId,
            attributes: {
                test_mode: true,
                store_id: 363425,
                customer_id: 7022381,
                status: "active",
                renews_at: "2099-01-01T00:00:00.000Z",
                ...attributes
            }
        }
    };
}

function raw(payload) {
    return Buffer.from(JSON.stringify(payload), "utf8");
}

function sign(rawBody, secret = webhookSecret) {
    return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function makeReq({ method = "POST", payload, rawBody, signature, eventName } = {}) {
    const body = rawBody || raw(payload || makePayload());
    const headers = {};
    if (signature !== undefined) headers["x-signature"] = signature;
    if (eventName) headers["x-event-name"] = eventName;

    return {
        method,
        rawBody: body,
        headers,
        get(name) {
            return headers[name.toLowerCase()];
        }
    };
}

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        }
    };
}

function makeFirestore({ entitlement = null, exists = true, data = null, processedEvents = {} } = {}) {
    let userData = data || { entitlement };
    const eventDocs = new Map(
        Object.entries(processedEvents).map(([docId, value]) => [
            docId,
            value === true ? { processingStatus: "processed" } : value
        ])
    );
    const state = {
        reads: 0,
        userReads: 0,
        eventReads: 0,
        writes: [],
        eventWrites: [],
        requestedCollection: null,
        requestedDoc: null,
        lastEventDoc: null,
        transactions: 0
    };

    function makeSnapshot(collectionName, docId) {
        if (collectionName === "users") {
            return {
                exists,
                data: () => userData
            };
        }

        if (collectionName === "_lemonSqueezyWebhookEvents") {
            const stored = eventDocs.get(docId);
            return {
                exists: stored !== undefined,
                data: () => stored || {}
            };
        }

        return {
            exists: false,
            data: () => ({})
        };
    }

    function makeDocRef(collectionName, docId) {
        return {
            collectionName,
            docId,
            async get() {
                state.reads += 1;
                if (collectionName === "users") {
                    state.userReads += 1;
                    state.requestedCollection = collectionName;
                    state.requestedDoc = docId;
                } else if (collectionName === "_lemonSqueezyWebhookEvents") {
                    state.eventReads += 1;
                    state.lastEventDoc = docId;
                }

                return makeSnapshot(collectionName, docId);
            },
            async set(value, options = {}) {
                if (collectionName === "users") {
                    userData = options.merge ? { ...userData, ...value } : { ...value };
                    state.requestedCollection = collectionName;
                    state.requestedDoc = docId;
                    state.writes.push({ docId, data: value, options });
                    return;
                }

                if (collectionName === "_lemonSqueezyWebhookEvents") {
                    const previous = eventDocs.get(docId) || {};
                    const next = options.merge ? { ...previous, ...value } : { ...value };
                    eventDocs.set(docId, next);
                    state.lastEventDoc = docId;
                    state.eventWrites.push({ docId, data: value, options });
                }
            }
        };
    }

    return {
        state,
        collection(collectionName) {
            return {
                doc(docId) {
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

async function invoke({
    req,
    firestore = makeFirestore(),
    nowMs = Date.parse("2026-01-01T00:00:00.000Z"),
    options = {}
} = {}) {
    const res = makeRes();
    await handleLemonSqueezyWebhook(req, res, {
        webhookSecret,
        firestore,
        nowMs,
        serverTimestamp: () => serverTimestampValue,
        ...options
    });
    return { res, firestore };
}

function signedReq(payload) {
    const rawBody = raw(payload);
    return makeReq({ payload, rawBody, signature: sign(rawBody) });
}

function processedEventMap(...eventIds) {
    return Object.fromEntries(eventIds.map(eventId => [
        buildLemonSqueezyEventDocId(eventId),
        { processingStatus: "processed", providerEventId: eventId }
    ]));
}

describe("Lemon Squeezy webhook HTTP and signature verification", () => {
    it("rejects non-POST requests", async () => {
        const { res, firestore } = await invoke({
            req: makeReq({ method: "GET", signature: "unused" })
        });

        assert.equal(res.statusCode, 405);
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("rejects missing raw bodies", async () => {
        const req = makeReq({ signature: "unused" });
        delete req.rawBody;

        const { res, firestore } = await invoke({ req });

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, "missing_raw_body");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("rejects missing signatures", async () => {
        const { res, firestore } = await invoke({
            req: makeReq({ payload: makePayload() })
        });

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error, "missing_signature");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("rejects invalid signatures before writing", async () => {
        const { res, firestore } = await invoke({
            req: makeReq({ payload: makePayload(), signature: "not-valid" })
        });

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error, "invalid_signature");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("rejects malformed signature lengths safely", async () => {
        const { res, firestore } = await invoke({
            req: makeReq({ payload: makePayload(), signature: "sha256=abc" })
        });

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error, "invalid_signature");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("rejects malformed signature encodings safely", async () => {
        const { res, firestore } = await invoke({
            req: makeReq({ payload: makePayload(), signature: "z".repeat(64) })
        });

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error, "invalid_signature");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("does not parse JSON before signature verification", async () => {
        const invalidJson = Buffer.from("{not-json", "utf8");
        const { res, firestore } = await invoke({
            req: makeReq({ rawBody: invalidJson, signature: "not-valid" })
        });

        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error, "invalid_signature");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("returns a safe error for malformed JSON after valid signature", async () => {
        const invalidJson = Buffer.from("{not-json", "utf8");
        const { res, firestore } = await invoke({
            req: makeReq({ rawBody: invalidJson, signature: sign(invalidJson) })
        });

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, "invalid_json");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("fails safely when the webhook secret is missing", async () => {
        const payload = makePayload({ eventId: "evt_missing_secret" });
        const rawBody = raw(payload);
        const req = makeReq({ rawBody, signature: sign(rawBody) });
        const res = makeRes();
        const firestore = makeFirestore();

        await handleLemonSqueezyWebhook(req, res, {
            env: {},
            firestore,
            serverTimestamp: () => serverTimestampValue
        });

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.error, "webhook_not_configured");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("uses the exact raw body bytes for HMAC verification", async () => {
        const payload = makePayload({
            uid: "raw-body-user",
            eventId: "evt_raw_body"
        });
        const rawBody = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
        const badSignature = sign(raw(payload));
        const rejected = await invoke({
            req: makeReq({ rawBody, signature: badSignature })
        });

        assert.equal(rejected.res.statusCode, 401);
        assert.equal(rejected.firestore.state.writes.length, 0);

        const accepted = await invoke({
            req: makeReq({ rawBody, signature: sign(rawBody) })
        });

        assert.equal(accepted.res.statusCode, 200);
        assert.equal(accepted.firestore.state.writes.length, 1);
        assert.equal(accepted.firestore.state.requestedDoc, "raw-body-user");
    });
});

describe("Lemon Squeezy webhook entitlement mapping", () => {
    it("writes premium active for active subscription_created", async () => {
        const payload = makePayload({
            eventName: "subscription_created",
            uid: "active-user",
            eventId: "evt_active_created",
            attributes: { status: "active" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.requestedCollection, "users");
        assert.equal(firestore.state.requestedDoc, "active-user");
        assert.equal(firestore.state.writes.length, 1);
        assert.deepEqual(firestore.state.writes[0].data.entitlement, {
            premium: true,
            status: "active",
            source: "lemon_squeezy",
            providerMode: "test",
            providerStatus: "active",
            providerCustomerId: "7022381",
            providerSubscriptionId: "sub_123",
            providerOrderId: null,
            currentPeriodEnd: "2099-01-01T00:00:00.000Z",
            updatedAt: serverTimestampValue,
            lastProviderEventId: "evt_active_created",
            lastProviderEventName: "subscription_created",
            lastProviderEventAt: defaultProviderEventAt,
            lastProviderEventAtMs: defaultProviderEventAtMs,
            lastProviderEventRank: 100
        });
        assert.deepEqual(firestore.state.writes[0].options, { merge: true });
        assert.equal(firestore.state.eventWrites.length, 1);
        assert.equal(firestore.state.eventWrites[0].data.processingStatus, "processed");
        assert.equal(firestore.state.eventWrites[0].data.providerEventId, "evt_active_created");
    });

    it("writes premium active for active subscription_updated", async () => {
        const payload = makePayload({
            eventName: "subscription_updated",
            uid: "updated-user",
            eventId: "evt_active_updated",
            attributes: { status: "active" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
        assert.equal(firestore.state.writes[0].data.entitlement.lastProviderEventId, "evt_active_updated");
    });

    it("writes premium active for on_trial subscription_created", async () => {
        const payload = makePayload({
            eventName: "subscription_created",
            uid: "trial-user",
            eventId: "evt_trial_created",
            attributes: { status: "on_trial" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("writes premium paused for subscription_paused", async () => {
        const payload = makePayload({
            eventName: "subscription_paused",
            uid: "paused-user",
            eventId: "evt_subscription_paused",
            attributes: { status: "paused" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "paused");
        assert.equal(firestore.state.writes[0].data.entitlement.lastProviderEventRank, 150);
    });

    it("writes premium active for subscription_unpaused", async () => {
        const payload = makePayload({
            eventName: "subscription_unpaused",
            uid: "unpaused-user",
            eventId: "evt_subscription_unpaused",
            attributes: { status: "active" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("writes premium active for subscription_plan_changed on the supported variant", async () => {
        const payload = makePayload({
            eventName: "subscription_plan_changed",
            uid: "plan-changed-user",
            eventId: "evt_subscription_plan_changed",
            attributes: {
                status: "active",
                variant_id: 1604336
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("writes premium active for subscription_payment_success", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_success",
            uid: "payment-success-user",
            dataType: "subscription-invoices",
            dataId: "invoice_1",
            eventId: "evt_payment_success",
            attributes: {
                status: "paid",
                subscription_id: 12345,
                order_id: 98765
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
        assert.equal(firestore.state.writes[0].data.entitlement.providerSubscriptionId, "12345");
        assert.equal(firestore.state.writes[0].data.entitlement.providerOrderId, "98765");
    });

    it("writes premium active for subscription_payment_recovered", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_recovered",
            uid: "payment-recovered-user",
            dataType: "subscription-invoices",
            dataId: "invoice_recovered",
            eventId: "evt_payment_recovered",
            attributes: {
                status: "paid",
                subscription_id: "sub_recovered"
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("writes premium active for subscription_resumed active", async () => {
        const payload = makePayload({
            eventName: "subscription_resumed",
            uid: "resumed-user",
            eventId: "evt_subscription_resumed",
            attributes: { status: "active" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("lets subscription_resumed reactivate a same-time canceled subscription", async () => {
        const payload = makePayload({
            eventName: "subscription_resumed",
            uid: "same-time-resumed-user",
            dataId: "sub_resume_same_time",
            eventId: "evt_subscription_resumed_same_time",
            attributes: { status: "active" }
        });
        payload.meta.event_created_at = "2026-01-10T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "canceled",
                    source: "lemon_squeezy",
                    providerSubscriptionId: "sub_resume_same_time",
                    lastProviderEventId: "evt_cancelled_same_time",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 400
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("lets subscription_unpaused reactivate a same-time paused subscription", async () => {
        const payload = makePayload({
            eventName: "subscription_unpaused",
            uid: "same-time-unpaused-user",
            dataId: "sub_unpause_same_time",
            eventId: "evt_subscription_unpaused_same_time",
            attributes: { status: "active" }
        });
        payload.meta.event_created_at = "2026-01-10T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "paused",
                    source: "lemon_squeezy",
                    providerSubscriptionId: "sub_unpause_same_time",
                    lastProviderEventId: "evt_paused_same_time",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 150
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("writes non-premium expired for subscription_expired", async () => {
        const payload = makePayload({
            eventName: "subscription_expired",
            uid: "expired-user",
            eventId: "evt_expired",
            attributes: { status: "expired", ends_at: "2025-01-01T00:00:00.000Z" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, false);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "expired");
    });

    it("writes non-premium expired for subscription_updated expired", async () => {
        const payload = makePayload({
            eventName: "subscription_updated",
            uid: "updated-expired-user",
            eventId: "evt_updated_expired",
            attributes: { status: "expired", ends_at: "2025-01-01T00:00:00.000Z" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, false);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "expired");
    });

    it("keeps premium active in past_due grace for subscription_payment_failed", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_failed",
            uid: "past-due-user",
            eventId: "evt_payment_failed",
            dataType: "subscription-invoices",
            dataId: "invoice_2",
            attributes: { status: "failed", subscription_id: "sub_failed" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "past_due");
        assert.equal(firestore.state.writes[0].data.entitlement.lastProviderEventRank, 200);
    });

    it("keeps premium active in past_due grace for subscription_updated past_due", async () => {
        const payload = makePayload({
            eventName: "subscription_updated",
            uid: "updated-past-due-user",
            eventId: "evt_updated_past_due",
            attributes: { status: "past_due" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "past_due");
    });

    it("keeps premium active in past_due grace for subscription_updated unpaid", async () => {
        const payload = makePayload({
            eventName: "subscription_updated",
            uid: "updated-unpaid-user",
            eventId: "evt_updated_unpaid",
            attributes: { status: "unpaid" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "past_due");
    });

    it("keeps canceled subscriptions active until future ends_at", async () => {
        const payload = makePayload({
            eventName: "subscription_cancelled",
            uid: "cancelled-user",
            eventId: "evt_cancelled_future",
            attributes: {
                status: "cancelled",
                ends_at: "2099-02-01T00:00:00.000Z",
                renews_at: null,
                urls: {
                    customer_portal: "https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=test"
                }
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "cancelled_active");
        assert.equal(firestore.state.writes[0].data.entitlement.currentPeriodEnd, "2099-02-01T00:00:00.000Z");
        assert.equal(firestore.state.writes[0].data.entitlement.customerPortalUrl, undefined);
        assert.equal(firestore.state.writes[0].data.entitlement.lastProviderEventRank, 300);
    });

    it("maps canceled subscriptions without a future period to non-premium canceled", async () => {
        const payload = makePayload({
            eventName: "subscription_cancelled",
            uid: "cancelled-ended-user",
            eventId: "evt_cancelled_ended",
            attributes: {
                status: "cancelled",
                ends_at: "2025-02-01T00:00:00.000Z",
                renews_at: null
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, false);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "canceled");
    });

    it("maps refunded subscription payments to refunded non-premium status", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_refunded",
            uid: "refunded-user",
            eventId: "evt_refunded",
            dataType: "subscription-invoices",
            dataId: "invoice_3",
            attributes: { status: "refunded", subscription_id: "sub_refunded" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, false);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "refunded");
        assert.equal(firestore.state.writes[0].data.entitlement.lastProviderEventRank, 600);
    });

    it("maps refunded orders to refunded non-premium status", async () => {
        const payload = makePayload({
            eventName: "order_refunded",
            uid: "order-refunded-user",
            eventId: "evt_order_refunded",
            dataType: "orders",
            dataId: "order_1",
            attributes: { status: "refunded" }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, false);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "refunded");
        assert.equal(firestore.state.writes[0].data.entitlement.providerOrderId, "order_1");
    });
});

describe("Lemon Squeezy webhook ignored and idempotent paths", () => {
    it("writes nothing when firebase_uid is missing", async () => {
        const payload = makePayload({
            uid: null,
            eventId: "evt_missing_uid"
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ignored, true);
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("writes nothing when firebase_uid is empty", async () => {
        const payload = makePayload({
            uid: "",
            eventId: "evt_empty_uid"
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "missing_uid");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("writes nothing when firebase_uid is not a string", async () => {
        const payload = makePayload({
            uid: 12345,
            eventId: "evt_numeric_uid"
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "missing_uid");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("writes nothing when firebase_uid contains a path separator", async () => {
        const payload = makePayload({
            uid: "users/victim",
            eventId: "evt_path_uid"
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "missing_uid");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("uses X-Event-Name only when meta.event_name is absent", async () => {
        const payload = makePayload({
            eventName: "subscription_created",
            uid: "header-event-user",
            eventId: "evt_header_event"
        });
        delete payload.meta.event_name;
        const rawBody = raw(payload);
        const req = makeReq({
            rawBody,
            signature: sign(rawBody),
            eventName: "subscription_created"
        });
        const { res, firestore } = await invoke({ req });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.requestedDoc, "header-event-user");
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("prefers meta.event_name over X-Event-Name when both are present", async () => {
        const payload = makePayload({
            eventName: "customer_updated",
            uid: "meta-priority-user",
            eventId: "evt_meta_priority"
        });
        const rawBody = raw(payload);
        const req = makeReq({
            rawBody,
            signature: sign(rawBody),
            eventName: "subscription_created"
        });
        const { res, firestore } = await invoke({ req });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "unsupported_event");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("does not trust email or relationship identifiers as Firebase UID", async () => {
        const payload = makePayload({
            uid: "custom-data-user",
            eventId: "evt_uid_authority",
            attributes: {
                user_email: "victim@example.test",
                customer_email: "victim@example.test",
                subscription_id: "sub_uid_authority"
            }
        });
        payload.data.relationships = {
            user: {
                data: {
                    id: "relationship-user"
                }
            }
        };
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.requestedDoc, "custom-data-user");
        assert.equal(firestore.state.writes.length, 1);
    });

    it("ignores signed events for a different store", async () => {
        const payload = makePayload({
            uid: "wrong-store-user",
            eventId: "evt_wrong_store",
            attributes: {
                store_id: 1,
                status: "active"
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "store_mismatch");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("ignores signed test-mode events for a different variant when the provider includes one", async () => {
        const payload = makePayload({
            uid: "wrong-variant-user",
            eventId: "evt_wrong_variant",
            attributes: {
                variant_id: 999999,
                status: "active"
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "variant_mismatch");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("ignores signed live-mode payloads during test-mode phase", async () => {
        const payload = makePayload({
            uid: "live-mode-user",
            eventId: "evt_live_mode",
            attributes: {
                test_mode: false,
                status: "active"
            }
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "non_test_mode");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("accepts signed live-mode payloads only when live mode is explicitly approved", async () => {
        const payload = makePayload({
            uid: "approved-live-user",
            eventId: "evt_approved_live_mode",
            attributes: {
                test_mode: false,
                store_id: 999001,
                variant_id: 888002,
                status: "active"
            }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            options: {
                env: {
                    BARK_LEMON_MODE: "live",
                    BARK_LEMON_LIVE_MODE_APPROVAL: "CARTER_APPROVED_LIVE_RC",
                    BARK_LEMONSQUEEZY_STORE_ID: "999001",
                    BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID: "888002",
                    BARK_APP_BASE_URL: "https://barkranger.example/"
                }
            }
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
        assert.equal(firestore.state.writes[0].data.entitlement.providerMode, "live");
    });

    it("ignores old signed test-mode payloads after live mode is approved", async () => {
        const payload = makePayload({
            uid: "old-test-mode-user",
            eventId: "evt_old_test_mode_after_live",
            attributes: {
                test_mode: true,
                store_id: 999001,
                variant_id: 888002,
                status: "active"
            }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            options: {
                env: {
                    BARK_LEMON_MODE: "live",
                    BARK_LEMON_LIVE_MODE_APPROVAL: "CARTER_APPROVED_LIVE_RC",
                    BARK_LEMONSQUEEZY_STORE_ID: "999001",
                    BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID: "888002",
                    BARK_APP_BASE_URL: "https://barkranger.example/"
                }
            }
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "non_test_mode");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("rejects live-mode payloads for the old test store when live config uses a different store", async () => {
        const payload = makePayload({
            uid: "wrong-live-store-user",
            eventId: "evt_wrong_live_store",
            attributes: {
                test_mode: false,
                store_id: 363425,
                variant_id: 888002,
                status: "active"
            }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            options: {
                env: {
                    BARK_LEMON_MODE: "live",
                    BARK_LEMON_LIVE_MODE_APPROVAL: "CARTER_APPROVED_LIVE_RC",
                    BARK_LEMONSQUEEZY_STORE_ID: "999001",
                    BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID: "888002",
                    BARK_APP_BASE_URL: "https://barkranger.example/"
                }
            }
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "store_mismatch");
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("writes nothing for unknown signed events", async () => {
        const payload = makePayload({
            eventName: "customer_updated",
            uid: "known-user",
            eventId: "evt_unknown"
        });
        const { res, firestore } = await invoke({ req: signedReq(payload) });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ignored, true);
        assert.equal(firestore.state.reads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("ignores duplicate event IDs", async () => {
        const payload = makePayload({
            uid: "duplicate-user",
            eventId: "evt_duplicate"
        });
        const existing = {
            premium: true,
            status: "active",
            source: "lemon_squeezy",
            lastProviderEventId: "evt_duplicate"
        };
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: existing,
                processedEvents: processedEventMap("evt_duplicate")
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.duplicate, true);
        assert.equal(firestore.state.eventReads, 1);
        assert.equal(firestore.state.userReads, 0);
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites.length, 0);
    });

    it("ignores repeated expired events with the same event ID", async () => {
        const payload = makePayload({
            eventName: "subscription_expired",
            uid: "duplicate-expired-user",
            eventId: "evt_duplicate_expired",
            attributes: { status: "expired" }
        });
        const existing = {
            premium: false,
            status: "expired",
            source: "lemon_squeezy",
            lastProviderEventId: "evt_duplicate_expired"
        };
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: existing,
                processedEvents: processedEventMap("evt_duplicate_expired")
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.duplicate, true);
        assert.equal(firestore.state.userReads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("ignores repeated past_due events with the same event ID", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_failed",
            uid: "duplicate-past-due-user",
            eventId: "evt_duplicate_past_due",
            attributes: { status: "failed" }
        });
        const existing = {
            premium: true,
            status: "past_due",
            source: "lemon_squeezy",
            lastProviderEventId: "evt_duplicate_past_due"
        };
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: existing,
                processedEvents: processedEventMap("evt_duplicate_past_due")
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.duplicate, true);
        assert.equal(firestore.state.userReads, 0);
        assert.equal(firestore.state.writes.length, 0);
    });

    it("derives a stable event ID when provider event ID is absent", async () => {
        const payload = makePayload({
            uid: "derived-event-user",
            eventId: undefined
        });
        delete payload.meta.event_id;

        const firstRawBody = raw(payload);
        const firstReq = makeReq({ rawBody: firstRawBody, signature: sign(firstRawBody) });
        const firstResult = await invoke({ req: firstReq });
        const writtenId = firstResult.firestore.state.writes[0].data.entitlement.lastProviderEventId;
        const writtenEventDocId = firstResult.firestore.state.eventWrites[0].docId;

        const secondRawBody = raw(payload);
        const secondReq = makeReq({ rawBody: secondRawBody, signature: sign(secondRawBody) });
        const secondResult = await invoke({
            req: secondReq,
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "active",
                    source: "lemon_squeezy",
                    lastProviderEventId: writtenId
                },
                processedEvents: {
                    [writtenEventDocId]: { processingStatus: "processed", providerEventId: writtenId }
                }
            })
        });

        assert.match(writtenId, /^derived_[0-9a-f]{64}$/);
        assert.equal(secondResult.res.body.duplicate, true);
        assert.equal(secondResult.firestore.state.writes.length, 0);
    });

    it("ignores older provider events that would downgrade a newer active entitlement", async () => {
        const payload = makePayload({
            eventName: "subscription_expired",
            uid: "stale-expired-user",
            eventId: "evt_stale_expired",
            attributes: { status: "expired", ends_at: "2026-01-05T00:00:00.000Z" }
        });
        payload.meta.event_created_at = "2026-01-05T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "active",
                    source: "lemon_squeezy",
                    lastProviderEventId: "evt_newer_active",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 100
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ignored, true);
        assert.equal(res.body.reason, "stale_event");
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites.length, 1);
        assert.equal(firestore.state.eventWrites[0].data.processingStatus, "ignored");
        assert.equal(firestore.state.eventWrites[0].data.reason, "stale_event");
    });

    it("allows a newer refund to override an active entitlement", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_refunded",
            uid: "newer-refund-user",
            eventId: "evt_newer_refund",
            dataType: "subscription-invoices",
            dataId: "invoice_newer_refund",
            attributes: { status: "refunded", subscription_id: "sub_refund_newer" }
        });
        payload.meta.event_created_at = "2026-01-10T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "active",
                    source: "lemon_squeezy",
                    lastProviderEventId: "evt_old_active",
                    lastProviderEventAtMs: Date.parse("2026-01-05T00:00:00.000Z"),
                    lastProviderEventRank: 100
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, false);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "refunded");
        assert.equal(firestore.state.writes[0].data.entitlement.lastProviderEventAtMs, Date.parse("2026-01-10T00:00:00.000Z"));
        assert.equal(firestore.state.eventWrites[0].data.processingStatus, "processed");
    });

    it("does not reactivate a refunded account from an older active event", async () => {
        const payload = makePayload({
            eventName: "subscription_updated",
            uid: "late-active-after-refund-user",
            eventId: "evt_late_active_after_refund",
            attributes: { status: "active" }
        });
        payload.meta.event_created_at = "2026-01-05T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "refunded",
                    source: "lemon_squeezy",
                    lastProviderEventId: "evt_refund_current",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 600
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "stale_event");
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites[0].data.reason, "stale_event");
    });

    it("does not replace a refunded subscription with a later expired event for the same subscription", async () => {
        const payload = makePayload({
            eventName: "subscription_expired",
            uid: "expired-after-refund-user",
            eventId: "evt_expired_after_refund",
            dataId: "sub_refund_terminal",
            attributes: {
                status: "expired",
                ends_at: "2026-01-11T00:00:00.000Z"
            }
        });
        payload.meta.event_created_at = "2026-01-11T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "refunded",
                    source: "lemon_squeezy",
                    providerSubscriptionId: "sub_refund_terminal",
                    lastProviderEventId: "evt_refund_current",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 600
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "stale_event");
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites[0].data.reason, "stale_event");
    });

    it("allows a newer active purchase after a refund when the subscription is different", async () => {
        const payload = makePayload({
            eventName: "subscription_created",
            uid: "new-sub-after-refund-user",
            eventId: "evt_new_sub_after_refund",
            dataId: "sub_new_after_refund",
            attributes: {
                status: "active",
                order_id: "order_new_after_refund"
            }
        });
        payload.meta.event_created_at = "2026-01-12T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "refunded",
                    source: "lemon_squeezy",
                    providerSubscriptionId: "sub_refunded_old",
                    providerOrderId: "order_refunded_old",
                    lastProviderEventId: "evt_refund_current",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 600
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
        assert.equal(firestore.state.writes[0].data.entitlement.providerSubscriptionId, "sub_new_after_refund");
    });

    it("allows a newer active purchase after an order-only refund", async () => {
        const payload = makePayload({
            eventName: "subscription_created",
            uid: "new-sub-after-order-refund-user",
            eventId: "evt_new_sub_after_order_refund",
            dataId: "sub_new_after_order_refund",
            attributes: {
                status: "active",
                order_id: "order_new_after_order_refund"
            }
        });
        payload.meta.event_created_at = "2026-01-12T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "refunded",
                    source: "lemon_squeezy",
                    providerOrderId: "order_refunded_old",
                    lastProviderEventId: "evt_order_refund_current",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 600
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
        assert.equal(firestore.state.writes[0].data.entitlement.providerSubscriptionId, "sub_new_after_order_refund");
    });

    it("does not reactivate a refunded purchase from a later event with the same order", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_success",
            uid: "same-order-after-refund-user",
            eventId: "evt_same_order_after_refund",
            dataType: "subscription-invoices",
            dataId: "invoice_same_order_after_refund",
            attributes: {
                status: "paid",
                subscription_id: "sub_same_order_after_refund",
                order_id: "order_refunded_same"
            }
        });
        payload.meta.event_created_at = "2026-01-12T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "refunded",
                    source: "lemon_squeezy",
                    providerOrderId: "order_refunded_same",
                    lastProviderEventId: "evt_order_refund_current",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 600
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "stale_event");
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites[0].data.reason, "stale_event");
    });

    it("allows explicit subscription_resumed to reactivate the same subscription after refund", async () => {
        const payload = makePayload({
            eventName: "subscription_resumed",
            uid: "resume-same-sub-after-refund-user",
            eventId: "evt_resume_same_sub_after_refund",
            dataId: "sub_refunded_resume",
            attributes: { status: "active" }
        });
        payload.meta.event_created_at = "2026-01-12T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "refunded",
                    source: "lemon_squeezy",
                    providerSubscriptionId: "sub_refunded_resume",
                    lastProviderEventId: "evt_refund_current",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 600
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
    });

    it("uses status rank to reject lower-priority same-time events", async () => {
        const payload = makePayload({
            eventName: "subscription_updated",
            uid: "same-time-rank-user",
            eventId: "evt_same_time_active",
            attributes: { status: "active" }
        });
        payload.meta.event_created_at = "2026-01-10T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: false,
                    status: "refunded",
                    source: "lemon_squeezy",
                    lastProviderEventId: "evt_same_time_refund",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 600
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "stale_event");
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites[0].data.reason, "stale_event");
    });

    it("allows newer recovered payments to restore active access from past_due", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_recovered",
            uid: "payment-recovered-after-past-due-user",
            eventId: "evt_recovered_after_past_due",
            dataType: "subscription-invoices",
            dataId: "invoice_recovered_after_past_due",
            attributes: { status: "paid", subscription_id: "sub_recovered_after_past_due" }
        });
        payload.meta.event_created_at = "2026-01-11T00:00:00.000Z";

        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "past_due",
                    source: "lemon_squeezy",
                    lastProviderEventId: "evt_past_due_current",
                    lastProviderEventAtMs: Date.parse("2026-01-10T00:00:00.000Z"),
                    lastProviderEventRank: 200
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        assert.equal(firestore.state.writes[0].data.entitlement.premium, true);
        assert.equal(firestore.state.writes[0].data.entitlement.status, "active");
        assert.equal(firestore.state.writes[0].data.entitlement.lastProviderEventName, "subscription_payment_recovered");
    });

    it("does not downgrade manual_active admin overrides", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_failed",
            uid: "manual-user",
            eventId: "evt_manual_override",
            attributes: { status: "failed" }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "manual_active",
                    source: "admin_override",
                    manualOverride: true
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "manual_override");
        assert.equal(firestore.state.writes.length, 0);
    });

    it("does not downgrade manual_active admin overrides with expired events", async () => {
        const payload = makePayload({
            eventName: "subscription_expired",
            uid: "manual-expired-user",
            eventId: "evt_manual_expired",
            attributes: { status: "expired" }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "manual_active",
                    source: "admin_override",
                    manualOverride: true
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "manual_override");
        assert.equal(firestore.state.writes.length, 0);
    });

    it("does not downgrade manual_active admin overrides with refunded events", async () => {
        const payload = makePayload({
            eventName: "subscription_payment_refunded",
            uid: "manual-refunded-user",
            eventId: "evt_manual_refunded",
            attributes: { status: "refunded" }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "manual_active",
                    source: "admin_override",
                    manualOverride: true
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "manual_override");
        assert.equal(firestore.state.writes.length, 0);
    });

    it("does not erase manual_active admin override metadata with active events", async () => {
        const payload = makePayload({
            eventName: "subscription_updated",
            uid: "manual-active-user",
            eventId: "evt_manual_active",
            attributes: { status: "active" }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "manual_active",
                    source: "admin_override",
                    manualOverride: true,
                    note: "comped"
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "manual_override");
        assert.equal(firestore.state.writes.length, 0);
    });

    it("does not downgrade active access_code premium with Lemon expired events", async () => {
        const payload = makePayload({
            eventName: "subscription_expired",
            uid: "access-code-expired-event-user",
            eventId: "evt_access_code_expired_event",
            attributes: { status: "expired" }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "access_code_active",
                    source: "access_code",
                    accessCodeType: "premium_free_year",
                    accessCodeAudience: "support",
                    expiresAt: "2099-01-01T00:00:00.000Z",
                    autoRenew: false,
                    paymentMethodAttached: false
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "active_access_code_preserved");
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites[0].data.reason, "active_access_code_preserved");
    });

    it("does not downgrade active access_code premium with Lemon cancellation events", async () => {
        const payload = makePayload({
            eventName: "subscription_cancelled",
            uid: "access-code-cancel-event-user",
            eventId: "evt_access_code_cancel_event",
            attributes: {
                status: "cancelled",
                ends_at: "2025-01-01T00:00:00.000Z"
            }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "access_code_active",
                    source: "access_code",
                    accessCodeType: "premium_free_year",
                    accessCodeAudience: "support",
                    expiresAt: "2099-01-01T00:00:00.000Z",
                    autoRenew: false,
                    paymentMethodAttached: false
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.reason, "active_access_code_preserved");
        assert.equal(firestore.state.writes.length, 0);
        assert.equal(firestore.state.eventWrites[0].data.reason, "active_access_code_preserved");
    });

    it("keeps access_code fallback when active Lemon subscription starts", async () => {
        const payload = makePayload({
            eventName: "subscription_created",
            uid: "access-code-paid-user",
            eventId: "evt_access_code_paid_active",
            attributes: { status: "active", subscription_id: "sub_paid_access_code" }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "access_code_active",
                    source: "access_code",
                    accessCodeType: "premium_free_year",
                    accessCodeAudience: "vip",
                    reason: "VIP access",
                    expiresAt: "2099-01-01T00:00:00.000Z",
                    autoRenew: false,
                    paymentMethodAttached: false
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        const entitlement = firestore.state.writes[0].data.entitlement;
        assert.equal(entitlement.source, "lemon_squeezy");
        assert.equal(entitlement.status, "active");
        assert.equal(entitlement.accessCodeFallback.source, "access_code");
        assert.equal(entitlement.accessCodeFallback.accessCodeAudience, "vip");
    });

    it("restores active access_code fallback when Lemon subscription later expires", async () => {
        const payload = makePayload({
            eventName: "subscription_expired",
            uid: "access-code-fallback-user",
            eventId: "evt_access_code_fallback_expired",
            attributes: { status: "expired", subscription_id: "sub_access_code_fallback" }
        });
        const { res, firestore } = await invoke({
            req: signedReq(payload),
            firestore: makeFirestore({
                entitlement: {
                    premium: true,
                    status: "active",
                    source: "lemon_squeezy",
                    providerSubscriptionId: "sub_access_code_fallback",
                    accessCodeFallback: {
                        premium: true,
                        status: "access_code_active",
                        source: "access_code",
                        accessCodeType: "premium_free_year",
                        accessCodeAudience: "tester",
                        reason: "Tester access",
                        expiresAt: "2099-01-01T00:00:00.000Z",
                        autoRenew: false,
                        paymentMethodAttached: false,
                        manualOverride: true
                    }
                }
            })
        });

        assert.equal(res.statusCode, 200);
        assert.equal(firestore.state.writes.length, 1);
        const entitlement = firestore.state.writes[0].data.entitlement;
        assert.equal(entitlement.source, "access_code");
        assert.equal(entitlement.status, "access_code_active");
        assert.equal(entitlement.premium, true);
        assert.equal(entitlement.restoredFromAccessCodeFallback, true);
    });
});
