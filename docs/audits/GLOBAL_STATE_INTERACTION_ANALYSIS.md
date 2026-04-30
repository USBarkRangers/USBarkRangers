# B.A.R.K. Ranger Map Global State Interaction Analysis

Phase: 1 - dependency and state interaction map  
Date: 2026-04-28  
Scope: browser runtime files loaded by `index.html`, plus `pages/admin.js`. Server functions, build/migration scripts, tests, and legacy snapshots are not part of the live PWA global graph.

## Part 1: Component Breakdown

### Boot Chain

Load order in `index.html` is:

```text
utils/geoUtils.js
utils/scoringUtils.js
gamificationLogic.js
MapMarkerConfig.js
modules/settingsRegistry.js
modules/barkState.js
modules/barkConfig.js
config/domRefs.js
state/settingsStore.js
state/appState.js
services/orsService.js
services/firebaseService.js
renderers/routeRenderer.js
services/checkinService.js
services/authService.js
modules/markerLayerPolicy.js
modules/MarkerLayerManager.js
modules/mapEngine.js
modules/renderEngine.js
renderers/panelRenderer.js
modules/searchEngine.js
modules/dataService.js
modules/profileEngine.js
modules/expeditionEngine.js
engines/tripPlannerCore.js
modules/shareEngine.js
modules/settingsController.js
modules/uiController.js
core/app.js
```

`core/app.js` then calls `window.BARK.init*()` functions after all classic scripts have registered themselves on `window.BARK` or `window`.

### `utils/geoUtils.js`

- Primary Responsibility: Shared geospatial and point helpers.
- Global Reads: `window.BARK`.
- Global Writes: `window.BARK`, `window.BARK.generatePinId`, `window.BARK.haversineDistance`, `window.BARK.sanitizeWalkPoints`, `window.BARK.utils.geo.haversine`.
- Triggers/Executions: None.
- Implicit Dependencies: Must run before `modules/barkState.js`, `services/checkinService.js`, `modules/profileEngine.js`, and `engines/tripPlannerCore.js`.

### `utils/scoringUtils.js`

- Primary Responsibility: Central visit scoring formulas.
- Global Reads: `window.BARK.sanitizeWalkPoints`.
- Global Writes: `window.BARK.countVerifiedAndRegular`, `window.BARK.calculateVisitScore`.
- Triggers/Executions: Calls `window.BARK.sanitizeWalkPoints()`.
- Implicit Dependencies: `utils/geoUtils.js` must already have registered `sanitizeWalkPoints`.

### `gamificationLogic.js`

- Primary Responsibility: Encapsulates badge/title calculation and achievement persistence.
- Global Reads: `window.BARK.calculateVisitScore`, global `firebase`.
- Global Writes: `window.GamificationEngine`.
- Triggers/Executions: Calls `window.BARK.calculateVisitScore()`, `firebase.firestore()`, achievement batch writes.
- Implicit Dependencies: `utils/scoringUtils.js` for scoring; Firebase SDK only needed when storing achievements.

### `MapMarkerConfig.js`

- Primary Responsibility: Factory for Leaflet pin markers and marker HTML.
- Global Reads: global Leaflet `L`.
- Global Writes: `window.MapMarkerConfig`.
- Triggers/Executions: Calls `L.divIcon()` and `L.marker()` when marker creation is requested.
- Implicit Dependencies: Leaflet SDK must be loaded before use.

### `modules/settingsRegistry.js`

- Primary Responsibility: Declarative schema for settings, effects, and low-graphics presets.
- Global Reads: `window.BARK.SETTING_IMPACTS`.
- Global Writes: `window.BARK`, `window.BARK.SETTING_IMPACTS`, `window.BARK.SETTINGS_REGISTRY`, `window.BARK.PERFORMANCE_SETTING_KEYS`, `window.BARK.LOW_GRAPHICS_PRESET`.
- Triggers/Executions: None.
- Implicit Dependencies: Must run before `state/settingsStore.js` and `modules/settingsController.js`.

### `modules/barkState.js`

- Primary Responsibility: Initial legacy state bootstrap and live `window.BARK` property accessors.
- Global Reads: `window.BARK.generatePinId`, `window.BARK.haversineDistance`, `window.BARK.sanitizeWalkPoints`, `window.currentWalkPoints`, localStorage.
- Global Writes: `window.BARK.APP_VERSION`, `window.BARK.setAppVersion`, `window.BARK.incrementRequestCount`, `window.BARK` accessors for `allPoints`, `_searchResultCache`, `activePinMarker`, `activeSwagFilters`, `activeSearchQuery`, `activeTypeFilter`, `userVisitedPlaces`, `visitedFilterState`, `tripDays`, `activeDayIdx`; raw globals `allowUncheck`, `standardClusteringEnabled`, `premiumClusteringEnabled`, `clusteringEnabled`, `lowGfxEnabled`, `simplifyTrails`, `instantNav`, `rememberMapPosition`, `startNationalView`, `stopAutoMovements`, `reducePinMotion`, `removeShadows`, `stopResizing`, `viewportCulling`, `forcePlainMarkers`, `limitZoomOut`, `simplifyPinsWhileMoving`, `ultraLowEnabled`, `lockMapPanning`, `disable1fingerZoom`, `disableDoubleTap`, `disablePinchZoom`, `parkLookup`, `SESSION_MAX_REQUESTS`, `_SESSION_REQUEST_COUNT`, `_cloudSettingsLoaded`, `tripStartNode`, `tripEndNode`, `gamificationEngine`, `currentWalkPoints`, `_lastSyncedScore`.
- Triggers/Executions: Instantiates `new GamificationEngine()`.
- Implicit Dependencies: `geoUtils.js`, `scoringUtils.js`, and `gamificationLogic.js` must load first.

