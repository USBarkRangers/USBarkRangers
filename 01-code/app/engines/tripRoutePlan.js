/**
 * tripRoutePlan.js — Pure itinerary-to-route planning.
 *
 * This module owns every rule about which points belong to a routed day.
 * Consumers may convert the returned points to ORS, Leaflet, or Google Maps
 * formats, but they must not rebuild day-boundary logic themselves.
 */
(function initTripRoutePlan(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.BARK = root.BARK || {};
        root.BARK.tripRoutePlan = api;
        root.BARK.buildTripRoutePlan = api.buildTripRoutePlan;
    }
})(typeof window !== 'undefined' ? window : null, function createTripRoutePlanApi() {
    function finiteCoordinate(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function normalizePoint(node, role = 'stop') {
        if (!node || typeof node !== 'object') return null;
        const lat = finiteCoordinate(node.lat);
        const lng = finiteCoordinate(node.lng);
        if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return null;
        }
        return { node, lat, lng, role };
    }

    function sameLocation(first, second) {
        return Boolean(first && second && first.lat === second.lat && first.lng === second.lng);
    }

    function compactAdjacentPoints(points) {
        return (Array.isArray(points) ? points : []).reduce((result, point) => {
            if (!point || sameLocation(result[result.length - 1], point)) return result;
            result.push(point);
            return result;
        }, []);
    }

    function makeRouteDay(day, dayIndex, points) {
        const compactPoints = compactAdjacentPoints(points);
        return {
            day,
            dayIndex,
            color: day && typeof day.color === 'string' && day.color.trim() ? day.color : '#475569',
            points: compactPoints,
            coordinates: compactPoints.map(point => [point.lng, point.lat]),
            latLngs: compactPoints.map(point => [point.lat, point.lng]),
            routable: compactPoints.length >= 2
        };
    }

    function buildSignature(days) {
        return JSON.stringify((Array.isArray(days) ? days : []).map(routeDay => ({
            dayIndex: routeDay.dayIndex,
            color: routeDay.color,
            points: routeDay.points.map(point => ({
                lat: point.lat,
                lng: point.lng,
                role: point.role,
                id: point.node && (point.node.id || point.node.placeId || point.node.customPlaceId) || '',
                name: point.node && point.node.name || '',
                state: point.node && point.node.state || ''
            }))
        })));
    }

    function buildGeometrySignature(days) {
        return JSON.stringify((Array.isArray(days) ? days : []).map(routeDay => ({
            dayIndex: routeDay.dayIndex,
            points: routeDay.points.map(point => ({
                lat: point.lat,
                lng: point.lng
            }))
        })));
    }

    function buildTripRoutePlan(options = {}) {
        const tripDays = Array.isArray(options.tripDays) ? options.tripDays : [];
        const startPoint = normalizePoint(options.startNode, 'start');
        const endPoint = normalizePoint(options.endNode, 'end');
        const populatedDays = [];

        tripDays.forEach((day, dayIndex) => {
            const stops = Array.isArray(day && day.stops) ? day.stops : [];
            const points = stops.map(stop => normalizePoint(stop, 'stop')).filter(Boolean);
            if (points.length > 0) populatedDays.push({ day, dayIndex, points });
        });

        const routeDays = [];
        let previousEndpoint = null;

        populatedDays.forEach((entry, populatedIndex) => {
            const points = [];
            if (populatedIndex === 0 && startPoint) {
                points.push(startPoint);
            } else if (previousEndpoint) {
                points.push({ ...previousEndpoint, role: 'continuity' });
            }

            points.push(...entry.points);
            previousEndpoint = entry.points[entry.points.length - 1];

            if (populatedIndex === populatedDays.length - 1 && endPoint) points.push(endPoint);
            routeDays.push(makeRouteDay(entry.day, entry.dayIndex, points));
        });

        if (routeDays.length === 0 && startPoint && endPoint) {
            const fallbackDay = tripDays[0] || { color: '#475569', stops: [] };
            routeDays.push(makeRouteDay(fallbackDay, 0, [startPoint, endPoint]));
        }

        const routableDays = routeDays.filter(routeDay => routeDay.routable);
        return {
            days: routeDays,
            routableDays,
            signature: buildSignature(routeDays),
            geometrySignature: buildGeometrySignature(routeDays),
            getDay(dayIndex) {
                return routeDays.find(routeDay => routeDay.dayIndex === dayIndex) || null;
            }
        };
    }

    return {
        buildTripRoutePlan,
        compactAdjacentPoints,
        normalizePoint,
        sameLocation
    };
});
