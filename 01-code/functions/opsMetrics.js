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
const ga4Metrics = require("./ga4Metrics.js");

const GOATCOUNTER_SITE_ENV = "GOATCOUNTER_SITE";
const GOATCOUNTER_TOKEN_ENV = "GOATCOUNTER_API_TOKEN";
const DEFAULT_GOATCOUNTER_SITE = "https://carterswarm.goatcounter.com";
const GOATCOUNTER_TIMEOUT_MS = 8000;
const TOP_PAGE_LIMIT = 5;
const GOATCOUNTER_HIT_LIMIT = 100;
const TRAFFIC_TRACKING_START_ISO = "2026-01-01T00:00:00.000Z";
const PAYMENT_FUNNEL_EVENTS = Object.freeze([
    "paywall-open",
    "checkout-clicked",
    "checkout-session-created",
    "checkout-handoff",
    "checkout-return-success",
    "checkout-return-canceled",
    "premium-confirmed",
    "premium-confirmation-timeout",
    "checkout-start-failed"
]);

function normalizeHitPath(value) {
    return String(value || "").replace(/^\/+/, "").toLowerCase();
}

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

function toIsoHour(ms) {
    const date = new Date(ms);
    date.setUTCMinutes(0, 0, 0);
    return date.toISOString();
}

function getHitPath(hit) {
    return String((hit && (hit.path || hit.name)) || "");
}

function isBarkAppPage(hit) {
    if (!hit || hit.event === true) return false;
    const path = normalizeHitPath(getHitPath(hit));
    const title = String(hit.title || "").toLowerCase();
    if (path.startsWith("event-")) return false;
    if (path.startsWith("usbarkrangers/01-code/app")) return true;
    // The production app is hosted at the site root. Requiring its title keeps
    // unrelated root pages in this shared GoatCounter account out of the report.
    return (path === "" || path === "index.html" || path.startsWith("?") || path.startsWith("index.html?")) &&
        title.includes("us bark rangers");
}

function getAppEnvironment(hit) {
    const path = normalizeHitPath(getHitPath(hit));
    return path.startsWith("usbarkrangers/01-code/app") ? "beta" : "production";
}

