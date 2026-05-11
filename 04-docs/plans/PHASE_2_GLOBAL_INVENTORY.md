# Phase 2A Global Coupling Inventory

Date: 2026-05-01

## Summary

Phase 1 finished the two highest-value ownership moves: `ParkRepo` owns park data, and `VaultRepo` owns visit state plus the `visitedPlaces` snapshot lifecycle. The remaining Phase 2 debt is not one obvious data owner. It is runtime coordination: many modules still publish and consume global functions, raw `window` flags, localStorage-backed state, and refresh side effects directly.

This document began as the 2A inventory. It now also records the 2B additive seam, 2C visited-cache migration status, 2D visited-visual-refresh migration, 2E `syncState()` cleanup, and 2F authService split planning below; the inventory tables remain architecture notes rather than a refactor plan that changes behavior by themselves. The full post-Phase-2 status report is `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md`.

Signed-in Playwright smoke is now unblocked through Firebase Email/Password E2E storage states. `npm run test:e2e:phase1b` passed with 3 tests, `npm run test:e2e:premium` passed with 2 tests, `npm run test:e2e:account-switch` passed with 1 test using `BARK_E2E_STORAGE_STATE` for User A and `BARK_E2E_STORAGE_STATE_B` for User B, `npm run test:e2e:settings` passed with 1 test, `npm run test:e2e:profile-manage` passed with 1 test, and `npm run test:e2e:trip-visited` passed with 1 test. Full current bundle command `npm run test:e2e:smoke` now exists and passed with 9 tests; it requires `BARK_E2E_BASE_URL`, `BARK_E2E_STORAGE_STATE`, and `BARK_E2E_STORAGE_STATE_B`. Google OAuth remains blocked in Playwright Chromium, but real users still use Google sign-in and no email/password UI was added.

Main findings:

| Finding | Impact | Suggested phase |
|---|---|---|
| `window.syncState()` is the central heartbeat, but many modules call it directly. | Coupled refresh timing; hard to reason about marker/profile/achievement work after state changes. | 2E/later |
| Visit refresh is split across `invalidateVisitedIdsCache()`, `refreshVisitedVisualState()`, marker manager style refresh, trip badge refresh, `syncState()`, and stats refresh. | Correctness depends on each write path remembering the right refresh sequence. | 2B/2C/2D |
| `authService.js` still coordinates auth state, cloud settings hydration, admin, walk points/streak, expedition hydration, leaderboard, loader, logout runtime reset, and UI visibility. | High blast radius for any auth cleanup. | 2F/later, carefully |
| `profileEngine.js` owns stats DOM, manage portal, achievements, leaderboard writes/reads, rank UI, and score sync. | Mixed UI and Firestore concerns around user score/leaderboard. | Defer or split after coordinator work |
| `settingsController.js` owns local setting effects, cloud autosave flags, settings UI rendering, map style/performance effects, and expedition overlay refresh. | Settings changes fan out directly into several runtime subsystems. | Medium-risk later PR |
| `state/appState.js` mirrors several legacy globals but is not yet the sole state API. | Some state has two access paths, so ownership is more documentary than enforced. | Later, after coordinator |

Phase 2B was safe to implement only as a small no-ownership-move coordinator boundary/wrapper PR. It must not be combined with auth, Firestore write, or UI rewrites.

## Phase 2B Status

Phase 2B added `modules/RefreshCoordinator.js` as an additive seam loaded after core state setup and before services. It exposes `window.BARK.refreshCoordinator` with methods that delegate to existing refresh functions when present:

- `refreshVisitedCache(reason)`
- `refreshVisitedVisuals(reason)`
- `refreshVisitDerivedUi(reason)`
- `refreshAllVisitDerived(reason)`
- `getStats()`

No existing manual refresh calls were removed. No Firestore writes, auth/session logic, VaultRepo ownership, or UI behavior changed. The coordinator does not own data and does not subscribe to `VaultRepo`.

Active-pin button refresh is still private auth/panel DOM logic. Phase 2B intentionally did not copy that DOM update into the coordinator; expose or move it only in a later focused design.

Phase 2C migrated one low-risk refresh category: direct visited cache invalidation call sites now route through `refreshCoordinator.refreshVisitedCache(reason)` by way of file-local safe helpers. Visual refresh, `syncState()`, stats/profile/leaderboard, Firestore writes, auth/session logic, and ownership boundaries were not moved.

Phase 2C visited cache invalidation planning and implementation notes are captured in `plans/PHASE_2C_VISITED_CACHE_PLAN.md`. Phase 2D migrated visited visual refresh requests through `refreshCoordinator.refreshVisitedVisuals(reason)` only; implementation notes are captured in `plans/PHASE_2D_VISITED_VISUAL_REFRESH_PLAN.md`. Phase 2E is implemented in `plans/PHASE_2E_SYNCSTATE_PLAN.md` as a narrow direct-`syncState()` cleanup only; manual smoke passed. Phase 2F.2 extracted premium gating UI into `services/authPremiumUi.js`; manual smoke passed per `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md`.