### `modules/barkConfig.js`

- Primary Responsibility: Constants for search normalization, Firebase config, ORS config, check-in radius, and trails.
- Global Reads: `window.BARK.config`.
- Global Writes: `window.BARK.normalizationDict`, `window.BARK.firebaseConfig`, `window.BARK.config.ORS_API_KEY`, `window.BARK.config.CHECKIN_RADIUS_KM`, `window.BARK.TOP_10_TRAILS`.
- Triggers/Executions: None.
- Implicit Dependencies: Must run before ORS, auth, search, check-in, and expedition code uses config.

### `config/domRefs.js`

- Primary Responsibility: Central lazy DOM reference registry.
- Global Reads: `window.BARK`.
- Global Writes: `window.BARK.DOM`.
- Triggers/Executions: None at registration; later callers execute DOM getter functions.
- Implicit Dependencies: Must load before controllers and engines that call `window.BARK.DOM.*`.

### `state/settingsStore.js`

- Primary Responsibility: Canonical settings store with localStorage persistence and legacy `window.*` mirrors.
- Global Reads: `window.BARK.SETTINGS_REGISTRY`, `window.BARK.LOW_GRAPHICS_PRESET`, localStorage.
- Global Writes: `window.BARK.settings`; `Object.defineProperty` mirrors on raw `window.*` settings including `allowUncheck`, clustering settings, graphics settings, map gesture settings, and derived `clusteringEnabled`.
- Triggers/Executions: Persists to localStorage, notifies settings listeners.
- Implicit Dependencies: `settingsRegistry.js` should load first; overwrites raw setting globals initialized by `barkState.js`.

### `state/appState.js`

- Primary Responsibility: Runtime app state store with legacy `window.*` mirrors.
- Global Reads: `window.BARK.*` state accessors, `window.tripStartNode`, `window.tripEndNode`, `window.draftBookendMarkers`, `window.draftCustomMarkers`, `window.isTripEditMode`, `window.isAdmin`, `window.currentWalkPoints`, `window.parkLookup`.
- Global Writes: `window.BARK.appState`; `Object.defineProperty` mirrors for `allPoints`, `userVisitedPlaces`, `activePin`, filters, trip state, admin state, walk points, and `parkLookup`.
- Triggers/Executions: Store listeners only.
- Implicit Dependencies: Should run after `barkState.js` so it mirrors the live BARK accessors instead of fallback state.

### `services/orsService.js`

- Primary Responsibility: OpenRouteService geocode/directions transport boundary.
- Global Reads: `window.BARK.config.ORS_API_KEY`.
- Global Writes: `window.BARK.services.ors`.
- Triggers/Executions: Network `fetch()` to ORS endpoints when called.
- Implicit Dependencies: `barkConfig.js` must register ORS API key first.

### `services/firebaseService.js`

- Primary Responsibility: Firestore CRUD helpers for user progress, visits, saved routes, and admin points.
- Global Reads: global `firebase`, `window.BARK.userVisitedPlaces`, `window.currentWalkPoints`, `window.isAdmin`.
- Global Writes: `window.BARK.services.firebase`, `window.BARK.syncUserProgress`, `window.BARK.updateCurrentUserVisitedPlaces`, `window.BARK.updateVisitDate`, `window.BARK.removeVisitedPlace`, `window.attemptDailyStreakIncrement`, `window.adminEditPoints`; mutates `window.BARK.userVisitedPlaces` contents via delete/update paths.
- Triggers/Executions: Calls `window.BARK.incrementRequestCount()`, `window.syncState()`, `window.BARK.invalidateVisitedIdsCache()`, `window.BARK.renderManagePortal()`, Firestore reads/writes.
- Implicit Dependencies: Firebase SDK, `barkState.js` request counter and visit Map, `renderEngine.js` for `syncState`, `profileEngine.js` for manage portal.

### `renderers/routeRenderer.js`

- Primary Responsibility: Saved-route list rendering and route load/delete controller glue.
- Global Reads: `window.BARK.services.firebase`.
- Global Writes: `window.BARK.renderers.routes`, `window.BARK.renderRoutesList`, `window.BARK.loadSavedRoutes`, `window.togglePlannerRoutes`, plus `window.BARK.tripDays` and `window.BARK.activeDayIdx` when loading a route.
- Triggers/Executions: Calls Firebase service route methods, `window.BARK.updateTripUI()`, `window.BARK.showTripToast()`, route-list DOM events.
- Implicit Dependencies: `services/firebaseService.js`, `engines/tripPlannerCore.js` for `updateTripUI` and toast.

### `services/checkinService.js`

