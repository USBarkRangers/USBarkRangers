"use strict";

// ===== DISCORD OPS DELIVERY =====
// A second transport for alerts that already go to the alert inbox, plus the
// scheduled rollups. Discord is the command center: its only job is to say when
// something needs attention and to be where the team responds. The durable
// record stays in Firestore and in email, so this module is deliberately allowed
// to fail quietly — a Discord outage must never change payment, feedback, or
// error-reporting behavior.
//
// Channel routing and the three alert tiers mirror #read-me-first in the ops
// server. See 04-docs/plans/DISCORD_OPS_SERVER.md.

const axios = require("axios");

const WEBHOOK_MAP_ENV = "DISCORD_WEBHOOKS_JSON";
const ADMIN_ROLE_ENV = "DISCORD_ADMIN_ROLE_ID";

// Tier -> embed color and whether it pings. Only "critical" pings, which is what
// keeps the server useful instead of noisy.
const TIERS = Object.freeze({
    routine: Object.freeze({ color: 0x2ECC71, ping: false }),
    important: Object.freeze({ color: 0xF1C40F, ping: false }),
    critical: Object.freeze({ color: 0xE74C3C, ping: true })
});

const KNOWN_CHANNELS = Object.freeze([
    "systemStatus",
    "incidentResponse",
    "salesAndBilling",
    "supportInbox",
    "bugs",
    "featureRequests",
    "customerFeedback",
    "dailyBriefing",
    "dailyMetrics",
    "weeklyReport",
    "developmentUpdates"
]);

// Channels restricted to the Admin role in the ops server. Anything posted
// outside this set is visible to every member, so identifying detail is masked
// there. Keep in sync with the private channels in DISCORD_OPS_SERVER.md.
const ADMIN_ONLY_CHANNELS = Object.freeze(["salesAndBilling", "supportInbox", "adminDashboard"]);

function isAdminOnlyChannel(channel) {
    return ADMIN_ONLY_CHANNELS.includes(channel);
}

// Discord's documented embed limits. Blowing any of them fails the whole POST
// with a 400, which would silently drop the alert, so everything is clamped on
// the way out rather than trusting callers.
const LIMIT_TITLE = 256;
const LIMIT_DESCRIPTION = 4096;
const LIMIT_FIELD_NAME = 256;
const LIMIT_FIELD_VALUE = 1024;
const LIMIT_FIELDS = 25;
const LIMIT_FILES = 3;
const POST_TIMEOUT_MS = 5000;
// Uploading a few hundred KB of screenshots is not a 5-second job on a cold
// function, so file posts get their own budget.
const FILE_POST_TIMEOUT_MS = 20000;

// Injected in tests; null means "use axios".
let discordSender = null;

function setDiscordSender(sender) {
    discordSender = typeof sender === "function" ? sender : null;
}

function resetDiscordState() {
    discordSender = null;
}

