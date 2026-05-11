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

    function getCurrentUser() {
        try {
            return typeof firebase !== 'undefined' && firebase.auth
                ? firebase.auth().currentUser
                : null;
        } catch (error) {
            return null;
        }
    }

    function isPasswordAuthUser(user) {
        const providerIds = (user && Array.isArray(user.providerData) ? user.providerData : [])
            .map(provider => provider && provider.providerId)
            .filter(Boolean);
        return providerIds.includes('password');
    }

    function assertVerifiedEmailForPremiumCallable() {
        const user = getCurrentUser();
        if (!user || !user.email || !isPasswordAuthUser(user) || user.emailVerified === true) return;
        const error = new Error('Please verify your email before using Premium routing or global town search.');
        error.code = 'email-unverified';
        throw error;
    }

    function isFlagEnabled(flagName) {
        return !window.BARK ||
            typeof window.BARK.isLaunchFlagEnabled !== 'function' ||
            window.BARK.isLaunchFlagEnabled(flagName);
    }

    function makeDisabledError(flagName, fallback) {
        const message = window.BARK && typeof window.BARK.getLaunchFlagMessage === 'function'
            ? window.BARK.getLaunchFlagMessage(flagName, fallback)
            : fallback;
        const error = new Error(message || 'This feature is paused for beta safety.');
        error.code = 'launch-disabled';
        return error;
    }

    async function geocode(query, options = {}) {
        if (!isFlagEnabled('premiumRiskyToolsEnabled')) {
            throw makeDisabledError('premiumRiskyToolsEnabled', 'Premium tools are paused for beta safety.');
        }
        if (!isFlagEnabled('premiumGeocodeEnabled')) {
            throw makeDisabledError('premiumGeocodeEnabled', 'Global town search is paused for beta safety.');
        }
        assertVerifiedEmailForPremiumCallable();

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
        if (!isFlagEnabled('routePlannerEnabled')) {
            throw makeDisabledError('routePlannerEnabled', 'Route planner tools are paused for beta safety.');
        }
        if (!isFlagEnabled('routeGenerationEnabled')) {
            throw makeDisabledError('routeGenerationEnabled', 'Route generation is paused for beta safety.');
        }
        if (!isFlagEnabled('premiumRiskyToolsEnabled')) {
            throw makeDisabledError('premiumRiskyToolsEnabled', 'Premium tools are paused for beta safety.');
        }
        assertVerifiedEmailForPremiumCallable();

        try {
            const callable = getCallable('getPremiumRoute');
            const payload = { coordinates };
            if (Array.isArray(options.radiuses) && options.radiuses.length === coordinates.length) {
                payload.radiuses = options.radiuses;
            }
            if (Array.isArray(options.waypoints) && options.waypoints.length === coordinates.length) {
                payload.waypoints = options.waypoints;
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
