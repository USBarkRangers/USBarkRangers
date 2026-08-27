"use strict";

// ===== GOOGLE ANALYTICS VISITOR METRICS =====
// GA4 is the identity/session source. It never writes Firestore; callers may
// persist one compact daily snapshot after collection. GoatCounter stays as an
// independent traffic cross-check because its eight-hour visit definition is
// deliberately different.

const { google } = require("googleapis");

const DEFAULT_GA4_PROPERTY_ID = "533536322";
const GA4_PROPERTY_ENV = "GA4_PROPERTY_ID";
const GA4_TRACKING_START_DATE = "2026-08-26";
const GA4_TIMEOUT_MS = 12_000;
const TRACKED_EVENTS = Object.freeze(["bark_app_opened", "bark_screen_view"]);

function emptyStats() {
    return {
        totalUsers: 0,
        activeUsers: 0,
        newUsers: 0,
        returningUsers: 0,
        sessions: 0,
        appOpens: 0,
        appOpenUsers: 0,
        screenViews: 0,
        screenViewUsers: 0
    };
}

function shiftDateKey(dateKey, days) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function inclusiveDayCount(startDate, endDate) {
    const start = Date.parse(`${startDate}T12:00:00.000Z`);
    const end = Date.parse(`${endDate}T12:00:00.000Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
    return Math.round((end - start) / 86400000) + 1;
}

function finiteCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function getGa4PropertyId(options = {}) {
    const env = options.env || process.env;
    const value = String(env[GA4_PROPERTY_ENV] || DEFAULT_GA4_PROPERTY_ID).trim();
    return /^\d+$/.test(value) ? value : null;
}

async function getAnalyticsAuthClient(options = {}) {
    if (options.authClient) return options.authClient;
    const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
    });
    return auth.getClient();
}

async function runReport(propertyId, request, options = {}) {
    if (typeof options.gaRunReport === "function") {
        return options.gaRunReport(propertyId, request);
    }
    const authClient = await getAnalyticsAuthClient(options);
    const response = await authClient.request({
        url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
        method: "POST",
        data: request,
        timeout: GA4_TIMEOUT_MS
    });
    return response && response.data ? response.data : {};
}

function metricMap(report) {
    const headers = (report && report.metricHeaders) || [];
    const row = report && Array.isArray(report.rows) ? report.rows[0] : null;
    const values = row && Array.isArray(row.metricValues) ? row.metricValues : [];
    return Object.fromEntries(headers.map((header, index) => [
        header.name,
        finiteCount(values[index] && values[index].value)
    ]));
}

function eventMap(report) {
    const result = Object.fromEntries(TRACKED_EVENTS.map((name) => [name, { events: 0, users: 0 }]));
    ((report && report.rows) || []).forEach((row) => {
        const name = row.dimensionValues && row.dimensionValues[0] && row.dimensionValues[0].value;
        if (!Object.prototype.hasOwnProperty.call(result, name)) return;
        result[name] = {
            events: finiteCount(row.metricValues && row.metricValues[0] && row.metricValues[0].value),
            users: finiteCount(row.metricValues && row.metricValues[1] && row.metricValues[1].value)
        };
    });
    return result;
}

function visitorTypeMap(report) {
    const result = { new: 0, returning: 0 };
    ((report && report.rows) || []).forEach((row) => {
        const type = String(row.dimensionValues && row.dimensionValues[0] && row.dimensionValues[0].value || "").toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(result, type)) return;
        result[type] = finiteCount(row.metricValues && row.metricValues[0] && row.metricValues[0].value);
    });
    return result;
}

function audienceRequest(startDate, endDate) {
    return {
        dateRanges: [{ startDate, endDate }],
        metrics: ["totalUsers", "activeUsers", "sessions"]
            .map(name => ({ name })),
        // This GA property can contain automatic page_view events and admin
        // traffic. Restrict identity/session totals to sessions that actually
        // emitted one of the Bark app's explicit analytics events.
        dimensionFilter: {
            filter: {
                fieldName: "eventName",
                inListFilter: { values: [...TRACKED_EVENTS], caseSensitive: true }
            }
        }
    };
}

function visitorTypeRequest(startDate, endDate) {
    return {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "newVsReturning" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: {
            filter: {
                fieldName: "eventName",
                inListFilter: { values: [...TRACKED_EVENTS], caseSensitive: true }
            }
        },
        limit: "10"
    };
}

function eventRequest(startDate, endDate) {
    return {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: {
            filter: {
                fieldName: "eventName",
                inListFilter: { values: [...TRACKED_EVENTS], caseSensitive: true }
            }
        },
        limit: "10"
    };
}

function combineReports(audienceReport, eventsReport, visitorTypesReport) {
    const audience = metricMap(audienceReport);
    const events = eventMap(eventsReport);
    const visitorTypes = visitorTypeMap(visitorTypesReport);
    return {
        totalUsers: audience.totalUsers || 0,
        activeUsers: audience.activeUsers || 0,
        newUsers: visitorTypes.new || 0,
        returningUsers: visitorTypes.returning || 0,
        sessions: audience.sessions || 0,
        appOpens: events.bark_app_opened.events,
        appOpenUsers: events.bark_app_opened.users,
        screenViews: events.bark_screen_view.events,
        screenViewUsers: events.bark_screen_view.users
    };
}

async function fetchGa4VisitorStats(startDate, endDate, options = {}) {
    if (process.env.NODE_ENV === "test" && typeof options.gaRunReport !== "function") return null;
    const propertyId = getGa4PropertyId(options);
    if (!propertyId) return null;

    // The first scheduled report can cover a day before tracking existed.
    // Return an explicit zero rather than sending an invalid all-time range to
    // GA4 or making the independent GoatCounter report look unavailable.
    if (String(endDate) < GA4_TRACKING_START_DATE) {
        return {
            propertyId,
            trackingStartDate: GA4_TRACKING_START_DATE,
            period: emptyStats(),
            previousPeriod: null,
            allTime: emptyStats()
        };
    }

    const trackedPeriodStart = String(startDate) < GA4_TRACKING_START_DATE
        ? GA4_TRACKING_START_DATE
        : startDate;
    const periodDays = inclusiveDayCount(startDate, endDate);
    const previousEndDate = shiftDateKey(startDate, -1);
    const previousStartDate = shiftDateKey(previousEndDate, -(periodDays - 1));
    // Never compare a full period with a truncated pre-tracking fragment; that
    // would make early weekly growth look much larger than it really is.
    const comparisonAvailable = previousStartDate >= GA4_TRACKING_START_DATE;
    const trackedPreviousStart = previousStartDate < GA4_TRACKING_START_DATE
        ? GA4_TRACKING_START_DATE
        : previousStartDate;

    try {
        const requests = [
            runReport(propertyId, audienceRequest(trackedPeriodStart, endDate), options),
            runReport(propertyId, eventRequest(trackedPeriodStart, endDate), options),
            runReport(propertyId, visitorTypeRequest(trackedPeriodStart, endDate), options),
            runReport(propertyId, audienceRequest(GA4_TRACKING_START_DATE, endDate), options),
            runReport(propertyId, eventRequest(GA4_TRACKING_START_DATE, endDate), options),
            runReport(propertyId, visitorTypeRequest(GA4_TRACKING_START_DATE, endDate), options)
        ];
        if (comparisonAvailable) {
            requests.push(
                runReport(propertyId, audienceRequest(trackedPreviousStart, previousEndDate), options),
                runReport(propertyId, eventRequest(trackedPreviousStart, previousEndDate), options),
                runReport(propertyId, visitorTypeRequest(trackedPreviousStart, previousEndDate), options)
            );
        }
        const [
            periodAudience,
            periodEvents,
            periodVisitorTypes,
            allTimeAudience,
            allTimeEvents,
            allTimeVisitorTypes,
            previousAudience,
            previousEvents,
            previousVisitorTypes
        ] = await Promise.all(requests);
        return {
            propertyId,
            trackingStartDate: GA4_TRACKING_START_DATE,
            period: combineReports(periodAudience, periodEvents, periodVisitorTypes),
            previousPeriod: comparisonAvailable
                ? combineReports(previousAudience, previousEvents, previousVisitorTypes)
                : null,
            previousPeriodDates: comparisonAvailable ? {
                startDate: trackedPreviousStart,
                endDate: previousEndDate
            } : null,
            allTime: combineReports(allTimeAudience, allTimeEvents, allTimeVisitorTypes)
        };
    } catch (error) {
        console.error("[metrics] GA4 visitor metrics unavailable.", {
            message: error && error.message ? error.message : String(error),
            status: error && error.response && error.response.status
        });
        return null;
    }
}

module.exports = {
    DEFAULT_GA4_PROPERTY_ID,
    GA4_PROPERTY_ENV,
    GA4_TRACKING_START_DATE,
    TRACKED_EVENTS,
    emptyStats,
    shiftDateKey,
    inclusiveDayCount,
    finiteCount,
    getGa4PropertyId,
    metricMap,
    eventMap,
    visitorTypeMap,
    audienceRequest,
    eventRequest,
    visitorTypeRequest,
    combineReports,
    fetchGa4VisitorStats
};
