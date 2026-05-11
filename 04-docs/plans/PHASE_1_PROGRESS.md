# Phase 1 Progress

This document tracks the live state of Phase 1 work. It is the short operational companion to `plans/PHASE_1_CONSUMERS.md`.

## Current Status

Phase 1A is complete. `ParkRepo` owns canonical park records, `window.BARK.allPoints` and `window.allPoints` JS reads are gone, and `phase-1a-complete` was created as the regression tag.

Phase 1B architecture is complete. `VaultRepo` owns visit state behind explicit repository APIs, the legacy `window.BARK.userVisitedPlaces` shim has been removed, active readers/writers no longer depend on the compatibility Map surface, and 1B.4 normal-browser signed-in smoke passed.

PR 1B.2 writer migration is implemented. PR 1B.2a conflict-aware rollback is implemented. PR 1B.2b pending-delete plus legacy-id canonical replacement hardening is implemented and covered by a focused repro. 1B.2 is manually smoke-verified and automated signed-in Playwright is now unblocked through the Firebase Email/Password E2E test account.

Post-1B.3 normal-browser smoke passed after the `renderEngine` frozen-array cache-key fix. Final Phase 1B architecture review returned LOW merge risk, no Phase 1B blocking issues, and `SAFE TO BEGIN PHASE 1C REVIEW? YES`. Current signed-in Playwright smoke uses saved Firebase Email/Password storage state because Google OAuth still blocks Playwright Chromium.

Phase 1C implementation and cleanup are complete. `VaultRepo` owns the visitedPlaces-only `users/{uid}` snapshot lifecycle through `startSubscription()` / `stopSubscription()`, while `authService` keeps its broad non-visit user-document listener. This was cleanup only; Phase 2 has not started in this section, and signed-in smoke automation is now available through the E2E test account.

Phase 2A inventory is tracked in `plans/PHASE_2_GLOBAL_INVENTORY.md`. It is an architecture inventory only; no runtime behavior changes are included.

Phase 2B added an additive `modules/RefreshCoordinator.js` seam. Phase 2C migrated direct visited cache invalidation call sites through that coordinator while leaving visual refresh, `syncState()`, stats/profile/leaderboard, Firestore writes, auth/session logic, and ownership boundaries unchanged. Phase 2D migrated visited visual refresh call sites through the same coordinator while leaving `syncState()`, stats/profile/leaderboard, Firestore writes, auth/session logic, rollback logic, and ownership boundaries unchanged. Phase 2D QC and manual smoke passed. Phase 2E migrated only the three low-risk check-in direct `window.syncState()` calls through named coordinator requests, and manual smoke passed. Phase 2F.2 extracted premium gating UI into `services/authPremiumUi.js`; manual smoke passed per the post-Phase-2 report.

Post-Phase-2 architecture status is tracked in `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md`. Phase 3B profile/leaderboard split planning is tracked in `plans/PHASE_3B_PROFILE_LEADERBOARD_SPLIT_PLAN.md`. Phase 4A premium entitlement/paywall architecture planning is tracked in `plans/PHASE_4A_PREMIUM_ENTITLEMENT_PLAN.md`.

## Completed In This Chat

- Added `repos/VaultRepo.js` with private `visits`, private `pending`, `revision`, listeners, public mutation/query APIs, and a temporary legacy Map shim.
- Updated `modules/barkState.js` so `window.BARK.userVisitedPlaces` delegates to `VaultRepo` when available.
- Updated `state/appState.js` fallback hydration to prefer the VaultRepo legacy view.
- Updated `index.html` script order so `VaultRepo` loads after `ParkRepo` and before `barkState`.
- Migrated visit-state writers in `services/firebaseService.js`, `services/checkinService.js`, and `services/authService.js` to route writes through `VaultRepo`.
- Moved pending visit mutation state out of `firebaseService.js` into `VaultRepo`.
- Replaced clone-mutate-restore rollback call sites with `VaultRepo.snapshot()` and `VaultRepo.restore(token)`.
- Fixed two review blockers from the first 1B.2 review:
  - `VaultRepo.clear()` now clears pending mutations.
  - Rollback restore is gated so it does not restore after logout or user switch.
- Fixed the second 1B.2 review blocker:
  - Writer rollbacks now use operation rollback tokens, not stale full-repo snapshot restore.
  - The rollback token records touched ids, each touched id's pre-operation value, and each touched id's optimistic value.
  - Restore only rolls back a touched id if its current value still matches that operation's optimistic value.
  - Newer unrelated visits and authoritative snapshot data are preserved.
