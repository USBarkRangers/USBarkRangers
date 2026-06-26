/**
 * barkState.js — Central State Store
 * Owns mutable runtime data state and the window.BARK namespace.
 * Persistent user settings are owned by state/settingsStore.js.
 * Loaded FIRST in the boot sequence.
 */
window.BARK = window.BARK || {};
window.BARK.bootOrder = window.BARK.bootOrder || {};
window.BARK.bootOrder.barkStateParsedAt = Date.now();

// ====== APP VERSION ======
let APP_VERSION = parseInt(localStorage.getItem('bark_seen_version') || '34');
console.log(`B.A.R.K. Engine v${APP_VERSION}: Performance Optimized`);
window.BARK.APP_VERSION = APP_VERSION;
window.BARK.setAppVersion = function (v) { APP_VERSION = v; window.BARK.APP_VERSION = v; };

// ====== SAFETY & COST CONTROLS ======
let globalRequestCounter = 0;
window.SESSION_MAX_REQUESTS = 2000;
window._SESSION_REQUEST_COUNT = 0;
window._cloudSettingsLoaded = false;

const DEFAULT_LAUNCH_FLAGS = Object.freeze({
    checkoutEnabled: true,
    routePlannerEnabled: true,
    routeGenerationEnabled: true,
    premiumGeocodeEnabled: true,
    leaderboardDeepBrowsingEnabled: true,
    feedbackEnabled: true,
    premiumRiskyToolsEnabled: true
});

const LAUNCH_FLAG_MESSAGES = Object.freeze({
    checkoutEnabled: 'Premium checkout is paused for this beta. Please try again after the next release update.',
    routePlannerEnabled: 'Route planner tools are paused for beta safety. Your saved map and visited places still work.',
    routeGenerationEnabled: 'Route generation is paused for beta safety. You can still plan stops manually.',
    premiumGeocodeEnabled: 'Global town search is paused for beta safety. Local B.A.R.K. stop search still works.',
    leaderboardDeepBrowsingEnabled: 'Leaderboard browsing is limited for beta safety. The top results and your rank are still available.',
    feedbackEnabled: 'In-app feedback is paused for beta safety. Use the email suggestion option above for now.',
    premiumRiskyToolsEnabled: 'Premium map tools are paused for beta safety. Your account and saved progress are unchanged.'
});

function readSessionLaunchFlagOverrides() {
    try {
        const raw = localStorage.getItem('barkLaunchFlags');
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.warn('[launchFlags] Ignoring invalid barkLaunchFlags local override.', error);
        return {};
    }
}

function normalizeLaunchFlags(...sources) {
    const normalized = { ...DEFAULT_LAUNCH_FLAGS };
    sources.forEach(source => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) return;
        Object.keys(DEFAULT_LAUNCH_FLAGS).forEach(key => {
            if (typeof source[key] === 'boolean') normalized[key] = source[key];
        });
    });
    return normalized;
}

window.BARK.launchFlags = normalizeLaunchFlags(window.BARK_LAUNCH_FLAGS, readSessionLaunchFlagOverrides());
window.BARK.LAUNCH_FLAG_DEFAULTS = DEFAULT_LAUNCH_FLAGS;
window.BARK.LAUNCH_FLAG_MESSAGES = LAUNCH_FLAG_MESSAGES;
window.BARK.isLaunchFlagEnabled = function (flagName) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_LAUNCH_FLAGS, flagName)) return true;
    return window.BARK.launchFlags[flagName] !== false;
};
window.BARK.getLaunchFlagMessage = function (flagName, fallback) {
    return LAUNCH_FLAG_MESSAGES[flagName] || fallback || 'This feature is paused for beta safety.';
};
window.BARK.setLaunchFlagForSession = function (flagName, enabled) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_LAUNCH_FLAGS, flagName)) return false;
    window.BARK.launchFlags[flagName] = enabled === true;
    return true;
};

function incrementRequestCount() {
    globalRequestCounter++;
    window._SESSION_REQUEST_COUNT = globalRequestCounter;
    if (globalRequestCounter > window.SESSION_MAX_REQUESTS) {
        console.error(`CRITICAL: Session request limit reached (${globalRequestCounter}/${window.SESSION_MAX_REQUESTS}). Background sync disabled.`);
        throw new Error("Safety Shutdown: API limit reached for this session.");
    }
}
window.BARK.incrementRequestCount = incrementRequestCount;

// ====== CORE DATA STATE ======
let _searchResultCache = { query: '', matchedIds: null };
let activePinMarker = null;

function clearActivePin() {
    if (activePinMarker && activePinMarker._icon) {
        activePinMarker._icon.classList.remove('active-pin');
    }
    activePinMarker = null;
}

let activeSwagFilters = new Set();
let activeSearchQuery = '';
let activeTypeFilter = 'all';

let visitedFilterState = localStorage.getItem('barkVisitedFilter') || 'all';

// ====== TRIP PLANNER STATE ======
const DAY_COLORS = ['#1976D2', '#2E7D32', '#E65100', '#6A1B9A', '#C62828'];
let tripDays = [{ color: DAY_COLORS[0], stops: [], notes: "" }];
let activeDayIdx = 0;
window.tripStartNode = null;
window.tripEndNode = null;

// ====== UTILITY FUNCTIONS ======
if (
    typeof window.BARK.generatePinId !== 'function' ||
    typeof window.BARK.haversineDistance !== 'function' ||
    typeof window.BARK.sanitizeWalkPoints !== 'function'
) {
    throw new Error('geoUtils.js must load before barkState.js');
}

// ====== GAMIFICATION ENGINE INSTANCE ======
window.gamificationEngine = new GamificationEngine();
window.currentWalkPoints = window.currentWalkPoints || 0;
window._lastSyncedScore = Number.isFinite(Number(window._lastSyncedScore)) ? Number(window._lastSyncedScore) : -1;
window._lastSyncedLeaderboardFingerprint = typeof window._lastSyncedLeaderboardFingerprint === 'string'
    ? window._lastSyncedLeaderboardFingerprint
    : null;

// ====== EXPOSE STATE TO BARK NAMESPACE ======
// Using property accessors so modules always get live references
Object.defineProperties(window.BARK, {
    _searchResultCache: { get() { return _searchResultCache; }, set(v) { _searchResultCache = v; } },
    activePinMarker:    { get() { return activePinMarker; },    set(v) { activePinMarker = v; } },
    activeSwagFilters:  { get() { return activeSwagFilters; },  set(v) { activeSwagFilters = v; } },
    activeSearchQuery:  { get() { return activeSearchQuery; },  set(v) { activeSearchQuery = v; } },
    activeTypeFilter:   { get() { return activeTypeFilter; },   set(v) { activeTypeFilter = v; } },
    visitedFilterState: { get() { return visitedFilterState; }, set(v) { visitedFilterState = v; } },
    tripDays:           { get() { return tripDays; },           set(v) { tripDays = v; } },
    activeDayIdx:       { get() { return activeDayIdx; },       set(v) { activeDayIdx = v; } },
});

window.BARK.DAY_COLORS = DAY_COLORS;
window.BARK.clearActivePin = clearActivePin;
window.BARK.__barkStateReady = true;
