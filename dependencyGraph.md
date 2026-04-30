# B.A.R.K. Ranger Map Dependency Graph

Phase: 1 - system and dependency mapping  
Date: 2026-04-27  
Scope: architecture map and extraction plan only. Runtime behavior was not changed.

## Current State

The app is a client-side, defer-script application. It does not use ES modules. Dependencies are implicit through:

- `window.BARK`
- raw mutable `window.*`
- global `firebase`
- global Leaflet `map`
- DOM IDs
- `localStorage` and `sessionStorage`

Current script order in `index.html`:

```text
Firebase SDKs -> PapaParse -> gamificationLogic.js -> MapMarkerConfig.js
-> modules/barkState.js -> modules/barkConfig.js -> modules/mapEngine.js
-> modules/renderEngine.js -> modules/searchEngine.js -> modules/dataService.js
-> modules/profileEngine.js -> modules/expeditionEngine.js
-> modules/tripPlanner.js -> modules/shareEngine.js
-> modules/settingsController.js -> modules/uiController.js -> app.js
```

`app.js` calls `window.BARK.init*()` functions after most modules have already performed top-level work. The final architecture must invert this so `/core/app.js` owns boot order.

## Hotspots

Files currently above the 400-line target: `app.test.js` 6481, `styles.css` 1445, `index.html` 1436, `modules/dataService.js` 1250, `tmp_test.js` 926, `trophyCase.css` 801, `modules/expeditionEngine.js` 711, `modules/profileEngine.js` 670, `modules/tripPlanner.js` 559, `admin.js` 515, `snippet.js` 441, `mapStyles.css` 436, `AUDIT_REPORT.md` 412.

Primary runtime split targets: `dataService.js`, `expeditionEngine.js`, `profileEngine.js`, `tripPlanner.js`, and `admin.js` if admin remains production scope.

## Current Dependency Graph

```text
index.html
  -> SDK globals: firebase, Leaflet, PapaParse, Turf
  -> gamificationLogic.js: window.GamificationEngine, achievement Firestore
  -> MapMarkerConfig.js: window.MapMarkerConfig, Leaflet marker/icon creation
  -> barkState.js: localStorage, window.* settings, window.BARK state
  -> barkConfig.js: Firebase config, trail constants, normalization dictionary
  -> mapEngine.js: window.map, Leaflet layers, DOM, localStorage
  -> renderEngine.js: marker filtering, CSS visibility, syncState(), DOM helper
  -> searchEngine.js: search DOM, fuzzy matching, ORS geocoding key
  -> dataService.js: CSV, polling, Firebase init/auth, Firestore, marker click panel DOM
  -> profileEngine.js: leaderboard, stats, achievements, DOM, Firestore
  -> expeditionEngine.js: trails, GPS, wake lock, expedition Firestore, DOM
  -> tripPlanner.js: planner UI, ORS route fetch, saved routes Firestore
  -> shareEngine.js: exports, QR, html2canvas, DOM
  -> settingsController.js: settings DOM, localStorage, cloud settings Firestore
  -> uiController.js: nav/panel DOM, map events, feedback Firestore
  -> app.js
       -> boot calls through window.BARK
```

The current graph is a star around `window.BARK`, not a directed architecture.

## Layer Violations To Remove

Shared globals observed include:

```text
allowUncheck, standardClusteringEnabled, premiumClusteringEnabled,
clusteringEnabled, lowGfxEnabled, simplifyTrails, instantNav,
rememberMapPosition, startNationalView, stopAutoMovements,
reducePinMotion, removeShadows, stopResizing, viewportCulling,
ultraLowEnabled, lockMapPanning, disable1fingerZoom,
disableDoubleTap, disablePinchZoom, tripStartNode, tripEndNode,
draftBookendMarkers, draftCustomMarkers, currentWalkPoints,
isAdmin, isTripEditMode, parkLookup, map
```

DOM manipulation is spread across most modules. Approximate matches:

```text
dataService 201, profileEngine 118, tripPlanner 101,
expeditionEngine 100, searchEngine 58, shareEngine 57,
uiController 37, settingsController 34, mapEngine 10, renderEngine 6
```

Firebase access is currently in:

```text
dataService, profileEngine, expeditionEngine, settingsController,
tripPlanner, uiController, shareEngine, gamificationLogic
```

Final rule: only `services/firebaseService.js` and `services/authService.js` may call Firebase SDK APIs.

## Observed Firestore Contract

Preserve these existing paths and fields exactly.

`users/{uid}`: `visitedPlaces`, `settings`, `streakCount`, `lastStreakDate`, `walkPoints`, `lifetime_miles`, `totalPoints`, `totalVisited`, `displayName`, `hasVerified`, `isAdmin`, `virtual_expedition`, `completed_expeditions`.

