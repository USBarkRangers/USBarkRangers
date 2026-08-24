/**
 * orsRouteCache.js - Small in-memory cache for identical route requests.
 *
 * Route results are safe to reuse within one browser session. Failed requests
 * are never cached, and matching requests already in flight share one promise.
 */
(function initOrsRouteCache(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.BARK = root.BARK || {};
        root.BARK.orsRouteCache = api;
    }
})(typeof window !== 'undefined' ? window : null, function createOrsRouteCacheApi() {
    const DEFAULT_TTL_MS = 15 * 60 * 1000;
    // Keep only a few recent route variants. GeoJSON values can be large on
    // phones; identical in-flight and recently repeated requests still reuse
    // work without retaining an itinerary-editing session's entire history.
    const DEFAULT_MAX_ENTRIES = 4;

    function buildRouteCacheKey(request = {}) {
        return JSON.stringify({
            uid: request.uid || null,
            coordinates: request.coordinates || [],
            radiuses: request.radiuses || [],
            waypoints: (request.waypoints || []).map(waypoint => ({
                id: waypoint && waypoint.id || null,
                name: waypoint && waypoint.name || '',
                state: waypoint && waypoint.state || '',
                lat: waypoint && waypoint.lat,
                lng: waypoint && waypoint.lng,
                country: waypoint && waypoint.country || ''
            }))
        });
    }

    function createRouteCache(options = {}) {
        const ttlMs = Math.max(1, Number(options.ttlMs) || DEFAULT_TTL_MS);
        const maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const entries = new Map();

        function removeExpired() {
            const currentTime = now();
            entries.forEach((entry, key) => {
                if (!entry.promise && entry.expiresAt <= currentTime) entries.delete(key);
            });
        }

        function trim() {
            removeExpired();
            while (entries.size > maxEntries) {
                const oldestKey = entries.keys().next().value;
                entries.delete(oldestKey);
            }
        }

        function getOrLoad(key, loader) {
            removeExpired();
            const existing = entries.get(key);
            if (existing) {
                entries.delete(key);
                entries.set(key, existing);
                return existing.promise || Promise.resolve(existing.value);
            }

            const promise = Promise.resolve().then(loader);
            entries.set(key, { promise, expiresAt: now() + ttlMs });
            trim();

            return promise.then(value => {
                if (entries.get(key) && entries.get(key).promise === promise) {
                    entries.set(key, { value, expiresAt: now() + ttlMs });
                    trim();
                }
                return value;
            }, error => {
                if (entries.get(key) && entries.get(key).promise === promise) entries.delete(key);
                throw error;
            });
        }

        return {
            clear: () => entries.clear(),
            getOrLoad,
            size: () => entries.size
        };
    }

    return {
        DEFAULT_MAX_ENTRIES,
        DEFAULT_TTL_MS,
        buildRouteCacheKey,
        createRouteCache
    };
});
