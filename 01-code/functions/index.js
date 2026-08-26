const functions = require('firebase-functions/v1');
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const axios = require("axios");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const { createHash, createHmac, randomUUID, timingSafeEqual } = require("crypto");
const nodemailer = require("nodemailer");
const opsDiscord = require("./opsDiscord.js");
const opsMetrics = require("./opsMetrics.js");
const analyticsReporting = require("./analyticsReporting.js");
const costReporting = require("./costReporting.js");
const dataIntegrity = require("./dataIntegrity.js");
const feedbackAttachments = require("./feedbackAttachments.js");
const routeRequestStrategy = require("./routeRequestStrategy.js");
const { ORS_ENDPOINTS } = require("./orsEndpoints.js");
const orsTelemetry = require("./orsTelemetry.js");
const { compactRouteResponse } = require("./routeResponseCompact.js");
const {
    parsePositiveInteger,
    makeBotRateLimitError,
    enforceConfiguredCallableRateLimit,
    warmConfiguredCallableRateLimitPath,
    getRateLimitRetrySeconds,
    enforcePremiumCallableRateLimit,
    enforcePremiumCallableRateLimits
} = require("./rateLimits.js");
const {
    createProviderAttemptBudget,
    getHeaderValue,
    parseRetryAfterMs,
    getOrsErrorStatus,
    getOrsWithRetry,
    postOrsWithRetry
} = require("./orsSafety.js");

// Initialize Firebase Admin SDK
admin.initializeApp();

// A resident Gen 1 instance can be alive while its first Firestore transaction
// still pays for credential and gRPC setup. Warm the exact transaction path on
// the compact-route instance during startup, before a customer can reach it.
// FUNCTION_TARGET keeps this one read out of every unrelated function process.
const compactRouteBackendReady = (() => {
    if (process.env.NODE_ENV === "test" || process.env.FUNCTION_TARGET !== "getPremiumRouteCompact") {
        return Promise.resolve();
    }

    const startedAt = Date.now();
    const db = admin.firestore();
    const warmupRef = db.doc("_analytics/ors_usage");
    return db.runTransaction(transaction => transaction.get(warmupRef))
        .then(() => {
            console.info("[routing] Compact route Firestore transaction path is ready.", {
                durationMs: Date.now() - startedAt
            });
        })
        .catch(error => {
            // A startup warmup is an optimization, never an availability gate.
            console.warn("[routing] Compact route Firestore warmup did not complete.", {
                durationMs: Date.now() - startedAt,
                message: error && error.message ? error.message : String(error)
            });
        });
})();

// Checkout normally scales to zero between purchases. Keep its resident
// instance's exact Firestore rate-limit transaction path ready so the first
// customer does not pay several seconds for credential and gRPC setup.
const checkoutBackendReady = (() => {
    if (process.env.NODE_ENV === "test" || process.env.FUNCTION_TARGET !== "createCheckoutSession") {
        return Promise.resolve();
    }

    const startedAt = Date.now();
    return warmConfiguredCallableRateLimitPath("createCheckoutSession")
        .then(() => {
            console.info("[payments] Checkout Firestore transaction path is ready.", {
                durationMs: Date.now() - startedAt
            });
        })
        .catch(error => {
            // Warmup is an optimization; checkout still performs the same
            // fail-closed transaction when a request arrives.
            console.warn("[payments] Checkout Firestore warmup did not complete.", {
                durationMs: Date.now() - startedAt,
                message: error && error.message ? error.message : String(error)
            });
        });
})();

// Keep admin callables compatible with the current admin page. The backend
// still enforces signed-in admin status plus per-admin rate limits.
const ADMIN_CALLABLE_OPTIONS = {};

const ADMIN_RATE_LIMITS = {
    extractParkData: { maxRequests: 20, windowMs: 60 * 1000 },
    syncToSpreadsheet: { maxRequests: 10, windowMs: 60 * 1000 }
};

const FEEDBACK_RATE_LIMIT = {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
    envMaxKey: "BARK_RATE_LIMIT_FEEDBACK_MAX",
    envWindowKey: "BARK_RATE_LIMIT_FEEDBACK_WINDOW_MS",
    message: "Feedback submission limit reached. Please try again shortly."
};

// Feedback is the one callable a signed-out person can reach, so it is the one
// place an abuser needs no account. Two limits stand in for the missing uid:
// a tight per-connection budget, and a ceiling across all signed-out reporters
// at once so a distributed run cannot flood the ops channels even while every
// single connection stays under its own limit. Signed-in reports are unaffected
// by both.
const ANONYMOUS_FEEDBACK_RATE_LIMIT = {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    envMaxKey: "BARK_RATE_LIMIT_ANON_FEEDBACK_MAX",
    envWindowKey: "BARK_RATE_LIMIT_ANON_FEEDBACK_WINDOW_MS",
    message: "That is as many reports as we can take from this connection in an hour."
};

const ANONYMOUS_FEEDBACK_GLOBAL_LIMIT = {
    maxRequests: 60,
    windowMs: 60 * 60 * 1000,
    envMaxKey: "BARK_RATE_LIMIT_ANON_FEEDBACK_GLOBAL_MAX",
    envWindowKey: "BARK_RATE_LIMIT_ANON_FEEDBACK_GLOBAL_WINDOW_MS",
    message: "We are taking a lot of reports right now. Please try again shortly."
};

// Caps how many client-error ALERT EMAILS a single user can trigger per window.
// Firestore records of client errors are NOT capped — every report is logged;
// only the email side is throttled so one user's broken screen can't flood.
const CLIENT_ERROR_RATE_LIMIT = {
    maxRequests: 15,
    windowMs: 60 * 60 * 1000,
    envMaxKey: "BARK_RATE_LIMIT_CLIENT_ERROR_MAX",
    envWindowKey: "BARK_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS"
};

const FUNCTION_FLAG_CONFIG = Object.freeze({
    getPremiumRoute: {
        envKey: "BARK_ENABLE_PREMIUM_ROUTE",
        message: "Route generation is paused for beta safety. Please try again after the next release update."
    },
    getPremiumGeocode: {
        envKey: "BARK_ENABLE_PREMIUM_GEOCODE",
        message: "Global town search is paused for beta safety. Local B.A.R.K. stop search still works."
    },
    createCheckoutSession: {
        envKey: "BARK_ENABLE_CHECKOUT",
        message: "Premium checkout is paused for this beta. Please try again after the next release update."
    }
});

function isDisabledFlagValue(value) {
    if (value === false) return true;
    if (value === true || value === undefined || value === null || value === "") return false;
    return ["0", "false", "off", "disabled", "no"].includes(String(value).trim().toLowerCase());
}

function isFunctionFlagEnabled(action, options = {}) {
    const config = FUNCTION_FLAG_CONFIG[action];
    if (!config) return true;

    const optionFlags = options.functionFlags || options.launchFlags || {};
    if (Object.prototype.hasOwnProperty.call(optionFlags, action)) {
        return optionFlags[action] !== false;
    }

    const env = options.env || process.env;
    return !isDisabledFlagValue(env[config.envKey]);
}

function requireFunctionFlagEnabled(action, options = {}) {
    if (isFunctionFlagEnabled(action, options)) return;

    const config = FUNCTION_FLAG_CONFIG[action] || {};
    console.warn("[launchFlags] Callable blocked by Stage 0 kill switch.", { action });
    throw new functions.https.HttpsError(
        "failed-precondition",
        config.message || "This feature is paused for beta safety."
    );
}

function getCallableUid(context) {
    return context && context.auth && context.auth.uid ? context.auth.uid : null;
}

async function isAdminUser(uid, token = {}) {
    if (token.admin === true || token.isAdmin === true) return true;

    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    return userDoc.exists && userDoc.data() && userDoc.data().isAdmin === true;
}

async function enforceAdminRateLimit(uid, action) {
    const limit = ADMIN_RATE_LIMITS[action];
    if (!limit) return;

    const now = Date.now();
    const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
    const windowEndsAt = windowStart + limit.windowMs;
    const safeUid = encodeURIComponent(uid);
    const safeAction = encodeURIComponent(action);
    const ref = admin.firestore()
        .collection("_adminRateLimits")
        .doc(`${safeAction}_${safeUid}_${windowStart}`);

    await admin.firestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

        if (currentCount >= limit.maxRequests) {
            const retrySeconds = Math.max(1, Math.ceil((windowEndsAt - now) / 1000));
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `Rate limit exceeded. Try again in ${retrySeconds} seconds.`
            );
        }

        transaction.set(ref, {
            uid,
            action,
            count: currentCount + 1,
            windowStart: Timestamp.fromMillis(windowStart),
            windowEndsAt: Timestamp.fromMillis(windowEndsAt),
            expiresAt: Timestamp.fromMillis(windowEndsAt + 24 * 60 * 60 * 1000),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

async function requireAdminCallable(context, action) {
    const uid = getCallableUid(context);
    if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in is required.");
    }

    const adminAllowed = await isAdminUser(uid, context.auth.token || {});
    if (!adminAllowed) {
        throw new functions.https.HttpsError("permission-denied", "Admin access is required.");
    }

    await enforceAdminRateLimit(uid, action);
}

function requireAuthCallable(context) {
    const uid = getCallableUid(context);
    if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in is required.");
    }
    return uid;
}

function getCallableAuthToken(context) {
    return context && context.auth && context.auth.token && typeof context.auth.token === "object"
        ? context.auth.token
        : {};
}

function getSignInProviderFromToken(token = {}) {
    const firebaseClaims = token.firebase && typeof token.firebase === "object" ? token.firebase : {};
    return typeof firebaseClaims.sign_in_provider === "string" ? firebaseClaims.sign_in_provider : "";
}

function isCallableEmailVerified(context) {
    const token = getCallableAuthToken(context);
    const provider = getSignInProviderFromToken(token);
    if (token.email_verified === true || token.email_verified === "true") return true;
    if (provider === "google.com") return true;
    if (provider === "password") return false;
    if (token.email && token.email_verified === false) return false;
    return true;
}

function requireVerifiedEmailCallable(context) {
    const uid = requireAuthCallable(context);
    if (!isCallableEmailVerified(context)) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "Please verify your email before continuing."
        );
    }
    return uid;
}

// Defaults, overridable by env var in production and by an options bag in tests.
function resolveRateLimitConfig(defaults, override, options = {}) {
    const env = options.env || process.env;
    const settings = override && typeof override === "object" ? override : {};
    return {
        maxRequests: parsePositiveInteger(
            settings.maxRequests === undefined ? env[defaults.envMaxKey] : settings.maxRequests,
            defaults.maxRequests
        ),
        windowMs: parsePositiveInteger(
            settings.windowMs === undefined ? env[defaults.envWindowKey] : settings.windowMs,
            defaults.windowMs
        ),
        message: typeof settings.message === "string" && settings.message.trim()
            ? settings.message.trim()
            : defaults.message
    };
}

function getFeedbackRateLimit(options = {}) {
    return resolveRateLimitConfig(FEEDBACK_RATE_LIMIT, options.feedbackRateLimit, options);
}

// One windowed counter, one transaction. Feedback's three limits — per signed-in
// user, per signed-out connection, and the signed-out ceiling — differ only in
// the document they count against and the numbers they enforce.
async function consumeFeedbackRateLimit({ firestore, docId, limit, now, meta, logContext }) {
    const db = firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        console.error("[feedback] Firestore transaction support is unavailable.", logContext);
        throw new functions.https.HttpsError("internal", "Feedback rate limit could not be verified.");
    }

    const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
    const windowEndsAt = windowStart + limit.windowMs;
    const ref = db.collection("_feedbackRateLimits").doc(`${docId}_${windowStart}`);

    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

        if (currentCount >= limit.maxRequests) {
            const retrySeconds = getRateLimitRetrySeconds(windowEndsAt, now);
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `${limit.message} Try again in ${retrySeconds} seconds.`
            );
        }

        transaction.set(ref, {
            ...meta,
            action: "submitFeedback",
            count: currentCount + 1,
            limit: limit.maxRequests,
            windowStart: Timestamp.fromMillis(windowStart),
            windowEndsAt: Timestamp.fromMillis(windowEndsAt),
            expiresAt: Timestamp.fromMillis(windowEndsAt + 24 * 60 * 60 * 1000),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

async function enforceFeedbackRateLimit(uid, options = {}) {
    await consumeFeedbackRateLimit({
        firestore: options.firestore,
        docId: encodeURIComponent(uid),
        limit: getFeedbackRateLimit(options),
        now: Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now(),
        meta: { uid },
        logContext: { uid }
    });
}

// The address is a bucket, not a record: it is hashed so Firestore never holds a
// reporter's IP, and truncated because 16 hex characters separate buckets fine.
// An unresolvable address shares one bucket, which is deliberately strict.
function getFeedbackConnectionKey(context) {
    const request = (context && context.rawRequest) || {};
    const headers = request.headers || {};
    const forwarded = typeof headers["x-forwarded-for"] === "string"
        ? headers["x-forwarded-for"].split(",")[0].trim()
        : "";
    const address = forwarded || (typeof request.ip === "string" ? request.ip : "");
    if (!address) return "unknown";
    return createHash("sha256").update(address).digest("hex").slice(0, 16);
}

async function enforceAnonymousFeedbackRateLimit(connectionKey, options = {}) {
    const now = Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now();
    const key = connectionKey || "unknown";

    // Per-connection first, so an abuser is stopped by their own budget before
    // they can spend anything from the shared ceiling.
    await consumeFeedbackRateLimit({
        firestore: options.firestore,
        docId: `anon_${key}`,
        limit: resolveRateLimitConfig(ANONYMOUS_FEEDBACK_RATE_LIMIT, options.anonymousFeedbackRateLimit, options),
        now,
        meta: { scope: "anonymous_connection", connectionKey: key },
        logContext: { scope: "anonymous_connection" }
    });

    await consumeFeedbackRateLimit({
        firestore: options.firestore,
        docId: "anon_global",
        limit: resolveRateLimitConfig(ANONYMOUS_FEEDBACK_GLOBAL_LIMIT, options.anonymousFeedbackGlobalLimit, options),
        now,
        meta: { scope: "anonymous_global" },
        logContext: { scope: "anonymous_global" }
    });
}

function cleanFeedbackText(value, maxLength = 2000) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
        throw new functions.https.HttpsError("invalid-argument", "Feedback message is required.");
    }
    if (text.length > maxLength) {
        throw new functions.https.HttpsError("invalid-argument", `Feedback must be ${maxLength} characters or fewer.`);
    }
    return text;
}

function cleanFeedbackString(value, maxLength = 200) {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, maxLength) : null;
}

function redactSensitiveDiagnosticText(value, maxLength = 500) {
    const text = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
    if (!text) return null;
    return text
        .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
        .replace(/\b(id_token|access_token|refresh_token|authorization|oobCode|apiKey)(=|%3D)([^\s&#]*)/gi, "$1$2[REDACTED]")
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]");
}

function cleanDiagnosticPath(value, maxLength = 300) {
    const safe = redactSensitiveDiagnosticText(value, maxLength);
    if (!safe) return null;
    return safe.split(/[?#]/, 1)[0] || "/";
}

// A signed-out reporter types their own address, so unlike a token email it has
// to be checked before it lands in a Discord field: one @, something either
// side, and no whitespace that could break the embed apart.
function cleanContactEmail(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > 254) return null;
    return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(text) ? text : null;
}

function cleanFeedbackType(value) {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    const allowed = new Set(["general", "bug", "idea", "support", "missing_location", "other"]);
    return allowed.has(text) ? text : "general";
}

function cleanFeedbackBrowserMetadata(value) {
    const metadata = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const viewportWidth = Number.parseInt(metadata.viewportWidth, 10);
    const viewportHeight = Number.parseInt(metadata.viewportHeight, 10);

    return {
        userAgent: cleanFeedbackString(metadata.userAgent, 300),
        platform: cleanFeedbackString(metadata.platform, 80),
        language: cleanFeedbackString(metadata.language, 40),
        path: cleanDiagnosticPath(metadata.path, 200),
        viewportWidth: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : null,
        viewportHeight: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : null
    };
}

// Signed out is allowed here, and only here. Losing those reports was worse than
// the exposure: the people most likely to hit something broken are the ones who
// never got as far as an account. What signing out costs is screenshots (they
// would be an unauthenticated upload relayed straight to a team channel) and
// identity, which becomes self-reported and is labelled that way in Discord.
async function handleSubmitFeedback(requestOrData, context, options = {}) {
    const uid = getCallableUid(context);
    const payload = getCallablePayload(requestOrData);
    const message = cleanFeedbackText(payload.message || payload.text);
    const type = cleanFeedbackType(payload.type);
    const browser = cleanFeedbackBrowserMetadata(payload.browser || payload.metadata);

    // Screenshots are validated before the rate limit is spent, so a rejected
    // image does not cost the reporter one of their submissions for the hour.
    const screenshots = feedbackAttachments.normalizeFeedbackScreenshots(payload.screenshots);
    if (screenshots.error) {
        throw new functions.https.HttpsError("invalid-argument", screenshots.error);
    }
    if (!uid && screenshots.files.length) {
        throw new functions.https.HttpsError("invalid-argument", "Sign in to send screenshots with a report.");
    }

    const token = getCallableAuthToken(context);
    const db = options.firestore || admin.firestore();

    if (uid) {
        await enforceFeedbackRateLimit(uid, options);
    } else {
        await enforceAnonymousFeedbackRateLimit(getFeedbackConnectionKey(context), options);
    }

    // The token wins whenever there is one: a signed-in reporter never gets to
    // claim someone else's name or address.
    const addPayload = {
        uid: uid || null,
        verifiedAccount: Boolean(uid),
        type,
        subject: cleanFeedbackString(payload.subject, 120),
        parkId: cleanFeedbackString(payload.parkId, 64),
        // Which entry point in the app produced this.
        surface: cleanFeedbackString(payload.surface, 40),
        message,
        browser,
        // Images are relayed to Discord and dropped. Only the count is durable.
        screenshotCount: screenshots.files.length,
        email: uid ? cleanFeedbackString(token.email, 254) : cleanContactEmail(payload.contactEmail),
        displayName: uid ? cleanFeedbackString(token.name, 120) : cleanFeedbackString(payload.contactName, 120),
        source: uid ? "app_feedback" : "app_feedback_anonymous",
        status: "new",
        createdAt: FieldValue.serverTimestamp()
    };

    await db.collection("feedback").add(addPayload);

    // Best-effort ops notification. Firestore is the durable record; a Discord
    // failure must never turn a saved submission into a client-visible error.
    try {
        await postFeedbackToDiscord({ ...addPayload, files: screenshots.files }, options);
    } catch (err) {
        console.error("[feedback] Discord notify issue:", err && err.message);
    }

    return { ok: true, screenshotCount: screenshots.files.length };
}

// Feedback lands in the channel that matches what it actually is, so triage
// happens where the work happens rather than in one undifferentiated firehose.
const FEEDBACK_DISCORD_CHANNELS = Object.freeze({
    bug: "bugs",
    idea: "featureRequests",
    support: "supportInbox",
    general: "customerFeedback",
    missing_location: "mapCorrections",
    other: "mapCorrections"
});

function postFeedbackToDiscord(record, options = {}) {
    const channel = FEEDBACK_DISCORD_CHANNELS[record.type] || "customerFeedback";
    const browser = record.browser && typeof record.browser === "object" ? record.browser : {};
    const files = Array.isArray(record.files) ? record.files : [];

    // #support-inbox is Admin-only, so a support request can carry the address
    // needed to reply. Every other channel is visible to the whole team and gets
    // a masked address; the full record is always in Firestore.
    const address = opsDiscord.isAdminOnlyChannel(channel)
        ? (record.email || null)
        : opsDiscord.maskEmail(record.email);

    // A signed-out reporter typed their own name and address, so nobody should
    // read them as identity. Say so next to the value rather than in a footnote.
    const verified = record.verifiedAccount !== false;
    const contact = verified
        ? address
        : (address ? `${address} (self-reported)` : "none given");

    const subject = record.subject ? ` — ${record.subject}` : "";

    return opsDiscord.postDiscord({
        channel,
        tier: "important",
        title: `New ${record.type.replace(/_/g, " ")} from ${record.displayName || "a user"}${subject}`,
        description: record.message,
        fields: [
            { name: "Contact", value: contact },
            { name: "Reporter", value: verified ? null : "Signed out — unverified" },
            { name: "Park ID", value: record.parkId },
            { name: "Opened from", value: record.surface },
            { name: "Path", value: browser.path },
            { name: "Platform", value: browser.platform },
            { name: "Screenshots", value: files.length ? String(files.length) : null }
        ],
        files,
        // The reporter is emailed the same report and can edit it before sending,
        // so the two halves can legitimately disagree.
        footer: "Firestore: feedback · email may have been edited before sending"
    }, options);
}

const PREMIUM_ENTITLEMENT_STATUSES = new Set(["active", "manual_active", "past_due", "paused", "cancelled_active"]);

function coerceTimestampMillis(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const millis = Date.parse(value);
        return Number.isFinite(millis) ? millis : null;
    }
    if (value instanceof Date) return value.getTime();
    if (value && typeof value.toMillis === "function") {
        const millis = Number(value.toMillis());
        return Number.isFinite(millis) ? millis : null;
    }
    if (value && Number.isFinite(Number(value.seconds))) {
        return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
    }
    return null;
}

function getNowMs(options = {}) {
    return Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
}

function normalizeEntitlement(raw, options = {}) {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const status = typeof value.status === "string" && value.status.trim()
        ? value.status.trim()
        : "free";
    const source = typeof value.source === "string" && value.source.trim()
        ? value.source.trim()
        : "none";
    const expiresAtMs = coerceTimestampMillis(value.expiresAt);
    const accessCodeActive = source === "access_code" &&
        status === "access_code_active" &&
        expiresAtMs !== null &&
        expiresAtMs > getNowMs(options);
    const premium = value.premium === true && (
        PREMIUM_ENTITLEMENT_STATUSES.has(status) ||
        accessCodeActive
    );

    return {
        premium,
        status,
        source,
        manualOverride: value.manualOverride === true,
        currentPeriodEnd: value.currentPeriodEnd === undefined ? null : value.currentPeriodEnd,
        expiresAt: value.expiresAt === undefined ? null : value.expiresAt,
        expiresAtMs
    };
}

function isEffectivePremium(raw, options = {}) {
    return normalizeEntitlement(raw, options).premium === true;
}

async function requirePremiumCallable(context, action, options = {}) {
    const uid = requireVerifiedEmailCallable(context);
    const db = options.firestore || admin.firestore();

    let userDoc;
    try {
        userDoc = await db.collection("users").doc(uid).get();
    } catch (error) {
        console.error(`[premium] Entitlement lookup failed for ${action || "premium callable"}.`, {
            uid,
            message: error && error.message ? error.message : String(error)
        });
        throw new functions.https.HttpsError("internal", "Premium entitlement could not be verified.");
    }

    const userData = userDoc && userDoc.exists && typeof userDoc.data === "function" ? userDoc.data() : {};
    const entitlement = normalizeEntitlement(userData && userData.entitlement, options);
    if (!entitlement.premium) {
        console.warn(`[premium] Premium callable denied for ${action || "premium callable"}.`, {
            uid,
            status: entitlement.status,
            source: entitlement.source
        });
        throw new functions.https.HttpsError("permission-denied", "Premium entitlement is required.");
    }

    return { uid, entitlement };
}

function throwHttpsError(error, fallbackMessage) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", fallbackMessage);
}

function cleanLeaderboardString(value, fallback, maxLength = 80) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return fallback;
    return text.slice(0, maxLength);
}