function truncate(value, max) {
    if (value === undefined || value === null) return null;
    const text = String(value);
    if (!text) return null;
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Discord channels are readable by more people than the alert inbox is, and
// #bugs is not Admin-locked. Full identity stays in Firestore and email; the
// ops server gets enough to recognize a repeat reporter and no more.
function maskEmail(value) {
    const text = typeof value === "string" ? value.trim() : "";
    const at = text.indexOf("@");
    if (at < 1) return null;
    return `${text[0]}***${text.slice(at)}`;
}

function maskIdentifier(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return null;
    if (text.length <= 6) return `${text[0] || "?"}***`;
    return `${text.slice(0, 4)}…${text.slice(-2)}`;
}

// Everything lives in one secret so a new alert site does not mean threading
// another entry through a dozen runWith({ secrets: [...] }) lists. Shape:
//   { "adminRoleId": "123", "systemStatus": "https://discord.com/api/webhooks/…" }
//
// Tolerant on purpose: a malformed secret degrades to "Discord not configured"
// and never crashes a payment function on cold start.
function parseDiscordConfig(raw) {
    const empty = { channels: {}, adminRoleId: null };
    if (!raw || typeof raw !== "string") return empty;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error(`[discord] ${WEBHOOK_MAP_ENV} is not valid JSON; Discord delivery is disabled.`);
        return empty;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;

    const channels = {};
    for (const channel of KNOWN_CHANNELS) {
        const url = parsed[channel];
        // Only accept real Discord webhook URLs, so a typo can't turn an alert
        // into an outbound request to somewhere unexpected.
        if (typeof url === "string" && url.startsWith("https://discord.com/api/webhooks/")) {
            channels[channel] = url;
        }
    }

    const role = parsed.adminRoleId;
    const adminRoleId = typeof role === "string" && /^\d+$/.test(role.trim()) ? role.trim() : null;

    return { channels, adminRoleId };
}

function getDiscordConfig(options = {}) {
    if (options.discordConfig && typeof options.discordConfig === "object") return options.discordConfig;
    const env = options.env || process.env;
    return parseDiscordConfig(env[WEBHOOK_MAP_ENV]);
}

function getWebhookMap(options = {}) {
    if (options.webhookMap && typeof options.webhookMap === "object") return options.webhookMap;
    return getDiscordConfig(options).channels;
}

function getAdminRoleId(options = {}) {
    if (options.adminRoleId !== undefined) return options.adminRoleId || null;
    const fromConfig = getDiscordConfig(options).adminRoleId;
    if (fromConfig) return fromConfig;
    // Escape hatch so the role can be set without reissuing the webhook secret.
    const env = options.env || process.env;
    const raw = env[ADMIN_ROLE_ENV];
    return typeof raw === "string" && /^\d+$/.test(raw.trim()) ? raw.trim() : null;
}

function discordConfigured(options = {}) {
    return Object.keys(getWebhookMap(options)).length > 0;
}

// Attachments are optional and always defensive: this is the transport, and a
// malformed file must degrade to "no picture" rather than lose the alert.
function normalizeFiles(files) {
    if (!Array.isArray(files)) return [];
    return files
        .filter((file) => file && Buffer.isBuffer(file.buffer) && file.buffer.length > 0)
        .slice(0, LIMIT_FILES)
        .map((file, index) => ({
            name: typeof file.name === "string" && /^[a-z0-9._-]+$/i.test(file.name)
                ? file.name
                : `attachment-${index + 1}`,
            contentType: typeof file.contentType === "string" && file.contentType
                ? file.contentType
                : "application/octet-stream",
            buffer: file.buffer
        }));
}

function buildDiscordPayload({ title, description, fields, tier, url, footer, files }, options = {}) {
    const tierConfig = TIERS[tier] || TIERS.important;
    const embed = {
        title: truncate(title, LIMIT_TITLE) || "Untitled",
        color: tierConfig.color,
        timestamp: new Date().toISOString()
    };

    const desc = truncate(description, LIMIT_DESCRIPTION);
    if (desc) embed.description = desc;
    if (typeof url === "string" && url.startsWith("https://")) embed.url = url;
    if (footer) embed.footer = { text: truncate(footer, LIMIT_TITLE) };

    const cleanFields = (Array.isArray(fields) ? fields : [])
        .filter((field) => field && field.name && field.value !== undefined && field.value !== null && field.value !== "")
        .slice(0, LIMIT_FIELDS)
        .map((field) => ({
            name: truncate(field.name, LIMIT_FIELD_NAME),
            value: truncate(field.value, LIMIT_FIELD_VALUE),
            inline: field.inline !== false
        }));
    if (cleanFields.length) embed.fields = cleanFields;

    // Pull the first upload into the embed itself so triage sees the screenshot
    // without opening anything. The rest ride along as plain attachments.
    const attachments = normalizeFiles(files);
    if (attachments.length) embed.image = { url: `attachment://${attachments[0].name}` };

    const payload = { embeds: [embed] };

    // Only a critical alert pings, and only when the role id is configured —
    // an unresolved <@&...> renders as raw text, which looks broken.
    const roleId = getAdminRoleId(options);
    if (tierConfig.ping && roleId) {
        payload.content = `<@&${roleId}>`;
        payload.allowed_mentions = { parse: [], roles: [roleId] };
    } else {
        payload.allowed_mentions = { parse: [] };
    }

    return payload;
}

// Discord takes attachments as multipart: the embed JSON under `payload_json`
// and each upload under `files[n]`. Node 20 ships FormData and Blob natively and
// axios streams a spec FormData on its own, so this needs no new dependency.
function buildDiscordFormData(payload, files) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    files.forEach((file, index) => {
        form.append(`files[${index}]`, new Blob([file.buffer], { type: file.contentType }), file.name);
    });
    return form;
}

async function defaultDiscordSender(webhookUrl, payload, meta = {}) {
    const post = axios.post;
    const files = normalizeFiles(meta.files);

    if (!files.length) {
        await post(webhookUrl, payload, {
            timeout: POST_TIMEOUT_MS,
            headers: { "Content-Type": "application/json" }
        });
        return;
    }

    // axios sets the multipart boundary header from the FormData instance.
    await post(webhookUrl, buildDiscordFormData(payload, files), {
        timeout: FILE_POST_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
}

// Never throws. Returns a small result object so callers can log or assert, but
// callers are expected to ignore it: alert delivery is best-effort by design.
async function postDiscord(message, options = {}) {
    const channel = message && message.channel;
    if (!channel || !KNOWN_CHANNELS.includes(channel)) {
        console.error("[discord] refusing to post to unknown channel:", channel);
        return { posted: false, reason: "unknown_channel" };
    }

    const webhookUrl = getWebhookMap(options)[channel];
    if (!webhookUrl) return { posted: false, reason: "not_configured" };

    let payload;
    try {
        payload = buildDiscordPayload(message, options);
    } catch (err) {
        console.error("[discord] failed to build payload:", err && err.message);
        return { posted: false, reason: "build_failed" };
    }

    const sender = options.discordSender || discordSender || defaultDiscordSender;
    const files = normalizeFiles(message.files);
    try {
        await sender(webhookUrl, payload, { channel, tier: message.tier || "important", files });
        return { posted: true, channel, files: files.length };
    } catch (err) {
        // A Discord failure is logged and dropped. The email transport and the
        // Firestore record are the durable path.
        console.error("[discord] delivery failed:", channel, err && err.message);
        return { posted: false, reason: "send_failed" };
    }
}

module.exports = {
    postDiscord,
    buildDiscordPayload,
    buildDiscordFormData,
    normalizeFiles,
    parseDiscordConfig,
    getDiscordConfig,
    getWebhookMap,
    getAdminRoleId,
    discordConfigured,
    setDiscordSender,
    resetDiscordState,
    maskEmail,
    maskIdentifier,
    truncate,
    isAdminOnlyChannel,
    TIERS,
    KNOWN_CHANNELS,
    ADMIN_ONLY_CHANNELS,
    WEBHOOK_MAP_ENV,
    ADMIN_ROLE_ENV
};
