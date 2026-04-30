/**
 * orsService.js - OpenRouteService transport boundary.
 *
 * All ORS access goes through Firebase Cloud Functions callables so the
 * paid API key never ships to the browser. The client only authenticates
 * with Firebase; the callable enforces signed-in user and holds the secret.
 *
 * Callables: getPremiumRoute (directions), getPremiumGeocode (geocode).
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    function getCallable(name) {
        if (typeof firebase === 'undefined' || typeof firebase.functions !== 'function') {
            throw new Error('Firebase Functions SDK is not available.');
        }
        return firebase.functions().httpsCallable(name);
    }

    async function geocode(query, options = {}) {
        try {
            const callable = getCallable('getPremiumGeocode');
            const payload = {
                text: query,
                size: options.size || 5
            };
            if (options.country) {
                payload.country = options.country;
            }
            const result = await callable(payload);
            return result.data;
        } catch (error) {
            console.error('ORS geocode request failed.', error);
            throw error;
        }
    }

    async function directions(coordinates, options = {}) {
        try {
            const callable = getCallable('getPremiumRoute');
            const payload = { coordinates };
            if (Array.isArray(options.radiuses) && options.radiuses.length === coordinates.length) {
                payload.radiuses = options.radiuses;
            }
            const result = await callable(payload);
            return result.data;
        } catch (error) {
            console.error('ORS directions request failed.', error);
            throw error;
        }
    }

    window.BARK.services.ors = {
        geocode,
        directions
    };
})();
