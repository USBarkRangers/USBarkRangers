#!/usr/bin/env node
"use strict";
// Reproducible conversion of a checked-in snapshot of the approved sheet; no network access.
// The phone's bundle and the native backend's copy are the same bytes and are written together:
// the backend accepts a visit only for a park it knows, so the two must never drift apart.
const fs = require("node:fs");
const path = require("node:path");
const { parseCSV } = require("../../01-code/functions/catalog/sourceSheet");
const { normalizePark, encodeSnapshot, sha256 } = require("../../01-code/functions/catalog/catalogSchema");
const root = path.resolve(__dirname, "../..");
const source = "05-tools/catalog-source/native-catalog-2026-09-19.csv";
const csv = fs.readFileSync(path.join(root, source));
// Later than every catalog published before this snapshot, earlier than the publisher's next
// revision (it uses the publication time), so a fresh install moves forward, never back.
const result = encodeSnapshot(parseCSV(csv.toString("utf8")).map(normalizePark), {
    revision: 1789776000000, publishedAt: "2026-09-19T00:00:00.000Z"
});
const output = path.join(root, "01-code/ios/BarkRanger/Resources");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "catalog.json"), result.bytes);
fs.writeFileSync(path.join(root, "01-code/functions-native/catalog/catalog.json"), result.bytes);
fs.writeFileSync(path.join(output, "catalog-manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n");
fs.writeFileSync(path.join(output, "catalog-provenance.txt"), `Bark Ranger bundled catalog\n${result.manifest.count} records.\nSource: ${source}\nSnapshot of the published approved sheet taken September 19, 2026.\nCSV SHA-256: ${sha256(csv)}\nConversion: node 05-tools/scripts/build-ios-catalog.js\nThe same bytes are written to 01-code/functions-native/catalog/catalog.json.\nThis is a checked-in snapshot, not a verification of the latest live spreadsheet.\nPark information remains subject to change; consult each park before travel.\n`);
console.log(`${result.manifest.count} parks, ${result.bytes.length} bytes, SHA-256 ${result.manifest.sha256}`);
