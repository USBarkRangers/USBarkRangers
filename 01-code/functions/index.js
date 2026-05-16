const functions = require('firebase-functions/v1');
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const axios = require("axios");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const { createHash, createHmac, randomUUID, timingSafeEqual } = require("crypto");

// Initialize Firebase Admin SDK
admin.initializeApp();

// Keep admin callables compatible with the current admin page. The backend
// still enforces signed-in admin status plus per-admin rate limits.
const ADMIN_CALLABLE_OPTIONS = {};

const ADMIN_RATE_LIMITS = {
    extractParkData: { maxRequests: 20, windowMs: 60 * 1000 },
    syncToSpreadsheet: { maxRequests: 10, windowMs: 60 * 1000 }
};

const PREMIUM_CALLABLE_RATE_LIMITS = {
    getPremiumRoute: {
        maxRequests: 30,
        windowMs: 60 * 60 * 1000,
        envMaxKey: "BARK_RATE_LIMIT_PREMIUM_ROUTE_MAX",
        envWindowKey: "BARK_RATE_LIMIT_PREMIUM_ROUTE_WINDOW_MS",
        message: "Route generation limit reached. Please try again shortly."
    },
    getPremiumGeocode: {
        maxRequests: 120,
        windowMs: 60 * 60 * 1000,
        envMaxKey: "BARK_RATE_LIMIT_PREMIUM_GEOCODE_MAX",
        envWindowKey: "BARK_RATE_LIMIT_PREMIUM_GEOCODE_WINDOW_MS",
        message: "Global town search limit reached. Please try again shortly."
    }
};

const FEEDBACK_RATE_LIMIT = {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
    envMaxKey: "BARK_RATE_LIMIT_FEEDBACK_MAX",
    envWindowKey: "BARK_RATE_LIMIT_FEEDBACK_WINDOW_MS",
    message: "Feedback submission limit reached. Please try again shortly."
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

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPremiumCallableRateLimit(action, options = {}) {
    const defaults = PREMIUM_CALLABLE_RATE_LIMITS[action];
    if (!defaults) return null;

    const optionLimits = options.premiumCallableRateLimits || {};
    const override = optionLimits && typeof optionLimits[action] === "object" ? optionLimits[action] : {};
    const env = options.env || process.env;

    return {
        maxRequests: parsePositiveInteger(
            override.maxRequests === undefined ? env[defaults.envMaxKey] : override.maxRequests,
            defaults.maxRequests
        ),
        windowMs: parsePositiveInteger(
            override.windowMs === undefined ? env[defaults.envWindowKey] : override.windowMs,
            defaults.windowMs
        ),
        message: typeof override.message === "string" && override.message.trim()
            ? override.message.trim()
            : defaults.message
    };
}

function getRateLimitRetrySeconds(windowEndsAt, now) {
    return Math.max(1, Math.ceil((windowEndsAt - now) / 1000));
}

async function enforcePremiumCallableRateLimit(uid, action, options = {}) {
    const limit = getPremiumCallableRateLimit(action, options);
    if (!limit) return;

    const db = options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        console.error("[premiumRateLimit] Firestore transaction support is unavailable.", { uid, action });
        throw new functions.https.HttpsError("internal", "Rate limit could not be verified.");
    }

    const now = Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now();
    const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
    const windowEndsAt = windowStart + limit.windowMs;
    const safeUid = encodeURIComponent(uid);
    const safeAction = encodeURIComponent(action);
    const ref = db.collection("_premiumCallableRateLimits").doc(`${safeAction}_${safeUid}_${windowStart}`);

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
            uid,
            action,
            count: currentCount + 1,
            limit: limit.maxRequests,
            windowStart: Timestamp.fromMillis(windowStart),
            windowEndsAt: Timestamp.fromMillis(windowEndsAt),
            expiresAt: Timestamp.fromMillis(windowEndsAt + 24 * 60 * 60 * 1000),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

function getFeedbackRateLimit(options = {}) {
    const env = options.env || process.env;
    const override = options.feedbackRateLimit || {};
    return {
        maxRequests: parsePositiveInteger(
            override.maxRequests === undefined ? env[FEEDBACK_RATE_LIMIT.envMaxKey] : override.maxRequests,
            FEEDBACK_RATE_LIMIT.maxRequests
        ),
        windowMs: parsePositiveInteger(
            override.windowMs === undefined ? env[FEEDBACK_RATE_LIMIT.envWindowKey] : override.windowMs,
            FEEDBACK_RATE_LIMIT.windowMs
        ),
        message: typeof override.message === "string" && override.message.trim()
            ? override.message.trim()
            : FEEDBACK_RATE_LIMIT.message
    };
}

async function enforceFeedbackRateLimit(uid, options = {}) {
    const limit = getFeedbackRateLimit(options);
    const db = options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        console.error("[feedback] Firestore transaction support is unavailable.", { uid });
        throw new functions.https.HttpsError("internal", "Feedback rate limit could not be verified.");
    }

    const now = Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now();
    const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
    const windowEndsAt = windowStart + limit.windowMs;
    const safeUid = encodeURIComponent(uid);
    const ref = db.collection("_feedbackRateLimits").doc(`${safeUid}_${windowStart}`);

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
            uid,
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
        path: cleanFeedbackString(metadata.path, 200),
        viewportWidth: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : null,
        viewportHeight: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : null
    };
}

