const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const orsTelemetry = require("./orsTelemetry.js");
const {
    resolveBoundedRateLimitConfig,
    buildRateLimitCounterUpdate,
    makeBotRateLimitError
} = require("./rateLimits.js");

const ROUTE_PROVIDER_ATTEMPT_LIMIT = 12;
const ORS_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const ORS_RETRY_MAX_ATTEMPTS = 2;
const ORS_RETRY_BASE_DELAY_MS = 1500;
const ORS_RETRY_MAX_DELAY_MS = 12000;
const ORS_CIRCUIT_LIMITS = Object.freeze({
    directions: Object.freeze({ shortMax: 32, shortWindowMs: 60 * 1000, dailyMax: 1600 }),
    snap: Object.freeze({ shortMax: 80, shortWindowMs: 60 * 1000, dailyMax: 1600 }),
    geocoding: Object.freeze({ shortMax: 80, shortWindowMs: 60 * 1000, dailyMax: 2400 })
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function createProviderAttemptBudget(maxAttempts = ROUTE_PROVIDER_ATTEMPT_LIMIT) {
    const limit = Math.max(1, Math.floor(Number(maxAttempts) || ROUTE_PROVIDER_ATTEMPT_LIMIT));
    let used = 0;
    return {
        get limit() { return limit; },
        get used() { return used; },
        get remaining() { return Math.max(0, limit - used); },
        consume(endpoint, reserve = 0) {
            const reserved = Math.max(0, Math.floor(Number(reserve) || 0));
            if (used >= limit - reserved) {
                throw new functions.https.HttpsError(
                    "failed-precondition",
                    "This route needs too much off-road recovery. Move or remove an off-road stop, then try again.",
                    { reason: "route-recovery-budget", endpoint, attemptLimit: limit }
                );
            }
            used += 1;
            return used;
        }
    };
}

async function enforceOrsCircuitLimit(endpoint, options = {}) {
    const defaults = ORS_CIRCUIT_LIMITS[endpoint];
    if (!defaults) return;
    if (process.env.NODE_ENV === "test" && options.enforceOrsCircuitLimits !== true) return;
    const config = resolveBoundedRateLimitConfig(endpoint, defaults, options, "orsCircuitLimits");
    const db = options.orsCircuitFirestore || options.firestore || admin.firestore();
    if (!db || typeof db.runTransaction !== "function") {
        throw new functions.https.HttpsError("internal", "Routing safety limit could not be verified.");
    }
    const now = Number.isFinite(options.nowMillis) ? options.nowMillis : Date.now();
    const ref = db.collection("_orsCircuitLimits").doc(endpoint);
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const counter = buildRateLimitCounterUpdate({
            stored: snapshot && snapshot.exists ? snapshot.data() : {},
            config,
            now,
            identity: { endpoint, scope: "ors-global" }
        });
        if (counter.retryAtMs) throw makeBotRateLimitError(`ors-${endpoint}`, counter.retryAtMs, "global", now);
        transaction.set(ref, counter.value, { merge: true });
    });
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

async function requestOrsWithRetry(requestFn, options = {}, endpoint = "other") {
    const maxAttempts = Number.isFinite(Number(options.orsRetryMaxAttempts))
        ? Math.max(1, Math.floor(Number(options.orsRetryMaxAttempts)))
        : ORS_RETRY_MAX_ATTEMPTS;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        const attemptStartedAt = Date.now();
        if (options.providerAttemptBudget && typeof options.providerAttemptBudget.consume === "function") {
            options.providerAttemptBudget.consume(endpoint, options.providerAttemptReserve);
        }
        await enforceOrsCircuitLimit(endpoint, options);
        try {
            const response = await requestFn();
            const providerDurationMs = Date.now() - attemptStartedAt;
            await orsTelemetry.recordOrsRequestAttempt({
                endpoint,
                quota: orsTelemetry.getOrsQuotaObservation(response && response.headers),
                status: response && response.status,
                success: true
            }, options);
            console.info("[routing] ORS provider timing.", {
                endpoint,
                attempt: attemptIndex + 1,
                durationMs: providerDurationMs,
                status: response && response.status
            });
            return response;
        } catch (error) {
            const providerDurationMs = Date.now() - attemptStartedAt;
            await orsTelemetry.recordOrsRequestAttempt({
                endpoint,
                quota: orsTelemetry.getOrsQuotaObservation(error && error.response && error.response.headers),
                status: getOrsErrorStatus(error),
                success: false
            }, options);
            console.info("[routing] ORS provider timing.", {
                endpoint,
                attempt: attemptIndex + 1,
                durationMs: providerDurationMs,
                status: getOrsErrorStatus(error)
            });
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
    return requestOrsWithRetry(() => get(url), options, orsTelemetry.getOrsEndpointName(url));
}

function postOrsWithRetry(post, url, body, config, options = {}) {
    return requestOrsWithRetry(() => post(url, body, config), options, orsTelemetry.getOrsEndpointName(url));
}

module.exports = {
    ROUTE_PROVIDER_ATTEMPT_LIMIT,
    ORS_CIRCUIT_LIMITS,
    createProviderAttemptBudget,
    enforceOrsCircuitLimit,
    getHeaderValue,
    parseRetryAfterMs,
    getOrsErrorStatus,
    requestOrsWithRetry,
    getOrsWithRetry,
    postOrsWithRetry
};
