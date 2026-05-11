# Phase 1C Ownership Design Review

Phase 1B is complete. `VaultRepo` owns runtime visit state, active readers and writers use repository APIs, the legacy `window.BARK.userVisitedPlaces` shim is gone, and `__legacyMapView` is gone.

Phase 1C should move only the `visitedPlaces` slice of the `users/{uid}` Firestore snapshot lifecycle from `services/authService.js` into `repos/VaultRepo.js`.

Do not implement Phase 1C until this design review is accepted.

## Current Ownership

`users/{uid}` `onSnapshot` currently lives in `services/authService.js`.

Current `authService` responsibilities inside the user-document snapshot include:

- Auth state transition handling.
- Login/logout UI visibility.
- Profile display name.
- `_cloudSettingsLoaded` reset on account change.
- `_firstServerPayloadReceived` and `_serverPayloadSettled`.
- Cloud settings hydration.
- Admin detection.
- Streak and walk-points hydration/backfill.
- Expedition sync.
- Visited-place snapshot hydration through `handleVisitedPlacesSync()`.
- `window.syncState()`.
- Stats UI refresh.
- First leaderboard load.
- Loader dismissal.
- Active pin visited-button refresh.
- Snapshot error notice display.
- User snapshot unsubscribe on sign-out.

During 1C, these must stay in `authService`:

- Auth state listener lifecycle.
- Login/logout UI behavior.
- Cloud settings hydration.
- Admin check.
- Walk-points and streak behavior.
- Expedition behavior.
- Leaderboard behavior.
- Loader behavior.
- `_cloudSettingsLoaded`.
- `_firstServerPayloadReceived` and `_serverPayloadSettled`.
- Auth failure notices.
- Saved routes loading.
- Premium gating.
- General user-document snapshot for non-visit fields.

The only slice that should move in 1C is `visitedPlaces` hydration/listener ownership.

## Recommended Architecture

Use the conservative two-subscription path for 1C.1.

`authService` keeps its existing `users/{uid}` snapshot for non-visit fields. `VaultRepo` starts its own `users/{uid}` snapshot subscription and owns only `visitedPlaces` hydration, pending mutation reconciliation, and visit-state event publication.

This means there may temporarily be two listeners on the same user document:

- `authService`: non-visit user document concerns.
- `VaultRepo`: `visitedPlaces` only.

This is acceptable for 1C.1 because it minimizes coupling and avoids forcing a subscription bus into the same change. The temporary cost is one extra user-document listener. The benefit is a clean ownership line and easier rollback if the visited-state move misbehaves.

Do not build a single subscription bus in Phase 1C unless a separate design explicitly scopes it. A shared bus would be a larger ownership move because it either keeps auth as the real snapshot owner or introduces a new owner for all user-document slices.

## Proposed Ownership

Move to `VaultRepo`:

- `users/{uid}` visited-place `onSnapshot` setup.
- Visited snapshot unsubscribe.
- Current subscribed uid tracking.
- Stale snapshot guard for account switches.
- `doc.exists ? data.visitedPlaces || [] : []` handling.
- Calling the internal visited snapshot handler.
- Calling `reconcileSnapshot(placeList, metadata)`.
- Invalidating visited-id cache after visit snapshot reconciliation.
- Refreshing marker/trip visited visual state after visit snapshot reconciliation.
- Triggering optional canonical normalization/write-back if still required for visited records.
- Visit snapshot error handling for the visit slice.

Stay in `authService`:

- `firebase.auth().onAuthStateChanged()`.
- General `users/{uid}` snapshot for settings/admin/walk-points/streak/expeditions/loader/leaderboard.
- `_firstServerPayloadReceived` and `_serverPayloadSettled`.
- User snapshot error handling for non-visit hydration.
- Login/logout DOM state.
- Premium gating.
- Saved routes loading.
- Sign-out runtime reset orchestration.

## VaultRepo API Additions

Add these public APIs in 1C.1:

```js
VaultRepo.startSubscription(uid, options)
VaultRepo.stopSubscription()
```

Recommended `startSubscription(uid, options)` behavior:

- Require a non-empty `uid`.
- Accept dependencies via `options` instead of hardcoding as much as practical:
  - `firebase`
  - `onError`
  - `onChange`
  - `normalizeLocalVisitedPlacesToCanonical`
  - `refreshVisitedVisualState`
  - `invalidateVisitedIdsCache`
- Be idempotent for the same uid.
- If already subscribed to the same uid, return the existing unsubscribe handle or a stable status object without creating another listener.
- If subscribed to a different uid, stop the old subscription first, clear repo state and pending mutations, then subscribe to the new uid.
- Increment request count through an injected callback or documented existing helper if the current code still expects it.
- Store the active uid and unsubscribe function internally.
- Guard every snapshot callback by comparing the callback uid to the active uid and current Firebase user if available.

Recommended `stopSubscription()` behavior:

- Unsubscribe if a listener exists.
- Clear the stored unsubscribe function and active uid.
- Be safe to call repeatedly.
- Not throw if there is no active subscription.
- Not by itself clear visits unless explicitly called with an option or paired by `authService` with `VaultRepo.clear()`. The sign-out sequence should be explicit.

