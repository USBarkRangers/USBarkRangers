"use strict";

// ===== COST REPORTING ORCHESTRATOR =====
// One hourly, single-instance job. It performs a small read-only guard every
// hour and sends two useful summaries: the completed prior Firestore quota day
// after 09:00 Eastern and the current day-to-date after 23:00 Eastern. Cloud
// APIs, calculations, Discord formatting, and persistence remain out of index.js.

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const costMetrics = require("./costMetrics.js");
const opsDiscord = require("./opsDiscord.js");

const COST_STATE_PATH = "system/costMonitoring";
const COST_SNAPSHOT_PATH = "system/costStatus";
const LEMON_BASE_ANNUAL_FEE_USD = 1.60;
const REPORT_TIME_ZONE = "America/New_York";

const ALERT_THRESHOLDS = Object.freeze({
    reads: Object.freeze({ important: 35_000, critical: 45_000 }),
    writes: Object.freeze({ important: 14_000, critical: 18_000 }),
    recaptcha: Object.freeze({ important: 8_000, critical: 9_500 }),
    orsDirections: Object.freeze({ important: 1_400, critical: 1_800 }),
    orsSnap: Object.freeze({ important: 1_400, critical: 1_800 }),
    orsGeocoding: Object.freeze({ important: 700, critical: 900 }),
    functionErrorRate: Object.freeze({ important: 0.05, critical: 0.20, minimumCalls: 20 }),
    appCheckRiskRate: Object.freeze({ important: 0.05, critical: 0.15, minimumChecks: 50 }),
    totalMonthlyRunRate: Object.freeze({ important: 20, critical: 35 })
});

const ORS_DAILY_QUOTAS = Object.freeze({ directions: 2_000, snap: 2_000, geocoding: 1_000 });
const SEVERITY_RANK = Object.freeze({ routine: 0, important: 1, critical: 2 });

