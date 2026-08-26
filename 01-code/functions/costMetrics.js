"use strict";

// ===== CLOUD COST METRICS =====
// Read-only access to Google service metrics and the optional Cloud Billing
// export. This module never writes Firestore and never posts to Discord. That
// separation keeps collection/calculation testable and prevents a reporting
// failure from affecting customer-facing functions.

const { google } = require("googleapis");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "barkrangermap-auth";
const BILLING_DATASET_ID = "bark_cost_export";
const BILLING_TABLE_PREFIX = "gcp_billing_export_v1_";
const BIGQUERY_MAX_BYTES_BILLED = 1024 * 1024 * 1024; // 1 GiB hard ceiling per daily query.
const EASTERN_TIME_ZONE = "America/New_York";
const GIB = 1024 ** 3;

const METRICS = Object.freeze({
    firestoreReads: "firestore.googleapis.com/document/read_count",
    firestoreWrites: "firestore.googleapis.com/document/write_count",
    firestoreDeletes: "firestore.googleapis.com/document/delete_count",
    functionExecutions: "cloudfunctions.googleapis.com/function/execution_count",
    functionEgress: "cloudfunctions.googleapis.com/function/network_egress",
    // The monthly_sent gauge is duplicated once per mapped domain. Summing it
    // over-counts this site's traffic, so use the delta counter instead.
    hostingSent: "firebasehosting.googleapis.com/network/sent_bytes_count",
    hostingStorage: "firebasehosting.googleapis.com/storage/total_bytes",
    loggingMonthlyIngested: "logging.googleapis.com/billing/monthly_bytes_ingested",
    recaptchaAssessments: "recaptchaenterprise.googleapis.com/assessment_count",
    appCheckVerifications: "firebaseappcheck.googleapis.com/resources/verification_count",
    monthlyActiveUsers: "identitytoolkit.googleapis.com/usage/monthly_new_signin_count",
    firestoreStorage: "firestore.googleapis.com/storage/data_and_index_storage_bytes",
    firestorePitr: "firestore.googleapis.com/storage/pitr_storage_bytes",
    firestoreBackups: "firestore.googleapis.com/storage/backups_storage_bytes"
});

function numericPointValue(point) {
    const value = point && point.value;
    if (!value) return 0;
    if (value.int64Value !== undefined) return Number(value.int64Value) || 0;
    if (value.doubleValue !== undefined) return Number(value.doubleValue) || 0;
    return 0;
}

function getSeriesLabels(series) {
    return {
        metric: (series && series.metric && series.metric.labels) || {},
        resource: (series && series.resource && series.resource.labels) || {}
    };
}

function sumDeltaSeries(series = []) {
    return series.reduce((total, item) => total + (item.points || [])
        .reduce((seriesTotal, point) => seriesTotal + numericPointValue(point), 0), 0);
}

function sumLatestGaugeSeries(series = []) {
    return series.reduce((total, item) => {
        const latest = (item.points || []).reduce((best, point) => {
            const stamp = point && point.interval && point.interval.endTime;
            return !best || String(stamp) > String(best.stamp) ? { stamp, value: numericPointValue(point) } : best;
        }, null);
        return total + (latest ? latest.value : 0);
    }, 0);
}

function formatDateInZone(nowMs, timeZone = EASTERN_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date(nowMs));
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        dateKey: `${values.year}-${values.month}-${values.day}`
    };
}

function timeZoneOffsetMs(timestampMs, timeZone = EASTERN_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date(timestampMs));
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
        Number(values.year), Number(values.month) - 1, Number(values.day),
        Number(values.hour), Number(values.minute), Number(values.second)
    );
    return representedAsUtc - Math.floor(timestampMs / 1000) * 1000;
}

function zonedDateTimeToUtcMs({ year, month, day, hour = 0 }, timeZone = EASTERN_TIME_ZONE) {
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
    let guess = targetAsUtc;
    for (let i = 0; i < 3; i += 1) {
        guess = targetAsUtc - timeZoneOffsetMs(guess, timeZone);
    }
    return guess;
}