- Primary Responsibility: GPS check-in validation and visit record mutation.
- Global Reads: `window.BARK.services.firebase`, `window.BARK.userVisitedPlaces`, `window.BARK.utils.geo.haversine`, `window.BARK.config.CHECKIN_RADIUS_KM`, `window.allowUncheck`.
- Global Writes: `window.BARK.services.checkin`; mutates the visited places Map passed in or `window.BARK.userVisitedPlaces`.
- Triggers/Executions: Calls `navigator.geolocation.getCurrentPosition()`, Firebase service visit update/sync methods, `window.BARK.invalidateVisitedIdsCache()`, daily streak increment.
- Implicit Dependencies: `geoUtils.js`, `barkConfig.js`, `firebaseService.js`, `barkState.js`.

### `services/authService.js`

- Primary Responsibility: Firebase app initialization, auth lifecycle, and user document hydration.
- Global Reads: global `firebase`, `window.BARK.firebaseConfig`, `window.BARK.settings`, `window.BARK.SETTINGS_REGISTRY`, `window.BARK.loadSavedRoutes`, `window.BARK.activePinMarker`, `window.parkLookup`, map via `map`/`window.map`, settings globals.
- Global Writes: `window.BARK.services.auth`, `window.BARK.initFirebase`, `window.BARK.visitedFilterState`, `window.BARK.userVisitedPlaces`, `window._cloudSettingsLoaded`, `window.isAdmin`, `window._lastSyncedScore`, `window._serverPayloadSettled`, `window._firstServerPayloadReceived`, `window._lastKnownRank`, `window.currentWalkPoints`, `window._leaderboardLoadedOnce`.
- Triggers/Executions: Calls `firebase.initializeApp()`, `firebase.auth().onAuthStateChanged()`, Firestore `onSnapshot()`, `window.BARK.applyGlobalStyles()`, `window.BARK.applyMapPerformancePolicy()`, `window.BARK.loadLayer()`, `window.syncState()`, `window.BARK.updateStatsUI()`, `window.BARK.loadLeaderboard()`, `window.dismissBarkLoader()`, expedition renderers, Google sign-in/sign-out.
- Implicit Dependencies: Firebase SDK; `barkConfig.js`; `settingsStore.js`; map/render/profile/expedition/route modules are assumed to have registered functions before auth callbacks fire.

### `modules/markerLayerPolicy.js`

- Primary Responsibility: Decides marker layer mode and performance policy.
- Global Reads: `window.map`, `window.premiumClusteringEnabled`, `window.clusteringEnabled`, `window.forcePlainMarkers`, `window.stopResizing`, `window.viewportCulling`, `window.lowGfxEnabled`, `window.ultraLowEnabled`, `window.simplifyPinsWhileMoving`, `window.limitZoomOut`.
- Global Writes: `window.BARK.getMarkerLayerPolicy`.
- Triggers/Executions: Calls `window.map.getZoom()` if no zoom is passed.
- Implicit Dependencies: Settings mirrors from `settingsStore.js`; map optional.

### `modules/MarkerLayerManager.js`

- Primary Responsibility: Owns Leaflet marker cache, layer movement, and marker click dispatch.
- Global Reads: `window.BARK.userVisitedPlaces`, `window.BARK.activePinMarker`, `window.BARK.getMarkerLayerPolicy`, `window.BARK.renderMarkerClickPanel`, `window.BARK.services.firebase`, `window.BARK.allPoints`, fallback clustering globals, `window.parkLookup`, `MapMarkerConfig`.
- Global Writes: `window.BARK.MarkerLayerManager`, `window.MarkerLayerManager`, `window.BARK._lastLayerType`, `window.BARK.activePinMarker`, `window.parkLookup` contents, point `.marker` references.
- Triggers/Executions: Calls `window.BARK.renderMarkerClickPanel()`, `window.BARK.getMarkerLayerPolicy()`, Leaflet layer methods.
- Implicit Dependencies: `MapMarkerConfig.js`, `markerLayerPolicy.js`, `panelRenderer.js`, `barkState.js` for `parkLookup`.

### `modules/mapEngine.js`

- Primary Responsibility: Leaflet map initialization, tile layers, controls, marker layer groups, map performance behavior.
- Global Reads: Leaflet `L`, settings globals, `window.BARK.getMarkerLayerPolicy`, `window.BARK.MarkerLayerManager`, `window.BARK.allPoints`, `window.map`.
- Global Writes: `window.dismissBarkLoader`, `window.map`, `window.BARK.applyGlobalStyles`, `window.BARK.initMap`, `window.BARK.applyMapPerformancePolicy`, `window.BARK.loadLayer`, `window.BARK.getUserLocationMarker`, `window.BARK.markerLayer`, `window.BARK.markerClusterGroup`, `window.BARK.markerManager`, `window.BARK._lastLayerType`, `window.BARK.rebuildMarkerLayer`, `window.BARK._isMoving`, `window.BARK._isZooming`, `window.BARK._pendingMarkerSync`, `window._cullingTimeout`.
- Triggers/Executions: Calls `window.syncState()`, `window.BARK.invalidateMarkerVisibility()`, Leaflet `L.map`, controls, events, layer creation, browser geolocation through `map.locate()`.
- Implicit Dependencies: Leaflet SDK, `MarkerLayerManager.js`, `markerLayerPolicy.js`, settings globals/stores, `renderEngine.js` for `syncState` once events fire.