function sanitizeLeaderboardWalkPoints(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(Math.round(parsed * 100) / 100);
}

function getLeaderboardVisitId(visit, index) {
    if (!visit || typeof visit !== "object") return `unknown_${index}`;
    const rawId = visit.id || visit.parkId || visit.placeId || visit.pinId || visit.name || "";
    const id = typeof rawId === "string" ? rawId.trim() : String(rawId || "").trim();
    return id || `unknown_${index}`;
}

function getNormalizedLeaderboardSiteName(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getLeaderboardCoordinateKey(lat, lng) {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return "";
    return `${parsedLat.toFixed(5)},${parsedLng.toFixed(5)}`;
}

function getLeaderboardVisitSiteKey(visit, index) {
    if (!visit || typeof visit !== "object") return getLeaderboardVisitId(visit, index);

    const nameKey = getNormalizedLeaderboardSiteName(visit.name);
    const coordinateKey = getLeaderboardCoordinateKey(visit.lat, visit.lng);
    if (nameKey && coordinateKey) return `${nameKey}|${coordinateKey}`;

    return getLeaderboardVisitId(visit, index);
}

function calculateServerLeaderboardScore(userData) {
    const data = userData && typeof userData === "object" && !Array.isArray(userData) ? userData : {};
    const visits = Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
    const uniqueVisits = new Map();

    visits.forEach((visit, index) => {
        const siteKey = getLeaderboardVisitSiteKey(visit, index);
        const existing = uniqueVisits.get(siteKey) || { verified: false };
        existing.verified = existing.verified || Boolean(visit && visit.verified === true);
        uniqueVisits.set(siteKey, existing);
    });

    let verifiedCount = 0;
    uniqueVisits.forEach((visit) => {
        if (visit.verified) verifiedCount += 1;
    });

    const totalVisited = uniqueVisits.size;
    const walkPoints = sanitizeLeaderboardWalkPoints(data.walkPoints);
    const totalPoints = totalVisited + verifiedCount + walkPoints;

    return {
        totalPoints,
        totalVisited,
        verifiedCount,
        walkPoints,
        hasVerified: verifiedCount > 0
    };
}

async function handleSyncLeaderboardScore(requestOrData, context, options = {}) {
    const uid = requireAuthCallable(context);
    await enforceConfiguredCallableRateLimit(uid, "syncLeaderboardScore", options);
    const db = options.firestore || admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const leaderboardRef = db.collection("leaderboard").doc(uid);
    const deletedUserRef = db.collection("_deletedUsers").doc(uid);
    const token = context && context.auth && context.auth.token ? context.auth.token : {};

    let result = null;

    await db.runTransaction(async (transaction) => {
        // Firebase ID tokens issued before account deletion can remain valid for
        // a short period. The deletion tombstone is therefore the authoritative
        // server-side gate: a retained token must never recreate private or
        // public account records after deletion has completed.
        const deletedUserSnap = await transaction.get(deletedUserRef);
        if (deletedUserSnap && deletedUserSnap.exists) {
            result = { ignored: true, reason: "account_deleted" };
            return;
        }

        const userSnap = await transaction.get(userRef);
        const userData = userSnap && userSnap.exists && typeof userSnap.data === "function"
            ? userSnap.data()
            : {};
        const score = calculateServerLeaderboardScore(userData);
        const displayName = cleanLeaderboardString(userData.displayName, cleanLeaderboardString(token.name, "Bark Ranger"));
        const photoURL = cleanLeaderboardString(userData.photoURL, cleanLeaderboardString(token.picture, "", 500), 500);
        const timestamp = FieldValue.serverTimestamp();

        const leaderboardPayload = {
            displayName,
            photoURL,
            totalPoints: score.totalPoints,
            totalVisited: score.totalVisited,
            hasVerified: score.hasVerified,
            lastUpdated: timestamp
        };

        transaction.set(userRef, {
            displayName,
            totalPoints: score.totalPoints,
            totalVisited: score.totalVisited,
            hasVerified: score.hasVerified,
            leaderboardSyncedAt: timestamp
        }, { merge: true });

        transaction.set(leaderboardRef, leaderboardPayload, { merge: true });

        result = {
            totalPoints: score.totalPoints,
            totalVisited: score.totalVisited,
            hasVerified: score.hasVerified
        };
    });

    return result;
}

const CANONICAL_PARK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanSheetCell(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function getCanonicalParkId(value) {
    const parkId = cleanSheetCell(value);
    return CANONICAL_PARK_ID_PATTERN.test(parkId) ? parkId : '';
}

function parseManualCoordinate(value, min, max) {
    const cleaned = cleanSheetCell(value);
    if (!cleaned) return null;

    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined;
    return parsed;
}

function getManualCoordinates(data) {
    const rawLat = cleanSheetCell(data && (data.lat ?? data.latitude));
    const rawLng = cleanSheetCell(data && (data.lng ?? data.long ?? data.longitude));
    if (!rawLat && !rawLng) return null;

    const lat = parseManualCoordinate(rawLat, -90, 90);
    const lng = parseManualCoordinate(rawLng, -180, 180);
    if (lat === undefined || lng === undefined || lat === null || lng === null) {
        throw new functions.https.HttpsError("invalid-argument", "Manual latitude and longitude must both be valid coordinates.");
    }

    return { lat, lng };
}

// ============================================================================
// 1. LEGACY MAP FUNCTIONS (ROUTING & LEADERBOARD)
// ============================================================================

const ORS_DIRECTIONS_URL = ORS_ENDPOINTS.directions;
const ORS_SNAP_URL = ORS_ENDPOINTS.snap;
const ORS_GEOCODE_URL = ORS_ENDPOINTS.geocode;
const ROUTE_SNAP_RADIUS_METERS = 2000;
const ROUTE_MAX_COORDINATES = 40;
const ROUTE_FALLBACK_GEOCODE_RADIUS_KM = 50;
const ROUTE_FALLBACK_GEOCODE_SIZE = 10;
const ROUTE_FALLBACK_CANDIDATE_LIMIT = 6;
const ROUTE_FALLBACK_POINT_LIMIT = 4;

function getCallablePayload(requestOrData) {
    return requestOrData && requestOrData.data ? requestOrData.data : requestOrData || {};
}

function getOrsApiKey(options = {}) {
    return typeof options.getOrsApiKey === "function" ? options.getOrsApiKey() : process.env.ORS_API_KEY;
}

function isValidRouteCoordinatePair(pair) {
    return Array.isArray(pair) &&
        pair.length >= 2 &&
        Number.isFinite(Number(pair[0])) &&
        Number.isFinite(Number(pair[1]));
}

function normalizeRouteCoordinatePair(pair) {
    if (!isValidRouteCoordinatePair(pair)) return null;
    const longitude = Number(pair[0]);
    const latitude = Number(pair[1]);
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    return [longitude, latitude];
}

function normalizeRouteCoordinates(coordinates) {
    if (!Array.isArray(coordinates)) return null;
    const normalized = coordinates.map(normalizeRouteCoordinatePair);
    return normalized.every(Boolean) ? normalized : null;
}

function getSnappedRouteLocations(rawCoordinates, snapPayload) {
    const locations = snapPayload && Array.isArray(snapPayload.locations)
        ? snapPayload.locations
        : [];

    if (locations.length !== rawCoordinates.length) {
        return rawCoordinates.map(() => null);
    }

    return rawCoordinates.map((_coordinate, index) => {
        const snappedLocation = locations[index] && locations[index].location;
        return normalizeRouteCoordinatePair(snappedLocation);
    });
}

function extractSnappedRouteCoordinates(rawCoordinates, snapPayload) {
    const snapped = getSnappedRouteLocations(rawCoordinates, snapPayload);
    return rawCoordinates.map((coordinate, index) => snapped[index] || coordinate);
}

function normalizeRouteWaypoints(waypoints, coordinates) {
    const normalizedCoordinates = Array.isArray(coordinates) ? coordinates : [];
    return normalizedCoordinates.map((coordinate, index) => {
        const waypoint = Array.isArray(waypoints) ? waypoints[index] : null;
        return {
            name: (cleanOptionalString(waypoint && waypoint.name) || "").slice(0, 200),
            state: (cleanOptionalString(waypoint && waypoint.state) || "").slice(0, 100),
            country: (cleanOptionalString(waypoint && waypoint.country) || "US").slice(0, 10),
            coordinate
        };
    });
}

function normalizeRouteSearchText(value) {
    return cleanOptionalString(value)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function getRouteSearchTokens(value) {
    const normalized = normalizeRouteSearchText(value);
    if (!normalized) return [];
    return normalized
        .split(/\s+/)
        .filter(token => token.length >= 3);
}

function calculateCoordinateDistanceMeters(a, b) {
    const first = normalizeRouteCoordinatePair(a);
    const second = normalizeRouteCoordinatePair(b);
    if (!first || !second) return Number.POSITIVE_INFINITY;

    const toRadians = degrees => degrees * Math.PI / 180;
    const earthRadiusMeters = 6371000;
    const lon1 = toRadians(first[0]);
    const lat1 = toRadians(first[1]);
    const lon2 = toRadians(second[0]);
    const lat2 = toRadians(second[1]);
    const deltaLat = lat2 - lat1;
    const deltaLon = lon2 - lon1;
    const haversine = Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getGeocodeFeatureLabel(feature) {
    const properties = feature && feature.properties ? feature.properties : {};
    return cleanOptionalString(properties.label) || cleanOptionalString(properties.name);
}

function scoreRouteFallbackFeature(feature, waypoint, coordinate) {
    const featureCoordinate = normalizeRouteCoordinatePair(feature && feature.geometry && feature.geometry.coordinates);
    const label = getGeocodeFeatureLabel(feature);
    if (!featureCoordinate || !label || !waypoint || !waypoint.name) return null;

    const labelText = normalizeRouteSearchText(label);
    const waypointText = normalizeRouteSearchText(waypoint.name);
    const tokens = getRouteSearchTokens(waypoint.name);
    const matchedTokens = tokens.filter(token => labelText.includes(token));
    if (matchedTokens.length === 0) return null;

    const distanceMeters = calculateCoordinateDistanceMeters(coordinate, featureCoordinate);
    const confidence = Number(feature && feature.properties && feature.properties.confidence) || 0;
    const fullNameBonus = waypointText && labelText.includes(waypointText) ? 100 : 0;
    const stateBonus = waypoint.state && labelText.includes(normalizeRouteSearchText(waypoint.state)) ? 20 : 0;
    const score = fullNameBonus +
        stateBonus +
        matchedTokens.length * 25 +
        confidence * 10 -
        (distanceMeters / 1000);

    return {
        coordinate: featureCoordinate,
        label,
        score,
        distanceMeters
    };
}

async function fetchRouteFallbackCandidates(coordinate, waypoint, apiKey, options = {}) {
    if (!waypoint || !waypoint.name) return [];

    const get = options.axiosGet || axios.get;
    const params = new URLSearchParams({
        api_key: apiKey,
        text: waypoint.state ? `${waypoint.name} ${waypoint.state}` : waypoint.name,
        size: String(ROUTE_FALLBACK_GEOCODE_SIZE),
        "boundary.circle.lat": String(coordinate[1]),
        "boundary.circle.lon": String(coordinate[0]),
        "boundary.circle.radius": String(ROUTE_FALLBACK_GEOCODE_RADIUS_KM)
    });
    if (waypoint.country) params.set("boundary.country", waypoint.country);

    const response = await getOrsWithRetry(get, `${ORS_GEOCODE_URL}?${params.toString()}`, options);
    const features = response && response.data && Array.isArray(response.data.features)
        ? response.data.features
        : [];

    return features
        .map(feature => scoreRouteFallbackFeature(feature, waypoint, coordinate))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, ROUTE_FALLBACK_CANDIDATE_LIMIT);
}

async function resolveRouteFallbackCoordinate(coordinate, waypoint, apiKey, options = {}) {
    const candidates = await fetchRouteFallbackCandidates(coordinate, waypoint, apiKey, options);
    if (candidates.length === 0) return null;

    const post = options.axiosPost || axios.post;
    const response = await postOrsWithRetry(post, ORS_SNAP_URL, {
        locations: candidates.map(candidate => candidate.coordinate),
        radius: Number.isFinite(Number(options.routeSnapRadiusMeters))
            ? Number(options.routeSnapRadiusMeters)
            : ROUTE_SNAP_RADIUS_METERS
    }, {
        headers: {
            "Authorization": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
    }, options);

    const snapped = getSnappedRouteLocations(candidates.map(candidate => candidate.coordinate), response.data);
    const resolvedIndex = snapped.findIndex(Boolean);
    if (resolvedIndex === -1) return null;

    console.info("[routing] Resolved unsnappable waypoint through local geocode fallback.", {
        waypoint: waypoint.name,
        candidate: candidates[resolvedIndex].label,
        candidateDistanceMeters: Math.round(candidates[resolvedIndex].distanceMeters)
    });
    return snapped[resolvedIndex];
}

async function snapRouteCoordinates(coordinates, apiKey, options = {}) {
    const post = options.axiosPost || axios.post;
    const radius = Number.isFinite(Number(options.routeSnapRadiusMeters))
        ? Number(options.routeSnapRadiusMeters)
        : ROUTE_SNAP_RADIUS_METERS;

    try {
        const response = await postOrsWithRetry(post, ORS_SNAP_URL, {
            locations: coordinates,
            radius
        }, {
            headers: {
                "Authorization": apiKey,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        }, options);
        const snapped = getSnappedRouteLocations(coordinates, response.data);
        const waypoints = normalizeRouteWaypoints(options.waypoints, coordinates);
        const unresolvedIndexes = snapped
            .map((coordinate, index) => coordinate ? null : index)
            .filter(index => index !== null);
        const fallbackPointLimit = Number.isFinite(Number(options.routeFallbackPointLimit))
            ? Math.max(0, Math.floor(Number(options.routeFallbackPointLimit)))
            : ROUTE_FALLBACK_POINT_LIMIT;
        if (unresolvedIndexes.length > fallbackPointLimit) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                `This route has ${unresolvedIndexes.length} off-road stops; the safe recovery limit is ${fallbackPointLimit}. Move or remove an off-road stop, then try again.`,
                {
                    reason: "too-many-off-road-stops",
                    unresolvedWaypointIndexes: unresolvedIndexes.slice(0, fallbackPointLimit + 1),
                    fallbackPointLimit
                }
            );
        }

        for (let index = 0; index < snapped.length; index += 1) {
            if (snapped[index]) continue;

            try {
                snapped[index] = await resolveRouteFallbackCoordinate(
                    coordinates[index],
                    waypoints[index],
                    apiKey,
                    options
                );
            } catch (error) {
                if (error instanceof functions.https.HttpsError) throw error;
                console.warn("[routing] ORS fallback geocode failed; keeping original waypoint coordinate.", {
                    waypoint: waypoints[index] && waypoints[index].name,
                    message: error && error.message ? error.message : String(error)
                });
            }
        }

        return coordinates.map((coordinate, index) => snapped[index] || coordinate);
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.warn("[routing] ORS snap failed; falling back to original waypoint coordinates.", {
            message: error && error.message ? error.message : String(error)
        });
        return coordinates;
    }
}

const LEMONSQUEEZY_API_ORIGIN = "https://api.lemonsqueezy.com";
const LEMONSQUEEZY_CHECKOUTS_URL = `${LEMONSQUEEZY_API_ORIGIN}/v1/checkouts`;
const LEMONSQUEEZY_SUBSCRIPTIONS_URL = `${LEMONSQUEEZY_API_ORIGIN}/v1/subscriptions`;
const LEMONSQUEEZY_CUSTOMERS_URL = `${LEMONSQUEEZY_API_ORIGIN}/v1/customers`;
const DEFAULT_LEMONSQUEEZY_STORE_ID = "363425";
const DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID = "1604336";
const DEFAULT_APP_BASE_URL = "https://outswarming.github.io/bark-ranger-map/";
const CANONICAL_APP_ORIGIN = "https://usbarkrangersmap.com";
const LEMONSQUEEZY_STORE_HOST = "usbarkrangers.lemonsqueezy.com";
const BARK_LEMON_MODE_ENV = "BARK_LEMON_MODE";
const BARK_LEMONSQUEEZY_STORE_ID_ENV = "BARK_LEMONSQUEEZY_STORE_ID";
const BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID_ENV = "BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID";
const BARK_LEMONSQUEEZY_SUPPORTER_VARIANT_ID_ENV = "BARK_LEMONSQUEEZY_SUPPORTER_VARIANT_ID";
const BARK_APP_BASE_URL_ENV = "BARK_APP_BASE_URL";
const LEMONSQUEEZY_LIVE_APPROVAL_ENV = "BARK_LEMON_LIVE_MODE_APPROVAL";
const LEMONSQUEEZY_LIVE_APPROVAL_VALUE = "CARTER_APPROVED_LIVE_RC";
const LEMONSQUEEZY_MODE_LOCK_REASON = "Lemon Squeezy live mode remains locked until Carter explicitly approves the final RC switch.";
const SUPPORTER_CUSTOM_PRICE_CENTS = 4900;
const LEMONSQUEEZY_SUPPORTED_EVENTS = new Set([
    "subscription_created",
    "subscription_updated",
    "subscription_resumed",
    "subscription_paused",
    "subscription_unpaused",
    "subscription_plan_changed",
    "subscription_payment_success",
    "subscription_payment_recovered",
    "subscription_payment_failed",
    "subscription_expired",
    "subscription_cancelled",
    "subscription_payment_refunded",
    "order_refunded"
]);
const LEMONSQUEEZY_MONEY_EVENTS = new Set([
    "subscription_created",
    "subscription_payment_success",
    "subscription_payment_recovered",
    "subscription_payment_failed",
    "subscription_payment_refunded",
    "order_refunded"
]);
const LEMONSQUEEZY_PROCESSED_EVENTS_COLLECTION = "_lemonSqueezyWebhookEvents";
const LEMONSQUEEZY_EVENT_STATUS_RANK = Object.freeze({
    active: 100,
    paused: 150,
    past_due: 200,
    cancelled_active: 300,
    canceled: 400,
    expired: 500,
    refunded: 600
});
const ACCESS_CODE_AUDIENCES = new Set(["admin_mod", "vip", "support", "tester", "general"]);
const CHECKOUT_TIERS = Object.freeze({
    standard: Object.freeze({
        id: "standard",
        plan: "annual",
        customPlan: "standard_annual",
        productName: "US BARK Rangers Premium",
        productDescription: "Annual Premium access for BARK Ranger map tools, offline support, and route planning."
    }),
    supporter: Object.freeze({
        id: "supporter",
        plan: "supporter_annual",
        customPlan: "supporter_annual",
        productName: "US BARK Rangers Supporter",
        productDescription: "Annual Premium access plus extra support for new BARK Ranger features."
    })
});

function cleanOptionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanOptionalId(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

function isSafeProviderId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isPositiveIntegerString(value) {
    return typeof value === "string" && /^[1-9][0-9]*$/.test(value.trim());
}

function getRequiredPositiveId(value, envKey) {
    const text = cleanOptionalString(value);
    if (!isPositiveIntegerString(text)) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            `${envKey} must be configured as a positive numeric Lemon Squeezy id.`
        );
    }
    return text;
}

function getRequiredHttpsUrl(value, envKey) {
    const url = normalizeHttpsUrl(value);
    if (!url) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            `${envKey} must be configured as an HTTPS URL.`
        );
    }
    return url;
}