function finite(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function formatCount(value) {
    const number = finite(value);
    return number === null ? "n/a" : Math.round(number).toLocaleString("en-US");
}

function formatMoney(value) {
    const number = finite(value);
    return number === null ? "n/a" : `$${number.toFixed(2)}`;
}

function formatPercent(value) {
    const number = finite(value);
    return number === null ? "n/a" : `${(number * 100).toFixed(number < 0.1 ? 1 : 0)}%`;
}

function formatBytes(value) {
    const bytes = finite(value);
    if (bytes === null) return "n/a";
    if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;
    if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${Math.round(bytes)} B`;
}

function thresholdSeverity(value, thresholds) {
    const number = finite(value);
    if (number === null) return null;
    if (number >= thresholds.critical) return "critical";
    if (number >= thresholds.important) return "important";
    return null;
}

function makeThresholdAlert(id, title, value, thresholds, details, channel = "costs") {
    const severity = thresholdSeverity(value, thresholds);
    if (!severity) return null;
    return { id, title, severity, value: finite(value), details, channel };
}

async function collectOrsCircuitUsage(db, options = {}) {
    if (options.orsUsage) return options.orsUsage;
    const endpoints = ["directions", "snap", "geocoding"];
    try {
        const refs = endpoints.map(endpoint => db.collection("_orsCircuitLimits").doc(endpoint));
        const snapshots = typeof db.getAll === "function"
            ? await db.getAll(...refs)
            : await Promise.all(refs.map(ref => ref.get()));
        return Object.fromEntries(endpoints.map((endpoint, index) => {
            const snapshot = snapshots[index];
            const data = snapshot && snapshot.exists && typeof snapshot.data === "function" ? snapshot.data() : {};
            return [endpoint, {
                requestsToday: finite(data.dailyCount) || 0,
                dailyLimit: ORS_DAILY_QUOTAS[endpoint],
                circuitLimit: finite(data.dailyLimit),
                windowStartMs: finite(data.dailyWindowStartMs)
            }];
        }));
    } catch (error) {
        console.error("[costs] ORS circuit counters unavailable.", { message: error && error.message });
        return Object.fromEntries(endpoints.map(endpoint => [endpoint, {
            requestsToday: null,
            dailyLimit: ORS_DAILY_QUOTAS[endpoint],
            circuitLimit: null,
            windowStartMs: null
        }]));
    }
}

function evaluateGuardAlerts(guard, orsUsage) {
    const alerts = [
        makeThresholdAlert(
            "firestore_reads",
            "Firestore reads are near the daily free allowance",
            guard.firestore.readsToday,
            ALERT_THRESHOLDS.reads,
            `${formatCount(guard.firestore.readsToday)} of 50,000 reads today`
        ),
        makeThresholdAlert(
            "firestore_writes",
            "Firestore writes are near the daily free allowance",
            guard.firestore.writesToday,
            ALERT_THRESHOLDS.writes,
            `${formatCount(guard.firestore.writesToday)} of 20,000 writes today`
        ),
        makeThresholdAlert(
            "recaptcha",
            "reCAPTCHA is approaching its free monthly allowance",
            guard.recaptcha.assessmentsMonth,
            ALERT_THRESHOLDS.recaptcha,
            `${formatCount(guard.recaptcha.assessmentsMonth)} of 10,000 assessments this month`
        ),
        makeThresholdAlert(
            "ors_directions",
            "ORS directions quota is running low",
            orsUsage.directions.requestsToday,
            ALERT_THRESHOLDS.orsDirections,
            `${formatCount(orsUsage.directions.requestsToday)} of ${formatCount(ORS_DAILY_QUOTAS.directions)} provider attempts today`
        ),
        makeThresholdAlert(
            "ors_snap",
            "ORS snap quota is running low",
            orsUsage.snap.requestsToday,
            ALERT_THRESHOLDS.orsSnap,
            `${formatCount(orsUsage.snap.requestsToday)} of ${formatCount(ORS_DAILY_QUOTAS.snap)} provider attempts today`
        ),
        makeThresholdAlert(
            "ors_geocoding",
            "ORS geocoding quota is running low",
            orsUsage.geocoding.requestsToday,
            ALERT_THRESHOLDS.orsGeocoding,
            `${formatCount(orsUsage.geocoding.requestsToday)} of ${formatCount(ORS_DAILY_QUOTAS.geocoding)} provider attempts today`
        )
    ].filter(Boolean);

    if (guard.functionsHour.total >= ALERT_THRESHOLDS.functionErrorRate.minimumCalls) {
        const severity = thresholdSeverity(guard.functionsHour.errorRate, ALERT_THRESHOLDS.functionErrorRate);
        if (severity) alerts.push({
            id: "function_error_rate",
            title: "Cloud Function error rate is elevated",
            severity,
            value: guard.functionsHour.errorRate,
            details: `${formatCount(guard.functionsHour.errors)} errors in ${formatCount(guard.functionsHour.total)} executions during the last hour`,
            channel: "detectedBugs"
        });
    }

    if (guard.appCheck.total >= ALERT_THRESHOLDS.appCheckRiskRate.minimumChecks) {
        const riskRate = Math.max(finite(guard.appCheck.denyRate) || 0, finite(guard.appCheck.invalidRate) || 0);
        const severity = thresholdSeverity(riskRate, ALERT_THRESHOLDS.appCheckRiskRate);
        if (severity) alerts.push({
            id: "app_check_risk",
            title: "App Check invalid or denied traffic is elevated",
            severity,
            value: riskRate,
            details: `${formatCount(guard.appCheck.invalid)} invalid and ${formatCount(guard.appCheck.denied)} denied of ${formatCount(guard.appCheck.total)} checks during the last hour`,
            channel: "systemStatus"
        });
    }

    if (guard.firestore.readsToday === null && guard.firestore.writesToday === null) {
        alerts.push({
            id: "monitoring_unavailable",
            title: "Cost monitoring data is unavailable",
            severity: "important",
            value: null,
            details: "Cloud Monitoring returned neither Firestore reads nor writes. Customer features are unaffected.",
            channel: "systemStatus"
        });
    }
    return alerts;
}

function evaluateDailyAlerts(snapshot) {
    const alerts = [];
    const severity = thresholdSeverity(snapshot.costs.allInMonthlyRunRate, ALERT_THRESHOLDS.totalMonthlyRunRate);
    if (severity) alerts.push({
        id: "total_monthly_run_rate",
        title: "Total monthly cost run-rate crossed its threshold",
        severity,
        value: snapshot.costs.allInMonthlyRunRate,
        details: `${formatMoney(snapshot.costs.allInMonthlyRunRate)}/month estimated across Google Cloud and the base Lemon Squeezy renewal fee`,
        channel: "costs"
    });
    if (snapshot.billing.available && snapshot.billing.freshestExportAt) {
        const ageMs = Date.parse(snapshot.collectedAt) - Date.parse(snapshot.billing.freshestExportAt);
        if (Number.isFinite(ageMs) && ageMs > 48 * 60 * 60 * 1000) alerts.push({
            id: "billing_export_stale",
            title: "Cloud Billing export is stale",
            severity: "important",
            value: ageMs,
            details: `Newest exported cost is ${Math.floor(ageMs / 3_600_000)} hours old`,
            channel: "systemStatus"
        });
    }
    return alerts;
}

function mergeAlerts(...groups) {
    const merged = new Map();
    groups.flat().filter(Boolean).forEach(alert => {
        const previous = merged.get(alert.id);
        if (!previous || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[previous.severity]) merged.set(alert.id, alert);
    });
    return [...merged.values()];
}

function getAlertTransitions(currentAlerts, previousState = {}, nowMs = Date.now()) {
    const previous = previousState && typeof previousState === "object" ? previousState : {};
    const currentById = Object.fromEntries(currentAlerts.map(alert => [alert.id, alert]));
    const notify = [];
    const resolved = [];
    const next = {};

    currentAlerts.forEach(alert => {
        const old = previous[alert.id] || {};
        const severityChanged = Boolean(old.severity && old.severity !== alert.severity);
        // Notify only when entering an alert or escalating severity. Active
        // warnings are visible in the scheduled reports; repeating them every
        // day creates noise without adding information.
        const shouldNotify = !old.severity ||
            SEVERITY_RANK[alert.severity] > SEVERITY_RANK[old.severity];
        if (shouldNotify) notify.push(alert);
        next[alert.id] = {
            severity: alert.severity,
            lastNotifiedAtMs: shouldNotify ? nowMs : finite(old.lastNotifiedAtMs)
        };
        // Counts inside alert text can change on every metric sample. Retaining
        // the last-posted text keeps suppressed repeats byte-for-byte stable,
        // so an active alert does not create an hourly Firestore write.
        if (shouldNotify || severityChanged || !Object.prototype.hasOwnProperty.call(old, "details")) {
            next[alert.id].details = alert.details;
        } else {
            next[alert.id].details = old.details;
        }
    });

    Object.keys(previous).forEach(id => {
        if (!currentById[id]) resolved.push({ id, previous: previous[id] });
    });
    return { notify, resolved, next };
}

function buildCostAlertMessage(alert) {
    const channel = alert.channel || "costs";
    const isCostAlert = channel === "costs";
    return {
        channel,
        tier: alert.severity,
        title: isCostAlert
            ? (alert.severity === "critical" ? `CRITICAL COST ALERT: ${alert.title}` : `Cost warning: ${alert.title}`)
            : (alert.severity === "critical" ? `CRITICAL OPERATIONS ALERT: ${alert.title}` : `Operations warning: ${alert.title}`),
        description: alert.details,
        fields: [
            { name: "Response", value: alert.severity === "critical" ? "Check System Status now and use the launch kill switches if growth continues." : "Watch the next hourly check; no feature has been disabled automatically." }
        ],
        footer: "Hourly monitoring · posts only when a threshold is entered or escalated"
    };
}

function buildSystemStatusCostMessage(alert) {
    return {
        channel: "systemStatus",
        tier: "important",
        title: `Cost guard critical: ${alert.title}`,
        description: alert.details,
        footer: "Full detail and history: #costs"
    };
}

function calculateSnapshot({ guard, daily, users, billing, orsUsage, report }) {
    const estimate = costMetrics.calculateUsageEstimate(daily);
    const billingActual = billing.available ? finite(billing.actualMtd) : null;
    const elapsed = daily.boundaries.elapsedMonthDays;
    const days = daily.boundaries.daysInMonth;
    const billingForecast = billingActual === null ? null : billingActual / Math.max(1 / 24, elapsed) * days;
    const cloudForecast = Math.max(estimate.forecast, billingForecast || 0);
    const lemonMonthlyRunRate = (finite(users.paid) || 0) * LEMON_BASE_ANNUAL_FEE_USD / 12;
    const allInMonthlyRunRate = cloudForecast + lemonMonthlyRunRate;
    const monthlyActive = finite(daily.users.monthlyActive);
    const denominator = monthlyActive && monthlyActive > 0 ? monthlyActive : finite(users.registered);

    return {
        version: 1,
        collectedAt: daily.collectedAt,
        dateKey: report.window.dateKey,
        report: {
            kind: report.window.kind,
            complete: report.window.complete,
            startAt: new Date(report.window.startMs).toISOString(),
            endAt: new Date(report.window.endMs).toISOString(),
            timeZone: report.window.timeZone
        },
        costs: {
            cloudActualMtd: billingActual,
            cloudEstimatedMtd: estimate.estimatedMtd,
            cloudForecast,
            lemonMonthlyRunRate,
            allInMonthlyRunRate,
            costPerActiveUser: denominator ? allInMonthlyRunRate / denominator : null,
            denominator: monthlyActive ? "monthly active user" : "registered account",
            estimateBreakdown: estimate
        },
        users: { ...users, monthlyActive },
        firestore: {
            ...daily.firestore,
            readsToday: guard.firestore.readsToday,
            writesToday: guard.firestore.writesToday,
            deletesToday: guard.firestore.deletesToday,
            legacyToday: guard.firestore.legacy,
            report: report.operations,
            readsPerActiveUser: denominator && finite(daily.firestore.readsMonth) !== null
                ? finite(daily.firestore.readsMonth) / denominator
                : null,
            writesPerActiveUser: denominator && finite(daily.firestore.writesMonth) !== null
                ? finite(daily.firestore.writesMonth) / denominator
                : null
        },
        functions: daily.functions,
        hosting: daily.hosting,
        logging: daily.logging,
        recaptcha: daily.recaptcha,
        appCheck: daily.appCheck,
        ors: orsUsage,
        billing,
        sourceErrors: [
            ...(guard.sourceErrors || []),
            ...(daily.sourceErrors || []),
            ...(report.operations.sourceErrors || [])
        ]
    };
}

function formatOrs(snapshot) {
    return ["directions", "snap", "geocoding"]
        .map(endpoint => `${endpoint} ${formatCount(snapshot.ors[endpoint].requestsToday)}/${formatCount(snapshot.ors[endpoint].dailyLimit)}`)
        .join(" · ");
}

function buildDailyCostMessage(snapshot) {
    const actualLabel = snapshot.billing.available ? formatMoney(snapshot.costs.cloudActualMtd) : "export pending";
    const topServices = snapshot.billing.available && snapshot.billing.byService.length
        ? snapshot.billing.byService.slice(0, 5).map(item => `${item.service}: ${formatMoney(item.cost)}`).join("\n")
        : "Billing export is not ready; usage-based estimate is active.";
    const topFunctions = snapshot.functions.top.length
        ? snapshot.functions.top.map(item => `${item.name} ${formatCount(item.count)}`).join(" · ")
        : "n/a";
    const dataHealth = snapshot.sourceErrors.length
        ? `${snapshot.sourceErrors.length} optional metric source(s) unavailable`
        : "All metric sources responding";
    const reportOperations = snapshot.firestore.report || {};
    const legacyToday = reportOperations.legacy;
    const legacyMonth = snapshot.firestore.legacy;
    const reconciliationToday = legacyToday
        ? `${formatCount(legacyToday.reads)} R · ${formatCount(legacyToday.writes)} W · ${formatCount(legacyToday.deletes)} D`
        : "n/a";
    const reconciliationMonth = legacyMonth
        ? `${formatCount(legacyMonth.readsMonth)} R · ${formatCount(legacyMonth.writesMonth)} W · ${formatCount(legacyMonth.deletesMonth)} D`
        : "n/a";

    const periodLabel = snapshot.report && snapshot.report.complete
        ? "Previous completed Firestore day"
        : "Current Firestore day so far";
    const titlePrefix = snapshot.report && snapshot.report.complete
        ? "Previous-day cost report"
        : "Today’s cost report";

    return {
        channel: "costs",
        tier: "routine",
        title: `${titlePrefix} — ${snapshot.dateKey}`,
        description: `${periodLabel} uses the official bill-oriented Firestore operation counters. Google Cloud actuals can lag by 24+ hours. Lemon Squeezy is a conservative base-fee run-rate, not an invoice total.`,
        fields: [
            { name: "Google Cloud", value: `${actualLabel} MTD · ${formatMoney(snapshot.costs.cloudForecast)} forecast` },
            { name: "All-in run-rate", value: `${formatMoney(snapshot.costs.allInMonthlyRunRate)}/month` },
            { name: `Cost per ${snapshot.costs.denominator}`, value: formatMoney(snapshot.costs.costPerActiveUser) },
            { name: "Users", value: `${formatCount(snapshot.users.registered)} active accounts · ${formatCount(snapshot.users.allDocuments)} raw user docs · ${formatCount(snapshot.users.deleted)} deleted · ${formatCount(snapshot.users.monthlyActive)} monthly active · ${formatCount(snapshot.users.premium)} Premium · ${formatCount(snapshot.users.paid)} Lemon-linked` },
            { name: `${periodLabel} — canonical`, value: `${formatCount(reportOperations.reads)} R · ${formatCount(reportOperations.writes)} W · ${formatCount(reportOperations.deletes)} D` },
            { name: `${periodLabel} — diagnostic check`, value: reconciliationToday },
            { name: "Firestore month — canonical", value: `${formatCount(snapshot.firestore.readsMonth)} R · ${formatCount(snapshot.firestore.writesMonth)} W · ${formatCount(snapshot.firestore.deletesMonth)} D` },
            { name: "Firestore month — legacy check", value: reconciliationMonth },
            { name: "Per active user", value: `${formatCount(snapshot.firestore.readsPerActiveUser)} reads · ${formatCount(snapshot.firestore.writesPerActiveUser)} writes` },
            { name: "CAPTCHA / App Check", value: `${formatCount(snapshot.recaptcha.assessmentsMonth)} assessments · ${formatCount(snapshot.appCheck.allowed)} allowed · ${formatCount(snapshot.appCheck.denied)} denied · ${formatCount(snapshot.appCheck.invalid)} invalid (${formatPercent(snapshot.appCheck.invalidRate)})` },
            { name: "Functions", value: `${formatCount(snapshot.functions.total)} executions · ${formatCount(snapshot.functions.errors)} errors · ${formatBytes(snapshot.functions.egressBytes)} egress` },
            { name: "Top functions", value: topFunctions },
            { name: "Hosting / logs", value: `${formatBytes(snapshot.hosting.sentBytesMonth)} transfer · ${formatBytes(snapshot.hosting.storageBytes)} hosted · ${formatBytes(snapshot.logging.ingestedBytesMonth)} logs` },
            { name: "Firestore storage", value: `${formatBytes(snapshot.firestore.storageBytes)} data/index · ${formatBytes(snapshot.firestore.pitrBytes)} PITR · ${formatBytes(snapshot.firestore.backupBytes)} backups` },
            { name: "ORS quotas", value: formatOrs(snapshot) },
            { name: "Cloud cost by service", value: topServices },
            { name: "Data health", value: dataHealth }
        ],
        footer: `Firestore quota day resets at midnight Pacific · canonical counters determine alerts; diagnostic counters never replace them · collected ${snapshot.collectedAt}`
    };
}

async function postAlertTransitions(transitions, options = {}) {
    const posted = new Set();
    for (const alert of transitions.notify) {
        const result = await opsDiscord.postDiscord(buildCostAlertMessage(alert), options);
        if (result && result.posted) posted.add(alert.id);
        if (alert.severity === "critical" && (alert.channel || "costs") === "costs") {
            await opsDiscord.postDiscord(buildSystemStatusCostMessage(alert), options);
        }
    }
    return posted;
}

function getDueCostReports(state = {}, nowMs = Date.now(), options = {}) {
    const local = costMetrics.formatDateInZone(nowMs, REPORT_TIME_ZONE);
    if (options.forceDaily === true) {
        return [{ kind: options.reportKind === "morning" ? "morning" : "evening", triggerDateKey: local.dateKey }];
    }
    const due = [];
    if (local.hour >= 9 && state.lastMorningReportDate !== local.dateKey) {
        due.push({ kind: "morning", triggerDateKey: local.dateKey });
    }
    if (local.hour >= 23 && state.lastEveningReportDate !== local.dateKey) {
        due.push({ kind: "evening", triggerDateKey: local.dateKey });
    }
    return due;
}

function applyPostingResults(transitions, posted, previousState, nowMs) {
    const next = { ...transitions.next };
    transitions.notify.forEach(alert => {
        if (posted.has(alert.id)) return;
        const old = previousState && previousState[alert.id];
        next[alert.id] = {
            ...next[alert.id],
            lastNotifiedAtMs: old && finite(old.lastNotifiedAtMs) ? finite(old.lastNotifiedAtMs) : 0
        };
    });
    return next;
}

async function runHourlyCostMonitoring(options = {}) {
    const db = options.firestore || admin.firestore();
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const stateRef = db.doc(COST_STATE_PATH);
    const snapshotRef = db.doc(COST_SNAPSHOT_PATH);
    let state = {};
    try {
        const stateSnapshot = await stateRef.get();
        state = stateSnapshot && stateSnapshot.exists && typeof stateSnapshot.data === "function" ? stateSnapshot.data() : {};
    } catch (error) {
        console.error("[costs] Alert state could not be read.", { message: error && error.message });
    }

    const dueReports = getDueCostReports(state, nowMs, options);
    const dailyDue = dueReports.length > 0;

    const [guard, orsUsage] = await Promise.all([
        costMetrics.collectGuardMetrics({ ...options, nowMs, includeLegacy: false }),
        collectOrsCircuitUsage(db, options)
    ]);
    const boundaries = guard.boundaries;

    let snapshot = null;
    const postedReportState = {};
    let reportsPosted = 0;
    let dailyAlerts = [];
    if (dailyDue) {
        const [daily, users, billing] = await Promise.all([
            costMetrics.collectDailyMetrics({ ...options, nowMs, includeLegacy: true }),
            costMetrics.collectUserCounts(db),
            costMetrics.collectBillingCost({ ...options, nowMs })
        ]);
        for (const dueReport of dueReports) {
            const window = costMetrics.getFirestoreReportWindow(nowMs, dueReport.kind);
            const operations = await costMetrics.collectFirestoreOperations(window, { ...options, includeLegacy: true });
            snapshot = calculateSnapshot({ guard, daily, users, billing, orsUsage, report: { window, operations } });
            const messageResult = await opsDiscord.postDiscord(buildDailyCostMessage(snapshot), options);
            if (messageResult && messageResult.posted === true) {
                reportsPosted += 1;
                postedReportState[dueReport.kind === "morning" ? "lastMorningReportDate" : "lastEveningReportDate"] = dueReport.triggerDateKey;
            }
        }
        dailyAlerts = snapshot ? evaluateDailyAlerts(snapshot) : [];
        if (snapshot) try {
            await snapshotRef.set({ ...snapshot, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
        } catch (error) {
            console.error("[costs] Cost snapshot could not be cached.", { message: error && error.message });
        }
    }

    const alerts = mergeAlerts(evaluateGuardAlerts(guard, orsUsage), dailyAlerts);
    const previousAlerts = state.alerts && typeof state.alerts === "object" ? state.alerts : {};
    const transitions = getAlertTransitions(alerts, previousAlerts, nowMs);
    const posted = await postAlertTransitions(transitions, options);
    const nextAlerts = applyPostingResults(transitions, posted, previousAlerts, nowMs);

    const stateChanged = JSON.stringify(nextAlerts) !== JSON.stringify(previousAlerts);
    const dailyPosted = reportsPosted > 0;
    if (stateChanged || dailyPosted) {
        try {
            await stateRef.set({
                alerts: nextAlerts,
                ...postedReportState,
                lastCheckedAt: FieldValue.serverTimestamp(),
                lastCheckedAtMs: nowMs
            }, { merge: true });
        } catch (error) {
            console.error("[costs] Alert state could not be saved.", { message: error && error.message });
        }
    }

    console.info("[costs] Hourly cost guard complete.", {
        dateKey: boundaries.dateKey,
        dailyDue,
        reportsPosted,
        alertCount: alerts.length,
        notificationsPosted: posted.size,
        monitoringErrors: guard.sourceErrors.length
    });
    return { guard, orsUsage, snapshot, alerts, dailyPosted, reportsPosted, notificationsPosted: posted.size };
}

module.exports = {
    COST_STATE_PATH,
    COST_SNAPSHOT_PATH,
    ALERT_THRESHOLDS,
    ORS_DAILY_QUOTAS,
    LEMON_BASE_ANNUAL_FEE_USD,
    collectOrsCircuitUsage,
    evaluateGuardAlerts,
    evaluateDailyAlerts,
    mergeAlerts,
    getAlertTransitions,
    buildCostAlertMessage,
    buildSystemStatusCostMessage,
    calculateSnapshot,
    buildDailyCostMessage,
    getDueCostReports,
    runHourlyCostMonitoring,
    formatCount,
    formatMoney,
    formatPercent,
    formatBytes
};