Internal snapshot handler responsibilities:

- Ignore snapshots for stale uids.
- Convert missing docs to an empty `visitedPlaces` array.
- Read `metadata.fromCache` and `metadata.hasPendingWrites`.
- Call `reconcileSnapshot(placeList, metadata)` so pending delete/upsert semantics remain centralized.
- Invalidate the visited-id cache after reconciliation.
- Refresh visited marker/trip styles after reconciliation.
- Preserve existing canonical legacy-id replacement behavior.
- Avoid mutating arrays returned by `getVisits()`, `getVisitedIds()`, or `entries()`.
- Return or notify enough information for future tests, but do not expose mutable internal state.

Error handling:

- Log visit-snapshot failures with a `VaultRepo` prefix.
- Call an injected `onError` callback so `authService` can keep showing the same user-facing sync warning if needed.
- Do not clear local visit state on transient listener errors.
- Do not swallow programming errors inside the internal handler without logging.

## AuthService Changes

In 1C.1, `authService` should:

- On sign-in, start the repo-owned visit subscription after `lastAuthenticatedUid` is updated.
- On sign-in to a different uid, rely on `VaultRepo.startSubscription()` to stop the previous visit subscription, or explicitly call `stopSubscription()` before starting the new one. Pick one clear owner for that sequence.
- Remove `handleVisitedPlacesSync(placeList, metadata)` calls from the auth-owned user snapshot after the repo subscription is active.
- Continue hydrating settings/admin/walk-points/streak/expedition from the auth-owned user snapshot.
- Keep `_firstServerPayloadReceived` and `_serverPayloadSettled` in authService for now.
- Keep `window.syncState()`, stats UI refresh, leaderboard load, loader dismissal, and active pin button refresh behavior in authService unless a repo event replacement is explicitly designed.
- On sign-out, stop the `VaultRepo` subscription before clearing local visit state.
- Clear `VaultRepo` state and pending mutations through `VaultRepo.clear()` as part of the existing logged-out runtime reset.

Do not move unrelated user-document concerns into `VaultRepo`.

## Race Risks

Double `users/{uid}` subscriptions:

- Risk: both auth and repo process `visitedPlaces`.
- Guard: after `VaultRepo.startSubscription()` is enabled, remove/disable auth's visit hydration path. Two listeners are acceptable; two visit hydrators are not.

Logout during in-flight write:

- Risk: a failed write restores old visits after logout.
- Guard: preserve writer-side uid checks before `VaultRepo.restore()`, stop subscription before clear on sign-out, and keep `VaultRepo.clear()` clearing pending mutations.

Account switching:

- Risk: old user's snapshot arrives after new user signs in.
- Guard: active uid checks in `VaultRepo` snapshot callback, stop old subscription before or during new subscription, clear state on uid changes.

Cached snapshot vs authoritative snapshot:

- Risk: cached data clears local pending writes too early.
- Guard: preserve `metadata.fromCache` and `metadata.hasPendingWrites` semantics in `reconcileSnapshot()`.

Pending mutation confirmation:

- Risk: upsert/delete pending entries are never cleared or are cleared too early.
- Guard: keep authoritative snapshot confirmation logic in `VaultRepo.reconcileSnapshot()`.

Failed write rollback after snapshot arrival:

- Risk: rollback overwrites newer authoritative data.
- Guard: preserve operation rollback tokens and conflict-aware restore behavior.

Canonical legacy-id replacement:

- Risk: rollback resurrects old legacy ids or removes canonical replacements.
- Guard: keep canonical replacement metadata flowing through `replaceAll()` and preserve the focused repro.

Boot order:

- Risk: auth starts a repo subscription before `VaultRepo` is loaded.
- Guard: `index.html` already loads `repos/VaultRepo.js` before services; keep this order and add a fail-loud check in auth if the repo is unavailable.

Frozen return values:

- Risk: readers mutate frozen arrays/records returned by `VaultRepo`.
- Guard: keep sorting/filtering on mutable copies such as `Array.from(ids).sort()`.

## Test Plan

Static checks:

- `node --check repos/VaultRepo.js services/authService.js services/firebaseService.js services/checkinService.js`
- `rg "userVisitedPlaces" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- `rg "__legacyMapView"`
- `rg "visitedSnapshotUnsubscribe|handleVisitedPlacesSync" services/authService.js repos/VaultRepo.js`
- `rg "collection\\('users'\\)\\.doc\\([^)]*\\).*onSnapshot|collection\\(\"users\"\\)\\.doc\\([^)]*\\).*onSnapshot" services repos modules renderers state core -g '*.js'`
- `git diff --check`

Focused tests:

- Re-run `node tests/phase1b-pending-delete-canonical-replacement.test.js`.
- Add or preserve a focused logout-during-in-flight-write test.
- Add or preserve a focused account-switch stale-snapshot test.
- Add a cached snapshot vs authoritative snapshot reconciliation test if practical in the local harness.
- Confirm failed write rollback after snapshot arrival still preserves newer state.

Manual signed-in smoke:

- Boot app.
- Sign in.
- Confirm visit count loads.
- Mark a park visited.
- Reload and confirm visit persists.
- Remove/unmark visit.
- Reload and confirm removal persists.
- Sign out and confirm visits visually clear.
- Sign back in and confirm saved visits restore.
- Confirm marker visited styling still works.
- Confirm trip planner visited styling still works.
- Confirm profile/manage portal renders.
- Check console for visit snapshot, stale uid, rollback, or frozen-array errors.

Additional practical checks:

- Account switch test: sign in as account A, confirm visits; sign out; sign in as account B; confirm A's visits do not appear.
- Logout during in-flight write test: force a delayed write failure, sign out before rejection, confirm visits remain cleared.
- Reconnect/offline test if practical: toggle offline/online or simulate cached snapshot, confirm pending local changes survive cached snapshots and reconcile on authoritative snapshots.
- Confirm no Phase 2 cleanup sneaks in: no central cache invalidation rewrite, no unrelated user-data ownership move, no UI auth changes.

## Stop Lines

- Do not remove authService snapshot code until VaultRepo subscription is verified.
- Do not process `visitedPlaces` from both authService and VaultRepo at the same time.
- Do not move settings, admin, walk points, streak, expedition, leaderboard, saved routes, loader, or auth UI into `VaultRepo`.
- Do not move `_firstServerPayloadReceived` or `_serverPayloadSettled` unless a separate design justifies it.
- Do not centralize cache invalidation through `VaultRepo.subscribe()` in 1C unless explicitly scoped.
- Do not delete rollback or pending mutation guards.
- Do not add email/password auth UI.
- Do not deploy.

## PR Breakdown

### 1C.1 - VaultRepo owns visitedPlaces snapshot lifecycle

Expected files:

- `repos/VaultRepo.js`
- `services/authService.js`
- `services/firebaseService.js` only if needed to preserve canonicalization/reconcile helpers
- `index.html` only if cache-bust versions need updating
- focused tests under `tests/`
- `plans/PHASE_1_PROGRESS.md`
- `plans/PHASE_1_CONSUMERS.md`

Expected result:

- `VaultRepo.startSubscription(uid, options)` owns the visited-place listener.
- `VaultRepo.stopSubscription()` owns visited-place listener cleanup.
- `authService` starts/stops the repo subscription from auth state.
- `authService` keeps non-visit user-document hydration.
- No duplicate visit hydration.
- Manual signed-in smoke passes.

### 1C.2 - Cleanup dead visit-sync code only after 1C.1 passes

Expected files:

- `services/authService.js`
- `repos/VaultRepo.js`
- focused tests if cleanup changes observable behavior
- `plans/PHASE_1_PROGRESS.md`
- `plans/PHASE_1_CONSUMERS.md`

Expected result:

- Remove dead `handleVisitedPlacesSync()` and `visitedSnapshotUnsubscribe` visit-specific code only after 1C.1 is verified.
- Keep auth-owned non-visit snapshot lifecycle intact.
- Record final Phase 1C verification.

## Accepted Cleanup Decisions

- `handleVisitedPlacesSync()` was removed after grep proved it had zero callers.
- `VaultRepo.mutate()` was removed after grep proved it had zero real callers.
- `refreshVisitDerivedAuthUi()` was renamed to `refreshAuthSnapshotUi()` as a local mechanical cleanup.
- `VaultRepo.stopSubscription()` remains unsubscribe-only; sign-out clear stays explicit in auth-owned runtime reset.
- Canonicalization remains injected from auth/firebase service plumbing; no Phase 2 cache invalidation rewrite or ownership move was included.

## Acceptance Criteria

- `VaultRepo` owns the `visitedPlaces` snapshot listener and unsubscribe.
- `authService` does not hydrate visit state from its user-document snapshot once the repo subscription is active.
- `authService` still owns auth state, non-visit user-document hydration, loader behavior, and `_firstServerPayloadReceived` / `_serverPayloadSettled`.
- No runtime `userVisitedPlaces` or `__legacyMapView` references return.
- No duplicate visit hydration path exists.
- Pending upsert/delete semantics are unchanged.
- Conflict-aware rollback semantics are unchanged.
- Legacy-id canonical replacement repro still passes.
- Account switch does not leak visits across users.
- Logout during an in-flight failed write does not resurrect visits.
- Cached snapshots do not clear pending local changes early.
- Manual signed-in smoke passes.
- Automated signed-in Playwright remains documented as a pre-deploy blocker until the auth automation problem is solved.
- No Phase 2 cleanup or cache invalidation rewrite is included.

## Final Statement

Final architecture: conservative two-subscription Phase 1C, with `VaultRepo` owning only the visitedPlaces snapshot lifecycle and `authService` retaining all other user-document concerns.

Ready for Phase 2? NO. Phase 1C cleanup is complete, but automated signed-in Playwright remains a pre-deploy blocker until the auth automation problem is solved or an accepted release smoke substitute is recorded.
