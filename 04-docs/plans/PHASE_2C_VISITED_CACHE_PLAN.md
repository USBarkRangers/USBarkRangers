# Phase 2C Visited Cache Invalidation Plan And Implementation Record

Date: 2026-05-01

## Summary

Phase 2C migrated only visited cache invalidation calls to the Phase 2B refresh seam:

```js
window.BARK.refreshCoordinator.refreshVisitedCache(reason)
```

The implementation replaced direct inline calls to `window.BARK.invalidateVisitedIdsCache()` in visit-state mutation/reconcile/logout paths with a file-local safe helper that delegates to `window.BARK.refreshCoordinator.refreshVisitedCache(reason)` and falls back to the legacy invalidator if the coordinator is absent.

No visual refresh, `syncState()`, stats/profile, leaderboard, Firestore write, auth/session, or ownership behavior should move in 2C.

## Implementation Status

Status: **implemented** on 2026-05-01.

Runtime files changed:

- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

Docs changed:

- `plans/PHASE_2C_VISITED_CACHE_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- `plans/PHASE_1_PROGRESS.md`

Call sites migrated:

- `services/authService.js`: `buildVaultRepoSubscriptionOptions()` callback body, reason `vault-snapshot-reconcile`.
- `services/authService.js`: `resetVisitedAndPanelState()`, reason `auth-reset-visited-panel`.
- `services/authService.js`: signed-out/no-session visit clear branch, reason `auth-no-session-visit-clear`.
- `services/firebaseService.js`: `reconcileVisitedPlacesSnapshot()`, reason `firebase-reconcile-snapshot`.
- `services/firebaseService.js`: `replaceLocalVisitedPlaces()`, reason `firebase-replace-local-visits`.
- `services/firebaseService.js`: `removeVisitedPlace()`, reason `firebase-remove-visit`.
- `services/checkinService.js`: `verifyGpsCheckin()`, reason `checkin-verified-add`.
- `services/checkinService.js`: `markAsVisited()` removal branch, reason `checkin-unmark-remove`.
- `services/checkinService.js`: `markAsVisited()` add branch, reason `checkin-mark-add`.

Manual refresh categories intentionally left alone:

- Visual refresh.
- `syncState()`.
- Stats/profile/leaderboard refresh.
- Firestore writes.
- Auth/session ownership.
- VaultRepo ownership and subscription behavior.
- Rollback and pending mutation semantics.

Phase 2D has not started.

## Inventory Command

Command run:

```sh
rg -n "invalidateVisitedIdsCache\\(" services modules renderers repos state -g '*.js'
```

Pre-implementation runtime matches:

| File/line | Function/context | Why invalidation is needed | Trigger type | 2C decision |
|---|---|---|---|---|
| `services/authService.js:312` | `buildVaultRepoSubscriptionOptions()` option method `invalidateVisitedIdsCache()` | VaultRepo calls this callback after a visitedPlaces snapshot reconciliation so marker/filter cache sees new visit IDs. | Visit snapshot reconcile | Migrate body only; keep option method name for VaultRepo compatibility. |
| `services/authService.js:314` | Body of the above option callback | Direct global cache invalidation. | Visit snapshot reconcile | Replace with safe helper call, reason `vault-snapshot-reconcile`. |
| `services/authService.js:500` | `resetVisitedAndPanelState()` | Logout/runtime reset clears VaultRepo visit state, so visited filters and marker visibility need stale IDs cleared. | Logout/reset after visit-state clear | Replace with helper while preserving existing fallback to `invalidateMarkerVisibility()` if cache invalidation is unavailable. Reason `auth-reset-visited-panel`. |
| `services/authService.js:750` | Signed-out branch when no prior authenticated runtime reset is required | Initial/no-session path clears VaultRepo and invalidates visit-derived cache. | Sign-out/no-session visit clear | Replace with helper. Reason `auth-no-session-visit-clear`. |
| `services/firebaseService.js:378` | `reconcileVisitedPlacesSnapshot()` | Legacy/public Firebase service reconcile path updates VaultRepo from a snapshot and invalidates visit ID cache. | Visit snapshot reconcile | Replace with helper. Reason `firebase-reconcile-snapshot`. |
| `services/firebaseService.js:406` | `replaceLocalVisitedPlaces()` | Local visit map replacement/canonicalization changes visit IDs. | Visit-state replacement/canonicalization | Replace with helper. Reason `firebase-replace-local-visits`. |
| `services/firebaseService.js:573` | `removeVisitedPlace()` | VaultRepo removes one or more visit entries, so visited filter cache must update before visual/UI refresh. | Visit-state delete | Replace with helper. Reason `firebase-remove-visit`. |
| `services/checkinService.js:210` | `verifyGpsCheckin()` | Verified GPS check-in adds a visit optimistically before persistence. | Visit-state upsert | Replace with helper. Reason `checkin-verified-add`. |
| `services/checkinService.js:269` | `markAsVisited()` removal branch | Manual unmark removes visit entries optimistically before persistence. | Visit-state delete | Replace with helper. Reason `checkin-unmark-remove`. |
| `services/checkinService.js:294` | `markAsVisited()` add branch | Manual mark adds a visit optimistically before persistence. | Visit-state upsert | Replace with helper. Reason `checkin-mark-add`. |
| `modules/RefreshCoordinator.js:65` | `refreshVisitedCache()` | Coordinator delegates to the existing renderEngine invalidator. | Coordinator internals | Do not migrate; this is the seam. |

No direct matches were found in `renderers`, `repos` except the callback invocation plumbing in `VaultRepo`, or `state` files.

## Replacement Pattern

Preferred file-local helper for touched runtime files:

```js
function refreshVisitedCache(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedCache === 'function') {
        coordinator.refreshVisitedCache(reason);
        return true;
    }

    if (window.BARK && typeof window.BARK.invalidateVisitedIdsCache === 'function') {
        window.BARK.invalidateVisitedIdsCache();
        return true;
    }

    return false;
}
```

Use this helper in each touched file rather than calling the coordinator directly everywhere. This preserves the old no-throw/no-op behavior and keeps the app functional if `RefreshCoordinator` is absent but `renderEngine` still loaded the legacy invalidator.

For `authService.resetVisitedAndPanelState()`, preserve the current marker fallback:

```js
if (!refreshVisitedCache('auth-reset-visited-panel') && typeof window.BARK.invalidateMarkerVisibility === 'function') {
    window.BARK.invalidateMarkerVisibility();
}
```

For other call sites:

```js
refreshVisitedCache('stable-static-reason');
```

Reason string rules:

- Use static strings only.
- Do not include park IDs, user IDs, counts, timestamps, or other noisy values.
- Keep strings tied to code path intent, not data contents.

## Scope

2C may change only:

- Direct `window.BARK.invalidateVisitedIdsCache()` calls in:
  - `services/authService.js`
  - `services/firebaseService.js`
  - `services/checkinService.js`
- Documentation in Phase 2 plan files.

2C must not migrate or remove:

- `refreshVisitedVisualState()`
- `markerManager.refreshMarkerStyles()`
- `tripLayer.refreshBadgeStyles()`
- `window.syncState()`
- `window.BARK.updateStatsUI()`
- `window.BARK.loadLeaderboard()`
- `window.BARK.renderManagePortal()`

2C must not touch:

- Firestore write payloads.
- Rollback logic.
- Pending mutation semantics.
- Auth/session ownership.
- VaultRepo ownership or subscription behavior.
- UI rendering behavior.

## Implementation Files

Runtime files:

- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

Docs:

- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- `plans/PHASE_2C_VISITED_CACHE_PLAN.md`
- `plans/PHASE_1_PROGRESS.md`

No test files changed for 2C.

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Missing `RefreshCoordinator` means cache invalidation silently stops. | Use helper fallback to `window.BARK.invalidateVisitedIdsCache()` if coordinator is unavailable. |
| Duplicate invalidation due to adding coordinator calls without removing direct calls. | Replace each direct call in place; do not add a second call. |
| Cache not invalidated after a visit mutation. | Migrate all listed call sites in one focused PR; verify with static search and visited/unvisited filter smoke. |
| Reason strings become noisy or leak data. | Use static reason strings only. |
| Call ordering changes relative to repo mutations. | Replace in place at the exact existing call location, after VaultRepo mutation/reconcile/clear and before visual refresh or `syncState()` where currently ordered that way. |
| `rg "invalidateVisitedIdsCache\\("` still reports matches after 2C. | Expected residual matches: `modules/RefreshCoordinator.js` internals, safe helper fallback(s), and the auth option method name required by VaultRepo. Review output for inline global call sites. |

## Verification Plan

Static verification after implementation:

```sh
node --check services/authService.js services/firebaseService.js services/checkinService.js modules/RefreshCoordinator.js
rg "invalidateVisitedIdsCache\\(" services modules renderers repos state -g '*.js'
git diff --check
```

Expected static search outcome:

- No inline direct global invalidation call sites remain outside helper fallback(s) and `modules/RefreshCoordinator.js`.
- `services/authService.js` may still contain the `invalidateVisitedIdsCache()` option method name because `VaultRepo` currently calls that option.

Actual residual search matches after implementation:

| Match | Classification |
|---|---|
| `services/authService.js:35` | File-local helper fallback to the legacy invalidator if `RefreshCoordinator` is absent. |
| `services/authService.js:327` | `buildVaultRepoSubscriptionOptions()` option method name kept for `VaultRepo` callback compatibility. |
| `services/checkinService.js:34` | File-local helper fallback to the legacy invalidator if `RefreshCoordinator` is absent. |
| `services/firebaseService.js:78` | File-local helper fallback to the legacy invalidator if `RefreshCoordinator` is absent. |
| `modules/RefreshCoordinator.js:65` | Coordinator seam calls the existing invalidator internally. |

There are no direct inline `window.BARK.invalidateVisitedIdsCache()` call sites outside helper fallbacks and the coordinator seam.

Static verification status:

- `node --check services/authService.js services/firebaseService.js services/checkinService.js modules/RefreshCoordinator.js`: PASS
- `rg "invalidateVisitedIdsCache\\(" services modules renderers repos state -g '*.js'`: PASS, residual matches classified above
- `git diff --check`: PASS

Manual/runtime smoke:

- Boot app.
- Sign in.
- Confirm visit count loads.
- Mark visited.
- Reload; confirm visit persists.
- Remove/unmark.
- Reload; confirm removal persists.
- Confirm visited/unvisited filters still work.
- Confirm marker visited styling still updates.
- Confirm no console errors.

Manual smoke after Phase 2C: **PASS**. Console errors: none reported.

## Stop Lines

- Do not migrate visual refresh.
- Do not migrate `syncState()`.
- Do not migrate stats/profile/leaderboard refresh.
- Do not change data ownership.
- Do not change auth/session logic.
- Do not change Firestore writes.
- Do not change VaultRepo ownership or subscriptions.
- Do not deploy.
- Do not start Phase 2D.

## Final Answer

Phase 2C implementation is **complete; manual smoke passed**, with the strict scope of replacing visited cache invalidation call sites in place through a safe coordinator helper. Do not migrate visual refresh, `syncState()`, stats/profile, leaderboard, auth/session, Firestore writes, or ownership boundaries in the same PR.