- Fixed the remaining 1B.2b rollback/canonicalization risk:
  - Canonicalization now reports legacy-to-canonical replacement pairs to `VaultRepo.replaceAll()`.
  - `VaultRepo.replaceAll()` clears stale pending mutations for replaced legacy ids.
  - Operation rollback skips a superseded legacy id when its canonical replacement is active, so rollback does not resurrect the old legacy id or remove the canonical record.
  - Added `tests/phase1b-pending-delete-canonical-replacement.test.js` as the focused repro.
- Implemented PR 1C.1:
  - Added `VaultRepo.startSubscription(uid, options)` and `VaultRepo.stopSubscription()`.
  - Moved active visitedPlaces snapshot hydration out of `authService` and into `VaultRepo`.
  - Kept `authService`'s broad `users/{uid}` listener for non-visit fields.
  - Stopped the broad auth-owned user snapshot before opening a replacement.
  - Kept `stopSubscription()` unsubscribe-only; sign-out explicitly stops then clears via the existing runtime reset.
  - Added `tests/phase1c-vault-subscription.test.js`.
- Completed PR 1C.2 cleanup:
  - Removed dead `handleVisitedPlacesSync()` from `services/authService.js` after confirming it had zero callers.
  - Removed unused `VaultRepo.mutate()` after confirming it had zero real callers.
  - Renamed the local auth UI refresh helper to `refreshAuthSnapshotUi()` without changing its behavior.
  - Added a short rollback comment documenting that pending local state may remain until an authoritative snapshot reconciles it.
- Implemented Phase 2C visited cache invalidation cleanup:
  - Added file-local `refreshVisitedCache(reason)` helpers in `services/authService.js`, `services/firebaseService.js`, and `services/checkinService.js`.
  - Routed direct visited cache invalidation call sites through `window.BARK.refreshCoordinator.refreshVisitedCache(reason)` with the legacy invalidator as a fallback.
  - Left visual refresh, `syncState()`, stats/profile/leaderboard, Firestore writes, auth/session logic, VaultRepo ownership, and rollback behavior unchanged.
- Implemented Phase 2D visited visual refresh cleanup:
  - Added file-local `refreshVisitedVisuals(reason)` helpers in `services/authService.js`, `services/firebaseService.js`, and `services/checkinService.js`.
  - Routed visit mutation, snapshot reconcile, and logout/reset visual refresh call sites through `window.BARK.refreshCoordinator.refreshVisitedVisuals(reason)` with legacy visual refresh fallbacks.
  - Left `firebaseService.refreshVisitedVisualState()` as the legacy implementation/export.
  - Left `syncState()`, stats/profile/leaderboard, Firestore writes, auth/session logic, VaultRepo ownership, and rollback behavior unchanged.
- Phase 2D QC and manual signed-in smoke passed.
- Implemented Phase 2E direct `syncState()` cleanup:
  - Created `plans/PHASE_2E_SYNCSTATE_PLAN.md`.
  - Added narrow `requestStateSync(reason)` / `requestVisitStateSync(reason)` coordinator methods.
  - Added a file-local `requestVisitStateSync(reason)` helper in `services/checkinService.js`.
  - Migrated only the three low-risk check-in visit mutation direct `window.syncState()` call sites in the first implementation slice.
  - Deferred auth/session, Firestore-adjacent helpers, stats/profile/leaderboard, search/filter, settings, map render cadence, data load, panel DOM actions, and renderEngine changes.
  - Manual signed-in smoke passed.
- Implemented Phase 2F.2 authService responsibility extraction:
  - Created `plans/PHASE_2F_AUTHSERVICE_SPLIT_PLAN.md`.
  - Added `services/authPremiumUi.js`.
  - Moved premium gating DOM logic into `window.BARK.authPremiumUi.applyPremiumGating(isLoggedIn)`.
  - Kept a tiny `handlePremiumGating(isLoggedIn)` wrapper in `services/authService.js`, preserving existing signed-in/signed-out call sites.
  - Added `services/authPremiumUi.js` to `index.html` before `services/authService.js` and bumped the touched auth script cache bust.
  - Deferred auth listener, broad `users/{uid}` snapshot, cloud settings, walk points/streak, expedition, leaderboard, logout reset, Firestore writes, and `VaultRepo` ownership.
  - Manual signed-in smoke passed after Phase 2F.2. Phase 3A.1 later added automated premium gating smoke, Phase 3A.2 later added account-switch isolation smoke, Phase 3A.3 later added profile/manage portal smoke, Phase 3A.4 later added trip planner visited styling smoke, and Phase 3A.5 later added settings persistence smoke. The full current bundle command is `npm run test:e2e:smoke`, which passed with 9 tests using Firebase Email/Password E2E storage states; do not deploy or start further Phase 3 work without accepted release smoke.

