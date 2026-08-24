"use strict";

// Route geometry is displayed as a five-pixel overview line, not used for
// turn-by-turn navigation. Keeping points that are less than this path distance
// apart adds memory and paint work without changing the visible road shape.
const DEFAULT_MIN_POINT_SPACING_METERS = 10;
const METERS_PER_DEGREE_LATITUDE = 111_320;

function getSegmentGeometryRange(segment) {
    if (segment && Array.isArray(segment.way_points)) {
        const start = Number(segment.way_points[0]);
        const end = Number(segment.way_points[1]);
        if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start) {
            return { start, end };
        }
    }

    const steps = segment && Array.isArray(segment.steps) ? segment.steps : [];
    const firstStep = steps[0];
    const lastStep = steps[steps.length - 1];
    const start = firstStep && Array.isArray(firstStep.way_points) ? Number(firstStep.way_points[0]) : NaN;
    const end = lastStep && Array.isArray(lastStep.way_points) ? Number(lastStep.way_points[1]) : NaN;
    return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
        ? { start, end }
        : null;
}

function coordinateDistanceSquaredMeters(first, second) {
    const latitude = ((Number(first[1]) || 0) + (Number(second[1]) || 0)) * Math.PI / 360;
    const x = (Number(second[0]) - Number(first[0])) * METERS_PER_DEGREE_LATITUDE * Math.cos(latitude);
    const y = (Number(second[1]) - Number(first[1])) * METERS_PER_DEGREE_LATITUDE;
    return x * x + y * y;
}

function appendSimplifiedRange(target, coordinates, start, end, minSpacingMeters) {
    const startCoordinate = coordinates[start];
    const endCoordinate = coordinates[end];
    if (!Array.isArray(startCoordinate) || !Array.isArray(endCoordinate)) {
        throw new Error("Route geometry contains an invalid coordinate.");
    }

    if (target.length === 0 || target[target.length - 1] !== startCoordinate) {
        target.push(startCoordinate);
    }
    const outputStart = target.length - 1;

    const minimumDistanceSquared = minSpacingMeters * minSpacingMeters;
    let lastKept = startCoordinate;
    for (let index = start + 1; index < end; index += 1) {
        const coordinate = coordinates[index];
        if (!Array.isArray(coordinate)) continue;
        if (coordinateDistanceSquaredMeters(lastKept, coordinate) < minimumDistanceSquared) continue;
        target.push(coordinate);
        lastKept = coordinate;
    }

    if (target[target.length - 1] !== endCoordinate) target.push(endCoordinate);
    return { start: outputStart, end: target.length - 1 };
}

function compactRouteResponse(routeResponse, options = {}) {
    const feature = routeResponse && Array.isArray(routeResponse.features)
        ? routeResponse.features[0]
        : null;
    const coordinates = feature && feature.geometry && Array.isArray(feature.geometry.coordinates)
        ? feature.geometry.coordinates
        : null;
    const segments = feature && feature.properties && Array.isArray(feature.properties.segments)
        ? feature.properties.segments
        : null;

    if (!feature || !coordinates || coordinates.length < 2 || !segments || segments.length < 1) {
        throw new Error("Routing service returned geometry that cannot be compacted.");
    }

    const minSpacingMeters = Math.max(
        0,
        Number(options.minPointSpacingMeters ?? DEFAULT_MIN_POINT_SPACING_METERS) || 0
    );
    const compactCoordinates = [];
    const compactSegments = segments.map(segment => {
        const range = getSegmentGeometryRange(segment);
        if (!range || range.end >= coordinates.length) {
            throw new Error("Routing service returned an invalid segment geometry range.");
        }
        const compactRange = appendSimplifiedRange(
            compactCoordinates,
            coordinates,
            range.start,
            range.end,
            minSpacingMeters
        );
        return {
            distance: Number(segment.distance) || 0,
            duration: Number(segment.duration) || 0,
            way_points: [compactRange.start, compactRange.end]
        };
    });

    return {
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: compactCoordinates
            },
            properties: {
                summary: {
                    distance: Number(feature.properties.summary && feature.properties.summary.distance) || 0,
                    duration: Number(feature.properties.summary && feature.properties.summary.duration) || 0
                },
                segments: compactSegments
            }
        }]
    };
}

module.exports = {
    DEFAULT_MIN_POINT_SPACING_METERS,
    compactRouteResponse,
    getSegmentGeometryRange
};
