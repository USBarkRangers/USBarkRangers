const assert = require("node:assert/strict");
const { describe, it, afterEach } = require("node:test");

process.env.NODE_ENV = "test";

const functions = require("firebase-functions");

const {
    __test: {
        shouldAlertOnPaymentError,
        extractAlertIdentity,
        buildPaymentAlertPayload,
        deliverPaymentAlert,
        wrapCallableWithPaymentAlert,
        setPaymentAlertEmailSender
    }
} = require("../index.js");

function httpsError(code, message = "boom") {
    return new functions.https.HttpsError(code, message);
}

afterEach(() => {
    // Never leak a stubbed sender between tests.
    setPaymentAlertEmailSender(null);
});

describe("shouldAlertOnPaymentError", () => {
    it("alerts on unexpected non-HttpsError crashes", () => {
        assert.equal(shouldAlertOnPaymentError(new Error("kaboom")), true);
    });

    it("alerts on server-fault HttpsError codes", () => {
        assert.equal(shouldAlertOnPaymentError(httpsError("internal")), true);
        assert.equal(shouldAlertOnPaymentError(httpsError("unavailable")), true);
        assert.equal(shouldAlertOnPaymentError(httpsError("deadline-exceeded")), true);
    });

    it("does NOT alert on client-fault HttpsError codes", () => {
        assert.equal(shouldAlertOnPaymentError(httpsError("unauthenticated")), false);
        assert.equal(shouldAlertOnPaymentError(httpsError("permission-denied")), false);
        assert.equal(shouldAlertOnPaymentError(httpsError("resource-exhausted")), false);
        assert.equal(shouldAlertOnPaymentError(httpsError("failed-precondition")), false);
        assert.equal(shouldAlertOnPaymentError(httpsError("invalid-argument")), false);
    });

    it("does not alert on a missing error", () => {
        assert.equal(shouldAlertOnPaymentError(null), false);
    });
});

describe("extractAlertIdentity", () => {
    it("pulls uid and email from an authed context", () => {
        const identity = extractAlertIdentity({ auth: { uid: "u1", token: { email: "a@b.com" } } });
        assert.deepEqual(identity, { uid: "u1", email: "a@b.com" });
    });

    it("is safe when there is no auth", () => {
        assert.deepEqual(extractAlertIdentity({}), { uid: null, email: null });
        assert.deepEqual(extractAlertIdentity(undefined), { uid: null, email: null });
    });
});

describe("buildPaymentAlertPayload", () => {
    it("captures function name, identity, error, and extras", () => {
        const payload = buildPaymentAlertPayload(
            "createCheckoutSession",
            httpsError("internal", "explode"),
            { uid: "u1", email: "a@b.com" },
            { eventName: "order_created", critical: true }
        );
        assert.equal(payload.fn, "createCheckoutSession");
        assert.equal(payload.uid, "u1");
        assert.equal(payload.email, "a@b.com");
        assert.equal(payload.errorMessage, "explode");
        assert.equal(payload.eventName, "order_created");
        assert.equal(payload.critical, true);
        assert.ok(payload.timestamp);
    });
});

describe("deliverPaymentAlert", () => {
    it("invokes the injected email sender with the payload", async () => {
        const sent = [];
        const result = await deliverPaymentAlert(
            { fn: "restorePremiumPurchase", errorMessage: "x" },
            { emailSender: async (p) => { sent.push(p); } }
        );
        assert.equal(result.emailed, true);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].fn, "restorePremiumPurchase");
    });

    it("logs-only (no throw) when no sender is configured", async () => {
        const result = await deliverPaymentAlert({ fn: "x" });
        assert.equal(result.emailed, false);
        assert.equal(result.reason, "no_sender");
    });

    it("never lets a sender failure escape", async () => {
        const result = await deliverPaymentAlert(
            { fn: "x" },
            { emailSender: async () => { throw new Error("smtp down"); } }
        );
        assert.equal(result.emailed, false);
        assert.equal(result.reason, "send_failed");
    });
});

describe("wrapCallableWithPaymentAlert", () => {
    it("passes success through untouched", async () => {
        const wrapped = wrapCallableWithPaymentAlert("createCheckoutSession", async () => ({ ok: true }));
        assert.deepEqual(await wrapped({}, { auth: { uid: "u1", token: {} } }), { ok: true });
    });

    it("alerts and re-throws on a server-fault error", async () => {
        const sent = [];
        setPaymentAlertEmailSender(async (p) => { sent.push(p); });
        const wrapped = wrapCallableWithPaymentAlert("createCheckoutSession", async () => {
            throw httpsError("internal", "explode");
        });
        await assert.rejects(
            () => wrapped({}, { auth: { uid: "u1", token: { email: "a@b.com" } } }),
            (error) => error.message === "explode"
        );
        assert.equal(sent.length, 1);
        assert.equal(sent[0].fn, "createCheckoutSession");
        assert.equal(sent[0].uid, "u1");
    });

    it("re-throws WITHOUT alerting on a client-fault error", async () => {
        const sent = [];
        setPaymentAlertEmailSender(async (p) => { sent.push(p); });
        const wrapped = wrapCallableWithPaymentAlert("createCheckoutSession", async () => {
            throw httpsError("unauthenticated", "sign in");
        });
        await assert.rejects(
            () => wrapped({}, { auth: null }),
            (error) => error.message === "sign in"
        );
        assert.equal(sent.length, 0);
    });
});
