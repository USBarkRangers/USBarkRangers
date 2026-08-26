"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const source = fs.readFileSync(
    path.join(__dirname, "..", "01-code", "app", "modules", "visitorAnalytics.js"),
    "utf8"
);

function harness() {
    const events = [];
    const identities = [];
    const properties = [];
    const analytics = {
        logEvent(name, parameters) { events.push({ name, parameters }); },
        setAnalyticsCollectionEnabled() {},
        setUserId(value) { identities.push(value); },
        setUserProperties(value) { properties.push(value); }
    };
    const context = {
        console,
        document: {
            querySelector() {
                return { getAttribute: () => "map-view" };
            }
        },
        firebase: { analytics: () => analytics },
        window: {
            BARK: { monitoring: { getReleaseChannel: () => "beta" } }
        }
    };
    vm.runInNewContext(source, context, { filename: "modules/visitorAnalytics.js" });
    return { api: context.window.BARK.visitorAnalytics, events, identities, properties };
}

describe("visitor analytics", () => {
    it("counts one initial screen and only real screen changes", async () => {
        const { api, events } = harness();
        await api.init();
        assert.equal(events.length, 0, "initial events wait until auth identity is known");
        api.setAudience("logged-out", null);
        api.trackScreen("map-view");
        api.trackScreen("planner-view");

        assert.equal(events.filter(event => event.name === "bark_app_opened").length, 1);
        assert.deepEqual(
            events.filter(event => event.name === "bark_screen_view").map(event => event.parameters.screen_name),
            ["map", "planner"]
        );
    });

    it("uses only the internal uid for signed-in cross-device identity", async () => {
        const { api, identities, properties } = harness();
        await api.init();
        api.setAudience("premium", { uid: "internal-uid", email: "must-not-send@example.com" });

        assert.equal(identities.at(-1), "internal-uid");
        assert.equal(properties.at(-1).plan, "premium");
        assert.doesNotMatch(JSON.stringify(properties), /must-not-send/);
    });

    it("emits exactly one app open when auth state is refined", async () => {
        const { api, events } = harness();
        await api.init();
        api.setAudience("free", { uid: "u1" });
        api.setAudience("premium", { uid: "u1" });

        assert.equal(events.filter(event => event.name === "bark_app_opened").length, 1);
        assert.equal(events.filter(event => event.name === "bark_screen_view").length, 1);
    });
});