## Phase 2C Status

Phase 2C is implemented as a cache-invalidation-only migration. It changed direct inline `window.BARK.invalidateVisitedIdsCache()` call sites in these files:

- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

Residual `invalidateVisitedIdsCache` grep matches are expected only in file-local helper fallbacks, the `VaultRepo` callback option method name in `authService`, and the `modules/RefreshCoordinator.js` seam internals. No direct inline global invalidation call sites remain outside those compatibility paths.

Manual smoke after 2C passed. Console errors: none reported. No deployment has happened.

## Phase 2D Status

Phase 2D is implemented as a visited-visual-refresh-only migration through `window.BARK.refreshCoordinator.refreshVisitedVisuals(reason)`.

2D changed runtime call sites only in:

- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

2D did not migrate the `modules/renderEngine.js` trip badge refresh that runs during marker render/filter changes, because replacing that path with full visited visual refresh could create extra marker refresh work during pan/zoom or filter-driven render cycles.

2D did not migrate `window.syncState()`, stats/profile/leaderboard, Firestore writes, auth/session ownership, or `VaultRepo` ownership. Phase 2D QC and manual smoke passed; direct `syncState()` cleanup is safe to plan next but should remain narrow.

## Phase 2E Status

Phase 2E is implemented as a narrow reduction of direct `window.syncState()` calls through named `RefreshCoordinator` request methods. The first slice targets only the three check-in visit mutation call sites in `services/checkinService.js`.

2E added coordinator request methods:

- `requestStateSync(reason)`
- `requestVisitStateSync(reason)`

2E did not remove or rewrite `window.syncState()`. It did not migrate search/filter, map movement/culling, settings effects, data load, auth hydration/logout, panel DOM action, stats/profile/leaderboard, Firestore writes, or `VaultRepo` ownership. Manual smoke passed.

## Phase 2F Status

Phase 2F.2 is implemented in `plans/PHASE_2F_AUTHSERVICE_SPLIT_PLAN.md` as a small authService responsibility extraction. Manual smoke passed per the post-Phase-2 report.

Implemented first extraction:

- Extract only premium gating UI logic from `services/authService.js` into a small helper module.

2F.2 did not move the auth listener, broad `users/{uid}` snapshot, cloud settings hydration, walk points/streak, expedition sync, leaderboard trigger, logout reset, Firestore writes, `VaultRepo` ownership, or login/logout UI behavior.

## Commands Run

Required raw inventory commands:

```sh
rg "window\\.BARK\\."
rg "window\\._|window\\.current|window\\.syncState"
rg "syncState\\("
rg "invalidateVisitedIdsCache|refreshVisitedVisualState|refreshMarkerStyles|refreshBadgeStyles"
rg "updateStatsUI|evaluateAchievements|loadLeaderboard|renderManagePortal"
wc -l services/authService.js services/firebaseService.js modules/renderEngine.js modules/profileEngine.js renderers/panelRenderer.js modules/uiController.js modules/settingsController.js
```

Runtime-focused follow-up searches excluded docs, plans, tests, and historical audit notes so the tables below reflect live code rather than old findings.

Line counts from the required `wc -l`:

| File | Lines | Notes |
|---|---:|---|
| `services/authService.js` | 824 | Auth lifecycle plus broad user snapshot and logout reset coordination. |
| `services/firebaseService.js` | 729 | Visit writes, route/settings/cloud helpers, streak, global exports. |
| `modules/renderEngine.js` | 449 | Marker heartbeat, cache invalidation, achievement scheduling, marker filtering. |
| `modules/profileEngine.js` | 828 | Manage portal, stats, achievements, leaderboard, score sync. |
| `renderers/panelRenderer.js` | 393 | Place card renderer plus check-in actions and panel side effects. |
| `modules/uiController.js` | 359 | Global UI bindings and view toggles. |
| `modules/settingsController.js` | 503 | Settings UI, cloud autosave, local effects, trail/map refresh. |

## 1. Global State Surfaces

### `window.BARK.*` State And Namespace Surfaces

