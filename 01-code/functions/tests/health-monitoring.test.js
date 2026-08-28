"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const health = require("../healthMonitoring.js");

const observation = (ok, detail = ok ? "ok" : "failed") => ({ ok, detail, latencyMs: 12 });

function fakeDb(initial = null) {
    let value = initial;
    return {
        doc(path) {
            assert.equal(path, health.HEALTH_DOCUMENT);
            return {
                async get() { return { exists: value !== null, data: () => value }; },
                async set(next) { value = next; }
            };
        },
        value: () => value
    };
}

test("provider canary is due no more than once every three hours", () => {
    const now = Date.parse("2026-08-27T12:00:00Z");
    assert.equal(health.providerCheckDue({}, now), true);
    assert.equal(health.providerCheckDue({ lastProviderCheckAt: new Date(now - health.PROVIDER_CHECK_INTERVAL_MS + 1).toISOString() }, now), false);
    assert.equal(health.providerCheckDue({ lastProviderCheckAt: new Date(now - health.PROVIDER_CHECK_INTERVAL_MS).toISOString() }, now), true);
});

test("app surface check requires both the real app HTML and a valid version asset", async () => {
    const calls = [];
    const result = await health.checkAppSurface(
        health.BETA_APP_URL,
        health.BETA_VERSION_URL,
        "Beta app",
        {
            async get(url) {
                calls.push(url);
                if (url === health.BETA_APP_URL) return { data: "<title>US BARK RANGERS</title>" };
                return { data: { version: "0.115" } };
            }
        }
    );
    assert.equal(result.ok, true);
    assert.match(result.detail, /version 0\.115/);
    assert.deepEqual(calls, [health.BETA_APP_URL, health.BETA_VERSION_URL]);
    assert.match(health.BETA_APP_URL, /\/01-code\/app\/$/);
});

test("app surface check fails when the version asset is missing", async () => {
    const result = await health.checkAppSurface("https://app/", "https://app/version.json", "App", {
        async get(url) {
            if (url.endsWith("version.json")) return { data: {} };
            return { data: "BARK" };
        }
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /version asset/);
});

test("two failures turn red and recovery requires two successes", () => {
    const at = "2026-08-27T12:00:00.000Z";
    const firstFailure = health.nextServiceState({}, observation(false), at);
    const secondFailure = health.nextServiceState(firstFailure, observation(false), at);
    const firstRecovery = health.nextServiceState(secondFailure, observation(true), at);
    const recovered = health.nextServiceState(firstRecovery, observation(true), at);
    assert.equal(firstFailure.state, "yellow");
    assert.equal(secondFailure.state, "red");
    assert.equal(firstRecovery.state, "yellow");
    assert.equal(recovered.state, "green");
});

test("overall health uses the worst service state", () => {
    const green = { state: "green" };
    const services = { productionApp: green, betaApp: green, routing: green, payments: green, monitoring: green };
    assert.equal(health.overallState(services), "green");
    assert.equal(health.overallState({ ...services, routing: { state: "yellow" } }), "yellow");
    assert.equal(health.overallState({ ...services, payments: { state: "red" } }), "red");
});

test("monitor writes one snapshot and avoids duplicate Discord alerts", async () => {
    const db = fakeDb();
    const posts = [];
    const checks = {
        productionApp: async () => observation(true, "production"),
        betaApp: async () => observation(true, "beta"),
        routing: async () => observation(true, "route"),
        payments: async () => observation(true, "lemon")
    };
    const now = Date.parse("2026-08-27T12:00:00Z");
    const first = await health.runHealthMonitoring({ db, nowMs: now, checks, env: {}, postDiscord: async message => { posts.push(message); return { posted: true }; } });
    assert.equal(first.overall, "green");
    assert.equal(first.providerChecksRun, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].channel, "systemStatus");
    assert.equal(db.value().services.routing.detail, "route");

    const second = await health.runHealthMonitoring({ db, nowMs: now + health.CHECK_INTERVAL_MS, checks, env: {}, postDiscord: async message => { posts.push(message); return { posted: true }; } });
    assert.equal(second.providerChecksRun, false);
    assert.equal(second.discord.reason, "unchanged");
    assert.equal(posts.length, 1);
    assert.equal(db.value().services.routing.checkedAt, new Date(now).toISOString());
});

test("a changed service produces one transition alert", async () => {
    const now = Date.parse("2026-08-27T12:00:00Z");
    const base = { state: "green", checkedAt: new Date(now - health.PROVIDER_CHECK_INTERVAL_MS).toISOString(), consecutiveFailures: 0, consecutiveSuccesses: 1, detail: "ok" };
    const db = fakeDb({ overall: "green", lastProviderCheckAt: base.checkedAt, services: { productionApp: base, betaApp: base, routing: base, payments: base, monitoring: base } });
    const posts = [];
    await health.runHealthMonitoring({ db, nowMs: now, env: {}, checks: {
        productionApp: async () => observation(false), betaApp: async () => observation(true), routing: async () => observation(true), payments: async () => observation(true)
    }, postDiscord: async message => { posts.push(message); return { posted: true }; } });
    assert.equal(db.value().services.productionApp.state, "yellow");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].tier, "important");
});
