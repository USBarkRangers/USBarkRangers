const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");

process.env.NODE_ENV = "test";

const opsDiscord = require("../opsDiscord.js");
const {
    __test: {
        deliverPaymentAlert,
        routeAlertToDiscord,
        postFeedbackToDiscord,
        postBillingEventToDiscord,
        postDigestToDiscord,
        resetAlertThrottle,
        setPaymentAlertEmailSender
    }
} = require("../index.js");

const HOOK = "https://discord.com/api/webhooks/123/abc";

// A config covering every channel the code routes to, so a routing test fails
// on the routing and not on a missing webhook.
function fullConfig(adminRoleId = "999") {
    const channels = {};
    for (const channel of opsDiscord.KNOWN_CHANNELS) {
        channels[channel] = `${HOOK}-${channel}`;
    }
    return { channels, adminRoleId };
}

// Captures what would have been POSTed instead of hitting the network.
function recorder() {
    const sent = [];
    return {
        sent,
        sender: async (url, payload, meta) => { sent.push({ url, payload, meta }); }
    };
}

beforeEach(() => {
    resetAlertThrottle();
    opsDiscord.resetDiscordState();
});

afterEach(() => {
    resetAlertThrottle();
    opsDiscord.resetDiscordState();
    setPaymentAlertEmailSender(null);
});

describe("parseDiscordConfig", () => {
    it("reads channel webhooks and the admin role id", () => {
        const config = opsDiscord.parseDiscordConfig(JSON.stringify({
            adminRoleId: "1535",
            systemStatus: HOOK,
            bugs: `${HOOK}2`
        }));
        assert.equal(config.channels.systemStatus, HOOK);
        assert.equal(config.channels.bugs, `${HOOK}2`);
        assert.equal(config.adminRoleId, "1535");
    });

    it("degrades to empty (no throw) on malformed JSON", () => {
        assert.deepEqual(opsDiscord.parseDiscordConfig("{not json"), { channels: {}, adminRoleId: null });
        assert.deepEqual(opsDiscord.parseDiscordConfig(""), { channels: {}, adminRoleId: null });
        assert.deepEqual(opsDiscord.parseDiscordConfig(null), { channels: {}, adminRoleId: null });
        assert.deepEqual(opsDiscord.parseDiscordConfig("[1,2]"), { channels: {}, adminRoleId: null });
    });

    it("rejects URLs that are not Discord webhooks", () => {
        const config = opsDiscord.parseDiscordConfig(JSON.stringify({
            systemStatus: "https://evil.example.com/hook",
            bugs: "http://discord.com/api/webhooks/1/2"
        }));
        assert.deepEqual(config.channels, {});
    });

    it("ignores keys that are not known channels", () => {
        const config = opsDiscord.parseDiscordConfig(JSON.stringify({ notAChannel: HOOK }));
        assert.deepEqual(config.channels, {});
    });

    it("rejects a non-numeric admin role id", () => {
        const config = opsDiscord.parseDiscordConfig(JSON.stringify({ adminRoleId: "everyone" }));
        assert.equal(config.adminRoleId, null);
    });
});

describe("getDiscordConfig", () => {
    it("merges the dedicated Admin-only costs webhook without replacing shared channels", () => {
        const config = opsDiscord.getDiscordConfig({
            env: {
                DISCORD_WEBHOOKS_JSON: JSON.stringify({ adminRoleId: "1535", systemStatus: HOOK }),
                DISCORD_COSTS_WEBHOOK: `${HOOK}-costs`
            }
        });
        assert.equal(config.channels.systemStatus, HOOK);
        assert.equal(config.channels.costs, `${HOOK}-costs`);
        assert.equal(config.adminRoleId, "1535");
    });

    it("rejects a non-Discord dedicated costs endpoint", () => {
        const config = opsDiscord.getDiscordConfig({
            env: { DISCORD_COSTS_WEBHOOK: "https://evil.example.com/webhook" }
        });
        assert.deepEqual(config.channels, {});
    });
});

