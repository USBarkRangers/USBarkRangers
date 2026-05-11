# Post Phase 2 Architecture Report

Date: 2026-05-01

Scope at creation: architecture review only. No runtime app code was changed. Phase 3 had not started. Addendum: Phase 3A.1, Phase 3A.2, Phase 3A.3, Phase 3A.4, and Phase 3A.5 have now added automated Playwright smoke coverage only; no runtime app code, auth logic, profile behavior, trip planner behavior, settings logic, cloud hydration logic, payments, entitlements, email/password UI, or deployment changes were made.

## Evidence Reviewed

Required searches were run across `services modules renderers repos state engines core`:

```sh
rg "window\\.BARK\\." services modules renderers repos state engines core -g '*.js'
rg "window\\._|window\\.current|window\\.syncState" services modules renderers repos state engines core -g '*.js'
rg "syncState\\(" services modules renderers repos state engines core -g '*.js'
rg "invalidateVisitedIdsCache|refreshVisitedCache|refreshVisitedVisualState|refreshVisitedVisuals|requestVisitStateSync|requestStateSync" services modules renderers repos state engines core -g '*.js'
rg "onAuthStateChanged|onSnapshot|collection\\('users'\\)|collection\\(\"users\"\\)" services modules renderers repos state engines core -g '*.js'
rg "localStorage|sessionStorage" services modules renderers repos state engines core -g '*.js'
rg "addEventListener|onclick|document\\.getElementById|querySelector" services modules renderers repos state engines core -g '*.js'
wc -l services/authService.js services/firebaseService.js modules/renderEngine.js modules/profileEngine.js renderers/panelRenderer.js modules/uiController.js modules/settingsController.js modules/RefreshCoordinator.js repos/VaultRepo.js repos/ParkRepo.js services/authPremiumUi.js
```

Additional focused checks:

```sh
wc -l engines/tripPlannerCore.js
node tests/phase1b-pending-delete-canonical-replacement.test.js
node tests/phase1c-vault-subscription.test.js
```

Both focused node tests passed in this reporting pass.

## 1. Executive Summary

Phase 1 fixed the largest ownership problem. Park records now live behind `ParkRepo`, visit records now live behind `VaultRepo`, the old public visit Map shim is gone, visit writers/readers use repo APIs, rollback is conflict-aware, and `VaultRepo` owns the visitedPlaces snapshot lifecycle.

Phase 2 fixed part of the refresh coordination problem. `RefreshCoordinator` now exists as an additive boundary. Visited ID cache invalidation, visited visual refresh, and the three check-in visit-state sync requests now go through named coordinator methods with legacy fallbacks. Phase 2F.2 also extracted premium gating DOM work into `services/authPremiumUi.js`, shrinking authService's direct UI responsibility slightly.

What remains messy is substantial: `window.syncState()` is still the central render/profile/achievement heartbeat and is still called directly by auth, Firebase, map, search, settings, UI, data load, and panel paths. `authService.js` still owns or coordinates auth session, a broad `users/{uid}` snapshot, cloud settings hydration, admin state, walk points, streaks, expedition hydration, leaderboard trigger, logout reset, loader dismissal, and auth UI. `profileEngine.js`, `firebaseService.js`, `settingsController.js`, and `tripPlannerCore.js` remain mixed-responsibility modules.

The app is safer than before. The highest-value user-data ownership boundary is now real, visit refresh intent is clearer in the most important write paths, and focused VaultRepo tests cover races that used to be dangerous.

Deploy readiness is improved but still conditional. Manual smoke is reported as passed after Phase 2F.2, and automated signed-in Playwright is now unblocked through the Firebase Email/Password E2E test account. `npm run test:e2e:phase1b` passed with 3 tests. Google OAuth remains blocked in Playwright Chromium, but the harness now uses Email/Password storage state. Real users still use Google sign-in, and no email/password UI was added. No deployment should happen unless final release smoke is repeated and accepted.

## 2. Architecture Progress Scorecard

Percentages are progress toward the desired architecture, not code quality scores.

| Area | Progress | Honest status |
|---|---:|---|
| Data ownership | 72% | Park and visit ownership are strong; settings, walk points, leaderboard, trip planner, and active selection are not. |
| Visit-state safety | 78% | Repo APIs, snapshot ownership, rollback tokens, and focused tests are strong. Remaining risk is refresh/UI sequencing around global callers. |
| Refresh coordination | 45% | The coordinator exists and owns selected visit-refresh requests. Most direct `syncState()` and profile/map refresh paths remain direct. |
| `authService` responsibility separation | 25% | Premium gating moved out. The auth listener, user snapshot, cloud settings, profile counters, expedition, leaderboard, and logout reset remain. |
| Profile/leaderboard separation | 15% | Still mostly combined in `profileEngine.js`, with auth and render cadence triggering profile work. |
| UI/global DOM coupling | 20% | DOM access remains widespread. `window.BARK.DOM` helps, but direct `document.getElementById`, `querySelector`, `onclick`, and listeners are still common. |
| Test coverage | 58% | Focused VaultRepo tests are useful, and signed-in Playwright now covers visits, premium gating, account switching, profile/manage, settings persistence, and trip planner visited styling through the Email/Password E2E harness. No full regression net around auth/settings/profile/leaderboard. |
| Launch readiness | 68% | Manual smoke passed after 2F.2, and `npm run test:e2e:phase1b` passed with 3 tests. Release still needs final accepted smoke on the deploy candidate. |

