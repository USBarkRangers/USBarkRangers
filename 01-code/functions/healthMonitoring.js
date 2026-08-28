"use strict";

// ===== LOW-COST SERVICE HEALTH MONITOR =====
// The existing cost scheduler calls this every 15 minutes; authenticated
// provider checks are deliberately capped at once every three hours.

const axios = require("axios");
const opsDiscord = require("./opsDiscord.js");
const { ORS_ENDPOINTS } = require("./orsEndpoints.js");
const orsSafety = require("./orsSafety.js");

const HEALTH_DOCUMENT = "system/healthStatus";
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const PROVIDER_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const PRODUCTION_APP_URL = "https://usbarkrangersmap.com/";
const PRODUCTION_VERSION_URL = "https://usbarkrangersmap.com/version.json";
const BETA_APP_URL = "https://usbarkrangers.github.io/USBarkRangers/01-code/app/";
const BETA_VERSION_URL = "https://usbarkrangers.github.io/USBarkRangers/01-code/app/version.json";
const LEMON_API_URL = "https://api.lemonsqueezy.com/v1/users/me";
const SERVICES = Object.freeze(["productionApp", "betaApp", "routing", "payments", "monitoring"]);

function finiteMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
}

function providerCheckDue(previous, nowMs) {
    return nowMs - finiteMs(previous && previous.lastProviderCheckAt) >= PROVIDER_CHECK_INTERVAL_MS;
}

function safeMessage(error) {
    const status = error && error.response && error.response.status;
    if (status) return `Provider returned HTTP ${status}.`;
    if (error && error.code === "ECONNABORTED") return "The check timed out.";
    return "The service did not respond successfully.";
}

async function checkWebPage(url, label, http = axios) {
    const startedAt = Date.now();
    try {
        const response = await http.get(url, {
            timeout: REQUEST_TIMEOUT_MS,
            maxRedirects: 4,
            responseType: "text",
            validateStatus: status => status >= 200 && status < 400
        });
        const body = String(response.data || "");
        if (!body || (!/BARK/i.test(body) && !/US BARK RANGERS/i.test(body))) {
            throw new Error("Expected app marker was missing.");
        }
        return { ok: true, latencyMs: Date.now() - startedAt, detail: `${label} loaded.` };
    } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, detail: safeMessage(error) };
    }
}

async function checkAppSurface(appUrl, versionUrl, label, http = axios) {
    const startedAt = Date.now();
    const page = await checkWebPage(appUrl, label, http);
    if (!page.ok) return page;
    try {
        const response = await http.get(versionUrl, {
            timeout: REQUEST_TIMEOUT_MS,
            maxRedirects: 4,
            validateStatus: status => status >= 200 && status < 300
        });
        const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
        const version = data && typeof data.version === "string" ? data.version.trim() : "";
        if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error("Version marker was missing.");
        return { ok: true, latencyMs: Date.now() - startedAt, detail: `${label} loaded with version ${version}.` };
    } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, detail: "The app shell loaded, but its version asset did not." };
    }
}

async function checkOrsRoute(apiKey, http = axios, options = {}) {
    const startedAt = Date.now();
    if (!apiKey) return { ok: false, latencyMs: 0, detail: "ORS monitoring key is not configured." };
    try {
        const response = await orsSafety.postOrsWithRetry(
            (url, body, config) => http.post(url, body, config),
            ORS_ENDPOINTS.directions,
            { coordinates: [[-77.03653, 38.89768], [-77.04344, 38.90965]] },
            {
                timeout: REQUEST_TIMEOUT_MS,
                headers: { Authorization: apiKey, "Content-Type": "application/json" },
                validateStatus: status => status >= 200 && status < 300
            },
            {
                ...options,
                orsRetryMaxAttempts: 1,
                orsTelemetryMode: "log-only"
            }
        );
        const feature = response && response.data && response.data.features && response.data.features[0];
        if (!feature || !feature.geometry) throw new Error("Route geometry was missing.");
        return { ok: true, latencyMs: Date.now() - startedAt, detail: "A real two-point route completed." };
    } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, detail: safeMessage(error) };
    }
}

