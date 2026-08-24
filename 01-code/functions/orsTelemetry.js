const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const ORS_ANALYTICS_DOCUMENT = "_analytics/ors_usage";
const ORS_ENDPOINT_QUOTAS = Object.freeze({
    directions: Object.freeze({ daily: 2000, perMinute: 40 }),
    snap: Object.freeze({ daily: 2000, perMinute: 100 }),
    geocoding: Object.freeze({ daily: 3000, perMinute: 100 })
});

function getHeaderValue(headers, headerName) {
    if (!headers || !headerName) return null;
    if (typeof headers.get === "function") return headers.get(headerName);

    const lowerName = headerName.toLowerCase();
    const matchingKey = Object.keys(headers).find(key => key.toLowerCase() === lowerName);
    return matchingKey ? headers[matchingKey] : null;
}

function getFiniteHeaderNumber(headers, headerName) {
    const raw = getHeaderValue(headers, headerName);
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function getOrsEndpointName(url) {
    const value = String(url || "").toLowerCase();
    if (value.includes("/directions/")) return "directions";
    if (value.includes("/snap/")) return "snap";
    if (value.includes("/pelias/") || value.includes("/geocode/")) return "geocoding";
    return "other";
}

function getOrsQuotaObservation(headers) {
    const limit = getFiniteHeaderNumber(headers, "x-ratelimit-limit");
    const remaining = getFiniteHeaderNumber(headers, "x-ratelimit-remaining");
    const reset = getFiniteHeaderNumber(headers, "x-ratelimit-reset");
    if (limit === null && remaining === null && reset === null) return null;
    return { limit, remaining, reset };
}

function utcDateKey(nowMs = Date.now()) {
    return new Date(nowMs).toISOString().slice(0, 10);
}

async function recordOrsRequestAttempt(event, options = {}) {
    const normalized = {
        date: utcDateKey(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()),
        endpoint: ORS_ENDPOINT_QUOTAS[event.endpoint] ? event.endpoint : "other",
        quota: event.quota || null,
        status: Number.isFinite(Number(event.status)) ? Number(event.status) : null,
        success: event.success === true
    };

    if (typeof options.recordOrsUsage === "function") {
        await options.recordOrsUsage(normalized);
        return;
    }

    // Compact route requests run on the latency-sensitive path used by the
    // trip planner. Cloud Logging preserves the provider status/quota signal
    // without making the customer wait for a second Firestore write after ORS
    // has already returned the route. Other callables keep the durable
    // Firestore aggregate unless they explicitly opt into log-only telemetry.
    if (options.orsTelemetryMode === "log-only") {
        console.info("[routing] ORS request attempt completed.", {
            endpoint: normalized.endpoint,
            status: normalized.status,
            success: normalized.success,
            quota: normalized.quota
        });
        return;
    }

    try {
        if (process.env.NODE_ENV === "test") return;

        const db = options.orsTelemetryFirestore || admin.firestore();
        const increment = FieldValue.increment;
        const endpointUsage = {
            errors: increment(normalized.success ? 0 : 1),
            requests: increment(1),
            successes: increment(normalized.success ? 1 : 0)
        };
        const latest = {
            observedAt: FieldValue.serverTimestamp(),
            provider: "heigit",
            status: normalized.status
        };
        if (normalized.quota) {
            if (normalized.quota.limit !== null) latest.limit = normalized.quota.limit;
            if (normalized.quota.remaining !== null) latest.remaining = normalized.quota.remaining;
            if (normalized.quota.reset !== null) latest.reset = normalized.quota.reset;
        }

        await db.doc(ORS_ANALYTICS_DOCUMENT).set({
            days: {
                [normalized.date]: {
                    [normalized.endpoint]: endpointUsage
                }
            },
            latest: {
                [normalized.endpoint]: latest
            },
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.warn("[routing] ORS analytics could not be recorded.", {
            endpoint: normalized.endpoint,
            message: error && error.message ? error.message : String(error)
        });
    }
}

module.exports = {
    ORS_ANALYTICS_DOCUMENT,
    ORS_ENDPOINT_QUOTAS,
    getOrsEndpointName,
    getOrsQuotaObservation,
    recordOrsRequestAttempt
};
