const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

const PREMIUM_CALLABLE_RATE_LIMITS = Object.freeze({
    getPremiumRoute: Object.freeze({
        maxRequests: 30,
        windowMs: 60 * 60 * 1000,
        envMaxKey: "BARK_RATE_LIMIT_PREMIUM_ROUTE_MAX",
        envWindowKey: "BARK_RATE_LIMIT_PREMIUM_ROUTE_WINDOW_MS",
        message: "Route generation limit reached. Please try again shortly."
    }),
    getPremiumGeocode: Object.freeze({
        maxRequests: 120,
        windowMs: 60 * 60 * 1000,
        envMaxKey: "BARK_RATE_LIMIT_PREMIUM_GEOCODE_MAX",
        envWindowKey: "BARK_RATE_LIMIT_PREMIUM_GEOCODE_WINDOW_MS",
        message: "Global town search limit reached. Please try again shortly."
    })
});

const RATE_LIMIT_DAY_MS = 24 * 60 * 60 * 1000;

// User-facing, writable, or provider-backed callables get a short burst
// window and, where appropriate, a daily budget. Environment overrides keep
// operational tuning out of the handler layer.
const BOUNDED_CALLABLE_RATE_LIMITS = Object.freeze({
    getPremiumRouteBurst: Object.freeze({ shortMax: 12, shortWindowMs: 10 * 60 * 1000 }),
    getPremiumGeocodeBurst: Object.freeze({ shortMax: 30, shortWindowMs: 5 * 60 * 1000 }),
    createCheckoutSession: Object.freeze({ shortMax: 5, shortWindowMs: 15 * 60 * 1000, dailyMax: 20 }),
    restorePremiumPurchase: Object.freeze({ shortMax: 6, shortWindowMs: 15 * 60 * 1000, dailyMax: 30 }),
    getCustomerPortalUrl: Object.freeze({ shortMax: 15, shortWindowMs: 60 * 60 * 1000, dailyMax: 60 }),
    cancelPremiumSubscription: Object.freeze({ shortMax: 3, shortWindowMs: 60 * 60 * 1000, dailyMax: 5 }),
    deleteAccount: Object.freeze({ shortMax: 2, shortWindowMs: 60 * 60 * 1000, dailyMax: 3 }),
    syncLeaderboardScore: Object.freeze({ shortMax: 30, shortWindowMs: 10 * 60 * 1000, dailyMax: 120 }),
    reportClientError: Object.freeze({ shortMax: 20, shortWindowMs: 60 * 60 * 1000, dailyMax: 50 })
});

const GLOBAL_CALLABLE_RATE_LIMITS = Object.freeze({
    lemonApi: Object.freeze({ shortMax: 200, shortWindowMs: 5 * 60 * 1000, dailyMax: 5000 }),
    leaderboardWrites: Object.freeze({ shortMax: 1000, shortWindowMs: 10 * 60 * 1000 }),
    diagnosticWrites: Object.freeze({ shortMax: 2000, shortWindowMs: 60 * 60 * 1000 })
});

const CALLABLE_GLOBAL_RATE_LIMIT_SCOPE = Object.freeze({
    createCheckoutSession: "lemonApi",
    restorePremiumPurchase: "lemonApi",
    getCustomerPortalUrl: "lemonApi",
    cancelPremiumSubscription: "lemonApi",
    deleteAccount: "lemonApi",
    syncLeaderboardScore: "leaderboardWrites",
    reportClientError: "diagnosticWrites"
});

