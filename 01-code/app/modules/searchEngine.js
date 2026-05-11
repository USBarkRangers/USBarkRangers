/**
 * searchEngine.js — Search Bar, Fuzzy Matching, Suggestions, Geocoder
 * Owns normalizeText(), levenshtein(), search event listeners, and executeGeocode().
 * Loaded FIFTH in the boot sequence.
 */
window.BARK = window.BARK || {};

const SEARCH_INPUT_DEBOUNCE_MS = 300;
const SEARCH_FRAME_BUDGET_MS = 16;
const SEARCH_CONTINUATION_DELAY_MS = 0;
const SEARCH_SUGGESTION_LIMIT = 8;
const SEARCH_SCORE_THRESHOLD = 2;
const SEARCH_GLOBAL_MIN_LENGTH = 3;
const GLOBAL_GEOCODE_CACHE_LIMIT = 50;
const INLINE_PLANNER_SEARCH_TYPES = ['start', 'end'];
let suppressInlinePlannerSuggestionsUntil = 0;
const globalGeocodeCache = new Map();
const globalGeocodeInFlight = new Map();
const autoGlobalSearchRunIds = {
    stop: 0,
    start: 0,
    end: 0
};

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

// ====== TEXT NORMALIZATION ======
function normalizeText(text) {
    if (!text) return '';
    const dict = window.BARK.normalizationDict;
    let cleaned = String(text).toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s{2,}/g, " ").trim();
    let words = cleaned.split(' ');
    for (let i = 0; i < words.length; i++) {
        if (dict[words[i]]) {
            words[i] = dict[words[i]];
        }
    }
    return words.join(' ');
}

// ====== SPACE-OPTIMIZED LEVENSHTEIN ======
function levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length > b.length) [a, b] = [b, a];
    let row = new Array(a.length + 1);
    for (let i = 0; i <= a.length; i++) row[i] = i;
    for (let i = 1; i <= b.length; i++) {
        let prev = i;
        for (let j = 1; j <= a.length; j++) {
            let val = (b[i - 1] === a[j - 1]) ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
            row[j - 1] = prev;
            prev = val;
        }
        row[a.length] = prev;
    }
    return row[a.length];
}

window.BARK.normalizeText = normalizeText;
window.BARK.levenshtein = levenshtein;