| Surface | Current owner | Runtime role | Coupling notes | Risk |
|---|---|---|---|---|
| `window.BARK.repos.ParkRepo` | `repos/ParkRepo.js` | Canonical park data owner. | Good Phase 1 endpoint; consumers still access through global namespace. | LOW |
| `window.BARK.repos.VaultRepo` | `repos/VaultRepo.js` | Visit state and visit snapshot lifecycle owner. | Good Phase 1 endpoint; refresh side effects still injected/called globally. | LOW |
| `window.BARK.services.*` | Service files | Service registry for auth, Firebase, check-in, ORS. | Global service locator; easy to call across domains. | MEDIUM |
| `window.BARK.settings` | `state/settingsStore.js` | Structured settings store. | Better owner exists, but many settings values still mirror to raw `window[key]`. | MEDIUM |
| `window.BARK.appState` | `state/appState.js` | Structured wrapper around legacy state. | Mirrors `activePin`, filters, trip state, admin, walk points. Not yet the only write API. | MEDIUM |
| `window.BARK.DOM` | `config/domRefs.js` | DOM lookup registry. | Useful shared registry; still many direct `document.getElementById` calls exist. | LOW |
| `window.BARK.config`, `firebaseConfig`, `TOP_10_TRAILS`, `normalizationDict` | `modules/barkConfig.js` | Static config and constants. | Low behavioral risk; still globally mutable. | LOW |
| `window.BARK._searchResultCache` | `modules/barkState.js`, `modules/searchEngine.js`, `modules/renderEngine.js`, `authService` reset | Search match cache used by marker filtering. | Cache invalidation is manual and tied to `syncState()`. | MEDIUM |
| `window.BARK.activePinMarker` | `modules/barkState.js`, panel/marker/auth/data modules | Active marker/panel state. | Direct marker DOM mutation and panel state are coupled. | MEDIUM |
| `window.BARK.activeSwagFilters`, `activeSearchQuery`, `activeTypeFilter`, `visitedFilterState` | `modules/barkState.js`, `modules/searchEngine.js`, `modules/uiController.js`, `authService` reset | Map filter/search state. | Multiple writers call `syncState()` directly. | MEDIUM |
| `window.BARK.tripDays`, `activeDayIdx` | `modules/barkState.js`, `engines/tripPlannerCore.js`, `renderers/routeRenderer.js` | Trip planner itinerary state. | Trip planner is close to owning it, but data loads and route renderer write directly. | MEDIUM |
| `window.BARK.markerLayer`, `markerClusterGroup`, `markerManager`, `tripLayer` | `modules/mapEngine.js`, `modules/TripLayerManager.js` | Map layer and marker coordination. | Rendering/performance sensitive; refresh callers reach into managers directly. | MEDIUM |
| `window.BARK._markerDataRevision`, `_markerVisibilityRevision`, `_visitedIdsCacheKey`, `_pendingMarkerSync`, `_forceMarkerLayerReset`, `_lastLayerType`, `_isMoving`, `_isZooming` | `ParkRepo`, `renderEngine`, `mapEngine`, `MarkerLayerManager`, auth reset | Render invalidation and map-motion state. | Internal flags are global and cross-module. | MEDIUM |
| `window.BARK.isHydratingCloudSettings` | `authService`, `settingsController` | Prevent settings autosave during cloud hydration. | Global coordination flag between auth and settings. | MEDIUM |
| `window.BARK.__barkStateReady`, `__settingsStoreReady`, `bootOrder`, `_bootErrors` | `barkState`, `settingsStore`, `core/app.js` | Boot diagnostics and readiness. | Mostly diagnostic. | LOW |

### Raw `window.*` Runtime State

| Surface | Current owner | Runtime role | Notes | Risk |
|---|---|---|---|---|
| `window.syncState` | `modules/renderEngine.js` | RAF-batched heartbeat for marker refresh, stats refresh, achievement scheduling. | The central coordination point and most important Phase 2 target. | MEDIUM |
| `window.currentWalkPoints` | `barkState`, `authService`, `expeditionEngine`, `profileEngine`, `shareEngine`, `firebaseService` | Walk point score source. | Auth hydrates it; expedition mutates it; score/leaderboard read it. | HIGH |
| `window.currentStreak` | None found in runtime search. | N/A | Streak uses `streakCount`/`lastStreakDate` in Firestore/localStorage and DOM labels. | LOW |
| `window.isAdmin` | `authService`, mirrored by `appState` | Admin UI permission flag. | Auth-owned, but global read potential remains. | MEDIUM |
| `window._cloudSettingsLoaded`, `_pendingLocalSettingsChanges`, `_savingCloudSettingsRevision`, `_lastAppliedCloudSettingsRevision` | `authService`, `settingsController`, `barkState` init | Cloud settings conflict/rehydration guards. | Crosses auth snapshot and settings autosave. | HIGH |
| `window._serverPayloadSettled`, `_firstServerPayloadReceived` | `authService`, `profileEngine` | Protect rank/title UI until server payload settles. | Auth/profile coupling. | MEDIUM |
| `window._lastSyncedScore`, `_lastKnownRank`, `_lastLeaderboardDoc`, `_leaderboardLoadedOnce` | `authService`, `profileEngine` | Leaderboard/rank state and pagination. | Profile state leaks into auth. | MEDIUM |
| `window._SESSION_REQUEST_COUNT`, `SESSION_MAX_REQUESTS` | `barkState` | Request safety counter. | Mostly diagnostic/safety, but called across services. | LOW |
| `window._cachedTrailsData`, `lastActiveTrailId`, `lastMilesCompleted` | `expeditionEngine`, `settingsController` | Trail data cache and active trail overlay refresh. | Expedition/settings coupling. | MEDIUM |
| `window.map`, `_cullingTimeout` | `mapEngine`, `TripLayerManager`, render/settings/search modules | Leaflet map and culling timer. | Rendering/performance sensitive. | MEDIUM |
| `window.tripStartNode`, `tripEndNode`, `isTripEditMode` | `barkState`, `tripPlannerCore`, `searchEngine`, `appState` | Trip planner start/end/edit mode. | Should eventually be private to trip planner store/controller. | MEDIUM |
| `window.gamificationEngine` | `barkState`, `profileEngine`, `shareEngine` | Achievement calculation/storage engine. | Profile/share use global singleton. | MEDIUM |
| `window.dismissBarkLoader` | `mapEngine`, `core/app.js`, `authService` | Loader dismissal. | Boot/auth UI coupling, but small and stable. | LOW |