function getReportingBoundaries(nowMs = Date.now()) {
    const eastern = formatDateInZone(nowMs);
    const dayStartMs = zonedDateTimeToUtcMs({ ...eastern, hour: 0 });
    const monthStartMs = zonedDateTimeToUtcMs({ ...eastern, day: 1, hour: 0 });
    const nextMonthYear = eastern.month === 12 ? eastern.year + 1 : eastern.year;
    const nextMonth = eastern.month === 12 ? 1 : eastern.month + 1;
    const nextMonthStartMs = zonedDateTimeToUtcMs({ year: nextMonthYear, month: nextMonth, day: 1 });
    return {
        ...eastern,
        dayStartMs,
        monthStartMs,
        nextMonthStartMs,
        daysInMonth: Math.round((nextMonthStartMs - monthStartMs) / 86_400_000),
        elapsedMonthDays: Math.max(1 / 24, (nowMs - monthStartMs) / 86_400_000)
    };
}

async function getGoogleAuthClient(options = {}) {
    if (options.authClient) return options.authClient;
    const auth = new google.auth.GoogleAuth({
        scopes: [
            "https://www.googleapis.com/auth/monitoring.read",
            "https://www.googleapis.com/auth/bigquery.readonly",
            "https://www.googleapis.com/auth/cloud-platform.read-only"
        ]
    });
    return auth.getClient();
}

async function listTimeSeries(metricType, { startMs, endMs, aligner = "ALIGN_SUM", alignmentPeriod = "3600s" }, options = {}) {
    if (typeof options.listTimeSeries === "function") {
        return options.listTimeSeries(metricType, { startMs, endMs, aligner, alignmentPeriod });
    }

    const authClient = await getGoogleAuthClient(options);
    const projectId = options.projectId || PROJECT_ID;
    const timeSeries = [];
    let pageToken = null;
    do {
        const response = await authClient.request({
            url: `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries`,
            method: "GET",
            params: {
                filter: `metric.type="${metricType}"`,
                "interval.startTime": new Date(startMs).toISOString(),
                "interval.endTime": new Date(endMs).toISOString(),
                "aggregation.alignmentPeriod": alignmentPeriod,
                "aggregation.perSeriesAligner": aligner,
                view: "FULL",
                pageSize: 1000,
                ...(pageToken ? { pageToken } : {})
            }
        });
        const data = response && response.data ? response.data : {};
        timeSeries.push(...(data.timeSeries || []));
        pageToken = data.nextPageToken || null;
    } while (pageToken);
    return timeSeries;
}

async function safeListTimeSeries(metricType, interval, options, errors) {
    try {
        return await listTimeSeries(metricType, interval, options);
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        console.error("[costs] Cloud Monitoring metric unavailable.", { metricType, message });
        errors.push({ source: metricType, message: message.slice(0, 200) });
        return null;
    }
}

function buildFunctionSummary(series) {
    if (!Array.isArray(series)) return { total: null, errors: null, errorRate: null, top: [] };
    const totals = new Map();
    let total = 0;
    let errors = 0;
    series.forEach(item => {
        const labels = getSeriesLabels(item);
        const functionName = labels.resource.function_name || "unknown";
        const status = String(labels.metric.status || "unknown").toLowerCase();
        const count = sumDeltaSeries([item]);
        total += count;
        if (status !== "ok") errors += count;
        totals.set(functionName, (totals.get(functionName) || 0) + count);
    });
    const top = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));
    return { total, errors, errorRate: total ? errors / total : 0, top };
}

function buildAppCheckSummary(series) {
    if (!Array.isArray(series)) return {
        total: null,
        allowed: null,
        denied: null,
        denyRate: null,
        invalid: null,
        invalidRate: null
    };
    let total = 0;
    let allowed = 0;
    let denied = 0;
    let invalid = 0;
    series.forEach(item => {
        const labels = getSeriesLabels(item).metric;
        const count = sumDeltaSeries([item]);
        const result = String(labels.result || "").toUpperCase();
        const security = String(labels.security || "").toUpperCase();
        total += count;
        if (result === "ALLOW") allowed += count;
        else denied += count;
        if (security && !["VALID", "CONSUMED"].includes(security)) invalid += count;
    });
    return {
        total,
        allowed,
        denied,
        denyRate: total ? denied / total : 0,
        invalid,
        invalidRate: total ? invalid / total : 0
    };
}

