const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const { __test: { dataIntegrity } } = require("../index.js");

const HEADER = "Location,State,lat,lng,Park ID";

describe("published park data integrity", () => {
    it("passes when spreadsheet, map, Park ID, and Awards totals agree", () => {
        const csv = [
            HEADER,
            "Park One,MD,39.10000,-77.10000,id-one",
            "Park Two,VA,38.20000,-78.20000,id-two"
        ].join("\n");
        const result = dataIntegrity.analyzePublishedParkCsv(csv);

        assert.equal(result.ok, true);
        assert.equal(result.spreadsheetRows, 2);
        assert.equal(result.validMapRows, 2);
        assert.equal(result.uniqueAwardSites, 2);
    });

    it("identifies duplicated Frederick rows and explains the count mismatch", () => {
        const csv = [
            HEADER,
            "Frederick County Parks and Recreation,MD,39.4334124,-77.4366269,frederick-one",
            "Frederick County Parks and Recreation,MD,39.4334124,-77.4366269,frederick-two",
            "Park Two,VA,38.20000,-78.20000,id-two"
        ].join("\n");
        const result = dataIntegrity.analyzePublishedParkCsv(csv);

        assert.equal(result.spreadsheetRows, 3);
        assert.equal(result.validMapRows, 3);
        assert.equal(result.uniqueAwardSites, 2);
        assert.ok(result.issueCodes.includes("duplicate_physical_site"));
        assert.ok(result.issueCodes.includes("map_awards_total_mismatch"));
        assert.equal(result.samples.duplicatePhysicalSites[0][0].sheetRow, 2);
        assert.equal(result.samples.duplicatePhysicalSites[0][1].sheetRow, 3);
        assert.match(dataIntegrity.buildParkDataAlertMessage(result).description, /Frederick County/);
    });

    it("reports malformed rows without changing any data", () => {
        const csv = [
            HEADER,
            "Missing Coordinates,MD,,,missing-coords",
            "Bad Coordinates,VA,nope,-78.2,bad-coords",
            "Legacy ID,VA,38.2,-78.2,38.20_-78.20"
        ].join("\n");
        const result = dataIntegrity.analyzePublishedParkCsv(csv);

        assert.equal(result.validMapRows, 0);
        assert.ok(result.issueCodes.includes("missing_coordinates"));
        assert.ok(result.issueCodes.includes("invalid_coordinates"));
        assert.ok(result.issueCodes.includes("invalid_park_id"));
    });

    it("creates a useful noncritical alert when the spreadsheet cannot be checked", () => {
        const message = dataIntegrity.buildParkDataAlertMessage({
            available: false,
            ok: false,
            error: "request timed out"
        });
        assert.equal(message.tier, "important");
        assert.match(message.title, /could not run/);
        assert.match(message.description, /timed out/);
    });
});