function getRequiredCanonicalAppUrl(value, envKey) {
    const normalized = getRequiredHttpsUrl(value, envKey);
    const url = new URL(normalized);
    if (url.origin !== CANONICAL_APP_ORIGIN || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            `${envKey} must be the canonical ${CANONICAL_APP_ORIGIN}/ origin.`
        );
    }
    url.hash = "";
    url.search = "";
    return url.toString();
}

function getLemonSqueezyProviderConfig(options = {}) {
    const env = options.env || process.env;
    const mode = requireValidLemonSqueezyMode(options);
    const storeId = mode.mode === "live"
        ? getRequiredPositiveId(
            options.storeId || env[BARK_LEMONSQUEEZY_STORE_ID_ENV],
            BARK_LEMONSQUEEZY_STORE_ID_ENV
        )
        : DEFAULT_LEMONSQUEEZY_STORE_ID;
    const annualVariantId = mode.mode === "live"
        ? getRequiredPositiveId(
            options.annualVariantId || env[BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID_ENV],
            BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID_ENV
        )
        : DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID;
    const supporterVariantIdRaw = options.supporterVariantId || env[BARK_LEMONSQUEEZY_SUPPORTER_VARIANT_ID_ENV];
    const supporterVariantId = cleanOptionalString(supporterVariantIdRaw)
        ? getRequiredPositiveId(
            supporterVariantIdRaw,
            BARK_LEMONSQUEEZY_SUPPORTER_VARIANT_ID_ENV
        )
        : null;
    const appBaseUrl = mode.mode === "live"
        ? getRequiredCanonicalAppUrl(
            options.appBaseUrl || env[BARK_APP_BASE_URL_ENV],
            BARK_APP_BASE_URL_ENV
        )
        : DEFAULT_APP_BASE_URL;

    return {
        storeId,
        annualVariantId,
        supporterVariantId,
        appBaseUrl,
        mode
    };
}

function getLemonSqueezyModeConfig(options = {}) {
    if (options.mode && typeof options.mode === "object" && options.mode.mode) {
        return options.mode;
    }
    const env = options.env || process.env;
    const requestedMode = cleanOptionalString(options.lemonMode) ||
        cleanOptionalString(env[BARK_LEMON_MODE_ENV]) ||
        "test";
    const normalizedMode = requestedMode.toLowerCase();
    const liveRequested = normalizedMode === "live";
    const approvalValue = cleanOptionalString(options.liveModeApproval) ||
        cleanOptionalString(env[LEMONSQUEEZY_LIVE_APPROVAL_ENV]);
    const liveModeApproved = approvalValue === LEMONSQUEEZY_LIVE_APPROVAL_VALUE;
    const activeMode = liveRequested && liveModeApproved ? "live" : "test";
    return {
        mode: activeMode,
        requestedMode: normalizedMode,
        checkoutTestMode: activeMode !== "live",
        acceptLiveWebhooks: activeMode === "live",
        liveModeApproved,
        liveModeConfigured: !liveRequested || liveModeApproved,
        approvalEnv: LEMONSQUEEZY_LIVE_APPROVAL_ENV,
        approvalValue: LEMONSQUEEZY_LIVE_APPROVAL_VALUE,
        lockReason: LEMONSQUEEZY_MODE_LOCK_REASON
    };
}

function requireValidLemonSqueezyMode(options = {}) {
    const mode = getLemonSqueezyModeConfig(options);
    if (mode.requestedMode !== "test" && mode.requestedMode !== "live") {
        throw new functions.https.HttpsError(
            "failed-precondition",
            `${BARK_LEMON_MODE_ENV} must be "test" or "live".`
        );
    }
    if (mode.requestedMode === "live" && !mode.liveModeApproved) {
        console.error("[payments] Lemon Squeezy live mode requested without approval gate.", {
            approvalEnv: mode.approvalEnv
        });
        throw new functions.https.HttpsError(
            "failed-precondition",
            "Premium checkout is not configured for live mode yet."
        );
    }
    return mode;
}

function shouldAcceptLemonSqueezyWebhookMode(attributes, options = {}) {
    const mode = getLemonSqueezyModeConfig(options);
    if (!attributes) return false;
    if (mode.mode === "live") return attributes.test_mode === false;
    return attributes.test_mode === true;
}

function normalizeHttpsUrl(value) {
    const text = cleanOptionalString(value);
    if (!text) return null;
    try {
        const url = new URL(text);
        return url.protocol === "https:" ? url.toString() : null;
    } catch (error) {
        return null;
    }
}

function normalizeLemonSqueezyStoreUrl(value, expectedPathPrefix) {
    const normalized = normalizeHttpsUrl(value);
    if (!normalized) return null;
    const url = new URL(normalized);
    const pathname = url.pathname || "/";
    if (url.hostname !== LEMONSQUEEZY_STORE_HOST || url.port || url.username || url.password) return null;
    if (expectedPathPrefix && pathname !== expectedPathPrefix && !pathname.startsWith(`${expectedPathPrefix}/`)) return null;
    return url.toString();
}

function getUrlLogParts(value) {
    const text = cleanOptionalString(value);
    if (!text) return { hostname: null, pathname: null };
    try {
        const url = new URL(text);
        return {
            hostname: url.hostname || null,
            pathname: url.pathname || "/"
        };
    } catch (error) {
        return { hostname: null, pathname: null };
    }
}

function isRootUrlPath(value) {
    const text = cleanOptionalString(value);
    if (!text) return false;
    try {
        const url = new URL(text);
        const pathname = url.pathname || "/";
        return pathname === "/" || pathname.trim() === "";
    } catch (error) {
        return false;
    }
}

function getLemonSqueezyConfig(options = {}) {
    const env = options.env || process.env;
    const apiKey = cleanOptionalString(options.apiKey) || cleanOptionalString(env.LEMONSQUEEZY_API_KEY);

    if (!apiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Checkout service is not configured.");
    }

    return {
        apiKey,
        ...getLemonSqueezyProviderConfig(options)
    };
}

function buildCheckoutReturnUrl(appBaseUrl, state) {
    const url = new URL(appBaseUrl || DEFAULT_APP_BASE_URL);
    url.searchParams.set("checkout", state);
    url.searchParams.set("provider", "lemonsqueezy");
    return url.toString();
}

function getCheckoutTierFromRequest(data = {}) {
    const tier = cleanOptionalString(data && data.tier) || CHECKOUT_TIERS.standard.id;
    if (!Object.prototype.hasOwnProperty.call(CHECKOUT_TIERS, tier)) {
        throw new functions.https.HttpsError("invalid-argument", "Unsupported premium tier.");
    }
    return tier;
}

function getLemonSqueezySupportedVariantIds(config) {
    return [
        cleanOptionalId(config && config.annualVariantId),
        cleanOptionalId(config && config.supporterVariantId)
    ].filter(Boolean);
}

function getLemonSqueezyVariantIdForTier(config, tier) {
    if (tier === CHECKOUT_TIERS.supporter.id) {
        return cleanOptionalId(config && config.supporterVariantId) || cleanOptionalId(config && config.annualVariantId);
    }

    return cleanOptionalId(config && config.annualVariantId);
}

function requireConfiguredSupporterVariantForLiveCheckout(config, selectedTier, mode) {
    if (selectedTier !== CHECKOUT_TIERS.supporter.id) return;
    if (mode && mode.mode !== "live") return;
    if (cleanOptionalId(config && config.supporterVariantId)) return;

    console.error("[payments] Supporter checkout blocked: live mode needs a real Lemon Squeezy supporter variant id.", {
        envKey: BARK_LEMONSQUEEZY_SUPPORTER_VARIANT_ID_ENV,
        annualVariantId: cleanOptionalId(config && config.annualVariantId) || null
    });
    throw new functions.https.HttpsError(
        "failed-precondition",
        "Supporter checkout is almost ready. Please choose Standard for now or contact support."
    );
}

function isSupportedLemonSqueezyVariant(config, variantId) {
    if (!variantId) return true;
    return getLemonSqueezySupportedVariantIds(config).some(id => String(id) === String(variantId));
}

function buildLemonSqueezyCheckoutPayload({ uid, token = {}, config, tier = CHECKOUT_TIERS.standard.id }) {
    const mode = getLemonSqueezyModeConfig(config);
    const successUrl = buildCheckoutReturnUrl(config.appBaseUrl, "success");
    const cancelUrl = buildCheckoutReturnUrl(config.appBaseUrl, "canceled");
    const email = cleanOptionalString(token.email);
    const name = cleanOptionalString(token.name) || cleanOptionalString(token.displayName);
    const selectedTier = getCheckoutTierFromRequest({ tier });
    requireConfiguredSupporterVariantForLiveCheckout(config, selectedTier, mode);
    const selectedVariantId = getLemonSqueezyVariantIdForTier(config, selectedTier);
    const tierConfig = CHECKOUT_TIERS[selectedTier];
    const checkoutData = {
        custom: {
            firebase_uid: uid,
            source: "bark_ranger_map",
            plan: tierConfig.customPlan,
            tier: selectedTier,
            provider_mode: mode.mode,
            cancel_url: cancelUrl
        }
    };

    if (email) checkoutData.email = email;
    if (name) checkoutData.name = name;

    return {
        data: {
            type: "checkouts",
            attributes: {
                test_mode: mode.checkoutTestMode,
                ...(selectedTier === CHECKOUT_TIERS.supporter.id && !cleanOptionalId(config.supporterVariantId)
                    ? { custom_price: SUPPORTER_CUSTOM_PRICE_CENTS }
                    : {}),
                product_options: {
                    name: tierConfig.productName,
                    description: tierConfig.productDescription,
                    enabled_variants: [Number(selectedVariantId)],
                    redirect_url: successUrl,
                    receipt_button_text: "Return to BARK Ranger Map",
                    receipt_link_url: successUrl
                },
                checkout_options: {
                    discount: true
                },
                checkout_data: checkoutData
            },
            relationships: {
                store: {
                    data: {
                        type: "stores",
                        id: String(config.storeId)
                    }
                },
                variant: {
                    data: {
                        type: "variants",
                        id: String(selectedVariantId)
                    }
                }
            }
        }
    };
}

function extractLemonSqueezyCheckoutUrl(response) {
    const checkoutUrl = response &&
        response.data &&
        response.data.data &&
        response.data.data.attributes &&
        response.data.data.attributes.url;

    const safeCheckoutUrl = normalizeLemonSqueezyStoreUrl(checkoutUrl, "/checkout");
    if (!safeCheckoutUrl) {
        throw new functions.https.HttpsError("internal", "Checkout service returned an invalid response.");
    }

    return safeCheckoutUrl;
}

function getLemonSqueezyCustomerPortalUrlFromAttributes(attributes = {}) {
    const urls = attributes && attributes.urls && typeof attributes.urls === "object" && !Array.isArray(attributes.urls)
        ? attributes.urls
        : {};
    const customerPortalUrl = normalizeLemonSqueezyStoreUrl(urls.customer_portal, "/billing");
    if (!customerPortalUrl) return null;
    return customerPortalUrl;
}

function extractLemonSqueezyCustomerPortalUrl(response) {
    const attributes = response &&
        response.data &&
        response.data.data &&
        response.data.data.attributes;
    const customerPortalUrl = getLemonSqueezyCustomerPortalUrlFromAttributes(attributes || {});
    if (!customerPortalUrl) {
        throw new functions.https.HttpsError("failed-precondition", "No customer portal is available for this subscription.");
    }
    return customerPortalUrl;
}

function getLemonSqueezyBillingReference(userData = {}) {
    const entitlement = userData && userData.entitlement && typeof userData.entitlement === "object"
        ? userData.entitlement
        : {};

    return {
        entitlement,
        providerSubscriptionId: cleanOptionalId(entitlement.providerSubscriptionId) ||
            cleanOptionalId(entitlement.lemonSqueezySubscriptionId) ||
            cleanOptionalId(userData.lemonSqueezySubscriptionId) ||
            cleanOptionalId(userData.subscriptionId),
        providerCustomerId: cleanOptionalId(entitlement.providerCustomerId) ||
            cleanOptionalId(entitlement.lemonSqueezyCustomerId) ||
            cleanOptionalId(userData.lemonSqueezyCustomerId) ||
            cleanOptionalId(userData.lemonCustomerId)
    };
}

function hasLemonSqueezyBillingSignal(billingReference = {}) {
    const entitlement = billingReference.entitlement && typeof billingReference.entitlement === "object"
        ? billingReference.entitlement
        : {};
    const source = (cleanOptionalString(entitlement.source) || "").toLowerCase();
    return source === "lemon_squeezy" ||
        Boolean(cleanOptionalId(billingReference.providerSubscriptionId)) ||
        Boolean(cleanOptionalId(billingReference.providerCustomerId));
}

function buildLemonSqueezyCustomerPortalApiTarget(billingReference) {
    const providerSubscriptionId = cleanOptionalId(billingReference && billingReference.providerSubscriptionId);
    const providerCustomerId = cleanOptionalId(billingReference && billingReference.providerCustomerId);

    if (providerSubscriptionId) {
        if (!isSafeProviderId(providerSubscriptionId)) {
            throw new functions.https.HttpsError("failed-precondition", "Subscription management is unavailable for this account.");
        }
        return {
            type: "subscription",
            id: providerSubscriptionId,
            url: `${LEMONSQUEEZY_SUBSCRIPTIONS_URL}/${encodeURIComponent(providerSubscriptionId)}`
        };
    }

    if (providerCustomerId) {
        if (!isSafeProviderId(providerCustomerId)) {
            throw new functions.https.HttpsError("failed-precondition", "Subscription management is unavailable for this account.");
        }
        return {
            type: "customer",
            id: providerCustomerId,
            url: `${LEMONSQUEEZY_CUSTOMERS_URL}/${encodeURIComponent(providerCustomerId)}`
        };
    }

    throw new functions.https.HttpsError(
        "failed-precondition",
        "No active subscription was found for this account."
    );
}

function getLemonSqueezySubscriptionAttributesFromResponse(response) {
    return response &&
        response.data &&
        response.data.data &&
        response.data.data.attributes &&
        typeof response.data.data.attributes === "object" &&
        !Array.isArray(response.data.data.attributes)
        ? response.data.data.attributes
        : {};
}

function getLemonSqueezySubscriptionSyncEventName(attributes = {}) {
    const status = cleanOptionalString(attributes.status);
    const normalizedStatus = status ? status.toLowerCase() : "";
    return normalizedStatus === "cancelled" || normalizedStatus === "canceled"
        ? "subscription_cancelled"
        : "subscription_updated";
}

function buildLemonSqueezySubscriptionSyncPayload(providerSubscriptionId, response, eventName) {
    const sourceData = response && response.data && response.data.data ? response.data.data : {};
    const attributes = getLemonSqueezySubscriptionAttributesFromResponse(response);
    return {
        meta: {
            event_name: eventName,
            event_id: buildLemonSqueezySubscriptionSyncEventId(providerSubscriptionId, attributes, eventName),
            custom_data: {}
        },
        data: {
            type: "subscriptions",
            id: cleanOptionalId(sourceData.id) || providerSubscriptionId,
            attributes,
            relationships: sourceData.relationships || {}
        }
    };
}

function buildLemonSqueezySubscriptionSyncEventId(providerSubscriptionId, attributes = {}, eventName = "subscription_updated") {
    const parts = [
        "subscription_api_sync",
        providerSubscriptionId,
        eventName,
        cleanOptionalString(attributes.status) || "",
        cleanOptionalString(attributes.updated_at) || "",
        cleanOptionalString(attributes.ends_at) || "",
        cleanOptionalString(attributes.renews_at) || "",
        cleanOptionalString(attributes.trial_ends_at) || ""
    ];
    return `subscription_api_sync_${createHash("sha256").update(parts.join("|")).digest("hex")}`;
}

function buildLemonSqueezySubscriptionsListUrl(config, email) {
    const url = new URL(LEMONSQUEEZY_SUBSCRIPTIONS_URL);
    url.searchParams.set("filter[store_id]", String(config.storeId));
    url.searchParams.set("filter[user_email]", email);
    url.searchParams.set("page[size]", "10");
    return url.toString();
}

function getLemonSqueezySubscriptionListFromResponse(response) {
    const data = response && response.data && Array.isArray(response.data.data)
        ? response.data.data
        : [];
    return data.filter(item => item && item.type === "subscriptions" && item.id);
}

function normalizeEmail(value) {
    const email = cleanOptionalString(value);
    return email ? email.toLowerCase() : null;
}

function subscriptionMatchesRestoreRequest(subscription, email, options = {}) {
    const config = options.config || getLemonSqueezyProviderConfig(options);
    const mode = getLemonSqueezyModeConfig(config);
    const attributes = subscription && subscription.attributes && typeof subscription.attributes === "object"
        ? subscription.attributes
        : {};
    const requestedEmail = normalizeEmail(email);
    const subscriptionEmail = normalizeEmail(attributes.user_email);
    if (requestedEmail && subscriptionEmail && requestedEmail !== subscriptionEmail) return false;
    if (attributes.test_mode !== undefined && attributes.test_mode !== mode.checkoutTestMode) return false;
    if (attributes.store_id !== undefined && String(attributes.store_id) !== String(config.storeId)) return false;

    const variantId = getLemonSqueezyVariantId({ data: subscription }, attributes);
    if (!isSupportedLemonSqueezyVariant(config, variantId)) return false;

    const eventName = getLemonSqueezySubscriptionSyncEventName(attributes);
    const payload = buildLemonSqueezySubscriptionSyncPayload(subscription.id, { data: { data: subscription } }, eventName);
    const mapping = mapLemonSqueezyEntitlement(payload, eventName, { ...options, config });
    return mapping.action === "write" && mapping.entitlement && mapping.entitlement.premium === true;
}

function selectRestorableLemonSqueezySubscription(subscriptions, email, options = {}) {
    return subscriptions
        .filter(subscription => subscriptionMatchesRestoreRequest(subscription, email, options))
        .map(subscription => {
            const attributes = subscription.attributes || {};
            return {
                subscription,
                sortTime: getLemonSqueezyProviderEventMillis({
                    meta: {},
                    data: {
                        attributes
                    }
                }, options)
            };
        })
        .sort((a, b) => b.sortTime - a.sortTime)
        .map(item => item.subscription)[0] || null;
}

function normalizeLemonSqueezyBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    if (typeof value === "string") {
        const text = value.trim().toLowerCase();
        if (text === "true" || text === "1" || text === "yes") return true;
        if (text === "false" || text === "0" || text === "no") return false;
    }
    return null;
}

function lemonSqueezyAttributesMatchConfiguredMode(attributes = {}, config = {}) {
    if (!attributes || attributes.test_mode === undefined) return true;
    const testMode = normalizeLemonSqueezyBoolean(attributes.test_mode);
    if (testMode === null) return true;
    const mode = config && config.mode ? config.mode : getLemonSqueezyModeConfig(config);
    return testMode === mode.checkoutTestMode;
}

async function buildLemonSqueezySubscriptionApiTargetByEmail(email, config, options = {}) {
    const subscription = await findLemonSqueezySubscriptionByEmail(email, config, options);
    const subscriptionId = cleanOptionalId(subscription && subscription.id);
    if (!subscriptionId) return null;
    return {
        type: "subscription",
        id: subscriptionId,
        url: `${LEMONSQUEEZY_SUBSCRIPTIONS_URL}/${encodeURIComponent(subscriptionId)}`,
        subscription
    };
}

function shouldCancelLemonSqueezySubscriptionAttributes(attributes = {}) {
    if (attributes.cancelled === true || attributes.canceled === true) return false;
    const status = cleanOptionalString(attributes.status);
    const normalizedStatus = status ? status.toLowerCase() : "";
    return !["cancelled", "canceled", "expired", "refunded"].includes(normalizedStatus);
}

function getLemonSqueezyApiHeaders(config) {
    return {
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        "Authorization": `Bearer ${config.apiKey}`
    };
}

function getLemonSqueezySubscriptionAttributes(subscription = {}) {
    return subscription && subscription.attributes && typeof subscription.attributes === "object" && !Array.isArray(subscription.attributes)
        ? subscription.attributes
        : {};
}