### `modules/renderEngine.js`

- Primary Responsibility: Central render heartbeat, marker filtering, marker visibility cache, DOM-safe HTML helper.
- Global Reads: `window.map`, `window.BARK.allPoints`, search/filter/trip/visited state, `window.BARK.markerManager`, `window.BARK.evaluateAchievements`, marker policy, many settings globals.
- Global Writes: `window.syncState`, `window.BARK.getColor`, `window.BARK.getBadgeClass`, `window.BARK.getParkCategory`, `window.BARK.getSwagType`, `window.BARK.formatSwagLinks`, `window.BARK.safeUpdateHTML`, `window.BARK.invalidateMarkerVisibility`, `window.BARK.invalidateVisitedIdsCache`, `window.BARK.isMapViewActive`, `window.BARK.updateMarkers`, `window.BARK._visitedIdsCacheKey`, `window.BARK._pendingMarkerSync`, `window.BARK._lastLayerType`, `window._lastFilterState`.
- Triggers/Executions: Calls `requestAnimationFrame()`, `window.BARK.updateMarkers()`, `window.BARK.updateStatsUI()`, debounced `window.BARK.evaluateAchievements()`, marker manager sync/applyVisibility.
- Implicit Dependencies: `mapEngine.js` for `window.map` and marker manager, `searchEngine.js` for `normalizeText`, `profileEngine.js` for stats/achievements once available.

### `renderers/panelRenderer.js`

- Primary Responsibility: Marker click panel rendering and check-in button wiring.
- Global Reads: `window.BARK.activePinMarker`, `window.BARK.tripDays`, `window.BARK.services.firebase`, `window.BARK.services.checkin`, `window.BARK.config.CHECKIN_RADIUS_KM`, `window.allowUncheck`, map via bare `map`, `window.stopAutoMovements`, `window.instantNav`.
- Global Writes: `window.BARK.renderMarkerClickPanel`, `window.BARK.activePinMarker`.
- Triggers/Executions: Calls `window.BARK.formatSwagLinks()`, `window.addStopToTrip()`, check-in service methods, `window.syncState()`, `window.BARK.updateStatsUI()`, Leaflet map pan.
- Implicit Dependencies: `renderEngine.js` helper exports, `checkinService.js`, `firebaseService.js`, `tripPlannerCore.js`, `mapEngine.js`.

### `modules/searchEngine.js`

- Primary Responsibility: Search input, fuzzy matching, local suggestions, and ORS geocoding.
- Global Reads: `window.BARK.normalizationDict`, `window.BARK.DOM`, `window.BARK.allPoints`, `window.BARK.activeSearchQuery`, `window.BARK.services.ors`, `window.stopAutoMovements`, `window.instantNav`, `window.lowGfxEnabled`, `firebase`, bare `map`.
- Global Writes: `window.BARK.normalizeText`, `window.BARK.levenshtein`, `window.BARK.initSearchEngine`, `window.BARK.executeGeocode`, `window.processInlineSearch`, `window.BARK._searchResultCache`, `window.BARK.activeSearchQuery`, `window.BARK.activeTypeFilter`, contents of `window.BARK.activeSwagFilters`, `window.tripStartNode`, `window.tripEndNode`.
- Triggers/Executions: Calls `window.syncState()`, `window.BARK.incrementRequestCount()`, `window.BARK.services.ors.geocode()`, `window.addStopToTrip()`, `window.BARK.updateTripUI()`, `navigator.geolocation.getCurrentPosition()`, `map.setView()`.
- Implicit Dependencies: `barkConfig.js`, `domRefs.js`, `orsService.js`, `renderEngine.js`, `tripPlannerCore.js`, Firebase SDK for premium detection.

### `modules/dataService.js`

- Primary Responsibility: CSV parsing, cache hydration, map data polling, and app version polling.
- Global Reads: `window.BARK.allPoints`, `window.BARK.getSwagType`, `window.BARK.getParkCategory`, `window.BARK.normalizeText`, `window.BARK.markerManager`, `window.BARK.markerLayer`, `window.gamificationEngine`, `window.ultraLowEnabled`, `navigator.onLine`.
- Global Writes: `window.BARK.parseCSVString`, `window.BARK.allPoints`, `window.BARK._markerDataRevision`, `window.BARK.loadData`, `window.BARK.safeDataPoll`, `window.BARK.safePoll`, localStorage cache/version values.
- Triggers/Executions: Calls `Papa.parse()`, `window.gamificationEngine.updateCanonicalCountsFromPoints()`, `window.BARK.markerManager.sync()`, `window.syncState()`, `window.BARK.incrementRequestCount()`, `window.BARK.setAppVersion()`, network `fetch()` for CSV and `version.json`.
- Implicit Dependencies: PapaParse, `renderEngine.js` helper exports and `syncState`, `mapEngine.js` marker manager, `gamificationLogic.js`.

### `modules/profileEngine.js`