### localStorage/sessionStorage App State

| Key or pattern | Current users | Runtime role | Desired direction | Risk |
|---|---|---|---|---|
| `barkVisitedFilter` | `barkState`, `authService`, `uiController`, `settingsController`, `appState` fallback | Persist visited filter. | Settings/appState should own reads/writes; refresh via coordinator. | MEDIUM |
| `barkMapStyle` | `authService`, `mapEngine`, `settingsController` | Persist selected tile layer. | Settings store should own; map engine applies. | MEDIUM |
| `mapLat`, `mapLng`, `mapZoom` | `mapEngine`, `authService` logout reset | Persist map position. | Map view state owner, not auth reset internals. | MEDIUM |
| Setting registry storage keys | `settingsStore`, `settingsController` | Persist boolean settings. | Already mostly owned by settings store. | LOW |
| `skipCloudHydration` session flag | `settingsController`, `authService` | Prevent immediate cloud overwrite after terminate/reset. | Needs explicit settings hydration owner. | MEDIUM |
| `lastStreakDate`, `streakCount` | `firebaseService` | Offline/local fallback for streak. | Streak owner/service should own. | MEDIUM |
| `barkCSV`, `barkCSV_time` | `dataService` | Cached park CSV. | Data service/ParkRepo cache boundary. | LOW |
| `premiumLoggedIn` | `dataService` | Premium/offline gate. | Auth/premium owner later. | MEDIUM |
| `bark_seen_version` | `barkState`, `dataService` | App version seen. | Fine as app version state. | LOW |

## 2. Global Functions

### High-Traffic Coordination Functions

| Function | Defined in | Representative callers | Current role | Risk |
|---|---|---|---|---|
| `window.syncState()` | `modules/renderEngine.js` | `authService`, `checkinService`, `firebaseService`, `dataService`, `mapEngine`, `searchEngine`, `settingsController`, `uiController`, `panelRenderer` | Main RAF heartbeat. Updates markers, stats, and schedules achievements. | MEDIUM |
| `window.BARK.invalidateVisitedIdsCache()` | `modules/renderEngine.js` | `authService`, `checkinService`, `firebaseService`, `VaultRepo` callback | Clears visited ID cache and marker visibility fingerprint. | MEDIUM |
| `firebaseService.refreshVisitedVisualState()` | `services/firebaseService.js` export inside `window.BARK.services.firebase` | `authService`, `checkinService`, internal Firebase service writes | Calls marker manager style refresh and trip badge refresh. | MEDIUM |
| `window.BARK.updateStatsUI()` | `modules/profileEngine.js` | `authService`, `renderEngine`, `panelRenderer`, internal profile | Updates profile stats and renderManagePortal. | MEDIUM |
| `window.BARK.evaluateAchievements()` | `modules/profileEngine.js` | `renderEngine`, `shareEngine` indirectly via gamification engine | Computes/render achievements and may sync score. | MEDIUM |
| `window.BARK.loadLeaderboard()` | `modules/profileEngine.js` | `authService` | Loads leaderboard and personal fallback. | MEDIUM |
| `window.BARK.renderManagePortal()` | `modules/profileEngine.js` | `firebaseService`, internal profile | Renders editable visit list. | MEDIUM |

### Other Exported Function Families