async function findLemonSqueezySubscriptionByEmail(email, config, options = {}) {
    const get = options.axiosGet || axios.get;
    const response = await get(buildLemonSqueezySubscriptionsListUrl(config, email), {
        headers: getLemonSqueezyApiHeaders(config)
    });
    const subscriptions = getLemonSqueezySubscriptionListFromResponse(response);
    return selectRestorableLemonSqueezySubscription(subscriptions, email, {
        ...options,
        config
    });
}

async function syncLemonSqueezySubscriptionEntitlementFromApi({ uid, providerSubscriptionId, response }, options = {}) {
    const attributes = getLemonSqueezySubscriptionAttributesFromResponse(response);
    const eventName = getLemonSqueezySubscriptionSyncEventName(attributes);
    const syncOptions = {
        ...options,
        providerSync: true
    };
    const payload = buildLemonSqueezySubscriptionSyncPayload(providerSubscriptionId, response, eventName);
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const mapping = mapLemonSqueezyEntitlement(payload, eventName, syncOptions);
    if (mapping.action !== "write") {
        return { ignored: true, reason: mapping.reason || "ignored" };
    }

    return processLemonSqueezyWebhookEntitlement({
        uid,
        eventName,
        eventId: payload.meta.event_id,
        rawBody,
        mapping,
        payload
    }, syncOptions);
}

async function writeLemonSqueezySubscriptionEntitlementFromApi({ userRef, userData, providerSubscriptionId, response }, options = {}) {
    const attributes = getLemonSqueezySubscriptionAttributesFromResponse(response);
    const eventName = getLemonSqueezySubscriptionSyncEventName(attributes);
    const syncOptions = {
        ...options,
        providerSync: true
    };
    const payload = buildLemonSqueezySubscriptionSyncPayload(providerSubscriptionId, response, eventName);
    const mapping = mapLemonSqueezyEntitlement(payload, eventName, syncOptions);
    if (mapping.action !== "write") {
        return { ignored: true, reason: mapping.reason || "ignored" };
    }

    const existingEntitlement = userData && userData.entitlement && typeof userData.entitlement === "object"
        ? userData.entitlement
        : {};
    if (existingEntitlement.status === "manual_active" && existingEntitlement.source !== "lemon_squeezy") {
        return { ignored: true, reason: "manual_override" };
    }
    if (isStaleLemonSqueezyEvent(existingEntitlement, mapping)) {
        return { ignored: true, reason: "stale_event" };
    }

    const entitlement = {
        ...mapping.entitlement,
        updatedAt: getServerTimestamp(options),
        lastProviderEventId: payload.meta.event_id,
        lastProviderEventName: eventName,
        lastProviderEventAt: mapping.providerEventAt,
        lastProviderEventAtMs: mapping.providerEventAtMs,
        lastProviderEventRank: mapping.providerEventRank
    };
    await setFirestoreDoc(userRef, { entitlement }, { merge: true });
    return { processed: true, entitlement };
}

async function getCurrentStoredEntitlement(db, uid) {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc && userDoc.exists && typeof userDoc.data === "function"
        ? userDoc.data()
        : {};
    return userData && userData.entitlement && typeof userData.entitlement === "object"
        ? userData.entitlement
        : null;
}

async function handleRestorePremiumPurchase(requestOrData, context, options = {}) {
    void requestOrData;
    const uid = requireVerifiedEmailCallable(context);
    await enforceConfiguredCallableRateLimit(uid, "restorePremiumPurchase", options);
    const token = context && context.auth && context.auth.token ? context.auth.token : {};
    const email = cleanOptionalString(token.email);
    if (!email) {
        throw new functions.https.HttpsError("failed-precondition", "A verified account email is required to restore Premium.");
    }

    const config = getLemonSqueezyConfig(options);
    const get = options.axiosGet || axios.get;
    const db = options.firestore || admin.firestore();
    const url = buildLemonSqueezySubscriptionsListUrl(config, email);

    try {
        const response = await get(url, {
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${config.apiKey}`
            }
        });
        const subscriptions = getLemonSqueezySubscriptionListFromResponse(response);
        const subscription = selectRestorableLemonSqueezySubscription(subscriptions, email, {
            ...options,
            config
        });
        if (!subscription) {
            return {
                restored: false,
                entitlement: await getCurrentStoredEntitlement(db, uid),
                message: "No active Lemon Squeezy subscription was found for this account email."
            };
        }

        const syncResult = await syncLemonSqueezySubscriptionEntitlementFromApi({
            uid,
            providerSubscriptionId: subscription.id,
            response: {
                data: {
                    data: subscription
                }
            }
        }, {
            ...options,
            config,
            firestore: db
        });

        return {
            restored: Boolean(syncResult && syncResult.entitlement && syncResult.entitlement.premium === true),
            duplicate: Boolean(syncResult && syncResult.duplicate),
            entitlement: syncResult && syncResult.entitlement
                ? syncResult.entitlement
                : await getCurrentStoredEntitlement(db, uid)
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error("[payments] Premium restore lookup failed.", {
            uid,
            status: error && error.response ? error.response.status : null,
            message: error && error.message ? error.message : String(error)
        });
        throw new functions.https.HttpsError("internal", "Premium restore could not complete. Please try again.");
    }
}

async function handleCreateCheckoutSession(requestOrData, context, options = {}) {
    const requestedAt = Date.now();
    const backendReady = options.checkoutBackendReady || checkoutBackendReady;
    await backendReady;
    const warmupWaitDurationMs = Date.now() - requestedAt;

    requireFunctionFlagEnabled("createCheckoutSession", options);
    const uid = requireVerifiedEmailCallable(context);
    const rateLimitStartedAt = Date.now();
    await enforceConfiguredCallableRateLimit(uid, "createCheckoutSession", options);
    const rateLimitDurationMs = Date.now() - rateLimitStartedAt;
    const config = getLemonSqueezyConfig(options);
    const token = context && context.auth && context.auth.token ? context.auth.token : {};
    const tier = getCheckoutTierFromRequest(requestOrData);
    const payload = buildLemonSqueezyCheckoutPayload({ uid, token, config, tier });
    const post = options.axiosPost || axios.post;

    try {
        const providerStartedAt = Date.now();
        const response = await post(LEMONSQUEEZY_CHECKOUTS_URL, payload, {
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${config.apiKey}`
            }
        });
        const providerDurationMs = Date.now() - providerStartedAt;
        console.info("[payments] Checkout session created.", {
            tier,
            warmupWaitDurationMs,
            rateLimitDurationMs,
            providerDurationMs,
            totalDurationMs: Date.now() - requestedAt
        });

        return {
            checkoutUrl: extractLemonSqueezyCheckoutUrl(response)
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error("[payments] Lemon Squeezy checkout creation failed.", {
            uid,
            status: error && error.response ? error.response.status : null,
            message: error && error.message ? error.message : String(error),
            lemonErrors: error && error.response && error.response.data && Array.isArray(error.response.data.errors)
                ? error.response.data.errors.map((lemonError) => ({
                    status: lemonError && lemonError.status ? lemonError.status : null,
                    title: lemonError && lemonError.title ? lemonError.title : null,
                    detail: lemonError && lemonError.detail ? lemonError.detail : null,
                    source: lemonError && lemonError.source ? lemonError.source : null
                }))
                : null
        });
        throw new functions.https.HttpsError("internal", "Unable to create checkout session.");
    }
}

async function handleGetCustomerPortalUrl(requestOrData, context, options = {}) {
    const uid = requireAuthCallable(context);
    await enforceConfiguredCallableRateLimit(uid, "getCustomerPortalUrl", options);
    const db = options.firestore || admin.firestore();
    const token = context && context.auth && context.auth.token ? context.auth.token : {};
    const email = cleanOptionalString(token.email);

    let userDoc;
    try {
        userDoc = await db.collection("users").doc(uid).get();
    } catch (error) {
        console.error("[payments] Customer portal entitlement lookup failed.", {
            uid,
            message: error && error.message ? error.message : String(error)
        });
        throw new functions.https.HttpsError("internal", "Subscription management could not open.");
    }

    if (!userDoc || !userDoc.exists || typeof userDoc.data !== "function") {
        throw new functions.https.HttpsError("not-found", "User account not found.");
    }

    const userData = userDoc.data() || {};
    const billingReference = getLemonSqueezyBillingReference(userData);
    const hasSubscriptionId = Boolean(billingReference.providerSubscriptionId);
    const hasCustomerId = Boolean(billingReference.providerCustomerId);
    console.log("[payments] Customer portal billing reference.", {
        uid,
        hasSubscriptionId,
        hasCustomerId
    });
    const config = getLemonSqueezyConfig(options);
    const get = options.axiosGet || axios.get;
    const canFallbackByEmail = Boolean(isCallableEmailVerified(context) && email);

    let apiTarget = null;
    let subscriptionListMatch = null;
    if (hasSubscriptionId || hasCustomerId) {
        apiTarget = buildLemonSqueezyCustomerPortalApiTarget(billingReference);
    } else {
        if (!isCallableEmailVerified(context) || !email) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "A verified account email is required to manage a Lemon Squeezy subscription."
            );
        }
        try {
            apiTarget = await buildLemonSqueezySubscriptionApiTargetByEmail(email, config, options);
            subscriptionListMatch = apiTarget && apiTarget.subscription ? apiTarget.subscription : null;
        } catch (error) {
            if (error instanceof functions.https.HttpsError) throw error;
            console.error("[payments] Customer portal email fallback lookup failed.", {
                uid,
                status: error && error.response ? error.response.status : null,
                message: error && error.message ? error.message : String(error)
            });
            throw new functions.https.HttpsError("internal", "Subscription management could not open.");
        }

        if (!apiTarget || !subscriptionListMatch) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "No active subscription was found for this account."
            );
        }
    }

    try {
        const fetchPortalTarget = async (target) => {
            console.log("[payments] Customer portal Lemon API lookup starting.", {
                uid,
                hasSubscriptionId,
                hasCustomerId,
                lookupType: target.type,
                lemonApiEndpoint: target.url
            });
            const targetResponse = await get(target.url, {
                headers: {
                    "Accept": "application/vnd.api+json",
                    "Content-Type": "application/vnd.api+json",
                    "Authorization": `Bearer ${config.apiKey}`
                }
            });
            console.log("[payments] Customer portal Lemon API response received.", {
                uid,
                hasSubscriptionId,
                hasCustomerId,
                lookupType: target.type,
                lemonApiEndpoint: target.url,
                lemonResponseStatus: targetResponse && targetResponse.status ? targetResponse.status : null
            });
            return targetResponse;
        };

        let response = await fetchPortalTarget(apiTarget);
        let attributes = response &&
            response.data &&
            response.data.data &&
            response.data.data.attributes;
        if (attributes && attributes.store_id !== undefined && String(attributes.store_id) !== String(config.storeId)) {
            throw new functions.https.HttpsError("permission-denied", "Subscription store mismatch.");
        }
        if (attributes && !lemonSqueezyAttributesMatchConfiguredMode(attributes, config)) {
            console.warn("[payments] Stored Lemon billing reference did not match configured mode.", {
                uid,
                lookupType: apiTarget.type,
                providerSubscriptionId: apiTarget.type === "subscription" ? apiTarget.id : null,
                providerCustomerId: apiTarget.type === "customer" ? apiTarget.id : null,
                providerTestMode: attributes.test_mode,
                expectedTestMode: config.mode.checkoutTestMode
            });
            let fallbackTarget = null;
            if (canFallbackByEmail) {
                fallbackTarget = await buildLemonSqueezySubscriptionApiTargetByEmail(email, config, options);
            }
            if (!fallbackTarget) {
                throw new functions.https.HttpsError(
                    "failed-precondition",
                    "No active live subscription was found for this account."
                );
            }
            apiTarget = fallbackTarget;
            response = await fetchPortalTarget(apiTarget);
            attributes = response &&
                response.data &&
                response.data.data &&
                response.data.data.attributes;
            if (attributes && attributes.store_id !== undefined && String(attributes.store_id) !== String(config.storeId)) {
                throw new functions.https.HttpsError("permission-denied", "Subscription store mismatch.");
            }
            if (attributes && !lemonSqueezyAttributesMatchConfiguredMode(attributes, config)) {
                throw new functions.https.HttpsError(
                    "failed-precondition",
                    "No active live subscription was found for this account."
                );
            }
        }

        let syncResult = null;
        if (apiTarget.type === "subscription") {
            try {
                syncResult = await syncLemonSqueezySubscriptionEntitlementFromApi({
                    uid,
                    providerSubscriptionId: apiTarget.id,
                    response
                }, {
                    ...options,
                    config,
                    firestore: db
                });
            } catch (syncError) {
                console.error("[payments] Customer portal subscription sync failed.", {
                    uid,
                    providerSubscriptionId: apiTarget.id,
                    message: syncError && syncError.message ? syncError.message : String(syncError)
                });
            }
        }

        const customerPortalUrl = extractLemonSqueezyCustomerPortalUrl(response);
        const portalLogParts = getUrlLogParts(customerPortalUrl);
        console.log("[payments] Customer portal URL resolved.", {
            uid,
            lookupType: apiTarget.type,
            portalHostname: portalLogParts.hostname,
            portalPathname: portalLogParts.pathname,
            portalIsRootPath: isRootUrlPath(customerPortalUrl)
        });
        return {
            url: customerPortalUrl,
            customerPortalUrl,
            entitlement: syncResult && syncResult.entitlement ? syncResult.entitlement : null
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error("[payments] Customer portal URL lookup failed.", {
            uid,
            providerSubscriptionId: billingReference.providerSubscriptionId || null,
            providerCustomerId: billingReference.providerCustomerId || null,
            status: error && error.response ? error.response.status : null,
            message: error && error.message ? error.message : String(error)
        });
        throw new functions.https.HttpsError("internal", "Subscription management could not open.");
    }
}

function accessCodeError(message = "That code was not recognized or has expired.") {
    return new functions.https.HttpsError("failed-precondition", message);
}

function normalizeAccessCodeAudience(value) {
    const audience = cleanOptionalString(value);
    return ACCESS_CODE_AUDIENCES.has(audience) ? audience : "general";
}

function normalizeAccessCodeReason(value) {
    const reason = cleanOptionalString(value);
    return reason ? reason.slice(0, 160) : "Premium access code";
}

async function handleRedeemAccessOrPromoCode(requestOrData, context, options = {}) {
    void requestOrData;
    void options;
    const uid = requireVerifiedEmailCallable(context);
    void uid;
    throw accessCodeError("Coupon codes are entered on the Lemon Squeezy checkout page.");
}

function getRequestHeaderValue(req, name) {
    if (req && typeof req.get === "function") {
        const value = req.get(name);
        if (value) return value;
    }

    const headers = req && req.headers ? req.headers : {};
    const lowerName = name.toLowerCase();
    return headers[name] || headers[lowerName] || null;
}

function getLemonSqueezyWebhookSecret(options = {}) {
    const env = options.env || process.env;
    return cleanOptionalString(options.webhookSecret) || cleanOptionalString(env.LEMONSQUEEZY_WEBHOOK_SECRET);
}

function getRawWebhookBody(req) {
    const rawBody = req && req.rawBody;
    if (Buffer.isBuffer(rawBody)) return rawBody;
    if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
    return null;
}

function normalizeLemonSqueezySignature(signature) {
    const value = cleanOptionalString(signature);
    if (!value) return null;
    return value.startsWith("sha256=") ? value.slice("sha256=".length).trim() : value;
}

function verifyLemonSqueezyWebhookSignature(rawBody, signature, secret) {
    const normalizedSignature = normalizeLemonSqueezySignature(signature);
    if (!Buffer.isBuffer(rawBody) || !normalizedSignature || !secret) return false;

    const digest = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
    const received = Buffer.from(normalizedSignature, "utf8");
    if (digest.length !== received.length) return false;
    return timingSafeEqual(digest, received);
}

function deriveLemonSqueezyEventId(payload, rawBody) {
    const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    const providerId = cleanOptionalString(meta.event_id) ||
        cleanOptionalString(meta.webhook_event_id) ||
        cleanOptionalString(meta.id);
    if (providerId) return providerId;

    const source = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(JSON.stringify(payload || {}), "utf8");
    return `derived_${createHash("sha256").update(source).digest("hex")}`;
}

function getLemonSqueezyEventName(payload, req) {
    const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    return cleanOptionalString(meta.event_name) || cleanOptionalString(getRequestHeaderValue(req, "X-Event-Name")) || "unknown";
}

function getLemonSqueezyCustomData(payload) {
    const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    return meta.custom_data && typeof meta.custom_data === "object" && !Array.isArray(meta.custom_data)
        ? meta.custom_data
        : {};
}

function isValidFirebaseUid(uid) {
    return typeof uid === "string" && uid.trim() === uid && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}

function getLemonSqueezyAttributes(payload) {
    return payload &&
        payload.data &&
        payload.data.attributes &&
        typeof payload.data.attributes === "object" &&
        !Array.isArray(payload.data.attributes)
        ? payload.data.attributes
        : {};
}

function getLemonSqueezyVariantId(payload, attributes = getLemonSqueezyAttributes(payload)) {
    const directVariantId = cleanOptionalId(attributes.variant_id) || cleanOptionalId(attributes.variantId);
    if (directVariantId) return directVariantId;

    const variantRelationship = payload &&
        payload.data &&
        payload.data.relationships &&
        payload.data.relationships.variant &&
        payload.data.relationships.variant.data;

    return cleanOptionalId(variantRelationship && variantRelationship.id);
}

function getCurrentPeriodEnd(attributes) {
    return cleanOptionalString(attributes.ends_at) ||
        cleanOptionalString(attributes.renews_at) ||
        cleanOptionalString(attributes.trial_ends_at) ||
        null;
}

function preserveLemonSqueezyCurrentPeriodEnd(existingEntitlement = {}, mappedEntitlement = {}) {
    if (mappedEntitlement.currentPeriodEnd) return mappedEntitlement;

    const existingSubscriptionId = cleanOptionalId(existingEntitlement.providerSubscriptionId);
    const mappedSubscriptionId = cleanOptionalId(mappedEntitlement.providerSubscriptionId);
    if (!existingSubscriptionId || !mappedSubscriptionId || existingSubscriptionId !== mappedSubscriptionId) {
        return mappedEntitlement;
    }

    const existingCurrentPeriodEnd = cleanOptionalString(existingEntitlement.currentPeriodEnd);
    return existingCurrentPeriodEnd
        ? { ...mappedEntitlement, currentPeriodEnd: existingCurrentPeriodEnd }
        : mappedEntitlement;
}

function isFutureDate(value, nowMs = Date.now()) {
    const text = cleanOptionalString(value);
    if (!text) return false;
    const time = Date.parse(text);
    return Number.isFinite(time) && time > nowMs;
}

function parseLemonSqueezyDateMillis(value) {
    const text = cleanOptionalString(value);
    if (!text) return null;
    const millis = Date.parse(text);
    return Number.isFinite(millis) ? millis : null;
}

function getLemonSqueezyProviderEventMillis(payload, options = {}) {
    const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    const attributes = getLemonSqueezyAttributes(payload);
    const candidates = [
        meta.event_created_at,
        meta.event_time,
        meta.created_at,
        meta.updated_at,
        attributes.updated_at,
        attributes.created_at
    ];

    for (const candidate of candidates) {
        const millis = parseLemonSqueezyDateMillis(candidate);
        if (millis !== null) return millis;
    }

    return Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
}

function getLemonSqueezyEventRank(status) {
    return LEMONSQUEEZY_EVENT_STATUS_RANK[status] || 0;
}

function buildLemonSqueezyEventDocId(eventId) {
    return createHash("sha256").update(String(eventId)).digest("hex");
}

function isExplicitActiveProviderRestore(mapping) {
    const incomingStatus = cleanOptionalString(mapping && mapping.entitlement && mapping.entitlement.status);
    if (incomingStatus !== "active") return false;
    return mapping.providerSync === true ||
        mapping.providerEventName === "subscription_resumed" ||
        mapping.providerEventName === "subscription_unpaused";
}

function isStaleLemonSqueezyEvent(existingEntitlement, mapping) {
    const existingStatus = cleanOptionalString(existingEntitlement && existingEntitlement.status);
    const incomingStatus = cleanOptionalString(mapping && mapping.entitlement && mapping.entitlement.status);
    const existingSubscriptionId = cleanOptionalId(existingEntitlement && (
        existingEntitlement.providerSubscriptionId ||
        existingEntitlement.lemonSqueezySubscriptionId
    ));
    const incomingSubscriptionId = cleanOptionalId(mapping && mapping.entitlement && (
        mapping.entitlement.providerSubscriptionId ||
        mapping.entitlement.lemonSqueezySubscriptionId
    ));
    const existingOrderId = cleanOptionalId(existingEntitlement && existingEntitlement.providerOrderId);
    const incomingOrderId = cleanOptionalId(mapping && mapping.entitlement && mapping.entitlement.providerOrderId);
    const sameSubscription = Boolean(existingSubscriptionId && incomingSubscriptionId && existingSubscriptionId === incomingSubscriptionId);
    const sameOrder = Boolean(existingOrderId && incomingOrderId && existingOrderId === incomingOrderId);
    const explicitActiveProviderRestore = isExplicitActiveProviderRestore(mapping);
    const existingMillis = Number(existingEntitlement && existingEntitlement.lastProviderEventAtMs);
    const incomingMillis = Number(mapping && mapping.providerEventAtMs);

    if ((sameSubscription || sameOrder) && existingStatus === "refunded" && incomingStatus !== "refunded") {
        if (!sameSubscription || !explicitActiveProviderRestore) return true;
        if (Number.isFinite(existingMillis) && Number.isFinite(incomingMillis) && incomingMillis < existingMillis) return true;
        return false;
    }

    if (Number.isFinite(existingMillis) &&
        Number.isFinite(incomingMillis) &&
        incomingMillis === existingMillis &&
        explicitActiveProviderRestore &&
        ["paused", "cancelled_active", "canceled", "expired", "refunded"].includes(existingStatus)) {
        return false;
    }

    if (!Number.isFinite(existingMillis)) {
        return false;
    }

    if (!Number.isFinite(incomingMillis)) {
        return false;
    }

    if (incomingMillis < existingMillis) {
        return true;
    }
    if (incomingMillis > existingMillis) return false;

    const existingRank = Number(existingEntitlement.lastProviderEventRank || 0);
    const incomingRank = Number(mapping.providerEventRank || 0);
    return incomingRank < existingRank;
}

