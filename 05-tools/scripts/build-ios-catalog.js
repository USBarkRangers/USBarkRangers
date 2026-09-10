#!/usr/bin/env node
"use strict";
// Reproducible conversion of the approved, checked-in web fallback; no network access.
const fs = require("node:fs");
const path = require("node:path");
const { parseCSV } = require("../../01-code/functions/catalog/sourceSheet");
const { normalizePark, encodeSnapshot, sha256 } = require("../../01-code/functions/catalog/catalogSchema");
const root = path.resolve(__dirname, "../..");
const source = "01-code/app/assets/data/bark-fallback-0.142.csv";
const csv = fs.readFileSync(path.join(root, source));
const result = encodeSnapshot(parseCSV(csv.toString("utf8")).map(normalizePark), {
    revision: 1788339349000, publishedAt: "2026-09-02T08:55:49.000Z"
});
const output = path.join(root, "01-code/ios/BarkRanger/Resources");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "catalog.json"), result.bytes);
fs.writeFileSync(path.join(output, "catalog-manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n");
fs.writeFileSync(path.join(output, "catalog-provenance.txt"), `Bark Ranger bundled catalog\n${result.manifest.count} records.\nSource: ${source}\nSource commit: f1bd2a0 (September 2, 2026)\nCSV SHA-256: ${sha256(csv)}\nConversion: node 05-tools/scripts/build-ios-catalog.js\nThis is the approved checked-in fallback, not a verification of the latest live spreadsheet.\nPark information remains subject to change; consult each park before travel.\n`);
console.log(`${result.manifest.count} parks, ${result.bytes.length} bytes, SHA-256 ${result.manifest.sha256}`);