| Family | Examples | Owner | Notes | Risk |
|---|---|---|---|---|
| Boot/init exports | `initMap`, `initSettings`, `initUI`, `initSearchEngine`, `initTripPlanner`, `initTripLayer`, `initFirebase` | Multiple modules | Classic-script boot architecture depends on global registration. | MEDIUM |
| Map/render exports | `applyGlobalStyles`, `applyMapPerformancePolicy`, `loadLayer`, `rebuildMarkerLayer`, `updateMarkers`, `safeUpdateHTML`, `formatSwagLinks` | `mapEngine`, `renderEngine` | Mostly rendering APIs, but some are called by auth/settings. | MEDIUM |
| Firebase/write exports | `syncUserProgress`, `updateCurrentUserVisitedPlaces`, `updateVisitDate`, `removeVisitedPlace`, `saveUserSettings` | `firebaseService` | User-data write behavior; avoid Phase 2 early changes. | HIGH |
| Visit query helpers | `getVisitedPlaceEntry`, `getVisitedPlaceEntries`, `isParkVisited`, `normalizeLocalVisitedPlacesToCanonical` | `firebaseService` backed by `VaultRepo` | Still global helpers, but now route through repo. | MEDIUM |
| Trip planner exports | `updateTripUI`, `resetTripPlannerRuntime`, `removeTripStopByKey`, `showTripToast`, bare `addStopToTrip`, `autoSortDay`, `executeSmartOptimization` | `tripPlannerCore` | Many bare globals remain for UI handlers. | MEDIUM |
| Expedition exports | `renderVirtualTrailOverlay`, `renderCompletedTrailsOverlay`, `assignTrailToUser`, `renderExpeditionProgress`, `renderExpeditionHistory`, `renderCompletedExpeditions`, bare `flyToActiveTrail`, `claimRewardAndReset`, etc. | `expeditionEngine` | Mixed UI and Firestore/walk-point effects. | MEDIUM |
| Settings exports | `buildCloudSettingsPayload`, `scheduleCloudSettingsAutosave`, `syncSettingsControls` | `settingsController` | Settings controller is an effect hub. | MEDIUM |
| Utility exports | `generatePinId`, `haversineDistance`, `sanitizeWalkPoints`, `calculateVisitScore`, `countVerifiedAndRegular`, `normalizeText` | utilities/search/scoring | Low-risk shared utilities. | LOW |
| Service registries | `window.BARK.services.auth/firebase/checkin/ors` | services | Better than scattered globals, but still global service locator. | MEDIUM |

## 3. Refresh And Coordination Calls

| Refresh action | Owner | Current callers | Work performed | Main risk |
|---|---|---|---|---|
| `syncState()` | `renderEngine` | Auth hydration/logout, check-in add/remove, Firebase writes, CSV load, map movement/zoom, search input/filtering, settings effects, UI view changes, panel check-in | Batches marker update, stats UI, achievement scheduling. | Direct calls are numerous; call intent is ambiguous. |
| `invalidateVisitedIdsCache()` | `renderEngine` | Auth sign-out/reset, VaultRepo snapshot callback, check-in writes, Firebase replace/reconcile/remove | Clears visited ID cache and marker visibility state. | Easy to forget in future visit mutations. |
| `refreshVisitedVisualState()` | `firebaseService` | Auth subscription options and logout reset, check-in operations, Firebase visit replacements | Calls `markerManager.refreshMarkerStyles()` and `tripLayer.refreshBadgeStyles()`. | Visit visuals coordinated through Firebase service despite VaultRepo owning visit state. |
| `refreshMarkerStyles()` | `MarkerLayerManager` | `firebaseService.refreshVisitedVisualState()` | Updates marker classes for visited state. | Rendering/performance; should be coordinator-triggered. |
| `refreshBadgeStyles()` | `TripLayerManager` | `firebaseService.refreshVisitedVisualState()`, `renderEngine.updateMarkers()` | Updates trip stop badge visited styles. | Duplicated trigger path. |
| `updateStatsUI()` | `profileEngine` | `renderEngine.syncState`, auth hydration/logout, panel check-in | Updates score, counts, states, manage portal. | Runs from broad heartbeat and explicit calls. |
| `evaluateAchievements()` | `profileEngine` | Debounced by `renderEngine`, used by share flows via engine | Achievement evaluation and score sync side effects. | Profile/Firebase side effects inside render cadence. |
| `loadLeaderboard()` | `profileEngine` | Auth snapshot first-load and logout | Reads Firestore leaderboard, personal fallback. | Auth controls profile data load timing. |
| `renderManagePortal()` | `profileEngine` | `updateStatsUI`, Firebase visit date/remove flows | Renders editable visit list. | Firebase write service directly forces profile UI render. |

## 4. Oversized Services And Mixed Responsibilities

| File | Lines | Current mixed responsibilities | Candidate split | Risk |
|---|---:|---|---|---|
| `services/authService.js` | 824 | Firebase init/auth state, broad user snapshot, cloud settings hydration, admin, walk points/streak display, expedition hydration, leaderboard trigger, loader, premium gating, logout reset, auth UI visibility. | Keep auth session owner; later extract small hydrators for settings, profile counters, expedition, logout reset. | HIGH |
| `services/firebaseService.js` | 729 | User progress writes, visit write helpers, canonicalization, streak increment, saved route data, settings saves, completed expedition fetches, global exports. | Keep write behavior stable; later split data APIs by domain after coordinator. | HIGH |
| `modules/renderEngine.js` | 449 | Marker helpers, visited cache, map visibility fingerprint, heartbeat, achievement scheduling, stats refresh, marker filtering. | First create coordinator wrapper around refresh calls; later separate marker heartbeat from profile refresh. | MEDIUM |
| `modules/profileEngine.js` | 828 | Manage portal, score sync, achievements, stats UI, leaderboard, rank/title UI, Firestore writes/reads. | Split leaderboard service, stats renderer, achievement renderer after refresh coordination is stable. | HIGH |
| `renderers/panelRenderer.js` | 393 | Place card DOM rendering, active pin state, check-in actions, distance checks, panel event wiring, trip add button. | Keep renderer mostly UI; move action orchestration later. | MEDIUM |
| `modules/uiController.js` | 359 | Tab/view handlers, many global button bindings, trip/expedition/share dispatch, filter control, feedback write. | Later route button handlers through domain controllers. | MEDIUM |
| `modules/settingsController.js` | 503 | Settings UI rendering, local setting persistence, cloud autosave flags, map/trail refresh effects, terminate/reset flow. | Extract settings effect scheduler only after 2B/2C. | MEDIUM |