describe("maskEmail", () => {
    it("keeps the first character and the domain", () => {
        assert.equal(opsDiscord.maskEmail("carter@example.com"), "c***@example.com");
    });

    it("returns null for anything that is not an address", () => {
        assert.equal(opsDiscord.maskEmail(""), null);
        assert.equal(opsDiscord.maskEmail("no-at-sign"), null);
        assert.equal(opsDiscord.maskEmail("@leading.com"), null);
        assert.equal(opsDiscord.maskEmail(undefined), null);
    });
});

describe("buildDiscordPayload", () => {
    it("colors the embed by tier", () => {
        const routine = opsDiscord.buildDiscordPayload({ title: "t", tier: "routine" });
        const critical = opsDiscord.buildDiscordPayload({ title: "t", tier: "critical" });
        assert.equal(routine.embeds[0].color, opsDiscord.TIERS.routine.color);
        assert.equal(critical.embeds[0].color, opsDiscord.TIERS.critical.color);
    });

    it("pings the admin role only on critical, and only when the id is known", () => {
        const withRole = opsDiscord.buildDiscordPayload({ title: "t", tier: "critical" }, { adminRoleId: "42" });
        assert.equal(withRole.content, "<@&42>");
        assert.deepEqual(withRole.allowed_mentions, { parse: [], roles: ["42"] });

        const important = opsDiscord.buildDiscordPayload({ title: "t", tier: "important" }, { adminRoleId: "42" });
        assert.equal(important.content, undefined);
    });

    it("does not emit a raw mention when the role id is missing", () => {
        const payload = opsDiscord.buildDiscordPayload({ title: "t", tier: "critical" }, { adminRoleId: null });
        assert.equal(payload.content, undefined);
        assert.deepEqual(payload.allowed_mentions, { parse: [] });
    });

    it("suppresses @everyone and @here on every post", () => {
        const payload = opsDiscord.buildDiscordPayload({ title: "t", description: "@everyone", tier: "routine" });
        assert.deepEqual(payload.allowed_mentions.parse, []);
    });

    it("clamps title, description, and field values to Discord's limits", () => {
        const payload = opsDiscord.buildDiscordPayload({
            title: "T".repeat(400),
            description: "D".repeat(5000),
            tier: "routine",
            fields: [{ name: "n", value: "V".repeat(2000) }]
        });
        const embed = payload.embeds[0];
        assert.equal(embed.title.length, 256);
        assert.equal(embed.description.length, 4096);
        assert.equal(embed.fields[0].value.length, 1024);
    });

    it("drops empty fields and caps the field count", () => {
        const fields = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}`, value: "v" }));
        fields.push({ name: "empty", value: null });
        const embed = opsDiscord.buildDiscordPayload({ title: "t", tier: "routine", fields }).embeds[0];
        assert.equal(embed.fields.length, 25);
        assert.ok(!embed.fields.some((f) => f.name === "empty"));
    });
});

describe("postDiscord", () => {
    it("is a no-op when no webhook is configured", async () => {
        const { sent, sender } = recorder();
        const result = await opsDiscord.postDiscord(
            { channel: "systemStatus", title: "x", tier: "important" },
            { discordConfig: { channels: {}, adminRoleId: null }, discordSender: sender }
        );
        assert.deepEqual(result, { posted: false, reason: "not_configured" });
        assert.equal(sent.length, 0);
    });

    it("refuses an unknown channel rather than guessing", async () => {
        const { sent, sender } = recorder();
        const result = await opsDiscord.postDiscord(
            { channel: "nope", title: "x" },
            { discordConfig: fullConfig(), discordSender: sender }
        );
        assert.equal(result.reason, "unknown_channel");
        assert.equal(sent.length, 0);
    });

    it("posts to the webhook for the named channel", async () => {
        const { sent, sender } = recorder();
        const result = await opsDiscord.postDiscord(
            { channel: "bugs", title: "Broken", tier: "important" },
            { discordConfig: fullConfig(), discordSender: sender }
        );
        assert.equal(result.posted, true);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, `${HOOK}-bugs`);
        assert.equal(sent[0].payload.embeds[0].title, "Broken");
    });

    it("swallows a delivery failure so callers are never disrupted", async () => {
        const result = await opsDiscord.postDiscord(
            { channel: "bugs", title: "x", tier: "important" },
            {
                discordConfig: fullConfig(),
                discordSender: async () => { throw new Error("discord down"); }
            }
        );
        assert.deepEqual(result, { posted: false, reason: "send_failed" });
    });
});

describe("routeAlertToDiscord", () => {
    it("sends a payment-critical failure to incident-response and pings", async () => {
        const { sent, sender } = recorder();
        await routeAlertToDiscord(
            { fn: "lemonSqueezyWebhook", critical: true, errorMessage: "boom" },
            { discordConfig: fullConfig("7"), discordSender: sender }
        );
        assert.equal(sent[0].url, `${HOOK}-incidentResponse`);
        assert.equal(sent[0].payload.content, "<@&7>");
        assert.match(sent[0].payload.embeds[0].title, /^CRITICAL/);
    });

    it("sends a client report to bugs, never incident-response", async () => {
        const { sent, sender } = recorder();
        await routeAlertToDiscord(
            { fn: "client/freeze", source: "client", critical: true, errorMessage: "UI stalled" },
            { discordConfig: fullConfig("7"), discordSender: sender }
        );
        assert.equal(sent[0].url, `${HOOK}-bugs`);
        // A client report must never ping or claim payment risk.
        assert.equal(sent[0].payload.content, undefined);
        assert.ok(!sent[0].payload.embeds[0].title.startsWith("CRITICAL"));
    });

    it("sends a client checkout report to sales-and-billing without a critical ping", async () => {
        const { sent, sender } = recorder();
        await routeAlertToDiscord(
            {
                fn: "client/other",
                source: "client",
                likelyArea: "payment/upgrade",
                errorMessage: "checkout could not start"
            },
            { discordConfig: fullConfig("7"), discordSender: sender }
        );
        assert.equal(sent[0].url, `${HOOK}-salesAndBilling`);
        assert.equal(sent[0].payload.content, undefined);
        assert.match(sent[0].payload.embeds[0].title, /Client payment report/);
    });

    it("sends an ordinary server fault to system-status", async () => {
        const { sent, sender } = recorder();
        await routeAlertToDiscord(
            { fn: "getPremiumRoute", errorMessage: "ORS down" },
            { discordConfig: fullConfig(), discordSender: sender }
        );
        assert.equal(sent[0].url, `${HOOK}-systemStatus`);
    });

    it("masks the reporter's address", async () => {
        const { sent, sender } = recorder();
        await routeAlertToDiscord(
            { fn: "client/error", source: "client", email: "carter@example.com", errorMessage: "x" },
            { discordConfig: fullConfig(), discordSender: sender }
        );
        const user = sent[0].payload.embeds[0].fields.find((f) => f.name === "User");
        assert.equal(user.value, "c***@example.com");
    });
});

describe("deliverPaymentAlert with Discord wired", () => {
    it("posts to Discord and emails from a single alert", async () => {
        const { sent, sender } = recorder();
        const emails = [];
        const result = await deliverPaymentAlert(
            { fn: "createCheckoutSession", errorMessage: "boom" },
            {
                emailSender: async (p) => { emails.push(p); },
                discordConfig: fullConfig(),
                discordSender: sender
            }
        );
        assert.equal(result.emailed, true);
        assert.equal(result.discord.posted, true);
        assert.equal(emails.length, 1);
        assert.equal(sent.length, 1);
    });

    it("throttles both transports together, not just email", async () => {
        const { sent, sender } = recorder();
        const options = {
            emailSender: async () => {},
            discordConfig: fullConfig(),
            discordSender: sender
        };
        const payload = { fn: "getPremiumRoute", errorCode: "internal", errorMessage: "ORS down" };

        await deliverPaymentAlert(payload, options);
        const second = await deliverPaymentAlert(payload, options);

        assert.equal(second.reason, "throttled");
        assert.equal(second.discord, false);
        // The repeat must not reach Discord either, or the ops server floods.
        assert.equal(sent.length, 1);
    });

    it("still emails when Discord delivery fails", async () => {
        const emails = [];
        const result = await deliverPaymentAlert(
            { fn: "x", errorMessage: "y" },
            {
                emailSender: async (p) => { emails.push(p); },
                discordConfig: fullConfig(),
                discordSender: async () => { throw new Error("discord down"); }
            }
        );
        assert.equal(result.emailed, true);
        assert.equal(result.discord.posted, false);
        assert.equal(emails.length, 1);
    });

    it("posts to Discord even when no email transport is configured", async () => {
        const { sent, sender } = recorder();
        const result = await deliverPaymentAlert(
            { fn: "x", errorMessage: "y" },
            { discordConfig: fullConfig(), discordSender: sender }
        );
        assert.equal(result.emailed, false);
        assert.equal(result.reason, "no_sender");
        assert.equal(sent.length, 1);
    });
});

describe("postFeedbackToDiscord", () => {
    const cases = [
        ["bug", "bugs"],
        ["idea", "featureRequests"],
        ["support", "supportInbox"],
        ["general", "customerFeedback"],
        ["missing_location", "mapCorrections"],
        ["other", "mapCorrections"]
    ];

    for (const [type, channel] of cases) {
        it(`routes ${type} feedback to ${channel}`, async () => {
            const { sent, sender } = recorder();
            await postFeedbackToDiscord(
                { type, message: "hello", email: "carter@example.com", displayName: "Carter", browser: {} },
                { discordConfig: fullConfig(), discordSender: sender }
            );
            assert.equal(sent[0].url, `${HOOK}-${channel}`);
        });
    }

    it("keeps the full address only in the Admin-only support channel", async () => {
        const { sent, sender } = recorder();
        const options = { discordConfig: fullConfig(), discordSender: sender };
        const record = { message: "m", email: "carter@example.com", displayName: "C", browser: {} };

        await postFeedbackToDiscord({ ...record, type: "support" }, options);
        await postFeedbackToDiscord({ ...record, type: "general" }, options);

        const contactOf = (i) => sent[i].payload.embeds[0].fields.find((f) => f.name === "Contact").value;
        assert.equal(contactOf(0), "carter@example.com");
        assert.equal(contactOf(1), "c***@example.com");
    });

    it("hands screenshots to the sender and counts them in a field", async () => {
        const { sent, sender } = recorder();
        await postFeedbackToDiscord(
            {
                type: "bug",
                message: "m",
                displayName: "Carter",
                browser: {},
                files: [{ name: "shot.png", contentType: "image/png", buffer: Buffer.from("PNGDATA") }]
            },
            { discordConfig: fullConfig(), discordSender: sender }
        );

        assert.equal(sent[0].meta.files.length, 1);
        assert.equal(sent[0].payload.embeds[0].image.url, "attachment://shot.png");
        const screenshots = sent[0].payload.embeds[0].fields.find((f) => f.name === "Screenshots");
        assert.equal(screenshots.value, "1");
    });
});

describe("attachment transport", () => {
    it("builds multipart with payload_json plus one part per file", async () => {
        const form = opsDiscord.buildDiscordFormData(
            { embeds: [{ title: "t" }] },
            [
                { name: "one.png", contentType: "image/png", buffer: Buffer.from("AAA") },
                { name: "two.jpg", contentType: "image/jpeg", buffer: Buffer.from("BBBB") }
            ]
        );

        assert.deepEqual([...form.keys()], ["payload_json", "files[0]", "files[1]"]);
        assert.equal(JSON.parse(form.get("payload_json")).embeds[0].title, "t");

        const first = form.get("files[0]");
        assert.equal(first.name, "one.png");
        assert.equal(first.type, "image/png");
        assert.equal(first.size, 3);
        assert.equal(form.get("files[1]").size, 4);
    });

    it("drops malformed attachments rather than failing the post", () => {
        const files = opsDiscord.normalizeFiles([
            { name: "ok.png", contentType: "image/png", buffer: Buffer.from("A") },
            { name: "empty.png", contentType: "image/png", buffer: Buffer.alloc(0) },
            { name: "not a buffer", contentType: "image/png", buffer: "AAA" },
            null,
            { name: "../escape.png", contentType: "image/png", buffer: Buffer.from("B") }
        ]);

        assert.equal(files.length, 2);
        assert.equal(files[0].name, "ok.png");
        assert.equal(files[1].name, "attachment-2", "an unsafe name is replaced, not passed through");
    });

    it("never sends more than three files", () => {
        const buffer = Buffer.from("A");
        const files = opsDiscord.normalizeFiles(new Array(5).fill({ name: "a.png", contentType: "image/png", buffer }));
        assert.equal(files.length, 3);
    });
});

describe("postBillingEventToDiscord", () => {
    it("treats a failed payment as critical", async () => {
        const { sent, sender } = recorder();
        await postBillingEventToDiscord(
            { uid: "u1", eventName: "subscription_payment_failed", entitlement: { status: "past_due" } },
            { discordConfig: fullConfig("7"), discordSender: sender }
        );
        assert.equal(sent[0].url, `${HOOK}-salesAndBilling`);
        assert.equal(sent[0].payload.embeds[0].color, opsDiscord.TIERS.critical.color);
        assert.equal(sent[0].payload.content, "<@&7>");
    });

    it("treats a new subscription as important, not critical", async () => {
        const { sent, sender } = recorder();
        await postBillingEventToDiscord(
            { uid: "u1", eventName: "subscription_created", entitlement: { status: "active", premium: true } },
            { discordConfig: fullConfig("7"), discordSender: sender }
        );
        assert.equal(sent[0].payload.embeds[0].color, opsDiscord.TIERS.important.color);
        assert.equal(sent[0].payload.content, undefined);
    });

    it("survives a missing entitlement without throwing", async () => {
        const { sent, sender } = recorder();
        const result = await postBillingEventToDiscord(
            { uid: "u1", eventName: "subscription_updated", entitlement: undefined },
            { discordConfig: fullConfig(), discordSender: sender }
        );
        assert.equal(result.posted, true);
        assert.ok(sent[0].payload.embeds[0].fields.some((f) => f.value === "unknown"));
    });
});

describe("postDigestToDiscord", () => {
    it("posts the rollup at routine tier with no ping", async () => {
        const { sent, sender } = recorder();
        await postDigestToDiscord(
            { total: 3, windowHours: 24, distinctUsers: 2, byType: { error: 2, freeze: 1 }, topMessages: [{ message: "boom", count: 2 }] },
            { discordConfig: fullConfig("7"), discordSender: sender }
        );
        assert.equal(sent[0].url, `${HOOK}-dailyBriefing`);
        assert.equal(sent[0].payload.embeds[0].color, opsDiscord.TIERS.routine.color);
        assert.equal(sent[0].payload.content, undefined);
    });

    it("says all clear when there is nothing to report", async () => {
        const { sent, sender } = recorder();
        await postDigestToDiscord(
            { total: 0, windowHours: 24, distinctUsers: 0, byType: {}, topMessages: [] },
            { discordConfig: fullConfig(), discordSender: sender }
        );
        assert.match(sent[0].payload.embeds[0].title, /All clear/);
    });
});
