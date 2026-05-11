# Phase 2D Visited Visual Refresh Plan

Date: 2026-05-01

Status: **implemented** on 2026-05-01. Manual smoke is pending.

## Summary

Phase 2D migrated visited visual refresh requests through the Phase 2B `RefreshCoordinator` seam:

```js
window.BARK.refreshCoordinator.refreshVisitedVisuals('static-reason')
```

This is the visual companion to Phase 2C. Phase 2C moved visited cache invalidation through `refreshCoordinator.refreshVisitedCache(reason)`. Phase 2D moved only the visual refresh requests that called `firebaseService.refreshVisitedVisualState()` either directly or through small file-local helpers.

No data ownership, auth/session, Firestore write, `syncState()`, stats/profile, leaderboard, manage portal, or `VaultRepo` ownership behavior should move in Phase 2D.

## Implementation Status

Phase 2D migrated only visited visual refresh calls through:

```js
window.BARK.refreshCoordinator.refreshVisitedVisuals(reason)
```

Runtime files changed:

- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

Docs changed:

- `plans/PHASE_2D_VISITED_VISUAL_REFRESH_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- `plans/PHASE_1_PROGRESS.md`

Call sites migrated:

- `services/authService.js`: `buildVaultRepoSubscriptionOptions()` `refreshVisitedVisualState` callback now delegates to `refreshVisitedVisuals('vault-snapshot-reconcile', firebaseService)`.
- `services/authService.js`: `resetVisitedAndPanelState()` now delegates to `refreshVisitedVisuals('auth-reset-visited-panel', firebaseService)`.
- `services/authService.js`: signed-out/no-session visit clear branch now delegates to `refreshVisitedVisuals('auth-no-session-visit-clear', firebaseService)`.
- `services/checkinService.js`: added file-local `refreshVisitedVisuals(reason, firebaseService)` helper and removed the old local `refreshVisitedVisualState(firebaseService)` helper.
- `services/checkinService.js`: `verifyGpsCheckin()` now delegates to `refreshVisitedVisuals('checkin-verified-add', firebaseService)`.
- `services/checkinService.js`: `markAsVisited()` removal branch now delegates to `refreshVisitedVisuals('checkin-unmark-remove', firebaseService)`.
- `services/checkinService.js`: `markAsVisited()` add branch now delegates to `refreshVisitedVisuals('checkin-mark-add', firebaseService)`.
- `services/firebaseService.js`: added file-local `refreshVisitedVisuals(reason)` helper.
- `services/firebaseService.js`: `reconcileVisitedPlacesSnapshot()` now delegates to `refreshVisitedVisuals('firebase-reconcile-snapshot')`.
- `services/firebaseService.js`: `replaceLocalVisitedPlaces()` now delegates to `refreshVisitedVisuals('firebase-replace-local-visits')`.
- `services/firebaseService.js`: `removeVisitedPlace()` now delegates to `refreshVisitedVisuals('firebase-remove-visit')`.

Manual refresh categories intentionally left alone:

- `window.syncState()`.
- `updateStatsUI()`.
- `evaluateAchievements()`.
- `loadLeaderboard()`.
- `renderManagePortal()`.
- Firestore writes.
- Auth/session ownership.
- `VaultRepo` ownership and subscriptions.
- Rollback logic.
- `firebaseService.refreshVisitedVisualState()` legacy implementation/export.
- `modules/renderEngine.js` trip badge refresh during marker render/filter cadence.

## Inventory Command

Command run:

```sh
rg -n "refreshVisitedVisualState|refreshMarkerStyles|refreshBadgeStyles|refreshVisitedVisuals" services modules renderers repos state -g '*.js'
```

Pre-implementation raw runtime matches:

```text
repos/VaultRepo.js:558:        callOptionalCallback('refreshVisitedVisualState', options.refreshVisitedVisualState);
services/authService.js:330:        refreshVisitedVisualState: firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function'
services/authService.js:331:            ? () => firebaseService.refreshVisitedVisualState()
services/authService.js:515:    if (firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function') {
services/authService.js:516:        firebaseService.refreshVisitedVisualState();
services/authService.js:762:                        if (firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function') {
services/authService.js:763:                            firebaseService.refreshVisitedVisualState();
modules/renderEngine.js:415:    if (window.BARK.tripLayer && typeof window.BARK.tripLayer.refreshBadgeStyles === 'function') {
modules/renderEngine.js:416:        window.BARK.tripLayer.refreshBadgeStyles();
services/checkinService.js:81:function refreshVisitedVisualState(firebaseService) {
services/checkinService.js:82:    if (firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function') {
services/checkinService.js:83:        firebaseService.refreshVisitedVisualState();
services/checkinService.js:225:        refreshVisitedVisualState(firebaseService);
services/checkinService.js:282:            refreshVisitedVisualState(firebaseService);
services/checkinService.js:305:        refreshVisitedVisualState(firebaseService);
modules/MarkerLayerManager.js:135:    refreshMarkerStyles(parkIds = null) {
modules/RefreshCoordinator.js:53:        return firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function'
modules/RefreshCoordinator.js:54:            ? () => firebaseService.refreshVisitedVisualState()
modules/RefreshCoordinator.js:70:    function refreshVisitedVisuals(reason) {
modules/RefreshCoordinator.js:73:        debugLog('refreshVisitedVisuals', { reason: lastReason });
modules/RefreshCoordinator.js:76:        if (callExisting('refreshVisitedVisualState', existingFirebaseRefresh)) return;
modules/RefreshCoordinator.js:78:        callExisting('markerManager.refreshMarkerStyles', () => {
modules/RefreshCoordinator.js:80:            if (markerManager && typeof markerManager.refreshMarkerStyles === 'function') {
modules/RefreshCoordinator.js:81:                markerManager.refreshMarkerStyles();
modules/RefreshCoordinator.js:85:        callExisting('tripLayer.refreshBadgeStyles', () => {
modules/RefreshCoordinator.js:87:            if (tripLayer && typeof tripLayer.refreshBadgeStyles === 'function') {
modules/RefreshCoordinator.js:88:                tripLayer.refreshBadgeStyles();
modules/RefreshCoordinator.js:113:        refreshVisitedVisuals(lastReason);
modules/RefreshCoordinator.js:123:        refreshVisitedVisuals,
services/firebaseService.js:393:        refreshVisitedVisualState();
services/firebaseService.js:399:function refreshVisitedVisualState() {
services/firebaseService.js:401:    if (markerManager && typeof markerManager.refreshMarkerStyles === 'function') {
services/firebaseService.js:402:        markerManager.refreshMarkerStyles();
services/firebaseService.js:405:    if (tripLayer && typeof tripLayer.refreshBadgeStyles === 'function') {
services/firebaseService.js:406:        tripLayer.refreshBadgeStyles();
services/firebaseService.js:419:    refreshVisitedVisualState();
services/firebaseService.js:584:            refreshVisitedVisualState();
services/firebaseService.js:709:    refreshVisitedVisualState,
modules/TripLayerManager.js:564:    function refreshBadgeStyles() {
modules/TripLayerManager.js:574:    window.BARK.tripLayer = { init, sync, clear, getStopParkIds, setDayLinesVisible, refreshBadgeStyles };
```

## Pre-2D Current State

Before Phase 2D, visited visual refresh worked by refreshing cache first, then calling the legacy visual refresh function in the same visit-state paths:

1. Visit state mutates or reconciles through `VaultRepo`.
2. Phase 2C helper code calls `refreshCoordinator.refreshVisitedCache(reason)` with a fallback to the legacy cache invalidator.
3. The same path then calls `firebaseService.refreshVisitedVisualState()` either directly or through a local helper.
4. `firebaseService.refreshVisitedVisualState()` calls:
   - `window.BARK.markerManager.refreshMarkerStyles()` for map marker visited styling.
   - `window.BARK.tripLayer.refreshBadgeStyles()` for trip planner stop badge visited styling.
5. Some paths then continue to `window.syncState()`, `updateStatsUI()`, `renderManagePortal()`, or Firestore write/sync work. Those follow-up calls are out of scope for 2D.

`modules/renderEngine.js` also calls `tripLayer.refreshBadgeStyles()` after marker class updates during marker rendering. That is a map render/filter path, not a visit-state mutation path, so it should be deferred from 2D.

## Target Call Sites

| File/line | Function/context | Visual state refreshed | Category | Trigger/timing | 2D decision |
|---|---|---|---|---|---|
| `repos/VaultRepo.js:558` | `handleVisitedSnapshot()` invokes `options.refreshVisitedVisualState` after snapshot reconcile and cache invalidation | Depends on injected callback; currently both marker styles and trip badge styles | Both by callback | Snapshot reconciliation | Defer `VaultRepo` code changes. Migrate the callback provider in `authService` while keeping this option name for compatibility. |
| `services/authService.js:330` | `buildVaultRepoSubscriptionOptions()` creates the `refreshVisitedVisualState` callback for `VaultRepo.startSubscription()` | Marker visited styling and trip badge visited styling through Firebase service | Both | Snapshot reconciliation after `VaultRepo` handles visitedPlaces snapshot | Migrate in 2D by routing the callback body through `refreshVisitedVisuals('vault-snapshot-reconcile')`. |
| `services/authService.js:515` | `resetVisitedAndPanelState()` after pending mutation clear, `VaultRepo.clear()`, and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Logout/reset | Migrate in 2D in place with reason `auth-reset-visited-panel`. |
| `services/authService.js:762` | Signed-out/no-session branch after `VaultRepo.clear()` and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Logout/reset without the full runtime reset path | Migrate in 2D in place with reason `auth-no-session-visit-clear`. |
| `services/checkinService.js:81` | Local helper `refreshVisitedVisualState(firebaseService)` used by check-in flows | Marker visited styling and trip badge visited styling through Firebase service | Both | Helper only | Migrate the helper implementation in 2D to call `refreshVisitedVisuals(reason, firebaseService)` or equivalent safe helper. |
| `services/checkinService.js:225` | `verifyGpsCheckin()` after optimistic verified visit mutation and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Visit-state mutation, verified add | Migrate in 2D in place with reason `checkin-verified-add`, before the existing `syncState()` call. |
| `services/checkinService.js:282` | `markAsVisited()` removal branch after optimistic remove and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Visit-state mutation, unmark/remove | Migrate in 2D in place with reason `checkin-unmark-remove`, before the existing `syncState()` call. |
| `services/checkinService.js:305` | `markAsVisited()` add branch after optimistic add and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Visit-state mutation, manual mark/add | Migrate in 2D in place with reason `checkin-mark-add`, before the existing `syncState()` call. |
| `services/firebaseService.js:393` | `reconcileVisitedPlacesSnapshot()` after `VaultRepo.reconcileSnapshot()` and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Snapshot reconciliation through Firebase service API | Migrate in 2D in place with reason `firebase-reconcile-snapshot`. |
| `services/firebaseService.js:399` | Legacy `refreshVisitedVisualState()` implementation | Directly calls marker and trip refresh APIs | Both | Legacy implementation/export | Defer body removal or ownership change. Keep as fallback for 2D to avoid behavior changes and recursion risk. |
| `services/firebaseService.js:401` | `markerManager.refreshMarkerStyles()` inside legacy implementation | Marker visited styling | Marker styling | Legacy implementation detail | Defer. Coordinator may still delegate here during 2D. |
| `services/firebaseService.js:405` | `tripLayer.refreshBadgeStyles()` inside legacy implementation | Trip planner stop badge visited styling | Trip badge styling | Legacy implementation detail | Defer. Coordinator may still delegate here during 2D. |
| `services/firebaseService.js:419` | `replaceLocalVisitedPlaces()` after `VaultRepo.replaceAll()` and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Visit-state replacement/canonicalization | Migrate in 2D in place with reason `firebase-replace-local-visits`. |
| `services/firebaseService.js:584` | `removeVisitedPlace()` after `VaultRepo.removeVisits()`, pending delete staging, and visited cache invalidation | Marker visited styling and trip badge visited styling | Both | Visit-state mutation, remove from manage portal/Firebase service path | Migrate in 2D in place with reason `firebase-remove-visit`, before `syncUserProgress()`, `syncState()`, and `renderManagePortal()`. |
| `services/firebaseService.js:709` | Export object includes `refreshVisitedVisualState` | Legacy service API | Both by exported function | Service export | Defer. Keep export for compatibility and fallback. |
| `modules/renderEngine.js:415` | `updateMarkers()` after marker class updates | Trip planner stop badge visited styling | Trip badge styling only | Map render/filter changes and marker update heartbeat | Defer. Replacing this with full `refreshVisitedVisuals()` could add marker refresh work during render and create refresh storms. |
| `modules/MarkerLayerManager.js:135` | `refreshMarkerStyles(parkIds = null)` method definition | Recomputes and reapplies visited marker styling | Marker styling | Method implementation, called by visual refresh paths | Defer. Do not change method implementation in 2D. |
| `modules/TripLayerManager.js:564` | `refreshBadgeStyles()` method definition | Recomputes trip stop badge icons/styles from current visited state | Trip badge styling | Method implementation, called by visual refresh paths | Defer. Do not change method implementation in 2D. |
| `modules/TripLayerManager.js:574` | `window.BARK.tripLayer` export includes `refreshBadgeStyles` | Exposes trip badge refresh method | Trip badge styling | Method export | Defer. Do not change trip layer API in 2D. |
| `modules/RefreshCoordinator.js:53` | `getFirebaseRefresh()` finds the legacy Firebase visual refresh | Marker styling and trip badge styling through legacy service | Both | Coordinator fallback/delegation | Defer unless fallback needs improvement. Do not create recursion by making `firebaseService.refreshVisitedVisualState()` call the coordinator while this fallback still points at it. |
| `modules/RefreshCoordinator.js:70` | `refreshVisitedVisuals(reason)` coordinator API | Named visual refresh request | Both | Replacement target | Keep as the target API. No change needed unless fallback behavior needs improvement. |
| `modules/RefreshCoordinator.js:78` | Fallback `markerManager.refreshMarkerStyles()` call | Marker visited styling | Marker styling | Coordinator fallback if Firebase service refresh is absent or fails | Keep. |
| `modules/RefreshCoordinator.js:85` | Fallback `tripLayer.refreshBadgeStyles()` call | Trip planner stop badge visited styling | Trip badge styling | Coordinator fallback if Firebase service refresh is absent or fails | Keep. |
| `modules/RefreshCoordinator.js:113` | `refreshAllVisitDerived()` calls `refreshVisitedVisuals(lastReason)` | Combined visit-derived refresh | Both | Coordinator aggregate method | Defer. Do not migrate callers to `refreshAllVisitDerived()` in 2D. |
| `modules/RefreshCoordinator.js:123` | Coordinator export includes `refreshVisitedVisuals` | Replacement API | Both | Coordinator API export | Keep. |

## Replacement Pattern

Use a file-local safe helper in each touched service file. Prefer static reason strings that match the existing cache-invalidation reason for the same code path.

For `services/authService.js` and `services/checkinService.js`, the fallback can continue to use the Firebase service:

```js
function refreshVisitedVisuals(reason, firebaseService = null) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedVisuals === 'function') {
        coordinator.refreshVisitedVisuals(reason);
        return true;
    }

    const fallbackFirebaseService = firebaseService || (window.BARK.services && window.BARK.services.firebase);
    if (fallbackFirebaseService && typeof fallbackFirebaseService.refreshVisitedVisualState === 'function') {
        fallbackFirebaseService.refreshVisitedVisualState();
        return true;
    }

    return false;
}
```

For `services/firebaseService.js`, use the coordinator first and the local legacy implementation as fallback:

```js
function refreshVisitedVisuals(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedVisuals === 'function') {
        coordinator.refreshVisitedVisuals(reason);
        return true;
    }

    refreshVisitedVisualState();
    return true;
}
```

Important recursion guard:

- Do not change the exported `firebaseService.refreshVisitedVisualState()` implementation to call `refreshCoordinator.refreshVisitedVisuals()` in Phase 2D.
- `RefreshCoordinator.refreshVisitedVisuals()` currently delegates to `firebaseService.refreshVisitedVisualState()` when it exists.
- Changing both sides at once would risk `coordinator -> firebaseService -> coordinator` recursion.
- Phase 2D should migrate callers, not remove the legacy implementation.

## Scope

2D changed only visited visual refresh calls in these runtime files:

- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

`modules/RefreshCoordinator.js` was not changed. No fallback issue was found.

2D docs:

- `plans/PHASE_2D_VISITED_VISUAL_REFRESH_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- optionally `plans/PHASE_1_PROGRESS.md`

2D must not migrate:

- `window.syncState()`
- `updateStatsUI()`
- `evaluateAchievements()`
- `loadLeaderboard()`
- `renderManagePortal()`
- Firestore writes
- Auth/session ownership
- `VaultRepo` ownership
- `syncState`
- Stats/profile/leaderboard

2D must not edit tests unless a later implementation review finds a focused test is necessary. This planning task does not edit tests.

## Ordering Rules

Replace visual refresh calls in place. Preserve all current ordering relative to the surrounding side effects.

Rules:

- Keep visual refresh after `VaultRepo` mutation/reconcile/clear calls.
- Keep visual refresh after Phase 2C visited cache invalidation for the same code path.
- Keep visual refresh before existing `window.syncState()` calls where that is the current order.
- Keep visual refresh before `syncUserProgress()`, `updateCurrentUserVisitedPlaces()`, `renderManagePortal()`, and stats/profile refresh where that is the current order.
- Do not move Firestore writes earlier or later.
- Do not move rollback-token creation, pending mutation staging, or cache invalidation.
- Keep the `VaultRepo` callback option name `refreshVisitedVisualState` in 2D unless a later focused `VaultRepo` API cleanup is planned.
- Do not replace `modules/renderEngine.js` trip badge refresh with `refreshVisitedVisuals()` in 2D because that path runs during map render/filter changes.

Per-path ordering:

| Path | Required order |
|---|---|
| `buildVaultRepoSubscriptionOptions()` callback | `VaultRepo.reconcileSnapshot()` -> `refreshVisitedCache('vault-snapshot-reconcile')` -> visual callback through coordinator -> canonicalization callback -> `onChange()`/auth snapshot UI. |
| `resetVisitedAndPanelState()` | clear pending mutations -> `VaultRepo.clear()` -> `refreshVisitedCache('auth-reset-visited-panel')` -> visual refresh through coordinator -> clear active pin/panel state. |
| Signed-out/no-session branch | `VaultRepo.clear()` -> `refreshVisitedCache('auth-no-session-visit-clear')` -> visual refresh through coordinator -> clear active pin -> guest zoom/map reset -> `syncState()` -> stats UI. |
| `verifyGpsCheckin()` | optimistic VaultRepo add/stage -> `refreshVisitedCache('checkin-verified-add')` -> visual refresh through coordinator -> `syncState()` -> Firestore visited places update -> daily streak queue. |
| `markAsVisited()` remove branch | optimistic VaultRepo remove/stage -> `refreshVisitedCache('checkin-unmark-remove')` -> visual refresh through coordinator -> `syncState()` -> Firestore visited places update. |
| `markAsVisited()` add branch | optimistic VaultRepo add/stage -> `refreshVisitedCache('checkin-mark-add')` -> visual refresh through coordinator -> `syncState()` -> Firestore sync/update. |
| `reconcileVisitedPlacesSnapshot()` | `VaultRepo.reconcileSnapshot()` -> `refreshVisitedCache('firebase-reconcile-snapshot')` -> visual refresh through coordinator -> return result. |
| `replaceLocalVisitedPlaces()` | `VaultRepo.replaceAll()` -> `refreshVisitedCache('firebase-replace-local-visits')` -> visual refresh through coordinator. |
| `removeVisitedPlace()` | `VaultRepo.removeVisits()` -> rollback token/stage delete -> `refreshVisitedCache('firebase-remove-visit')` -> visual refresh through coordinator -> `syncUserProgress()` -> `syncState()` -> `renderManagePortal()`. |

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Marker visited styling does not update after mark/unmark. | Migrate every visit mutation/reconcile/logout visual call site listed above, preserve exact call location, and smoke mark/unmark/reload. |
| Trip badge styling does not update after mark/unmark. | Keep coordinator fallback to `tripLayer.refreshBadgeStyles()` and include trip planner visited stop styling in manual smoke. |
| Duplicate visual refreshes. | Replace the legacy visual call in place rather than adding coordinator calls beside it. Do not call both helper and `firebaseService.refreshVisitedVisualState()` from the same path. |
| Refresh storms during map pan/zoom. | Defer `modules/renderEngine.js` map-render trip badge refresh. Do not replace it with full `refreshVisitedVisuals()` in 2D. |
| Missing `tripLayer.refreshBadgeStyles` method. | Keep existing optional method checks through the legacy service and coordinator fallback. Missing trip layer should no-op, not throw. |
| `RefreshCoordinator` fallback behavior creates recursion. | Do not change exported `firebaseService.refreshVisitedVisualState()` to call coordinator in 2D. Migrate callers through file-local helpers only. |
| `RefreshCoordinator` fallback behavior skips direct marker/trip fallback because Firebase service exists. | This preserves current behavior. If the Firebase service refresh throws, `callExisting()` returns false and coordinator direct marker/trip fallback runs. |
| Performance regression from refreshing all marker styles too often. | Limit 2D to visit mutation/reconcile/logout paths. Defer render/filter/map movement paths. |
| Static reason strings become noisy or leak data. | Use static strings only. Reuse Phase 2C path reason names where possible. |
| Visual refresh ordering changes relative to cache invalidation or `syncState()`. | Replace calls at the exact existing locations and use the ordering table above during implementation review. |

## Expected Implementation Files

Likely runtime files for the future Phase 2D implementation:

- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

Potential runtime file only if fallback needs improvement:

- `modules/RefreshCoordinator.js`

Docs:

- `plans/PHASE_2D_VISITED_VISUAL_REFRESH_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- optionally `plans/PHASE_1_PROGRESS.md`

No expected changes:

- `repos/VaultRepo.js`
- `modules/renderEngine.js`
- `modules/MarkerLayerManager.js`
- `modules/TripLayerManager.js`
- tests

## Verification Plan

Static verification after implementation:

```sh
node --check services/authService.js services/firebaseService.js services/checkinService.js modules/RefreshCoordinator.js
rg "refreshVisitedVisualState|refreshMarkerStyles|refreshBadgeStyles|refreshVisitedVisuals" services modules renderers repos state -g '*.js'
git diff --check
```

Actual static search residuals after implementation:

| Match | Classification |
|---|---|
| `services/authService.js:42-51` | File-local visual helper and legacy Firebase-service fallback. |
| `services/authService.js:346` | `VaultRepo` callback option name retained; callback delegates to coordinator helper. |
| `services/authService.js:529` | Migrated logout/reset visual refresh request through coordinator helper. |
| `services/authService.js:774` | Migrated signed-out/no-session visual refresh request through coordinator helper. |
| `services/checkinService.js:41-50` | File-local visual helper and legacy Firebase-service fallback. |
| `services/checkinService.js:235` | Migrated verified-check-in visual refresh request through coordinator helper. |
| `services/checkinService.js:292` | Migrated unmark/remove visual refresh request through coordinator helper. |
| `services/checkinService.js:315` | Migrated manual mark/add visual refresh request through coordinator helper. |
| `services/firebaseService.js:85-92` | File-local visual helper and local legacy fallback. |
| `services/firebaseService.js:404` | Migrated snapshot reconcile visual refresh request through coordinator helper. |
| `services/firebaseService.js:410-417` | Legacy `refreshVisitedVisualState()` implementation kept for compatibility/fallback. |
| `services/firebaseService.js:430` | Migrated local visit replacement visual refresh request through coordinator helper. |
| `services/firebaseService.js:595` | Migrated remove-visit visual refresh request through coordinator helper. |
| `services/firebaseService.js:720` | Legacy `refreshVisitedVisualState` service export kept. |
| `repos/VaultRepo.js:558` | Existing callback invocation; `VaultRepo` code was not changed. |
| `modules/RefreshCoordinator.js:53-123` | Coordinator implementation/export and legacy/direct fallbacks. |
| `modules/renderEngine.js:415-416` | Deferred trip badge refresh during marker render/filter cadence. |
| `modules/MarkerLayerManager.js:135` | Marker style refresh method definition. |
| `modules/TripLayerManager.js:564,574` | Trip badge refresh method definition/export. |

No direct inline visit-mutation/logout/reconcile call sites still call `firebaseService.refreshVisitedVisualState()` outside helper fallback paths.

Static verification status:

- `node --check services/authService.js services/firebaseService.js services/checkinService.js modules/RefreshCoordinator.js`: PASS
- `rg "refreshVisitedVisualState|refreshMarkerStyles|refreshBadgeStyles|refreshVisitedVisuals" services modules renderers repos state -g '*.js'`: PASS, residual matches classified above
- `git diff --check`: PASS

Manual verification after implementation:

- Sign in.
- Mark visited.
- Confirm marker changes to visited styling.
- Reload; confirm marker is still visited.
- Remove/unmark.
- Confirm marker changes back.
- Confirm trip planner visited stop styling still works.
- Pan/zoom the map and confirm no console errors.
- Confirm visited/unvisited filters still work.
- Confirm no console errors.

Manual smoke status: **PENDING**. Manual signed-in browser validation is still required before deployment.

## Stop Lines

- Do not migrate `syncState`.
- Do not migrate stats/profile/leaderboard.
- Do not change data ownership.
- Do not change auth/session.
- Do not change Firestore writes.
- Do not change `VaultRepo` ownership.
- Do not deploy.
- Do not start Phase 2E.

## Final Readiness

Phase 2D implementation status: **complete for code/static verification; manual smoke pending**.

Ready to start Phase 2E: **NO**.