function getSearchNow() {
    return (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();
}

function scoreSearchItem(item, queryNorm) {
    const nameNorm = item._cachedNormalizedName || normalizeText(item.name);
    let score = 999;

    if (!queryNorm) return score;

    if (nameNorm.includes(queryNorm)) {
        score = 0;
    } else if (queryNorm.length > 2) {
        let minDist = levenshtein(queryNorm, nameNorm);
        const words = nameNorm.split(' ');

        for (let i = 0; i < words.length; i++) {
            if (minDist <= 1) break;
            const word = words[i];
            if (Math.abs(queryNorm.length - word.length) < 5) {
                minDist = Math.min(minDist, levenshtein(queryNorm, word));
            }
        }

        score = minDist;
    }

    return score;
}

function isPremiumGlobalSearchUnlocked() {
    if (!isPremiumGeocodeEnabled()) return false;
    return Boolean(
        window.BARK &&
        window.BARK.services &&
        window.BARK.services.premium &&
        typeof window.BARK.services.premium.isPremium === 'function' &&
        window.BARK.services.premium.isPremium()
    );
}

function isPremiumGeocodeEnabled() {
    const flags = window.BARK && typeof window.BARK.isLaunchFlagEnabled === 'function'
        ? window.BARK
        : null;
    if (!flags) return true;
    return flags.isLaunchFlagEnabled('premiumRiskyToolsEnabled') &&
        flags.isLaunchFlagEnabled('premiumGeocodeEnabled');
}

function getPremiumGeocodeDisabledMessage() {
    if (window.BARK && typeof window.BARK.getLaunchFlagMessage === 'function') {
        if (!window.BARK.isLaunchFlagEnabled('premiumRiskyToolsEnabled')) {
            return window.BARK.getLaunchFlagMessage('premiumRiskyToolsEnabled');
        }
        return window.BARK.getLaunchFlagMessage('premiumGeocodeEnabled');
    }

    return 'Global town search is paused for beta safety. Local B.A.R.K. stop search still works.';
}

function isSignedInForGlobalSearchPrompt() {
    try {
        return Boolean(
            typeof firebase !== 'undefined' &&
            firebase.auth &&
            firebase.auth().currentUser
        );
    } catch (error) {
        return false;
    }
}

function getGlobalSearchLockCopy() {
    if (!isPremiumGeocodeEnabled()) {
        return {
            hint: 'Global search paused',
            alert: getPremiumGeocodeDisabledMessage()
        };
    }

    if (isSignedInForGlobalSearchPrompt()) {
        return {
            hint: 'Upgrade to unlock global search',
            alert: 'Searching for custom towns and locations is a Premium feature. Upgrade to add any city or town to your trip.'
        };
    }

    return {
        hint: 'Sign in to unlock global search',
        alert: 'Searching for custom towns and locations is a Premium feature. Please sign in via the Profile tab.'
    };
}

function openGlobalSearchPaywall() {
    const paywall = window.BARK && window.BARK.paywall;
    if (paywall && typeof paywall.openPaywall === 'function') {
        paywall.openPaywall({ source: 'global-town-search' });
        return;
    }

    const authPremiumUi = window.BARK && window.BARK.authPremiumUi;
    if (authPremiumUi && typeof authPremiumUi.openPremiumPrompt === 'function') {
        authPremiumUi.openPremiumPrompt('global-town-search');
        return;
    }

    alert(getGlobalSearchLockCopy().alert);
}

function alertGlobalSearchLocked() {
    openGlobalSearchPaywall();
}

function normalizeGlobalGeocodeQuery(query) {
    return String(query || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getGlobalGeocodeCacheKey(query, options = {}) {
    const normalized = normalizeGlobalGeocodeQuery(query);
    const country = options.country || 'US';
    const size = options.size || 5;
    return `${country}|${size}|${normalized}`;
}

function rememberGlobalGeocodeResult(cacheKey, data) {
    if (!cacheKey) return;
    if (globalGeocodeCache.has(cacheKey)) globalGeocodeCache.delete(cacheKey);
    globalGeocodeCache.set(cacheKey, data);

    while (globalGeocodeCache.size > GLOBAL_GEOCODE_CACHE_LIMIT) {
        const oldestKey = globalGeocodeCache.keys().next().value;
        globalGeocodeCache.delete(oldestKey);
    }
}

function bumpAutoGlobalSearchRun(targetType) {
    if (!Object.prototype.hasOwnProperty.call(autoGlobalSearchRunIds, targetType)) {
        autoGlobalSearchRunIds[targetType] = 0;
    }
    autoGlobalSearchRunIds[targetType] += 1;
    return autoGlobalSearchRunIds[targetType];
}

function getAutoGlobalSearchRun(targetType) {
    return autoGlobalSearchRunIds[targetType] || 0;
}

async function fetchGlobalGeocode(query, options = {}) {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) return { features: [] };
    if (!isPremiumGeocodeEnabled()) {
        const error = new Error(getPremiumGeocodeDisabledMessage());
        error.code = 'launch-disabled';
        throw error;
    }

    const requestOptions = {
        size: 5,
        country: 'US',
        ...options
    };
    const cacheKey = getGlobalGeocodeCacheKey(trimmedQuery, requestOptions);

    if (globalGeocodeCache.has(cacheKey)) return globalGeocodeCache.get(cacheKey);
    if (globalGeocodeInFlight.has(cacheKey)) return globalGeocodeInFlight.get(cacheKey);

    const request = (async () => {
        if (typeof window.BARK.incrementRequestCount === 'function') window.BARK.incrementRequestCount();
        const data = await window.BARK.services.ors.geocode(trimmedQuery, requestOptions);
        rememberGlobalGeocodeResult(cacheKey, data);
        return data;
    })();

    globalGeocodeInFlight.set(cacheKey, request);
    try {
        return await request;
    } finally {
        globalGeocodeInFlight.delete(cacheKey);
    }
}

function getLocalParkMatches(query, limit = SEARCH_SUGGESTION_LIMIT) {
    const queryNorm = normalizeText(query);
    const parkRepo = getParkRepo();
    const allPoints = parkRepo ? parkRepo.getAll() : [];

    if (!queryNorm) return [];

    return allPoints
        .map((item) => ({ item, score: scoreSearchItem(item, queryNorm) }))
        .filter(({ score }) => score <= SEARCH_SCORE_THRESHOLD)
        .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
        .slice(0, limit)
        .map(({ item }) => item);
}

function getSearchResultLabel(item) {
    return item.name + (item.state ? `, ${item.state}` : '');
}

function makeTripNodeFromPark(item) {
    return {
        id: item.id,
        name: item.name,
        lat: item.lat,
        lng: item.lng,
        state: item.state,
        category: item.category,
        swagType: item.swagType
    };
}

function alertTripPlannerUnavailable() {
    alert('Trip planner is unavailable right now. Please refresh and try again.');
}

function applyTripNodeSelection(type, node, options = {}) {
    let shouldUpdateTripUI = false;

    if (type === 'start') {
        window.tripStartNode = node;
        shouldUpdateTripUI = true;
    } else if (type === 'end') {
        window.tripEndNode = node;
        shouldUpdateTripUI = true;
    } else if (typeof window.addStopToTrip === 'function') {
        try {
            if (window.addStopToTrip(node) === false) return false;
        } catch (error) {
            console.error('[searchEngine] addStopToTrip failed:', error);
            if (options.alertOnFailure) alertTripPlannerUnavailable();
            return false;
        }
    } else {
        console.warn('[searchEngine] addStopToTrip unavailable; cannot add geocode stop.', node);
        if (options.alertOnFailure) alertTripPlannerUnavailable();
        return false;
    }

    if (shouldUpdateTripUI && typeof window.BARK.updateTripUI === 'function') window.BARK.updateTripUI();
    return true;
}

function applyPlannerSearchSelection(type, node) {
    return applyTripNodeSelection(type, node, { alertOnFailure: true });
}

function clearGeocodeSearchStatus(DOM, targetType) {
    if (targetType === 'stop') {
        const mainSearch = DOM.parkSearch();
        const clearBtn = DOM.clearSearchBtn();
        if (mainSearch) mainSearch.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        if (typeof window.BARK.activeSearchQuery !== 'undefined') window.BARK.activeSearchQuery = '';
        return;
    }

    const inlineInput = DOM.inlineInput(targetType);
    if (
        inlineInput &&
        inlineInput.value &&
        (inlineInput.value.startsWith('Searching for "') || inlineInput.value === 'Locating GPS...')
    ) {
        inlineInput.value = '';
    }
}

function hideInlineSuggestions(type) {
    const DOM = window.BARK.DOM;
    const suggestBox = DOM && DOM.inlineSuggest ? DOM.inlineSuggest(type) : null;
    if (suggestBox) suggestBox.style.display = 'none';
}

function hideAllInlineSuggestions() {
    INLINE_PLANNER_SEARCH_TYPES.forEach(hideInlineSuggestions);
}

function suppressInlinePlannerSuggestions(durationMs = 500) {
    suppressInlinePlannerSuggestionsUntil = Date.now() + durationMs;
    hideAllInlineSuggestions();
}

function isInlinePlannerSearchTarget(target, type) {
    const DOM = window.BARK.DOM;
    const input = DOM && DOM.inlineInput ? DOM.inlineInput(type) : null;
    const suggestBox = DOM && DOM.inlineSuggest ? DOM.inlineSuggest(type) : null;

    return Boolean(
        (input && target === input) ||
        (suggestBox && suggestBox.contains(target))
    );
}

function appendInlineStatus(suggestBox, text, cssText) {
    if (!suggestBox) return;
    const statusDiv = document.createElement('div');
    statusDiv.className = 'suggestion-item';
    if (cssText) statusDiv.style.cssText = cssText;
    statusDiv.textContent = text;
    suggestBox.appendChild(statusDiv);
}

function bindSuggestionSelection(element, onSelect) {
    if (!element || typeof onSelect !== 'function') return;
    element.setAttribute('role', 'button');
    element.tabIndex = 0;

    element.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(e);
    });

    element.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(e);
    });
}

