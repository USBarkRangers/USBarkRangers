"use strict";

// ===== SHARED ANALYTICS SNAPSHOT =====
// One compact document is the contract shared by Discord and CarterSwarm. Raw
// provider values remain visible for reconciliation; cumulative observed totals
// are monotonic so a rolling window or provider reprocessing cannot make an
// all-time counter move backwards during the day.

const { FieldValue } = require("firebase-admin/firestore");

const ANALYTICS_SNAPSHOT_PATH = "system/analyticsStatus";
const ANALYTICS_TIME_ZONE = "America/New_York";
const DAILY_REPORT_CRON = "15 9,19 * * *";
const MAX_FINALIZED_DAYS = 400;

function dateKeyInZone(nowMs, timeZone = ANALYTICS_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date(nowMs));
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(dateKey, days) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function timeZoneOffsetMs(timestampMs, timeZone) {
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
    return Date.UTC(
        Number(values.year), Number(values.month) - 1, Number(values.day),
        Number(values.hour), Number(values.minute), Number(values.second)
    ) - Math.floor(timestampMs / 1000) * 1000;
}

function startOfDateKeyMs(dateKey, timeZone = ANALYTICS_TIME_ZONE) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    const target = Date.UTC(year, month - 1, day);
    let guess = target;
    for (let index = 0; index < 3; index += 1) {
        guess = target - timeZoneOffsetMs(guess, timeZone);
    }
    return guess;
}

function getCompletedCalendarPeriod(nowMs = Date.now(), days = 1, timeZone = ANALYTICS_TIME_ZONE) {
    const currentDate = dateKeyInZone(nowMs, timeZone);
    const endDate = shiftDateKey(currentDate, -1);
    const startDate = shiftDateKey(endDate, -(Math.max(1, days) - 1));
    const endExclusiveDate = shiftDateKey(endDate, 1);
    const startMs = startOfDateKeyMs(startDate, timeZone);
    const endMs = startOfDateKeyMs(endExclusiveDate, timeZone);
    return {
        startDate,
        endDate,
        startMs,
        endMs,
        days: Math.max(1, days),
        completed: true,
        timeZone,
        label: days === 1 ? `${endDate} finalized day` : `${startDate} through ${endDate}`
    };
}

function timeLabelInZone(nowMs, timeZone = ANALYTICS_TIME_ZONE) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
    }).format(new Date(nowMs));
}

function hourInZone(nowMs, timeZone = ANALYTICS_TIME_ZONE) {
    const hour = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        hourCycle: "h23"
    }).format(new Date(nowMs));
    return Number(hour);
}

function getDailyReportMode(nowMs = Date.now(), timeZone = ANALYTICS_TIME_ZONE) {
    return hourInZone(nowMs, timeZone) < 12 ? "finalized" : "live";
}

function getCurrentCalendarPeriod(nowMs = Date.now(), timeZone = ANALYTICS_TIME_ZONE) {
    const currentDate = dateKeyInZone(nowMs, timeZone);
    return {
        startDate: currentDate,
        endDate: currentDate,
        startMs: startOfDateKeyMs(currentDate, timeZone),
        endMs: nowMs,
        days: 1,
        completed: false,
        timeZone,
        label: `${currentDate} through ${timeLabelInZone(nowMs, timeZone)} (live)`
    };
}

function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

function maxObserved(previous, reported) {
    const oldValue = finiteOrNull(previous);
    const newValue = finiteOrNull(reported);
    if (oldValue === null) return newValue;
    if (newValue === null) return oldValue;
    return Math.max(oldValue, newValue);
}

function reportedTotals(summary) {
    const ga = summary && summary.ga4 && summary.ga4.allTime;
    const goat = summary && summary.traffic && summary.traffic.allTime;
    return {
        ga4: ga ? {
            totalUsers: finiteOrNull(ga.totalUsers),
            appOpens: finiteOrNull(ga.appOpens),
            screenViews: finiteOrNull(ga.screenViews)
        } : null,
        goatCounter: goat ? {
            sessions: finiteOrNull(goat.sessions),
            appOpens: goat.openCoverage && goat.openCoverage.complete === true
                ? finiteOrNull(goat.appOpens)
                : null,
            knownAppOpens: finiteOrNull(goat.openCoverage && goat.openCoverage.knownAppOpens),
            openCoverageComplete: Boolean(goat.openCoverage && goat.openCoverage.complete === true),
            pageVisits: finiteOrNull(goat.pageVisits),
            partial: goat.partial === true
        } : null
    };
}

function mergeProvider(previous, reported, fields) {
    const old = previous && typeof previous === "object" ? previous : {};
    const fresh = reported && typeof reported === "object" ? reported : {};
    return Object.fromEntries(fields.map(field => [field, maxObserved(old[field], fresh[field])]));
}