// Returns null rather than throwing when GoatCounter is unconfigured or down, so
// the rest of the rollup still posts. A missing traffic section is better than
// no daily post at all.
async function fetchGoatCounterStats(sinceMs, nowMs, options = {}) {
    const token = getGoatCounterToken(options);
    const site = getGoatCounterSite(options);
    if (!token || !site) return null;

    const get = options.httpGet || axios.get;
    // GoatCounter accepts timestamps. Date-only values silently snap an 08:00
    // report to midnight and do not represent the requested 24-hour window.
    const params = { start: toIsoHour(sinceMs), end: toIsoHour(nowMs) };
    const config = {
        params,
        timeout: GOATCOUNTER_TIMEOUT_MS,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        }
    };

    try {
        const [hitsRes, lifetimeHitsRes] = await Promise.all([
            get(`${site}/api/v0/stats/hits`, {
                ...config,
                params: { ...params, limit: GOATCOUNTER_HIT_LIMIT }
            }),
            get(`${site}/api/v0/stats/hits`, {
                ...config,
                params: {
                    start: TRAFFIC_TRACKING_START_ISO,
                    end: toIsoHour(nowMs),
                    limit: GOATCOUNTER_HIT_LIMIT
                }
            })
        ]);
        const hits = ((hitsRes && hitsRes.data) || {}).hits || [];
        const lifetimeHits = ((lifetimeHitsRes && lifetimeHitsRes.data) || {}).hits || [];

        const funnel = Object.fromEntries(PAYMENT_FUNNEL_EVENTS.map((name) => [name, 0]));
        hits.forEach((hit) => {
            const path = normalizeHitPath(getHitPath(hit));
            PAYMENT_FUNNEL_EVENTS.forEach((name) => {
                if (path === `event-${name}`) funnel[name] += Number(hit.count) || 0;
            });
        });
        const pageHits = hits.filter(isBarkAppPage);
        const productionPageVisits = pageHits
            .filter((hit) => getAppEnvironment(hit) === "production")
            .reduce((total, hit) => total + (Number(hit.count) || 0), 0);
        const betaPageVisits = pageHits
            .filter((hit) => getAppEnvironment(hit) === "beta")
            .reduce((total, hit) => total + (Number(hit.count) || 0), 0);
        const sessionCount = (environment) => hits
            .filter((hit) => normalizeHitPath(getHitPath(hit)) === `event-app-session-${environment}`)
            .reduce((total, hit) => total + (Number(hit.count) || 0), 0);
        const hasSessionEvent = (environment) => hits.some((hit) =>
            normalizeHitPath(getHitPath(hit)) === `event-app-session-${environment}`);
        // A dedicated, constant event path is the only accurate way to count
        // an app-wide 8-hour visit. Summing page paths can count one browser
        // twice after a checkout return or query-string navigation.
        const productionVisits = hasSessionEvent("production")
            ? sessionCount("production")
            : productionPageVisits;
        const betaVisits = hasSessionEvent("beta")
            ? sessionCount("beta")
            : betaPageVisits;
        const appVisits = productionVisits + betaVisits;
        const productionOpens = hits
            .filter((hit) => normalizeHitPath(getHitPath(hit)) === "event-app-open-production")
            .reduce((total, hit) => total + (Number(hit.count) || 0), 0);
        const betaOpens = hits
            .filter((hit) => normalizeHitPath(getHitPath(hit)) === "event-app-open-beta")
            .reduce((total, hit) => total + (Number(hit.count) || 0), 0);
        const appOpens = productionOpens + betaOpens;
        const hasOpenEvents = hits.some((hit) => /^event-app-open-(production|beta)$/i.test(getHitPath(hit)));
        const audience = { loggedOut: 0, free: 0, premium: 0 };
        hits.forEach((hit) => {
            const match = normalizeHitPath(getHitPath(hit)).match(/^event-audience-(?:production|beta)-(logged-out|free|premium)$/);
            if (!match) return;
            const key = match[1] === "logged-out" ? "loggedOut" : match[1];
            audience[key] += Number(hit.count) || 0;
        });
        const hasAudienceEvents = hits.some((hit) => /^event-audience-(production|beta)-(logged-out|free|premium)$/i.test(getHitPath(hit)));
        const lifetimeCount = (matcher) => lifetimeHits
            .filter((hit) => matcher(normalizeHitPath(getHitPath(hit)), hit))
            .reduce((total, hit) => total + (Number(hit.count) || 0), 0);
        const lifetimeHasOpenEvents = lifetimeHits.some((hit) => /^event-app-open-(production|beta)$/i.test(getHitPath(hit)));
        const lifetimeHasSessionEvents = lifetimeHits.some((hit) => /^event-app-session-(production|beta)$/i.test(getHitPath(hit)));

        return {
            // GoatCounter calls these "visits": one visit per path for the same
            // privacy-preserving browser session (IP + user agent, held in
            // memory for at most eight hours). It is not a permanent person ID.
            appVisits,
            productionVisits,
            betaVisits,
            // The client emits app-open with no_session so every actual load is
            // counted. Older windows without that event stay n/a, not a fake 0.
            appOpens: hasOpenEvents ? appOpens : null,
            productionOpens: hasOpenEvents ? productionOpens : null,
            betaOpens: hasOpenEvents ? betaOpens : null,
            repeatOpens: hasOpenEvents ? Math.max(0, appOpens - appVisits) : null,
            audience: hasAudienceEvents ? audience : null,
            allTime: {
                appOpens: lifetimeHasOpenEvents
                    ? lifetimeCount(path => /^event-app-open-(production|beta)$/.test(path))
                    : null,
                sessions: lifetimeHasSessionEvents
                    ? lifetimeCount(path => /^event-app-session-(production|beta)$/.test(path))
                    : null,
                pageVisits: lifetimeCount((_path, hit) => isBarkAppPage(hit)),
                trackingStartDate: TRAFFIC_TRACKING_START_ISO.slice(0, 10),
                partial: Boolean(lifetimeHitsRes && lifetimeHitsRes.data && lifetimeHitsRes.data.more)
            },
            topPages: pageHits.slice(0, TOP_PAGE_LIMIT).map((hit) => ({
                path: getHitPath(hit) || "(unknown)",
                count: Number(hit.count) || 0
            })),
            paymentFunnel: funnel,
            partial: Boolean(hitsRes && hitsRes.data && hitsRes.data.more)
        };
    } catch (err) {
        console.error("[metrics] GoatCounter fetch failed:", {
            message: err && err.message,
            status: err && err.response && err.response.status,
            endpoint: `${site}/api/v0/stats/hits`,
            response: err && err.response && err.response.data
        });
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

// Count a closed reporting window. Daily/weekly messages report completed
// calendar periods, so the upper bound prevents current-day activity from
// leaking into yesterday's totals.
async function countBetween(db, collection, field, sinceDate, beforeDate) {
    try {
        const snapshot = await db.collection(collection)
            .where(field, ">=", sinceDate)
            .where(field, "<", beforeDate)
            .count()
            .get();
        const value = snapshot && typeof snapshot.data === "function" ? snapshot.data().count : null;
        return Number.isFinite(Number(value)) ? Number(value) : null;
    } catch (err) {
        console.error(`[metrics] bounded count on ${collection} failed:`, err && err.message);
        return null;
    }
}

async function collectOpsMetrics({ db, sinceDate, throughDate, sinceMs, nowMs, startDate, endDate }, options = {}) {
    const countPeriod = (collection, field) => throughDate
        ? countBetween(db, collection, field, sinceDate, throughDate)
        : countSince(db, collection, field, sinceDate);
    const [feedback, clientErrors, billingEvents, traffic, ga4] = await Promise.all([
        countPeriod("feedback", "createdAt"),
        countPeriod("clientErrors", "createdAt"),
        countPeriod("_lemonSqueezyWebhookEvents", "receivedAt"),
        fetchGoatCounterStats(sinceMs, nowMs, options),
        ga4Metrics.fetchGa4VisitorStats(startDate, endDate, options)
    ]);

    return {
        windowHours: Math.round((nowMs - sinceMs) / (60 * 60 * 1000)),
        feedback,
        clientErrors,
        billingEvents,
        traffic,
        ga4
    };
}

function formatCount(value) {
    return value === null || value === undefined ? "n/a" : String(value);
}

function buildMetricsMessage(summary, { channel, title }) {
    const traffic = summary.traffic;
    const ga4 = summary.ga4;
    const parkData = summary.parkData;
    const parkDataValue = !parkData
        ? null
        : (!parkData.available
            ? "check unavailable"
            : (parkData.ok
                ? `${parkData.validMapRows} map / ${parkData.uniqueAwardSites} Awards ✅`
                : `${parkData.validMapRows} map / ${parkData.uniqueAwardSites} Awards ⚠️`));
    const fields = [
        { name: "Daily unique visitors (GA4)", value: ga4 ? formatCount(ga4.period.totalUsers) : "n/a" },
        { name: "New / returning (GA4)", value: ga4 ? `${formatCount(ga4.period.newUsers)} / ${formatCount(ga4.period.returningUsers)}` : "n/a" },
        { name: "Sessions / screen views (GA4)", value: ga4 ? `${formatCount(ga4.period.sessions)} / ${formatCount(ga4.period.screenViews)}` : "n/a" },
        { name: "App opens", value: traffic ? formatCount(traffic.appOpens) : "n/a" },
        { name: "8h app sessions", value: traffic ? formatCount(traffic.appVisits) : "n/a" },
        { name: "Repeat opens", value: traffic ? formatCount(traffic.repeatOpens) : "n/a" },
        { name: "Production / Beta", value: traffic ? `${formatCount(traffic.productionVisits)} / ${formatCount(traffic.betaVisits)}` : "n/a" },
        { name: "Feedback", value: formatCount(summary.feedback) },
        { name: "Client errors", value: formatCount(summary.clientErrors) },
        { name: "Billing events", value: formatCount(summary.billingEvents) },
        { name: "Park data", value: parkDataValue }
    ];
    if (summary.cumulative) {
        const gaObserved = summary.cumulative.monotonicObserved && summary.cumulative.monotonicObserved.ga4;
        const goatObserved = summary.cumulative.monotonicObserved && summary.cumulative.monotonicObserved.goatCounter;
        fields.push({
            name: "Cumulative tracked activity",
            value: `GA4 ${formatCount(gaObserved && gaObserved.screenViews)} screens · ${formatCount(gaObserved && gaObserved.appOpens)} opens · ${formatCount(gaObserved && gaObserved.totalUsers)} visitors\nGoatCounter ${formatCount(goatObserved && goatObserved.sessions)} 8h sessions · ${formatCount(goatObserved && goatObserved.appOpens)} opens`
        });
        fields.push({
            name: "Independent traffic check",
            value: ga4 && traffic
                ? `GA4 ${formatCount(ga4.period.totalUsers)} daily visitors · GoatCounter ${formatCount(traffic.appVisits)} 8h sessions (different definitions)`
                : "One or both traffic sources unavailable"
        });
    }
    if (summary.accountReconciliation) {
        const accounts = summary.accountReconciliation;
        fields.push({
            name: "Independent account check",
            value: `Firestore ${formatCount(accounts.firestoreActive)} active (${formatCount(accounts.rawDocuments)} raw − ${formatCount(accounts.deletedDocuments)} deleted) · Firebase Auth ${formatCount(accounts.authActive)} · difference ${formatCount(accounts.difference)}`
        });
    }
    const funnel = traffic && traffic.paymentFunnel;
    if (funnel) {
        fields.push({
            name: "Payment funnel",
            value: `paywall ${funnel["paywall-open"]} → checkout ${funnel["checkout-clicked"]} → handoff ${funnel["checkout-handoff"]} → returned ${funnel["checkout-return-success"]} → confirmed ${funnel["premium-confirmed"]}`
        });
        fields.push({
            name: "Payment attention",
            value: `start failed ${funnel["checkout-start-failed"]} · confirmation delayed ${funnel["premium-confirmation-timeout"]} · canceled ${funnel["checkout-return-canceled"]}`
        });
    }
    if (traffic && traffic.audience) {
        fields.push({
            name: "8h audience sessions",
            value: `logged out ${traffic.audience.loggedOut} · free ${traffic.audience.free} · Premium ${traffic.audience.premium}`
        });
    }

    const topPages = traffic && traffic.topPages && traffic.topPages.length
        ? traffic.topPages.map((page) => `\`${page.count}\` ${page.path}`).join("\n")
        : null;

    return {
        channel,
        tier: "routine",
        title,
        description: topPages ? `**Top pages**\n${topPages}` : (traffic ? null : "Traffic data unavailable."),
        fields,
        footer: `${summary.periodLabel || `last ${summary.windowHours}h`} · GA4 is identity/session source · GoatCounter is independent 8h cross-check · collected ${summary.collectedAt || "now"}`
    };
}

function buildPaymentFunnelAlertMessage(traffic) {
    const funnel = traffic && traffic.paymentFunnel;
    if (!funnel) return null;
    const failed = Number(funnel["checkout-start-failed"] || 0);
    const delayed = Number(funnel["premium-confirmation-timeout"] || 0);
    if (failed + delayed === 0) return null;
    return {
        channel: "salesAndBilling",
        tier: "important",
        title: "Payment funnel needs review",
        description: "At least one browser reported that checkout could not start or premium confirmation took too long.",
        fields: [
            { name: "Checkout starts failed", value: String(failed) },
            { name: "Premium confirmations delayed", value: String(delayed) },
            { name: "Successful returns", value: String(funnel["checkout-return-success"] || 0) },
            { name: "Premium confirmed", value: String(funnel["premium-confirmed"] || 0) }
        ],
        footer: "GoatCounter funnel events · no Firestore reads or writes"
    };
}

module.exports = {
    collectOpsMetrics,
    fetchGoatCounterStats,
    countSince,
    countBetween,
    buildMetricsMessage,
    buildPaymentFunnelAlertMessage,
    getGoatCounterSite,
    getGoatCounterToken,
    toIsoHour,
    isBarkAppPage,
    getAppEnvironment,
    GOATCOUNTER_SITE_ENV,
    GOATCOUNTER_TOKEN_ENV,
    DEFAULT_GOATCOUNTER_SITE,
    TRAFFIC_TRACKING_START_ISO,
    PAYMENT_FUNNEL_EVENTS
};