const PREMIUM_BURST_ACTIONS = Object.freeze({
    getPremiumRoute: "getPremiumRouteBurst",
    getPremiumGeocode: "getPremiumGeocodeBurst"
});

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toRateLimitEnvPrefix(value) {
    return String(value || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .toUpperCase();
}

function resolveBoundedRateLimitConfig(name, defaults, options = {}, overrideGroup = "callableRateLimits") {
    if (!defaults) return null;
    const env = options.env || process.env;
    const overrides = options[overrideGroup] || {};
    const override = overrides && typeof overrides[name] === "object" ? overrides[name] : {};
    const prefix = `BARK_RATE_LIMIT_${toRateLimitEnvPrefix(name)}`;
    return {
        shortMax: parsePositiveInteger(
            override.shortMax === undefined ? env[`${prefix}_SHORT_MAX`] : override.shortMax,
            defaults.shortMax
        ),
        shortWindowMs: parsePositiveInteger(
            override.shortWindowMs === undefined ? env[`${prefix}_SHORT_WINDOW_MS`] : override.shortWindowMs,
            defaults.shortWindowMs
        ),
        dailyMax: defaults.dailyMax
            ? parsePositiveInteger(
                override.dailyMax === undefined ? env[`${prefix}_DAILY_MAX`] : override.dailyMax,
                defaults.dailyMax
            )
            : null
    };
}

function getRateLimitWindowState(stored, prefix, now, windowMs) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const storedStart = Number(stored && stored[`${prefix}WindowStartMs`]);
    const storedCount = Number(stored && stored[`${prefix}Count`]);
    return {
        windowStart,
        windowEndsAt: windowStart + windowMs,
        count: storedStart === windowStart && Number.isFinite(storedCount) ? Math.max(0, storedCount) : 0
    };
}

function buildRateLimitCounterUpdate({ stored, config, now, identity }) {
    const short = getRateLimitWindowState(stored, "short", now, config.shortWindowMs);
    const daily = config.dailyMax
        ? getRateLimitWindowState(stored, "daily", now, RATE_LIMIT_DAY_MS)
        : null;
    const blocked = [];
    if (short.count >= config.shortMax) blocked.push(short.windowEndsAt);
    if (daily && daily.count >= config.dailyMax) blocked.push(daily.windowEndsAt);
    const retryAtMs = blocked.length ? Math.max(...blocked) : null;
    const expiresAtMs = Math.max(short.windowEndsAt, daily ? daily.windowEndsAt : 0) + RATE_LIMIT_DAY_MS;

    return {
        retryAtMs,
        value: {
            ...identity,
            shortWindowStartMs: short.windowStart,
            shortCount: short.count + 1,
            shortLimit: config.shortMax,
            dailyWindowStartMs: daily ? daily.windowStart : null,
            dailyCount: daily ? daily.count + 1 : null,
            dailyLimit: daily ? config.dailyMax : null,
            expiresAt: Timestamp.fromMillis(expiresAtMs),
            updatedAt: FieldValue.serverTimestamp()
        }
    };
}

function makeBotRateLimitError(action, retryAtMs, scope = "user", now = Date.now()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((retryAtMs - now) / 1000));
    const retryAt = new Date(retryAtMs).toISOString();
    return new functions.https.HttpsError(
        "resource-exhausted",
        `Are you a bot? Rate limit reached. Rate limit resets at ${retryAt}.`,
        { action, scope, retryAfterSeconds, retryAt }
    );
}

function getBoundedCallableCounterRefs(db, uid, action) {
    const globalScope = CALLABLE_GLOBAL_RATE_LIMIT_SCOPE[action];
    const safeUid = encodeURIComponent(uid);
    return {
        globalScope,
        userRef: db.collection("_callableRateLimits").doc(`${encodeURIComponent(action)}_${safeUid}`),
        globalRef: globalScope
            ? db.collection("_globalCallableRateLimits").doc(encodeURIComponent(globalScope))
            : null
    };
}

// Prime the exact Firestore transaction transport used by a bounded callable
// without consuming a rate-limit slot or writing a document. This is intended
// for a resident instance's startup path, not per-request work.
async function warmConfiguredCallableRateLimitPath(action, options = {}) {
    const db = options.rateLimitFirestore || options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        throw new Error("Rate-limit warmup requires Firestore transaction support.");
    }

    const warmupUid = options.warmupUid || "_startup_warmup_";
    const { userRef, globalRef } = getBoundedCallableCounterRefs(db, warmupUid, action);
    await db.runTransaction(async transaction => {
        await transaction.get(userRef);
        if (globalRef) await transaction.get(globalRef);
    });
}

