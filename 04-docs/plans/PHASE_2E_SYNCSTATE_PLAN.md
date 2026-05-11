# Phase 2E SyncState Coordination Plan

Date: 2026-05-01

Status: **implemented** on 2026-05-01. Manual smoke is pending.

## Summary

Phase 2E reduces selected direct `window.syncState()` calls by routing them through named `RefreshCoordinator` request methods. This is not a rewrite of `syncState()` and not a migration of marker rendering, stats/profile, achievements, leaderboard, Firestore writes, auth/session, or data ownership.

Implemented 2E scope: added coordinator methods that delegate to the existing `window.syncState()` and migrated only the lowest-risk visit-state mutation callers in `services/checkinService.js`. Broad render cadence, search/filter, settings, auth hydration/logout, data load, panel DOM action, and Firebase write helper paths remain deferred.

## Implementation Status

Runtime files changed:

- `modules/RefreshCoordinator.js`
- `services/checkinService.js`

Docs changed:

- `plans/PHASE_2E_SYNCSTATE_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- `plans/PHASE_1_PROGRESS.md`

Coordinator methods added:

- `requestStateSync(reason)`
- `requestVisitStateSync(reason)`

Counters added to `RefreshCoordinator.getStats()`:

- `stateSyncRequestCount`
- `visitStateSyncRequestCount`

Call sites migrated:

- `services/checkinService.js`: `verifyGpsCheckin()` direct `window.syncState()` now calls `requestVisitStateSync('checkin-verified-add')`.
- `services/checkinService.js`: `markAsVisited()` removal branch direct `window.syncState()` now calls `requestVisitStateSync('checkin-unmark-remove')`.
- `services/checkinService.js`: `markAsVisited()` add branch direct `window.syncState()` now calls `requestVisitStateSync('checkin-mark-add')`.

Runtime categories intentionally left alone:

- `window.syncState()` definition and behavior in `modules/renderEngine.js`.
- Auth/login/logout sync calls.
- Firebase service sync calls.
- Panel renderer sync calls.
- Search/filter sync calls.
- Map movement/culling sync calls.
- Settings/data-load sync calls.
- Stats/profile/leaderboard behavior.
- Firestore writes.
- Auth/session logic.
- `VaultRepo` ownership.
- Rollback logic.

## Inventory Command

Command run:

```sh
rg -n "syncState\\(" services modules renderers repos state engines core -g '*.js'
```

Pre-implementation raw matches:

```text
services/authService.js:209:            window.syncState();
services/authService.js:319:    if (typeof window.syncState === 'function') window.syncState();
services/authService.js:601:        window.syncState();
services/authService.js:778:                        window.syncState();
modules/uiController.js:262:                    window.syncState();
modules/uiController.js:309:        window.syncState();
modules/searchEngine.js:514:                    window.syncState();
modules/searchEngine.js:563:        window.syncState();
modules/searchEngine.js:610:            window.syncState();
modules/searchEngine.js:631:            window.syncState();
modules/searchEngine.js:675:            window.syncState();
modules/searchEngine.js:683:            window.syncState();
modules/searchEngine.js:713:            window.syncState();
modules/searchEngine.js:802:                        window.syncState();
renderers/panelRenderer.js:301:                        window.syncState();
renderers/panelRenderer.js:348:                        window.syncState();
renderers/panelRenderer.js:358:                    window.syncState();
modules/mapEngine.js:196:                window.syncState();
modules/mapEngine.js:263:            window.syncState();
modules/mapEngine.js:356:    window.syncState();
services/firebaseService.js:492:        window.syncState();
services/firebaseService.js:597:            window.syncState();
modules/RefreshCoordinator.js:99:            if (typeof window.syncState === 'function') window.syncState();
services/checkinService.js:237:            window.syncState();
services/checkinService.js:294:                window.syncState();
services/checkinService.js:317:            window.syncState();
modules/settingsController.js:316:            if (typeof window.syncState === 'function') window.syncState();
modules/renderEngine.js:3: * Owns updateMarkers(), syncState(), safeUpdateHTML(), and marker helper functions.
modules/dataService.js:188:    window.syncState();
```

`modules/renderEngine.js` owns the `window.syncState` definition. That definition is not a migration target for 2E.

## Current State

`window.syncState()` is defined in `modules/renderEngine.js`. It is RAF-batched through an internal `syncScheduled` guard. On each scheduled frame, it:

1. Updates map markers if marker visibility state changed and the map is currently usable.
2. Defers marker sync by setting `_pendingMarkerSync` when the map is hidden, unavailable, or zooming.
3. Calls `window.BARK.updateStatsUI()` if present.
4. Schedules debounced achievement evaluation through `window.BARK.evaluateAchievements()`.

Direct calls are risky because the name does not reveal intent. The same heartbeat is used for visit changes, search/filter changes, settings effects, map movement/culling, data load, auth hydration/logout, panel actions, and user location. A mechanical migration that treats all calls the same could accidentally change marker timing, stats freshness, achievement evaluation cadence, or render performance.

Phase 2E should preserve `window.syncState()` as the implementation detail and move only a small group of low-risk call sites behind intent-named coordinator methods.

## Proposed Replacement Model

Do not remove `window.syncState()`.

Add named coordinator methods later in `modules/RefreshCoordinator.js`:

```js
requestStateSync(reason)
requestVisitStateSync(reason)
requestFilterStateSync(reason)
requestSettingsStateSync(reason)
```

The 2E implementation added only the methods needed by the selected target subset:

```js
requestStateSync(reason)
requestVisitStateSync(reason)
```

Both should be thin wrappers around the existing heartbeat:

```js
function requestStateSync(reason) {
    const lastReason = remember(reason);
    stats.stateSyncRequestCount++;
    debugLog('requestStateSync', { reason: lastReason });

    callExisting('syncState', () => {
        if (typeof window.syncState === 'function') window.syncState();
    });
}