async function collectGuardMetrics(options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const boundaries = getReportingBoundaries(nowMs);
    const errors = [];
    const day = { startMs: boundaries.dayStartMs, endMs: nowMs, aligner: "ALIGN_SUM", alignmentPeriod: "3600s" };
    const month = { startMs: boundaries.monthStartMs, endMs: nowMs, aligner: "ALIGN_SUM", alignmentPeriod: "3600s" };
    const hour = { startMs: Math.max(boundaries.dayStartMs, nowMs - 60 * 60 * 1000), endMs: nowMs, aligner: "ALIGN_SUM", alignmentPeriod: "3600s" };

    const [reads, writes, deletes, recaptcha, appCheck, functions] = await Promise.all([
        safeListTimeSeries(METRICS.firestoreReads, day, options, errors),
        safeListTimeSeries(METRICS.firestoreWrites, day, options, errors),
        safeListTimeSeries(METRICS.firestoreDeletes, day, options, errors),
        safeListTimeSeries(METRICS.recaptchaAssessments, month, options, errors),
        safeListTimeSeries(METRICS.appCheckVerifications, hour, options, errors),
        safeListTimeSeries(METRICS.functionExecutions, hour, options, errors)
    ]);

    return {
        collectedAt: new Date(nowMs).toISOString(),
        boundaries,
        firestore: {
            readsToday: Array.isArray(reads) ? sumDeltaSeries(reads) : null,
            writesToday: Array.isArray(writes) ? sumDeltaSeries(writes) : null,
            deletesToday: Array.isArray(deletes) ? sumDeltaSeries(deletes) : null
        },
        recaptcha: { assessmentsMonth: Array.isArray(recaptcha) ? sumDeltaSeries(recaptcha) : null },
        appCheck: buildAppCheckSummary(appCheck),
        functionsHour: buildFunctionSummary(functions),
        sourceErrors: errors
    };
}

async function collectDailyMetrics(options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const boundaries = getReportingBoundaries(nowMs);
    const errors = [];
    const month = { startMs: boundaries.monthStartMs, endMs: nowMs, aligner: "ALIGN_SUM", alignmentPeriod: "86400s" };
    const recentGauge = { startMs: nowMs - 3 * 86_400_000, endMs: nowMs, aligner: "ALIGN_MAX", alignmentPeriod: "86400s" };

    const [reads, writes, deletes, executions, egress, hostingSent, hostingStorage, logging,
        recaptcha, appCheck, monthlyActive, firestoreStorage, firestorePitr, firestoreBackups] = await Promise.all([
        safeListTimeSeries(METRICS.firestoreReads, month, options, errors),
        safeListTimeSeries(METRICS.firestoreWrites, month, options, errors),
        safeListTimeSeries(METRICS.firestoreDeletes, month, options, errors),
        safeListTimeSeries(METRICS.functionExecutions, month, options, errors),
        safeListTimeSeries(METRICS.functionEgress, month, options, errors),
        safeListTimeSeries(METRICS.hostingSent, month, options, errors),
        safeListTimeSeries(METRICS.hostingStorage, recentGauge, options, errors),
        safeListTimeSeries(METRICS.loggingMonthlyIngested, recentGauge, options, errors),
        safeListTimeSeries(METRICS.recaptchaAssessments, month, options, errors),
        safeListTimeSeries(METRICS.appCheckVerifications, month, options, errors),
        safeListTimeSeries(METRICS.monthlyActiveUsers, month, options, errors),
        safeListTimeSeries(METRICS.firestoreStorage, recentGauge, options, errors),
        safeListTimeSeries(METRICS.firestorePitr, recentGauge, options, errors),
        safeListTimeSeries(METRICS.firestoreBackups, recentGauge, options, errors)
    ]);

    return {
        collectedAt: new Date(nowMs).toISOString(),
        boundaries,
        firestore: {
            readsMonth: Array.isArray(reads) ? sumDeltaSeries(reads) : null,
            writesMonth: Array.isArray(writes) ? sumDeltaSeries(writes) : null,
            deletesMonth: Array.isArray(deletes) ? sumDeltaSeries(deletes) : null,
            storageBytes: Array.isArray(firestoreStorage) ? sumLatestGaugeSeries(firestoreStorage) : null,
            pitrBytes: Array.isArray(firestorePitr) ? sumLatestGaugeSeries(firestorePitr) : null,
            backupBytes: Array.isArray(firestoreBackups) ? sumLatestGaugeSeries(firestoreBackups) : null
        },
        functions: {
            ...buildFunctionSummary(executions),
            egressBytes: Array.isArray(egress) ? sumDeltaSeries(egress) : null
        },
        hosting: {
            sentBytesMonth: Array.isArray(hostingSent) ? sumDeltaSeries(hostingSent) : null,
            storageBytes: Array.isArray(hostingStorage) ? sumLatestGaugeSeries(hostingStorage) : null
        },
        logging: { ingestedBytesMonth: Array.isArray(logging) ? sumLatestGaugeSeries(logging) : null },
        recaptcha: { assessmentsMonth: Array.isArray(recaptcha) ? sumDeltaSeries(recaptcha) : null },
        appCheck: buildAppCheckSummary(appCheck),
        users: { monthlyActive: Array.isArray(monthlyActive) ? sumDeltaSeries(monthlyActive) : null },
        sourceErrors: errors
    };
}