## 5. Data Ownership Table

| State domain | Current owner | Current coordination paths | Desired owner | Phase 2 note |
|---|---|---|---|---|
| Park data | `ParkRepo` | `dataService` loads CSV, `renderEngine`/search/profile/trip read repo. | `ParkRepo` remains owner. | Complete; avoid reopening. |
| Visit data | `VaultRepo` | `firebaseService` writes, `checkinService` optimistic updates, `VaultRepo` snapshot, render/profile refresh globals. | `VaultRepo` remains data owner; coordinator owns refresh reactions. | 2C cache migration complete; 2D visual refresh migration implemented and smoke-verified. |
| Auth session | `authService` | Firebase auth observer, auth UI, premium gating, sign-out reset. | `authService` remains owner for now. | Stop line: do not move yet. |
| Cloud settings | `settingsStore` plus `authService` hydration and `settingsController` autosave | Global revision flags and raw setting mirrors. | `settingsStore` for local state; small cloud settings hydrator/service later. | 2F/later. |
| Walk points/streak | `authService`, `firebaseService`, `expeditionEngine`, `profileEngine` | Raw `window.currentWalkPoints`, localStorage streak fallback, profile score sync. | Dedicated progress/profile state service eventually. | HIGH risk; defer. |
| Expedition | `expeditionEngine`, hydrated by `authService` | Auth broad snapshot calls expedition renderers; settings refreshes overlays. | Expedition controller/service. | Defer until coordinator exists. |
| Leaderboard | `profileEngine`, triggered by `authService` | `loadLeaderboard`, `_lastLeaderboardDoc`, `_leaderboardLoadedOnce`, `_lastSyncedScore`. | Profile/leaderboard module, not auth. | Medium/high; after 2B. |
| Trip planner | `tripPlannerCore`, `TripLayerManager`, `routeRenderer`, `barkState` | `tripDays`, `activeDayIdx`, bare window handlers, route loads. | Trip planner store/controller. | Medium; separate from visit refresh. |
| Active marker/panel | `barkState`, `MarkerLayerManager`, `panelRenderer`, `authService` reset | `activePinMarker`, `clearActivePin`, panel refresh. | Panel/selection controller. | Medium; after marker refresh coordinator. |
| Map filters/search | `barkState`, `searchEngine`, `uiController`, `renderEngine` | Search cache, filter state, `syncState()`. | Search/filter store with coordinator refresh. | Medium; defer until a later filter-specific coordinator slice. |
| UI settings | `settingsStore`, `settingsController`, raw `window.*` mirrors | localStorage, cloud autosave, effects scheduler. | Settings store plus effect coordinator. | Medium; avoid auth movement. |

## 6. Risk Ranking

Risk criteria used:

- Number of files touched.
- Whether user data could be lost or overwritten.
- Whether auth/session behavior is involved.
- Whether map rendering/performance is involved.
- Whether deployment or smoke coverage is affected.

| Cleanup candidate | Rank | Why |
|---|---|---|
| Add `RefreshCoordinator` / `AppEvents` wrapper that initially delegates to existing functions. | LOW | Can be additive and no-op-compatible; no data ownership move. |
| Route visit visual refresh calls through coordinator while preserving existing calls internally. | LOW-MEDIUM | Touches visit write/snapshot refresh paths, but no write behavior needs to change. |
| Centralize visited ID cache invalidation behind coordinator. | MEDIUM | Correctness-sensitive because marker filters depend on it; still manageable with focused tests. |
| Reduce direct `syncState()` calls by replacing callers with named coordinator requests. | MEDIUM | Many files touched, but can be mechanical if done one domain at a time. |
| Move `updateStatsUI()`/achievement scheduling out of `syncState()`. | MEDIUM-HIGH | Could affect profile freshness and Firestore achievement/leaderboard side effects. |
| Split small `authService` hydrators without changing auth owner. | MEDIUM-HIGH | Auth/session involved; keep changes tiny and covered by manual smoke. |
| Move cloud settings hydration/autosave ownership. | HIGH | User settings can be overwritten if revision guards are wrong. |
| Move walk points/streak ownership. | HIGH | User score/streak data and leaderboard side effects involved. |
| Rewrite trip planner global state. | HIGH | Many UI handlers and route persistence paths. |
| Replace classic-script globals with ES modules. | HIGH | Broad architecture/deployment blast radius; not Phase 2 early work. |

