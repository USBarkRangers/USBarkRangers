/**
 * geoUtils.js - Shared geospatial and point math helpers.
 * Loaded before state so legacy window.BARK utility names stay available.
 */
window.BARK = window.BARK || {};

function generatePinId(lat, lng) {
    return `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const r = 6371; // km
    const p = Math.PI / 180;
    const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
        Math.cos(lat1 * p) * Math.cos(lat2 * p) *
        (1 - Math.cos((lon2 - lon1) * p)) / 2;
    return 2 * r * Math.asin(Math.sqrt(a));
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
