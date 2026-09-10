#!/usr/bin/env node
"use strict";
// Local fixtures only. No Firebase, spreadsheet reads, credentials or production writes.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { encodeSnapshot, sha256 } = require("../../01-code/functions/catalog/catalogSchema");
const root = path.resolve(__dirname, "../..");
const baseBytes = fs.readFileSync(path.join(root, "01-code/ios/BarkRanger/Resources/catalog.json"));
const base = JSON.parse(baseBytes);
const baseManifest = JSON.parse(fs.readFileSync(path.join(root, "01-code/ios/BarkRanger/Resources/catalog-manifest.json")));
const scenarios = ["unchanged", "valid", "malformed", "shrunk", "hash-mismatch", "stalled", "slow", "recovery", "large", "throttled"];
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const host = option("--host", "127.0.0.1"), port = Number(option("--port", "8787"));
let active = option("--scenario", "unchanged");
if (!scenarios.includes(active)) throw new Error("Unknown scenario");
let generation = 0;
const requests = {};
function fixture(scenario) {
    if (scenario === "unchanged" || scenario === "throttled") return { bytes: baseBytes, manifest: baseManifest };
    let parks = structuredClone(base.parks);
    const revision = base.revision + 1000 + generation;
    parks[0].info = "LOCAL TEST UPDATE: the fixture catalog refreshed successfully.\n\n" + parks[0].info;
    if (scenario === "large") {
        parks = parks.concat(Array.from({ length: 5000 - parks.length }, (_, i) => ({ ...parks[i % parks.length], id: `fixture-${i}`, siteID: `fixture-site-${i}`, name: `Synthetic Park ${i}`,
            coordinate: { latitude: (i % 160) - 80, longitude: ((i * 13) % 360) - 180 }, info: "Synthetic performance fixture.", websites: [], pictures: [], videos: [], aliases: [] })));
    }
    const result = encodeSnapshot(parks, { revision, publishedAt: base.publishedAt });
    if (scenario === "shrunk") {
        result.snapshot.parks = parks.slice(0, 300);
        result.bytes = Buffer.from(JSON.stringify(result.snapshot)); result.manifest.count = 300;
        result.manifest.bytes = result.bytes.length; result.manifest.sha256 = sha256(result.bytes);
        result.manifest.path = `revisions/${revision}-${result.manifest.sha256}.json`;
    }
    if (scenario === "malformed") result.bytes = Buffer.from("<html>Sign in to this network</html>");
    if (scenario === "hash-mismatch") result.bytes = Buffer.from(result.bytes.toString().replace("LOCAL TEST UPDATE", "WRONG TEST VALUE"));
    return result;
}
let fixtures = new Map(scenarios.map(name => [name, fixture(name)]));
const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__scenario" && req.method === "POST") {
        const selected = url.searchParams.get("name");
        if (!scenarios.includes(selected)) { res.writeHead(400); return res.end("unknown scenario"); }
        active = selected; generation += 1; fixtures = new Map(scenarios.map(name => [name, fixture(name)]));
        res.writeHead(200); return res.end(active);
    }
    if (url.pathname === "/__stats") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(requests)); }
    const parts = url.pathname.split("/").filter(Boolean);
    const scenario = parts[0] === "active" ? active : parts[0];
    if (!fixtures.has(scenario)) { res.writeHead(404); return res.end(); }
    const relative = parts.slice(1).join("/");
    const result = fixtures.get(scenario);
    requests[`${scenario}/${relative}`] = (requests[`${scenario}/${relative}`] || 0) + 1;
    if (scenario === "throttled") { res.writeHead(429, { "Retry-After": "60" }); return res.end(); }
    const manifest = relative === "manifest.json";
    if (!manifest && relative !== result.manifest.path) { res.writeHead(404); return res.end(); }
    const etag = `"${result.manifest.sha256}"`;
    if (manifest && req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    const bytes = manifest ? Buffer.from(JSON.stringify(result.manifest)) : result.bytes;
    const send = () => {
        if (res.destroyed) return;
        res.writeHead(200, { "Content-Type": "application/json", ETag: etag, "Cache-Control": "no-store", "Content-Length": bytes.length });
        if (scenario === "stalled" && !manifest) { res.write(bytes.subarray(0, 20)); return; }
        res.end(bytes);
    };
    if (scenario === "slow" && !manifest) { const timer = setTimeout(send, 4500); res.on("close", () => clearTimeout(timer)); }
    else send();
});
server.listen(port, host, () => console.log(`Local catalog: http://${host}:${port}/active/manifest.json (${active}). Stop with Ctrl-C.`));
process.on("SIGTERM", () => server.close());
