/**
 * tripRouteBatch.js — Bounded ORS batching and response-to-day splitting.
 *
 * Route planning decides the points. This module only groups consecutive days
 * into safe requests and maps the returned road geometry back to day colors.
 */
(function initTripRouteBatch(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.BARK = root.BARK || {};
        root.BARK.tripRouteBatch = api;
    }
})(typeof window !== 'undefined' ? window : null, function createTripRouteBatchApi() {
    const DEFAULT_MAX_POINTS = 40;
    const DEFAULT_MAX_ESTIMATED_KM = 4500;

    function radians(degrees) {
        return degrees * Math.PI / 180;
    }

    function distanceKm(first, second) {
        const earthRadiusKm = 6371;
        const deltaLat = radians(second.lat - first.lat);
        const deltaLng = radians(second.lng - first.lng);
        const lat1 = radians(first.lat);
        const lat2 = radians(second.lat);
        const value = Math.sin(deltaLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
        return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    }

    function estimatePointsDistanceKm(points) {
        let total = 0;
        for (let index = 1; index < points.length; index += 1) {
            total += distanceKm(points[index - 1], points[index]);
        }
        return total * 1.25;
    }

    function appendDay(batch, routeDay) {
        const points = routeDay.points || [];
        let waypointStartIndex = batch.points.length;

        if (batch.points.length > 0 && points.length > 0) {
            const previous = batch.points[batch.points.length - 1];
            const first = points[0];
            if (previous.lat === first.lat && previous.lng === first.lng) {
                waypointStartIndex = batch.points.length - 1;
                batch.points.push(...points.slice(1));
            } else {
                batch.points.push(...points);
            }
        } else {
            batch.points.push(...points);
            waypointStartIndex = 0;
        }

        const waypointEndIndex = batch.points.length - 1;
        batch.days.push({
            day: routeDay.day,
            dayIndex: routeDay.dayIndex,
            color: routeDay.color,
            routeSegments: routeDay.segments,
            waypointStartIndex,
            waypointEndIndex
        });
        batch.estimatedDistanceKm = estimatePointsDistanceKm(batch.points);
    }

    function newBatch() {
        return { points: [], days: [], estimatedDistanceKm: 0 };
    }

    function projectedPoints(batch, routeDay) {
        if (batch.points.length === 0) return [...routeDay.points];
        const projected = [...batch.points];
        const first = routeDay.points[0];
        const previous = projected[projected.length - 1];
        projected.push(...(
            first && previous && first.lat === previous.lat && first.lng === previous.lng
                ? routeDay.points.slice(1)
                : routeDay.points
        ));
        return projected;
    }

    function buildRouteBatches(routeDays, options = {}) {
        const maxPoints = Math.max(2, Number(options.maxPoints) || DEFAULT_MAX_POINTS);
        const maxEstimatedDistanceKm = Math.max(1, Number(options.maxEstimatedDistanceKm) || DEFAULT_MAX_ESTIMATED_KM);
        const batches = [];
        let batch = newBatch();

        (Array.isArray(routeDays) ? routeDays : []).forEach(routeDay => {
            if (!routeDay || !routeDay.routable || !Array.isArray(routeDay.points)) return;
            if (routeDay.points.length > maxPoints) {
                throw new Error(`Day ${routeDay.dayIndex + 1} has too many route points. Move some stops to another day.`);
            }
            const projected = projectedPoints(batch, routeDay);
            const exceedsPointLimit = batch.days.length > 0 && projected.length > maxPoints;
            const exceedsDistanceLimit = batch.days.length > 0 && estimatePointsDistanceKm(projected) > maxEstimatedDistanceKm;

            if (exceedsPointLimit || exceedsDistanceLimit) {
                batches.push(batch);
                batch = newBatch();
            }
            appendDay(batch, routeDay);
        });

        if (batch.days.length > 0) batches.push(batch);
        return batches.map((entry, batchIndex) => ({ ...entry, batchIndex }));
    }

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

    function makeFeatureCollection(feature, coordinates, segments, summary) {
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'LineString', coordinates },
                properties: {
                    segments,
                    summary
                }
            }]
        };
    }

    function splitRouteBatchResponse(batch, geoJSONData) {
        const feature = geoJSONData && Array.isArray(geoJSONData.features) ? geoJSONData.features[0] : null;
        const geometry = feature && feature.geometry;
        const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
        if (!feature || !coordinates || coordinates.length < 2) {
            throw new Error('Routing service returned invalid geometry.');
        }

        const segments = feature.properties && Array.isArray(feature.properties.segments)
            ? feature.properties.segments
            : [];
        if (segments.length !== batch.points.length - 1) {
            throw new Error('Routing service returned an unexpected segment count.');
        }

        return batch.days.map(daySpec => {
            const daySegments = segments.slice(daySpec.waypointStartIndex, daySpec.waypointEndIndex);
            const firstRange = getSegmentGeometryRange(daySegments[0]);
            const lastRange = getSegmentGeometryRange(daySegments[daySegments.length - 1]);
            if (!firstRange || !lastRange || lastRange.end >= coordinates.length) {
                throw new Error(`Routing service could not map Day ${daySpec.dayIndex + 1} geometry.`);
            }

            const summary = daySegments.reduce((result, segment) => ({
                distance: result.distance + (Number(segment.distance) || 0),
                duration: result.duration + (Number(segment.duration) || 0)
            }), { distance: 0, duration: 0 });
            if (lastRange.end - firstRange.start < 1) {
                throw new Error(`Routing service returned too little geometry for Day ${daySpec.dayIndex + 1}.`);
            }

            const routeSegments = Array.isArray(daySpec.routeSegments) ? daySpec.routeSegments : [];
            if (routeSegments.length !== daySegments.length) {
                throw new Error(`Routing service could not match Day ${daySpec.dayIndex + 1} route segments.`);
            }

            const segmentRoutes = daySegments.map((segment, segmentIndex) => {
                const range = getSegmentGeometryRange(segment);
                if (!range || range.end >= coordinates.length) {
                    throw new Error(`Routing service could not map a Day ${daySpec.dayIndex + 1} segment.`);
                }
                const segmentCoordinates = coordinates.slice(range.start, range.end + 1);
                if (segmentCoordinates.length < 2) {
                    throw new Error(`Routing service returned too little segment geometry for Day ${daySpec.dayIndex + 1}.`);
                }
                const segmentSummary = {
                    distance: Number(segment.distance) || 0,
                    duration: Number(segment.duration) || 0
                };
                return {
                    key: routeSegments[segmentIndex].key,
                    geoJSON: makeFeatureCollection(feature, segmentCoordinates, [segment], segmentSummary),
                    summary: segmentSummary
                };
            });

            return {
                dayIndex: daySpec.dayIndex,
                color: daySpec.color,
                segmentRoutes,
                summary
            };
        });
    }

    return {
        DEFAULT_MAX_ESTIMATED_KM,
        DEFAULT_MAX_POINTS,
        buildRouteBatches,
        estimatePointsDistanceKm,
        splitRouteBatchResponse
    };
});