## 1C.1 Implementation Notes

Design constraints followed:

- Conservative two-subscription path only: auth keeps its broad user-document listener, and `VaultRepo` owns a second visitedPlaces-only listener.
- No subscription bus, no Phase 2 cache invalidation rewrite, no non-visit user-field ownership move, and no deployment.
- `handleVisitedPlacesSync()` was removed during 1C.2 cleanup; auth's broad snapshot has no visit hydrator.
- `VaultRepo.startSubscription()` owns same-uid idempotency, different-uid stop/clear/restart, stale callback guards, metadata-preserving reconciliation, injected canonicalization, and post-reconcile `onChange`.
- `VaultRepo.stopSubscription()` only unsubscribes and preserves visits/pending state.
- `_firstServerPayloadReceived`, `_serverPayloadSettled`, `_cloudSettingsLoaded`, cloud settings, admin, walk points, streak, expedition, leaderboard, saved routes, loader, premium gating, visit writers, and rollback logic remain outside `VaultRepo`.

1C.1 verification status:

- `node --check repos/VaultRepo.js services/authService.js services/firebaseService.js services/checkinService.js`: PASS
- `rg "userVisitedPlaces" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`: PASS, no runtime matches
- Legacy map-view helper runtime search excluding docs/tests: PASS, no runtime matches
- `rg "handleVisitedPlacesSync\\(" services/authService.js`: PASS at 1C.1, definition only; no active auth snapshot call
- `rg "visitedSnapshotUnsubscribe|onSnapshot" services/authService.js repos/VaultRepo.js`: PASS, broad auth listener remains and repo visit listener exists
- `node tests/phase1c-vault-subscription.test.js`: PASS
- `node tests/phase1b-pending-delete-canonical-replacement.test.js`: PASS
- `git diff --check`: PASS
- Manual signed-in smoke: PASS before 1C.2 cleanup
- Automated signed-in Playwright: PASS via Firebase Email/Password E2E storage state. `npm run test:e2e:phase1b` passed with 3 tests. Google OAuth remains blocked in Playwright, but real users still use Google sign-in and no email/password UI was added.

1C.2 cleanup verification status:

- `node --check services/authService.js repos/VaultRepo.js`: PASS
- `rg "handleVisitedPlacesSync\\(" services modules renderers repos engines 2>/dev/null || true`: PASS, no matches
- `rg "userVisitedPlaces" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`: PASS, no runtime matches
- `rg "__legacyMapView" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`: PASS, no runtime matches
- `node tests/phase1c-vault-subscription.test.js`: PASS
- `node tests/phase1b-pending-delete-canonical-replacement.test.js`: PASS
- `git diff --check`: PASS
- Manual signed-in smoke after 1C.2 cleanup: PENDING
- Automated signed-in Playwright: PASS via Firebase Email/Password E2E storage state. `npm run test:e2e:phase1b` passed with 3 tests. Google OAuth remains blocked in Playwright, but real users still use Google sign-in and no email/password UI was added.

## Resolved Rollback Blocker

The review identified that `VaultRepo.snapshot()` recorded `revision`, but `VaultRepo.restore(token)` ignored it and restored the whole prior visit and pending state.

Original failure class:

1. Operation A captures rollback token.
2. Operation A applies optimistic mutation.
3. A newer same-user mutation or authoritative snapshot reconciliation lands.
4. Operation A fails.
5. A stale full restore could restore the older token and erase the newer state.

Known affected rollback callers:

- `services/firebaseService.js`: `updateVisitDate`
- `services/firebaseService.js`: `removeVisitedPlace`
- `services/checkinService.js`: `verifyGpsCheckin`
- `services/checkinService.js`: `markAsVisited`

## 1B.2a Fix Implemented

Goal: make rollback conflict-aware without migrating readers or moving snapshot ownership.

Implemented design:

1. `VaultRepo.createRollbackToken(baseToken, touchedIds)` captures operation context after the optimistic write.
2. Operation rollback tokens record:
   - touched ids,
   - each touched id's value before the operation,
   - each touched id's optimistic value after the operation,
   - each touched id's pending mutation state before the operation.
