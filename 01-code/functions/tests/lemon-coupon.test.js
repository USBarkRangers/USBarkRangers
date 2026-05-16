const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        handleCreateCheckoutSession,
        handleRedeemAccessOrPromoCode,
        isEffectivePremium
    }
} = require("../index.js");

const NOW_MS = Date.parse("2026-05-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function authedContext(uid = "coupon-user", token = {}) {
    return { auth: { uid, token } };
}

function ts(millis) {
    return {
        seconds: Math.floor(millis / 1000),
        nanoseconds: (millis % 1000) * 1000000,
        toMillis() {
            return millis;
        }
    };
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

async function assertRejectsCode(promise, code, messagePattern) {
    await assert.rejects(promise, error => {
        if (getHttpsErrorCode(error) !== code) return false;
        return messagePattern ? messagePattern.test(String(error.message || "")) : true;
    });
}

describe("disabled legacy app access-code callable", () => {
    it("still rejects unauthenticated callers before any coupon handling", async () => {
        await assertRejectsCode(
            handleRedeemAccessOrPromoCode({ code: "VIP-2026-ABC" }, {}, {}),
            "unauthenticated"
        );
    });

    it("is disabled for new app-side redemptions", async () => {
        await assertRejectsCode(
            handleRedeemAccessOrPromoCode(
                { code: "VIP-2026-ABC" },
                authedContext("verified-user", {
                    email: "verified@example.test",
                    email_verified: true,
                    firebase: { sign_in_provider: "password" }
                }),
                {}
            ),
            "failed-precondition",
            /Lemon Squeezy checkout/i
        );
    });
});

describe("Lemon checkout discount support", () => {
    it("creates default test-mode checkout with Lemon's discount field explicitly enabled", async () => {
        let capturedBody = null;
        await handleCreateCheckoutSession(
            {},
            authedContext("checkout-user", { email: "checkout@example.test" }),
            {
                apiKey: "test-api-key",
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

        const attributes = capturedBody.data.attributes;
        assert.equal(attributes.test_mode, true);
        assert.equal(attributes.checkout_data.discount_code, undefined);
        assert.deepEqual(attributes.checkout_options, { discount: true });
        assert.equal(attributes.checkout_data.custom.firebase_uid, "checkout-user");
    });

    it("keeps coupon entry inside Lemon checkout and ignores client discount payloads", async () => {
        let capturedBody = null;
        await handleCreateCheckoutSession(
            { discountCode: "launch20" },
            authedContext("checkout-user", { email: "checkout@example.test" }),
            {
                apiKey: "test-api-key",
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

        assert.equal(capturedBody.data.attributes.checkout_data.discount_code, undefined);
        assert.equal(capturedBody.data.attributes.checkout_data.custom.firebase_uid, "checkout-user");
        assert.equal(capturedBody.data.attributes.test_mode, true);
        assert.deepEqual(capturedBody.data.attributes.checkout_options, { discount: true });
    });

    it("treats old access-code entitlements as premium only until expiresAt", () => {
        const active = {
            premium: true,
            status: "access_code_active",
            source: "access_code",
            expiresAt: ts(NOW_MS + DAY_MS)
        };
        const expired = {
            ...active,
            expiresAt: ts(NOW_MS - DAY_MS)
        };

        assert.equal(isEffectivePremium(active, { nowMs: NOW_MS }), true);
        assert.equal(isEffectivePremium(expired, { nowMs: NOW_MS }), false);
    });
});