## 3. Before vs After

| Area | Before | After Phase 2 | Remaining issue |
|---|---|---|---|
| Park data | Park records were exposed through global arrays and direct lookups. | `ParkRepo` owns canonical park data and publishes an explicit repo API. | Consumers still reach the repo through `window.BARK.repos.ParkRepo`. |
| Visit data | Visit state was effectively global, with direct Map reads/writes and scattered mutation assumptions. | `VaultRepo` owns visit records, pending mutations, rollback tokens, and visitedPlaces snapshot reconciliation. | Firebase/check-in/auth still coordinate Firestore writes and refresh side effects around the repo. |
| Manual refresh paths | Visit writes had to remember cache invalidation, marker visual refresh, trip badge refresh, `syncState()`, stats/profile updates, and sometimes manage portal render. | Visited cache and visited visual refresh now route through `RefreshCoordinator`; check-in visit sync requests use `requestVisitStateSync`. | Most `syncState()`, stats/profile/leaderboard, achievement, and map render cadence calls remain direct. |
| Globals | Many globals carried data, services, DOM, settings, map, trip, score, and profile state. | The biggest data globals have better owners; some state is mirrored through `appState` and `settingsStore`. | The app is still a classic-script browser-global app. The repo/global boundary is cleaner, not eliminated. |

## 4. Current Ownership Map

| Domain | Current owner | Desired owner | Risk | Next action |
|---|---|---|---|---|
| Park data | `repos/ParkRepo.js` | `ParkRepo` | Low | Do not reopen unless a park-data bug appears. |
| Visit data | `repos/VaultRepo.js` plus Firebase/check-in writers | `VaultRepo` for state; Firebase/check-in for writes | Medium | Keep repo ownership stable; move only refresh/event naming around it. |
| `visitedPlaces` snapshot | `VaultRepo.startSubscription()` | `VaultRepo` | Low-medium | Keep the visitedPlaces-only listener in the repo; do not merge back into auth. |
| Auth session | `services/authService.js` | `authService` | High | Keep as owner; extract only helper-sized responsibilities after release gates. |
| Cloud settings | `settingsStore`, `settingsController`, `authService` hydration flags | Dedicated cloud settings hydrator around `settingsStore` | High | Do not move until overwrite/race tests exist. |
| Walk points/streak | `authService`, `firebaseService`, `expeditionEngine`, `profileEngine`, raw `window.currentWalkPoints` | Dedicated progress/profile state service | High | Defer; user score/streak data is sensitive. |
| Expedition | `modules/expeditionEngine.js`, hydrated by auth | Expedition controller/service | Medium-high | Defer until auth/profile refresh behavior is test-covered. |
| Leaderboard | `modules/profileEngine.js`, triggered by auth | Leaderboard service plus renderer | Medium-high | Extract after release gates or after auth helper extractions. |
| Profile/stats | `modules/profileEngine.js`, triggered by render/auth/panel | Profile stats module with explicit refresh requests | Medium-high | Separate from `syncState()` carefully; add tests first. |
| Trip planner | `engines/tripPlannerCore.js`, `TripLayerManager`, `routeRenderer`, `barkState` globals | Trip planner store/controller | Medium | Do not combine with visit/auth/profile work. |
| Map/search/filter | `barkState`, `searchEngine`, `renderEngine`, `mapEngine`, `uiController` | Search/filter state owner plus render coordinator | Medium | Later direct-`syncState()` cleanup by domain. |
| Settings UI | `settingsController` plus `settingsStore` | `settingsStore` plus settings UI/effects split | Medium-high | Avoid until cloud hydration tests exist. |
| Active pin/panel | `barkState`, `MarkerLayerManager`, `panelRenderer`, auth reset | Selection/panel controller | Medium | Defer; panel behavior is user-visible and DOM-heavy. |
| Premium gating UI | `services/authPremiumUi.js` called by auth | `authPremiumUi` | Low | Keep as-is. This extraction is complete enough for now. |

## 5. Remaining Global Coupling

Acceptable globals for now:

- Static namespace and config: `window.BARK`, `window.BARK.config`, Firebase config, constants, normalization dictionaries.
- Repo/service registries: `window.BARK.repos.*`, `window.BARK.services.*`. These are globals, but they are now meaningful boundaries.
- Boot diagnostics and readiness flags: `bootOrder`, `__barkStateReady`, `__settingsStoreReady`, `_bootErrors`.
- Map singleton `window.map` while the app remains classic-script Leaflet code.

Temporary globals that should shrink over time:

- `window.syncState`
- `window.BARK.refreshCoordinator`
- `window.BARK.activePinMarker`
- `window.BARK.activeSearchQuery`, `activeTypeFilter`, `activeSwagFilters`, `visitedFilterState`
- `window.BARK.tripDays`, `activeDayIdx`, `window.tripStartNode`, `window.tripEndNode`, `window.isTripEditMode`
- `window.BARK._searchResultCache`, marker revision/cache flags

Risky globals:

- `window.currentWalkPoints`
- `_cloudSettingsLoaded`, `_pendingLocalSettingsChanges`, `_savingCloudSettingsRevision`, `_lastAppliedCloudSettingsRevision`
- `_serverPayloadSettled`, `_firstServerPayloadReceived`
- `_lastSyncedScore`, `_lastKnownRank`, `_lastLeaderboardDoc`, `_leaderboardLoadedOnce`
- Direct `localStorage`/`sessionStorage` writes split across auth, settings, map, data, and Firebase services

Should-not-touch-yet globals:

- Cloud settings revision flags, until there are tests for stale cloud snapshots and local pending changes.
- Walk points/streak/leaderboard globals, until the newly unblocked signed-in automation is broadened beyond the Phase 1B visit smoke path.
- Trip planner globals, because they are broad UI state and separate from the visit-state refactor.
- Map render cadence flags like `_isMoving`, `_isZooming`, `_pendingMarkerSync`, `_forceMarkerLayerReset`, until render performance is tested.

## 6. Remaining Oversized Modules

| File | Lines | Current responsibilities | What improved | Still needs extraction | Risk |
|---|---:|---|---|---|---|
| `services/authService.js` | 813 | Firebase init/auth observer, broad user doc snapshot, cloud settings hydration, admin, walk points/streak display, expedition hydration, leaderboard trigger, loader, logout reset, auth UI, premium gating wrapper. | visitedPlaces snapshot moved to `VaultRepo`; premium gating DOM moved to `authPremiumUi`; visited refresh helpers use coordinator. | Cloud settings hydrator, logout reset helper, profile/walkpoint hydrator, expedition hydrator, auth UI helper. | High |
| `services/firebaseService.js` | 749 | Visit writes, canonical visit helpers, rollback/pending integration, user progress sync, streak increment, settings save, completed expedition fetches, route-adjacent user data APIs, global exports. | Visit state is delegated to `VaultRepo`; visited cache/visual refresh calls use coordinator helpers. | Split by domain only after tests: visit write service, settings persistence, streak/progress, expedition data. | High |
| `modules/profileEngine.js` | 828 | Manage portal, score calculation use, achievement rendering/evaluation, score sync, stats UI, rank/title UI, leaderboard loading/pagination. | Reads visit state through `VaultRepo` helpers. | Leaderboard service, stats renderer, achievement renderer/evaluator boundary, score sync service. | High |
| `modules/renderEngine.js` | 449 | Marker helper functions, visited ID cache, marker visibility fingerprint, `syncState()`, achievement scheduling, stats refresh, marker filtering. | `invalidateVisitedIdsCache()` is now called through coordinator helpers in key visit paths. | Separate marker render heartbeat from profile/stats/achievement refresh. | Medium |
| `renderers/panelRenderer.js` | 393 | Place card DOM, active pin state, check-in button flows, visit/action feedback, trip add button, local direct `syncState()`. | Visit reads use repo-backed helpers; check-in mutations are routed through `checkinService`. | Move action orchestration out of renderer; keep card renderer mostly presentation. | Medium |
| `modules/settingsController.js` | 503 | Settings overlay UI, local persistence, cloud autosave revision flags, map style/performance effects, trail overlay refresh, terminate/reset flow. | Uses `settingsStore` for registered settings. | Cloud settings autosave/hydration owner, effect scheduler, reset flow helper. | Medium-high |
| `modules/uiController.js` | 359 | Global tab/view bindings, filter control, modal/button wiring, trip/expedition/share dispatch, feedback submit, direct `syncState()`. | Some logic routes to domain functions instead of owning it all. | Event binding should eventually dispatch to domain controllers; visited filter should go through state/coordinator. | Medium |
| `engines/tripPlannerCore.js` | 691 | Trip state, planner UI rendering, inline handlers, optimization, route generation, route save, trip reset. | Mostly isolated from Phase 1/2 visit ownership work. | Trip planner store/controller and removal of inline `onclick` strings, later. | Medium-high |