3. `VaultRepo.restore(token)` now handles operation rollback tokens by rolling back only touched ids whose current values still match the failed operation's optimistic values.
4. If a touched id has changed again, restore skips that id rather than erasing newer state.
5. Untouched newer visits remain untouched.
6. Raw full-snapshot restore now refuses stale restores when the repo revision has advanced. It warns and returns a conflict result instead of blindly overwriting.
7. The existing logout/user-switch guard remains in the writer catch blocks.
8. The destructive-write guard has a legacy Map fallback if `VaultRepo` is unavailable.
9. Existing manual `invalidateVisitedIdsCache()` calls remain in place. Cache invalidation has not moved to subscriptions.

## Required Race Tests Before Merge

- [x] Delayed `updateVisitDate(A)` failure; before rejection, `markAsVisited(B)` succeeds. Assert `B` remains.
- [x] Delayed `updateVisitDate(A)` failure; before rejection, `remove A` succeeds. Assert `A` does not resurrect.
- [x] Delayed `markAsVisited(A)` failure; before rejection, authoritative snapshot confirms `B`. Assert `B` remains.
- [x] Pending delete plus legacy-id canonical replacement. Assert rollback does not resurrect old legacy ids or erase canonical replacement.
- [x] Logout during in-flight write. Assert visits remain cleared after the write rejects.
- [x] Cross-user contamination / pending clear baseline. Assert pending mutations do not survive `VaultRepo.clear()`.
- [x] Manual signed-in Phase 1B.2 smoke PASS reported by maintainer on 2026-05-01 02:22:30 EDT.

## Verification Log

Static checks from 1B.2 passed:

- `node --check services/firebaseService.js services/checkinService.js services/authService.js repos/VaultRepo.js`
- `rg "new Map\\(window\\.BARK\\.userVisitedPlaces" --glob '!plans/**'`
- `rg "userVisitedPlaces\\.(clear|set|delete)\\b" --glob '!plans/**'`
- `rg "pendingVisitedPlaceMutations\\b" services/firebaseService.js`

Focused 1B.2b repro passed:

- `node tests/phase1b-pending-delete-canonical-replacement.test.js`
- Covers legacy id `12.34_-56.78`, canonical replacement `canonical-park-1`, pending delete cleanup, conflict-aware rollback, canonical record preservation, stale pending delete removal, and unrelated visit preservation.

Manual browser checks passed:

- Operation rollback token for a touched id changed size `0 -> 1 -> 0`.
- Raw full-snapshot `restore(token)` refuses stale restores once the repo revision has advanced.
- `VaultRepo.clear()` clears pending mutations.
- Logout during in-flight `updateVisitDate` failure did not resurrect visits.
- Operation rollback preserves unrelated newer visit `B` when failed `updateVisitDate(A)` rolls back.
- Operation rollback does not resurrect removed visit `A` when a newer remove lands before failed `updateVisitDate(A)` rejects.
- Operation rollback preserves authoritative snapshot visit `B` when failed `markAsVisited(A)` rolls back.

Playwright status:

- Automated signed-in Playwright smoke is now unblocked by using the Firebase Email/Password E2E test account to create `BARK_E2E_STORAGE_STATE`.
- `npm run test:e2e:phase1b`: PASS, 3 passed.
- Google OAuth still rejects Playwright Chromium, so the harness should continue to use Email/Password storage state for automation.
- Real users still use Google sign-in. No email/password UI was added to the runtime app.
- Do not commit `storage-state.json`, saved browser state, or real credentials.

Manual signed-in Phase 1B.2 smoke checklist:

Environment:

- Start local server:
  - `python3 -m http.server 4173 --bind localhost`
- Open:
  - `http://localhost:4173/index.html`
- Use normal Chrome/Safari, not Playwright Chromium.
- Sign in with Google normally.

Checklist:

1. Boot local app.
2. Sign in with Google.
3. Confirm no critical console errors.
4. Confirm visit count loads.
5. Pick one safe test park.
6. Mark the park visited.
7. Confirm marker/UI shows visited.
8. Reload page.
9. Confirm the visit persists.
10. Remove/unmark that visit.
11. Reload page.
12. Confirm the visit stays removed.
13. Mark a visit again.
14. If manage portal/date edit exists, edit visit date.
15. Confirm the date update appears.
16. Reload and confirm date persists.
17. Sign out.
18. Confirm visits visually clear.
19. Sign back in.
20. Confirm saved visits restore.
21. Check console for errors.
22. Clean up the test visit if needed.

Result fields:

- [x] PASS
- [ ] FAIL
- Date/time: 2026-05-01 02:22:30 EDT
- Browser: not specified
- Test account: not specified
- Test park: not specified
- Console errors: only location permission warning / hydration skip logs
- Notes: Maintainer reported `Anything weird:` with no additional issues.

1B.2 verification status:

- Manual signed-in Phase 1B.2 smoke: PASS
- Automated Playwright signed-in smoke: PASS via Firebase Email/Password E2E storage state; `npm run test:e2e:phase1b` passed with 3 tests
- 1B.2 status: verified by manual smoke and current automated signed-in smoke
- Safe next step: 1B.3 reader migration
- Deployment still requires the usual final release smoke on the deploy candidate

## 1B.3 Reader Migration

Status: implemented. Active visit-state readers now route through `VaultRepo` query helpers. The temporary `window.BARK.userVisitedPlaces` compatibility fallbacks that existed during 1B.3 were removed in 1B.4.

Files migrated:

- `modules/shareEngine.js`
- `renderers/panelRenderer.js`
- `modules/profileEngine.js`
- `modules/TripLayerManager.js`
- `modules/MarkerLayerManager.js`
- `modules/renderEngine.js`
- `services/authService.js`
- `services/firebaseService.js`
- `services/checkinService.js`

1B.3 automated verification passed:

- `node --check renderers/panelRenderer.js modules/renderEngine.js modules/MarkerLayerManager.js modules/TripLayerManager.js modules/profileEngine.js modules/shareEngine.js services/firebaseService.js services/checkinService.js services/authService.js repos/VaultRepo.js`
- `rg "userVisitedPlaces" --glob '!repos/**' --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- `rg "window\\.BARK\\.userVisitedPlaces" --glob '!repos/**' --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- `node tests/phase1b-pending-delete-canonical-replacement.test.js`
- `git diff --check`

Remaining `userVisitedPlaces` references after 1B.3:

- Approved shim: `modules/barkState.js`.
- Approved compatibility fallback: `state/appState.js`; fallback branches in migrated reader/service files.
- Approved compatibility write fallback: `services/authService.js` and `services/firebaseService.js` when `VaultRepo` is unavailable.
- Active reader that still must migrate: none found.
- Active writer regression: none found.

Normal-browser signed-in smoke after 1B.3 passed before 1B.4 shim deletion review. Automated signed-in Playwright is now unblocked through the Firebase Email/Password E2E test account; Google OAuth remains blocked in Playwright Chromium.

## 1B.4 Shim Deletion

Status: implemented. The temporary `window.BARK.userVisitedPlaces` accessor and legacy map-view helper have been removed. Visit state remains owned by `VaultRepo`; Firestore `users/{uid}` snapshot ownership has not moved.

Files changed:

- `modules/barkState.js`
- `state/appState.js`
- `repos/VaultRepo.js`
- `index.html`
- Stale compatibility fallbacks removed from migrated reader/service files.
- `tests/phase1b-pending-delete-canonical-replacement.test.js` updated to stop using the deleted shim setup.

1B.4 automated verification:

- `node --check modules/barkState.js state/appState.js repos/VaultRepo.js`
- `rg "userVisitedPlaces" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- Legacy map-view helper search returned no runtime matches.
- `node tests/phase1b-pending-delete-canonical-replacement.test.js`
- `git diff --check`
- Normal-browser signed-in smoke after 1B.4: PASS

Remaining references:

- Runtime `userVisitedPlaces`: none found.
- Runtime legacy map-view helper references: none found.
- Runtime/test `userVisitedPlaces` references: none found outside docs/history.
- Playwright smoke coverage now targets `VaultRepo` APIs. Automated signed-in execution is now unblocked through Firebase Email/Password storage state; Google OAuth remains blocked in Playwright.

Manual signed-in smoke after 1B.4:

- [x] PASS
- [ ] FAIL
- Date/time: 2026-05-01, reported by maintainer
- Browser: normal browser, exact browser not specified
- Test account:
- Test park:
- Console errors: Firebase/Google popup Cross-Origin-Opener-Policy warnings only
- Notes: Sign in worked; visit count loaded; mark visited worked; reload persistence worked; remove/unmark worked; reload removal persistence worked; sign out cleared visits visually; sign back in restored saved visits; no weird behavior reported.

Final Phase 1B architecture review:

- Merge risk: LOW
- Blocking issues: none for Phase 1B architecture completion
- Phase 1B architecture: complete
- Automated signed-in Playwright: PASS via Firebase Email/Password E2E storage state; `npm run test:e2e:phase1b` passed with 3 tests
- Safe next step: Phase 1C snapshot ownership design review, not implementation

## Stop Line

Stop after Phase 1C.2 cleanup and verification. Do not deploy, do not begin Phase 2, and do not move additional ownership boundaries from this historical stop point. Current signed-in smoke automation is unblocked through the Firebase Email/Password E2E test account, but deployment still requires final release smoke on the deploy candidate.