async function enforceBoundedCallableRateLimit(uid, action, options = {}) {
    const userDefaults = BOUNDED_CALLABLE_RATE_LIMITS[action];
    if (!userDefaults) return;
    const userConfig = resolveBoundedRateLimitConfig(action, userDefaults, options);
    const globalScope = CALLABLE_GLOBAL_RATE_LIMIT_SCOPE[action];
    const globalDefaults = globalScope ? GLOBAL_CALLABLE_RATE_LIMITS[globalScope] : null;
    const globalConfig = globalDefaults
        ? resolveBoundedRateLimitConfig(globalScope, globalDefaults, options, "globalCallableRateLimits")
        : null;
    const db = options.rateLimitFirestore || options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        throw new functions.https.HttpsError("internal", "Rate limit could not be verified.");
    }

    const now = Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now();
    const refs = getBoundedCallableCounterRefs(db, uid, action);
    const userRef = refs.userRef;
    const globalRef = globalConfig ? refs.globalRef : null;

    await db.runTransaction(async transaction => {
        const userSnapshot = await transaction.get(userRef);
        const globalSnapshot = globalRef ? await transaction.get(globalRef) : null;
        const userCounter = buildRateLimitCounterUpdate({
            stored: userSnapshot && userSnapshot.exists ? userSnapshot.data() : {},
            config: userConfig,
            now,
            identity: { uid, action, scope: "user" }
        });
        const globalCounter = globalConfig ? buildRateLimitCounterUpdate({
            stored: globalSnapshot && globalSnapshot.exists ? globalSnapshot.data() : {},
            config: globalConfig,
            now,
            identity: { actionGroup: globalScope, scope: "global" }
        }) : null;

        if (userCounter.retryAtMs) throw makeBotRateLimitError(action, userCounter.retryAtMs, "user", now);
        if (globalCounter && globalCounter.retryAtMs) throw makeBotRateLimitError(action, globalCounter.retryAtMs, "global", now);

        transaction.set(userRef, userCounter.value, { merge: true });
        if (globalRef && globalCounter) transaction.set(globalRef, globalCounter.value, { merge: true });
    });
}