`users/{uid}.visitedPlaces`: array of `{ id, name, lat, lng, verified, ts, state? }`.

`users/{uid}.settings`: `allowUncheck`, `rememberMapPosition`, `startNationalView`, `instantNav`, `premiumClustering`, `standardClustering`, `simplifyTrails`, `stopAutoMovements`, `lowGfxEnabled`, `removeShadows`, `stopResizing`, `viewportCulling`, `ultraLowEnabled`, `lockMapPanning`, `disablePinchZoom`, `disable1fingerZoom`, `disableDoubleTap`, `mapStyle`, `visitedFilter`.

`users/{uid}.virtual_expedition`: `active_trail`, `trail_name`, `miles_logged`, `trail_total_miles`, `history`.

`users/{uid}/savedRoutes/{routeId}`: `tripName`, `createdAt`, `tripDays: [{ color, stops: [{ id, name, lat, lng }], notes }]`.

`users/{uid}/achievements/{achievementId}`: `achievementId`, `tier`, `dateEarned`.

`leaderboard/{uid}`: `displayName`, `photoURL`, `totalPoints`, `totalVisited`, `hasVerified`, `lastUpdated`.

Other paths: `feedback`, `system/leaderboardData`.

Note: the requested contract mentions top-level `visitedPlaces/{uid}` and `routes/{uid}`. The current client code stores visits in `users/{uid}.visitedPlaces` and saved routes in `users/{uid}/savedRoutes/{routeId}`. The refactor must preserve the current paths unless a separate migration is approved.

## Target Architecture Tree

```text
/core: app.js, dependencyGraph.md
/config: barkConfig.js, domRefs.js
/state: settingsStore.js, appState.js
/services: dataService.js, firebaseService.js, authService.js, orsService.js
/controllers: mapController.js, uiController.js, tripPlannerController.js, searchController.js, settingsController.js, profileController.js, expeditionController.js, shareController.js
/renderers: markerRenderer.js, panelRenderer.js, profileRenderer.js, expeditionRenderer.js, settingsRenderer.js, tripPlannerRenderer.js, shareRenderer.js
/engines: gamificationEngine.js, expeditionEngine.js, tripPlannerLegacy.js
/utils: geoUtils.js, scoringUtils.js, textUtils.js, csvUtils.js
```

`orsService.js` is included because ORS calls must be centralized. `tripPlannerLegacy.js` exists to preserve the route planner immutability rule: move/wrap first, alter algorithms never.

## Target Dependency Direction

```text
core/app.js
  -> config
  -> state
  -> services
  -> controllers
  -> renderers

UI Events -> Controllers -> Services/Engines -> State -> Renderers
```

Allowed dependencies:

```text
controllers -> state, services, engines, utils, renderers
services -> config, utils, Firebase SDK only in firebaseService/authService
renderers -> config/domRefs, template helpers
engines -> utils
utils -> no app dependencies
```

Forbidden final dependencies:

```text
services -> DOM
services -> window shared state
renderers -> Firebase
renderers -> services
engines -> DOM
engines -> Firebase
controllers -> inline HTML rendering
```

## Required Future Boot Order

`/core/app.js` must guarantee:

```text
1. Load config
2. Initialize state stores
3. Initialize Firebase
4. Initialize Auth listener
5. Load data (CSV)
6. Initialize map
7. Bind controllers
8. First render
```

Phase 2 should first convert top-level side-effect modules into explicit `init()` calls so this order can be enforced without changing user-visible behavior.

## `dataService.js` Extraction Plan

Move-only first. Then clean dependencies.

| Lines | Current code | Target owner |
| --- | --- | --- |
| 8-45 | `attemptDailyStreakIncrement()` | `firebaseService` plus controller wrapper |
| 49-83 | visit sync/update/remove | `firebaseService`, `profileController`, `profileRenderer` |
| 86-507 | CSV parse results, marker creation, marker click panel | `dataService`, `markerRenderer`, `panelRenderer`, `mapController` |
| 508-533 | `parseCSVString()` | `utils/csvUtils.js` or `services/dataService.js` |
| 536-660 | CSV hash, polling, `loadData()`, `safeDataPoll()` | `services/dataService.js` only |
| 662-711 | version polling | `services/dataService.js` initially |
| 717-853 | saved routes list/load/delete | `firebaseService`, `tripPlannerRenderer`, `tripPlannerController` |
| 855-871 | `togglePlannerRoutes()` | `tripPlannerController`, `tripPlannerRenderer` |
| 874-1230 | Firebase init and auth snapshot | `authService`, `firebaseService`, stores, controllers, renderers |
| 1233-1250 | admin point override | `firebaseService`, admin controller |

