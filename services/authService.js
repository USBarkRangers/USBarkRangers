/**
 * authService.js - Firebase initialization and authentication lifecycle.
 * Phase 3 move-only extraction from dataService.js; hydration stays in place.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

let visitedSnapshotUnsubscribe = null;
let authenticatedSessionSeen = false;
let lastAuthenticatedUid = null;

const STANDALONE_CLOUD_SETTING_CONTROLS = {
    rememberMapPosition: 'remember-map-toggle',
    startNationalView: 'national-view-toggle',
    ultraLowEnabled: 'ultra-low-toggle'
};

function syncCheckboxControl(settingKey, elementId) {
    const input = document.getElementById(elementId);
    if (!input || !('checked' in input)) return;
    input.checked = Boolean(window[settingKey]);
}

function syncRegistrySettingControls(registry) {
    Object.entries(registry || {}).forEach(([settingKey, setting]) => {
        if (!setting || !setting.elementId) return;
        syncCheckboxControl(settingKey, setting.elementId);
    });
}

function syncStandaloneCloudSettingControls() {
    Object.entries(STANDALONE_CLOUD_SETTING_CONTROLS).forEach(([settingKey, elementId]) => {
        syncCheckboxControl(settingKey, elementId);
    });
}

function syncCloudSettingsControls(registry) {
    if (typeof window.BARK.syncSettingsControls === 'function') {
        window.BARK.syncSettingsControls();
    } else {
        syncRegistrySettingControls(registry);
    }

    syncStandaloneCloudSettingControls();
}

function handleCloudSettingsHydration(data, metadata = {}) {
    try {
        if (!(data.settings && !window._cloudSettingsLoaded)) return;
        if (!metadata.fromCache) window._cloudSettingsLoaded = true;

        if (sessionStorage.getItem('skipCloudHydration') === 'true') {
            sessionStorage.removeItem('skipCloudHydration');
            console.log("☁️ Cloud settings skipped: Preserving local force-reload state.");
            return;
        }

        const s = data.settings;
        const store = window.BARK.settings;
        const registry = window.BARK.SETTINGS_REGISTRY || {};

        // lowGfxEnabled must run first — its setter applies LOW_GRAPHICS_PRESET,
        // which individual settings set below can then override.
        if (Object.prototype.hasOwnProperty.call(s, 'lowGfxEnabled')) {
            store.set('lowGfxEnabled', s.lowGfxEnabled === true);
        }

        // standardClustering default: off, matching the public Google My Maps-like view.
        const cloudPremiumClustering = s.premiumClustering || false;
        const cloudStandardClustering = s.standardClustering === undefined
            ? false
            : s.standardClustering === true;

        Object.entries(registry).forEach(([settingKey, setting]) => {
            if (!setting.cloudKey || settingKey === 'lowGfxEnabled') return;

            let value;
            if (settingKey === 'standardClusteringEnabled') {
                value = cloudStandardClustering;
            } else if (settingKey === 'premiumClusteringEnabled') {
                value = cloudPremiumClustering;
            } else if (Object.prototype.hasOwnProperty.call(s, setting.cloudKey)) {
                value = s[setting.cloudKey] === true;
            } else {
                return;
            }
            store.set(settingKey, value);
        });

        // Non-registry settings: route through store so persist + window mirror stay consistent.
        if (Object.prototype.hasOwnProperty.call(s, 'ultraLowEnabled')) {
            store.set('ultraLowEnabled', s.ultraLowEnabled === true);
        }
        if (Object.prototype.hasOwnProperty.call(s, 'rememberMapPosition')) {
            store.set('rememberMapPosition', s.rememberMapPosition === true);
        }
        if (Object.prototype.hasOwnProperty.call(s, 'startNationalView')) {
            store.set('startNationalView', s.startNationalView === true);
        }

        syncCloudSettingsControls(registry);

        if (s.mapStyle) {
            localStorage.setItem('barkMapStyle', s.mapStyle);
            const styleEl = document.getElementById('map-style-select');
            if (styleEl) styleEl.value = s.mapStyle;
            if (typeof window.BARK.loadLayer === 'function') window.BARK.loadLayer(s.mapStyle);
        }
        if (s.visitedFilter) {
            localStorage.setItem('barkVisitedFilter', s.visitedFilter);
            const filterEl = document.getElementById('visited-filter');
            if (filterEl) filterEl.value = s.visitedFilter;
            window.BARK.visitedFilterState = s.visitedFilter;
        }

        window.BARK.applyGlobalStyles();
        if (typeof window.BARK.applyMapPerformancePolicy === 'function') window.BARK.applyMapPerformancePolicy();
        if (typeof window.syncState === 'function' && window.parkLookup && window.parkLookup.size > 0) {
            window.syncState();
        }

        const mapRef = (typeof map !== 'undefined') ? map : window.map;
        if (window.startNationalView && mapRef) {
            mapRef.setView([39.8283, -98.5795], 4, { animate: false });
        }

        console.log("☁️ Cloud settings loaded and injected perfectly!");
    } catch (error) {
        console.error("[authService] cloud settings hydration failed:", error);
    }
}

function handleAdminCheck(data, user) {
    try {
        const adminContainer = document.getElementById('admin-controls-container');
        window.isAdmin = data.isAdmin === true;

        if (adminContainer) {
            if (window.isAdmin) {
                adminContainer.innerHTML = `
                    <button onclick="window.location.href='pages/admin.html'" class="glass-btn primary-btn" style="width: 100%; background: #10b981; color: white; border: none; padding: 14px; border-radius: 12px; font-weight: 800; display: flex; justify-content: center; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"></path></svg>
                        Enter Data Refinery
                    </button>`;
            } else {
                adminContainer.innerHTML = '';
            }
        }
    } catch (error) {
        console.error("[authService] admin check failed:", error);
    }
}

function handleExpeditionSync(data) {
    try {
        if (data.virtual_expedition && data.virtual_expedition.active_trail) {
            const miles = data.virtual_expedition.miles_logged || 0;
            const total = data.virtual_expedition.trail_total_miles || 0;

            if (typeof window.BARK.renderVirtualTrailOverlay === 'function')
                window.BARK.renderVirtualTrailOverlay(data.virtual_expedition.active_trail, miles);
            if (typeof window.hydrateEducationModal === 'function')
                window.hydrateEducationModal(data.virtual_expedition.active_trail);

            const isComplete = total > 0 && miles >= total;

            document.getElementById('expedition-intro-state').style.display = 'none';
            document.getElementById('expedition-active-state').style.display = isComplete ? 'none' : 'block';
            document.getElementById('expedition-complete-state').style.display = isComplete ? 'block' : 'none';

            const nameEl = document.getElementById('expedition-name');
            if (nameEl) {
                nameEl.textContent = isComplete ? "CONQUERED" : data.virtual_expedition.trail_name;
                nameEl.dataset.trailName = data.virtual_expedition.trail_name;
            }

            if (isComplete) {
                const celebName = document.getElementById('celebration-trail-name');
                if (celebName) celebName.textContent = data.virtual_expedition.trail_name;
                const claimBtn = document.getElementById('claim-reward-btn');
                const trailPts = Math.max(1, Math.round(total / 2));
                if (claimBtn) claimBtn.textContent = `🎁 Claim +${trailPts} PTS & Reset`;
            }

            const lifetime = data.lifetime_miles || 0;
            if (typeof window.BARK.renderExpeditionProgress === 'function')
                window.BARK.renderExpeditionProgress(miles, total, lifetime);
            if (typeof window.BARK.renderExpeditionHistory === 'function')
                window.BARK.renderExpeditionHistory(data.virtual_expedition.history || [], data.virtual_expedition.trail_name);
        } else {
            document.getElementById('expedition-intro-state').style.display = 'block';
            document.getElementById('expedition-active-state').style.display = 'none';
            document.getElementById('expedition-complete-state').style.display = 'none';
            document.getElementById('expedition-name').textContent = '';
        }

        const cExpeditions = data.completed_expeditions || [];
        if (typeof window.BARK.renderCompletedExpeditions === 'function')
            window.BARK.renderCompletedExpeditions(cExpeditions);
        if (typeof window.BARK.renderCompletedTrailsOverlay === 'function')
            window.BARK.renderCompletedTrailsOverlay(cExpeditions);
    } catch (error) {
        console.error("[authService] expedition sync failed:", error);
    }
}

function handleVisitedPlacesSync(placeList, metadata = {}) {
    try {
        if (Array.isArray(placeList)) {
            const firebaseService = window.BARK.services && window.BARK.services.firebase;
            if (
                firebaseService &&
                typeof firebaseService.reconcileVisitedPlacesSnapshot === 'function' &&
                typeof firebaseService.replaceLocalVisitedPlaces === 'function'
            ) {
                firebaseService.replaceLocalVisitedPlaces(
                    firebaseService.reconcileVisitedPlacesSnapshot(placeList, metadata)
                );
            } else {
                const visitedPlaces = window.BARK.userVisitedPlaces instanceof Map
                    ? window.BARK.userVisitedPlaces
                    : new Map();
                visitedPlaces.clear();
                placeList.forEach(obj => {
                    if (obj && obj.id) visitedPlaces.set(obj.id, obj);
                });
                if (!(window.BARK.userVisitedPlaces instanceof Map)) {
                    window.BARK.userVisitedPlaces = visitedPlaces;
                }
                if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
                    window.BARK.invalidateVisitedIdsCache();
                }
                if (firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function') {
                    firebaseService.refreshVisitedVisualState();
                }
            }
            if (firebaseService && typeof firebaseService.normalizeLocalVisitedPlacesToCanonical === 'function') {
                firebaseService.normalizeLocalVisitedPlacesToCanonical({ writeBack: true })
                    .catch(error => console.error('[authService] visited-place canonicalization failed:', error));
            }
        }
    } catch (error) {
        console.error("[authService] visited places sync failed:", error);
    }
}

function handlePremiumGating(isLoggedIn) {
    try {
        const premiumWrap = document.getElementById('premium-filters-wrap');
        const visitedSelect = document.getElementById('visited-filter');
        const mapStyleSelectF = document.getElementById('map-style-select');
        const trailButtons = [
            document.getElementById('toggle-virtual-trail'),
            document.getElementById('toggle-completed-trails')
        ].filter(Boolean);

        if (premiumWrap) {
            if (isLoggedIn) {
                premiumWrap.classList.remove('premium-locked');
                premiumWrap.classList.add('premium-unlocked');
                if (visitedSelect) visitedSelect.disabled = false;
                if (mapStyleSelectF) mapStyleSelectF.disabled = false;
                trailButtons.forEach(btn => {
                    btn.disabled = false;
                    btn.setAttribute('aria-disabled', 'false');
                });
            } else {
                premiumWrap.classList.add('premium-locked');
                premiumWrap.classList.remove('premium-unlocked');
                if (visitedSelect) { visitedSelect.disabled = true; visitedSelect.value = 'all'; }
                if (mapStyleSelectF) { mapStyleSelectF.disabled = true; mapStyleSelectF.value = 'default'; }
                trailButtons.forEach(btn => {
                    btn.classList.remove('active');
                    btn.disabled = true;
                    btn.setAttribute('aria-disabled', 'true');
                });
            }
        }
    } catch (error) {
        console.error("[authService] premium gating failed:", error);
    }
}

function setGuestDefaultSetting(key, value) {
    const store = window.BARK.settings;
    try {
        if (store && typeof store.set === 'function') {
            store.set(key, value);
        } else {
            window[key] = value;
        }
    } catch (error) {
        console.warn(`[authService] failed to reset setting "${key}" on logout:`, error);
    }
}

function resetGuestSettingsToDefaults() {
    const registry = window.BARK.SETTINGS_REGISTRY || {};

    setGuestDefaultSetting('ultraLowEnabled', false);
    if (registry.lowGfxEnabled) setGuestDefaultSetting('lowGfxEnabled', registry.lowGfxEnabled.defaultValue === true);

    Object.entries(registry).forEach(([settingKey, setting]) => {
        if (settingKey === 'lowGfxEnabled') return;
        setGuestDefaultSetting(settingKey, setting.defaultValue === true);
    });

    setGuestDefaultSetting('rememberMapPosition', false);
    setGuestDefaultSetting('startNationalView', true);
    setGuestDefaultSetting('limitZoomOut', true);

    if (typeof window.BARK.syncSettingsControls === 'function') window.BARK.syncSettingsControls();
    if (typeof window.BARK.applyGlobalStyles === 'function') window.BARK.applyGlobalStyles();
    if (typeof window.BARK.applyMapPerformancePolicy === 'function') window.BARK.applyMapPerformancePolicy();

    const mapRef = window.map || (typeof map !== 'undefined' ? map : null);
    if (mapRef) {
        if (mapRef.dragging && typeof mapRef.dragging.enable === 'function') mapRef.dragging.enable();
        if (mapRef.touchZoom && typeof mapRef.touchZoom.enable === 'function') mapRef.touchZoom.enable();
    }
}

function applyGuestZoomLimitDefault() {
    setGuestDefaultSetting('limitZoomOut', true);
    if (typeof window.BARK.syncSettingsControls === 'function') window.BARK.syncSettingsControls();
    if (typeof window.BARK.applyMapPerformancePolicy === 'function') window.BARK.applyMapPerformancePolicy();
}

function resetMapStyleToDefault() {
    localStorage.setItem('barkMapStyle', 'default');

    const mapStyleSelect = document.getElementById('map-style-select');
    if (mapStyleSelect) mapStyleSelect.value = 'default';
    if (typeof window.BARK.loadLayer === 'function') window.BARK.loadLayer('default');
}

function resetSearchAndFilterState() {
    window.BARK.activeSearchQuery = '';
    window.BARK.activeTypeFilter = 'all';
    if (window.BARK.activeSwagFilters && typeof window.BARK.activeSwagFilters.clear === 'function') {
        window.BARK.activeSwagFilters.clear();
    } else {
        window.BARK.activeSwagFilters = new Set();
    }

    window.BARK._searchResultCache = {
        query: '',
        matchedIds: null,
        complete: true,
        processedCount: 0,
        totalCount: 0
    };
    window._lastFilterState = null;

    localStorage.setItem('barkVisitedFilter', 'all');
    window.BARK.visitedFilterState = 'all';

    const searchInput = document.getElementById('park-search');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const searchSuggestions = document.getElementById('search-suggestions');
    const typeFilter = document.getElementById('type-filter');
    const visitedFilter = document.getElementById('visited-filter');

    if (searchInput) searchInput.value = '';
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';
    if (searchSuggestions) {
        searchSuggestions.style.display = 'none';
        searchSuggestions.innerHTML = '';
    }
    if (typeFilter) typeFilter.value = 'all';
    if (visitedFilter) visitedFilter.value = 'all';

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
}

function resetVisitedAndPanelState() {
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (firebaseService && typeof firebaseService.clearVisitedPlacePendingMutations === 'function') {
        firebaseService.clearVisitedPlacePendingMutations();
    }

    if (window.BARK.userVisitedPlaces instanceof Map) {
        window.BARK.userVisitedPlaces.clear();
    } else {
        window.BARK.userVisitedPlaces = new Map();
    }

    if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
        window.BARK.invalidateVisitedIdsCache();
    } else if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
        window.BARK.invalidateMarkerVisibility();
    }
    if (firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function') {
        firebaseService.refreshVisitedVisualState();
    }

    if (typeof window.BARK.clearActivePin === 'function') window.BARK.clearActivePin();

    const slidePanel = document.getElementById('slide-panel');
    const visitedSection = document.getElementById('panel-visited-section');
    if (slidePanel) slidePanel.classList.remove('open');
    if (visitedSection) visitedSection.style.display = 'none';
}

function resetSavedRouteLists() {
    const savedList = document.getElementById('saved-routes-list');
    const plannerList = document.getElementById('planner-saved-routes-list');
    const savedCount = document.getElementById('saved-routes-count');
    const plannerContainer = document.getElementById('planner-saved-routes-container');

    if (savedList) savedList.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Sign in to view saved routes.</p>';
    if (plannerList) plannerList.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Please log in to see saved routes.</p>';
    if (savedCount) savedCount.textContent = '0';
    if (plannerContainer) plannerContainer.style.display = 'none';
}

function resetAdminUi() {
    const adminContainer = document.getElementById('admin-controls-container');
    if (adminContainer) adminContainer.innerHTML = '';
}

function resetMapViewToGuestDefault() {
    const mapRef = window.map || (typeof map !== 'undefined' ? map : null);
    if (!mapRef || typeof mapRef.setView !== 'function') return;

    const guestZoom = 5;

    localStorage.removeItem('mapLat');
    localStorage.removeItem('mapLng');
    localStorage.removeItem('mapZoom');
    mapRef.setView([39.8283, -98.5795], guestZoom, { animate: false });

    if (mapRef.locate && navigator.geolocation) {
        mapRef.locate({ setView: true, maxZoom: guestZoom, watch: false });
    }
}

function restoreGuestMarkerLayer() {
    const points = Array.isArray(window.BARK.allPoints) ? window.BARK.allPoints : [];
    if (!points.length) return;

    points.forEach(point => {
        if (!point || !point.marker) return;
        point.marker._barkIsVisible = true;
        if (point.marker._icon) {
            point.marker._icon.classList.remove('marker-filter-hidden');
            point.marker._icon.classList.remove('visited-pin');
            point.marker._icon.classList.remove('visited-marker');
            point.marker._icon.classList.add('unvisited-marker');
        }
    });

    if (window.BARK.markerManager && typeof window.BARK.markerManager.sync === 'function') {
        window.BARK.markerManager.sync(points);
    }

    if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
        window.BARK.invalidateMarkerVisibility();
    }

    const mapViewActive = typeof window.BARK.isMapVisibleByDefaultViewState !== 'function' || window.BARK.isMapVisibleByDefaultViewState();
    if (mapViewActive && !window.BARK._isZooming && typeof window.BARK.updateMarkers === 'function') {
        window.BARK.updateMarkers();
    } else if (typeof window.syncState === 'function') {
        window.BARK._pendingMarkerSync = true;
        window.syncState();
    }
}

function scheduleGuestMarkerRestore() {
    restoreGuestMarkerLayer();
    requestAnimationFrame(restoreGuestMarkerLayer);
    setTimeout(restoreGuestMarkerLayer, 250);
}

function resetLoggedOutRuntimeState() {
    window._cloudSettingsLoaded = false;
    window._leaderboardLoadedOnce = false;
    window.currentWalkPoints = 0;
    window.isAdmin = false;
    resetAdminUi();

    resetGuestSettingsToDefaults();
    resetMapStyleToDefault();
    resetSearchAndFilterState();
    resetVisitedAndPanelState();

    if (typeof window.BARK.resetTripPlannerRuntime === 'function') {
        window.BARK.resetTripPlannerRuntime();
    }
    if (typeof window.BARK.resetExpeditionRuntimeState === 'function') {
        window.BARK.resetExpeditionRuntimeState();
    }

    resetSavedRouteLists();
    resetMapViewToGuestDefault();

    scheduleGuestMarkerRestore();
    if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
}

function initFirebase() {
    if (typeof firebase === 'undefined') return;

    const loadSavedRoutes = window.BARK.loadSavedRoutes;

    try {
        firebase.initializeApp(window.BARK.firebaseConfig);
    } catch (error) {
        console.error("[authService] initializeApp failed:", error);
        throw error;
    }

    try {
        firebase.auth().onAuthStateChanged((user) => {
            window._lastSyncedScore = window._lastSyncedScore || 0;
            window.isAdmin = false;
            window._serverPayloadSettled = false;
            window._firstServerPayloadReceived = false;
            window._lastKnownRank = null;
            window.currentWalkPoints = window.currentWalkPoints || 0;

            const loginContainer = document.getElementById('login-container');
            const offlineStatusContainer = document.getElementById('offline-status-container');
            const logoutBtn = document.getElementById('logout-btn');
            const profileName = document.getElementById('user-profile-name');

            if (user) {
                if (lastAuthenticatedUid !== user.uid) {
                    window._cloudSettingsLoaded = false;
                }
                authenticatedSessionSeen = true;
                lastAuthenticatedUid = user.uid;
                window._serverPayloadSettled = false;
                window._firstServerPayloadReceived = false;
                window._lastSyncedScore = -1;

                if (loginContainer) loginContainer.style.display = 'none';
                if (offlineStatusContainer) offlineStatusContainer.style.display = 'block';
                if (logoutBtn) logoutBtn.style.display = 'block';
                if (profileName) profileName.textContent = user.displayName || user.email || 'Bark Ranger';

                try {
                    window.BARK.incrementRequestCount();
                    visitedSnapshotUnsubscribe = firebase.firestore().collection('users').doc(user.uid)
                        .onSnapshot((doc) => {
                            const currentUser = firebase.auth().currentUser;
                            if (!currentUser || currentUser.uid !== user.uid) return;

                            if (!doc.metadata.fromCache && !window._firstServerPayloadReceived) {
                                window._firstServerPayloadReceived = true;
                                setTimeout(() => { window._serverPayloadSettled = true; }, 1000);
                            }

                            if (doc.exists) {
                                const data = doc.data();

                                handleCloudSettingsHydration(data, doc.metadata);

                                const placeList = data.visitedPlaces || [];

                                handleAdminCheck(data, user);

                                // Streak & Walk Points
                                const streakVal = data.streakCount || 0;
                                let walkVal = data.walkPoints || 0;
                                const lifetimeVal = data.lifetime_miles || 0;

                                if (lifetimeVal > walkVal) {
                                    walkVal = lifetimeVal;
                                    try {
                                        firebase.firestore().collection('users').doc(user.uid).update({ walkPoints: lifetimeVal })
                                            .catch(error => console.error("[authService] walkPoints backfill failed:", error));
                                    } catch (error) {
                                        console.error("[authService] walkPoints backfill failed:", error);
                                    }
                                }

                                const streakLabel = document.getElementById('streak-count-label');
                                if (streakLabel) streakLabel.textContent = streakVal;

                                window.currentWalkPoints = Math.round(walkVal * 100) / 100;

                                handleExpeditionSync(data);
                                handleVisitedPlacesSync(placeList, doc.metadata);
                            } else {
                                handleVisitedPlacesSync([], doc.metadata);
                            }
                            window.syncState();
                            if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();

                            if (!window._leaderboardLoadedOnce) {
                                window._leaderboardLoadedOnce = true;
                                if (typeof window.BARK.loadLeaderboard === 'function') window.BARK.loadLeaderboard();
                            }

                            window.dismissBarkLoader();

                            if (window.BARK.activePinMarker && window.BARK.activePinMarker._parkData && document.getElementById('mark-visited-btn')) {
                                const d = window.BARK.activePinMarker._parkData;
                                const btn = document.getElementById('mark-visited-btn');
                                const btnText = document.getElementById('mark-visited-text');
                                const isVisited = typeof window.BARK.isParkVisited === 'function'
                                    ? window.BARK.isParkVisited(d)
                                    : window.BARK.userVisitedPlaces.has(d.id);
                                if (isVisited) {
                                    btn.classList.add('visited');
                                    btnText.textContent = 'Visited!';
                                } else {
                                    btn.classList.remove('visited');
                                    btnText.textContent = 'Mark as Visited';
                                }
                            }
                        }, (error) => {
                            console.error("[authService] user snapshot failed:", error);
                        });
                } catch (error) {
                    console.error("[authService] subscribe user document failed:", error);
                }

                if (typeof loadSavedRoutes === 'function') loadSavedRoutes(user.uid);
                handlePremiumGating(true);
            } else {
                const shouldResetRuntime = authenticatedSessionSeen || lastAuthenticatedUid !== null;
                authenticatedSessionSeen = false;
                lastAuthenticatedUid = null;

                if (visitedSnapshotUnsubscribe) {
                    visitedSnapshotUnsubscribe();
                    visitedSnapshotUnsubscribe = null;
                }

                if (loginContainer) loginContainer.style.display = 'block';
                if (offlineStatusContainer) offlineStatusContainer.style.display = 'none';
                if (logoutBtn) logoutBtn.style.display = 'none';

                if (shouldResetRuntime) {
                    resetLoggedOutRuntimeState();
                } else {
                    window.BARK.userVisitedPlaces.clear();
                    if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
                        window.BARK.invalidateVisitedIdsCache();
                    }
                    const firebaseService = window.BARK.services && window.BARK.services.firebase;
                    if (firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function') {
                        firebaseService.refreshVisitedVisualState();
                    }
                    if (typeof window.BARK.clearActivePin === 'function') window.BARK.clearActivePin();
                    applyGuestZoomLimitDefault();
                    resetMapViewToGuestDefault();
                    window.syncState();
                    if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
                }

                window.dismissBarkLoader();
                if (typeof window.BARK.loadLeaderboard === 'function') window.BARK.loadLeaderboard();

                resetSavedRouteLists();

                handlePremiumGating(false);
            }
        });
    } catch (error) {
        console.error("[authService] onAuthStateChanged setup failed:", error);
        throw error;
    }

    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                window.BARK.incrementRequestCount();
                await firebase.auth().signInWithPopup(provider);
            } catch (error) {
                console.error("[authService] signInWithPopup failed:", error);
                alert("Login Error: " + error.message);
            }
        });
    }

    const logoutBtnEl = document.getElementById('logout-btn');
    if (logoutBtnEl) {
        logoutBtnEl.addEventListener('click', async () => {
            try {
                await firebase.auth().signOut();
            } catch (error) {
                console.error("[authService] signOut failed:", error);
            }
        });
    }

    // Email Suggestion Template
    const emailSuggestBtn = document.getElementById('email-suggest-btn');
    if (emailSuggestBtn) {
        const subject = encodeURIComponent("B.A.R.K. Map: Suggest a New Place");
        const bodyTemplate = [
            "--- B.A.R.K. Ranger Map Suggestion ---",
            "Park Name:", "State:",
            "Swag Available (Tag/Bandana/Certificate/Other):",
            "Cost (Free/$$/Other):", "Park Entrance Fee:",
            "ADA Accessibility Areas:", "Useful Info / Rules:",
            "Official Website Link:", "",
            "--- IMPORTANT ---",
            "Please attach photos of the swag, the park entrance, or any relevant signage to help us verify this location! 🐾"
        ].join("\n");
        emailSuggestBtn.href = `mailto:usbarkrangers@gmail.com?subject=${subject}&body=${encodeURIComponent(bodyTemplate)}`;
    }
}

window.BARK.services.auth = { initFirebase };
window.BARK.initFirebase = initFirebase;
