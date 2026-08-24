"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
    compactRouteResponse,
    DEFAULT_MIN_POINT_SPACING_METERS
} = require("../routeResponseCompact.js");

function makeDenseRoute(pointCount = 1000) {
    const coordinates = Array.from({ length: pointCount }, (_, index) => [
        -100 + index * 0.00002,
        40 + Math.sin(index / 40) * 0.00001
    ]);
    const middle = Math.floor((pointCount - 1) / 2);
    const makeSteps = (start, end) => Array.from({ length: 40 }, (_, index) => ({
        instruction: `Instruction ${index} with deliberately retained source text`,
        name: `Road ${index}`,
        way_points: [
            Math.round(start + (end - start) * index / 40),
            Math.round(start + (end - start) * (index + 1) / 40)
        ]
    }));

    return {
        type: "FeatureCollection",
        bbox: [-100, 40, -99, 41],
        metadata: { large: "not needed by the map".repeat(100) },
        features: [{
            type: "Feature",
            geometry: { type: "LineString", coordinates },
            properties: {
                summary: { distance: 123456, duration: 7890 },
                segments: [
                    { distance: 60000, duration: 3800, steps: makeSteps(0, middle) },
                    { distance: 63456, duration: 4090, steps: makeSteps(middle, pointCount - 1) }
                ]
            }
        }]
    };
}

test("compacts dense route geometry and strips unused instructions", () => {
    const source = makeDenseRoute();
    const compact = compactRouteResponse(source);
    const feature = compact.features[0];

    assert.ok(feature.geometry.coordinates.length < source.features[0].geometry.coordinates.length / 3);
    assert.deepEqual(feature.geometry.coordinates[0], source.features[0].geometry.coordinates[0]);
    assert.deepEqual(
        feature.geometry.coordinates.at(-1),
        source.features[0].geometry.coordinates.at(-1)
    );
    assert.deepEqual(feature.properties.summary, { distance: 123456, duration: 7890 });
    assert.deepEqual(
        feature.properties.segments.map(segment => Object.keys(segment).sort()),
        [
            ["distance", "duration", "way_points"],
            ["distance", "duration", "way_points"]
        ]
    );
    assert.equal(feature.properties.segments[0].way_points[1], feature.properties.segments[1].way_points[0]);
    assert.ok(JSON.stringify(compact).length < JSON.stringify(source).length / 3);
});

test("zero spacing preserves every point while still producing compact segment metadata", () => {
    const source = makeDenseRoute(20);
    const compact = compactRouteResponse(source, { minPointSpacingMeters: 0 });

    assert.equal(compact.features[0].geometry.coordinates.length, 20);
    assert.equal(DEFAULT_MIN_POINT_SPACING_METERS, 10);
    assert.equal(compact.features[0].properties.segments[0].steps, undefined);
});

test("rejects malformed geometry instead of returning a corrupt route", () => {
    assert.throws(
        () => compactRouteResponse({ type: "FeatureCollection", features: [] }),
        /cannot be compacted/
    );
});