function isActiveAccessCodeEntitlement(entitlement, options = {}) {
    const normalized = normalizeEntitlement(entitlement, options);
    return normalized.premium === true &&
        normalized.source === "access_code" &&
        normalized.status === "access_code_active";
}

function buildAccessCodeFallback(entitlement) {
    if (!entitlement || typeof entitlement !== "object") return null;
    if (entitlement.source !== "access_code" || entitlement.status !== "access_code_active") return null;
    return {
        premium: true,
        status: "access_code_active",
        source: "access_code",
        accessCodeType: cleanOptionalString(entitlement.accessCodeType) || "premium_free_year",
        accessCodeAudience: normalizeAccessCodeAudience(entitlement.accessCodeAudience),
        reason: normalizeAccessCodeReason(entitlement.reason),
        grantedAt: entitlement.grantedAt || null,
        expiresAt: entitlement.expiresAt || null,
        autoRenew: false,
        paymentMethodAttached: false,
        providerCustomerId: null,
        providerSubscriptionId: null,
        lemonSqueezySubscriptionId: null,
        manualOverride: true
    };
}

function getActiveAccessCodeFallback(existingEntitlement, options = {}) {
    if (existingEntitlement && existingEntitlement.accessCodeFallback &&
        isActiveAccessCodeEntitlement(existingEntitlement.accessCodeFallback, options)) {
        return buildAccessCodeFallback(existingEntitlement.accessCodeFallback);
    }
    if (isActiveAccessCodeEntitlement(existingEntitlement, options)) {
        return buildAccessCodeFallback(existingEntitlement);
    }
    return null;
}

function mapLemonSqueezyEntitlement(payload, eventName, options = {}) {
    if (!LEMONSQUEEZY_SUPPORTED_EVENTS.has(eventName)) {
        return { action: "ignore", reason: "unsupported_event" };
    }

    const attributes = getLemonSqueezyAttributes(payload);
    if (!shouldAcceptLemonSqueezyWebhookMode(attributes, options)) {
        return { action: "ignore", reason: "non_test_mode" };
    }

    const config = options.config || getLemonSqueezyProviderConfig(options);
    if (attributes.store_id !== undefined && String(attributes.store_id) !== String(config.storeId)) {
        return { action: "ignore", reason: "store_mismatch" };
    }

    const variantId = getLemonSqueezyVariantId(payload, attributes);
    if (!isSupportedLemonSqueezyVariant(config, variantId)) {
        return { action: "ignore", reason: "variant_mismatch" };
    }

    const providerStatus = cleanOptionalString(attributes.status);
    const normalizedStatus = providerStatus ? providerStatus.toLowerCase() : "";
    const currentPeriodEnd = getCurrentPeriodEnd(attributes);
    const providerEventAtMs = getLemonSqueezyProviderEventMillis(payload, options);
    const providerEventAt = new Date(providerEventAtMs).toISOString();
    let entitlement = null;

    if (eventName === "subscription_payment_success" ||
        eventName === "subscription_payment_recovered" ||
        eventName === "subscription_unpaused") {
        entitlement = { premium: true, status: "active" };
    } else if (eventName === "subscription_payment_failed") {
        entitlement = { premium: true, status: "past_due" };
    } else if (eventName === "subscription_expired") {
        entitlement = { premium: false, status: "expired" };
    } else if (eventName === "subscription_paused") {
        entitlement = { premium: true, status: "paused" };
    } else if (eventName === "subscription_cancelled") {
        entitlement = isFutureDate(attributes.ends_at, options.nowMs)
            ? { premium: true, status: "cancelled_active" }
            : { premium: false, status: "canceled" };
    } else if (eventName === "subscription_payment_refunded" || eventName === "order_refunded") {
        entitlement = { premium: false, status: "refunded" };
    } else if (normalizedStatus === "active" || normalizedStatus === "on_trial") {
        entitlement = { premium: true, status: "active" };
    } else if (normalizedStatus === "paused") {
        entitlement = { premium: true, status: "paused" };
    } else if (normalizedStatus === "expired") {
        entitlement = { premium: false, status: "expired" };
    } else if (normalizedStatus === "past_due" || normalizedStatus === "unpaid") {
        entitlement = { premium: true, status: "past_due" };
    } else if (normalizedStatus === "cancelled" || normalizedStatus === "canceled") {
        entitlement = isFutureDate(attributes.ends_at, options.nowMs)
            ? { premium: true, status: "cancelled_active" }
            : { premium: false, status: "canceled" };
    }

    if (!entitlement) {
        return { action: "ignore", reason: "unsupported_status" };
    }

    const mappedEntitlement = {
        ...entitlement,
        source: "lemon_squeezy",
        providerMode: config.mode ? config.mode.mode : getLemonSqueezyModeConfig(options).mode,
        providerStatus,
        providerCustomerId: attributes.customer_id === undefined ? null : String(attributes.customer_id),
        providerSubscriptionId: payload && payload.data && payload.data.type === "subscriptions"
            ? String(payload.data.id)
            : attributes.subscription_id === undefined ? null : String(attributes.subscription_id),
        providerOrderId: payload && payload.data && payload.data.type === "orders"
            ? String(payload.data.id)
            : attributes.order_id === undefined ? null : String(attributes.order_id),
        currentPeriodEnd
    };

    return {
        action: "write",
        providerEventName: eventName,
        providerSync: options.providerSync === true,
        providerEventAt,
        providerEventAtMs,
        providerEventRank: getLemonSqueezyEventRank(entitlement.status),
        entitlement: mappedEntitlement
    };
}

async function processLemonSqueezyWebhookEntitlement({ uid, eventName, eventId, rawBody, mapping, payload }, options = {}) {
    const db = options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        console.error("[payments] Firestore transaction support is unavailable for Lemon Squeezy webhook.", {
            uid,
            eventName,
            eventId
        });
        throw new Error("webhook_transaction_unavailable");
    }

    const userRef = db.collection("users").doc(uid);
    const deletedUserRef = db.collection("_deletedUsers").doc(uid);
    const eventDocId = buildLemonSqueezyEventDocId(eventId);
    const eventRef = db.collection(LEMONSQUEEZY_PROCESSED_EVENTS_COLLECTION).doc(eventDocId);
    const eventBase = {
        provider: "lemon_squeezy",
        providerEventId: eventId,
        eventName,
        uid,
        eventDocId,
        payloadType: payload && payload.data ? payload.data.type || null : null,
        payloadId: payload && payload.data ? payload.data.id || null : null,
        rawBodyHash: createHash("sha256").update(rawBody).digest("hex"),
        providerEventAt: mapping.providerEventAt,
        providerEventAtMs: mapping.providerEventAtMs,
        providerEventRank: mapping.providerEventRank,
        receivedAt: getServerTimestamp(options)
    };

    return db.runTransaction(async (transaction) => {
        const eventSnapshot = await transaction.get(eventRef);
        if (eventSnapshot && eventSnapshot.exists) {
            return { duplicate: true };
        }

        const deletedUserSnapshot = await transaction.get(deletedUserRef);
        if (deletedUserSnapshot && deletedUserSnapshot.exists) {
            transaction.set(eventRef, {
                ...eventBase,
                processingStatus: "ignored",
                reason: "account_deleted"
            }, { merge: false });
            return { ignored: true, reason: "account_deleted" };
        }

        const userSnapshot = await transaction.get(userRef);
        const userData = userSnapshot && userSnapshot.exists && typeof userSnapshot.data === "function"
            ? userSnapshot.data()
            : {};
        const existingEntitlement = userData && userData.entitlement && typeof userData.entitlement === "object"
            ? userData.entitlement
            : {};

        if (existingEntitlement.status === "manual_active" && existingEntitlement.source !== "lemon_squeezy") {
            transaction.set(eventRef, {
                ...eventBase,
                processingStatus: "ignored",
                reason: "manual_override",
                entitlementStatusBefore: existingEntitlement.status || null
            }, { merge: false });
            return { ignored: true, reason: "manual_override" };
        }

        const activeAccessCodeFallback = getActiveAccessCodeFallback(existingEntitlement, options);
        if (activeAccessCodeFallback &&
            existingEntitlement.source === "access_code" &&
            mapping.entitlement.premium !== true) {
            transaction.set(eventRef, {
                ...eventBase,
                processingStatus: "ignored",
                reason: "active_access_code_preserved",
                entitlementStatusBefore: existingEntitlement.status || null
            }, { merge: false });
            return { ignored: true, reason: "active_access_code_preserved" };
        }

        if (isStaleLemonSqueezyEvent(existingEntitlement, mapping)) {
            transaction.set(eventRef, {
                ...eventBase,
                processingStatus: "ignored",
                reason: "stale_event",
                entitlementStatusBefore: existingEntitlement.status || null,
                lastProviderEventIdBefore: existingEntitlement.lastProviderEventId || null,
                lastProviderEventAtMsBefore: existingEntitlement.lastProviderEventAtMs || null
            }, { merge: false });
            return { ignored: true, reason: "stale_event" };
        }

        const mappedEntitlement = preserveLemonSqueezyCurrentPeriodEnd(existingEntitlement, mapping.entitlement);
        let entitlement = {
            ...mappedEntitlement,
            updatedAt: getServerTimestamp(options),
            lastProviderEventId: eventId,
            lastProviderEventName: eventName,
            lastProviderEventAt: mapping.providerEventAt,
            lastProviderEventAtMs: mapping.providerEventAtMs,
            lastProviderEventRank: mapping.providerEventRank
        };

        if (activeAccessCodeFallback && mapping.entitlement.premium === true) {
            entitlement.accessCodeFallback = activeAccessCodeFallback;
        } else if (activeAccessCodeFallback && mapping.entitlement.premium !== true) {
            entitlement = {
                ...activeAccessCodeFallback,
                updatedAt: getServerTimestamp(options),
                restoredFromAccessCodeFallback: true,
                lastProviderEventId: eventId,
                lastProviderEventName: eventName,
                lastProviderEventAt: mapping.providerEventAt,
                lastProviderEventAtMs: mapping.providerEventAtMs,
                lastProviderEventRank: mapping.providerEventRank
            };
        }

        transaction.set(userRef, { entitlement }, { merge: true });
        transaction.set(eventRef, {
            ...eventBase,
            processingStatus: "processed",
            entitlementStatusAfter: entitlement.status,
            entitlementPremiumAfter: entitlement.premium
        }, { merge: false });

        return { processed: true, entitlement };
    });
}

function getServerTimestamp(options = {}) {
    return typeof options.serverTimestamp === "function"
        ? options.serverTimestamp()
        : FieldValue.serverTimestamp();
}

function getCallableRequestData(requestOrData) {
    return requestOrData && requestOrData.data && typeof requestOrData.data === "object"
        ? requestOrData.data
        : requestOrData || {};
}

async function deleteFirestoreDoc(ref) {
    if (ref && typeof ref.delete === "function") {
        await ref.delete();
    }
}

async function setFirestoreDoc(ref, data, options = {}) {
    if (ref && typeof ref.set === "function") {
        await ref.set(data, options);
    }
}

async function deleteKnownUserSubcollections(db, userRef, options = {}) {
    const subcollections = options.userSubcollections || ["savedRoutes", "achievements"];
    for (const collectionName of subcollections) {
        if (!userRef || typeof userRef.collection !== "function") continue;
        const collectionRef = userRef.collection(collectionName);
        if (!collectionRef || typeof collectionRef.get !== "function") continue;
        const snapshot = await collectionRef.get();
        const docs = snapshot && Array.isArray(snapshot.docs) ? snapshot.docs : [];
        if (docs.length === 0) continue;

        if (db && typeof db.batch === "function") {
            const batch = db.batch();
            docs.forEach(doc => {
                if (doc && doc.ref && typeof batch.delete === "function") batch.delete(doc.ref);
            });
            if (typeof batch.commit === "function") await batch.commit();
            continue;
        }

        for (const doc of docs) {
            if (doc && doc.ref) await deleteFirestoreDoc(doc.ref);
        }
    }
}

async function cancelLemonSqueezySubscriptionBeforeAccountDeletion({ uid, userData = {}, context, options = {} }) {
    const token = context && context.auth && context.auth.token ? context.auth.token : {};
    const email = cleanOptionalString(token.email);
    const billingReference = getLemonSqueezyBillingReference(userData);
    let subscriptionId = cleanOptionalId(billingReference.providerSubscriptionId);
    let subscriptionAttributes = null;

    if (subscriptionId && !isSafeProviderId(subscriptionId)) {
        throw new functions.https.HttpsError("failed-precondition", "Subscription cancellation is unavailable for this account.");
    }

    const canCheckByEmail = Boolean(email && isCallableEmailVerified(context));
    if (!hasLemonSqueezyBillingSignal(billingReference)) {
        return { checked: false, canceled: false, reason: "no_lemon_billing_signal" };
    }

    if (!subscriptionId && !canCheckByEmail) {
        return { checked: false, canceled: false, reason: "no_subscription_reference" };
    }

    const config = getLemonSqueezyConfig(options);
    const get = options.axiosGet || axios.get;
    const deleteRequest = options.axiosDelete || axios.delete;

    try {
        if (!subscriptionId && canCheckByEmail) {
            const subscription = await findLemonSqueezySubscriptionByEmail(email, config, options);
            subscriptionId = cleanOptionalId(subscription && subscription.id);
            subscriptionAttributes = getLemonSqueezySubscriptionAttributes(subscription);
        }

        if (!subscriptionId) {
            return { checked: true, canceled: false, reason: "no_subscription" };
        }

        let subscriptionUrl = `${LEMONSQUEEZY_SUBSCRIPTIONS_URL}/${encodeURIComponent(subscriptionId)}`;
        if (!subscriptionAttributes) {
            const response = await get(subscriptionUrl, {
                headers: getLemonSqueezyApiHeaders(config)
            });
            subscriptionAttributes = getLemonSqueezySubscriptionAttributesFromResponse(response);
        }

        if (!lemonSqueezyAttributesMatchConfiguredMode(subscriptionAttributes, config)) {
            console.warn("[account] Stored Lemon billing reference did not match configured mode.", {
                uid,
                providerSubscriptionId: subscriptionId,
                providerTestMode: subscriptionAttributes ? subscriptionAttributes.test_mode : null,
                expectedTestMode: config.mode.checkoutTestMode
            });
            if (canCheckByEmail) {
                const liveSubscription = await findLemonSqueezySubscriptionByEmail(email, config, options);
                const liveSubscriptionId = cleanOptionalId(liveSubscription && liveSubscription.id);
                if (liveSubscriptionId) {
                    subscriptionId = liveSubscriptionId;
                    subscriptionAttributes = getLemonSqueezySubscriptionAttributes(liveSubscription);
                    subscriptionUrl = `${LEMONSQUEEZY_SUBSCRIPTIONS_URL}/${encodeURIComponent(subscriptionId)}`;
                } else {
                    return { checked: true, canceled: false, reason: "mode_mismatch_no_subscription" };
                }
            } else {
                return { checked: true, canceled: false, reason: "mode_mismatch" };
            }
        }

        if (subscriptionAttributes && subscriptionAttributes.store_id !== undefined && String(subscriptionAttributes.store_id) !== String(config.storeId)) {
            throw new functions.https.HttpsError("permission-denied", "Subscription store mismatch.");
        }

        if (!shouldCancelLemonSqueezySubscriptionAttributes(subscriptionAttributes)) {
            return { checked: true, canceled: false, reason: "already_inactive", providerSubscriptionId: subscriptionId };
        }

        const cancelResponse = await deleteRequest(subscriptionUrl, {
            headers: getLemonSqueezyApiHeaders(config)
        });

        return {
            checked: true,
            canceled: true,
            providerSubscriptionId: subscriptionId,
            response: cancelResponse
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error("[account] Lemon Squeezy subscription cancellation before account deletion failed.", {
            uid,
            providerSubscriptionId: subscriptionId || null,
            status: error && error.response ? error.response.status : null,
            message: error && error.message ? error.message : String(error)
        });
        throw new functions.https.HttpsError(
            "failed-precondition",
            "Premium subscription cancellation could not be verified. Manage billing first, then delete the account."
        );
    }
}

async function handleCancelPremiumSubscription(requestOrData, context, options = {}) {
    void requestOrData;
    const uid = requireAuthCallable(context);
    await enforceConfiguredCallableRateLimit(uid, "cancelPremiumSubscription", options);
    const db = options.firestore || admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userDoc = userRef && typeof userRef.get === "function" ? await userRef.get() : null;
    if (!userDoc || !userDoc.exists || typeof userDoc.data !== "function") {
        throw new functions.https.HttpsError("not-found", "User account not found.");
    }

    const userData = userDoc.data() || {};
    const cancellation = await cancelLemonSqueezySubscriptionBeforeAccountDeletion({
        uid,
        userData,
        context,
        options
    });

    let entitlement = await getCurrentStoredEntitlement(db, uid);
    if (cancellation.canceled === true && cancellation.response) {
        try {
            const syncResult = await writeLemonSqueezySubscriptionEntitlementFromApi({
                userRef,
                userData,
                providerSubscriptionId: cancellation.providerSubscriptionId,
                response: cancellation.response
            }, {
                ...options,
                firestore: db
            });
            if (syncResult && syncResult.entitlement) entitlement = syncResult.entitlement;
        } catch (syncError) {
            console.error("[account] Lemon Squeezy cancellation sync failed.", {
                uid,
                providerSubscriptionId: cancellation.providerSubscriptionId || null,
                message: syncError && syncError.message ? syncError.message : String(syncError)
            });
        }
    }

    return {
        canceled: cancellation.canceled === true,
        alreadyInactive: cancellation.reason === "already_inactive",
        providerSubscriptionId: cancellation.providerSubscriptionId || null,
        entitlement
    };
}

async function handleDeleteAccount(requestOrData, context, options = {}) {
    const uid = requireAuthCallable(context);
    const data = getCallableRequestData(requestOrData);
    if (!data || data.confirmation !== "DELETE") {
        throw new functions.https.HttpsError("failed-precondition", "Type DELETE to confirm account deletion.");
    }
    await enforceConfiguredCallableRateLimit(uid, "deleteAccount", options);

    const db = options.firestore || admin.firestore();
    const auth = options.auth || admin.auth();
    const timestamp = getServerTimestamp(options);
    const userRef = db.collection("users").doc(uid);
    const leaderboardRef = db.collection("leaderboard").doc(uid);
    const deletedUserRef = db.collection("_deletedUsers").doc(uid);
    const userDoc = userRef && typeof userRef.get === "function" ? await userRef.get() : null;
    const userData = userDoc && userDoc.exists && typeof userDoc.data === "function" ? userDoc.data() || {} : {};
    const cancellation = await cancelLemonSqueezySubscriptionBeforeAccountDeletion({
        uid,
        userData,
        context,
        options
    });
    const tombstone = {
        uid,
        deletedAt: timestamp,
        source: "user_request",
        lemonSubscriptionCanceled: cancellation.canceled === true,
        lemonSubscriptionId: cancellation.providerSubscriptionId || null
    };
    let firestoreDeletionCommitted = false;

    // Establish the write barrier before enumerating subcollections. Otherwise
    // an already-issued token could create a route/achievement after the list
    // query but before the final parent deletion, leaving orphaned data behind.
    await setFirestoreDoc(deletedUserRef, tombstone, { merge: true });

    try {
        await deleteKnownUserSubcollections(db, userRef, options);

        if (db && typeof db.batch === "function") {
            const batch = db.batch();
            batch.delete(userRef);
            batch.delete(leaderboardRef);
            await batch.commit();
        } else {
            await deleteFirestoreDoc(userRef);
            await deleteFirestoreDoc(leaderboardRef);
        }
        firestoreDeletionCommitted = true;
    } catch (error) {
        // If parent deletion never committed, the Auth account still exists and
        // must remain usable. Remove the temporary write barrier before
        // returning the failure. Once the parent deletion commits, the durable
        // tombstone is intentionally retained even if Auth deletion later fails.
        if (!firestoreDeletionCommitted) {
            try {
                await deleteFirestoreDoc(deletedUserRef);
            } catch (rollbackError) {
                console.error("[account] Deletion tombstone rollback failed.", {
                    uid,
                    message: rollbackError && rollbackError.message ? rollbackError.message : String(rollbackError)
                });
            }
        }
        throw error;
    }

    try {
        await auth.deleteUser(uid);
    } catch (error) {
        if (!error || error.code !== "auth/user-not-found") {
            console.error("[account] Firebase Auth user deletion failed.", {
                uid,
                code: error && error.code ? error.code : null,
                message: error && error.message ? error.message : String(error)
            });
            throw new functions.https.HttpsError("internal", "Account deletion could not complete.");
        }
    }

    return {
        deleted: true,
        subscriptionCanceled: cancellation.canceled === true
    };
}

function safeResponse(res, status, body) {
    if (res && typeof res.status === "function") {
        res.status(status);
    } else if (res) {
        res.statusCode = status;
    }

    if (res && typeof res.json === "function") return res.json(body);
    if (res && typeof res.send === "function") return res.send(body);
    if (res && typeof res.end === "function") return res.end(JSON.stringify(body));
    return body;
}

async function handleLemonSqueezyWebhook(req, res, options = {}) {
    if (!req || req.method !== "POST") {
        return safeResponse(res, 405, { ok: false, error: "method_not_allowed" });
    }

    const rawBody = getRawWebhookBody(req);
    if (!rawBody || rawBody.length === 0) {
        return safeResponse(res, 400, { ok: false, error: "missing_raw_body" });
    }

    const signature = getRequestHeaderValue(req, "X-Signature");
    if (!signature) {
        return safeResponse(res, 401, { ok: false, error: "missing_signature" });
    }

    const secret = getLemonSqueezyWebhookSecret(options);
    if (!secret) {
        console.error("[payments] Lemon Squeezy webhook secret is not configured.");
        await deliverPaymentAlert(
            buildPaymentAlertPayload(
                "lemonSqueezyWebhook",
                new Error("Webhook secret is not configured — payment events cannot be processed."),
                {},
                { critical: true }
            ),
            options
        );
        return safeResponse(res, 500, { ok: false, error: "webhook_not_configured" });
    }

    if (!verifyLemonSqueezyWebhookSignature(rawBody, signature, secret)) {
        return safeResponse(res, 401, { ok: false, error: "invalid_signature" });
    }

    let payload;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
    } catch (_error) {
        return safeResponse(res, 400, { ok: false, error: "invalid_json" });
    }

    const eventName = getLemonSqueezyEventName(payload, req);
    const eventId = deriveLemonSqueezyEventId(payload, rawBody);
    const customData = getLemonSqueezyCustomData(payload);
    const uid = cleanOptionalString(customData.firebase_uid);
    const attributes = getLemonSqueezyAttributes(payload);
    const acceptedMode = shouldAcceptLemonSqueezyWebhookMode(attributes, options);
    const providerMode = getLemonSqueezyModeConfig(options).mode;

    if (!isValidFirebaseUid(uid)) {
        console.warn("[payments] Lemon Squeezy webhook ignored because firebase_uid is missing or invalid.", {
            eventName,
            eventId
        });
        if (acceptedMode && LEMONSQUEEZY_MONEY_EVENTS.has(eventName)) {
            await deliverPaymentAlert(buildPaymentAlertPayload(
                "lemonSqueezyWebhook",
                new Error("A payment webhook could not be matched to a Firebase user."),
                {},
                {
                    eventName,
                    eventId,
                    providerMode,
                    critical: providerMode === "live",
                    alertDomain: "payments"
                }
            ), options);
        }
        return safeResponse(res, 200, { ok: true, ignored: true, reason: "missing_uid" });
    }

    const mapping = mapLemonSqueezyEntitlement(payload, eventName, options);
    if (mapping.action !== "write") {
        if (acceptedMode && LEMONSQUEEZY_MONEY_EVENTS.has(eventName) &&
            (mapping.reason === "store_mismatch" || mapping.reason === "variant_mismatch")) {
            await deliverPaymentAlert(buildPaymentAlertPayload(
                "lemonSqueezyWebhook",
                new Error(`A payment webhook was rejected because of ${mapping.reason.replace(/_/g, " ")}.`),
                { uid },
                {
                    eventName,
                    eventId,
                    providerMode,
                    critical: providerMode === "live",
                    alertDomain: "payments"
                }
            ), options);
        }
        return safeResponse(res, 200, { ok: true, ignored: true, reason: mapping.reason || "ignored" });
    }

    let result;
    try {
        result = await processLemonSqueezyWebhookEntitlement({
            uid,
            eventName,
            eventId,
            rawBody,
            mapping,
            payload
        }, options);
    } catch (error) {
        // A paid customer may now be charged-but-not-upgraded. Alert, and return
        // 500 so Lemon Squeezy retries — duplicate events are deduped upstream.
        await deliverPaymentAlert(
            buildPaymentAlertPayload("lemonSqueezyWebhook", error, { uid }, {
                eventName,
                eventId,
                critical: true
            }),
            options
        );
        return safeResponse(res, 500, { ok: false, error: "processing_failed" });
    }

    if (result.duplicate) {
        return safeResponse(res, 200, { ok: true, duplicate: true });
    }

    if (result.ignored) {
        return safeResponse(res, 200, { ok: true, ignored: true, reason: result.reason || "ignored" });
    }

    // Post the money event to the ops server. Wrapped and swallowed: Lemon
    // Squeezy retries on any non-2xx, so a Discord hiccup must not make it
    // replay an entitlement change that already succeeded.
    try {
        await postBillingEventToDiscord({ uid, eventName, entitlement: result.entitlement }, options);
    } catch (err) {
        console.error("[payments] Discord notify issue:", err && err.message);
    }

    return safeResponse(res, 200, { ok: true });
}