async function enforceConfiguredCallableRateLimit(uid, action, options = {}) {
    // Existing handler unit tests use deliberately tiny Firestore doubles. The
    // limiter itself has dedicated tests; handler tests can opt in explicitly.
    if (process.env.NODE_ENV === "test" && options.enforceCallableRateLimits !== true) return;
    return enforceBoundedCallableRateLimit(uid, action, options);
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

    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

        if (currentCount >= limit.maxRequests) {
            throw makeBotRateLimitError(action, windowEndsAt, "user", now);
        }

        transaction.set(ref, {
            uid,
            action,
            count: currentCount + 1,
            limit: limit.maxRequests,
            windowStart: Timestamp.fromMillis(windowStart),
            windowEndsAt: Timestamp.fromMillis(windowEndsAt),
            expiresAt: Timestamp.fromMillis(windowEndsAt + RATE_LIMIT_DAY_MS),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

function getWindowCount(stored, prefix, windowStart) {
    const storedStart = Number(stored && stored[`${prefix}WindowStartMs`]);
    const storedCount = Number(stored && stored[`${prefix}Count`]);
    return storedStart === windowStart && Number.isFinite(storedCount)
        ? Math.max(0, storedCount)
        : 0;
}

/**
 * Enforces the premium hourly and burst windows in one Firestore transaction.
 * The first request migrates active legacy counters; later requests read and
 * write one stable per-user document. Hourly admission retains precedence and
 * still consumes an hourly slot when the later burst check blocks, matching the
 * formerly sequential transactions exactly.
 */
async function enforcePremiumCallableRateLimits(uid, action, options = {}) {
    const premiumConfig = getPremiumCallableRateLimit(action, options);
    const burstAction = PREMIUM_BURST_ACTIONS[action];
    const burstDefaults = burstAction ? BOUNDED_CALLABLE_RATE_LIMITS[burstAction] : null;
    if (!premiumConfig || !burstDefaults) {
        return enforcePremiumCallableRateLimit(uid, action, options);
    }

    const burstConfig = resolveBoundedRateLimitConfig(burstAction, burstDefaults, options);
    const db = options.rateLimitFirestore || options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        throw new functions.https.HttpsError("internal", "Rate limit could not be verified.");
    }

    const now = Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now();
    const premiumWindowStart = Math.floor(now / premiumConfig.windowMs) * premiumConfig.windowMs;
    const premiumWindowEndsAt = premiumWindowStart + premiumConfig.windowMs;
    const burstWindowStart = Math.floor(now / burstConfig.shortWindowMs) * burstConfig.shortWindowMs;
    const burstWindowEndsAt = burstWindowStart + burstConfig.shortWindowMs;
    const safeUid = encodeURIComponent(uid);
    const safeAction = encodeURIComponent(action);
    const compositeRef = db.collection("_premiumCallableRateLimits").doc(`${safeAction}_${safeUid}`);
    const legacyPremiumRef = db.collection("_premiumCallableRateLimits")
        .doc(`${safeAction}_${safeUid}_${premiumWindowStart}`);
    const legacyBurstRef = db.collection("_callableRateLimits")
        .doc(`${encodeURIComponent(burstAction)}_${safeUid}`);
    let blocked = null;

    await db.runTransaction(async transaction => {
        const compositeSnapshot = await transaction.get(compositeRef);
        const compositeStored = compositeSnapshot && compositeSnapshot.exists ? compositeSnapshot.data() : {};
        const isMigrated = Number(compositeStored && compositeStored.schemaVersion) === 2;
        let premiumCount = getWindowCount(compositeStored, "premium", premiumWindowStart);
        let burstCount = getWindowCount(compositeStored, "burst", burstWindowStart);

        if (!isMigrated) {
            const legacyPremiumSnapshot = await transaction.get(legacyPremiumRef);
            const legacyBurstSnapshot = await transaction.get(legacyBurstRef);
            const legacyPremiumStored = legacyPremiumSnapshot && legacyPremiumSnapshot.exists
                ? legacyPremiumSnapshot.data()
                : {};
            const legacyBurstStored = legacyBurstSnapshot && legacyBurstSnapshot.exists
                ? legacyBurstSnapshot.data()
                : {};
            const legacyPremiumCount = Number(legacyPremiumStored.count);
            premiumCount = Number.isFinite(legacyPremiumCount) ? Math.max(0, legacyPremiumCount) : 0;
            burstCount = getWindowCount(legacyBurstStored, "short", burstWindowStart);
        }

        const premiumBlocked = premiumCount >= premiumConfig.maxRequests;
        const burstBlocked = burstCount >= burstConfig.shortMax;
        if (premiumBlocked) {
            blocked = { action, retryAtMs: premiumWindowEndsAt };
        } else {
            premiumCount += 1;
            if (burstBlocked) {
                blocked = { action: burstAction, retryAtMs: burstWindowEndsAt };
            } else {
                burstCount += 1;
            }
        }

        transaction.set(compositeRef, {
            schemaVersion: 2,
            uid,
            action,
            burstAction,
            premiumWindowStartMs: premiumWindowStart,
            premiumCount,
            premiumLimit: premiumConfig.maxRequests,
            burstWindowStartMs: burstWindowStart,
            burstCount,
            burstLimit: burstConfig.shortMax,
            expiresAt: Timestamp.fromMillis(Math.max(premiumWindowEndsAt, burstWindowEndsAt) + RATE_LIMIT_DAY_MS),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });

    if (blocked) throw makeBotRateLimitError(blocked.action, blocked.retryAtMs, "user", now);
}

module.exports = {
    PREMIUM_CALLABLE_RATE_LIMITS,
    BOUNDED_CALLABLE_RATE_LIMITS,
    GLOBAL_CALLABLE_RATE_LIMITS,
    CALLABLE_GLOBAL_RATE_LIMIT_SCOPE,
    parsePositiveInteger,
    resolveBoundedRateLimitConfig,
    buildRateLimitCounterUpdate,
    makeBotRateLimitError,
    enforceBoundedCallableRateLimit,
    warmConfiguredCallableRateLimitPath,
    enforceConfiguredCallableRateLimit,
    getPremiumCallableRateLimit,
    getRateLimitRetrySeconds,
    enforcePremiumCallableRateLimit,
    enforcePremiumCallableRateLimits
};