async function checkLemon(apiKey, http = axios) {
    const startedAt = Date.now();
    if (!apiKey) return { ok: false, latencyMs: 0, detail: "Lemon monitoring key is not configured." };
    try {
        const response = await http.get(LEMON_API_URL, {
            timeout: REQUEST_TIMEOUT_MS,
            headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${apiKey}` },
            validateStatus: status => status >= 200 && status < 300
        });
        if (!response || !response.data || !response.data.data) throw new Error("Account response was missing.");
        return { ok: true, latencyMs: Date.now() - startedAt, detail: "Authenticated API access works." };
    } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, detail: safeMessage(error) };
    }
}

function nextServiceState(previous = {}, observation, checkedAt) {
    if (!observation) return previous;
    const priorState = previous.state || "unknown";
    if (!observation.ok) {
        const consecutiveFailures = (Number(previous.consecutiveFailures) || 0) + 1;
        return { state: consecutiveFailures >= 2 ? "red" : "yellow", consecutiveFailures, consecutiveSuccesses: 0, checkedAt, latencyMs: observation.latencyMs, detail: observation.detail };
    }
    const consecutiveSuccesses = (Number(previous.consecutiveSuccesses) || 0) + 1;
    const recovering = priorState === "red" && consecutiveSuccesses < 2;
    return { state: recovering ? "yellow" : "green", consecutiveFailures: 0, consecutiveSuccesses, checkedAt, latencyMs: observation.latencyMs, detail: recovering ? "One successful recovery check; awaiting confirmation." : observation.detail };
}

function overallState(services) {
    const states = SERVICES.map(name => services[name] && services[name].state);
    if (states.includes("red")) return "red";
    if (states.includes("yellow") || states.includes("unknown")) return "yellow";
    return "green";
}

function changedServices(previous = {}, next = {}) {
    const before = previous || {};
    const after = next || {};
    return SERVICES.filter(name => (before[name] && before[name].state) !== (after[name] && after[name].state));
}

function serviceLabel(name) {
    return name.replace(/([A-Z])/g, " $1").replace(/^./, value => value.toUpperCase());
}

function buildHealthDiscordMessage(previous, snapshot) {
    const changed = changedServices(previous && previous.services, snapshot.services);
    if (previous && previous.overall === snapshot.overall && changed.length === 0) return null;
    const tier = snapshot.overall === "red" ? "critical" : snapshot.overall === "yellow" ? "important" : "routine";
    return {
        channel: "systemStatus",
        tier,
        title: previous && previous.overall ? `Service health changed to ${snapshot.overall.toUpperCase()}` : "BARK service health monitoring is active",
        description: "Only state changes are posted here. The private dashboard keeps the latest check details.",
        fields: SERVICES.map(name => ({ name: serviceLabel(name), value: `${(snapshot.services[name] && snapshot.services[name].state || "unknown").toUpperCase()} — ${snapshot.services[name] && snapshot.services[name].detail || "No result"}`, inline: false })),
        footer: "App checks: 15 min • ORS and Lemon authenticated checks: 3 hours"
    };
}

async function runHealthMonitoring(options = {}) {
    const db = options.db;
    if (!db || typeof db.doc !== "function") throw new Error("A Firestore database is required.");
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const checkedAt = new Date(nowMs).toISOString();
    const env = options.env || process.env;
    const reference = db.doc(HEALTH_DOCUMENT);
    const previousSnapshot = await reference.get();
    const previous = previousSnapshot.exists ? (previousSnapshot.data() || {}) : {};
    const previousServices = previous.services || {};
    const due = providerCheckDue(previous, nowMs);
    const http = options.http || axios;
    const checks = options.checks || {};

    const [production, beta, routing, payments] = await Promise.all([
        checks.productionApp
            ? checks.productionApp(PRODUCTION_APP_URL, "Production app", http)
            : checkAppSurface(PRODUCTION_APP_URL, PRODUCTION_VERSION_URL, "Production app", http),
        checks.betaApp
            ? checks.betaApp(BETA_APP_URL, "Beta app", http)
            : checkAppSurface(BETA_APP_URL, BETA_VERSION_URL, "Beta app", http),
        due ? (checks.routing || checkOrsRoute)(env.ORS_API_KEY, http, {
            orsCircuitFirestore: db,
            orsTelemetryFirestore: db
        }) : Promise.resolve(null),
        due ? (checks.payments || checkLemon)(env.LEMONSQUEEZY_API_KEY, http) : Promise.resolve(null)
    ]);

    const services = {
        productionApp: nextServiceState(previousServices.productionApp, production, checkedAt),
        betaApp: nextServiceState(previousServices.betaApp, beta, checkedAt),
        routing: nextServiceState(previousServices.routing, routing, checkedAt),
        payments: nextServiceState(previousServices.payments, payments, checkedAt),
        monitoring: nextServiceState(previousServices.monitoring, { ok: true, latencyMs: 0, detail: "Scheduler and Firestore read path completed." }, checkedAt)
    };
    const providerBaseMs = due ? nowMs : finiteMs(previous.lastProviderCheckAt);
    const snapshot = {
        schemaVersion: 1,
        overall: overallState(services),
        checkedAt,
        checkedAtMs: nowMs,
        nextScheduledCheckAt: new Date(nowMs + CHECK_INTERVAL_MS).toISOString(),
        lastProviderCheckAt: due ? checkedAt : previous.lastProviderCheckAt || null,
        nextProviderCheckAt: new Date(providerBaseMs + PROVIDER_CHECK_INTERVAL_MS).toISOString(),
        services
    };

    await reference.set(snapshot, { merge: false });
    const message = buildHealthDiscordMessage(previousSnapshot.exists ? previous : null, snapshot);
    const discord = message ? await (options.postDiscord || opsDiscord.postDiscord)(message, options) : { posted: false, reason: "unchanged" };
    console.info("[health] Service check complete.", {
        overall: snapshot.overall,
        providerChecksRun: due,
        states: Object.fromEntries(SERVICES.map(name => [name, services[name] && services[name].state])),
        discordPosted: Boolean(discord && discord.posted),
        discordReason: discord && discord.reason || null
    });
    return { overall: snapshot.overall, providerChecksRun: due, discord };
}

module.exports = { HEALTH_DOCUMENT, CHECK_INTERVAL_MS, PROVIDER_CHECK_INTERVAL_MS, PRODUCTION_APP_URL, PRODUCTION_VERSION_URL, BETA_APP_URL, BETA_VERSION_URL, LEMON_API_URL, providerCheckDue, nextServiceState, overallState, changedServices, buildHealthDiscordMessage, checkWebPage, checkAppSurface, checkOrsRoute, checkLemon, runHealthMonitoring };