function appendInlineGlobalSearchButton(type, query, suggestBox) {
    if (!suggestBox || query.trim().length < SEARCH_GLOBAL_MIN_LENGTH) return;

    const isPremium = isPremiumGlobalSearchUnlocked();
    const globalBtn = document.createElement('div');
    globalBtn.className = 'suggestion-item';
    globalBtn.style.cssText = 'background: #f0fdf4; color: #15803d; font-weight: 700; border-top: 1px solid #bbf7d0; display: flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 4px;';

    const iconSpan = document.createElement('span');
    iconSpan.textContent = isPremium ? '🌍' : '🔒';

    const textWrap = document.createElement('div');
    const label = document.createElement('div');
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:10px; font-weight:normal;';

    if (isPremium) {
        label.textContent = `Search towns & cities for "${query}"`;
        hint.style.color = '#166534';
        hint.textContent = 'Query global database';
    } else {
        const lockCopy = getGlobalSearchLockCopy();
        globalBtn.style.opacity = '0.7';
        label.style.color = '#64748b';
        label.textContent = `Search global towns for "${query}"`;
        hint.textContent = lockCopy.hint;
    }

    textWrap.appendChild(label);
    textWrap.appendChild(hint);
    globalBtn.appendChild(iconSpan);
    globalBtn.appendChild(textWrap);

    bindSuggestionSelection(globalBtn, () => {
        if (!isPremiumGlobalSearchUnlocked()) {
            alertGlobalSearchLocked();
            return;
        }

        const input = window.BARK.DOM.inlineInput(type);
        if (input) input.value = `Searching for "${query}"...`;
        suggestBox.style.display = 'none';
        executeGeocode(query, type);
    });

    suggestBox.appendChild(globalBtn);
}