function requestVisitStateSync(reason) {
    const lastReason = remember(reason);
    stats.visitStateSyncRequestCount++;
    debugLog('requestVisitStateSync', { reason: lastReason });
    requestStateSync(lastReason);
}
```

Important model constraints:

- Do not use existing `refreshVisitDerivedUi()` as the 2E replacement for direct `syncState()` calls, because it also calls `updateStatsUI()` explicitly.
- Do not make the coordinator own marker rendering, stats/profile, or achievement timing in 2E.
- Do not change `window.syncState()` behavior.
- Use static reason strings only.
- Keep fallback helpers local to touched service files so the app still works if `RefreshCoordinator` is unavailable.

Suggested helper for service files:

```js
function requestVisitStateSync(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.requestVisitStateSync === 'function') {
        coordinator.requestVisitStateSync(reason);
        return true;
    }

    if (typeof window.syncState === 'function') {
        window.syncState();
        return true;
    }

    return false;
}
```

## Direct SyncState Call Inventory

| File/line | Function/context | Why `syncState()` is called | Category | Risk | 2E decision |
|---|---|---|---|---|---|
| `services/authService.js:209` | Cloud settings hydration after applying map style, visited filter, global styles, and map performance policy | Re-sync markers/stats after hydrated settings alter filters/style/performance policy | settings change / auth login | MEDIUM-HIGH | Defer. Crosses auth hydration, cloud settings, map layer, and filter state. |
| `services/authService.js:319` | `refreshAuthSnapshotUi()` | Broad auth snapshot UI refresh; sync markers/stats/achievements then refresh active pin button | auth/login snapshot | HIGH | Defer. Broad auth snapshot timing and stats/profile coupling. |
| `services/authService.js:601` | `restoreGuestMarkerLayer()` fallback path | Schedule marker update when guest marker layer cannot update immediately | auth/logout reset / map render | MEDIUM-HIGH | Defer. It is map visibility/zoom sensitive. |
| `services/authService.js:778` | Signed-out/no-session branch after visit clear, active pin clear, guest zoom/map reset | Re-sync marker visibility and stats after logout/no-session reset | auth/logout | HIGH | Defer. Auth/session and stats timing. |
| `modules/uiController.js:262` | App tab/view switch back to map after map resize/invalidate marker visibility | Re-sync visible markers after UI view changes and Leaflet size invalidation | map render / UI view | MEDIUM-HIGH | Defer. View state and map sizing cadence. |
| `modules/uiController.js:309` | Visited filter dropdown change | Re-filter markers after persisted visited filter changes | search/filter change | MEDIUM | Defer from 2E. Good later `requestFilterStateSync` candidate. |
| `modules/searchEngine.js:514` | Search suggestion click | Re-filter markers for selected suggestion before moving map | search/filter change | MEDIUM | Defer. Search cache and map movement are coupled. |
| `modules/searchEngine.js:563` | `publishSearchProgress()` during chunked search | Re-filter markers as async search result cache progresses | search/filter change | MEDIUM-HIGH | Defer. Chunked search cadence can create render storms if mishandled. |
| `modules/searchEngine.js:610` | Debounced search run with empty query | Clear search filter and update markers | search/filter change | MEDIUM | Defer. Later filter sync batch. |
| `modules/searchEngine.js:631` | Search input cleared | Clear search cache and update markers immediately | search/filter change | MEDIUM | Defer. Later filter sync batch. |
| `modules/searchEngine.js:675` | Clear search button | Clear search cache and update markers | search/filter change | MEDIUM | Defer. Later filter sync batch. |
| `modules/searchEngine.js:683` | Type filter select change | Re-filter markers after type filter changes | search/filter change | MEDIUM | Defer. Later `requestFilterStateSync` candidate. |
| `modules/searchEngine.js:713` | Swag filter button toggle | Re-filter markers after swag filter set changes | search/filter change | MEDIUM | Defer. Later `requestFilterStateSync` candidate. |
| `modules/searchEngine.js:802` | Trip planner start/end search result click | Update markers/search state before moving map to selected node | trip planner action / search filter | MEDIUM-HIGH | Defer. Trip planner and map movement coupling. |
| `renderers/panelRenderer.js:301` | Verified GPS check-in success UI | Refresh markers/stats after check-in service already mutated visit state, then explicitly updates stats UI | panel action / visit-state mutation | MEDIUM | Defer from first 2E slice. Duplicates service-level sync and directly calls `updateStatsUI()`. |
| `renderers/panelRenderer.js:348` | Panel mark/unmark removed action | Refresh after check-in service removal result and DOM button update | panel action / visit-state mutation | MEDIUM | Defer. Panel DOM state and service-level sync overlap. |
| `renderers/panelRenderer.js:358` | Panel mark visited action | Refresh after check-in service add result and DOM button update | panel action / visit-state mutation | MEDIUM | Defer. Panel DOM state and service-level sync overlap. |
| `modules/mapEngine.js:196` | Move-end viewport culling timeout | Re-render/cull plain markers after map movement | map movement/render heartbeat | HIGH | Defer. Performance-sensitive render cadence. |
| `modules/mapEngine.js:263` | Zoom-end delayed sync after cluster refresh/pending marker sync | Re-render markers after zoom/layer changes settle | map movement/render heartbeat | HIGH | Defer. Performance-sensitive render cadence. |
| `modules/mapEngine.js:356` | Location found handler | Re-sort/update achievements and stats after user location appears | map movement/location | MEDIUM-HIGH | Defer. Achievement/stat timing named in comment. |
| `services/firebaseService.js:492` | `syncUserProgress()` after writing visited places | Refresh local marker/stats/achievement UI after persisted visit progress write | visit-state mutation / Firestore write helper | MEDIUM-HIGH | Defer. This helper is used by check-in, manage-portal remove, and settings terminate/reset flows; avoid touching Firestore-adjacent timing in first 2E slice. |
| `services/firebaseService.js:597` | `removeVisitedPlace()` after `syncUserProgress()` and before `renderManagePortal()` | Refresh marker/stats/achievements after manage portal remove | visit-state mutation | MEDIUM | Defer or optional later 2E. It is visit-related, but tied to manage portal and already follows `syncUserProgress()`. |
| `modules/RefreshCoordinator.js:99` | `refreshVisitDerivedUi()` | Existing coordinator method calls `syncState()` and `updateStatsUI()` | coordinator internals | LOW | Do not migrate. May remain; avoid using this as direct-sync replacement in 2E. |
| `services/checkinService.js:237` | `verifyGpsCheckin()` after optimistic verified add, cache refresh, visual refresh | Refresh markers/stats/achievements after local visit mutation before Firestore write | visit-state mutation | LOW | Recommended 2E target. Replace with `requestVisitStateSync('checkin-verified-add')` helper. |
| `services/checkinService.js:294` | `markAsVisited()` removal branch after optimistic remove, cache refresh, visual refresh | Refresh markers/stats/achievements after local visit removal before Firestore write | visit-state mutation | LOW | Recommended 2E target. Replace with `requestVisitStateSync('checkin-unmark-remove')` helper. |
| `services/checkinService.js:317` | `markAsVisited()` add branch after optimistic add, cache refresh, visual refresh | Refresh markers/stats/achievements after local visit add before Firestore sync/write | visit-state mutation | LOW | Recommended 2E target. Replace with `requestVisitStateSync('checkin-mark-add')` helper. |
| `modules/settingsController.js:316` | Settings change effect scheduler | Refresh markers/stats after settings impacts are applied | settings change | MEDIUM-HIGH | Defer. Settings effects touch marker layer, trails, map policy, and cloud autosave. |
| `modules/renderEngine.js:3` | File header mentions `syncState()` ownership | Documentation/comment only | renderEngine owner | LOW | Not a call site. Do not change renderEngine. |
| `modules/dataService.js:188` | `setParkData()` after ParkRepo data load and canonicalization attempt | Initial marker/stats sync after park data load | data load | HIGH | Defer. Boot/data-load heartbeat. |

## Implemented 2E Target Subset

Implemented initial 2E migration:

- `services/checkinService.js:237` with reason `checkin-verified-add`.
- `services/checkinService.js:294` with reason `checkin-unmark-remove`.
- `services/checkinService.js:317` with reason `checkin-mark-add`.

Why this subset is safest:

- These are already visit-state mutation paths.
- Phase 2C and 2D already added adjacent file-local helpers in the same file.
- Ordering is simple and already local:
  - `VaultRepo` optimistic mutation/staging.
  - `refreshVisitedCache(reason)`.
  - `refreshVisitedVisuals(reason)`.
  - `window.syncState()`.
  - Firestore write/sync follow-up.
- Replacing the direct call in place with a helper that delegates to `window.syncState()` preserves behavior while naming the intent.

Possible later 2E follow-up after manual smoke:

- `services/firebaseService.js:597` in `removeVisitedPlace()` could migrate to `requestVisitStateSync('firebase-remove-visit')`, but it should be considered a second small slice because it is near `syncUserProgress()` and `renderManagePortal()`.

Do not migrate `services/firebaseService.js:492` in `syncUserProgress()` in the first 2E slice. Although it is visit-related, it is a shared Firestore write helper and is called by settings terminate/reset behavior as well as visit flows.

## Deferred Call Sites

Defer these categories from 2E implementation:

- Map movement/culling: `modules/mapEngine.js`.
- Data load heartbeat: `modules/dataService.js`.
- Search/filter changes: `modules/searchEngine.js`, `modules/uiController.js:309`.
- Settings effects: `modules/settingsController.js`, cloud settings hydration in `authService.js:209`.
- Auth broad snapshot and logout/no-session reset: `services/authService.js:319`, `services/authService.js:601`, `services/authService.js:778`.
- Panel action DOM refreshes: `renderers/panelRenderer.js`.
- Trip planner search result sync: `modules/searchEngine.js:802`.
- Achievement/stat timing paths: `modules/mapEngine.js:356` and any path where the surrounding code explicitly depends on stats/profile timing.
- `modules/renderEngine.js`: do not edit or rewrite `window.syncState()`.
- `modules/RefreshCoordinator.js:99`: keep existing `refreshVisitDerivedUi()` behavior; do not use it as the 2E replacement for direct sync calls.

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Marker updates do not run after visit mutations. | `requestVisitStateSync()` must delegate to existing `window.syncState()` with fallback. Replace calls in place after cache/visual refresh. |
| Stats do not update. | Do not change `window.syncState()`; it already calls `updateStatsUI()`. Avoid using a wrapper that bypasses it. |
| Achievements do not evaluate. | Do not change `window.syncState()`; it already schedules debounced achievement evaluation. Smoke achievement timing after implementation. |
| Render storms or duplicate RAF scheduling. | Keep `window.syncState()` RAF guard intact. Do not migrate search chunking, map pan/zoom, or culling in 2E. |
| Duplicate stats refresh from coordinator wrapper. | Do not use `refreshVisitDerivedUi()` as the replacement because it explicitly calls `updateStatsUI()` in addition to `syncState()`. |
| Ordering changes relative to visited cache/visual refresh. | Replace direct calls in place only. Preserve `refreshVisitedCache()` -> `refreshVisitedVisuals()` -> state sync order. |
| Firestore write timing changes. | Do not move writes. For check-in paths, keep the state-sync request before the existing Firestore follow-up exactly where the direct call is today. |
| Coordinator becomes another global dumping ground. | Add narrow request methods with explicit names and counters. Defer broad categories until each has its own reasoned migration plan. |
| Auth/session behavior changes. | Do not touch auth call sites in 2E. |
| Search/filter UX regresses. | Defer all search/filter callers until a later filter-specific slice. |

## Expected Implementation Files

Likely runtime files for future 2E implementation:

- `modules/RefreshCoordinator.js`
- `services/checkinService.js`

Potential later or second-slice files, not recommended for the initial 2E implementation:

- `services/firebaseService.js`
- `services/authService.js`

Docs:

- `plans/PHASE_2E_SYNCSTATE_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- optionally `plans/PHASE_1_PROGRESS.md`