### Extracted Responsibilities

`services/dataService.js` keeps only:

```text
parse/fetch/poll CSV, hash dedupe, graceful async errors, data-load events
```

`renderers/markerRenderer.js` owns:

```text
Leaflet marker creation, marker class toggles, clustering/visibility,
stable marker cache, marker-filter-hidden invariant
```

`renderers/panelRenderer.js` owns:

```text
panel templates, meta pills, info/photos/video/links,
visited section visual state, sticky direction footer
```

`services/firebaseService.js` owns:

```text
user doc subscription, visitedPlaces writes, cloud settings,
savedRoutes CRUD, leaderboard reads/writes, achievement writes,
feedback writes, expedition field updates
```

Every Firebase function must use `try/catch` and log context:

```text
[firebaseService] actionName failed
```

`services/authService.js` owns:

```text
Firebase app init handoff, auth listener, current user, Google sign-in, sign-out
```

`state/settingsStore.js` owns:

```text
local defaults, cloud overlay, ultra-low override, localStorage persistence,
pub/sub listeners, temporary Mirror Phase writes to legacy window.* values
```

## ORS Plan

Current ORS usage:

```text
searchEngine.js -> ORS geocode with client key
tripPlanner.js -> ORS route directions with client key
functions/index.js -> getPremiumRoute callable with hardcoded key
```

Target:

```text
services/orsService.js -> all client ORS access
Cloud Function callable -> route generation when available
future callable -> geocoding proxy
config fallback -> temporary only
```

Do not alter trip stop ordering, route limits, execution order, route layer creation, or telemetry output while extracting ORS transport.

## Utility Consolidation

`utils/geoUtils.js`:

```text
generatePinId()
distanceKm()
distanceMeters()
distanceMiles()
```

Preserve:

```text
25 km verified check-in threshold
1-mile GPS walk validation/blackout behavior
trip planner round-trip threshold
```

`utils/scoringUtils.js`:

```text
sanitizeWalkPoints()
countVerifiedAndRegular()
calculateVisitScore()
```

Preserve:

```text
verified visit = 2 points
regular visit = 1 point
same walk point rounding/flooring
```

## Regression Anchors

### User Login

Current:

```text
app.js -> initFirebase() -> firebase.initializeApp()
-> onAuthStateChanged(user) -> users/{uid}.onSnapshot()
-> hydrate cloud settings -> hydrate visitedPlaces
-> hydrate expedition/profile/admin UI -> syncState()
-> updateStatsUI() -> loadLeaderboard() -> loadSavedRoutes(uid)
-> dismissBarkLoader()
```

Target:

```text
core/app.js -> firebaseService.init() -> authService.initAuth()
-> auth emits user -> firebaseService.subscribeUserDoc(uid)
-> settingsStore.hydrateCloud(data.settings)
-> appState.setVisitedPlaces(data.visitedPlaces)
-> controllers derive state -> renderers update UI
```

Proof required later: same Firestore path, same field names, same `visitedPlaces` array shape, same logged-in UI states.

### Marker Click

Current:

```text
processParsedResults() -> marker.on('click')
-> active-pin class update -> panel DOM render
-> bind visited/check-in/trip buttons
-> optional GPS <= 25 km -> update users/{uid}.visitedPlaces
-> syncState() -> updateStatsUI() -> attemptDailyStreakIncrement()
```

Target:

```text
markerRenderer.createOrReuseMarker()
-> mapController handles marker click
-> appState.setActiveMarker()
-> panelRenderer.renderPlacePanel(place, derivedState)
-> controller handlers call firebaseService and state
-> renderers refresh
```

Proof required later: same active marker classes, same panel content, same 25 km threshold, same visited object shape, same score/streak side effects.

### Route Calculation

Current:

```text
initTripPlanner() -> startRouteBtn.onclick
-> generateAndRenderTripRoute()
-> require signed-in user -> read tripDays
-> include tripStartNode/tripEndNode
-> build ORS coordinates per day -> fetch ORS route
-> L.geoJSON layer per day -> fitBounds() -> telemetry render
```

Target:

```text
tripPlannerController -> moved/wrapped legacy planner
-> orsService performs network call at existing boundary
-> renderer updates button/telemetry states
```

Proof required later: same stop limits, same ordering, same coordinates, same route layers, same telemetry, same saved route payload.

## Phase 1 Done

Completed:

- Current dependency graph
- File-size and hotspot inventory
- Firestore path and field contract
- Final architecture tree
- `dataService.js` extraction map
- Regression anchors

Not changed:

- runtime source modules
- state behavior
- Firebase paths
- route planner logic
- marker filtering behavior
