"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createHmac, generateKeyPairSync, sign } = require("crypto");
const supportDesk = require("../supportDesk.js");

const CONFIG = {
    applicationId: "123456789012345678",
    guildId: "223456789012345678",
    forumChannelId: "323456789012345678",
    adminRoleId: "423456789012345678",
    publicKey: "a".repeat(64),
    botToken: "private-token",
    gmailEndpoint: "https://script.google.com/macros/s/deployment/exec",
    tags: {
        new: "523456789012345678",
        waitingCustomer: "623456789012345678",
        waitingUs: "723456789012345678",
        resolved: "823456789012345678",
        spam: "923456789012345678"
    }
};

describe("support desk configuration and input boundaries", () => {
    it("accepts the complete private configuration and rejects unsafe endpoints", () => {
        const parsed = supportDesk.parseConfig(JSON.stringify(CONFIG));
        assert.equal(parsed.forumChannelId, CONFIG.forumChannelId);
        assert.equal(parsed.tags.new, CONFIG.tags.new);

        assert.throws(() => supportDesk.parseConfig(JSON.stringify({
            ...CONFIG,
            gmailEndpoint: "https://evil.example/reply"
        })), /invalid Gmail endpoint/);
    });

    it("normalizes email input and derives a stable non-reversible case id", () => {
        const email = supportDesk.normalizeInboundEmail({
            gmailThreadId: "thread_123456",
            gmailMessageId: "message_123456",
            from: "Customer <customer@example.com>",
            subject: "Question",
            body: "Hello",
            receivedAt: "2026-08-26T20:00:00-04:00",
            attachmentCount: 2,
            gmailUrl: "https://mail.google.com/mail/u/0/#all/message_123456"
        });
        assert.equal(email.senderAddress, "customer@example.com");
        assert.equal(supportDesk.makeCaseId(email.gmailThreadId), supportDesk.makeCaseId(email.gmailThreadId));
        assert.notEqual(supportDesk.makeCaseId(email.gmailThreadId), email.gmailThreadId);
    });

    it("suppresses Discord mentions and groups replies under the same case", () => {
        const email = supportDesk.normalizeInboundEmail({
            gmailThreadId: "thread_123456",
            gmailMessageId: "message_123456",
            from: "Customer <customer@example.com>",
            subject: "@everyone Help",
            body: "@here please help",
            receivedAt: "2026-08-26T20:00:00-04:00",
            attachmentCount: 0,
            gmailUrl: "https://mail.google.com/mail/u/0/#all/message_123456"
        });
        const caseId = supportDesk.makeCaseId(email.gmailThreadId);
        const starter = supportDesk.buildCaseStarter(email, caseId, CONFIG);
        const followup = supportDesk.buildFollowup(email, caseId);
        assert.deepEqual(starter.message.allowed_mentions, { parse: [] });
        assert.deepEqual(followup.allowed_mentions, { parse: [] });
        assert.match(starter.message.components[0].components[0].custom_id, new RegExp(caseId));
        assert.match(followup.components[0].components[1].custom_id, new RegExp(caseId));
        assert.ok(starter.message.components[0].components.some((button) =>
            button.label === "🟡 Working" && button.custom_id === `support_status:${caseId}:waitingUs`
        ));
    });
});

describe("support desk request authentication", () => {
    it("accepts only fresh HMAC-signed Apps Script ingestion", () => {
        const secret = "s".repeat(48);
        const body = Buffer.from(JSON.stringify({ hello: "world" }));
        const timestamp = "1787792400000";
        const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
        const req = {
            rawBody: body,
            body: { hello: "world" },
            get: (name) => name === "X-Bark-Timestamp" ? timestamp : name === "X-Bark-Signature" ? signature : ""
        };
        assert.equal(supportDesk.verifySignedIngest(req, secret, Number(timestamp)), true);
        assert.equal(supportDesk.verifySignedIngest(req, `${secret}x`, Number(timestamp)), false);
        assert.equal(supportDesk.verifySignedIngest(req, secret, Number(timestamp) + 10 * 60 * 1000), false);

        const canonicalSignature = createHmac("sha256", secret)
            .update(`${timestamp}.${JSON.stringify(req.body)}`)
            .digest("hex");
        req.rawBody = Buffer.from('{ "hello" : "world" }');
        req.get = (name) => name === "X-Bark-Timestamp" ? timestamp : name === "X-Bark-Signature" ? canonicalSignature : "";
        assert.equal(supportDesk.verifySignedIngest(req, secret, Number(timestamp)), true);

        const email = { subject: "Unicode — test", body: "It’s safe" };
        const encoded = Buffer.from(JSON.stringify(email), "utf8").toString("base64url");
        const envelopeSignature = createHmac("sha256", secret)
            .update(`${timestamp}.${encoded}`)
            .digest("hex");
        req.body = { encoded };
        req.rawBody = Buffer.from(JSON.stringify(req.body));
        req.get = (name) => name === "X-Bark-Timestamp" ? timestamp : name === "X-Bark-Signature" ? envelopeSignature : "";
        assert.equal(supportDesk.verifySignedIngest(req, secret, Number(timestamp)), true);
        assert.deepEqual(supportDesk.decodeIngestEnvelope(req.body), email);
    });

    it("verifies Discord Ed25519 signatures against the unmodified raw body", () => {
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
        const timestamp = "1787792400";
        const body = Buffer.from(JSON.stringify({ type: 1 }));
        const signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString("hex");
        const req = {
            rawBody: body,
            get: (name) => name === "X-Signature-Timestamp" ? timestamp : name === "X-Signature-Ed25519" ? signature : ""
        };
        assert.equal(supportDesk.verifyDiscordInteraction(req, rawPublic, Number(timestamp) * 1000), true);
        req.rawBody = Buffer.from(JSON.stringify({ type: 2 }));
        assert.equal(supportDesk.verifyDiscordInteraction(req, rawPublic, Number(timestamp) * 1000), false);
        req.rawBody = body;
        assert.equal(supportDesk.verifyDiscordInteraction(req, rawPublic, (Number(timestamp) + 600) * 1000), false);
    });

    it("builds a signed Gmail envelope without exposing the request fields at top level", () => {
        const envelope = supportDesk.signedEnvelope({ body: "private", senderKey: "carter" }, "k".repeat(48), 1234);
        assert.equal(envelope.request, undefined);
        assert.equal(JSON.parse(Buffer.from(envelope.encoded, "base64url").toString("utf8")).body, "private");
        assert.match(envelope.signature, /^[a-f0-9]{64}$/);
    });
});