## 7. Refresh/Event Coordination Status

Now using `RefreshCoordinator`:

- Visited cache invalidation:
  - `authService` uses `refreshVisitedCache(...)` for VaultRepo snapshot reconcile and logout/no-session paths.
  - `firebaseService` uses `refreshVisitedCache(...)` for snapshot reconcile, local visit replacement, and remove visit.
  - `checkinService` uses `refreshVisitedCache(...)` for verified add, unmark remove, and manual mark add.
- Visited visuals:
  - `authService`, `firebaseService`, and `checkinService` route visit visual refresh requests through `refreshVisitedVisuals(...)`.
  - The legacy implementation remains `firebaseService.refreshVisitedVisualState()`, which refreshes marker styles and trip badge styles.
- Check-in visit sync requests:
  - `checkinService` routes the three visit mutation sync requests through `requestVisitStateSync(...)`.

Still direct:

- `window.syncState()` direct callers remain in `authService`, `firebaseService`, `dataService`, `mapEngine`, `searchEngine`, `settingsController`, `uiController`, and `panelRenderer`, plus the coordinator internals.
- Stats/profile refresh remains direct via `window.BARK.updateStatsUI()` in auth, render, and panel paths.
- Leaderboard refresh remains in `profileEngine`, triggered by auth.
- Achievement evaluation is still scheduled from `renderEngine.syncState()`.
- Map render cadence remains direct in map/render/search/settings paths.
- Active-pin button refresh is still private auth/panel DOM logic, not a coordinator-owned action.

## 8. Testing/Release Gate Status

Focused VaultRepo tests:

- `node tests/phase1b-pending-delete-canonical-replacement.test.js`: PASS in this reporting pass.
- `node tests/phase1c-vault-subscription.test.js`: PASS in this reporting pass.

Phase 1B/1C coverage:

- Phase 1B focused rollback/canonical replacement coverage exists.
- Phase 1C VaultRepo subscription coverage exists.
- Playwright smoke coverage exists at `tests/playwright/phase1b-visited-smoke.spec.js`.
- Automated signed-in execution is now unblocked through the Firebase Email/Password E2E test account and `BARK_E2E_STORAGE_STATE`.
- `npm run test:e2e:phase1b`: PASS, 3 passed.

Phase 3A.1 premium gating coverage:

- `tests/playwright/phase3a-premium-gating-smoke.spec.js` covers current signed-in gating behavior only, not paid entitlement logic.
- `npm run test:e2e:premium`: PASS, 2 passed.
- Signed-out coverage checks `#premium-filters-wrap`, `#visited-filter`, `#map-style-select`, and optional trail buttons.
- Signed-in coverage uses `BARK_E2E_STORAGE_STATE` and checks the same controls unlock.
- Trail buttons are tolerant of not being rendered; `#visited-filter` and `#map-style-select` are strict when present.

Phase 3A.2 account-switch coverage:

- `tests/playwright/phase3a-account-switch-smoke.spec.js` verifies User A visits do not appear for User B.
- `npm run test:e2e:account-switch`: PASS, 1 passed.
- User A storage state uses `BARK_E2E_STORAGE_STATE`.
- User B storage state uses `BARK_E2E_STORAGE_STATE_B`.
- The test marks one isolated test park for User A, reloads and confirms persistence, confirms User B does not see that visit, returns to User A, then removes the User A visit and confirms cleanup persists.
- The test watches for relevant console/page errors containing `VaultRepo`, auth/user snapshot, stale uid, `userVisitedPlaces`, or `__legacyMapView`.

Phase 3A.3 profile/manage coverage:

- `tests/playwright/phase3a-profile-manage-smoke.spec.js` verifies signed-in profile manage portal rendering for a newly visited test park.
- `npm run test:e2e:profile-manage`: PASS, 1 passed.
- Covered selectors include `.nav-item[data-target="profile-view"]`, `#profile-view`, `#manage-places-portal`, `#manage-places-list`, and `#manage-portal-count`.
- The test marks a test park visited, opens the profile manage portal, confirms the park appears, confirms the manage count matches `VaultRepo.size()`, exercises the date input and Update button when present, removes the visit via the manage row action, reloads, and confirms the park is no longer listed.
- Date edit was covered as an action. After reload, the gate is visit visibility plus no relevant console error rather than exact date persistence, because current cloud-sync behavior may rehydrate the original timestamp.
- The test watches for relevant console/page errors containing `profileEngine`, `renderManagePortal`, `updateStatsUI`, `VaultRepo`, `userVisitedPlaces`, or `__legacyMapView`.