- Primary Responsibility: Manage portal, achievements, profile stats, leaderboard, and rank-up UI.
- Global Reads: global `firebase`, bare `map`, `window.BARK.userVisitedPlaces`, `window.BARK.allPoints`, `window.currentWalkPoints`, `window.parkLookup`, `window.gamificationEngine`, `window._lastSyncedScore`, `window._lastKnownRank`, `window._serverPayloadSettled`, `window._lastLeaderboardDoc`, `window.lowGfxEnabled`.
- Global Writes: `window.BARK.renderManagePortal`, `window.BARK.syncScoreToLeaderboard`, `window.BARK.evaluateAchievements`, `window.BARK.updateStatsUI`, `window.BARK.loadLeaderboard`, `window._lastSyncedScore`, `window._lastKnownRank`, `window._lastLeaderboardDoc`.
- Triggers/Executions: Calls `window.BARK.removeVisitedPlace()`, `window.BARK.updateVisitDate()`, `window.BARK.calculateVisitScore()`, `window.BARK.incrementRequestCount()`, `window.gamificationEngine.evaluateAndStoreAchievements()`, `window.BARK.safeUpdateHTML()`, `window.BARK.getUserLocationMarker()`, `window.BARK.haversineDistance()`, Firestore and REST rank aggregation.
- Implicit Dependencies: `firebaseService.js`, `renderEngine.js`, `mapEngine.js`, `gamificationLogic.js`, `scoringUtils.js`, `geoUtils.js`.

### `modules/expeditionEngine.js`

- Primary Responsibility: Virtual expedition trails, trail overlays, manual/GPS mileage, rewards, walk logs, and dev trail warp.
- Global Reads: global `firebase`, Leaflet `L`, Turf `turf`, `window.map`, `window.BARK.TOP_10_TRAILS`, `window.simplifyTrails`, `window.instantNav`, `window.lowGfxEnabled`, `window.currentWalkPoints`, `window._cachedTrailsData`.
- Global Writes: `window.BARK.getTrailsData`, `window.BARK.renderVirtualTrailOverlay`, `window.BARK.renderCompletedTrailsOverlay`, `window.BARK.initTrailToggles`, `window.flyToActiveTrail`, `window.hydrateEducationModal`, `window.BARK.initSpinWheel`, `window.BARK.assignTrailToUser`, `window.BARK.initManualMiles`, `window.BARK.renderExpeditionProgress`, `window.BARK.renderExpeditionHistory`, `window.editWalkMiles`, `window.deleteWalkLog`, `window.claimRewardAndReset`, `window.BARK.renderCompletedExpeditions`, `window.handleTrainingClick`, `window.cancelTrainingWalk`, `window.BARK.initTrainingUI`, `window.BARK.populateTrailWarpGrid`, `window._cachedTrailsData`, `window.lastActiveTrailId`, `window.lastMilesCompleted`, `window.currentWalkPoints`.
- Triggers/Executions: Calls `window.BARK.incrementRequestCount()`, `window.BARK.syncScoreToLeaderboard()`, `window.BARK.showTripToast()`, Firestore reads/writes, geolocation watch, wake lock API, Leaflet/Turf rendering functions.
- Implicit Dependencies: `barkConfig.js`, Firebase SDK, Leaflet SDK, Turf SDK, `profileEngine.js` for leaderboard sync, `tripPlannerCore.js` for toast.

### `engines/tripPlannerCore.js`

- Primary Responsibility: Trip builder state mutation, trip UI rendering, route generation, optimization, and map overlays.
- Global Reads: Leaflet `L`, bare `map`, global `firebase`, `window.BARK.DOM`, `window.BARK.tripDays`, `window.BARK.activeDayIdx`, `window.BARK.DAY_COLORS`, `window.BARK.services.ors`, `window.parkLookup`, `window.tripStartNode`, `window.tripEndNode`, `window.draftBookendMarkers`, `window.draftCustomMarkers`, `window.isTripEditMode`, `window.instantNav`.
- Global Writes: `window.BARK.showTripToast`, `window.draftBookendMarkers`, `window.draftCustomMarkers`, `window.addStopToTrip`, `window.autoSortDay`, `window.executeSmartOptimization`, `window.exportDayToMaps`, `window.shiftDayLeft`, `window.shiftDayRight`, `window.insertDayAfter`, `window.editBookend`, `window.BARK.updateTripUI`, `window.toggleTripEditMode`, `window.isTripEditMode`, `window.BARK.tripDays`, `window.BARK.activeDayIdx`, `window.tripStartNode`, `window.tripEndNode`, `window.BARK.initTripPlanner`.
- Triggers/Executions: Calls `window.BARK.haversineDistance()`, `window.BARK.incrementRequestCount()`, `window.BARK.services.ors.directions()`, `window.BARK.loadSavedRoutes()`, `window.processInlineSearch()`, Firestore saved route writes, Leaflet route/pin rendering.
- Implicit Dependencies: `domRefs.js`, `geoUtils.js`, `orsService.js`, `routeRenderer.js`, Firebase SDK, Leaflet map from `mapEngine.js`.

### `modules/shareEngine.js`

