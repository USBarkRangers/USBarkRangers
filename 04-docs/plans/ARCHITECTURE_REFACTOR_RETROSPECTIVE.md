# Architecture Refactor Retrospective

Date: 2026-05-10
Scope: retrospective audit only. No runtime code changes.
Branch audited: `codex/promo-access-code-premium`
Commit audited: `9744cf7793bd7aee07bb20adb6b46933122105b9`

Source docs reviewed:

- `plans/MASTER_PLAN_IMPLEMENTATION copy.md`
- `plans/PHASE_1_PROGRESS.md`
- `plans/PHASE_1_CONSUMERS.md`
- `plans/PHASE_1C_DESIGN.md`
- `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md`
- `plans/CODEBASE_STRUCTURE_AUDIT.md`

Blunt answer: **yes, the architecture refactor worked for the narrower Phase 1 goal. It did not turn the app into a fully modern, cleanly layered architecture.**

The refactor succeeded at creating real repository ownership for park data and visited-place runtime state. It removed the old `userVisitedPlaces` shim, migrated active readers and writers to `VaultRepo`, and moved visited-place snapshot hydration into `VaultRepo`.

It was not a full-app cleanup. The app is still a classic script-tag, `window.BARK`, global-state frontend with large mixed-responsibility modules. That is not a failure of Phase 1. It means the refactor was scoped to the highest-risk data ownership seam, not the whole app.

## Original Refactor Goal

The original Phase 1 goal was a repository seam:

- Get every park/visit data read going through one interface so later phases can swap implementations without touching consumers.
- Move `allPoints` ownership out of `modules/barkState.js` into `repos/ParkRepo.js`.
- Move `userVisitedPlaces` Map ownership out of `modules/barkState.js` into `repos/VaultRepo.js`.
- Move visited-place `users/{uid}` snapshot ownership out of `services/authService.js` and into `repos/VaultRepo.js`.
- Preserve app behavior while doing the swap.

Evidence:

- Original plan: `plans/MASTER_PLAN_IMPLEMENTATION copy.md:198-225`.
- Phase 1A status: `plans/PHASE_1_PROGRESS.md:7`.
- Phase 1B/1C status: `plans/PHASE_1_PROGRESS.md:9-16`.
- Phase 1C design explicitly narrowed snapshot ownership to only `visitedPlaces`: `plans/PHASE_1C_DESIGN.md:50-63`.

Important nuance: the original master-plan exit criteria included an ambitious item that all cache invalidation should go through `VaultRepo` events. Later implementation deliberately moved less aggressively. Phase 2 added `RefreshCoordinator` as an additive seam, but many direct `syncState()` paths remain. That is a partial completion of refresh cleanup, not a failure of the visited-state ownership move.

## Completed Successfully

| Area | Result | Evidence |
|---|---|---|
| Park data ownership | `ParkRepo` owns the canonical park array and lookup map. | `repos/ParkRepo.js:15-18`, `repos/ParkRepo.js:47-57`, `repos/ParkRepo.js:89-168`. |
| Park-data globals removed | Runtime searches for `window.BARK.allPoints`, `window.allPoints`, and `window.parkLookup` returned no active non-doc/test matches. | Current audit command: `rg -n "window\\.BARK\\.allPoints|window\\.allPoints|window\\.parkLookup" ...` returned no runtime matches. Prior checklist: `plans/PHASE_1_CONSUMERS.md:19-21`, `plans/PHASE_1_CONSUMERS.md:33-39`. |
| VaultRepo owns runtime visit Map | `VaultRepo` keeps private `visits`, `pending`, `canonicalReplacementIds`, and `revision`, and exposes explicit read/write APIs. | `repos/VaultRepo.js:10-16`, `repos/VaultRepo.js:174-234`, `repos/VaultRepo.js:648-672`. |
| Visit readers use repo APIs | Profile, render, marker, trip, panel, share, Firebase helper, check-in, and auth readers go through `VaultRepo` or repo-backed helpers. | `modules/profileEngine.js:11-37`, `modules/renderEngine.js:12-22`, `modules/MarkerLayerManager.js:10-44`, `modules/TripLayerManager.js:52-59`, `renderers/panelRenderer.js:44-55`, `modules/shareEngine.js:11-27`, `services/firebaseService.js:137-160`, `services/checkinService.js:78-95`, `services/authService.js:50-88`. |
| Visit writers use repo APIs before persistence | Check-in and Firebase visit mutation paths add/remove/replace through `VaultRepo`, with pending mutation and rollback helpers. | `services/checkinService.js:262-291`, `services/checkinService.js:319-377`, `services/firebaseService.js:401-452`, `services/firebaseService.js:499-532`, `services/firebaseService.js:540-631`. |
| Old visit shim removed | Runtime search for `userVisitedPlaces` returned no active non-doc/test matches. | Current audit command: `rg -n "userVisitedPlaces" --glob '!plans/**' --glob '!*.md' --glob '!tests/**' ...` returned no runtime matches. Prior checklist: `plans/PHASE_1_CONSUMERS.md:143-171`. |
| Legacy map-view helper removed | Runtime search for `__legacyMapView` returned no active non-doc/test matches. | Current audit command returned no runtime matches. Prior checklist: `plans/PHASE_1_PROGRESS.md:96-113`. |
| VaultRepo owns visited-place snapshot lifecycle | `VaultRepo.startSubscription()` subscribes to `users/{uid}`, extracts `visitedPlaces`, reconciles snapshots, guards stale callbacks, and owns its unsubscribe. | `repos/VaultRepo.js:544-577`, `repos/VaultRepo.js:586-646`. |
| Auth starts/stops VaultRepo subscription instead of hydrating visits itself | `authService` builds subscription options and calls `startVaultRepoVisitSubscription(user)` and `stopVaultRepoVisitSubscription()`. | `services/authService.js:406-450`, `services/authService.js:808-816`, `services/authService.js:898-912`. |
| Conflict-aware rollback was added | Focused rollback/canonical replacement test still passes. | `repos/VaultRepo.js:244-384`; command result: `node tests/phase1b-pending-delete-canonical-replacement.test.js` passed. |
| VaultRepo subscription behavior is covered | Focused subscription test still passes. | Command result: `node tests/phase1c-vault-subscription.test.js` passed. |