// Billing events that mean money moved the wrong way. These are worth a ping,
// because a silent payment failure turns into an involuntary churn.
const LEMONSQUEEZY_ALARMING_EVENTS = new Set([
    "subscription_payment_failed",
    "subscription_payment_refunded",
    "order_refunded"
]);

function postBillingEventToDiscord({ uid, eventName, entitlement }, options = {}) {
    const isAlarming = LEMONSQUEEZY_ALARMING_EVENTS.has(eventName);
    const status = entitlement && entitlement.status ? entitlement.status : "unknown";
    const premium = entitlement && entitlement.premium === true;

    return opsDiscord.postDiscord({
        // #sales-and-billing is Admin-only, so the raw uid is fine here.
        channel: "salesAndBilling",
        tier: isAlarming ? "critical" : "important",
        title: `Lemon Squeezy: ${eventName.replace(/_/g, " ")}`,
        description: isAlarming
            ? "Money moved the wrong way. Check the customer before this becomes involuntary churn."
            : null,
        fields: [
            { name: "Entitlement", value: premium ? "premium" : "not premium" },
            { name: "Status", value: status },
            { name: "User UID", value: uid }
        ],
        footer: "Firestore: users/{uid}.entitlement"
    }, options);
}

async function handlePremiumRoute(requestOrData, context, options = {}) {
    const routeStartedAt = Date.now();
    requireFunctionFlagEnabled("getPremiumRoute", options);
    const uid = requireVerifiedEmailCallable(context);
    const accessStartedAt = Date.now();
    // Keep the limiter first so blocked abuse never spends an entitlement read.
    await enforcePremiumCallableRateLimits(uid, "getPremiumRoute", options);
    await requirePremiumCallable(context, "getPremiumRoute", options);
    const accessDurationMs = Date.now() - accessStartedAt;

    const payload = getCallablePayload(requestOrData);
    const coordinates = normalizeRouteCoordinates(payload.coordinates);
    const radiuses = payload.radiuses;

    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > ROUTE_MAX_COORDINATES) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            `Routes must contain between 2 and ${ROUTE_MAX_COORDINATES} valid coordinates.`
        );
    }

    const apiKey = getOrsApiKey(options);
    if (!apiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Routing service is not configured.");
    }

    const post = options.axiosPost || axios.post;
    const providerAttemptBudget = options.providerAttemptBudget || createProviderAttemptBudget(
        options.routeProviderAttemptLimit
    );
    const requestConfig = {
        headers: {
            "Authorization": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json, application/geo+json; charset=utf-8"
        }
    };
    const requestDirections = (routeCoordinates, requestOptions = {}) => {
        const body = {
            coordinates: routeCoordinates,
            geometry: true,
            instructions: true
        };
        if (Array.isArray(radiuses) && radiuses.length === coordinates.length) body.radiuses = radiuses;
        return postOrsWithRetry(post, ORS_DIRECTIONS_URL, body, requestConfig, {
            ...options,
            ...requestOptions,
            providerAttemptBudget
        });
    };

    try {
        const providerStartedAt = Date.now();
        let response;
        try {
            response = await requestDirections(coordinates);
        } catch (initialError) {
            if (!routeRequestStrategy.shouldAttemptSnapRecovery(initialError)) throw initialError;

            const snappedCoordinates = await snapRouteCoordinates(coordinates, apiKey, {
                ...options,
                providerAttemptBudget,
                providerAttemptReserve: 1,
                waypoints: normalizeRouteWaypoints(payload.waypoints, coordinates)
            });
            if (!routeRequestStrategy.routeCoordinatesChanged(coordinates, snappedCoordinates)) throw initialError;

            console.info("[routing] Retrying an off-road route with recovered coordinates.");
            response = await requestDirections(snappedCoordinates, { providerAttemptReserve: 0 });
        }
        const providerDurationMs = Date.now() - providerStartedAt;
        const compactStartedAt = Date.now();
        const result = options.compactResponse === true
            ? compactRouteResponse(response.data)
            : response.data;
        const compactDurationMs = Date.now() - compactStartedAt;
        console.info("[routing] Premium route completed.", {
            coordinateCount: coordinates.length,
            compactResponse: options.compactResponse === true,
            accessDurationMs,
            providerDurationMs,
            providerAttemptCount: providerAttemptBudget.used,
            compactDurationMs,
            totalDurationMs: Date.now() - routeStartedAt
        });
        return result;
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        const status = getOrsErrorStatus(error);
        console.error("Networking/ORS Error:", error.message, { status });
        if (status === 429) {
            const retryAfterMs = parseRetryAfterMs(getHeaderValue(error && error.response && error.response.headers, "retry-after"));
            const retryAtMs = Date.now() + Math.max(60 * 1000, retryAfterMs || 0);
            throw makeBotRateLimitError("ors-provider", retryAtMs, "global");
        }
        throw new functions.https.HttpsError("internal", "Failed to calculate route.");
    }
}

async function handlePremiumRouteCompact(requestOrData, context, options = {}) {
    const requestedAt = Date.now();
    const backendReady = options.compactRouteBackendReady || compactRouteBackendReady;
    await backendReady;
    const warmupWaitDurationMs = Date.now() - requestedAt;

    try {
        return await handlePremiumRoute(requestOrData, context, {
            ...options,
            compactResponse: true,
            // The route response must not wait for an unrelated analytics write.
            // Provider status and quota remain available in structured logs.
            orsTelemetryMode: "log-only"
        });
    } catch (error) {
        console.info("[routing] Compact route request ended before a route was returned.", {
            code: error && error.code ? error.code : null,
            warmupWaitDurationMs,
            totalDurationMs: Date.now() - requestedAt
        });
        throw error;
    }
}

async function handlePremiumGeocode(requestOrData, context, options = {}) {
    requireFunctionFlagEnabled("getPremiumGeocode", options);
    const uid = requireVerifiedEmailCallable(context);
    await enforcePremiumCallableRateLimit(uid, "getPremiumGeocode", options);
    await enforceConfiguredCallableRateLimit(uid, "getPremiumGeocodeBurst", options);
    await requirePremiumCallable(context, "getPremiumGeocode", options);

    const payload = getCallablePayload(requestOrData);
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';

    if (!text) {
        throw new functions.https.HttpsError("invalid-argument", "Search query is required.");
    }

    const apiKey = getOrsApiKey(options);
    if (!apiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Geocoding service is not configured.");
    }

    const requestedSize = parseInt(payload.size, 10);
    const size = Number.isFinite(requestedSize) ? Math.min(Math.max(requestedSize, 1), 10) : 5;

    const params = new URLSearchParams({
        api_key: apiKey,
        text,
        size: String(size)
    });
    if (payload.country) {
        params.set('boundary.country', String(payload.country));
    }

    try {
        const get = options.axiosGet || axios.get;
        const response = await getOrsWithRetry(get, `${ORS_GEOCODE_URL}?${params.toString()}`, options);
        return response.data;
    } catch (error) {
        console.error("Networking/ORS Geocode Error:", error.message);
        if (error instanceof functions.https.HttpsError) throw error;
        if (getOrsErrorStatus(error) === 429) {
            const retryAfterMs = parseRetryAfterMs(getHeaderValue(error && error.response && error.response.headers, "retry-after"));
            throw makeBotRateLimitError("ors-geocoding", Date.now() + Math.max(60 * 1000, retryAfterMs || 0), "global");
        }
        throw new functions.https.HttpsError("internal", "Failed to perform geocode.");
    }
}

// ===== PAYMENT ERROR ALERTING =====
// Emails a monitored inbox when a payment-critical function fails in a way that
// signals a real problem (unexpected crash or server fault), so a charged-but-
// not-upgraded customer never slips by unnoticed. Client-fault errors (auth,
// rate limit, validation, "please verify email") are intentionally NOT alerted
// so the inbox stays signal, not noise. A high-severity "[PAYMENT_ALERT]" log
// line is always emitted, so alerts are recorded even if email is unavailable.

const PAYMENT_ALERT_SERVER_FAULT_CODES = new Set([
    "internal", "unknown", "unavailable", "data-loss", "deadline-exceeded", "aborted"
]);

// paymentAlertEmailSender is wired to a real email transport by
// initPaymentAlertEmailSender() when alert-email env/secrets are configured.
// Until then it stays null and alerts are log-only (safe, non-breaking).
let paymentAlertEmailSender = null;

// A generic "send an email" function wired to the same pooled transport as
// alerts (used by the daily digest). Null until the transport is configured.
let rawAlertEmailSender = null;

function setPaymentAlertEmailSender(sender) {
    paymentAlertEmailSender = typeof sender === "function" ? sender : null;
}

function setRawAlertEmailSender(sender) {
    rawAlertEmailSender = typeof sender === "function" ? sender : null;
}

function shouldAlertOnPaymentError(error) {
    if (!error) return false;
    // A non-HttpsError is an unexpected crash — always worth an alert.
    const code = error instanceof functions.https.HttpsError ? error.code : null;
    if (!code) return true;
    return PAYMENT_ALERT_SERVER_FAULT_CODES.has(code);
}

function extractAlertIdentity(context) {
    const auth = context && context.auth;
    if (!auth) return { uid: null, email: null };
    const token = auth.token || {};
    return { uid: auth.uid || null, email: token.email || null };
}

function buildPaymentAlertPayload(fnName, error, identity = {}, extra = {}) {
    return {
        fn: fnName,
        uid: identity.uid || null,
        email: identity.email || null,
        errorCode: (error && error.code) || null,
        errorMessage: (error && error.message) || String(error),
        stack: (error && error.stack) || null,
        project: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || null,
        timestamp: new Date().toISOString(),
        ...extra
    };
}

const PAYMENT_FUNCTIONS = new Set([
    "createCheckoutSession",
    "getCustomerPortalUrl",
    "restorePremiumPurchase",
    "cancelPremiumSubscription",
    "lemonSqueezyWebhook"
]);

function getAlertDomain(fnName, extra = {}) {
    if (extra.alertDomain) return extra.alertDomain;
    if (PAYMENT_FUNCTIONS.has(fnName)) return "payments";
    if (String(fnName || "").startsWith("client/")) return "client";
    return "system";
}

// In-memory alert throttle (per function instance). Stops an outage or an error
// loop from flooding the inbox: the same error signature emails at most once per
// cooldown, with a hard hourly cap. Every alert is still logged regardless, so
// nothing is lost — only the email side is throttled.
const ALERT_DEDUP_COOLDOWN_MS = 2 * 60 * 1000;
const ALERT_MAX_EMAILS_PER_HOUR = 40;
const _alertThrottleScopes = new Map();

function resetAlertThrottle() {
    _alertThrottleScopes.clear();
}

function alertEmailAllowed(payload, now = Date.now()) {
    const domain = getAlertDomain(payload && payload.fn, payload || {});
    const scopeName = payload && payload.critical === true && domain === "payments"
        ? "payment-critical"
        : domain;
    const maxPerHour = scopeName === "payment-critical" ? 100 : ALERT_MAX_EMAILS_PER_HOUR;
    const scope = _alertThrottleScopes.get(scopeName) || {
        windowStart: now,
        count: 0,
        signatures: new Map()
    };
    if (now - scope.windowStart >= 60 * 60 * 1000) {
        scope.windowStart = now;
        scope.count = 0;
        scope.signatures.clear();
    }
    if (scope.count >= maxPerHour) {
        _alertThrottleScopes.set(scopeName, scope);
        return false;
    }

    const signature = [
        payload.fn || "unknown",
        payload.errorCode || "",
        String(payload.errorMessage || "").slice(0, 140)
    ].join("|");
    const lastSent = scope.signatures.get(signature);
    if (lastSent && (now - lastSent) < ALERT_DEDUP_COOLDOWN_MS) return false;

    scope.signatures.set(signature, now);
    scope.count += 1;
    if (scope.signatures.size > 500) {
        for (const [key, ts] of scope.signatures) {
            if (now - ts > ALERT_DEDUP_COOLDOWN_MS) scope.signatures.delete(key);
        }
    }
    _alertThrottleScopes.set(scopeName, scope);
    return true;
}

// Picks the ops channel and alert tier for an alert payload. A payment-critical
// failure is the only thing that pings; client reports go to #bugs rather than
// #system-status so a broken screen doesn't read as an outage.
function routeAlertToDiscord(payload, options = {}) {
    const isClientReport = payload.source === "client";
    const isClientPaymentReport = isClientReport && payload.likelyArea === "payment/upgrade";
    const domain = getAlertDomain(payload.fn, payload);
    // A client report must never claim payment risk, even if `critical` is set.
    const isCritical = payload.critical === true && !isClientReport;

    let channel = domain === "payments" ? "salesAndBilling" : "systemStatus";
    let title = `${payload.fn} failed`;
    if (isClientReport) {
        channel = isClientPaymentReport ? "salesAndBilling" : "bugs";
        title = isClientPaymentReport ? `Client payment report: ${payload.fn}` : `Client report: ${payload.fn}`;
    }
    if (isCritical) {
        channel = "incidentResponse";
        title = `CRITICAL: ${payload.fn} failed`;
    }

    return opsDiscord.postDiscord({
        channel,
        tier: isCritical ? "critical" : "important",
        title,
        description: isCritical
            ? `A customer may be charged but not upgraded.\n\`${payload.errorMessage || "unknown error"}\``
            : `\`${payload.errorMessage || "unknown error"}\``,
        fields: [
            { name: "Error code", value: payload.errorCode || "n/a" },
            { name: "User", value: opsDiscord.maskEmail(payload.email) || opsDiscord.maskIdentifier(payload.uid) || null },
            { name: "App version", value: payload.appVersion },
            { name: "Release", value: payload.releaseChannel },
            { name: "Path", value: payload.clientPath },
            { name: "Freeze duration", value: Number.isFinite(payload.durationSeconds) ? `${payload.durationSeconds.toFixed(1)} seconds` : null },
            { name: "Likely area", value: payload.likelyArea },
            { name: "Last action", value: payload.lastAction },
            { name: "Operation", value: payload.likelyOperation },
            { name: "Device", value: [payload.deviceFamily, payload.browserFamily].filter(Boolean).join(" · ") || null },
            { name: "Pins / zoom", value: Number.isFinite(payload.pinCount) ? `${payload.pinCount} pins${Number.isFinite(payload.mapZoom) ? ` · zoom ${payload.mapZoom}` : ""}` : null },
            { name: "Event", value: payload.eventName }
        ],
        footer: payload.project || null,
        url: `https://console.firebase.google.com/project/${payload.project || "barkrangermap-auth"}/functions/logs`
    }, options);
}

async function deliverPaymentAlert(payload, options = {}) {
    console.error("[OPS_ALERT]", JSON.stringify(payload));
    const sender = options.emailSender || paymentAlertEmailSender;
    const hasEmailSender = typeof sender === "function";
    const hasDiscord = opsDiscord.discordConfigured(options);
    if (!hasEmailSender && !hasDiscord) return { emailed: false, discord: false, reason: "no_sender" };

    // One throttle decision covers both transports, so an error loop can flood
    // neither the inbox nor the ops server.
    if (!alertEmailAllowed(payload)) return { emailed: false, discord: false, reason: "throttled" };

    // Best-effort and never throws, so Discord can't affect the email path.
    const discord = hasDiscord ? await routeAlertToDiscord(payload, options) : { posted: false, reason: "not_configured" };

    if (!hasEmailSender) return { emailed: false, discord, reason: "no_sender" };
    try {
        await sender(payload);
        return { emailed: true, discord };
    } catch (sendErr) {
        // Never let alert delivery failure mask or replace the original error.
        console.error("[PAYMENT_ALERT] email delivery failed:", sendErr && sendErr.message);
        return { emailed: false, discord, reason: "send_failed" };
    }
}