## 7. Recommended Phase 2 Roadmap

### 2A - Inventory Only

Status: this document.

Scope:

- Inventory global state/function surfaces.
- Rank cleanup risk.
- Identify the safest implementation path.
- No runtime behavior changes.

### 2B - Create `RefreshCoordinator` / `AppEvents` Boundary

Goal: add a small coordinator without changing behavior.

Suggested scope:

- New module loaded after current dependencies are available.
- Export through `window.BARK.refresh` or `window.BARK.events`.
- Implement methods that delegate to existing globals:
  - `requestStateSync(reason)`
  - `visitsChanged(reason)`
  - `markersChanged(reason)`
  - `profileChanged(reason)`
  - `settingsChanged(reason)`
- Preserve existing direct functions (`window.syncState`, `invalidateVisitedIdsCache`, `refreshVisitedVisualState`) during 2B.
- Add lightweight debug logging only if already consistent with repo style.

Acceptance:

- No direct caller migration required in 2B unless it is one very low-risk call.
- App behavior should be identical.
- Manual smoke can be short because this is additive.

### 2C - Move Visited Cache Invalidation Into Coordinator

Status: implemented for visited cache invalidation only.

Goal: make visited cache invalidation intent explicit before broader refresh migration.

Implemented scope:

- Replaced direct inline `window.BARK.invalidateVisitedIdsCache()` calls in visit-state mutation/reconcile/logout paths with file-local helpers that call `refreshCoordinator.refreshVisitedCache(reason)`.
- Kept fallback behavior if `RefreshCoordinator` is absent.
- Kept Firestore write payloads, rollback, pending mutation semantics, visual refresh, `syncState()`, auth/session logic, and ownership boundaries unchanged.

Deferred from 2C:

- Marker style refresh.
- Trip badge refresh.
- `syncState()` migration.
- Stats/profile/leaderboard refresh.

### 2D - Move Visited Visual Refresh Into Coordinator

Status: implemented in `plans/PHASE_2D_VISITED_VISUAL_REFRESH_PLAN.md`; QC and manual smoke passed.

Goal: route visit-state visual refresh requests through the Phase 2B coordinator:

```js
window.BARK.refreshCoordinator.refreshVisitedVisuals(reason)
```

Scope:

- Migrated only the visited visual refresh calls in visit mutation, snapshot reconciliation, and logout/reset paths.
- Use file-local safe helpers where needed.
- Preserve ordering after `VaultRepo` mutation/reconcile and visited cache invalidation, and before existing `syncState()`, stats/profile, or Firestore follow-up calls.
- Kept `firebaseService.refreshVisitedVisualState()` as a legacy implementation/fallback during 2D.
- Deferred `modules/renderEngine.js` trip badge refresh because it belongs to marker render/filter cadence, not visit-state mutation.

Stop lines:

- Do not migrate `syncState()`.
- Do not migrate stats/profile/leaderboard.
- Do not change Firestore writes.
- Do not change auth/session ownership.
- Do not change `VaultRepo` ownership.
- Do not deploy.

### 2E - Reduce Direct `syncState()` Calls

Status: implemented in `plans/PHASE_2E_SYNCSTATE_PLAN.md`; manual smoke passed.

Goal: replace a small set of direct heartbeat calls with named refresh requests while keeping `window.syncState()` as the implementation detail.

Implemented first slice:

1. Added `requestStateSync(reason)` and `requestVisitStateSync(reason)` to `modules/RefreshCoordinator.js`.
2. Added a file-local safe helper in `services/checkinService.js`.
3. Replaced only the three check-in visit mutation direct `window.syncState()` calls.

Acceptance:

- `syncState()` remains the implementation detail.
- Check-in call sites became intent-oriented, not removed wholesale.
- Search/filter, map movement/culling, settings effects, data load, auth hydration/logout, panel DOM action, stats/profile/leaderboard, and Firestore-adjacent helpers remain deferred.

### 2F - Split Small `authService` Responsibility

Status: 2F.2 implemented in `plans/PHASE_2F_AUTHSERVICE_SPLIT_PLAN.md`; manual smoke passed per `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md`.

Goal: reduce file size and coupling while keeping auth session ownership in `authService`.

Implemented first slice:

- Extracted premium gating UI logic into `services/authPremiumUi.js`.

Deferred candidates:

- Cloud settings hydration helper module.
- Profile counter/walk point hydration helper.
- Expedition snapshot hydration helper.
- Logout runtime reset helper.

Rules:

- Do not change `onAuthStateChanged` semantics in the same PR.
- Do not change Firestore snapshot fields.
- Do not change login/logout UI.

### Defer High-Risk Items

Defer until coordinator and smoke coverage are stable:

- Moving auth session ownership.
- Firestore write behavior changes.
- Walk points/streak ownership changes.
- Leaderboard write/read ownership changes.
- Trip planner state rewrite.
- ES module migration.
- Full UI rewrite.

