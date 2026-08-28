"use strict";

// Private support-email case bridge.
//
// Gmail is the durable source of truth. Apps Script sends signed, sanitized
// notifications here; this module groups them into one Discord forum thread per
// Gmail thread. Discord replies are role-gated, previewed, confirmed, and then
// sent through the mailbox-owned Apps Script so Gmail threading is preserved.

const { createHash, createHmac, createPublicKey, randomUUID, timingSafeEqual, verify } = require("crypto");

const DISCORD_API = "https://discord.com/api/v10";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
// Discord modal text inputs have a hard 4,000-character maximum.
const MAX_EMAIL_BODY = 4000;
const MAX_PREVIEW = 1800;
const CASE_COLLECTION = "_supportCases";
const DRAFT_COLLECTION = "_supportReplyDrafts";
const STATUS_JOB_COLLECTION = "_supportStatusJobs";

const STATUS_KEYS = Object.freeze({
    new: "new",
    waitingUs: "waitingUs",
    waitingCustomer: "waitingCustomer",
    resolved: "resolved",
    spam: "spam"
});

const SENDER_KEYS = Object.freeze({
    usbark: Object.freeze({ label: "USBarkRangers", address: "usbarkrangers@gmail.com" }),
    carter: Object.freeze({ label: "Carter Swarm", address: "cswarm34@gmail.com" })
});

function cleanText(value, max = 4096) {
    const normalized = String(value || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\t ]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (!normalized) return "";
    return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function parseEmailAddress(value) {
    const text = String(value || "").trim();
    const angle = text.match(/<([^<>\s]+@[^<>\s]+)>/);
    const bare = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    return String((angle && angle[1]) || (bare && bare[0]) || "").toLowerCase();
}

function safeId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{6,200}$/.test(value) ? value : null;
}

function makeCaseId(gmailThreadId) {
    return createHash("sha256").update(String(gmailThreadId || "")).digest("hex").slice(0, 32);
}

function parseConfig(raw) {
    let parsed;
    try {
        parsed = JSON.parse(String(raw || ""));
    } catch (_) {
        throw new Error("SUPPORT_DESK_CONFIG_JSON is not valid JSON.");
    }

    const requiredIds = ["applicationId", "guildId", "forumChannelId", "adminRoleId"];
    for (const key of requiredIds) {
        if (!parsed || !/^\d{10,25}$/.test(String(parsed[key] || ""))) {
            throw new Error(`Support desk config is missing ${key}.`);
        }
    }
    if (!/^[a-f0-9]{64}$/i.test(String(parsed.publicKey || ""))) {
        throw new Error("Support desk config has an invalid Discord public key.");
    }
    if (!String(parsed.botToken || "").trim()) {
        throw new Error("Support desk config is missing the Discord bot token.");
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\//i.test(String(parsed.gmailEndpoint || ""))) {
        throw new Error("Support desk config has an invalid Gmail endpoint.");
    }

    const tags = parsed.tags && typeof parsed.tags === "object" ? parsed.tags : {};
    const cleanTags = {};
    Object.values(STATUS_KEYS).forEach((key) => {
        if (/^\d{10,25}$/.test(String(tags[key] || ""))) cleanTags[key] = String(tags[key]);
    });

    return {
        applicationId: String(parsed.applicationId),
        guildId: String(parsed.guildId),
        forumChannelId: String(parsed.forumChannelId),
        adminRoleId: String(parsed.adminRoleId),
        publicKey: String(parsed.publicKey).toLowerCase(),
        botToken: String(parsed.botToken).trim(),
        gmailEndpoint: String(parsed.gmailEndpoint).trim(),
        tags: cleanTags
    };
}

function requestRawBody(req) {
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
    if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
    return Buffer.from(JSON.stringify(req.body || {}), "utf8");
}