async function countCollection(query) {
    const snapshot = await query.count().get();
    const count = snapshot && typeof snapshot.data === "function" ? snapshot.data().count : null;
    return Number.isFinite(Number(count)) ? Number(count) : null;
}

async function collectUserCounts(db) {
    const safeCount = async (label, query) => {
        try {
            return await countCollection(query);
        } catch (error) {
            console.error("[costs] User aggregation unavailable.", { label, message: error && error.message });
            return null;
        }
    };
    const [registered, premium, paid] = await Promise.all([
        safeCount("registered", db.collection("users")),
        safeCount("premium", db.collection("users").where("entitlement.premium", "==", true)),
        safeCount("paid", db.collection("users").where("entitlement.source", "==", "lemon_squeezy"))
    ]);
    return { registered, premium, paid };
}

async function findBillingExportTable(bigquery, projectId, datasetId) {
    const response = await bigquery.tables.list({ projectId, datasetId, maxResults: 100 });
    const tables = response && response.data && response.data.tables ? response.data.tables : [];
    const match = tables.find(table => table.tableReference && String(table.tableReference.tableId).startsWith(BILLING_TABLE_PREFIX));
    return match && match.tableReference ? match.tableReference.tableId : null;
}

function parseBigQueryRows(data) {
    const rows = (data && data.rows) || [];
    return rows.map(row => {
        const fields = (row.f || []).map(field => field.v);
        return {
            service: fields[0] || "Unknown",
            cost: Number(fields[1]) || 0,
            freshestExportAt: fields[2] || null
        };
    });
}