Phase 3A.4 trip planner visited styling coverage:

- `tests/playwright/phase3a-trip-planner-visited-smoke.spec.js` verifies trip planner badge styling follows `VaultRepo` visit state.
- `npm run test:e2e:trip-visited`: PASS, 1 passed.
- Covered selectors include `#trip-queue-list .stop-list-item`, `.trip-overlay-badge-wrapper--bark`, `.trip-overlay-badge-wrapper--unvisited`, and `.trip-overlay-badge-wrapper--visited`.
- The test adds a signed-in test park to the trip planner, confirms the initial unvisited badge class, marks the park visited, confirms the visited badge class, reloads and confirms the visit persists, then removes the visit and confirms the badge returns to unvisited while the trip stop is present.
- Trip stop persistence after reload is not supported by current runtime trip state, so that sub-check is documented as not covered; the test re-adds the stop after reload to verify persisted visit state still drives trip badge styling.
- Cleanup behavior removes/unmarks the test visit and resets the trip planner runtime.
- The test watches for relevant console/page errors containing `TripLayerManager`, trip planner, `refreshBadgeStyles`, `RefreshCoordinator`, `VaultRepo`, `userVisitedPlaces`, or `__legacyMapView`.

Phase 3A.5 settings persistence coverage:

- `tests/playwright/phase3a-settings-persistence-smoke.spec.js` verifies basic signed-in settings persistence without touching destructive settings.
- `npm run test:e2e:settings`: PASS, 1 passed.
- Covered setting: `#visited-filter`.
- Covered selectors include `#visited-filter`, `.nav-item[data-target="profile-view"]`, `#profile-view`, `#settings-gear-btn`, `#settings-overlay`, `#save-settings-cloud-btn`, and `#close-settings-btn`.
- The test records the original visited-filter value, switches to a safe alternate value, saves through the existing cloud settings button, reloads and confirms persistence, signs out, opens a fresh storage-state signed-in context and confirms cloud-backed restore, then restores the original value and saves it back to cloud.
- Cleanup behavior restores the original visited-filter value in a `finally` path when possible and confirms cleanup persists after reload.
- The test watches for relevant console/page errors containing `settingsController`, `settingsStore`, auth cloud hydration, cloud settings, `localStorage`, `sessionStorage`, save-user-settings, or Firestore write failures.

Manual smoke:

- Manual signed-in smoke passed after Phase 2F.2 per current task context.
- This is good enough for internal refactor confidence.
- It is not a standing deployment waiver unless release smoke is repeated and accepted.

Automated signed-in Playwright:

- Unblocked and passing with the Firebase Email/Password E2E test account and saved storage state.
- `npm run test:e2e:phase1b`: PASS, 3 passed.
- `npm run test:e2e:premium`: PASS, 2 passed.
- `npm run test:e2e:account-switch`: PASS, 1 passed.
- `npm run test:e2e:profile-manage`: PASS, 1 passed.
- `npm run test:e2e:trip-visited`: PASS, 1 passed.
- `npm run test:e2e:settings`: PASS, 1 passed.
- Full current smoke bundle command exists: `npm run test:e2e:smoke`.
- `npm run test:e2e:smoke`: PASS, 9 passed. The bundle runs serially with `--workers=1` because these smokes share Firebase E2E accounts and mutate visit/settings state.
- Bundle includes `phase1b-visited-smoke`, `phase3a-premium-gating-smoke`, `phase3a-account-switch-smoke`, `phase3a-settings-persistence-smoke`, `phase3a-profile-manage-smoke`, and `phase3a-trip-planner-visited-smoke`.
- Required bundle env vars: `BARK_E2E_BASE_URL`, `BARK_E2E_STORAGE_STATE`, and `BARK_E2E_STORAGE_STATE_B` for account-switch coverage.
- Google OAuth remains blocked in Playwright Chromium, so the automated harness should continue using Email/Password storage state.
- Real users still use Google sign-in. No email/password UI was added to the runtime app.
- Do not commit `storage-state.json`, saved browser state, or real credentials.

User B storage-state generation:

```sh
export BARK_E2E_BASE_URL=http://localhost:4173/index.html
export BARK_E2E_STORAGE_STATE="$PWD/node_modules/.cache/bark-e2e/storage-state-b.json"
export BARK_E2E_AUTH_EMAIL=bark-e2e-test-b@example.com
export BARK_E2E_AUTH_PASSWORD="<test-only password from the secure vault>"
npm run e2e:auth:save
```

Do not commit the generated storage-state file or real credentials.

Must pass before deployment:

- Repeat signed-in release smoke after the final deploy candidate is built.
- Confirm no critical console errors.
- Verify sign in/out, visit load, mark/unmark, reload persistence, date edit if available, logout clear, sign-back-in restore, visited filters, map marker/panel visual state, settings persistence, premium gating, trip planner basics, profile stats, leaderboard safe load, and saved routes safe load.
- Re-run focused node tests.
- Re-run `npm run test:e2e:smoke` using the Email/Password E2E storage states before deployment. The underlying specs are `npm run test:e2e:phase1b`, `npm run test:e2e:premium`, `npm run test:e2e:account-switch`, `npm run test:e2e:settings`, `npm run test:e2e:profile-manage`, and `npm run test:e2e:trip-visited`.

## Phase 3A.1 Addendum

Phase 3A.1 is complete as a test-harness-only slice:

- Added `tests/playwright/phase3a-premium-gating-smoke.spec.js`.
- Added npm script `test:e2e:premium`.
- Verified `node --check tests/playwright/phase3a-premium-gating-smoke.spec.js`.
- Verified `npm run test:e2e:premium`: PASS, 2 passed.
- Verified `npm run test:e2e:phase1b`: PASS, 3 passed.
- No runtime app code, auth logic, `services/authPremiumUi.js`, payment logic, entitlement logic, or deployment changes were made in Phase 3A.1.

Phase 3A.2 is complete as a test-harness-only slice:

- Added `tests/playwright/phase3a-account-switch-smoke.spec.js`.
- Added npm script `test:e2e:account-switch`.
- Verified `node --check tests/playwright/phase3a-account-switch-smoke.spec.js`.
- Verified `npm run test:e2e:account-switch`: PASS, 1 passed.
- Verified `npm run test:e2e:phase1b`: PASS, 3 passed.
- Cleanup behavior: the User A test visit is removed at the end, reload persistence is checked, and User B's visit count/record for that park remains unchanged.
- No runtime app code, auth logic, Firebase rules, email/password UI, payment logic, entitlement logic, profile/manage tests, or deployment changes were made.

Phase 3A.3 is complete as a test-harness-only slice:

- Added `tests/playwright/phase3a-profile-manage-smoke.spec.js`.
- Added npm script `test:e2e:profile-manage`.
- Verified `node --check tests/playwright/phase3a-profile-manage-smoke.spec.js`.
- Verified `npm run test:e2e:profile-manage`: PASS, 1 passed.
- Verified `npm run test:e2e:phase1b`: PASS, 3 passed.
- Date edit coverage: the manage row date input and Update button were exercised. Exact date persistence is not the release gate; post-reload visibility and absence of relevant console errors are.
- Cleanup behavior: the User A test visit is removed through the manage row action, reload persistence is checked, and the manage portal count/list updates after removal.
- No runtime app code, auth logic, profileEngine behavior, Firebase rules, email/password UI, payment logic, entitlement logic, trip planner tests, or deployment changes were made.

Phase 3A.4 is complete as a test-harness-only slice:

- Added `tests/playwright/phase3a-trip-planner-visited-smoke.spec.js`.
- Added npm script `test:e2e:trip-visited`.
- Verified `node --check tests/playwright/phase3a-trip-planner-visited-smoke.spec.js`.
- Verified `npm run test:e2e:trip-visited`: PASS, 1 passed.
- Verified `npm run test:e2e:phase1b`: PASS, 3 passed.
- Trip planner persistence after reload: not supported by current runtime trip state, so post-reload trip stop persistence is not covered. The test covers dynamic styling before reload, visit persistence after reload, and styling again after re-adding the stop.
- Cleanup behavior: the User A test visit is removed/unmarked and the trip planner runtime is reset.
- No runtime app code, auth logic, trip planner behavior, VaultRepo behavior, RefreshCoordinator behavior, email/password UI, payment logic, entitlement logic, or deployment changes were made.

Phase 3A smoke bundle is complete as a package-script-only slice:

- Added npm script `test:e2e:smoke`.
- The bundle runs the current smoke specs with `--workers=1`.
- Verified `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"`: PASS.
- Verified `npm run test:e2e:smoke`: PASS, 9 passed after Phase 3A.5 was added.
- Required env vars are `BARK_E2E_BASE_URL`, `BARK_E2E_STORAGE_STATE`, and `BARK_E2E_STORAGE_STATE_B`.
- No runtime app code, auth logic, test logic, payment logic, entitlement logic, email/password UI, or deployment changes were made.

Phase 3A.5 is complete as a test-harness-only slice:

- Added `tests/playwright/phase3a-settings-persistence-smoke.spec.js`.
- Added npm script `test:e2e:settings`.
- Added the settings persistence spec to `test:e2e:smoke`.
- Verified `node --check tests/playwright/phase3a-settings-persistence-smoke.spec.js`.
- Verified `npm run test:e2e:settings`: PASS, 1 passed.
- Verified `npm run test:e2e:smoke`: PASS, 9 passed.
- Setting covered: `#visited-filter`.
- Cleanup behavior: the original visited-filter value is restored and saved back to cloud, then reload persistence is checked.
- No runtime app code, settings logic, cloud hydration logic, auth logic, payment logic, entitlement logic, email/password UI, or deployment changes were made.