No expected changes in initial 2E:

- `modules/renderEngine.js`
- `modules/mapEngine.js`
- `modules/searchEngine.js`
- `modules/settingsController.js`
- `modules/uiController.js`
- `renderers/panelRenderer.js`
- `modules/profileEngine.js`
- `repos/VaultRepo.js`
- tests

## Verification Plan And Results

Static verification after implementation:

```sh
node --check modules/RefreshCoordinator.js services/checkinService.js
rg "syncState\\(" services modules renderers repos state engines core -g '*.js'
git diff --check
```

If a later 2E slice touches `services/firebaseService.js` or `services/authService.js`, include those files in `node --check`.

Expected static outcome for initial 2E:

- The three check-in direct `window.syncState()` call sites should be replaced by a file-local `requestVisitStateSync(reason)` helper.
- Residual direct `syncState()` calls should remain in deferred categories.
- `window.syncState` definition in `modules/renderEngine.js` should remain unchanged.
- `modules/RefreshCoordinator.js` should include new request method exports and may still include the existing `refreshVisitDerivedUi()` direct sync call.

Actual residual `syncState()` matches after implementation:

| Match | Classification |
|---|---|
| `services/checkinService.js:65` | File-local fallback inside `requestVisitStateSync(reason)` if `RefreshCoordinator` is unavailable. |
| `modules/RefreshCoordinator.js:101` | Existing `refreshVisitDerivedUi()` implementation, intentionally retained and not used for this 2E migration. |
| `modules/RefreshCoordinator.js:115` | New `requestStateSync(reason)` implementation delegates to existing `window.syncState()`. |
| `services/authService.js:209` | Deferred cloud settings/auth hydration sync. |
| `services/authService.js:319` | Deferred broad auth snapshot UI sync. |
| `services/authService.js:601` | Deferred guest marker restore/logout map sync. |
| `services/authService.js:778` | Deferred signed-out/no-session reset sync. |
| `services/firebaseService.js:492` | Deferred shared Firestore write helper sync. |
| `services/firebaseService.js:597` | Deferred manage-portal remove flow sync. |
| `renderers/panelRenderer.js:301,348,358` | Deferred panel DOM action sync calls. |
| `modules/searchEngine.js:514,563,610,631,675,683,713,802` | Deferred search/filter/trip search sync calls. |
| `modules/uiController.js:262,309` | Deferred map tab/view and visited filter sync calls. |
| `modules/mapEngine.js:196,263,356` | Deferred map movement/culling/location sync calls. |
| `modules/settingsController.js:316` | Deferred settings effect sync. |
| `modules/dataService.js:188` | Deferred data load heartbeat sync. |
| `modules/renderEngine.js:3` | Comment documenting renderEngine ownership of `syncState()`. |