function formatPaymentAlertEmailBody(payload) {
    const isClientReport = payload.source === "client";
    const isPaymentReport = getAlertDomain(payload.fn, payload) === "payments";
    return [
        isClientReport
            ? `A user's browser reported a client-side issue on US BARK Rangers.`
            : (isPaymentReport
                ? `A payment operation failed on US BARK Rangers.`
                : `A backend operation failed on US BARK Rangers.`),
        (!isClientReport && isPaymentReport && payload.critical) ? `\n*** CRITICAL: a customer may be charged but not upgraded. ***` : "",
        ``,
        `Function:    ${payload.fn}`,
        `Time:        ${payload.timestamp}`,
        `Project:     ${payload.project || "unknown"}`,
        payload.uid ? `User UID:    ${payload.uid}` : null,
        payload.email ? `User email:  ${payload.email}` : null,
        payload.source ? `Source:      ${payload.source}` : null,
        payload.appVersion ? `App version: ${payload.appVersion}` : null,
        payload.releaseChannel ? `Release:     ${payload.releaseChannel}` : null,
        payload.clientPath ? `Path:        ${payload.clientPath}` : null,
        payload.userAgent ? `User agent:  ${payload.userAgent}` : null,
        payload.clientContext ? `Context:     ${payload.clientContext}` : null,
        Number.isFinite(payload.durationSeconds) ? `Freeze:      ${payload.durationSeconds.toFixed(1)} seconds` : null,
        payload.severity ? `Severity:    ${payload.severity}` : null,
        payload.likelyArea ? `Likely area: ${payload.likelyArea}` : null,
        payload.lastAction ? `Last action: ${payload.lastAction}` : null,
        payload.likelyOperation ? `Operation:   ${payload.likelyOperation}` : null,
        payload.deviceFamily || payload.browserFamily
            ? `Device:      ${[payload.deviceFamily, payload.browserFamily].filter(Boolean).join(" · ")}`
            : null,
        payload.eventName ? `Event:       ${payload.eventName}` : null,
        payload.eventId ? `Event ID:    ${payload.eventId}` : null,
        `Error code:  ${payload.errorCode || "n/a"}`,
        `Error:       ${payload.errorMessage}`,
        payload.stack ? `\nStack:\n${payload.stack}` : null,
        ``,
        `Check function logs:`,
        `https://console.firebase.google.com/project/${payload.project || "barkrangermap-auth"}/functions/logs`
    ].filter((line) => line !== null).join("\n");
}

// Wires the alert email transport from Firebase secrets on cold start. When the
// alert credentials are absent (e.g. local tests), it stays log-only and never
// throws — payment behavior is unaffected either way.
function initPaymentAlertEmailSender() {
    const user = process.env.ALERT_EMAIL_USER;
    const pass = process.env.ALERT_EMAIL_PASSWORD;
    if (!user || !pass) return;

    const to = process.env.ALERT_EMAIL_TO || user;
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
        // Pool the SMTP connection: without it every alert pays a fresh
        // handshake (~8s of function time). Timeouts keep a bad SMTP day from
        // hanging the function.
        pool: true,
        maxConnections: 1,
        maxMessages: 50,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });

    setPaymentAlertEmailSender(async (payload) => {
        const subject = payload.source === "client"
            ? `[BARK ALERT] ${payload.fn} report`
            : `[BARK ALERT] ${payload.fn} failed${payload.critical ? " (CRITICAL)" : ""}`;
        await transporter.sendMail({
            from: `US BARK Rangers Alerts <${user}>`,
            to,
            subject,
            text: formatPaymentAlertEmailBody(payload)
        });
    });

    setRawAlertEmailSender(async (subject, text) => {
        await transporter.sendMail({ from: `US BARK Rangers Alerts <${user}>`, to, subject, text });
    });
}

// Wraps an onCall handler so any qualifying failure fires an alert, then
// re-throws the original error unchanged (client behavior is preserved).
function wrapCallableWithPaymentAlert(fnName, handler) {
    return async (requestOrData, context) => {
        try {
            return await handler(requestOrData, context);
        } catch (error) {
            if (shouldAlertOnPaymentError(error)) {
                await deliverPaymentAlert(
                    buildPaymentAlertPayload(fnName, error, extractAlertIdentity(context))
                );
            }
            throw error;
        }
    };
}

// ===== CLIENT-SIDE ERROR REPORTING =====
// The browser app reports uncaught errors, unhandled promise rejections, and UI
// freezes here. Reports within the durable write budget are written to the
// "clientErrors" collection; alert email has a second, tighter cap so a single
// broken screen can't flood the inbox. Persistence and delivery failures are
// swallowed, while an exceeded durable budget returns its reset timestamp.

const CLIENT_ERROR_TYPES = new Set(["error", "unhandledrejection", "freeze", "boot", "other"]);
const CLIENT_ERROR_SEVERITIES = new Set(["routine", "noticeable", "important", "severe", "extreme"]);

function cleanClientErrorType(value) {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    return CLIENT_ERROR_TYPES.has(text) ? text : "error";
}

function cleanClientErrorSeverity(value, type, durationSeconds) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (CLIENT_ERROR_SEVERITIES.has(normalized)) return normalized;
    if (type === "freeze") {
        if (durationSeconds >= 45) return "extreme";
        if (durationSeconds >= 15) return "severe";
        return "noticeable";
    }
    return "important";
}

function cleanFiniteClientNumber(value, { min = -Infinity, max = Infinity } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
    return numeric;
}

function shouldImmediatelyAlertClientError(record) {
    if (!record || record.lowInformation === true || record.severity === "routine") return false;
    if (record.type === "freeze") return Number(record.durationSeconds) >= 15;
    if (record.type === "boot") return true;
    if (record.likelyArea === "storage/database") return true;
    if (record.likelyArea === "payment/upgrade" && record.type === "other") return true;
    return record.type === "error" || record.type === "unhandledrejection";
}

function getClientErrorRateLimit(options = {}) {
    const env = options.env || process.env;
    const override = options.clientErrorRateLimit || {};
    return {
        maxRequests: parsePositiveInteger(
            override.maxRequests === undefined ? env[CLIENT_ERROR_RATE_LIMIT.envMaxKey] : override.maxRequests,
            CLIENT_ERROR_RATE_LIMIT.maxRequests
        ),
        windowMs: parsePositiveInteger(
            override.windowMs === undefined ? env[CLIENT_ERROR_RATE_LIMIT.envWindowKey] : override.windowMs,
            CLIENT_ERROR_RATE_LIMIT.windowMs
        )
    };
}

// True if this uid may still receive a client-error alert email this window (and
// records the send). Never throws on over-limit — it just returns false so the
// report is logged without an email.
async function clientErrorEmailAllowed(uid, options = {}) {
    const limit = getClientErrorRateLimit(options);
    const db = options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") return false;

    const now = Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now();
    const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
    const windowEndsAt = windowStart + limit.windowMs;
    const safeUid = encodeURIComponent(uid);
    const ref = db.collection("_clientErrorEmailLimits").doc(`${safeUid}_${windowStart}`);

    let allowed = false;
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;
        if (currentCount >= limit.maxRequests) {
            allowed = false;
            return;
        }
        allowed = true;
        transaction.set(ref, {
            uid,
            count: currentCount + 1,
            limit: limit.maxRequests,
            windowStart: Timestamp.fromMillis(windowStart),
            windowEndsAt: Timestamp.fromMillis(windowEndsAt),
            expiresAt: Timestamp.fromMillis(windowEndsAt + 24 * 60 * 60 * 1000),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });
    return allowed;
}

async function handleReportClientError(requestOrData, context, options = {}) {
    const uid = requireAuthCallable(context);
    await enforceConfiguredCallableRateLimit(uid, "reportClientError", options);
    const payload = getCallablePayload(requestOrData);
    const token = getCallableAuthToken(context);
    const db = options.firestore || admin.firestore();

    const type = cleanClientErrorType(payload.type);
    const durationMsRaw = Number(payload.durationMs);
    const durationMs = Number.isFinite(durationMsRaw) ? Math.max(0, durationMsRaw) : null;
    const suppliedSeconds = cleanFiniteClientNumber(payload.durationSeconds, { min: 0, max: 120 });
    const durationSeconds = suppliedSeconds !== null
        ? Math.round(suppliedSeconds * 10) / 10
        : (durationMs !== null ? Math.round(durationMs / 100) / 10 : null);
    const record = {
        uid,
        email: cleanFeedbackString(token.email, 254),
        type,
        message: redactSensitiveDiagnosticText(payload.message, 500) || "(no message)",
        stack: redactSensitiveDiagnosticText(payload.stack, 4000),
        path: cleanDiagnosticPath(payload.path, 300),
        hostname: cleanFeedbackString(payload.hostname, 120),
        userAgent: cleanFeedbackString(payload.userAgent, 300),
        appVersion: cleanFeedbackString(payload.appVersion == null ? "" : String(payload.appVersion), 20),
        context: redactSensitiveDiagnosticText(payload.context, 500),
        durationMs,
        durationSeconds,
        severity: cleanClientErrorSeverity(payload.severity, type, durationSeconds || 0),
        likelyArea: cleanFeedbackString(payload.likelyArea, 80) || "unknown",
        freezeCategory: cleanFeedbackString(payload.freezeCategory, 120),
        fingerprint: redactSensitiveDiagnosticText(payload.fingerprint, 180),
        errorName: cleanFeedbackString(payload.errorName, 80),
        errorCode: redactSensitiveDiagnosticText(payload.errorCode, 80),
        releaseChannel: cleanFeedbackString(payload.releaseChannel, 30),
        deviceFamily: cleanFeedbackString(payload.deviceFamily, 40),
        browserFamily: cleanFeedbackString(payload.browserFamily, 40),
        activeScreen: cleanFeedbackString(payload.activeScreen, 60),
        lastAction: redactSensitiveDiagnosticText(payload.lastAction, 80),
        lastActionAgeSeconds: cleanFiniteClientNumber(payload.lastActionAgeSeconds, { min: 0, max: 86400 }),
        likelyOperation: redactSensitiveDiagnosticText(payload.likelyOperation, 80),
        operationDurationMs: cleanFiniteClientNumber(payload.operationDurationMs, { min: 0, max: 120000 }),
        pinCount: cleanFiniteClientNumber(payload.pinCount, { min: 0, max: 100000 }),
        mapZoom: cleanFiniteClientNumber(payload.mapZoom, { min: 0, max: 30 }),
        lowInformation: payload.lowInformation === true,
        source: "client",
        status: "new",
        createdAt: FieldValue.serverTimestamp()
    };

    // Always persist first — this is the durable log even when email is throttled.
    try {
        await db.collection("clientErrors").add(record);
    } catch (err) {
        console.error("[clientError] failed to persist report:", err && err.message);
    }

    // Email under the per-uid cap; swallow every issue so the client is never disrupted.
    try {
        if (shouldImmediatelyAlertClientError(record) && await clientErrorEmailAllowed(uid, options)) {
            await deliverPaymentAlert(buildPaymentAlertPayload(
                `client/${type}`,
                { message: record.message, stack: record.stack },
                { uid, email: record.email },
                {
                    source: "client",
                    clientPath: record.path,
                    userAgent: record.userAgent,
                    appVersion: record.appVersion,
                    clientContext: record.context,
                    errorName: record.errorName,
                    errorCode: record.errorCode,
                    durationMs: record.durationMs,
                    durationSeconds: record.durationSeconds,
                    severity: record.severity,
                    likelyArea: record.likelyArea,
                    releaseChannel: record.releaseChannel,
                    deviceFamily: record.deviceFamily,
                    browserFamily: record.browserFamily,
                    lastAction: record.lastAction,
                    likelyOperation: record.likelyOperation,
                    pinCount: record.pinCount,
                    mapZoom: record.mapZoom,
                    alertDomain: "client"
                }
            ), options);
        }
    } catch (err) {
        console.error("[clientError] alert delivery issue:", err && err.message);
    }

    return { ok: true };
}

// ===== DAILY ERROR DIGEST (heartbeat) =====
// Once a day, summarize the last 24h of clientErrors and email it — so silence
// becomes a trustworthy "all clear" instead of an ambiguous quiet. Reads are
// cheap (a single-field range query, auto-indexed).

