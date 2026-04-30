/**
 * appState.js - Mirrored runtime state store.
 * Keeps legacy window globals available while providing a structured BARK API.
 */
(function () {
    window.BARK = window.BARK || {};

    const APP_STATE_KEYS = [
        'allPoints',
        'userVisitedPlaces',
        'activePin',
        'activeSwagFilters',
        'activeSearchQuery',
        'activeTypeFilter',
        'visitedFilterState',
        '_searchResultCache',
        'tripDays',
        'activeDayIdx',
        'tripStartNode',
        'tripEndNode',
        'isTripEditMode',
        'isAdmin',
        'currentWalkPoints',
        'parkLookup'
    ];

    const BARK_ALIASES = {
        activePin: 'activePinMarker'
    };

    const fallbackValues = {};
    const listeners = new Map();

    function assertKnownKey(key) {
        if (!APP_STATE_KEYS.includes(key)) {
            throw new Error(`Unknown BARK appState key: ${key}`);
        }
    }

    function barkKeyFor(key) {
        return BARK_ALIASES[key] || key;
    }

    function hasBarkSource(key) {
        return Object.prototype.hasOwnProperty.call(window.BARK, barkKeyFor(key));
    }

    function readValue(key) {
        if (hasBarkSource(key)) return window.BARK[barkKeyFor(key)];
        return fallbackValues[key];
    }

    function writePrimaryValue(key, value) {
        if (hasBarkSource(key)) {
            try {
                window.BARK[barkKeyFor(key)] = value;
            } catch (error) {
                console.error(`Failed to mirror BARK appState "${key}" to window.BARK.`, error);
                throw error;
            }
            return;
        }

        fallbackValues[key] = value;
    }

    function notify(key, value, previousValue) {
        const callbacks = listeners.get(key);
        if (!callbacks) return;

        callbacks.forEach((callback) => {
            try {
                callback(value, previousValue, key);
            } catch (error) {
                console.error(`BARK appState listener failed for "${key}".`, error);
            }
        });
    }

    function get(key) {
        assertKnownKey(key);
        return readValue(key);
    }

    function set(key, value) {
        assertKnownKey(key);

        const previousValue = readValue(key);
        writePrimaryValue(key, value);

        if (!Object.is(previousValue, value)) {
            notify(key, value, previousValue);
        }
    }

    function onChange(key, callback) {
        assertKnownKey(key);

        if (typeof callback !== 'function') {
            throw new Error(`BARK appState listener for "${key}" must be a function.`);
        }

        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(callback);

        return function unsubscribe() {
            listeners.get(key).delete(callback);
        };
    }

    function hydrateFallbackValues() {
        fallbackValues.allPoints = hasBarkSource('allPoints') ? window.BARK.allPoints : [];
        fallbackValues.userVisitedPlaces = hasBarkSource('userVisitedPlaces') ? window.BARK.userVisitedPlaces : new Map();
        fallbackValues.activePin = hasBarkSource('activePin') ? window.BARK.activePinMarker : null;
        fallbackValues.activeSwagFilters = hasBarkSource('activeSwagFilters') ? window.BARK.activeSwagFilters : new Set();
        fallbackValues.activeSearchQuery = hasBarkSource('activeSearchQuery') ? window.BARK.activeSearchQuery : '';
        fallbackValues.activeTypeFilter = hasBarkSource('activeTypeFilter') ? window.BARK.activeTypeFilter : 'all';
        fallbackValues.visitedFilterState = hasBarkSource('visitedFilterState') ? window.BARK.visitedFilterState : (localStorage.getItem('barkVisitedFilter') || 'all');
        fallbackValues._searchResultCache = hasBarkSource('_searchResultCache') ? window.BARK._searchResultCache : { query: '', matchedIds: null };
        fallbackValues.tripDays = hasBarkSource('tripDays') ? window.BARK.tripDays : [{ color: '#1976D2', stops: [], notes: '' }];
        fallbackValues.activeDayIdx = hasBarkSource('activeDayIdx') ? window.BARK.activeDayIdx : 0;
        fallbackValues.tripStartNode = typeof window.tripStartNode !== 'undefined' ? window.tripStartNode : null;
        fallbackValues.tripEndNode = typeof window.tripEndNode !== 'undefined' ? window.tripEndNode : null;
        fallbackValues.isTripEditMode = typeof window.isTripEditMode !== 'undefined' ? window.isTripEditMode : false;
        fallbackValues.isAdmin = typeof window.isAdmin !== 'undefined' ? window.isAdmin : false;
        fallbackValues.currentWalkPoints = typeof window.currentWalkPoints !== 'undefined' ? window.currentWalkPoints : 0;
        fallbackValues.parkLookup = window.parkLookup instanceof Map ? window.parkLookup : new Map();
    }

    function installLegacyWindowMirrors() {
        APP_STATE_KEYS.forEach((key) => {
            Object.defineProperty(window, key, {
                configurable: true,
                enumerable: true,
                get() {
                    return get(key);
                },
                set(value) {
                    set(key, value);
                }
            });
        });
    }

    hydrateFallbackValues();
    installLegacyWindowMirrors();

    window.BARK.appState = {
        get,
        set,
        onChange
    };
})();
