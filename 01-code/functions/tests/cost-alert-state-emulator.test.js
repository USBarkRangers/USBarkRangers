"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("firebase-admin");
const costReporting = require("../costReporting.js");

test("recovered alerts are removed with real Firestore merge semantics", async (t) => {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Run this test through the Firestore emulator.");
    const app = admin.initializeApp({ projectId: "demo-cost-alert-state" }, `cost-alert-state-${Date.now()}`);
    t.after(async () => app.delete());
    const db = app.firestore();
    const ref = db.doc("system/costMonitoringRegression");

    await ref.set({
        alerts: {
            function_error_rate: {
                severity: "important",
                details: "old error"
            }
        },
        lastMorningReportDate: "2026-08-28"
    });

    await costReporting.saveCostMonitoringState(ref, {
        alerts: {},
        lastCheckedAtMs: 1234
    });

    const saved = (await ref.get()).data();
    assert.deepEqual(saved.alerts, {});
    assert.equal(saved.lastMorningReportDate, "2026-08-28");
    assert.equal(saved.lastCheckedAtMs, 1234);

    const reentered = costReporting.getAlertTransitions([{
        id: "function_error_rate",
        severity: "important",
        details: "new error"
    }], saved.alerts, 5678);
    assert.equal(reentered.notify.length, 1);
});