function summarizeClientErrors(docs, sinceMs, nowMs) {
    const byType = {};
    const bySeverity = {};
    const byLikelyArea = {};
    const byRelease = {};
    const byIssue = new Map();
    const freezeDurations = [];
    const users = new Set();
    docs.forEach((data) => {
        const type = (data && data.type) || "error";
        byType[type] = (byType[type] || 0) + 1;
        const severity = (data && data.severity) || "unknown";
        bySeverity[severity] = (bySeverity[severity] || 0) + 1;
        const area = (data && data.likelyArea) || "unknown";
        byLikelyArea[area] = (byLikelyArea[area] || 0) + 1;
        const release = (data && (data.releaseChannel || data.appVersion)) || "unknown";
        byRelease[release] = (byRelease[release] || 0) + 1;
        const msg = ((data && data.message) || "(no message)").slice(0, 120);
        const issueKey = (data && data.fingerprint) || `${type}|${area}|${msg}`;
        const issue = byIssue.get(issueKey) || { message: msg, count: 0, type, likelyArea: area };
        issue.count += 1;
        byIssue.set(issueKey, issue);
        const seconds = Number(data && data.durationSeconds);
        if (type === "freeze" && Number.isFinite(seconds)) freezeDurations.push(seconds);
        if (data && data.uid) users.add(data.uid);
    });
    const topIssues = Array.from(byIssue.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((issue) => ({ ...issue }));
    const freeze = freezeDurations.length ? {
        count: freezeDurations.length,
        averageSeconds: Math.round((freezeDurations.reduce((sum, value) => sum + value, 0) / freezeDurations.length) * 10) / 10,
        maxSeconds: Math.round(Math.max(...freezeDurations) * 10) / 10,
        severeOrWorse: freezeDurations.filter((value) => value >= 15).length,
        extreme: freezeDurations.filter((value) => value >= 45).length
    } : null;
    return {
        total: docs.length,
        windowHours: Math.round((nowMs - sinceMs) / (60 * 60 * 1000)),
        distinctUsers: users.size,
        byType,
        bySeverity,
        byLikelyArea,
        byRelease,
        freeze,
        topIssues,
        // Backward-compatible name for older callers and tests.
        topMessages: topIssues
    };
}

function formatDigestEmailBody(summary) {
    if (summary.total === 0) {
        return [
            `✅ All clear — 0 client errors reported in the last ${summary.windowHours}h.`,
            ``,
            `The error pipeline is alive; users simply hit no reported issues.`
        ].join("\n");
    }
    const typeLines = Object.entries(summary.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  ${type.padEnd(20)} ${count}`);
    const areaLines = Object.entries(summary.byLikelyArea || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([area, count]) => `  ${String(count).padStart(3)} x  ${area}`);
    const issueLines = (summary.topIssues || summary.topMessages || [])
        .map((issue) => `  ${String(issue.count).padStart(3)} x  [${issue.likelyArea || "unknown"}] ${issue.message}`);
    const freezeLine = summary.freeze
        ? `Freeze detail:   ${summary.freeze.count} total · ${summary.freeze.averageSeconds.toFixed(1)} seconds avg · ${summary.freeze.maxSeconds.toFixed(1)} seconds max · ${summary.freeze.extreme} extreme`
        : `Freeze detail:   none`;
    return [
        `US BARK Rangers — client error digest (last ${summary.windowHours}h)`,
        ``,
        `Total reports:   ${summary.total}`,
        `Distinct users:  ${summary.distinctUsers}`,
        ``,
        `By type:`,
        ...typeLines,
        ``,
        freezeLine,
        ``,
        `Likely areas:`,
        ...areaLines,
        ``,
        `Top issues:`,
        ...issueLines,
        ``,
        `Full records: Firestore "clientErrors" collection.`
    ].join("\n");
}

async function runDailyErrorDigest(options = {}) {
    const db = options.firestore || admin.firestore();
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const sinceMs = nowMs - 24 * 60 * 60 * 1000;
    const parkDataPromise = options.includeParkDataCheck === false
        ? Promise.resolve(null)
        : dataIntegrity.fetchParkDataIntegrity(options);

    let docs = [];
    try {
        const snapshot = await db.collection("clientErrors")
            .where("createdAt", ">=", Timestamp.fromMillis(sinceMs))
            .get();
        snapshot.forEach((doc) => docs.push(doc.data()));
    } catch (err) {
        console.error("[digest] failed to read clientErrors:", err && err.message);
    }

    const parkData = await parkDataPromise;
    const summary = { ...summarizeClientErrors(docs, sinceMs, nowMs), parkData };
    const send = options.rawEmailSender || rawAlertEmailSender;
    if (typeof send === "function") {
        try {
            await send(`[BARK DIGEST] ${summary.total} client error(s) in 24h`, formatDigestEmailBody(summary));
        } catch (err) {
            console.error("[digest] failed to send digest email:", err && err.message);
        }
    }

    // Routine tier: a scheduled rollup, never a ping. Swallowed like the email.
    try {
        await postDigestToDiscord(summary, options);
    } catch (err) {
        console.error("[digest] Discord notify issue:", err && err.message);
    }

    if (parkData && !parkData.ok) {
        console.error("[data-integrity] park data check failed", {
            available: parkData.available,
            error: parkData.error || null,
            spreadsheetRows: parkData.spreadsheetRows,
            validMapRows: parkData.validMapRows,
            uniqueParkIds: parkData.uniqueParkIds,
            uniqueAwardSites: parkData.uniqueAwardSites,
            issueCodes: parkData.issueCodes
        });
        try {
            await opsDiscord.postDiscord(dataIntegrity.buildParkDataAlertMessage(parkData), options);
        } catch (err) {
            console.error("[data-integrity] Discord notify issue:", err && err.message);
        }
    }

    return summary;
}

function postDigestToDiscord(summary, options = {}) {
    const byType = Object.entries(summary.byType || {})
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} ${count}`)
        .join(" · ");
    const topIssues = (summary.topIssues || summary.topMessages || [])
        .map((issue) => `\`${issue.count}x\` [${issue.likelyArea || "unknown"}] ${issue.message}`)
        .join("\n");
    const freezeDetail = summary.freeze
        ? `${summary.freeze.count} · avg ${summary.freeze.averageSeconds.toFixed(1)} seconds · max ${summary.freeze.maxSeconds.toFixed(1)} seconds · extreme ${summary.freeze.extreme}`
        : "none";
    const likelyAreas = Object.entries(summary.byLikelyArea || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([area, count]) => `${area} ${count}`)
        .join(" · ");

    return opsDiscord.postDiscord({
        channel: "dailyBriefing",
        tier: "routine",
        title: summary.total === 0
            ? `All clear: 0 client errors in ${summary.windowHours}h`
            : `${summary.total} client error(s) in ${summary.windowHours}h`,
        description: summary.total === 0
            ? "The error pipeline is alive; users simply hit no reported issues."
            : topIssues,
        fields: [
            { name: "Distinct users", value: String(summary.distinctUsers) },
            { name: "By type", value: byType },
            { name: "Freeze detail", value: freezeDetail },
            { name: "Likely areas", value: likelyAreas }
        ],
        footer: "Firestore: clientErrors"
    }, options);
}

// Attempt to wire alert email from secrets on cold start (log-only if absent).
initPaymentAlertEmailSender();

exports.getPremiumRoute = functions
    .runWith({ secrets: ["ORS_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], timeoutSeconds: 120, maxInstances: 3 })
    .https.onCall(wrapCallableWithPaymentAlert("getPremiumRoute", handlePremiumRoute));

// Additive beta path: production clients stay on getPremiumRoute until the
// compact response has completed beta soak. One resident instance avoids a
// container startup, while the compact response reduces phone heap. Provider
// and Firebase phases are timed separately because their latency is external.
exports.getPremiumRouteCompact = functions
    .runWith({
        secrets: ["ORS_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"],
        timeoutSeconds: 120,
        minInstances: 1,
        maxInstances: 5
    })
    .https.onCall(wrapCallableWithPaymentAlert("getPremiumRouteCompact", handlePremiumRouteCompact));

exports.getPremiumGeocode = functions
    .runWith({ secrets: ["ORS_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 5 })
    .https.onCall(wrapCallableWithPaymentAlert("getPremiumGeocode", handlePremiumGeocode));

exports.createCheckoutSession = functions
    .runWith({
        secrets: ["LEMONSQUEEZY_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"],
        minInstances: 1,
        maxInstances: 5
    })
    .https.onCall(wrapCallableWithPaymentAlert("createCheckoutSession", handleCreateCheckoutSession));

exports.redeemAccessOrPromoCode = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"] })
    .https.onCall(wrapCallableWithPaymentAlert("redeemAccessOrPromoCode", handleRedeemAccessOrPromoCode));

exports.getCustomerPortalUrl = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 5 })
    .https.onCall(wrapCallableWithPaymentAlert("getCustomerPortalUrl", handleGetCustomerPortalUrl));

exports.restorePremiumPurchase = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 5 })
    .https.onCall(wrapCallableWithPaymentAlert("restorePremiumPurchase", handleRestorePremiumPurchase));

exports.cancelPremiumSubscription = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 3 })
    .https.onCall(wrapCallableWithPaymentAlert("cancelPremiumSubscription", handleCancelPremiumSubscription));

exports.lemonSqueezyWebhook = functions
    .runWith({ secrets: ["LEMONSQUEEZY_WEBHOOK_SECRET", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 10 })
    .https.onRequest(async (req, res) => {
        return handleLemonSqueezyWebhook(req, res);
    });

exports.syncLeaderboardScore = functions
    .runWith({ secrets: ["ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 10 })
    .https.onCall(wrapCallableWithPaymentAlert("syncLeaderboardScore", handleSyncLeaderboardScore));

exports.submitFeedback = functions
    .runWith({ secrets: ["ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 5 })
    .https.onCall(wrapCallableWithPaymentAlert("submitFeedback", handleSubmitFeedback));

exports.deleteAccount = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY", "ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 3 })
    .https.onCall(wrapCallableWithPaymentAlert("deleteAccount", handleDeleteAccount));

// Client-side error/freeze reports from the browser app. Internal persistence
// failures are swallowed, but the durable write limiter may return a reset time.
// It remains intentionally separate from payment-failure alert wrapping.
exports.reportClientError = functions
    .runWith({ secrets: ["ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"], maxInstances: 5 })
    .https.onCall(async (requestOrData, context) => {
        return handleReportClientError(requestOrData, context);
    });

if (process.env.NODE_ENV === "test") {
    exports.__test = {
        normalizeEntitlement,
        isEffectivePremium,
        isFunctionFlagEnabled,
        requireFunctionFlagEnabled,
        isCallableEmailVerified,
        requireVerifiedEmailCallable,
        enforcePremiumCallableRateLimit,
        createProviderAttemptBudget,
        getFeedbackRateLimit,
        enforceFeedbackRateLimit,
        enforceAnonymousFeedbackRateLimit,
        getFeedbackConnectionKey,
        cleanContactEmail,
        redactSensitiveDiagnosticText,
        cleanDiagnosticPath,
        handleSubmitFeedback,
        handleDeleteAccount,
        handleCancelPremiumSubscription,
        requirePremiumCallable,
        handlePremiumRoute,
        handlePremiumRouteCompact,
        handlePremiumGeocode,
        normalizeRouteCoordinates,
        normalizeRouteWaypoints,
        extractSnappedRouteCoordinates,
        snapRouteCoordinates,
        getOrsEndpointName: orsTelemetry.getOrsEndpointName,
        getOrsQuotaObservation: orsTelemetry.getOrsQuotaObservation,
        getLemonSqueezyConfig,
        getLemonSqueezyProviderConfig,
        getLemonSqueezyModeConfig,
        shouldAcceptLemonSqueezyWebhookMode,
        buildCheckoutReturnUrl,
        buildLemonSqueezyCheckoutPayload,
        extractLemonSqueezyCheckoutUrl,
        extractLemonSqueezyCustomerPortalUrl,
        handleCreateCheckoutSession,
        handleGetCustomerPortalUrl,
        buildLemonSqueezySubscriptionsListUrl,
        getLemonSqueezySubscriptionListFromResponse,
        hasLemonSqueezyBillingSignal,
        selectRestorableLemonSqueezySubscription,
        handleRestorePremiumPurchase,
        handleRedeemAccessOrPromoCode,
        isActiveAccessCodeEntitlement,
        getActiveAccessCodeFallback,
        verifyLemonSqueezyWebhookSignature,
        deriveLemonSqueezyEventId,
        buildLemonSqueezyEventDocId,
        getLemonSqueezyProviderEventMillis,
        isStaleLemonSqueezyEvent,
        mapLemonSqueezyEntitlement,
        processLemonSqueezyWebhookEntitlement,
        handleLemonSqueezyWebhook,
        calculateServerLeaderboardScore,
        handleSyncLeaderboardScore,
        getManualCoordinates,
        shouldAlertOnPaymentError,
        extractAlertIdentity,
        buildPaymentAlertPayload,
        deliverPaymentAlert,
        wrapCallableWithPaymentAlert,
        setPaymentAlertEmailSender,
        resetAlertThrottle,
        alertEmailAllowed,
        formatPaymentAlertEmailBody,
        cleanClientErrorType,
        getClientErrorRateLimit,
        clientErrorEmailAllowed,
        handleReportClientError,
        summarizeClientErrors,
        formatDigestEmailBody,
        runDailyErrorDigest,
        routeAlertToDiscord,
        postFeedbackToDiscord,
        postBillingEventToDiscord,
        postDigestToDiscord,
        runOpsMetricsRollup,
        costReporting,
        dataIntegrity,
        opsDiscord,
        opsMetrics,
        analyticsReporting,
        feedbackAttachments
    };
}

exports.dailyErrorDigest = functions
    .runWith({ secrets: ["ALERT_EMAIL_USER", "ALERT_EMAIL_PASSWORD", "DISCORD_WEBHOOKS_JSON"] })
    .pubsub.schedule("0 12 * * *")
    .timeZone("America/New_York")
    .onRun(async () => {
        return runDailyErrorDigest();
    });

// Routine-tier rollup: traffic from GoatCounter plus counts from Firestore, in
// one post. Counts use aggregation queries, so this stays cheap no matter how
// much the collections grow.
async function runOpsMetricsRollup({ windowHours, channel, title, mirrors = [], persistSnapshot = false }, options = {}) {
    const db = options.firestore || admin.firestore();
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const periodDays = Math.max(1, Math.round(windowHours / 24));
    const period = analyticsReporting.getCompletedCalendarPeriod(nowMs, periodDays);
    const sinceMs = period.startMs;
    const throughMs = period.endMs;

    const summary = await opsMetrics.collectOpsMetrics({
        db,
        sinceDate: Timestamp.fromMillis(sinceMs),
        throughDate: Timestamp.fromMillis(throughMs),
        sinceMs,
        nowMs: throughMs,
        startDate: period.startDate,
        endDate: period.endDate
    }, options);
    summary.collectedAt = new Date(nowMs).toISOString();
    summary.period = period;
    summary.periodLabel = period.label;

    if (persistSnapshot) {
        summary.accountReconciliation = await analyticsReporting.collectAccountReconciliation(db, admin.auth());
        const snapshot = await analyticsReporting.saveAnalyticsSnapshot(db, summary, period, { nowMs });
        summary.cumulative = snapshot.cumulative;
    }

    const paymentFunnelAlert = opsMetrics.buildPaymentFunnelAlertMessage(summary.traffic);
    if (paymentFunnelAlert) {
        try {
            await opsDiscord.postDiscord(paymentFunnelAlert, options);
        } catch (err) {
            console.error("[metrics] payment funnel Discord notify issue:", err && err.message);
        }
    }

    const destinations = [{ channel, title }, ...mirrors];
    for (const destination of destinations) {
        try {
            await opsDiscord.postDiscord(opsMetrics.buildMetricsMessage(summary, destination), options);
        } catch (err) {
            console.error("[metrics] Discord notify issue:", err && err.message);
        }
    }

    return summary;
}

// Bind the read-only GoatCounter token so traffic can be included alongside
// the cheap Firestore aggregation counts in the same scheduled rollup.
exports.dailyOpsMetrics = functions
    .runWith({ secrets: ["DISCORD_WEBHOOKS_JSON", "GOATCOUNTER_API_TOKEN"] })
    // GA4's finalized prior-day report is typically ready later in the day.
    // Posting after 16:00 ET avoids presenting an intraday reprocessing value
    // as final while still preserving GoatCounter as an immediate cross-check.
    .pubsub.schedule("15 16 * * *")
    .timeZone("America/New_York")
    .onRun(async () => {
        return runOpsMetricsRollup({
            windowHours: 24,
            channel: "dailyMetrics",
            title: "Daily metrics",
            persistSnapshot: true,
            // Reuse the same already-collected summary. This gives the launch
            // room a daily health pulse with no additional Firestore reads and
            // no additional scheduler job.
            mirrors: [{ channel: "launchMonitoring", title: "Daily launch health pulse" }]
        });
    });

exports.weeklyOpsReport = functions
    .runWith({ secrets: ["DISCORD_WEBHOOKS_JSON", "GOATCOUNTER_API_TOKEN"] })
    .pubsub.schedule("20 16 * * 1")
    .timeZone("America/New_York")
    .onRun(async () => {
        return runOpsMetricsRollup({
            windowHours: 24 * 7,
            channel: "weeklyReport",
            title: "Weekly report"
        });
    });

// One hourly job covers both fast anomaly detection and the once-daily cost
// summary. Keeping those responsibilities in one single-instance scheduler
// adds only one Cloud Scheduler job and prevents overlapping state updates.
exports.hourlyCostMonitoring = functions
    .runWith({
        secrets: ["DISCORD_WEBHOOKS_JSON", "DISCORD_COSTS_WEBHOOK"],
        timeoutSeconds: 120,
        maxInstances: 1
    })
    .pubsub.schedule("20 * * * *")
    .timeZone("America/New_York")
    .onRun(async () => {
        return costReporting.runHourlyCostMonitoring();
    });

// REMOVED 2026-08-07: generateHourlyLeaderboard.
//
// It ran every hour and read the whole `leaderboard` collection (limit 100, 80
// documents in practice) to build a `system/leaderboardData` summary. Nothing
// ever read that summary: the client renders the leaderboard by querying
// `leaderboard` directly with limit(5) in profileEngine.js.
//
// That made it 80 reads/hour = ~1,920 reads/day = ~57,600/month for a document
// no code opened, which was roughly the entire flat daily read floor on this
// project (baseline was ~2,000 reads/day, and it did not move with traffic).
//
// If a precomputed top-N is ever wanted, rebuild it on demand or on a much
// slower schedule, and make sure a reader exists before the writer ships.

// ============================================================================
// 2. DATA REFINERY: GEMINI AI EXTRACTION
// ============================================================================

// ============================================================================
// 1. DATA REFINERY: GEMINI AI EXTRACTION (The "Bouncer")
// ============================================================================
exports.extractParkData = functions
    .runWith({ ...ADMIN_CALLABLE_OPTIONS, secrets: ["GEMINI_API_KEY", "GEMINI_PAID_API_KEY"], memory: '1GB' })
    .https.onCall(async (data, context) => {
        await requireAdminCallable(context, "extractParkData");

        try {
            const payload = data || {};
            // Read the route from the frontend, default to free-3
            const engineRoute = payload.engineRoute || "free-3";
            
            let targetApiKey = "";
            let targetModelName = "";

            // --- THE 7-WAY ROUTING LOGIC ---
            if (engineRoute === "free-3") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-3-flash-preview";
            } 
            else if (engineRoute === "free-31-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-3.1-flash-lite-preview"; 
            }
            else if (engineRoute === "free-25") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.5-flash";
            }
            else if (engineRoute === "free-25-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.5-flash-lite";
            }
            else if (engineRoute === "free-20") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.0-flash";
            }
            else if (engineRoute === "free-20-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.0-flash-lite";
            }
            else if (engineRoute === "paid-3") {
                targetApiKey = process.env.GEMINI_PAID_API_KEY;
                targetModelName = "gemini-3-flash-preview";
            }

            if (!targetApiKey) {
                throw new functions.https.HttpsError("failed-precondition", "AI extraction key is not configured for the selected engine.");
            }

            // Initialize the AI with the dynamically selected key and model
            const genAI = new GoogleGenerativeAI(targetApiKey);
            const model = genAI.getGenerativeModel({ model: targetModelName });

            const prompt = `You are a strict data extraction parser for a National Park accessibility database. 
            Analyze the provided text or sequence of images (labeled with their filenames) and extract the B.A.R.K. Ranger data.
            
            CRITICAL FILTERING RULES:
            1. IGNORE restaurants, pubs, city dog parks, festivals, and personal side-trips.
            2. ONLY extract official National Parks, State Parks, National Historic Sites, or locations explicitly stating they have a B.A.R.K. Ranger program.
            
            DATA EXTRACTION RULES:
            - approvedTrails: Specific trails or areas where dogs ARE allowed.
            - strictRules: Where dogs are NOT allowed, stroller rules, and BARK Ranger tag requirements.
            - hazards: Physical dangers or product issues (e.g., weak tag hooks).

            OUTPUT FORMAT:
            You must output an ARRAY of JSON objects. If the post mentions multiple valid parks, create an object for each. 
            
            [
              {
                "sourceImage": "IMG_2281.PNG", // CRITICAL: Use the exact filename provided for the image (e.g., 'IMG_2281.PNG' or 'Text' if not an image).
                "dateFound": "April 2026", // Extract the date the post was made if visible in the text or header.
                "parkName": "Name of official park",
                "entranceFee": "...",
                "swagLocation": "...",
                "approvedTrails": "...",
                "strictRules": "...",
                "hazards": "...",
                "extraSwag": "..."
              }
            ]
            
            Output ONLY a valid JSON array. No markdown, no explanations.`;

            let parts = [];
            
            // 1. TRUE BUNDLE BATCHING: Now with filenames
            if (payload.images && payload.images.length > 0) {
                payload.images.forEach((imgObj) => {
                    const cleanBase64 = imgObj.data.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                    
                    // We label the part so the AI knows which name belongs to which image
                    parts.push(`--- START OF IMAGE: ${imgObj.name} ---`);
                    parts.push({ inlineData: { data: cleanBase64, mimeType: "image/jpeg" } });
                });
                // Add the text prompt at the very end of the pile
                parts.push(prompt);
            } 
            // 2. Fallback for a single image
            else if (payload.image) {
                const base64String = payload.image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                parts = [{ inlineData: { data: base64String, mimeType: "image/jpeg" } }, prompt];
            } 
            // 3. Fallback for raw text
            else {
                parts = [payload.text, prompt];
            }

            const result = await model.generateContent(parts);
            const responseText = result.response.text();
            const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(cleanedText);
            console.log("AI RAW OUTPUT:", JSON.stringify(aiData, null, 2));
            return aiData;
        } catch (error) {
            console.error("AI Error:", error);
            throwHttpsError(error, error.message || "AI extraction failed.");
        }
    });

// ============================================================================
// 2. SPREADSHEET BRIDGE: THE NEW SITE GUARDRAIL
// ============================================================================
exports.syncToSpreadsheet = functions
    .runWith(ADMIN_CALLABLE_OPTIONS)
    .https.onCall(async (data, context) => {
        await requireAdminCallable(context, "syncToSpreadsheet");

        try {
            const auth = new google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            const sheets = google.sheets({ version: 'v4', auth });

            const spreadsheetId = '1fnlZfRbfQIy-o2Df6FgEdTMw9OWTR3-JX011s-7oWlE'; 
            const sheetName = 'National B.A.R.K Ranger'; 
            const newPark = data; 

            // 1. Fetch the ENTIRE row through Park ID so updates can preserve it.
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!A:P`,
            });

            const rows = response.data.values || [];
        
        // --- HIGH-PRECISION MATCHING ENGINE ---
        const superNormalize = (str) => {
            let s = str.toLowerCase();
            s = s.replace(/\./g, ' '); 
            s = s.replace(/&/g, 'and');
            s = s.replace(/\bmt\b/g, 'mount');
            s = s.replace(/\bft\b/g, 'fort');
            s = s.replace(/\bst\b/g, 'saint');
            s = s.replace(/\bnp\b/g, 'national park');
            s = s.replace(/\bnm\b/g, 'national monument');
            s = s.replace(/\bnhs\b/g, 'national historic site');
            s = s.replace(/\bnra\b/g, 'national recreation area');
            s = s.replace(/\b96\b/g, 'ninetysix');
            return s.replace(/[^a-z0-9]/g, '');
        };
        
        const aiNameNorm = superNormalize(newPark.parkName);
        let bestMatch = { rowIndex: -1, score: 0, lengthDiff: 999 };

        for (let i = 0; i < rows.length; i++) {
            if (!rows[i][0]) continue;
            
            const sheetNameNorm = superNormalize(rows[i][0]);
            let currentScore = 0;

            if (sheetNameNorm === aiNameNorm) {
                currentScore = 100;
            } else if (sheetNameNorm.includes(aiNameNorm) || aiNameNorm.includes(sheetNameNorm)) {
                currentScore = 80;
            }

            const currentDiff = Math.abs(sheetNameNorm.length - aiNameNorm.length);

            if (currentScore > bestMatch.score) {
                bestMatch = { rowIndex: i + 1, score: currentScore, lengthDiff: currentDiff };
            } else if (currentScore === bestMatch.score && currentScore > 0) {
                if (currentDiff < bestMatch.lengthDiff) {
                    bestMatch = { rowIndex: i + 1, score: currentScore, lengthDiff: currentDiff };
                }
            }
        }

        // --- SMART MERGE LOGIC ---
        const dateString = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
        
        const mergeCell = (oldVal, newVal) => {
            if (!newVal || newVal.trim() === '') return oldVal || '';
            if (!oldVal || oldVal.trim() === '') return newVal;
            if (oldVal.includes(newVal.trim())) return oldVal;
            return `${oldVal}\n\n[${dateString}]: ${newVal}`;
        };

        // --- GEOLOCATION INTEGRITY ENGINE ---
        let existingLat = null;
        let existingLng = null;

        if (bestMatch.rowIndex !== -1) {
            const existingRow = rows[bestMatch.rowIndex - 1] || [];
            existingLat = existingRow[7]; // Column H
            existingLng = existingRow[8]; // Column I
        }

        const manualCoordinates = getManualCoordinates(newPark);

        if (manualCoordinates) {
            newPark.lat = manualCoordinates.lat;
            newPark.lng = manualCoordinates.lng;
            console.log(`Manual coordinates accepted for ${newPark.parkName}: ${newPark.lat}, ${newPark.lng}`);
        }
        // Only Geocode if missing OR forceGeocode is true
        else if (!existingLat || !existingLng || newPark.forceGeocode === true) {
            try {
                const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
                if (!googleMapsKey) {
                    console.warn(`GOOGLE_MAPS_API_KEY not configured; skipping geocoding for ${newPark.parkName}`);
                } else {
                    console.log(`Geocoding: ${newPark.parkName}...`);
                    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(newPark.parkName)}&key=${googleMapsKey}`;
                    const geoResponse = await axios.get(geoUrl);
                    if (geoResponse.data.results && geoResponse.data.results.length > 0) {
                        const location = geoResponse.data.results[0].geometry.location;
                        newPark.lat = location.lat;
                        newPark.lng = location.lng;
                        console.log(`Found Coords: ${newPark.lat}, ${newPark.lng}`);
                    }
                }
            } catch (e) {
                console.error("Geocoding failed:", e.message);
            }
        } else {
            newPark.lat = existingLat;
            newPark.lng = existingLng;
            console.log(`Locked: Using existing coordinates for ${newPark.parkName}`);
        }

        // 2. Perform the Update or Append
        if (bestMatch.rowIndex !== -1 && bestMatch.score >= 80) {
            const existingRow = rows[bestMatch.rowIndex - 1] || [];
            
            const existingParkId = cleanSheetCell(existingRow[15]); // Column P

            // Map the spreadsheet columns: H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14.
            // Column P is Park ID and must never be overwritten by refinery updates.
            const updateData = [
                newPark.lat || existingLat || '',  // H
                newPark.lng || existingLng || '',  // I
                mergeCell(existingRow[9], newPark.entranceFee), // J
                mergeCell(existingRow[10], newPark.swagLocation), // K
                mergeCell(existingRow[11], newPark.approvedTrails), // L
                mergeCell(existingRow[12], newPark.strictRules), // M
                mergeCell(existingRow[13], newPark.hazards), // N
                mergeCell(existingRow[14], newPark.extraSwag) // O
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!H${bestMatch.rowIndex}:O${bestMatch.rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [updateData] }
            });
            return { success: true, action: 'updated', row: bestMatch.rowIndex, confidence: bestMatch.score, parkIdPreserved: existingParkId || null };
        } else {
            // NEW GUARDRAIL: Only append if the frontend explicitly gave permission
            if (newPark.allowAppend !== true) {
                return { 
                    success: false, 
                    requiresConfirmation: true, 
                    message: `⚠️ New Site Detected: "${newPark.parkName}"` 
                };
            }

            const appendParkId = getCanonicalParkId(newPark.parkId) || randomUUID();
            const appendData = [
                newPark.parkName, "", "", "", "", "", "", 
                newPark.lat || '', 
                newPark.lng || '', 
                newPark.entranceFee, newPark.swagLocation, newPark.approvedTrails, 
                newPark.strictRules, newPark.hazards, newPark.extraSwag,
                appendParkId
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!A:P`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [appendData] }
            });
            return { success: true, action: 'appended', parkId: appendParkId };
        }
    } catch (error) {
        console.error("Spreadsheet Error:", error);
        throwHttpsError(error, 'Failed to sync to Sheets');
    }
});