function renderInlinePlannerSuggestions(type, query, matches, options = {}) {
    const DOM = window.BARK.DOM;
    const suggestBox = DOM && DOM.inlineSuggest ? DOM.inlineSuggest(type) : null;
    if (!suggestBox) return;

    suggestBox.innerHTML = '';

    matches.forEach((match) => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = getSearchResultLabel(match);
        bindSuggestionSelection(div, () => {
            const input = DOM.inlineInput(type);
            if (input) input.value = match.name;
            hideInlineSuggestions(type);
            applyPlannerSearchSelection(type, makeTripNodeFromPark(match));
        });
        suggestBox.appendChild(div);
    });

    if (matches.length === 0 && query.trim().length >= SEARCH_GLOBAL_MIN_LENGTH) {
        appendInlineStatus(
            suggestBox,
            `No local B.A.R.K. matches for "${query}".`,
            'background: #f8fafc; color: #475569; font-weight: 700; border-top: 1px solid #e2e8f0;'
        );
    }

    const shouldAutoSearchGlobal = Boolean(
        options.autoGlobal &&
        matches.length === 0 &&
        query.trim().length >= SEARCH_GLOBAL_MIN_LENGTH &&
        isPremiumGlobalSearchUnlocked()
    );

    if (shouldAutoSearchGlobal) {
        appendInlineAutoGlobalStatus(type, query, suggestBox);
    } else {
        bumpAutoGlobalSearchRun(type);
        appendInlineGlobalSearchButton(type, query, suggestBox);
    }

    suggestBox.style.display = suggestBox.innerHTML !== '' ? 'block' : 'none';
}

function runInlinePlannerSearch(type, options = {}) {
    const DOM = window.BARK.DOM;
    const input = DOM && DOM.inlineInput ? DOM.inlineInput(type) : null;
    const query = input ? input.value.trim() : '';

    if (!query) {
        bumpAutoGlobalSearchRun(type);
        hideInlineSuggestions(type);
        return;
    }

    if (!options.executeGlobal && input !== document.activeElement) {
        hideInlineSuggestions(type);
        return;
    }

    if (!options.executeGlobal && Date.now() < suppressInlinePlannerSuggestionsUntil) {
        hideInlineSuggestions(type);
        return;
    }

    const lowerQuery = query.toLowerCase();
    if (lowerQuery === 'my location' || lowerQuery === 'current location') {
        executeGeocode(query, type);
        return;
    }

    const matches = getLocalParkMatches(query);
    renderInlinePlannerSuggestions(type, query, matches, { autoGlobal: !options.executeGlobal });

    if (!options.executeGlobal || matches.length > 0 || query.length < SEARCH_GLOBAL_MIN_LENGTH) return;

    if (!isPremiumGlobalSearchUnlocked()) {
        alertGlobalSearchLocked();
        return;
    }

    if (input) input.value = `Searching for "${query}"...`;
    hideInlineSuggestions(type);
    executeGeocode(query, type);
}

function getGeocodeSuggestionContainer(DOM, targetType) {
    return targetType === 'stop'
        ? DOM.searchSuggestions()
        : DOM.inlineSuggest(targetType);
}

function getGeocodeActionText(targetType) {
    if (targetType === 'start') return 'TRIP START';
    if (targetType === 'end') return 'TRIP END';
    return 'ADD STOP';
}

function renderGeocodeResults(query, targetType, data) {
    const DOM = window.BARK.DOM;
    const disambiguationContainer = getGeocodeSuggestionContainer(DOM, targetType);
    if (!disambiguationContainer) return;

    if (data.features && data.features.length > 0) {
        const actionText = getGeocodeActionText(targetType);
        disambiguationContainer.innerHTML = `
            <div style="background: #f0fdf4; border-bottom: 1px solid #bbf7d0; padding: 10px; font-size: 11px; color: #15803d; font-weight: 800; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
                SELECT FOR ${actionText}
            </div>`;

        data.features.forEach(f => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.style.cssText = 'padding: 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background 0.2s;';

            const label = document.createElement('span');
            label.style.cssText = 'font-weight: 700; color: #1e293b;';
            label.textContent = f.properties.label || query;
            div.appendChild(label);

            bindSuggestionSelection(div, () => {
                const coords = f.geometry.coordinates;
                const node = { name: f.properties.label || query, lat: coords[1], lng: coords[0] };
                if (!applyTripNodeSelection(targetType, node, { alertOnFailure: true })) {
                    clearGeocodeSearchStatus(DOM, targetType);
                    disambiguationContainer.style.display = 'none';
                    return;
                }

                const mainSearch = DOM.parkSearch();
                const clearBtn = DOM.clearSearchBtn();
                const inlineInput = targetType !== 'stop' ? DOM.inlineInput(targetType) : null;

                if (targetType === 'stop') {
                    if (mainSearch) mainSearch.value = '';
                    if (typeof window.BARK.activeSearchQuery !== 'undefined') window.BARK.activeSearchQuery = '';
                    if (clearBtn) clearBtn.style.display = 'none';
                } else if (inlineInput) {
                    inlineInput.value = node.name;
                }

                if (typeof window.syncState === 'function') window.syncState();

                const movementMap = getSearchMovementMap(targetType);
                if (movementMap) {
                    movementMap.setView([node.lat, node.lng], 10, {
                        animate: !window.lowGfxEnabled,
                        duration: window.lowGfxEnabled ? 0 : 1.5
                    });
                }

                disambiguationContainer.style.display = 'none';
            });
            disambiguationContainer.appendChild(div);
        });

        disambiguationContainer.style.display = 'block';
        return;
    }

    disambiguationContainer.innerHTML = `<p style="padding: 10px; font-size: 12px; color: #dc2626; text-align: center; font-weight: bold;">Location not found.</p>`;
    disambiguationContainer.style.display = 'block';
}