function buildAnalyticsSnapshot(previous = {}, summary, period, collectedAt) {
    const providerReported = reportedTotals(summary);
    const priorObserved = previous.cumulative && previous.cumulative.monotonicObserved || {};
    const goatCounterObserved = mergeProvider(priorObserved.goatCounter, providerReported.goatCounter, ["sessions", "appOpens", "pageVisits"]);
    goatCounterObserved.knownAppOpens = maxObserved(
        priorObserved.goatCounter && priorObserved.goatCounter.knownAppOpens,
        providerReported.goatCounter && providerReported.goatCounter.knownAppOpens
    );
    goatCounterObserved.openCoverageComplete = Boolean(
        providerReported.goatCounter && providerReported.goatCounter.openCoverageComplete
    );
    if (!goatCounterObserved.openCoverageComplete) goatCounterObserved.appOpens = null;
    const monotonicObserved = {
        ga4: mergeProvider(priorObserved.ga4, providerReported.ga4, ["totalUsers", "appOpens", "screenViews"]),
        goatCounter: goatCounterObserved
    };

    const previousDays = previous.finalizedDays && typeof previous.finalizedDays === "object"
        ? previous.finalizedDays
        : {};
    const finalizedDays = { ...previousDays };
    if (period.days === 1 && period.completed !== false) {
        finalizedDays[period.endDate] = {
            capturedAt: collectedAt,
            ga4: summary.ga4 ? summary.ga4.period : null,
            goatCounter: summary.traffic ? {
                sessions: summary.traffic.appVisits,
                appOpens: summary.traffic.appOpens,
                repeatOpens: summary.traffic.repeatOpens,
                openCoverage: summary.traffic.openCoverage || null
            } : null
        };
    }
    const retainedDays = Object.fromEntries(Object.entries(finalizedDays)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(-MAX_FINALIZED_DAYS));

    return {
        version: 1,
        collectedAt,
        period,
        cumulative: {
            providerReported,
            monotonicObserved,
            ga4TrackingStartDate: summary.ga4 && summary.ga4.trackingStartDate || null,
            goatCounterTrackingStartDate: summary.traffic && summary.traffic.allTime && summary.traffic.allTime.trackingStartDate || null
        },
        latest: {
            accounts: summary.accountReconciliation || null,
            ga4: summary.ga4 || null,
            goatCounter: summary.traffic || null
        },
        finalizedDays: retainedDays
    };
}

async function collectAccountReconciliation(db, authClient) {
    try {
        const users = db.collection("users");
        const [rawSnapshot, deletedSnapshot] = await Promise.all([
            users.count().get(),
            users.where("accountDeleted", "==", true).count().get()
        ]);
        const rawDocuments = Number(rawSnapshot.data().count) || 0;
        const deletedDocuments = Number(deletedSnapshot.data().count) || 0;
        const firestoreActive = Math.max(0, rawDocuments - deletedDocuments);

        let authActive = 0;
        let pageToken;
        do {
            const page = await authClient.listUsers(1000, pageToken);
            authActive += Array.isArray(page.users) ? page.users.length : 0;
            pageToken = page.pageToken || undefined;
        } while (pageToken);

        return {
            rawDocuments,
            deletedDocuments,
            firestoreActive,
            authActive,
            difference: firestoreActive - authActive
        };
    } catch (error) {
        console.error("[metrics] Account-source reconciliation unavailable.", {
            message: error && error.message ? error.message : String(error)
        });
        return null;
    }
}

async function saveAnalyticsSnapshot(db, summary, period, options = {}) {
    const reference = db.doc(ANALYTICS_SNAPSHOT_PATH);
    let previous = {};
    try {
        const snapshot = await reference.get();
        previous = snapshot && snapshot.exists && typeof snapshot.data === "function" ? snapshot.data() : {};
    } catch (error) {
        console.error("[metrics] Previous analytics snapshot could not be read.", { message: error && error.message });
    }
    const collectedAt = options.collectedAt || new Date(options.nowMs || Date.now()).toISOString();
    const next = buildAnalyticsSnapshot(previous, summary, period, collectedAt);
    try {
        await reference.set({ ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
    } catch (error) {
        console.error("[metrics] Analytics snapshot could not be saved.", { message: error && error.message });
    }
    return next;
}

module.exports = {
    ANALYTICS_SNAPSHOT_PATH,
    ANALYTICS_TIME_ZONE,
    DAILY_REPORT_CRON,
    MAX_FINALIZED_DAYS,
    dateKeyInZone,
    shiftDateKey,
    startOfDateKeyMs,
    getCompletedCalendarPeriod,
    getCurrentCalendarPeriod,
    timeLabelInZone,
    hourInZone,
    getDailyReportMode,
    finiteOrNull,
    maxObserved,
    reportedTotals,
    buildAnalyticsSnapshot,
    collectAccountReconciliation,
    saveAnalyticsSnapshot
};