describe("support desk reply UX", () => {
    it("recognizes only manually selectable statuses", () => {
        assert.equal(supportDesk.isManualStatus(supportDesk.STATUS_KEYS.waitingUs), true);
        assert.equal(supportDesk.isManualStatus(supportDesk.STATUS_KEYS.resolved), true);
        assert.equal(supportDesk.isManualStatus(supportDesk.STATUS_KEYS.spam), true);
        assert.equal(supportDesk.isManualStatus(supportDesk.STATUS_KEYS.waitingCustomer), false);
        assert.deepEqual(
            supportDesk.statusQueuedResponse(supportDesk.STATUS_KEYS.resolved),
            { type: 4, data: { flags: 64, content: "Updating case to **Resolved**…" } }
        );
    });

    it("offers distinct sender-specific reply actions and a send confirmation", () => {
        const modal = supportDesk.buildReplyModal("case_123456", "usbark");
        assert.equal(modal.type, 9);
        assert.match(modal.data.title, /USBarkRangers/);
        assert.equal(modal.data.components[0].components[0].max_length, 4000);

        const preview = supportDesk.previewResponse(
            "draft-id",
            supportDesk.SENDER_KEYS.carter,
            "Thanks for contacting us."
        );
        assert.match(preview.data.content, /cswarm34@gmail\.com/);
        assert.equal(preview.data.components[0].components[0].label, "Confirm and send");
        assert.equal(preview.data.flags, 64);
    });

    it("enqueues a status job through the bounded Firestore REST path", async () => {
        const calls = [];
        const handlers = supportDesk.createSupportDesk({
            admin: {},
            firestore: {},
            projectId: "barkrangermap-auth",
            accessTokenProvider: async () => ({ access_token: "private-access-token", expires_in: 3600 }),
            config: CONFIG,
            sharedSecret: "s".repeat(48),
            axios: async (request) => {
                calls.push(request);
                return { data: { name: "projects/test/status-job" } };
            }
        });
        await handlers.enqueueStatusJob({
            channel_id: "103456789012345678",
            member: { user: { id: "admin_123456" } }
        }, {
            caseId: "case_123456",
            value: supportDesk.STATUS_KEYS.resolved
        });
        assert.equal(calls.length, 1);
        assert.match(calls[0].url, /\/_supportStatusJobs$/);
        assert.equal(calls[0].timeout, 1200);
        assert.equal(calls[0].data.fields.status.stringValue, supportDesk.STATUS_KEYS.resolved);
    });

    it("processes a durable status job into Discord, Gmail, and the case", async () => {
        const calls = [];
        const writes = [];
        let deleted = false;
        const handlers = supportDesk.createSupportDesk({
            admin: {
                firestore: {
                    FieldValue: { serverTimestamp: () => "server-time" }
                }
            },
            firestore: {
                collection: () => ({
                    doc: () => ({
                        get: async () => ({
                            exists: true,
                            data: () => ({
                                discordThreadId: "103456789012345678",
                                gmailThreadId: "gmail_thread_123456"
                            })
                        }),
                        set: async (...args) => writes.push(args)
                    })
                })
            },
            config: CONFIG,
            sharedSecret: "s".repeat(48),
            axios: async (request) => {
                calls.push(request);
                return { data: { ok: true } };
            }
        });
        const result = await handlers.processStatusJob({
            id: "job_123456",
            exists: true,
            data: () => ({
                caseId: "case_123456",
                status: supportDesk.STATUS_KEYS.resolved,
                discordUserId: "admin_123456",
                discordThreadId: "103456789012345678"
            }),
            ref: { delete: async () => { deleted = true; } }
        });
        assert.equal(result.status, supportDesk.STATUS_KEYS.resolved);
        assert.deepEqual(result.errors, []);
        assert.equal(calls.length, 2);
        assert.match(calls[0].url, /\/channels\/103456789012345678$/);
        assert.equal(calls[1].url, CONFIG.gmailEndpoint);
        assert.equal(writes[0][0].statusSync.discordOk, true);
        assert.equal(writes[0][0].statusSync.gmailOk, true);
        assert.equal(deleted, true);
    });
});
