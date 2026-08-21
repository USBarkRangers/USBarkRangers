/**
 * Canonical HeiGIT endpoints used by the OpenRouteService transport layer.
 *
 * Keeping these URLs together prevents route generation, snap recovery, and
 * geocoding from drifting onto different provider hosts during migrations.
 */
const HEIGIT_API_ORIGIN = "https://api.heigit.org";

const ORS_ENDPOINTS = Object.freeze({
    directions: `${HEIGIT_API_ORIGIN}/openrouteservice/v2/directions/driving-car/geojson`,
    snap: `${HEIGIT_API_ORIGIN}/openrouteservice/v2/snap/driving-car/json`,
    geocode: `${HEIGIT_API_ORIGIN}/pelias/v1/search`
});

module.exports = {
    HEIGIT_API_ORIGIN,
    ORS_ENDPOINTS
};