function appendInlineAutoGlobalStatus(type, query, suggestBox) {
    if (!suggestBox) return;
    appendInlineStatus(
        suggestBox,
        `Searching towns & cities for "${query}"...`,
        'background: #f0fdf4; color: #15803d; font-weight: 800; border-top: 1px solid #bbf7d0;'
    );

    const runId = bumpAutoGlobalSearchRun(type);
    fetchGlobalGeocode(query, { size: 5, country: 'US' })
        .then(data => {
            const DOM = window.BARK.DOM;
            const input = DOM && DOM.inlineInput ? DOM.inlineInput(type) : null;
            if (runId !== getAutoGlobalSearchRun(type)) return;
            if (!input || input.value.trim() !== query || input !== document.activeElement) return;
            renderGeocodeResults(query, type, data);
        })
        .catch(error => {
            console.error('Auto town search failed:', error);
            const DOM = window.BARK.DOM;
            const input = DOM && DOM.inlineInput ? DOM.inlineInput(type) : null;
            const currentSuggestBox = DOM && DOM.inlineSuggest ? DOM.inlineSuggest(type) : null;
            if (runId !== getAutoGlobalSearchRun(type)) return;
            if (!input || input.value.trim() !== query || input !== document.activeElement || !currentSuggestBox) return;
            currentSuggestBox.innerHTML = '';
            appendInlineStatus(
                currentSuggestBox,
                'Town search is unavailable right now.',
                'background: #fef2f2; color: #b91c1c; font-weight: 800;'
            );
            currentSuggestBox.style.display = 'block';
        });
}

function getSearchMovementMap(targetType) {
    if (targetType !== 'stop' || window.stopAutoMovements) return null;
    if (typeof window.BARK.isMapVisibleByDefaultViewState === 'function' && !window.BARK.isMapVisibleByDefaultViewState()) return null;

    if (typeof window.BARK.getUsableMap === 'function') return window.BARK.getUsableMap();
    if (
        window.map &&
        typeof window.map.setView === 'function' &&
        typeof window.map.getZoom === 'function' &&
        typeof window.map.getBounds === 'function' &&
        typeof window.map.getContainer === 'function'
    ) {
        return window.map;
    }

    return null;
}

window.BARK.getLocalParkMatches = getLocalParkMatches;
window.BARK.runInlinePlannerSearch = runInlinePlannerSearch;
window.BARK.hideInlinePlannerSuggestions = hideInlineSuggestions;
window.BARK.hideAllInlinePlannerSuggestions = hideAllInlineSuggestions;
window.BARK.suppressInlinePlannerSuggestions = suppressInlinePlannerSuggestions;