- Primary Responsibility: Image exports, QR code generation, watermark tool, and CSV export.
- Global Reads: global `firebase`, `html2canvas`, `QRCode`, `Papa`, `window.BARK.userVisitedPlaces`, `window.BARK.allPoints`, `window.gamificationEngine`, `window.currentWalkPoints`, `window.isDownloadingCanvas`.
- Global Writes: `window.shareVaultCard`, `window.shareSingleBadge`, `window.shareSingleExpedition`, `window.shareAllExpeditions`, `window.BARK.initWatermarkTool`, `window.BARK.initQRCode`, `window.BARK.initCSVExport`, `window.isDownloadingCanvas`.
- Triggers/Executions: Calls `window.gamificationEngine.evaluateAndStoreAchievements()`, lazy-loads `html2canvas`, invokes `navigator.share`, `QRCode`, `Papa.unparse()`.
- Implicit Dependencies: `profileEngine.js`/gamification state, `barkState.js`, QRCode SDK, PapaParse SDK.

### `modules/settingsController.js`

- Primary Responsibility: Settings modal UI, settings effects, local/cloud settings save, terminate/reload.
- Global Reads: `window.BARK.settings`, `window.BARK.SETTINGS_REGISTRY`, `window.BARK.PERFORMANCE_SETTING_KEYS`, `window.BARK.LOW_GRAPHICS_PRESET`, `window.BARK.SETTING_IMPACTS`, settings globals, `window.map`, `window.lastActiveTrailId`, `window.lastMilesCompleted`, Firebase.
- Global Writes: `window.BARK.initSettings`, `window.BARK.syncSettingsControls`, `window.ultraLowEnabled`, `window.rememberMapPosition`, `window.startNationalView`, localStorage/sessionStorage.
- Triggers/Executions: Calls `window.BARK.applyGlobalStyles()`, `window.BARK.applyMapPerformancePolicy()`, `window.BARK.rebuildMarkerLayer()`, `window.BARK.invalidateMarkerVisibility()`, `window.BARK.renderVirtualTrailOverlay()`, `window.BARK.renderCompletedTrailsOverlay()`, `window.syncState()`, `window.BARK.populateTrailWarpGrid()`, `window.BARK.syncUserProgress()`, `firebase.auth().signOut()`, Firestore settings save, page reloads.
- Implicit Dependencies: `settingsStore.js`, `settingsRegistry.js`, `mapEngine.js`, `renderEngine.js`, `expeditionEngine.js`, Firebase SDK.

### `modules/uiController.js`

- Primary Responsibility: Main navigation, panel/modal controls, inline-handler replacement, visited filter, feedback portal.
- Global Reads: Leaflet `L`, `window.visualViewport`, `window.map`, bare `map`, `window.BARK.visitedFilterState`.
- Global Writes: `window.BARK.initUI`, `window.BARK.visitedFilterState`, `window.BARK._pendingMarkerSync`, localStorage visited filter.
- Triggers/Executions: Calls many global UI handlers (`window.autoSortDay()`, `window.togglePlannerRoutes()`, `window.shareSingleExpedition()`, `window.claimRewardAndReset()`, `window.flyToActiveTrail()`, `window.handleTrainingClick()`, `window.cancelTrainingWalk()`, `window.shareAllExpeditions()`, `window.shareVaultCard()`, `window.executeSmartOptimization()`), `window.BARK.clearActivePin()`, `window.BARK.invalidateMarkerVisibility()`, `window.syncState()`, `window.BARK.incrementRequestCount()`, Firestore feedback write, `window.location.reload()`.
- Implicit Dependencies: Leaflet SDK, map initialized by `mapEngine.js`, trip/share/expedition globals, renderEngine heartbeat, Firebase SDK for feedback.

### `core/app.js`

- Primary Responsibility: Boot orchestrator.
- Global Reads: `window.BARK.init*` functions, `window.BARK.services.auth`, `window.BARK.loadData`, `window.BARK.safePoll`, `window.BARK.updateTripUI`.
- Global Writes: `window.BARK` fallback only; local `_bootErrors`.
- Triggers/Executions: Calls all registered init functions in order, then Firebase auth init, then data load, then delayed version poll and trip UI update.
- Implicit Dependencies: Must be loaded last so all modules have registered their `window.BARK` exports.

### `pages/admin.js`

- Primary Responsibility: Admin-only data refinement UI and cloud function sync flow.
- Global Reads: global `firebase`, `Papa`, `Fuse`.
- Global Writes: `window.removeScheduledFile`.
- Triggers/Executions: Calls Firebase auth/firestore/functions, `window.location.replace()`, `Papa.parse()`, `new Fuse()`, callable `extractParkData` and `syncToSpreadsheet`.
- Implicit Dependencies: `pages/admin.html` must load Firebase compat SDKs, PapaParse, and Fuse before this module script.

## Part 2: Mermaid Diagram