Static verification status:

- `node --check modules/RefreshCoordinator.js services/checkinService.js`: PASS
- `rg "syncState\\(" services modules renderers repos state engines core -g '*.js'`: PASS, residual matches classified above
- `git diff --check`: PASS

Manual verification after implementation:

- Sign in.
- Confirm visit count loads.
- Mark visited.
- Reload; confirm visit persists.
- Remove/unmark.
- Reload; confirm removal persists.
- Confirm search/filter still updates markers.
- Confirm visited/unvisited filter works.
- Pan/zoom map; confirm markers still update and no render storm occurs.
- Confirm stats/profile update.
- Confirm achievement evaluation still triggers.
- Confirm console has no red errors.

Manual smoke status: **PENDING**. Manual signed-in browser validation is required before deployment.

## Stop Lines

- Do not remove `window.syncState()`.
- Do not rewrite `renderEngine`.
- Do not move stats/profile/leaderboard.
- Do not touch Firestore writes.
- Do not change auth/session.
- Do not change `VaultRepo` ownership.
- Do not migrate map movement/culling in 2E.
- Do not migrate search/filter in 2E.
- Do not deploy.
- Do not start Phase 2F.

## Final Readiness

Phase 2E implementation status: **complete for code/static verification; manual smoke pending**.

Ready to migrate broader `syncState()` categories: **NO**.

Ready to start Phase 2F: **NO**.