// ====== SEARCH UI BINDING ======
function initSearchEngine() {
    const DOM = window.BARK.DOM;
    const searchInput = DOM.parkSearch();
    const clearSearchBtn = DOM.clearSearchBtn();
    const searchSuggestions = DOM.searchSuggestions();
    const typeSelect = DOM.typeFilter();
    const filterBtns = document.querySelectorAll('.filter-btn');
    let searchTimeout = null;
    let searchContinuationTimeout = null;
    let activeSearchRunId = 0;

    if (!searchInput) return;

    function clearSearchTimer(timer) {
        if (timer) clearTimeout(timer);
    }

    function cancelSearchWork() {
        activeSearchRunId += 1;
        bumpAutoGlobalSearchRun('stop');
        clearSearchTimer(searchTimeout);
        clearSearchTimer(searchContinuationTimeout);
        searchTimeout = null;
        searchContinuationTimeout = null;
    }

    function resetSearchCache() {
        window.BARK._searchResultCache = {
            query: '',
            matchedIds: null,
            complete: true,
            processedCount: 0,
            totalCount: 0
        };
    }

    function publishSearchCache(queryNorm, matchedIds, isComplete, processedCount, totalCount) {
        window.BARK._searchResultCache = {
            query: queryNorm,
            matchedIds: matchedIds,
            complete: isComplete,
            processedCount: processedCount,
            totalCount: totalCount
        };
    }

    function appendSearchStatus(text, cssText) {
        if (!searchSuggestions) return;

        const statusDiv = document.createElement('div');
        statusDiv.className = 'suggestion-item';
        if (cssText) statusDiv.style.cssText = cssText;
        statusDiv.textContent = text;
        searchSuggestions.appendChild(statusDiv);
    }

    function appendFederatedButton(activeQuery, isPremium) {
        if (!searchSuggestions) return;

        const federatedBtn = document.createElement('div');
        federatedBtn.className = 'suggestion-item';
        federatedBtn.style.cssText = 'background: #f0fdf4; color: #15803d; font-weight: 700; border-top: 1px solid #bbf7d0; display: flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 4px;';

        const iconSpan = document.createElement('span');
        iconSpan.textContent = isPremium ? '🌍' : '🔒';

        const textWrap = document.createElement('div');
        const label = document.createElement('div');
        const hint = document.createElement('span');
        hint.style.cssText = 'font-size:10px; font-weight:normal;';

        if (isPremium) {
            label.textContent = `Search towns & cities for "${activeQuery}"`;
            hint.style.color = '#166534';
            hint.textContent = 'Query global database';
        } else {
            const lockCopy = getGlobalSearchLockCopy();
            federatedBtn.style.opacity = '0.7';
            label.style.color = '#64748b';
            label.textContent = `Search global towns for "${activeQuery}"`;
            hint.textContent = lockCopy.hint;
        }

        textWrap.appendChild(label);
        textWrap.appendChild(hint);
        federatedBtn.appendChild(iconSpan);
        federatedBtn.appendChild(textWrap);

        bindSuggestionSelection(federatedBtn, () => {
            if (!isPremiumGlobalSearchUnlocked()) {
                alertGlobalSearchLocked();
                return;
            }
            const queryToFetch = window.BARK.activeSearchQuery;
            searchInput.value = `Searching for "${queryToFetch}"...`;
            searchSuggestions.style.display = 'none';
            executeGeocode(queryToFetch, 'stop');
        });

        searchSuggestions.appendChild(federatedBtn);
    }

    function appendAutoGlobalSearchStatus(activeQuery, searchRunId) {
        if (!searchSuggestions) return;

        appendSearchStatus(
            `Searching towns & cities for "${activeQuery}"...`,
            'background: #f0fdf4; color: #15803d; font-weight: 800; border-top: 1px solid #bbf7d0;'
        );

        const autoRunId = bumpAutoGlobalSearchRun('stop');
        fetchGlobalGeocode(activeQuery, { size: 5, country: 'US' })
            .then(data => {
                if (searchRunId !== activeSearchRunId) return;
                if (autoRunId !== getAutoGlobalSearchRun('stop')) return;
                if (normalizeText(window.BARK.activeSearchQuery) !== normalizeText(activeQuery)) return;
                renderGeocodeResults(activeQuery, 'stop', data);
            })
            .catch(error => {
                console.error('Auto town search failed:', error);
                if (searchRunId !== activeSearchRunId) return;
                if (autoRunId !== getAutoGlobalSearchRun('stop')) return;
                if (normalizeText(window.BARK.activeSearchQuery) !== normalizeText(activeQuery)) return;
                searchSuggestions.innerHTML = '';
                appendSearchStatus(
                    error && error.code === 'launch-disabled'
                        ? getPremiumGeocodeDisabledMessage()
                        : 'Town search is unavailable right now.',
                    'background: #fef2f2; color: #b91c1c; font-weight: 800;'
                );
                searchSuggestions.style.display = 'block';
            });
    }

    function renderSearchSuggestions(queryNorm, matches, isComplete) {
        if (!searchSuggestions) return;
        if (queryNorm !== normalizeText(window.BARK.activeSearchQuery)) return;

        const activeQuery = window.BARK.activeSearchQuery;
        const topMatches = matches
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, SEARCH_SUGGESTION_LIMIT);

        searchSuggestions.innerHTML = '';

        // 1. Render local map matches
        if (topMatches.length > 0) {
            topMatches.forEach(match => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.textContent = match.name + (match.state ? `, ${match.state}` : '');
                div.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelSearchWork();
                    searchInput.value = match.name;
                    window.BARK.activeSearchQuery = match.name;
                    window.BARK._searchResultCache = {
                        query: normalizeText(match.name),
                        matchedIds: new Set([match.id]),
                        complete: true,
                        processedCount: 1,
                        totalCount: 1
                    };
                    searchSuggestions.style.display = 'none';
                    window.syncState();

                    if (match.marker && match.marker._parkData) {
                        const movementMap = getSearchMovementMap('stop');
                        if (movementMap) {
                            movementMap.setView([match.marker._parkData.lat, match.marker._parkData.lng], 12, {
                                animate: !window.lowGfxEnabled,
                                duration: window.lowGfxEnabled ? 0 : 1.5
                            });
                        }
                        match.marker.fire('click');
                    }
                });
                searchSuggestions.appendChild(div);
            });
        }

        // 2. BLENDED FALLBACK: Wait until local search is complete before querying global search.
        if (activeQuery.trim().length >= SEARCH_GLOBAL_MIN_LENGTH) {
            if (!isComplete) {
                appendSearchStatus(
                    `Searching local map for "${activeQuery}"...`,
                    'background: #f8fafc; color: #475569; font-weight: 700; border-top: 1px solid #e2e8f0;'
                );
            } else {
                const isPremium = isPremiumGlobalSearchUnlocked();

                if (topMatches.length === 0) {
                    appendSearchStatus(
                        `No local B.A.R.K. matches for "${activeQuery}".`,
                        'background: #f8fafc; color: #475569; font-weight: 700; border-top: 1px solid #e2e8f0;'
                    );
                }

                if (topMatches.length === 0 && isPremium) {
                    appendAutoGlobalSearchStatus(activeQuery, activeSearchRunId);
                } else {
                    bumpAutoGlobalSearchRun('stop');
                    appendFederatedButton(activeQuery, isPremium);
                }
            }
        }

        if (searchSuggestions.innerHTML !== '') {
            searchSuggestions.style.display = 'block';
        } else {
            searchSuggestions.style.display = 'none';
        }
    }

    function publishSearchProgress(runId, queryNorm, matchedIds, matches, isComplete, processedCount, totalCount) {
        if (runId !== activeSearchRunId) return false;

        publishSearchCache(queryNorm, matchedIds, isComplete, processedCount, totalCount);
        renderSearchSuggestions(queryNorm, matches, isComplete);
        window.syncState();
        return true;
    }

    function runSearchChunk(runId, queryNorm, allPoints, matchedIds, matches, startIndex) {
        if (runId !== activeSearchRunId) return;

        const startedAt = getSearchNow();
        const totalCount = allPoints.length;

        for (let i = startIndex; i < totalCount; i++) {
            const item = allPoints[i];
            const score = scoreSearchItem(item, queryNorm);

            if (score <= SEARCH_SCORE_THRESHOLD) {
                matchedIds.add(item.id);
                matches.push(item);
            }

            const processedCount = i + 1;
            const hasMoreWork = processedCount < totalCount;

            if (hasMoreWork && getSearchNow() - startedAt >= SEARCH_FRAME_BUDGET_MS) {
                if (!publishSearchProgress(runId, queryNorm, matchedIds, matches, false, processedCount, totalCount)) return;

                searchContinuationTimeout = setTimeout(() => {
                    searchContinuationTimeout = null;
                    runSearchChunk(runId, queryNorm, allPoints, matchedIds, matches, processedCount);
                }, SEARCH_CONTINUATION_DELAY_MS);
                return;
            }
        }

        publishSearchProgress(runId, queryNorm, matchedIds, matches, true, totalCount, totalCount);
    }

    function startBudgetedSearch(runId) {
        searchTimeout = null;
        if (runId !== activeSearchRunId) return;

        const queryNorm = normalizeText(window.BARK.activeSearchQuery);
        const parkRepo = getParkRepo();
        const allPoints = parkRepo ? parkRepo.getAll() : [];

        if (!queryNorm) {
            resetSearchCache();
            if (searchSuggestions) searchSuggestions.style.display = 'none';
            window.syncState();
            return;
        }

        const matchedIds = new Set();
        const matches = [];
        publishSearchCache(queryNorm, matchedIds, false, 0, allPoints.length);
        runSearchChunk(runId, queryNorm, allPoints, matchedIds, matches, 0);
    }

    searchInput.addEventListener('input', (e) => {
        cancelSearchWork();
        window.BARK.activeSearchQuery = e.target.value;

        if (clearSearchBtn) {
            clearSearchBtn.style.display = window.BARK.activeSearchQuery.length > 0 ? 'block' : 'none';
        }

        if (window.BARK.activeSearchQuery.trim() === '') {
            resetSearchCache();
            if (searchSuggestions) searchSuggestions.style.display = 'none';
            window.syncState();
            return;
        }

        const runId = activeSearchRunId;
        searchTimeout = setTimeout(() => {
            startBudgetedSearch(runId);
        }, SEARCH_INPUT_DEBOUNCE_MS);
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (searchSuggestions && searchSuggestions.style.display === 'block') {
            if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
                searchSuggestions.style.display = 'none';
            }
        }
    });

    document.addEventListener('pointerdown', (e) => {
        INLINE_PLANNER_SEARCH_TYPES.forEach((type) => {
            const suggestBox = DOM.inlineSuggest(type);
            if (!suggestBox || suggestBox.style.display !== 'block') return;
            if (isInlinePlannerSearchTarget(e.target, type)) return;
            hideInlineSuggestions(type);
            suppressInlinePlannerSuggestions(500);
        });
    }, true);

    // Reshow dropdown when focusing search bar
    searchInput.addEventListener('focus', () => {
        if (searchSuggestions && searchSuggestions.innerHTML.trim() !== '' && window.BARK.activeSearchQuery.length > 0) {
            searchSuggestions.style.display = 'block';
        }
    });

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            cancelSearchWork();
            searchInput.value = '';
            window.BARK.activeSearchQuery = '';
            clearSearchBtn.style.display = 'none';
            resetSearchCache();
            if (searchSuggestions) searchSuggestions.style.display = 'none';
            window.syncState();
            searchInput.focus();
        });
    }

    if (typeSelect) {
        typeSelect.addEventListener('change', (e) => {
            window.BARK.activeTypeFilter = e.target.value;
            window.syncState();
        });
    }

    // ====== FILTER BUTTONS ======
    filterBtns.forEach(btn => {
        // Skip the Virtual Trail and Completed Trails buttons — they are handled by expeditionEngine
        const filterType = btn.getAttribute('data-filter');
        if (filterType === 'VirtualTrail' || filterType === 'CompletedTrails') return;

        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-filter');

            if (window.BARK.activeSwagFilters.size === 0) {
                window.BARK.activeSwagFilters.add(type);
                btn.classList.add('active');
            } else {
                if (window.BARK.activeSwagFilters.has(type)) {
                    window.BARK.activeSwagFilters.delete(type);
                    btn.classList.remove('active');
                } else {
                    window.BARK.activeSwagFilters.add(type);
                    btn.classList.add('active');
                }
            }

            if (window.BARK.activeSwagFilters.size === 0) {
                filterBtns.forEach(b => b.classList.remove('active'));
            }

            window.syncState();
        });
    });
}