```mermaid
graph TD
    BARK["window.BARK<br/>namespace hub"]
    RAW["raw window.*<br/>legacy settings/runtime"]
    MAP["window.map / bare map<br/>Leaflet instance"]
    FIREBASE["firebase global<br/>Auth + Firestore"]
    SYNC["window.syncState()<br/>RAF heartbeat"]
    DOM["DOM IDs / window.BARK.DOM"]
    ORS["window.BARK.services.ors"]
    FB_SERVICE["window.BARK.services.firebase"]
    CHECKIN["window.BARK.services.checkin"]

    geo["utils/geoUtils.js"]
    score["utils/scoringUtils.js"]
    gamify["gamificationLogic.js"]
    markerConfig["MapMarkerConfig.js"]
    registry["settingsRegistry.js"]
    barkState["barkState.js"]
    config["barkConfig.js"]
    domRefs["domRefs.js"]
    settingsStore["settingsStore.js"]
    appState["appState.js"]
    orsService["orsService.js"]
    firebaseService["firebaseService.js"]
    routeRenderer["routeRenderer.js"]
    checkinService["checkinService.js"]
    authService["authService.js"]
    policy["markerLayerPolicy.js"]
    markerMgr["MarkerLayerManager.js"]
    mapEngine["mapEngine.js"]
    renderEngine["renderEngine.js"]
    panelRenderer["panelRenderer.js"]
    searchEngine["searchEngine.js"]
    dataService["dataService.js"]
    profileEngine["profileEngine.js"]
    expeditionEngine["expeditionEngine.js"]
    tripPlanner["tripPlannerCore.js"]
    shareEngine["shareEngine.js"]
    settingsController["settingsController.js"]
    uiController["uiController.js"]
    app["core/app.js"]
    admin["pages/admin.js"]

    geo -->|writes utilities| BARK
    score -.->|reads sanitizeWalkPoints| BARK
    score -->|writes score helpers| BARK
    gamify -.->|reads score helper| BARK
    gamify -->|writes window.GamificationEngine| RAW
    gamify -.->|reads/writes achievements| FIREBASE
    markerConfig -.->|reads Leaflet L| MAP
    markerConfig -->|writes window.MapMarkerConfig| RAW

    registry -->|writes settings schema| BARK
    barkState -->|writes core accessors/request counter| BARK
    barkState -->|writes settings + runtime globals| RAW
    barkState -->|writes parkLookup + gamificationEngine| RAW
    config -->|writes config/constants| BARK
    domRefs -->|writes DOM registry| BARK
    domRefs -.->|reads document IDs lazily| DOM
    settingsStore -.->|reads registry/preset| BARK
    settingsStore -->|writes settings store| BARK
    settingsStore -->|defines mirrors| RAW
    appState -.->|reads BARK/raw state| BARK
    appState -.->|reads legacy globals| RAW
    appState -->|writes appState + mirrors| BARK
    appState -->|defines mirrors| RAW

    orsService -.->|reads ORS key| BARK
    orsService -->|writes service| ORS
    firebaseService -.->|reads visits/admin/walk points| BARK
    firebaseService -.->|reads currentWalkPoints/isAdmin| RAW
    firebaseService -->|writes firebase service + legacy exports| FB_SERVICE
    firebaseService -->|mutates visited Map| BARK
    firebaseService ==>|calls| SYNC
    firebaseService -.->|Firestore| FIREBASE

    checkinService -.->|reads geo/config/firebase service| BARK
    checkinService -.->|reads allowUncheck| RAW
    checkinService -->|writes checkin service| CHECKIN
    checkinService -->|mutates visited Map| BARK
    checkinService -.->|calls firebase service| FB_SERVICE

    authService -.->|reads config/settings/routes/pin state| BARK
    authService -.->|reads settings/map/loader globals| RAW
    authService -->|writes auth init + hydrated user state| BARK
    authService -->|writes auth/session globals| RAW
    authService ==>|calls| SYNC
    authService -.->|init/auth/user snapshot| FIREBASE
    authService -.->|calls expedition/profile/render hooks| BARK
    authService -.->|uses map after hydration| MAP

    policy -.->|reads settings + map zoom| RAW
    policy -.->|reads map| MAP
    policy -->|writes policy fn| BARK
    markerMgr -.->|reads BARK state/policy/panel renderer| BARK
    markerMgr -->|writes marker class + manager| BARK
    markerMgr -->|mutates parkLookup/point.marker| RAW
    markerMgr -.->|uses Leaflet layers| MAP
    mapEngine -.->|reads settings/policy/manager| BARK
    mapEngine -.->|reads settings globals| RAW
    mapEngine -->|writes Leaflet map| MAP
    mapEngine -->|writes layers/policy hooks| BARK
    mapEngine ==>|calls| SYNC

    renderEngine -.->|reads map/state/settings| BARK
    renderEngine -.->|reads settings globals| RAW
    renderEngine -.->|reads map bounds/zoom| MAP
    renderEngine -->|writes heartbeat/helpers| SYNC
    renderEngine -->|writes render helpers/caches| BARK
    renderEngine -.->|calls stats/achievements| BARK

    panelRenderer -.->|reads active pin/services/trip/config| BARK
    panelRenderer -.->|reads allowUncheck/autopan settings| RAW
    panelRenderer -.->|uses bare map| MAP
    panelRenderer -->|writes active pin + panel renderer| BARK
    panelRenderer ==>|calls| SYNC
    panelRenderer -.->|calls trip/checkin/profile hooks| BARK

    searchEngine -.->|reads config/DOM/allPoints/ORS| BARK
    searchEngine -.->|reads map/settings/firebase| RAW
    searchEngine -->|writes search state/geocode exports| BARK
    searchEngine -->|writes trip bookends + inline handler| RAW
    searchEngine ==>|calls| SYNC
    searchEngine -.->|calls ORS service| ORS
    searchEngine -.->|uses map navigation| MAP

    dataService -.->|reads parser helpers/marker manager| BARK
    dataService -.->|reads gamificationEngine/ultraLow| RAW
    dataService -->|writes allPoints/data revision/loaders| BARK
    dataService ==>|calls| SYNC
    dataService -.->|CSV/version fetch + PapaParse| DOM

    profileEngine -.->|reads visits/allPoints/score/map/user globals| BARK
    profileEngine -.->|reads leaderboard/rank globals| RAW
    profileEngine -.->|uses map center| MAP
    profileEngine -->|writes profile/achievement/leaderboard APIs| BARK
    profileEngine -->|writes leaderboard/rank globals| RAW
    profileEngine -.->|Firestore + REST aggregation| FIREBASE

    expeditionEngine -.->|reads trails/settings/map/Firebase| BARK
    expeditionEngine -.->|reads/writes trail + walk globals| RAW
    expeditionEngine -.->|uses Leaflet/Turf/map| MAP
    expeditionEngine -->|writes expedition APIs| BARK
    expeditionEngine -->|writes inline handlers| RAW
    expeditionEngine -.->|Firestore + geolocation/wake lock| FIREBASE

    tripPlanner -.->|reads DOM/trip state/ORS/map/Firebase| BARK
    tripPlanner -.->|reads/writes bookends/draft/edit globals| RAW
    tripPlanner -.->|uses Leaflet map overlays| MAP
    tripPlanner -->|writes trip APIs| BARK
    tripPlanner -->|writes inline handlers| RAW
    tripPlanner -.->|calls ORS directions| ORS
    tripPlanner -.->|saves routes| FIREBASE

    shareEngine -.->|reads visits/allPoints/gamification| BARK
    shareEngine -.->|reads currentWalkPoints/screenshot flag| RAW
    shareEngine -->|writes share/watermark/QR exports| BARK
    shareEngine -->|writes share globals| RAW
    shareEngine -.->|reads Firebase/html2canvas/QRCode/Papa| FIREBASE

    settingsController -.->|reads settings registry/store/map/trail state| BARK
    settingsController -.->|reads/writes raw settings| RAW
    settingsController -.->|controls map gestures| MAP
    settingsController -->|writes initSettings/syncSettingsControls| BARK
    settingsController ==>|calls| SYNC
    settingsController -.->|saves cloud settings| FIREBASE

    uiController -.->|reads map/visualViewport/global handlers| RAW
    uiController -.->|reads visited filter| BARK
    uiController -.->|uses Leaflet map events| MAP
    uiController -->|writes initUI/visitedFilterState| BARK
    uiController ==>|calls| SYNC
    uiController -.->|feedback write| FIREBASE

    app -.->|reads registered init funcs/services| BARK
    app -.->|calls boot sequence| BARK
    app -.->|starts data + version polling| BARK
    admin -.->|admin-only Firebase/Papa/Fuse| FIREBASE
    admin -->|writes window.removeScheduledFile| RAW

    classDef hub fill:#fff3bf,stroke:#b7791f,stroke-width:2px,color:#111;
    classDef runtime fill:#e0f2fe,stroke:#0369a1,stroke-width:2px,color:#111;
    classDef file fill:#f8fafc,stroke:#64748b,color:#111;
    classDef side fill:#fee2e2,stroke:#b91c1c,stroke-width:2px,color:#111;
    class BARK,RAW,MAP,SYNC hub;
    class FIREBASE,ORS,FB_SERVICE,CHECKIN runtime;
    class geo,score,gamify,markerConfig,registry,barkState,config,domRefs,settingsStore,appState,orsService,firebaseService,routeRenderer,checkinService,authService,policy,markerMgr,mapEngine,renderEngine,panelRenderer,searchEngine,dataService,profileEngine,expeditionEngine,tripPlanner,shareEngine,settingsController,uiController,app,admin file;
    class DOM side;
```

## Implicit Dependency Summary

- `core/app.js` must load last; otherwise the init registry is incomplete.
- `renderEngine.js` is the heartbeat owner. Any module calling `window.syncState()` assumes it has loaded.
- `mapEngine.js` owns `window.map`; `tripPlannerCore.js`, `panelRenderer.js`, `profileEngine.js`, `uiController.js`, and trail rendering all assume map exists or use bare `map`.
- `barkState.js`, `settingsStore.js`, and `appState.js` form a triple state layer: raw `window.*`, BARK accessors, and store mirrors can all observe or mutate overlapping values.
- `authService.js` is the highest-fanout runtime hydrator: it reads Firestore and fans out into settings, map style, visited state, expedition UI, stats, leaderboard, route loading, premium gates, and loader dismissal.
- `tripPlannerCore.js` and `expeditionEngine.js` still export many raw `window.*` functions because HTML/template strings call inline handlers.
- `MarkerLayerManager.js`, `dataService.js`, and `renderEngine.js` share ownership of point objects: CSV parsing creates point data, the marker manager attaches `point.marker`, and the renderer mutates marker visibility/style.