async function collectBillingCost(options = {}) {
    if (options.billingCost !== undefined) return options.billingCost;
    const projectId = options.projectId || PROJECT_ID;
    const datasetId = options.billingDatasetId || BILLING_DATASET_ID;
    try {
        const auth = options.googleAuth || new google.auth.GoogleAuth({
            // Query jobs require the BigQuery scope; IAM still limits this
            // service account to reading the dedicated billing dataset.
            scopes: ["https://www.googleapis.com/auth/bigquery"]
        });
        const bigquery = options.bigquery || google.bigquery({ version: "v2", auth });
        const tableId = options.billingTableId || await findBillingExportTable(bigquery, projectId, datasetId);
        if (!tableId || !new RegExp(`^${BILLING_TABLE_PREFIX}[A-Za-z0-9_]+$`).test(tableId)) {
            return { available: false, reason: "export_not_ready", actualMtd: null, byService: [] };
        }
        const boundaries = getReportingBoundaries(Number.isFinite(options.nowMs) ? options.nowMs : Date.now());
        const table = `\`${projectId}.${datasetId}.${tableId}\``;
        const query = `
            SELECT
              service.description AS service,
              SUM(CAST(cost AS NUMERIC))
                + SUM(IFNULL((SELECT SUM(CAST(credit.amount AS NUMERIC)) FROM UNNEST(credits) credit), 0)) AS net_cost,
              MAX(export_time) AS freshest_export
            FROM ${table}
            WHERE project.id = @project_id
              AND usage_start_time >= @month_start
              AND usage_start_time < @now
            GROUP BY service
            ORDER BY net_cost DESC`;
        const response = await bigquery.jobs.query({
            projectId,
            requestBody: {
                query,
                useLegacySql: false,
                maximumBytesBilled: String(BIGQUERY_MAX_BYTES_BILLED),
                parameterMode: "NAMED",
                queryParameters: [
                    { name: "project_id", parameterType: { type: "STRING" }, parameterValue: { value: projectId } },
                    { name: "month_start", parameterType: { type: "TIMESTAMP" }, parameterValue: { value: new Date(boundaries.monthStartMs).toISOString() } },
                    { name: "now", parameterType: { type: "TIMESTAMP" }, parameterValue: { value: new Date(options.nowMs || Date.now()).toISOString() } }
                ]
            }
        });
        if (response && response.data && response.data.jobComplete === false) {
            return { available: false, reason: "query_still_running", actualMtd: null, byService: [] };
        }
        const rows = parseBigQueryRows(response && response.data);
        return {
            available: true,
            actualMtd: rows.reduce((sum, row) => sum + row.cost, 0),
            byService: rows.map(({ service, cost }) => ({ service, cost })),
            freshestExportAt: rows.reduce((latest, row) => !latest || String(row.freshestExportAt) > String(latest) ? row.freshestExportAt : latest, null),
            maximumBytesBilled: BIGQUERY_MAX_BYTES_BILLED
        };
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        console.warn("[costs] Cloud Billing export unavailable.", { message });
        return { available: false, reason: "query_failed", actualMtd: null, byService: [], error: message.slice(0, 200) };
    }
}

function calculateRecaptchaCost(assessments) {
    if (!Number.isFinite(assessments) || assessments <= 10_000) return 0;
    if (assessments <= 100_000) return 8;
    return 8 + (assessments - 100_000) * 0.001;
}

function calculateUsageEstimate(metrics) {
    const boundaries = metrics.boundaries;
    const monthlyFixedBaseline = 6.56;
    const recaptcha = calculateRecaptchaCost(metrics.recaptcha && metrics.recaptcha.assessmentsMonth);
    const hostingBytes = metrics.hosting && metrics.hosting.sentBytesMonth;
    const hosting = Number.isFinite(hostingBytes) ? Math.max(0, (hostingBytes - 10 * GIB) / GIB) * 0.15 : 0;
    const functionCount = metrics.functions && metrics.functions.total;
    const functions = Number.isFinite(functionCount) ? Math.max(0, functionCount - 2_000_000) / 1_000_000 * 0.40 : 0;
    const forecast = monthlyFixedBaseline + recaptcha + hosting + functions;
    const estimatedMtd = forecast * Math.min(1, boundaries.elapsedMonthDays / boundaries.daysInMonth);
    return { monthlyFixedBaseline, recaptcha, hosting, functions, estimatedMtd, forecast };
}

module.exports = {
    METRICS,
    PROJECT_ID,
    BILLING_DATASET_ID,
    BILLING_TABLE_PREFIX,
    BIGQUERY_MAX_BYTES_BILLED,
    EASTERN_TIME_ZONE,
    GIB,
    numericPointValue,
    getSeriesLabels,
    sumDeltaSeries,
    sumLatestGaugeSeries,
    formatDateInZone,
    getReportingBoundaries,
    listTimeSeries,
    collectGuardMetrics,
    collectDailyMetrics,
    collectUserCounts,
    collectBillingCost,
    calculateRecaptchaCost,
    calculateUsageEstimate,
    buildFunctionSummary,
    buildAppCheckSummary
};
