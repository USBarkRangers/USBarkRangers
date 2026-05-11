const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const shouldActivate = process.env.BARK_ORS_EMULATOR_STUB === "1" && (
    process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.FUNCTION_TARGET ||
    path.basename(process.cwd()) === "functions"
);

const LOG_PATH = process.env.BARK_ORS_EMULATOR_STUB_LOG ||
    path.join(os.tmpdir(), "bark-ranger-ors-emulator-stub.jsonl");
const MARKER_PATH = process.env.BARK_ORS_EMULATOR_STUB_MARKER ||
    path.join(os.tmpdir(), "bark-ranger-ors-emulator-stub-active.json");

function appendLog(entry) {
    fs.appendFileSync(LOG_PATH, `${JSON.stringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        ...entry
    })}\n`);
}

function isLocalHost(host) {
    const value = String(host || "").toLowerCase();
    return value.startsWith("localhost") ||
        value.startsWith("127.0.0.1") ||
        value.startsWith("0.0.0.0") ||
        value.startsWith("[::1]") ||
        value.startsWith("::1");
}

if (shouldActivate) {
    const nock = require("nock");
    const ORS_ORIGIN = "https://api.openrouteservice.org";

    fs.writeFileSync(MARKER_PATH, JSON.stringify({
        activatedAt: new Date().toISOString(),
        cwd: process.cwd(),
        pid: process.pid,
        functionsEmulator: process.env.FUNCTIONS_EMULATOR || null,
        functionTarget: process.env.FUNCTION_TARGET || null
    }, null, 2));

    nock.disableNetConnect();
    nock.enableNetConnect(isLocalHost);

    nock.emitter.on("no match", (request) => {
        const host = request && request.options && request.options.host;
        if (!isLocalHost(host)) {
            appendLog({
                service: "unmatched-network",
                method: request && request.method,
                host,
                path: request && request.path
            });
        }
    });

    nock(ORS_ORIGIN)
        .persist()
        .post("/v2/snap/driving-car/json")
        .reply(function snapReply(uri, requestBody) {
            appendLog({
                service: "snap",
                method: "POST",
                uri,
                body: requestBody
            });

            const locations = Array.isArray(requestBody.locations)
                ? requestBody.locations.map(location => ({ location, snapped_distance: 0 }))
                : [];

            return [200, { locations }];
        });

    nock(ORS_ORIGIN)
        .persist()
        .post("/v2/directions/driving-car/geojson")
        .reply(function routeReply(uri, requestBody) {
            appendLog({
                service: "route",
                method: "POST",
                uri,
                body: requestBody
            });

            return [200, {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    properties: {
                        summary: {
                            distance: 1234,
                            duration: 567
                        },
                        stubbed: true
                    },
                    geometry: {
                        type: "LineString",
                        coordinates: [[-122.4, 37.8], [-122.5, 37.9]]
                    }
                }]
            }];
        });

    nock(ORS_ORIGIN)
        .persist()
        .get("/geocode/search")
        .query(true)
        .reply(function geocodeReply(uri) {
            appendLog({
                service: "geocode",
                method: "GET",
                uri
            });

            return [200, {
                geocoding: {
                    version: "0.2",
                    attribution: "ORS emulator stub"
                },
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [-122.3321, 47.6062]
                    },
                    properties: {
                        label: "Stubbed Seattle",
                        name: "Seattle",
                        country: "United States",
                        stubbed: true
                    }
                }]
            }];
        });
}
