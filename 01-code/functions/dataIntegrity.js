"use strict";

// Published spreadsheet integrity checks. This deliberately mirrors the two
// independent client counts: map pins are canonical Park ID rows, while Awards
// collapses records that describe the same named physical location. Clean data
// makes both totals equal. The checker performs no Firestore reads or writes.

const axios = require("axios");
const Papa = require("papaparse");

const DEFAULT_PARK_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRMM2ZRU5lmT-ncrsil4W3qhrbo8NBxnQ-xC877TNkhLYOpTlnCocYA9gNg-dPRyaQr_8e0CWZ0WB2F/pub?output=csv";
const FETCH_TIMEOUT_MS = 10000;
const SAMPLE_LIMIT = 5;

function clean(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function getValue(row, wanted) {
    if (!row || typeof row !== "object") return "";
    const wantedKey = clean(wanted).toLowerCase();
    const key = Object.keys(row).find((candidate) => clean(candidate).toLowerCase() === wantedKey);
    return key ? clean(row[key]) : "";
}

function isLegacyParkId(id) {
    return /^-?\d+\.\d{2}_-?\d+\.\d{2}$/.test(clean(id));
}

function isCanonicalParkId(id) {
    const value = clean(id);
    return Boolean(value && value.toLowerCase() !== "unknown" && !isLegacyParkId(value));
}

function normalizeSiteName(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function coordinateKey(lat, lng) {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return "";
    return `${parsedLat.toFixed(5)},${parsedLng.toFixed(5)}`;
}

function analyzePublishedParkCsv(csvText) {
    const parsed = Papa.parse(String(csvText || ""), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: clean,
        transform: clean
    });

    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const seenIds = new Set();
    const siteRows = new Map();
    const missingCoordinates = [];
    const invalidCoordinates = [];
    const invalidParkIds = [];
    const duplicateParkIds = [];
    let validMapRows = 0;

    rows.forEach((row, index) => {
        const sheetRow = index + 2;
        const id = getValue(row, "Park ID");
        const name = getValue(row, "Location");
        const lat = getValue(row, "lat");
        const lng = getValue(row, "lng");
        const sample = { sheetRow, id: id || null, name: name || "(unnamed)" };

        if (!lat || !lng) {
            if (missingCoordinates.length < SAMPLE_LIMIT) missingCoordinates.push(sample);
            return;
        }
        if (!coordinateKey(lat, lng)) {
            if (invalidCoordinates.length < SAMPLE_LIMIT) invalidCoordinates.push(sample);
            return;
        }
        if (!isCanonicalParkId(id)) {
            if (invalidParkIds.length < SAMPLE_LIMIT) invalidParkIds.push(sample);
            return;
        }
        if (seenIds.has(id)) {
            if (duplicateParkIds.length < SAMPLE_LIMIT) duplicateParkIds.push(sample);
            return;
        }

        seenIds.add(id);
        validMapRows += 1;
        const siteKey = `${normalizeSiteName(name)}|${coordinateKey(lat, lng)}`;
        const grouped = siteRows.get(siteKey) || [];
        grouped.push({ ...sample, lat: Number(lat), lng: Number(lng) });
        siteRows.set(siteKey, grouped);
    });

    const duplicatePhysicalSites = Array.from(siteRows.values())
        .filter((group) => group.length > 1)
        .slice(0, SAMPLE_LIMIT);
    const uniqueAwardSites = siteRows.size;
    const spreadsheetRows = rows.length;
    const parseErrors = (parsed.errors || []).slice(0, SAMPLE_LIMIT).map((error) => ({
        row: Number.isFinite(error.row) ? error.row + 2 : null,
        code: clean(error.code),
        message: clean(error.message)
    }));

    const issueCodes = [];
    if (parseErrors.length) issueCodes.push("csv_parse_error");
    if (missingCoordinates.length) issueCodes.push("missing_coordinates");
    if (invalidCoordinates.length) issueCodes.push("invalid_coordinates");
    if (invalidParkIds.length) issueCodes.push("invalid_park_id");
    if (duplicateParkIds.length) issueCodes.push("duplicate_park_id");
    if (duplicatePhysicalSites.length) issueCodes.push("duplicate_physical_site");
    if (spreadsheetRows !== validMapRows) issueCodes.push("spreadsheet_map_total_mismatch");
    if (validMapRows !== uniqueAwardSites) issueCodes.push("map_awards_total_mismatch");

    return {
        ok: issueCodes.length === 0,
        checkedAt: new Date().toISOString(),
        spreadsheetRows,
        validMapRows,
        uniqueParkIds: seenIds.size,
        uniqueAwardSites,
        issueCodes,
        samples: {
            parseErrors,
            missingCoordinates,
            invalidCoordinates,
            invalidParkIds,
            duplicateParkIds,
            duplicatePhysicalSites
        }
    };
}

async function fetchParkDataIntegrity(options = {}) {
    const get = options.httpGet || axios.get;
    const url = options.csvUrl || DEFAULT_PARK_CSV_URL;
    try {
        const response = await get(url, {
            timeout: FETCH_TIMEOUT_MS,
            responseType: "text",
            headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
            params: { monitor: Date.now() }
        });
        const result = analyzePublishedParkCsv(response && response.data);
        return { ...result, available: true };
    } catch (error) {
        console.error("[data-integrity] published spreadsheet check failed:", error && error.message);
        return {
            available: false,
            ok: false,
            checkedAt: new Date().toISOString(),
            error: clean(error && error.message) || "Spreadsheet check unavailable"
        };
    }
}

function formatDuplicateSites(groups) {
    return (groups || []).map((group) => {
        const first = group[0] || {};
        const rows = group.map((item) => item.sheetRow).filter(Boolean).join(", ");
        return `${first.name || "(unnamed)"} — spreadsheet rows ${rows}`;
    }).join("\n");
}

function buildParkDataAlertMessage(result) {
    if (!result || result.available === false) {
        return {
            channel: "systemStatus",
            tier: "important",
            title: "Park data check could not run",
            description: clean(result && result.error) || "The published spreadsheet could not be downloaded or parsed.",
            fields: [
                { name: "Expected source", value: "Published BARK Master List CSV" },
                { name: "Customer impact", value: "Unknown until the next successful check" }
            ],
            footer: "Noncritical data integrity alert · no customer data changed"
        };
    }
    const duplicateText = formatDuplicateSites(result && result.samples && result.samples.duplicatePhysicalSites);
    return {
        channel: "systemStatus",
        tier: "important",
        title: "Park data totals do not match",
        description: duplicateText || "The published spreadsheet failed one or more map-data integrity checks.",
        fields: [
            { name: "Spreadsheet rows (header excluded)", value: String(result.spreadsheetRows) },
            { name: "Valid map records", value: String(result.validMapRows) },
            { name: "Unique Park IDs", value: String(result.uniqueParkIds) },
            { name: "Unique Awards sites", value: String(result.uniqueAwardSites) },
            { name: "Checks failed", value: (result.issueCodes || []).join(", ") || "unknown" }
        ],
        footer: "Noncritical data integrity alert · no customer data changed"
    };
}

module.exports = {
    analyzePublishedParkCsv,
    fetchParkDataIntegrity,
    buildParkDataAlertMessage,
    isCanonicalParkId,
    coordinateKey,
    normalizeSiteName,
    DEFAULT_PARK_CSV_URL,
    FETCH_TIMEOUT_MS
};