## Partially Completed

| Area | What improved | What remains |
|---|---|---|
| Refresh coordination | `RefreshCoordinator` exists, and key visited-cache, visited-visual, and check-in sync requests go through named methods. | `window.syncState()` is still the central heartbeat and is still called directly by auth, Firebase, map, search, settings, UI, data, panel, profile, and trip paths. |
| Auth service split | Premium gating DOM logic moved to `services/authPremiumUi.js`; visited snapshot ownership moved out. | `services/authService.js` still owns Firebase init, auth observer, broad user-doc listener, cloud settings, admin, walk/streak, expedition, leaderboard trigger, loader, logout reset, and auth UI. |
| User-doc listener ownership | `VaultRepo` owns the visited slice. | There are still two listeners on `users/{uid}`: one for auth/non-visit fields and one for `visitedPlaces`. This is intentional per Phase 1C design, but it is still duplicated read cost. |
| Global cleanup | The worst park/visit data globals are gone. | The app still integrates through `window.BARK`, `window.syncState`, `window.map`, trip globals, score globals, cloud-settings flags, and DOM ids. |
| Test coverage | Focused VaultRepo tests exist and pass; later Playwright coverage exists per architecture docs. | Full auth/settings/profile/leaderboard behavior is not isolated enough to make large refactors low-risk. |

Evidence:

- `RefreshCoordinator` describes itself as additive and not replacing current direct refresh calls: `modules/RefreshCoordinator.js:1-6`.
- `RefreshCoordinator` still delegates to `window.syncState()`: `modules/RefreshCoordinator.js:95-124`.
- Direct `window.syncState()` callers remain in many modules. Current audit found direct calls in `authService`, `firebaseService`, `dataService`, `mapEngine`, `searchEngine`, `settingsController`, `uiController`, `panelRenderer`, `profileEngine`, and `tripPlannerCore`.
- Post-Phase-2 report already captured this honestly: `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md:32-42`, `plans/POST_PHASE_2_ARCHITECTURE_REPORT.md:147-155`.

## Not Completed

These were not completed, and most were not in the final accepted Phase 1 scope:

- Full removal of `window.BARK`.
- Conversion from classic script tags to ES modules or a bundler.
- A single user-document subscription bus.
- Splitting `services/authService.js` into focused auth, settings hydration, progress, expedition, leaderboard, and logout-reset services.
- Splitting `functions/index.js`.
- Separating profile, achievements, leaderboard, and score sync into smaller services.
- Moving premium/paid/public-launch payment state into a fully shared client/server state-machine definition.
- Moving `users/{uid}.visitedPlaces` from an embedded array to a subcollection.
- Removing all direct DOM selectors and inline `innerHTML` rendering.
- Removing all `localStorage` and `sessionStorage` state scattering.

Evidence:

- Script-tag architecture remains in `index.html:1413-1464`.
- `barkState` still owns the `window.BARK` namespace and global runtime state: `modules/barkState.js:1-15`, `modules/barkState.js:17-31`, `modules/barkState.js:92-145`.
- `renderEngine` still defines the global heartbeat: `modules/renderEngine.js:311-336`.
- `authService` still opens the broad user-doc snapshot for non-visit fields: `services/authService.js:821-885`.
- Large files remain: `styles.css` 3,191 lines, `functions/index.js` 2,228 lines, `index.html` 1,607 lines, `engines/tripPlannerCore.js` 1,472 lines, `modules/searchEngine.js` 1,095 lines, `services/authService.js` 990 lines.

## Evidence From Files

### Repository Boundaries

- `repos/ParkRepo.js:1-5`: declares the canonical park record repository.
- `repos/ParkRepo.js:15-18`: private `allPoints`, `markerDataRevision`, `lookup`, and listeners.
- `repos/ParkRepo.js:47-57`: explicit park read APIs.
- `repos/ParkRepo.js:89-168`: `replaceAll()` owns data replacement and destructive refresh guard.
- `repos/VaultRepo.js:1-5`: declares user visit repository.
- `repos/VaultRepo.js:10-16`: private visit state.
- `repos/VaultRepo.js:174-234`: explicit visit read/write APIs.
- `repos/VaultRepo.js:244-384`: snapshot and conflict-aware restore logic.
- `repos/VaultRepo.js:464-672`: subscription, reconciliation, and public API exports.

### Current Visit Ownership

- `services/checkinService.js:78-95`: reads current visits from `VaultRepo` or repo-backed helpers.
- `services/checkinService.js:262-291`: GPS check-in writes through `vaultRepo.addVisit()` before Firestore persistence.
- `services/checkinService.js:319-377`: mark/unmark writes through `vaultRepo.addVisit()` / `vaultRepo.removeVisits()`.
- `services/firebaseService.js:137-160`: canonical read helpers use `VaultRepo`.
- `services/firebaseService.js:401-452`: pending mutation and local replacement helpers call `VaultRepo`.
- `services/firebaseService.js:499-532`: Firestore writes persist arrays sourced from `VaultRepo`.
- `services/firebaseService.js:761-770`: repo-backed helpers are still exported to `window.BARK` for older consumers.

Conclusion: `VaultRepo` is the sole runtime owner of the in-memory visit Map, but `firebaseService` and `checkinService` still orchestrate Firestore writes and UI refresh around it. That is expected in the current architecture.

### Current User-Doc Listeners

- `repos/VaultRepo.js:607-646`: `VaultRepo.startSubscription()` opens a `users/{uid}` listener for visited-place hydration.
- `services/authService.js:821-885`: `authService` opens a broad `users/{uid}` listener for entitlement, settings, admin, walk/streak, expedition, leaderboard trigger, and loader behavior.

Conclusion: there are still duplicated user-doc listeners. This was intentional in Phase 1C to avoid a larger subscription bus. It is a cost/read-efficiency watch item, not evidence that the refactor failed.

### Current Global Architecture

- `index.html:1413-1464`: many classic scripts load in a strict order.
- `core/app.js:1-15`: boot orchestrator attaches diagnostics to `window.BARK`.
- `core/app.js:143-180`: app startup calls global init functions by name.
- `modules/barkState.js:7-15`: global namespace and version state.
- `modules/barkState.js:17-31`: launch flags and request safety counters on globals.
- `modules/barkState.js:107-115`: visited filter and trip bookend globals.
- `modules/barkState.js:126-145`: gamification, walk points, sync score, and live `window.BARK` accessors.
- `modules/renderEngine.js:311-336`: `window.syncState()` remains global and central.

Conclusion: the app is still a global classic-script app. The refactor created cleaner islands inside that architecture.

## What Still Looks Tangled

| Area | Why tangled | Severity | Beta blocker? | Paid launch blocker? |
|---|---|---:|---|---|
| `services/authService.js` | Auth state, user snapshot, entitlement, cloud settings, admin, walk/streak, expedition, leaderboard trigger, reset logic, and UI wiring remain together. | P1 | No | Yes, if broad changes continue without tests. |
| `window.syncState()` | Render, stats, achievements, and marker updates still share a global heartbeat. | P1/P2 | No | Yes for long-term maintainability. |
| `modules/profileEngine.js` | Profile, achievements, score calculation, leaderboard, rank fallback, and score sync remain together. | P1/P2 | No | Yes before leaderboard/score claims become high-stakes. |
| `engines/tripPlannerCore.js` | Trip state, UI rendering, route actions, inline handlers, and save/load flows are mixed. | P2 | No | Not a payment blocker, but risky for route changes. |
| `functions/index.js` | Payments, ORS, leaderboard, admin/Gemini/Sheets, and helpers share one large backend file. | P1 | No | Yes before continued paid feature growth. |
| Global settings/cloud flags | `_cloudSettingsLoaded`, `_serverPayloadSettled`, `_firstServerPayloadReceived`, revision flags, localStorage/sessionStorage are scattered. | P1 | No if unchanged | Yes before large account/settings refactors. |
| Legacy global exports | Repo-backed helpers are still exported to `window.BARK` so older consumers can call them. | P2 | No | No, but gradually reduce. |

