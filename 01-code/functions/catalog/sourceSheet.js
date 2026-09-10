"use strict";
const Papa = require("papaparse");
const { normalizeHeaders } = require("./catalogSchema");

// CSV is a build/import boundary only. Devices never parse it.
function parseCSV(csv) {
    const result = Papa.parse(csv, { header: true, skipEmptyLines: "greedy" });
    if (result.errors.length) throw new Error("catalog_source_invalid_csv");
    return result.data.map(normalizeHeaders);
}

async function readSourceRows({ sheets, spreadsheetId, range }) {
    if (!spreadsheetId || !range) throw new Error("catalog_source_not_configured");
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range,
        valueRenderOption: "FORMATTED_VALUE" }, { timeout: 15000 });
    const [headers, ...rows] = response.data.values || [];
    if (!headers?.length) throw new Error("catalog_source_empty");
    normalizeHeaders(Object.fromEntries(headers.map(header => [header, ""])));
    if (new Set(headers.map(h => String(h).trim().toLowerCase())).size !== headers.length) throw new Error("catalog_duplicate_headers");
    return rows.filter(row => row.some(value => String(value).trim())).map(row =>
        normalizeHeaders(Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))));
}
module.exports = { parseCSV, readSourceRows };