## 8. Safest First Implementation PR

Recommended first implementation PR after this inventory was **Phase 2B, additive coordinator only**. That seam is now complete, Phase 2C migrated visited cache invalidation only, Phase 2D migrated visited visual refresh only, Phase 2E migrated only the three check-in direct `syncState()` calls, and Phase 2F.2 extracted premium gating UI only. Phase 2F.2 manual smoke passed per the post-Phase-2 report.

Why this is safest:

- It can be introduced as a wrapper around existing behavior.
- It does not need to move auth, Firestore writes, visit ownership, or UI rendering.
- It creates named intent methods before any call sites are migrated.
- It gives later PRs a stable place to move refresh logic without mixing multiple ownership changes.

Minimum 2B success criteria:

- New coordinator exists and is globally reachable.
- Existing refresh functions still work.
- No Firestore write payloads change.
- No auth/session behavior changes.
- No visual/UI redesign.
- Existing focused visit tests still pass.
- Manual smoke remains required before deployment.

## 9. Stop Lines

- Do not change ownership of auth session yet.
- Do not change Firestore write behavior.
- Do not rewrite UI.
- Do not deploy.
- Do not combine multiple ownership moves in one PR.
- Do not centralize cache invalidation and split auth hydrators in the same PR.
- Do not move walk points/streak or leaderboard ownership until after refresh coordination is stable.

## Current Stop Point

Phase 2C is complete; manual smoke passed. Phase 2D visited visual refresh migration is implemented in `plans/PHASE_2D_VISITED_VISUAL_REFRESH_PLAN.md`; QC and manual smoke passed. Phase 2E narrow check-in direct-`syncState()` cleanup is implemented in `plans/PHASE_2E_SYNCSTATE_PLAN.md`; manual smoke passed. Phase 2F.2 premium gating UI extraction is implemented in `plans/PHASE_2F_AUTHSERVICE_SPLIT_PLAN.md`; manual smoke passed per `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md`. Automated signed-in Playwright smoke is now unblocked and passing via Firebase Email/Password E2E storage state: `npm run test:e2e:phase1b` passed with 3 tests. Phase 3A.1 premium gating smoke also passed: `npm run test:e2e:premium` passed with 2 tests. Phase 3A.2 account-switch smoke passed: `npm run test:e2e:account-switch` passed with 1 test using User A and User B storage states. Phase 3A.3 profile/manage smoke passed: `npm run test:e2e:profile-manage` passed with 1 test and covers manage portal render, visit listing/count, date edit action, and removal cleanup. Phase 3A.4 trip planner visited styling smoke passed: `npm run test:e2e:trip-visited` passed with 1 test and covers trip stop render, unvisited/visited badge classes, visit persistence after reload, and cleanup; current runtime trip stops do not persist across reload, so post-reload stop persistence is not covered. Phase 3A.5 settings persistence smoke passed: `npm run test:e2e:settings` passed with 1 test and covers `#visited-filter` reload plus cloud-backed fresh storage-state sign-in restore, with cleanup restoring the original value. Full current smoke bundle `npm run test:e2e:smoke` passed with 9 tests and runs the six smoke specs serially with `--workers=1`; required env vars are `BARK_E2E_BASE_URL`, `BARK_E2E_STORAGE_STATE`, and `BARK_E2E_STORAGE_STATE_B`. Phase 3B.1 planning and Phase 3B.2 implementation are captured in `plans/PHASE_3B_PROFILE_LEADERBOARD_SPLIT_PLAN.md`; 3B.2 extracted only pure leaderboard rank/row rendering to `renderers/leaderboardRenderer.js` and left Firestore, score sync, queries, pagination, achievements, auth/session, settings, trip planner, premium gating, VaultRepo, and RefreshCoordinator unchanged. Phase 4A premium entitlement/paywall architecture planning is captured in `plans/PHASE_4A_PREMIUM_ENTITLEMENT_PLAN.md`. Phase 4B added read-only `services/premiumService.js`, exposed `window.BARK.services.premium` / `window.BARK.premiumService`, and wired `authService` only to reset/feed entitlement state from the existing user snapshot; no UI gating switch, payment provider, payment buttons, Firestore writes, Firebase rules, tests, localStorage premium trust, or deployment were added. Phase 4C.1 planning is captured in `plans/PHASE_4C_ENTITLEMENT_UI_GATING_PLAN.md`; runtime gating changes are not started, and global search, offline mode, ORS callables, premium clustering, payment provider work, Firebase rules, and deployment remain deferred. Google OAuth remains blocked in Playwright, real users still use Google sign-in, and no email/password UI was added. Do not deploy, do not start 3B.3 unless a focused leaderboard smoke is explicitly requested, and do not combine authService extraction with further direct-`syncState()` cleanup, auth/session movement, Firestore, stats/profile/leaderboard data movement, map render cadence, search/filter cadence, `VaultRepo` ownership work, or payment implementation.