## What Is Safe To Leave Alone Before Beta

- `window.BARK` as the namespace and service/repo registry.
- The classic `index.html` script order.
- Two `users/{uid}` listeners, because this was the accepted Phase 1C design and keeps non-visit auth behavior stable.
- `window.syncState()` as the global heartbeat, as long as new changes do not add more direct callers.
- `users/{uid}.visitedPlaces` as an array for the 5-free cap and small private beta.
- `services/authService.js` broad listener, cloud settings, walk/streak, expedition, and loader behavior.
- Trip planner globals and route UI, unless a specific route bug appears.
- Profile/leaderboard rendering, as long as server-authoritative leaderboard writes remain in place.

Reason: these areas are working, user-visible, and interdependent. Refactoring them before 5-10 testers would create more risk than value.

## What Should Be Fixed Before Paid Launch

| Priority | Fix | Why | Suggested approach |
|---|---|---|---|
| P1 | Consolidate or split the `users/{uid}` listener strategy | Current two-listener approach is acceptable but inefficient and harder to debug. | Either one listener fan-out service or move `visitedPlaces` to a subcollection. Do not do both at once. |
| P1 | Split payment/webhook/ORS/leaderboard/admin code out of `functions/index.js` | Payment and launch-critical server code should not keep growing in one 2,000+ line file. | Extract modules with no behavior change after private beta. Keep tests green. |
| P1 | Define one account-scoped runtime reset contract | Account switching touches many globals. | Create a tested reset helper for premium, visits, leaderboard, trip, settings-hydration flags, and current walk score. |
| P1 | Reduce direct `window.syncState()` callers | Render/profile/achievement refresh should have named reasons and fewer callers. | Continue RefreshCoordinator migration by domain, not all at once. |
| P1/P2 | Split profile/leaderboard/achievement responsibilities | Leaderboard and score claims are trust-sensitive. | Extract leaderboard service and score display path after tests. |
| P2 | Document and test cloud settings hydration flags | Settings overwrite races are hard to debug. | Add focused tests before any settings refactor. |
| P2 | Move premium unlimited visits toward a subcollection or capped policy | The array model is fine for small beta but can grow for power users. | Defer until real usage shows need, then migrate carefully. |

## What Should Wait Until After Launch

- Full ES module/bundler migration.
- Full `window.BARK` removal.
- Full DOM rendering rewrite.
- Trip planner store/controller rewrite.
- Map render pipeline rewrite.
- Replacing all inline `innerHTML` in one pass.
- Moving every setting/localStorage path into a new state framework.
- Big repository/data-model migration unless real usage proves the need.

These are real maintainability improvements, but they are too broad for the private-beta path. They should be done only behind strong regression tests.

## Direct Answers To Carter's Questions

1. **What was the original architecture refactor supposed to fix?**
   It was supposed to put park and visit data behind repositories, remove direct global data reads/writes, and move visited-place snapshot ownership into `VaultRepo` while preserving behavior.

2. **Which goals were actually completed?**
   ParkRepo ownership, VaultRepo runtime state ownership, reader/writer migration, old visit shim deletion, visited-place snapshot ownership, and focused rollback/subscription tests.

3. **Which old shims/globals were removed?**
   Runtime `window.BARK.allPoints`, `window.allPoints`, `window.parkLookup`, `window.BARK.userVisitedPlaces`, and `__legacyMapView` are gone from active source outside docs/tests.

4. **Is VaultRepo truly the sole runtime owner of visited-place state?**
   Yes for the in-memory visit Map and snapshot reconciliation. No if "owner" means every side effect: `checkinService`, `firebaseService`, `authService`, render/profile modules, and Firestore rules still coordinate writes, refreshes, UI, persistence, and account lifecycle around it.

5. **Are readers and writers actually using VaultRepo instead of legacy globals?**
   Yes for active visit readers/writers found in the audit. Some older helper names remain exported on `window.BARK`, but those helpers are repo-backed now.