window.BARK.initSearchEngine = initSearchEngine;

// ====== UNIVERSAL GEOCODER ======
async function executeGeocode(query, targetType) {
    if (!query) return;
    const DOM = window.BARK.DOM;
    const lowerQ = query.trim().toLowerCase();
    bumpAutoGlobalSearchRun(targetType);

    // 🔥 SMART INTERCEPT: GPS Routing
    if (lowerQ === 'my location' || lowerQ === 'current location') {
        const mainSearch = DOM.parkSearch();
        if (targetType === 'stop' && mainSearch) mainSearch.value = 'Locating GPS...';
        else {
            const inlineInput = DOM.inlineInput(targetType);
            if (inlineInput) inlineInput.value = 'Locating GPS...';
        }

        navigator.geolocation.getCurrentPosition((pos) => {
            const node = { name: "My Current Location", lat: pos.coords.latitude, lng: pos.coords.longitude };
            const applied = applyTripNodeSelection(targetType, node, { alertOnFailure: true });
            if (!applied) {
                clearGeocodeSearchStatus(DOM, targetType);
                return;
            }

            if (targetType === 'stop' && mainSearch) {
                mainSearch.value = '';
                window.BARK.activeSearchQuery = '';
            }
        }, () => {
            alert("Could not get GPS location. Please check browser permissions.");
            if (targetType === 'stop' && mainSearch) mainSearch.value = '';
        }, { enableHighAccuracy: true });
        return;
    }

    // Standard API Search
    if (!isPremiumGlobalSearchUnlocked()) {
        alertGlobalSearchLocked();
        clearGeocodeSearchStatus(DOM, targetType);
        return;
    }

    try {
        const data = await fetchGlobalGeocode(query, { size: 5, country: 'US' });
        renderGeocodeResults(query, targetType, data);
    } catch (err) {
        console.error('Search geocode failed:', err);
        alert(err && err.code === 'launch-disabled'
            ? getPremiumGeocodeDisabledMessage()
            : "Search service unavailable.");
    }
}

window.BARK.executeGeocode = executeGeocode;
// Also expose on window for inline HTML handlers
window.processInlineSearch = function (type) {
    runInlinePlannerSearch(type, { executeGlobal: true });
};
