/**
 * geoUtils.js - Shared geospatial and point math helpers.
 * Loaded before state so legacy window.BARK utility names stay available.
 */
window.BARK = window.BARK || {};

function generatePinId(lat, lng) {
    return `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
}

const EARTH_RADIUS_METERS = 6371e3;

/**
 * Great-circle distance in metres. The sin² form rather than the `0.5 - cos/2`
 * one because the walk tracker measures steps of a few metres, where subtracting
 * two nearly-equal cosines throws away most of the significant digits.
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
    const p = Math.PI / 180;
    const phi1 = lat1 * p, phi2 = lat2 * p;
    const dPhi = (lat2 - lat1) * p, dLambda = (lon2 - lon1) * p;
    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    return distanceMeters(lat1, lon1, lat2, lon2) / 1000;
}

/**
 * FLOAT PRECISION GUARD
 */
function sanitizeWalkPoints(raw) {
    return Math.floor(Math.round((raw || 0) * 100) / 100);
}

window.BARK.generatePinId = generatePinId;
window.BARK.haversineDistance = haversineDistance;
window.BARK.sanitizeWalkPoints = sanitizeWalkPoints;

window.BARK.utils = window.BARK.utils || {};
window.BARK.utils.geo = window.BARK.utils.geo || {};
window.BARK.utils.geo.haversine = haversineDistance;
window.BARK.utils.geo.distanceMeters = distanceMeters;