async function handleSubmitFeedback(requestOrData, context, options = {}) {
    const uid = requireAuthCallable(context);
    const payload = getCallablePayload(requestOrData);
    const message = cleanFeedbackText(payload.message || payload.text);
    const type = cleanFeedbackType(payload.type);
    const browser = cleanFeedbackBrowserMetadata(payload.browser || payload.metadata);
    const token = getCallableAuthToken(context);
    const db = options.firestore || admin.firestore();

    await enforceFeedbackRateLimit(uid, options);

    const addPayload = {
        uid,
        type,
        message,
        browser,
        email: cleanFeedbackString(token.email, 254),
        displayName: cleanFeedbackString(token.name, 120),
        source: "app_feedback",
        status: "new",
        createdAt: FieldValue.serverTimestamp()
    };

    await db.collection("feedback").add(addPayload);
    return { ok: true };
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

function normalizePromoCode(value) {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    return SAFE_PROMO_CODE_PATTERN.test(normalized) ? normalized : null;
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
    const db = options.firestore || admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const leaderboardRef = db.collection("leaderboard").doc(uid);
    const token = context && context.auth && context.auth.token ? context.auth.token : {};

    let result = null;

    await db.runTransaction(async (transaction) => {
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

// ============================================================================
// 1. LEGACY MAP FUNCTIONS (ROUTING & LEADERBOARD)
// ============================================================================

const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
const ORS_SNAP_URL = "https://api.openrouteservice.org/v2/snap/driving-car/json";
const ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search";
const ROUTE_SNAP_RADIUS_METERS = 2000;
const ROUTE_FALLBACK_GEOCODE_RADIUS_KM = 50;
const ROUTE_FALLBACK_GEOCODE_SIZE = 10;
const ROUTE_FALLBACK_CANDIDATE_LIMIT = 6;
const ORS_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const ORS_RETRY_MAX_ATTEMPTS = 4;
const ORS_RETRY_BASE_DELAY_MS = 1500;
const ORS_RETRY_MAX_DELAY_MS = 12000;

function getCallablePayload(requestOrData) {
    return requestOrData && requestOrData.data ? requestOrData.data : requestOrData || {};
}

function getOrsApiKey(options = {}) {
    return typeof options.getOrsApiKey === "function" ? options.getOrsApiKey() : process.env.ORS_API_KEY;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function getHeaderValue(headers, headerName) {
    if (!headers || !headerName) return null;
    if (typeof headers.get === "function") return headers.get(headerName);

    const lowerName = headerName.toLowerCase();
    const matchingKey = Object.keys(headers).find(key => key.toLowerCase() === lowerName);
    return matchingKey ? headers[matchingKey] : null;
}

function parseRetryAfterMs(value) {
    if (!value) return null;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());

    return null;
}

function getOrsErrorStatus(error) {
    const status = error && error.response ? Number(error.response.status) : Number(error && error.status);
    return Number.isFinite(status) ? status : null;
}

function isRetryableOrsError(error) {
    const status = getOrsErrorStatus(error);
    if (status) return ORS_RETRYABLE_STATUS_CODES.has(status);

    return Boolean(error && !error.response);
}

function getOrsRetryDelayMs(error, attemptIndex, options = {}) {
    const baseDelay = Number.isFinite(Number(options.orsRetryBaseDelayMs))
        ? Number(options.orsRetryBaseDelayMs)
        : ORS_RETRY_BASE_DELAY_MS;
    const maxDelay = Number.isFinite(Number(options.orsRetryMaxDelayMs))
        ? Number(options.orsRetryMaxDelayMs)
        : ORS_RETRY_MAX_DELAY_MS;
    const retryAfterMs = parseRetryAfterMs(getHeaderValue(error && error.response && error.response.headers, "retry-after"));
    const exponentialDelay = baseDelay * (2 ** attemptIndex);
    const cappedDelay = Math.min(maxDelay, retryAfterMs !== null ? retryAfterMs : exponentialDelay);
    const jitter = options.disableOrsRetryJitter
        ? 0
        : Math.floor(Math.random() * Math.min(500, Math.max(0, baseDelay / 3)));

    return Math.max(0, cappedDelay + jitter);
}

async function requestOrsWithRetry(requestFn, options = {}) {
    const maxAttempts = Number.isFinite(Number(options.orsRetryMaxAttempts))
        ? Math.max(1, Math.floor(Number(options.orsRetryMaxAttempts)))
        : ORS_RETRY_MAX_ATTEMPTS;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        try {
            return await requestFn();
        } catch (error) {
            const isLastAttempt = attemptIndex >= maxAttempts - 1;
            if (isLastAttempt || !isRetryableOrsError(error)) throw error;

            const delayMs = getOrsRetryDelayMs(error, attemptIndex, options);
            console.warn("[routing] ORS request was throttled or unavailable; retrying.", {
                status: getOrsErrorStatus(error),
                attempt: attemptIndex + 1,
                maxAttempts,
                delayMs
            });

            if (delayMs > 0) await sleep(delayMs);
        }
    }

    throw new Error("ORS retry exhausted.");
}

function getOrsWithRetry(get, url, options = {}) {
    return requestOrsWithRetry(() => get(url), options);
}

function postOrsWithRetry(post, url, body, config, options = {}) {
    return requestOrsWithRetry(() => post(url, body, config), options);
}

function isValidRouteCoordinatePair(pair) {
    return Array.isArray(pair) &&
        pair.length >= 2 &&
        Number.isFinite(Number(pair[0])) &&
        Number.isFinite(Number(pair[1]));
}

function normalizeRouteCoordinatePair(pair) {
    if (!isValidRouteCoordinatePair(pair)) return null;
    return [Number(pair[0]), Number(pair[1])];
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
            name: cleanOptionalString(waypoint && waypoint.name),
            state: cleanOptionalString(waypoint && waypoint.state),
            country: cleanOptionalString(waypoint && waypoint.country) || "US",
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
                console.warn("[routing] ORS fallback geocode failed; keeping original waypoint coordinate.", {
                    waypoint: waypoints[index] && waypoints[index].name,
                    message: error && error.message ? error.message : String(error)
                });
            }
        }

        return coordinates.map((coordinate, index) => snapped[index] || coordinate);
    } catch (error) {
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
const LEMONSQUEEZY_LIVE_APPROVAL_ENV = "BARK_LEMON_LIVE_MODE_APPROVAL";
const LEMONSQUEEZY_LIVE_APPROVAL_VALUE = "CARTER_APPROVED_LIVE_RC";
const LEMONSQUEEZY_MODE_LOCK_REASON = "Lemon Squeezy live mode remains locked until Carter explicitly approves the final RC switch.";
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
const SAFE_PROMO_CODE_PATTERN = /^[A-Z0-9]{3,64}$/;
const ACCESS_CODE_AUDIENCES = new Set(["admin_mod", "vip", "support", "tester", "general"]);

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

function getLemonSqueezyModeConfig(options = {}) {
    const env = options.env || process.env;
    const approvalValue = cleanOptionalString(options.liveModeApproval) ||
        cleanOptionalString(env[LEMONSQUEEZY_LIVE_APPROVAL_ENV]);
    return {
        checkoutTestMode: true,
        acceptLiveWebhooks: false,
        liveModeApproved: approvalValue === LEMONSQUEEZY_LIVE_APPROVAL_VALUE,
        approvalEnv: LEMONSQUEEZY_LIVE_APPROVAL_ENV,
        approvalValue: LEMONSQUEEZY_LIVE_APPROVAL_VALUE,
        lockReason: LEMONSQUEEZY_MODE_LOCK_REASON
    };
}

function shouldAcceptLemonSqueezyWebhookMode(attributes, options = {}) {
    const mode = getLemonSqueezyModeConfig(options);
    if (!attributes) return false;
    if (attributes.test_mode === true) return true;
    return attributes.test_mode === false && mode.acceptLiveWebhooks === true;
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
        storeId: DEFAULT_LEMONSQUEEZY_STORE_ID,
        annualVariantId: DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID,
        appBaseUrl: DEFAULT_APP_BASE_URL
    };
}

function buildCheckoutReturnUrl(appBaseUrl, state) {
    const url = new URL(appBaseUrl || DEFAULT_APP_BASE_URL);
    url.searchParams.set("checkout", state);
    url.searchParams.set("provider", "lemonsqueezy");
    return url.toString();
}

function buildLemonSqueezyCheckoutPayload({ uid, token = {}, config, discountCode = null }) {
    const mode = getLemonSqueezyModeConfig(config);
    const successUrl = buildCheckoutReturnUrl(config.appBaseUrl, "success");
    const cancelUrl = buildCheckoutReturnUrl(config.appBaseUrl, "canceled");
    const email = cleanOptionalString(token.email);
    const name = cleanOptionalString(token.name) || cleanOptionalString(token.displayName);
    const safeDiscountCode = discountCode ? normalizePromoCode(discountCode) : null;
    const checkoutData = {
        custom: {
            firebase_uid: uid,
            source: "bark_ranger_map",
            plan: "annual",
            cancel_url: cancelUrl
        }
    };

    if (email) checkoutData.email = email;
    if (name) checkoutData.name = name;
    if (safeDiscountCode) checkoutData.discount_code = safeDiscountCode;

    return {
        data: {
            type: "checkouts",
            attributes: {
                test_mode: mode.checkoutTestMode,
                product_options: {
                    enabled_variants: [Number(config.annualVariantId)],
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
                        id: String(config.annualVariantId)
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

    if (!checkoutUrl || typeof checkoutUrl !== "string") {
        throw new functions.https.HttpsError("internal", "Checkout service returned an invalid response.");
    }

    return checkoutUrl;
}

function getLemonSqueezyCustomerPortalUrlFromAttributes(attributes = {}) {
    const urls = attributes && attributes.urls && typeof attributes.urls === "object" && !Array.isArray(attributes.urls)
        ? attributes.urls
        : {};
    const customerPortalUrl = normalizeHttpsUrl(urls.customer_portal);
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
    url.searchParams.set("filter[variant_id]", String(config.annualVariantId));
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
    const attributes = subscription && subscription.attributes && typeof subscription.attributes === "object"
        ? subscription.attributes
        : {};
    const requestedEmail = normalizeEmail(email);
    const subscriptionEmail = normalizeEmail(attributes.user_email);
    if (requestedEmail && subscriptionEmail && requestedEmail !== subscriptionEmail) return false;
    if (attributes.store_id !== undefined && String(attributes.store_id) !== DEFAULT_LEMONSQUEEZY_STORE_ID) return false;

    const variantId = getLemonSqueezyVariantId({ data: subscription }, attributes);
    if (variantId && String(variantId) !== DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID) return false;

    const eventName = getLemonSqueezySubscriptionSyncEventName(attributes);
    const payload = buildLemonSqueezySubscriptionSyncPayload(subscription.id, { data: { data: subscription } }, eventName);
    const mapping = mapLemonSqueezyEntitlement(payload, eventName, options);
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
        const subscription = selectRestorableLemonSqueezySubscription(subscriptions, email, options);
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
    requireFunctionFlagEnabled("createCheckoutSession", options);
    const uid = requireVerifiedEmailCallable(context);
    const data = getCallablePayload(requestOrData);
    const rawDiscountCode = data && data.discountCode;
    const discountCode = rawDiscountCode ? normalizePromoCode(rawDiscountCode) : null;
    if (rawDiscountCode && !discountCode) {
        throw new functions.https.HttpsError("invalid-argument", "Discount code format is not supported.");
    }
    const config = getLemonSqueezyConfig(options);
    const token = context && context.auth && context.auth.token ? context.auth.token : {};
    const payload = buildLemonSqueezyCheckoutPayload({ uid, token, config, discountCode });
    const post = options.axiosPost || axios.post;

    try {
        const response = await post(LEMONSQUEEZY_CHECKOUTS_URL, payload, {
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${config.apiKey}`
            }
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
    const db = options.firestore || admin.firestore();

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
    const apiTarget = buildLemonSqueezyCustomerPortalApiTarget(billingReference);
    const config = getLemonSqueezyConfig(options);
    const get = options.axiosGet || axios.get;
    try {
        console.log("[payments] Customer portal Lemon API lookup starting.", {
            uid,
            hasSubscriptionId,
            hasCustomerId,
            lookupType: apiTarget.type,
            lemonApiEndpoint: apiTarget.url
        });
        const response = await get(apiTarget.url, {
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
            lookupType: apiTarget.type,
            lemonApiEndpoint: apiTarget.url,
            lemonResponseStatus: response && response.status ? response.status : null
        });

        const attributes = response &&
            response.data &&
            response.data.data &&
            response.data.data.attributes;
        if (attributes && attributes.store_id !== undefined && String(attributes.store_id) !== DEFAULT_LEMONSQUEEZY_STORE_ID) {
            throw new functions.https.HttpsError("permission-denied", "Subscription store mismatch.");
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

    if (attributes.store_id !== undefined && String(attributes.store_id) !== DEFAULT_LEMONSQUEEZY_STORE_ID) {
        return { action: "ignore", reason: "store_mismatch" };
    }

    const variantId = getLemonSqueezyVariantId(payload, attributes);
    if (variantId && String(variantId) !== DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID) {
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

        let entitlement = {
            ...mapping.entitlement,
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

    if (!isValidFirebaseUid(uid)) {
        console.warn("[payments] Lemon Squeezy webhook ignored because firebase_uid is missing or invalid.", {
            eventName,
            eventId
        });
        return safeResponse(res, 200, { ok: true, ignored: true, reason: "missing_uid" });
    }

    const mapping = mapLemonSqueezyEntitlement(payload, eventName, options);
    if (mapping.action !== "write") {
        return safeResponse(res, 200, { ok: true, ignored: true, reason: mapping.reason || "ignored" });
    }

    const result = await processLemonSqueezyWebhookEntitlement({
        uid,
        eventName,
        eventId,
        rawBody,
        mapping,
        payload
    }, options);

    if (result.duplicate) {
        return safeResponse(res, 200, { ok: true, duplicate: true });
    }

    if (result.ignored) {
        return safeResponse(res, 200, { ok: true, ignored: true, reason: result.reason || "ignored" });
    }

    return safeResponse(res, 200, { ok: true });
}

async function handlePremiumRoute(requestOrData, context, options = {}) {
    requireFunctionFlagEnabled("getPremiumRoute", options);
    const uid = requireVerifiedEmailCallable(context);
    await enforcePremiumCallableRateLimit(uid, "getPremiumRoute", options);
    await requirePremiumCallable(context, "getPremiumRoute", options);

    const payload = getCallablePayload(requestOrData);
    const coordinates = normalizeRouteCoordinates(payload.coordinates);
    const radiuses = payload.radiuses;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new functions.https.HttpsError("invalid-argument", "Payload mismatch!");
    }

    const apiKey = getOrsApiKey(options);
    if (!apiKey) {
        throw new functions.https.HttpsError("failed-precondition", "Routing service is not configured.");
    }

    const snappedCoordinates = await snapRouteCoordinates(coordinates, apiKey, {
        ...options,
        waypoints: normalizeRouteWaypoints(payload.waypoints, coordinates)
    });
    const body = { coordinates: snappedCoordinates };
    if (Array.isArray(radiuses) && radiuses.length === coordinates.length) {
        body.radiuses = radiuses;
    }

    try {
        const post = options.axiosPost || axios.post;
        const response = await postOrsWithRetry(post, ORS_DIRECTIONS_URL, body, {
            headers: {
                "Authorization": apiKey,
                "Content-Type": "application/json",
                "Accept": "application/json, application/geo+json; charset=utf-8"
            }
        }, options);
        return response.data;
    } catch (error) {
        const status = getOrsErrorStatus(error);
        console.error("Networking/ORS Error:", error.message, { status });
        if (status === 429) {
            throw new functions.https.HttpsError(
                "resource-exhausted",
                "Routing is busy. Please try again in a minute."
            );
        }
        throw new functions.https.HttpsError("internal", "Failed to calculate route.");
    }
}

async function handlePremiumGeocode(requestOrData, context, options = {}) {
    requireFunctionFlagEnabled("getPremiumGeocode", options);
    const uid = requireVerifiedEmailCallable(context);
    await enforcePremiumCallableRateLimit(uid, "getPremiumGeocode", options);
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
        throw new functions.https.HttpsError("internal", "Failed to perform geocode.");
    }
}

exports.getPremiumRoute = functions
    .runWith({ secrets: ["ORS_API_KEY"], timeoutSeconds: 120 })
    .https.onCall(async (requestOrData, context) => {
        return handlePremiumRoute(requestOrData, context);
    });

exports.getPremiumGeocode = functions
    .runWith({ secrets: ["ORS_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        return handlePremiumGeocode(requestOrData, context);
    });

exports.createCheckoutSession = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        return handleCreateCheckoutSession(requestOrData, context);
    });

exports.redeemAccessOrPromoCode = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        return handleRedeemAccessOrPromoCode(requestOrData, context);
    });

exports.getCustomerPortalUrl = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        return handleGetCustomerPortalUrl(requestOrData, context);
    });

exports.restorePremiumPurchase = functions
    .runWith({ secrets: ["LEMONSQUEEZY_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        return handleRestorePremiumPurchase(requestOrData, context);
    });

exports.lemonSqueezyWebhook = functions
    .runWith({ secrets: ["LEMONSQUEEZY_WEBHOOK_SECRET"] })
    .https.onRequest(async (req, res) => {
        return handleLemonSqueezyWebhook(req, res);
    });

exports.syncLeaderboardScore = functions.https.onCall(async (requestOrData, context) => {
    return handleSyncLeaderboardScore(requestOrData, context);
});

exports.submitFeedback = functions.https.onCall(async (requestOrData, context) => {
    return handleSubmitFeedback(requestOrData, context);
});

if (process.env.NODE_ENV === "test") {
    exports.__test = {
        normalizeEntitlement,
        isEffectivePremium,
        isFunctionFlagEnabled,
        requireFunctionFlagEnabled,
        isCallableEmailVerified,
        requireVerifiedEmailCallable,
        getPremiumCallableRateLimit,
        enforcePremiumCallableRateLimit,
        getFeedbackRateLimit,
        enforceFeedbackRateLimit,
        handleSubmitFeedback,
        requirePremiumCallable,
        handlePremiumRoute,
        handlePremiumGeocode,
        normalizeRouteCoordinates,
        normalizeRouteWaypoints,
        extractSnappedRouteCoordinates,
        getLemonSqueezyConfig,
        getLemonSqueezyModeConfig,
        shouldAcceptLemonSqueezyWebhookMode,
        buildCheckoutReturnUrl,
        normalizePromoCode,
        buildLemonSqueezyCheckoutPayload,
        extractLemonSqueezyCheckoutUrl,
        extractLemonSqueezyCustomerPortalUrl,
        handleCreateCheckoutSession,
        handleGetCustomerPortalUrl,
        buildLemonSqueezySubscriptionsListUrl,
        getLemonSqueezySubscriptionListFromResponse,
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
        handleSyncLeaderboardScore
    };
}

exports.generateHourlyLeaderboard = functions.pubsub.schedule("0 * * * *")
    .timeZone("America/New_York")
    .onRun(async (context) => {
        const db = admin.firestore();
        try {
            const snapshot = await db.collection("leaderboard").orderBy("totalPoints", "desc").limit(100).get();
            const leaderboardArray = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                leaderboardArray.push({
                    uid: doc.id,
                    displayName: data.displayName || "Anonymous Ranger",
                    totalPoints: data.totalPoints || data.totalVisited || 0,
                    totalVisited: data.totalVisited || 0,
                    hasVerified: !!data.hasVerified
                });
            });
            await db.collection("system").doc("leaderboardData").set({
                topUsers: leaderboardArray,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            return null;
        } catch (error) {
            console.error("Error generating leaderboard:", error);
            return null;
        }
    });

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

        // Only Geocode if missing OR forceGeocode is true
        if (!existingLat || !existingLng || newPark.forceGeocode === true) {
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