function safeCompareHex(actual, expected) {
    if (!/^[a-f0-9]+$/i.test(String(actual || "")) || actual.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function decodeIngestEnvelope(body) {
    const encoded = body && typeof body === "object" ? String(body.encoded || "") : "";
    if (!encoded || encoded.length > 16000 || !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) return null;
    try {
        return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch (_error) {
        return null;
    }
}

function verifySignedIngest(req, secret, now = Date.now()) {
    const timestamp = String(req.get ? req.get("X-Bark-Timestamp") || "" : "");
    const signature = String(req.get ? req.get("X-Bark-Signature") || "" : "").toLowerCase();
    const millis = Number(timestamp);
    if (!Number.isFinite(millis) || Math.abs(now - millis) > MAX_CLOCK_SKEW_MS) return false;
    const raw = requestRawBody(req);
    const canonical = Buffer.from(JSON.stringify(req.body || {}), "utf8");
    const encoded = req.body && typeof req.body === "object" ? String(req.body.encoded || "") : "";
    const candidates = [raw, canonical];
    if (encoded) candidates.push(Buffer.from(encoded, "utf8"));
    return candidates.some((body) => {
        const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
        return safeCompareHex(signature, expected);
    });
}

function discordPublicKey(publicKeyHex) {
    const prefix = Buffer.from("302a300506032b6570032100", "hex");
    return createPublicKey({ key: Buffer.concat([prefix, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
}

function verifyDiscordInteraction(req, publicKeyHex, now = Date.now()) {
    const signature = String(req.get ? req.get("X-Signature-Ed25519") || "" : "");
    const timestamp = String(req.get ? req.get("X-Signature-Timestamp") || "" : "");
    if (!/^[a-f0-9]{128}$/i.test(signature) || !/^\d+$/.test(timestamp)) return false;
    const timestampMillis = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMillis) || Math.abs(now - timestampMillis) > MAX_CLOCK_SKEW_MS) return false;
    const body = requestRawBody(req);
    return verify(
        null,
        Buffer.concat([Buffer.from(timestamp, "utf8"), body]),
        discordPublicKey(publicKeyHex),
        Buffer.from(signature, "hex")
    );
}

function normalizeInboundEmail(input) {
    const gmailThreadId = safeId(input && input.gmailThreadId);
    const gmailMessageId = safeId(input && input.gmailMessageId);
    const from = cleanText(input && input.from, 320);
    const senderAddress = parseEmailAddress(from);
    const subject = cleanText(input && input.subject, 250) || "(no subject)";
    const body = cleanText(input && input.body, 3500) || "(no text body)";
    const receivedAt = cleanText(input && input.receivedAt, 80);
    const gmailUrl = String(input && input.gmailUrl || "");
    const attachmentCount = Math.max(0, Math.min(100, Number(input && input.attachmentCount) || 0));
    if (!gmailThreadId || !gmailMessageId || !senderAddress) throw new Error("Invalid support email payload.");
    if (!/^https:\/\/mail\.google\.com\//i.test(gmailUrl)) throw new Error("Invalid Gmail URL.");
    return { gmailThreadId, gmailMessageId, from, senderAddress, subject, body, receivedAt, gmailUrl, attachmentCount };
}

function threadTitle(email) {
    const subject = email.subject.replace(/^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i, "").trim() || "No subject";
    const sender = email.from.replace(/\s*<[^>]+>\s*$/, "").trim() || email.senderAddress;
    return cleanText(`${subject} — ${sender}`, 100);
}

function emailEmbed(email, titlePrefix = "New support email") {
    return {
        title: cleanText(`${titlePrefix}: ${email.subject}`, 256),
        description: cleanText(email.body, 4096),
        color: 0x3498db,
        url: email.gmailUrl,
        timestamp: new Date(email.receivedAt || Date.now()).toISOString(),
        fields: [
            { name: "From", value: email.from, inline: false },
            { name: "Attachments", value: String(email.attachmentCount), inline: true },
            { name: "Gmail", value: "Open the complete message and attachments", inline: true }
        ],
        footer: { text: `Gmail thread ${email.gmailThreadId}` }
    };
}

function replyButtons(caseId) {
    return [{
        type: 1,
        components: [
            { type: 2, style: 1, label: "Reply as USBarkRangers", custom_id: `support_reply:${caseId}:usbark` },
            { type: 2, style: 2, label: "Reply as Carter Swarm", custom_id: `support_reply:${caseId}:carter` },
            { type: 2, style: 2, label: "🟡 Working", custom_id: `support_status:${caseId}:waitingUs` },
            { type: 2, style: 3, label: "Resolve", custom_id: `support_status:${caseId}:resolved` },
            { type: 2, style: 4, label: "Spam", custom_id: `support_status:${caseId}:spam` }
        ]
    }];
}

function buildCaseStarter(email, caseId, config) {
    const tag = config.tags[STATUS_KEYS.new];
    return {
        name: threadTitle(email),
        auto_archive_duration: 10080,
        applied_tags: tag ? [tag] : [],
        message: {
            embeds: [emailEmbed(email)],
            components: replyButtons(caseId),
            allowed_mentions: { parse: [] }
        }
    };
}

function buildFollowup(email, caseId) {
    return {
        embeds: [emailEmbed(email, "Customer follow-up")],
        components: replyButtons(caseId),
        allowed_mentions: { parse: [] }
    };
}

function isAuthorizedInteraction(interaction, config) {
    if (!interaction || String(interaction.guild_id || "") !== config.guildId) return false;
    const roles = interaction.member && Array.isArray(interaction.member.roles) ? interaction.member.roles.map(String) : [];
    return roles.includes(config.adminRoleId);
}

function parseCustomId(customId) {
    const parts = String(customId || "").split(":");
    return { action: parts[0] || "", caseId: parts[1] || "", value: parts[2] || "" };
}

function buildReplyModal(caseId, senderKey) {
    const sender = SENDER_KEYS[senderKey];
    if (!sender) throw new Error("Unknown support sender.");
    return {
        type: 9,
        data: {
            custom_id: `support_compose:${caseId}:${senderKey}`,
            title: `Reply as ${sender.label}`.slice(0, 45),
            components: [{
                type: 1,
                components: [{
                    type: 4,
                    custom_id: "reply_body",
                    label: "Email reply",
                    style: 2,
                    min_length: 1,
                    max_length: MAX_EMAIL_BODY,
                    required: true,
                    placeholder: "Write the customer reply. You will preview it before sending."
                }]
            }]
        }
    };
}

function modalValue(interaction, customId) {
    const rows = interaction && interaction.data && Array.isArray(interaction.data.components)
        ? interaction.data.components
        : [];
    for (const row of rows) {
        for (const component of Array.isArray(row.components) ? row.components : []) {
            if (component.custom_id === customId) return cleanText(component.value, MAX_EMAIL_BODY);
        }
    }
    return "";
}

function previewResponse(draftId, sender, body) {
    return {
        type: 4,
        data: {
            flags: 64,
            content: `**Preview — from ${sender.label} <${sender.address}>**\n\n${cleanText(body, MAX_PREVIEW)}\n\nNothing has been sent yet.`,
            allowed_mentions: { parse: [] },
            components: [{
                type: 1,
                components: [
                    { type: 2, style: 3, label: "Confirm and send", custom_id: `support_confirm:${draftId}:send` },
                    { type: 2, style: 2, label: "Cancel", custom_id: `support_confirm:${draftId}:cancel` }
                ]
            }]
        }
    };
}

function signedEnvelope(request, sharedSecret, now = Date.now()) {
    const timestamp = String(now);
    const nonce = randomUUID();
    const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
    const signature = createHmac("sha256", sharedSecret)
        .update(`${timestamp}.${nonce}.${encoded}`)
        .digest("hex");
    return { timestamp, nonce, encoded, signature };
}

function discordInteractionUserId(interaction) {
    return String(interaction && interaction.member && interaction.member.user && interaction.member.user.id || "");
}

function isManualStatus(status) {
    return [STATUS_KEYS.waitingUs, STATUS_KEYS.resolved, STATUS_KEYS.spam].includes(status);
}

function manualStatusLabel(status) {
    return {
        [STATUS_KEYS.waitingUs]: "Working on it",
        [STATUS_KEYS.resolved]: "Resolved",
        [STATUS_KEYS.spam]: "Spam"
    }[status] || "Unknown";
}

function statusQueuedResponse(status) {
    return {
        type: 4,
        data: {
            flags: 64,
            content: `Updating case to **${manualStatusLabel(status)}**…`
        }
    };
}

function unixSeconds(date) {
    return Math.floor(date.getTime() / 1000);
}

function timeoutPromise(promise, timeoutMs, message) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

function createSupportDesk(options) {
    const admin = options.admin;
    const axios = options.axios;
    const db = options.firestore || admin.firestore();
    const env = options.env || process.env;
    const now = options.now || (() => Date.now());
    let accessTokenCache = null;

    function getConfig() {
        return options.config || parseConfig(env.SUPPORT_DESK_CONFIG_JSON);
    }

    function getSharedSecret() {
        const value = String(options.sharedSecret || env.SUPPORT_DESK_SHARED_SECRET || "");
        if (value.length < 32) throw new Error("SUPPORT_DESK_SHARED_SECRET must be at least 32 characters.");
        return value;
    }

    function getProjectId() {
        const projectId = String(
            options.projectId ||
            env.GCLOUD_PROJECT ||
            env.GOOGLE_CLOUD_PROJECT ||
            (admin.app && admin.app().options && admin.app().options.projectId) ||
            ""
        );
        if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error("Support status queue is missing the Firebase project id.");
        return projectId;
    }

    async function getAccessToken() {
        if (accessTokenCache && accessTokenCache.expiresAt > now() + 60 * 1000) return accessTokenCache.token;
        const provider = options.accessTokenProvider || (async () => {
            const response = await axios({
                method: "get",
                url: "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                timeout: 500,
                headers: { "Metadata-Flavor": "Google" }
            });
            return response.data;
        });
        const result = await timeoutPromise(Promise.resolve(provider()), 650, "Firebase status-queue authentication timed out.");
        const token = String(result && (result.access_token || result.token) || "");
        if (!token) throw new Error("Firebase status-queue authentication returned no token.");
        accessTokenCache = {
            token,
            expiresAt: now() + Math.max(5 * 60 * 1000, Number(result.expires_in || 3600) * 1000)
        };
        return token;
    }

    async function enqueueStatusJob(interaction, parsed) {
        const token = await getAccessToken();
        const projectId = getProjectId();
        const jobId = randomUUID();
        const response = await axios({
            method: "post",
            url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${STATUS_JOB_COLLECTION}`,
            params: { documentId: jobId },
            data: {
                fields: {
                    caseId: { stringValue: parsed.caseId },
                    status: { stringValue: parsed.value },
                    discordThreadId: { stringValue: String(interaction.channel_id || "") },
                    discordUserId: { stringValue: discordInteractionUserId(interaction) },
                    createdAt: { timestampValue: new Date(now()).toISOString() }
                }
            },
            timeout: 1200,
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        });
        if (!response || !response.data || !response.data.name) throw new Error("Firestore did not accept the status job.");
        return jobId;
    }

    async function discordRequest(method, path, data, config) {
        return axios({
            method,
            url: `${DISCORD_API}${path}`,
            data,
            timeout: 10000,
            headers: { Authorization: `Bot ${config.botToken}`, "Content-Type": "application/json" }
        });
    }

    async function setDiscordStatus(threadId, status, config) {
        const tagId = config.tags[status];
        const data = { archived: false, locked: false };
        if (tagId) data.applied_tags = [tagId];
        await discordRequest("patch", `/channels/${threadId}`, data, config);
    }

    async function ingestEmail(email, config) {
        const caseId = makeCaseId(email.gmailThreadId);
        const ref = db.collection(CASE_COLLECTION).doc(caseId);
        const snapshot = await ref.get();
        const existing = snapshot.exists ? snapshot.data() || {} : null;
        if (existing && Array.isArray(existing.processedMessageIds) && existing.processedMessageIds.includes(email.gmailMessageId)) {
            return { caseId, duplicate: true, discordThreadId: existing.discordThreadId };
        }

        if (!existing || !existing.discordThreadId) {
            const created = await discordRequest("post", `/channels/${config.forumChannelId}/threads`, buildCaseStarter(email, caseId, config), config);
            const discordThreadId = String(created.data && created.data.id || "");
            if (!/^\d+$/.test(discordThreadId)) throw new Error("Discord did not return the created case thread id.");
            await ref.set({
                caseId,
                gmailThreadId: email.gmailThreadId,
                latestGmailMessageId: email.gmailMessageId,
                senderAddress: email.senderAddress,
                from: email.from,
                subject: email.subject,
                discordThreadId,
                status: STATUS_KEYS.new,
                processedMessageIds: [email.gmailMessageId],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { caseId, duplicate: false, discordThreadId, created: true };
        }

        await discordRequest("post", `/channels/${existing.discordThreadId}/messages`, buildFollowup(email, caseId), config);
        await setDiscordStatus(existing.discordThreadId, STATUS_KEYS.new, config);
        await ref.set({
            latestGmailMessageId: email.gmailMessageId,
            senderAddress: email.senderAddress,
            from: email.from,
            subject: email.subject,
            status: STATUS_KEYS.new,
            processedMessageIds: admin.firestore.FieldValue.arrayUnion(email.gmailMessageId),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { caseId, duplicate: false, discordThreadId: existing.discordThreadId, created: false };
    }

    async function ingest(req, res) {
        if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
        try {
            const secret = getSharedSecret();
            if (!verifySignedIngest(req, secret, now())) return res.status(401).json({ ok: false, error: "invalid_signature" });
            const email = normalizeInboundEmail(decodeIngestEnvelope(req.body) || req.body);
            const result = await ingestEmail(email, getConfig());
            return res.status(200).json({ ok: true, ...result });
        } catch (error) {
            console.error("[supportDesk] ingest failed", { message: error && error.message });
            return res.status(500).json({ ok: false, error: "ingest_failed" });
        }
    }

    async function createDraft(interaction, parsed, config) {
        if (!SENDER_KEYS[parsed.value]) return { type: 4, data: { flags: 64, content: "That sender is not available." } };
        const body = modalValue(interaction, "reply_body");
        if (!body) return { type: 4, data: { flags: 64, content: "Write a reply before continuing." } };
        const caseRef = db.collection(CASE_COLLECTION).doc(parsed.caseId);
        const caseSnapshot = await caseRef.get();
        if (!caseSnapshot.exists) return { type: 4, data: { flags: 64, content: "This support case is no longer available." } };
        const supportCase = caseSnapshot.data() || {};
        if (String(supportCase.discordThreadId || "") !== String(interaction.channel_id || "")) {
            return { type: 4, data: { flags: 64, content: "This reply does not belong to the current support case." } };
        }
        const draftId = randomUUID();
        const expiresAt = new Date(now() + 10 * 60 * 1000);
        await db.collection(DRAFT_COLLECTION).doc(draftId).set({
            caseId: parsed.caseId,
            senderKey: parsed.value,
            body,
            createdBy: discordInteractionUserId(interaction),
            status: "preview",
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return previewResponse(draftId, SENDER_KEYS[parsed.value], body);
    }

    async function confirmDraft(interaction, parsed, config) {
        const userId = discordInteractionUserId(interaction);
        const draftRef = db.collection(DRAFT_COLLECTION).doc(parsed.caseId);
        const decision = parsed.value;
        const claimed = await db.runTransaction(async (transaction) => {
            const draftSnapshot = await transaction.get(draftRef);
            if (!draftSnapshot.exists) return { error: "This preview expired or was already handled." };
            const draft = draftSnapshot.data() || {};
            if (draft.createdBy !== userId) return { error: "Only the person who created this preview can send it." };
            const expiry = draft.expiresAt && typeof draft.expiresAt.toMillis === "function" ? draft.expiresAt.toMillis() : 0;
            if (expiry < now()) return { error: "This preview expired. Open Reply and try again." };
            if (draft.status !== "preview") return { error: "This reply was already handled." };
            transaction.update(draftRef, { status: decision === "send" ? "sending" : "cancelled", handledAt: admin.firestore.FieldValue.serverTimestamp() });
            return { draft };
        });
        if (claimed.error) return { immediate: { type: 4, data: { flags: 64, content: claimed.error } } };
        if (decision !== "send") return { immediate: { type: 7, data: { content: "Reply cancelled.", components: [] } } };

        const draft = claimed.draft;
        const caseRef = db.collection(CASE_COLLECTION).doc(draft.caseId);
        const caseSnapshot = await caseRef.get();
        if (!caseSnapshot.exists) {
            await draftRef.set({ status: "failed", error: "case_missing" }, { merge: true });
            return { immediate: { type: 4, data: { flags: 64, content: "The support case no longer exists." } } };
        }
        const supportCase = caseSnapshot.data() || {};
        if (String(supportCase.discordThreadId || "") !== String(interaction.channel_id || "")) {
            await draftRef.set({ status: "failed", error: "case_channel_mismatch" }, { merge: true });
            return { immediate: { type: 4, data: { flags: 64, content: "This confirmation does not belong to the current support case." } } };
        }

        return { deferred: true, draftRef, draft, supportCase, caseRef };
    }

    async function sendGmailReply(job, interaction, config) {
        const sender = SENDER_KEYS[job.draft.senderKey];
        const request = {
            kind: "send_reply",
            gmailMessageId: job.supportCase.latestGmailMessageId,
            senderKey: job.draft.senderKey,
            body: job.draft.body,
            discordUserId: discordInteractionUserId(interaction),
            caseId: job.draft.caseId
        };
        try {
            await callGmailEndpoint(request, config);
            await job.draftRef.set({ status: "sent", sentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await job.caseRef.set({ status: STATUS_KEYS.waitingCustomer, lastReplySender: sender.address, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await discordRequest("post", `/channels/${job.supportCase.discordThreadId}/messages`, {
                embeds: [{
                    title: `Reply sent as ${sender.label}`,
                    description: cleanText(job.draft.body, 1800),
                    color: 0x2ecc71,
                    timestamp: new Date(now()).toISOString(),
                    footer: { text: "Sent through Gmail and recorded in the original conversation" }
                }],
                allowed_mentions: { parse: [] }
            }, config);
            await setDiscordStatus(job.supportCase.discordThreadId, STATUS_KEYS.waitingCustomer, config);
            await editInteractionResponse(interaction, config, `Email sent as **${sender.label} <${sender.address}>**.`, []);
        } catch (error) {
            console.error("[supportDesk] reply failed", { caseId: job.draft.caseId, message: error && error.message });
            await job.draftRef.set({ status: "failed", error: cleanText(error && error.message, 120), failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await editInteractionResponse(interaction, config, "The email was not sent. The sender may need authorization or Gmail may be temporarily unavailable. Nothing was lost; open Reply to try again.", []);
        }
    }

    async function callGmailEndpoint(request, config) {
        const response = await axios({
            method: "post",
            url: config.gmailEndpoint,
            data: signedEnvelope(request, getSharedSecret(), now()),
            timeout: 20000,
            headers: { "Content-Type": "application/json" },
            maxRedirects: 5
        });
        if (!response.data || response.data.ok !== true) {
            const reason = response.data && response.data.error ? response.data.error : "gmail_rejected";
            throw new Error(reason);
        }
        return response.data;
    }

    async function editInteractionResponse(interaction, config, content, components) {
        await axios({
            method: "patch",
            url: `${DISCORD_API}/webhooks/${config.applicationId}/${interaction.token}/messages/@original`,
            data: { content, components: components || [], allowed_mentions: { parse: [] } },
            timeout: 10000,
            headers: { "Content-Type": "application/json" }
        });
    }

    async function processStatusJob(snapshot) {
        if (!snapshot || !snapshot.exists) return null;
        const job = snapshot.data() || {};
        const caseId = safeId(job.caseId);
        const status = String(job.status || "");
        const discordThreadId = safeId(job.discordThreadId);
        try {
            if (!caseId || !discordThreadId || !isManualStatus(status)) throw new Error("Invalid support status job.");
            const caseRef = db.collection(CASE_COLLECTION).doc(caseId);
            const caseSnapshot = await caseRef.get();
            if (!caseSnapshot.exists) throw new Error("Support case no longer exists.");
            const supportCase = caseSnapshot.data() || {};
            if (String(supportCase.discordThreadId || "") !== discordThreadId) throw new Error("Support status job channel mismatch.");
            if (!supportCase.gmailThreadId) throw new Error("Support case is missing its Gmail thread.");

            const config = getConfig();
            const results = await Promise.allSettled([
                setDiscordStatus(discordThreadId, status, config),
                callGmailEndpoint({
                    kind: "set_status",
                    gmailThreadId: supportCase.gmailThreadId,
                    status,
                    caseId,
                    discordUserId: String(job.discordUserId || "")
                }, config)
            ]);
            const errors = results
                .map((result, index) => result.status === "rejected"
                    ? `${index === 0 ? "discord" : "gmail"}:${cleanText(result.reason && result.reason.message, 120)}`
                    : null)
                .filter(Boolean);
            await caseRef.set({
                status,
                statusRequestedBy: String(job.discordUserId || ""),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                statusSync: {
                    status,
                    discordOk: results[0].status === "fulfilled",
                    gmailOk: results[1].status === "fulfilled",
                    errors,
                    completedAt: admin.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
            if (errors.length) {
                console.error("[supportDesk] status job incomplete", { caseId, status, errors });
            }
            return { status, errors };
        } finally {
            await snapshot.ref.delete().catch((error) => {
                console.warn("[supportDesk] status job cleanup failed", {
                    jobId: snapshot.id,
                    message: error && error.message
                });
            });
        }
    }

    async function interactions(req, res) {
        if (req.method !== "POST") return res.status(405).send("method_not_allowed");
        let config;
        try {
            config = getConfig();
            if (!verifyDiscordInteraction(req, config.publicKey, now())) return res.status(401).send("invalid request signature");
            const interaction = req.body || {};
            if (interaction.type === 1) return res.status(200).json({ type: 1 });
            if (!isAuthorizedInteraction(interaction, config)) {
                return res.status(200).json({ type: 4, data: { flags: 64, content: "Admin support access is required." } });
            }

            const parsed = parseCustomId(interaction.data && interaction.data.custom_id);
            if (interaction.type === 3 && parsed.action === "support_reply") {
                return res.status(200).json(buildReplyModal(parsed.caseId, parsed.value));
            }
            if (interaction.type === 3 && parsed.action === "support_status") {
                if (!isManualStatus(parsed.value)) {
                    return res.status(200).json({ type: 4, data: { flags: 64, content: "Unknown support status." } });
                }
                try {
                    // The REST enqueue avoids the Admin SDK's multi-second cold gRPC
                    // initialization. Once accepted, the Firestore create event owns
                    // the job and the HTTP response can safely finish.
                    await enqueueStatusJob(interaction, parsed);
                } catch (error) {
                    console.error("[supportDesk] status queue failed", {
                        caseId: parsed.caseId,
                        status: parsed.value,
                        message: error && error.message
                    });
                    return res.status(200).json({
                        type: 4,
                        data: { flags: 64, content: "The status update could not be queued. The case was left unchanged; try again." }
                    });
                }
                return res.status(200).json(statusQueuedResponse(parsed.value));
            }
            if (interaction.type === 5 && parsed.action === "support_compose") {
                return res.status(200).json(await createDraft(interaction, parsed, config));
            }
            if (interaction.type === 3 && parsed.action === "support_confirm") {
                const result = await confirmDraft(interaction, parsed, config);
                if (result.immediate) return res.status(200).json(result.immediate);
                res.status(200).json({ type: 6 });
                await sendGmailReply(result, interaction, config);
                return;
            }
            return res.status(200).json({ type: 4, data: { flags: 64, content: "That support action is no longer available." } });
        } catch (error) {
            console.error("[supportDesk] interaction failed", { message: error && error.message });
            return res.status(200).json({ type: 4, data: { flags: 64, content: "The support desk could not complete that action. No email was sent." } });
        }
    }

    return { enqueueStatusJob, ingest, interactions, ingestEmail, processStatusJob, sendGmailReply };
}

module.exports = {
    CASE_COLLECTION,
    DRAFT_COLLECTION,
    STATUS_JOB_COLLECTION,
    SENDER_KEYS,
    STATUS_KEYS,
    buildCaseStarter,
    buildFollowup,
    buildReplyModal,
    cleanText,
    createSupportDesk,
    decodeIngestEnvelope,
    isManualStatus,
    manualStatusLabel,
    makeCaseId,
    modalValue,
    normalizeInboundEmail,
    parseConfig,
    parseCustomId,
    previewResponse,
    signedEnvelope,
    statusQueuedResponse,
    verifyDiscordInteraction,
    verifySignedIngest
};