6. **Are there remaining legacy globals related to visited places?**
   The old `userVisitedPlaces` global is gone. Related globals remain: `window.BARK.visitedFilterState`, `window.BARK._visitedIdsCacheKey`, `window.syncState`, `window.BARK.invalidateVisitedIdsCache`, `window.BARK.activePinMarker`, and global profile/walk/leaderboard flags. These are related to UI/render/state coordination, not the old visit Map ownership.

7. **Are there remaining duplicated user-doc listeners?**
   Yes. `VaultRepo` listens to `users/{uid}` for `visitedPlaces`; `authService` listens to the same doc for non-visit fields. This is intentional Phase 1C scope.

8. **What parts are still script-tag/window.BARK/global-state architecture?**
   Most frontend integration: boot, map, search, settings, profile, leaderboard, trip planner, paywall/account UI, repo/service registries, render heartbeat, and module exports.

9. **Which remaining globals are harmless for beta?**
   `window.BARK` namespace, repo/service registries, launch flags, boot diagnostics, `window.map`, `RefreshCoordinator`, marker render flags, trip planner state, and visited filter state are acceptable if left stable.

10. **Which remaining globals are dangerous before paid public launch?**
    Account-scoped and trust-sensitive globals: `_cloudSettingsLoaded`, `_serverPayloadSettled`, `_firstServerPayloadReceived`, `_lastSyncedScore`, `_lastKnownRank`, `_lastLeaderboardDoc`, `_leaderboardLoadedOnce`, `window.currentWalkPoints`, `window.isAdmin`, and scattered cloud settings revision flags.

11. **Did the refactor fail, or was it just scoped narrower than full-app architecture cleanup?**
    It did not fail. It was scoped narrower. It fixed the biggest park/visit ownership problem and left the broader classic-script/global architecture for later staged cleanup.

## Commands Run

```bash
git status -sb
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
rg --files | rg '(^|/)(PHASE_1_PROGRESS|PHASE_1_CONSUMERS|PHASE_1C_DESIGN)\\.md$'
find . -maxdepth 3 -name 'PHASE_1*.md' -print
rg -n "userVisitedPlaces|__legacyMapView|window\\.BARK\\.allPoints|window\\.allPoints|window\\.parkLookup" --glob '!plans/**' --glob '!*.md' --glob '!tests/**' --glob '!node_modules/**' --glob '!functions/node_modules/**'
rg -n "function startVaultRepoVisitSubscription|function stopVaultRepoVisitSubscription|function stopUserSnapshotSubscription|startVaultRepoVisitSubscription|userSnapshotUnsubscribe|onSnapshot" services/authService.js repos/VaultRepo.js
rg -n "window\\.syncState\\(|syncState\\s*=|function syncState|requestVisitStateSync|refreshCoordinator" services modules renderers core repos engines gamificationLogic.js --glob '*.js'
rg -n "VaultRepo|getVisits\\(|getVisit\\(|hasVisit\\(|entries\\(|replaceAll\\(|addVisit\\(|removeVisit|setVisits\\(|clear\\(|visitedPlaces" services modules renderers repos core state engines gamificationLogic.js --glob '*.js'
wc -l index.html styles.css functions/index.js services/authService.js modules/profileEngine.js engines/tripPlannerCore.js modules/searchEngine.js services/firebaseService.js repos/VaultRepo.js repos/ParkRepo.js modules/renderEngine.js
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node tests/phase1b-pending-delete-canonical-replacement.test.js
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node tests/phase1c-vault-subscription.test.js
git diff --check
```

Results:

- Branch: `codex/promo-access-code-premium`.
- Commit: `9744cf7793bd7aee07bb20adb6b46933122105b9`.
- Old visit/park global runtime search: no active non-doc/test matches.
- Phase 1B pending-delete canonical replacement repro: PASS.
- Phase 1C VaultRepo subscription test: PASS.
- `git diff --check`: PASS.

## Final Judgment

The architecture refactor worked for the Phase 1 repository seam. It made the app materially safer by putting park data and visited-place state behind explicit owners.

It did not complete full architecture cleanup, and Carter should not describe it that way. The honest status is:

- **Private beta:** good enough if left stable and tested.
- **Broader beta:** acceptable, but avoid piling more features into `authService`, `profileEngine`, `tripPlannerCore`, or `functions/index.js`.
- **Paid public launch:** do not do a giant rewrite, but do plan targeted cleanup of backend organization, account reset boundaries, user-doc listener strategy, and `syncState()` coordination.

Do not rewrite everything. The refactor did the important first job. The next architecture work should be smaller, named, and test-backed.
