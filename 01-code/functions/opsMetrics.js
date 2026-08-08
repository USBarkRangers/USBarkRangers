"use strict";

// ===== SCHEDULED OPS METRICS =====
// The routine tier of the alert model: a once-a-day rollup that answers "what
// happened yesterday" without anyone opening five dashboards. Deliberately
// coarse — the website admin dashboard stays the place for detail and history.
//
// Read cost is the constraint here. Counting documents with .get() would read
// every matching document daily and quietly become one of the larger line items
// on the Firestore bill, so every count below is an aggregation query (billed
// at one read per 1000 matched documents).

const axios = require("axios");

const GOATCOUNTER_SITE_ENV = "GOATCOUNTER_SITE";
const GOATCOUNTER_TOKEN_ENV = "GOATCOUNTER_API_TOKEN";
const DEFAULT_GOATCOUNTER_SITE = "https://carterswarm.goatcounter.com";
const GOATCOUNTER_TIMEOUT_MS = 8000;
const TOP_PAGE_LIMIT = 5;

function getGoatCounterSite(options = {}) {
    const env = options.env || process.env;
    const raw = (env[GOATCOUNTER_SITE_ENV] || DEFAULT_GOATCOUNTER_SITE || "").trim();
    return raw.replace(/\/+$/, "");
}

function getGoatCounterToken(options = {}) {
    const env = options.env || process.env;
    const raw = env[GOATCOUNTER_TOKEN_ENV];
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function toIsoDate(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

// Returns null rather than throwing when GoatCounter is unconfigured or down, so
// the rest of the rollup still posts. A missing traffic section is better than
// no daily post at all.
async function fetchGoatCounterStats(sinceMs, nowMs, options = {}) {
    const token = getGoatCounterToken(options);
    const site = getGoatCounterSite(options);
    if (!token || !site) return null;

    const get = options.httpGet || axios.get;
    const params = { start: toIsoDate(sinceMs), end: toIsoDate(nowMs) };
    const config = {
        params,
        timeout: GOATCOUNTER_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}` }
    };

    try {
        const [totalRes, hitsRes] = await Promise.all([
            get(`${site}/api/v0/stats/total`, config),
            get(`${site}/api/v0/stats/hits`, { ...config, params: { ...params, limit: TOP_PAGE_LIMIT } })
        ]);

        const total = (totalRes && totalRes.data) || {};
        const hits = ((hitsRes && hitsRes.data) || {}).hits || [];

        return {
            pageviews: Number.isFinite(Number(total.total)) ? Number(total.total) : null,
            visitors: Number.isFinite(Number(total.total_unique)) ? Number(total.total_unique) : null,
            topPages: hits.slice(0, TOP_PAGE_LIMIT).map((hit) => ({
                path: hit.path || hit.name || "(unknown)",
                count: Number(hit.count) || 0
            }))
        };
    } catch (err) {
        console.error("[metrics] GoatCounter fetch failed:", err && err.message);
        return null;
    }
}

// One aggregation count, or null if the query fails. Never throws: a missing
// number must not cost us the whole rollup.
async function countSince(db, collection, field, sinceDate) {
    try {
        const snapshot = await db.collection(collection).where(field, ">=", sinceDate).count().get();
        const value = snapshot && typeof snapshot.data === "function" ? snapshot.data().count : null;
        return Number.isFinite(Number(value)) ? Number(value) : null;
    } catch (err) {
        console.error(`[metrics] count on ${collection} failed:`, err && err.message);
        return null;
    }
}

async function collectOpsMetrics({ db, sinceDate, sinceMs, nowMs }, options = {}) {
    const [feedback, clientErrors, billingEvents, traffic] = await Promise.all([
        countSince(db, "feedback", "createdAt", sinceDate),
        countSince(db, "clientErrors", "createdAt", sinceDate),
        countSince(db, "_lemonSqueezyWebhookEvents", "receivedAt", sinceDate),
        fetchGoatCounterStats(sinceMs, nowMs, options)
    ]);

    return {
        windowHours: Math.round((nowMs - sinceMs) / (60 * 60 * 1000)),
        feedback,
        clientErrors,
        billingEvents,
        traffic
    };
}

function formatCount(value) {
    return value === null || value === undefined ? "n/a" : String(value);
}

function buildMetricsMessage(summary, { channel, title }) {
    const traffic = summary.traffic;
    const fields = [
        { name: "Pageviews", value: traffic ? formatCount(traffic.pageviews) : "n/a" },
        { name: "Visitors", value: traffic ? formatCount(traffic.visitors) : "n/a" },
        { name: "Feedback", value: formatCount(summary.feedback) },
        { name: "Client errors", value: formatCount(summary.clientErrors) },
        { name: "Billing events", value: formatCount(summary.billingEvents) }
    ];

    const topPages = traffic && traffic.topPages && traffic.topPages.length
        ? traffic.topPages.map((page) => `\`${page.count}\` ${page.path}`).join("\n")
        : null;

    return {
        channel,
        tier: "routine",
        title,
        description: topPages ? `**Top pages**\n${topPages}` : (traffic ? null : "Traffic data unavailable."),
        fields,
        footer: `last ${summary.windowHours}h · dashboard has the detail`
    };
}

module.exports = {
    collectOpsMetrics,
    fetchGoatCounterStats,
    countSince,
    buildMetricsMessage,
    getGoatCounterSite,
    getGoatCounterToken,
    toIsoDate,
    GOATCOUNTER_SITE_ENV,
    GOATCOUNTER_TOKEN_ENV,
    DEFAULT_GOATCOUNTER_SITE
};