Phase 3B.1 is complete as a plan-only slice:

- Added `plans/PHASE_3B_PROFILE_LEADERBOARD_SPLIT_PLAN.md`.
- Inventory confirmed `modules/profileEngine.js` is 828 lines and still owns manage portal rendering, stats UI, achievement evaluation/rendering, score sync, leaderboard loading/rendering/pagination, rank/title UI, and Firestore reads/writes.
- Recommended first extraction for 3B.2 is a pure leaderboard rank/row renderer helper only.
- No runtime app code, tests, Firestore behavior, score calculation, achievement logic, auth/session behavior, or deployment changes were made.

Phase 3B.2 is complete as a small runtime extraction:

- Added `renderers/leaderboardRenderer.js`.
- Exported `window.BARK.leaderboardRenderer` with `getSafeLeaderboardRank`, `formatLeaderboardRank`, and `createLeaderboardRow`.
- `modules/profileEngine.js` now delegates pure leaderboard row/rank presentation to that helper.
- `index.html` now loads `renderers/leaderboardRenderer.js` before `modules/profileEngine.js`, and the touched profile script cache bust was bumped.
- Kept in `profileEngine.js`: cached leaderboard data, personal fallback construction, `parseLeaderboardRankCount()`, `renderLeaderboard()` orchestration, `loadLeaderboard()`, `loadMoreLeaderboard()`, `syncScoreToLeaderboard()`, `evaluateAchievements()`, `updateStatsUI()`, Firestore reads/writes, Firebase auth uid lookup, show-more wiring, exact-rank fallback construction, and personal rank display orchestration.
- Verification: `node --check renderers/leaderboardRenderer.js modules/profileEngine.js` passed; `npm run test:e2e:profile-manage` passed with 1 test; `npm run test:e2e:smoke` passed with 9 tests on rerun.
- Manual leaderboard check passed: profile opened, leaderboard rendered, personal rank rendered, current-user fallback row was visible, Show More loaded safely, and no relevant leaderboard/profile/Firebase/Firestore console errors were observed.
- No tests, Firestore behavior, score calculation, achievement logic, auth/session behavior, settings, trip planner, premium gating, VaultRepo, RefreshCoordinator, or deployment changes were made.

## 9. Recommended Phase 3

Recommended direction: Option D, test harness/paywall readiness and stabilization.

Reason: the code is safer, but the biggest launch need is still confidence rather than another extraction. Automated signed-in Playwright is now unblocked for the Phase 1B smoke path, and premium/paywall-adjacent UI was just touched. The highest ROI move is to keep release validation repeatable, broaden it where needed, and then decide whether further refactor is worth doing before launch.

| Option | Impact | Risk | Launch value | Time cost | Rank |
|---|---|---|---|---|---:|
| D. Test harness/paywall readiness | High | Low-medium | Very high | Medium | 1 |
| A. Continue authService helper extractions | Medium | Medium-high | Medium | Medium | 2 |
| B. Profile/leaderboard extraction | High | High | Medium | High | 3 |
| C. Settings hydration extraction | Medium-high | High | Medium | Medium-high | 4 |

Option A is the next architecture move if refactoring continues after stabilization. It should be helper-sized only: logout reset helper, cloud settings helper, profile/walkpoint hydrator, or expedition hydrator, one at a time. Do not combine it with refresh cleanup.

Option B is valuable but riskier because profile, score sync, achievement evaluation, rank UI, and leaderboard are tangled.

Option C has real value but the highest overwrite risk because cloud settings race guards are global and user-facing.

Phase 3B.2 is now complete. The next profile/leaderboard step should be Phase 3B.3 only if a focused leaderboard smoke is explicitly requested. Do not move Firestore writes, leaderboard queries, score sync, or achievement logic without that added coverage.

Phase 4A premium entitlement/paywall architecture planning is complete in `plans/PHASE_4A_PREMIUM_ENTITLEMENT_PLAN.md`. It is plan-only: no payment provider, payment buttons, entitlement runtime code, Firebase rules, tests, or deployment were added. The recommended model is external-provider source of truth, Firestore client-readable entitlement cache, and admin override support for beta/testers.

Phase 4B is complete as a read-only entitlement skeleton:

- Added `services/premiumService.js`.
- Exposes `window.BARK.services.premium` / `window.BARK.premiumService`.
- Normalizes missing/null entitlement to free and computes premium only for `premium === true` plus `active` or `manual_active` status.
- `authService` now resets premium state on account change/sign-out and feeds `data.entitlement` from the existing broad user snapshot.
- Existing `authPremiumUi` sign-in-only gating is unchanged; Phase 4C is the future entitlement-based UI switch.
- No Firestore writes, payment provider, checkout, payment buttons, Firebase rules, localStorage premium trust, or deployment were added.
- Verification passed: syntax checks, entitlement reference grep, premium smoke, focused settings smoke, full smoke bundle rerun with 9 tests, browser smoke for old premium UI behavior, auth snapshot entitlement feed check, and `git diff --check`.

Phase 4C.1 planning is complete in `plans/PHASE_4C_ENTITLEMENT_UI_GATING_PLAN.md`. It recommends updating tests/test data before switching runtime gating, gating only low-risk premium UI controls first, and deferring global search, offline mode, ORS callables, premium clustering, payment provider work, payment buttons, Firebase rules, and deployment.

Phase 4C.2 entitlement smoke scaffolding is added:

- Added `tests/playwright/phase4c-premium-entitlement-smoke.spec.js`.
- Added npm script `test:e2e:entitlement`.
- `npm run test:e2e:entitlement`: PASS, 1 passed.
- `npm run test:e2e:phase1b`: PASS, 3 passed.
- The test verifies `premiumService.isPremium()` is false for the free signed-in storage state and true for the premium/manual override storage state.
- Premium Firestore doc exists at `users/F8hS3KCvBBX4giarDtnJHDQSMmz2`, with `entitlement` stored as a Firestore map.
- Premium storage state is local-only and must not be committed.
- It does not require UI controls to differ yet; the UI switch remains Phase 4C.3.
- No runtime app code, authPremiumUi behavior, premiumService behavior, Firestore writes, payment logic, email/password UI, or deployment changes were made.
- Google OAuth remains blocked in Playwright; E2E uses Firebase Email/Password storage state while real users still use Google sign-in.
- Phase 4C.3 UI entitlement gating switch is now ready to implement next.

Phase 4C.3 low-risk UI entitlement gating is complete:

- `#premium-filters-wrap`, `#visited-filter`, and `#map-style-select` now use effective premium entitlement state.
- Signed-out users remain locked.
- Signed-in free users stay locked for these low-risk controls.
- Premium/manual override users unlock these low-risk controls.
- Locking preserves the previous reset behavior for visited filter and map style.
- Trail buttons remain auth-gated and are not entitlement-gated in this slice.
- Global search, offline mode, premium clustering/bubble mode, ORS route/geocode callables, backend/server enforcement, Firebase rules, payment provider work, and payment buttons remain deferred.
- Verification passed: entitlement smoke 1 passed, premium smoke 2 passed, and full smoke bundle 9 passed.
- No Firestore writes, client entitlement writes, Firebase rules, payment logic, email/password UI, or deployment changes were made.

## 10. Stop / Do-Not-Do List

- Do not start additional Phase 3 work beyond the completed Phase 3A.1 premium gating, Phase 3A.2 account-switch, Phase 3A.3 profile/manage, Phase 3A.4 trip planner visited styling, Phase 3A.5 settings persistence, Phase 3B.1 planning, and Phase 3B.2 leaderboard renderer extraction slices in this task.
- Do not deploy without repeated and accepted release smoke.
- Do not rewrite classic-script globals into ES modules now.
- Do not move the auth observer or broad `users/{uid}` snapshot yet.
- Do not merge the `VaultRepo` visitedPlaces listener back into auth.
- Do not move cloud settings hydration/autosave ownership without tests for local pending changes, old cloud revisions, from-cache snapshots, and forced local reset.
- Do not move walk points, streaks, achievements, score sync, or leaderboard state before signed-in validation covers those flows reliably.
- Do not change Firestore write behavior while doing UI/helper cleanup.
- Do not refactor trip planner or map render cadence as part of auth/profile/settings work.
- Do not remove legacy fallbacks from `RefreshCoordinator` helpers until script-order and smoke coverage are stronger.

## 11. Final Recommendation

Yes, this refactor cycle is making real progress. Phase 1 moved the most dangerous data ownership into repos, and Phase 2 made refresh intent clearer in selected visit paths without changing data ownership.

A lot of mess remains. The app is still globally coupled, auth is still too broad, profile/leaderboard are mixed, settings hydration is fragile, and `syncState()` still does too much.

The next highest-ROI engineering move is to stabilize for launch: keep the Email/Password Playwright harness working, keep account-switch isolation and profile/manage rendering covered, verify premium/paywall-adjacent behavior, and run final signed-in smoke on the deploy candidate.

Recommendation: stabilize before more refactoring. If launch is not immediate after that, continue with small Option A authService helper extractions, not profile/leaderboard or settings hydration yet.
