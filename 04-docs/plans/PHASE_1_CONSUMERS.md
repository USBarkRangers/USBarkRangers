# Phase 1 Consumer Migration Checklist

Phase 1 creates repository seams while preserving current behavior. Do not remove legacy `window.BARK.*` surfaces until the matching repo owns the data and consumers are migrated.

## Phase 1A - ParkRepo

Status: in progress.

Completed:

- [x] Add `repos/ParkRepo.js` with `getAll()`, `getById(id)`, `getLookup()`, `getRevision()`, `replaceAll(parks, options)`, and `subscribe(fn)`.
- [x] Wire `repos/ParkRepo.js` before `modules/barkState.js` in `index.html`.
- [x] Temporarily repoint the existing `window.BARK.allPoints` accessor in `modules/barkState.js` to `ParkRepo` instead of adding a parallel shim.
- [x] Keep `window.parkLookup` as the compatibility lookup while `ParkRepo` owns its backing Map.
- [x] Move the CSV destructive-refresh rollback guard into `ParkRepo.replaceAll()`.
- [x] Move the marker data revision bump into `ParkRepo.replaceAll()` while preserving the `window.BARK._markerDataRevision` fingerprint contract.
- [x] Update `state/appState.js` fallback hydration to read `allPoints` and `parkLookup` from `ParkRepo`.
- [x] Update the single park-data writer, `modules/dataService.js`, to publish through `ParkRepo.replaceAll()`.
- [x] Remove the temporary `window.BARK.allPoints` accessor and legacy `window.allPoints` mirror after all JS readers moved to `ParkRepo`.
- [x] Migrate `modules/TripLayerManager.js` lookup-by-id reads to `ParkRepo.getById()`.
- [x] Remove the legacy `window.parkLookup` global and `state/appState.js` mirror; `ParkRepo` now keeps the lookup Map module-private.

Migrated off the compatibility accessor:

- [x] `services/authService.js`
- [x] `modules/shareEngine.js`
- [x] `services/firebaseService.js`
- [x] `modules/searchEngine.js`
- [x] `modules/renderEngine.js`
- [x] `modules/profileEngine.js`
- [x] `modules/MarkerLayerManager.js`

Phase 1A exit target:

- [x] App boots and loads CSV data through `ParkRepo`.
- [x] Search still returns local park results.
- [x] Marker render still sees the same marker data revision contract.
- [x] `rg "window.BARK.allPoints|window.allPoints"` returns zero JS hits.

## Phase 1B - VaultRepo Map Ownership

Status: Phase 1B architecture is complete. PR 1B.1, 1B.2, 1B.2a, 1B.2b, 1B.3, and 1B.4 are implemented, and 1B.4 normal-browser signed-in smoke passed. Automated signed-in Playwright remains a pre-deploy blocker while Google OAuth blocks Playwright Chromium.

Important constraint: Before 1B.4, visit state was read through a temporary legacy Map-like shim. After 1B.4, runtime visit state is accessed through `VaultRepo` APIs only.

Regression safety net before implementation:

- [x] Create git tag `phase-1a-complete`.
- [x] Add Playwright smoke coverage for visit lifecycle persistence.
- [x] Add Playwright smoke coverage for optimistic rollback during `updateVisitDate`.
- [x] Add Playwright smoke coverage for logout clearing visits and login restoring them.
- [ ] Run the existing test suite before changing visit ownership.
- [ ] Run the new Playwright smoke tests before changing visit ownership.

### Planned PR Breakdown

#### 1B.1 Repo skeleton + shim redirect

Goal: add the repo boundary without changing behavior or moving snapshot ownership.

| File | Planned change | Done |
|---|---|---|
| `repos/VaultRepo.js` | Add the repo skeleton with live Map-backed APIs and subscription support. | [x] |
| `modules/barkState.js` | Redirect the existing `window.BARK.userVisitedPlaces` accessor through `VaultRepo` as a temporary compatibility shim. | [x] |
| `index.html` | Load `repos/VaultRepo.js` before legacy consumers. | [x] |
| `plans/PHASE_1_CONSUMERS.md` | Track the shim and consumer migration status. | [x] |
| Playwright smoke tests | Confirm existing visit lifecycle behavior still passes through the shim. | [ ] |

#### 1B.2 Migrate writers + rollback + pending-mutation API

Goal: make all visit mutations explicit before moving readers.

Merge status: 1B.2 is code-ready and manually smoke-verified for internal refactor progress. Writer routing is in place, 1B.2a changed rollback from stale full-token restore to operation-scoped rollback for writer failures, and 1B.2b verifies pending-delete plus legacy-id canonical replacement.

Automated signed-in Playwright smoke is currently blocked because the app uses Google sign-in only and Google OAuth rejects Playwright Chromium as insecure. This is a test harness/auth-provider limitation, not a proven app logic failure.

Automated signed-in Playwright smoke remains a pre-deploy blocker. For internal refactor progress only, manual signed-in smoke may be used because the public app remains on the old stable version.

Do not deploy this branch until signed-in smoke is automated or manually repeated and accepted before release. Firebase Email/Password test auth may be enabled later for automation, but do not add it now. Do not add email/password UI to the app as part of this task.

1B.2 verification status: Code-ready and manually smoke-verified for internal refactor progress. Automated signed-in Playwright remains a pre-deploy blocker due to Google OAuth blocking Playwright Chromium.

Blocking fix checklist:

- [x] Make `VaultRepo.restore(token)` conflict-aware instead of blindly restoring old visit/pending state.
- [x] Preserve newer same-user mutations that happen after a rollback token is captured.
- [x] Preserve authoritative snapshot reconciliation that happens after a rollback token is captured.
- [x] Keep logout/session-change restore guard from the previous review fix.
- [x] Run focused race tests for delayed failure plus newer local mutation, delayed failure plus remove, and delayed failure plus authoritative snapshot.
- [x] Run focused pending-delete plus legacy-id canonical replacement repro.
- [x] Run manual signed-in smoke in a normal browser before marking 1B.2 verified for internal refactor progress.
- [ ] Re-run automated signed-in Playwright smoke before deployment, or manually repeat and accept signed-in smoke before release.

| File | Planned change | Done |
|---|---|---|
| `repos/VaultRepo.js` | Add mutation APIs for `clear()`, `replaceAll()`, `addVisit()`, `removeVisit()`, `removeVisits()`, pending mutation helpers, and operation rollback tokens. | [x] |
| `services/firebaseService.js` | Replace direct Map replacement, clone/mutate/restore, stale delete, and pending mutation writes with `VaultRepo` calls. | [x] |
| `services/checkinService.js` | Replace direct `set()` / `delete()` visit writes with `VaultRepo` mutation APIs while preserving optimistic UI and rollback behavior. | [x] |
| `services/authService.js` | Use `VaultRepo.clear()` / `VaultRepo.setVisits()` for logout and hydration writes, while leaving snapshot ownership in auth for now. | [x] |
| Playwright smoke tests | Confirm mark, unmark, reload persistence, and `updateVisitDate` rollback still pass. | [ ] |

Resolved 1B.2 risk:

- [x] Full-token rollback stale restore: writer rollback callers now create operation rollback tokens that track touched ids, their pre-operation values, and their optimistic values. Restore rolls back only touched ids that still match the failed operation's optimistic values.
- [x] Pending delete plus legacy-id canonical replacement: canonicalization passes replacement pairs to `VaultRepo.replaceAll()`, stale pending legacy mutations are cleared, and operation rollback skips superseded legacy ids while preserving the active canonical replacement.

#### 1B.3 Migrate readers

Goal: remove direct read dependence on the compatibility Map handle.

Prerequisite: 1B.2 must be manually smoke-verified for internal refactor progress or automated signed-in smoke must pass. Automated signed-in Playwright remains a pre-deploy blocker while Google OAuth blocks Playwright Chromium.

| File | Planned change | Done |
|---|---|---|
| `renderers/panelRenderer.js` | Read visit state through `VaultRepo` query helpers instead of the live Map handle. | [x] |
| `modules/renderEngine.js` | Read visited IDs/state through `VaultRepo` helpers. | [x] |
| `modules/MarkerLayerManager.js` | Read marker visited state through render specs / repo-backed helpers, preserving current marker classes. | [x] |
| `modules/TripLayerManager.js` | Read trip overlay visited state through repo-backed helpers. | [x] |
| `modules/profileEngine.js` | Read manage portal, stats, and achievement input through `VaultRepo` helpers. | [x] |
| `modules/shareEngine.js` | Read share-card achievement input through `VaultRepo` helpers. | [x] |
| `services/firebaseService.js` | Read canonical visit arrays through `VaultRepo` helpers. | [x] |
| `services/checkinService.js` | Read current visit entries through `VaultRepo` helpers. | [x] |
| `services/authService.js` | Read visit count/current state through `VaultRepo` helpers where needed. | [x] |
| Playwright smoke tests | Confirm logout clear and login restore behavior after reader migration. | [ ] |

1B.3 verification:

- [x] `node --check renderers/panelRenderer.js modules/renderEngine.js modules/MarkerLayerManager.js modules/TripLayerManager.js modules/profileEngine.js modules/shareEngine.js services/firebaseService.js services/checkinService.js services/authService.js repos/VaultRepo.js`
- [x] `rg "userVisitedPlaces" --glob '!repos/**' --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- [x] `rg "window\\.BARK\\.userVisitedPlaces" --glob '!repos/**' --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- [x] `node tests/phase1b-pending-delete-canonical-replacement.test.js`
- [x] `git diff --check`
- [ ] Normal-browser signed-in smoke after 1B.3.

Remaining `userVisitedPlaces` references after 1B.3:

- Approved shim: `modules/barkState.js`.
- Approved compatibility fallback: `state/appState.js`; legacy fallback branches in `modules/shareEngine.js`, `renderers/panelRenderer.js`, `modules/profileEngine.js`, `modules/TripLayerManager.js`, `modules/MarkerLayerManager.js`, `modules/renderEngine.js`, `services/firebaseService.js`, `services/checkinService.js`, and `services/authService.js`.
- Approved compatibility write fallback: `services/authService.js` and `services/firebaseService.js` assignment fallbacks when `VaultRepo` is unavailable.
- Active reader that still must migrate: none found.
- Active writer regression: none found.

#### 1B.4 Delete shims

Goal: finish Map ownership cleanup after all consumers are migrated.

| File | Planned change | Done |
|---|---|---|
| `modules/barkState.js` | Remove the temporary `window.BARK.userVisitedPlaces` compatibility accessor. | [x] |
| `repos/VaultRepo.js` | Keep the live Map module-private and expose only repo APIs. | [x] |
| `state/appState.js` | Remove `userVisitedPlaces` fallback hydration and mirror setup. | [x] |
| `index.html` | Bump touched script cache versions. | [x] |
| `plans/PHASE_1_CONSUMERS.md` | Mark Phase 1B migration complete and record verification output. | [x] |
| Static checks | Confirm `rg "userVisitedPlaces"` returns no active JS hits outside approved docs/tests. | [x] |
| Focused repro | Run pending-delete canonical replacement repro after shim deletion. | [x] |
| Manual smoke | Run normal-browser signed-in smoke after shim deletion. | [x] |

1B.4 verification:

- [x] `node --check modules/barkState.js state/appState.js repos/VaultRepo.js`
- [x] `rg "userVisitedPlaces" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- [x] Legacy map-view helper search returned no runtime matches.
- [x] `node tests/phase1b-pending-delete-canonical-replacement.test.js`
- [x] `git diff --check`
- [x] Normal-browser signed-in smoke after 1B.4.

Remaining `userVisitedPlaces` references after 1B.4:

- Runtime references: none found.
- Test references: Playwright smoke coverage now targets `VaultRepo` APIs; no deleted-shim test references remain.
- Docs/history references: allowed.

Final Phase 1B review:

- 1B.4 normal-browser signed-in smoke: PASS.
- Console warnings: Firebase/Google popup Cross-Origin-Opener-Policy warnings only.
- Phase 1B architecture: complete.
- Opus architecture review: LOW merge risk; no Phase 1B blocking issues.
- Automated signed-in Playwright: still a pre-deploy blocker.
- Safe next step: PR 1C.1 implementation, after Phase 1C design review acceptance.

## Phase 1C - VaultRepo Snapshot Ownership

Status: Phase 1C implementation and cleanup are complete. `VaultRepo` owns the visitedPlaces-only snapshot lifecycle; `authService` keeps the broad user-document listener for non-visit fields. 1C.2 was cleanup only, Phase 2 has not started, and automated signed-in Playwright remains a pre-deploy blocker.

Move this last. It touches auth-state races and listener cleanup:

### Planned PR Breakdown

#### 1C.1 VaultRepo owns visited-places snapshot lifecycle

Goal: move Firestore listener ownership after Map mutation/read ownership is already stable.

| File | Planned change | Done |
|---|---|---|
| `repos/VaultRepo.js` | Own the `users/{uid}` visited-places `onSnapshot` lifecycle, listener cleanup, and snapshot-to-Map hydration. | [x] |
| `services/authService.js` | Start/stop the `VaultRepo` subscription from auth state without owning visited-place hydration. | [x] |
| `services/firebaseService.js` | Preserve pending mutation confirmation and rollback contracts through `VaultRepo`. | [x] |
| Auth-owned visit UI refresh | Preserve stats/profile/active-pin refresh behavior by running injected `onChange` after repo reconciliation. | [x] |
| Focused Node tests | Cover repo subscription lifecycle with fake Firestore listeners. | [x] |
| Playwright smoke tests | Confirm reload persistence and logout/login restoration with repo-owned snapshots. | [ ] |

1C.1 verification:

- [x] `node --check repos/VaultRepo.js services/authService.js services/firebaseService.js services/checkinService.js`
- [x] Runtime legacy visit shim and legacy map-view helper searches return no matches outside docs/tests.
- [x] At 1C.1, `handleVisitedPlacesSync()` remained definition-only in auth; no active auth snapshot call remained.
- [x] `node tests/phase1c-vault-subscription.test.js`
- [x] `node tests/phase1b-pending-delete-canonical-replacement.test.js`
- [x] `git diff --check`
- [x] Manual signed-in smoke after 1C.1.
- [ ] Automated signed-in Playwright before deployment, or accepted manual substitute before release.

#### 1C.2 Cleanup pass

Goal: remove leftover listener-era coupling and document the final ownership boundary.

| File | Planned change | Done |
|---|---|---|
| `services/authService.js` | Remove dead auth-owned visit hydration code after ownership moves. | [x] |
| `repos/VaultRepo.js` | Remove unused generic mutation helper and document rollback reconciliation semantics. | [x] |
| `plans/PHASE_1_CONSUMERS.md` | Mark Phase 1C complete and record final verification commands. | [x] |
| Static checks | Confirm no direct Firestore visited-place snapshot setup remains outside `repos/VaultRepo.js`. | [x] |
| Playwright smoke tests | Run the full visit lifecycle smoke suite after cleanup. | [ ] |

- [x] visitedPlaces-only `users/{uid}` `onSnapshot` ownership moves from `services/authService.js` to `repos/VaultRepo.js`.
- [x] Auth starts/stops the repo subscription, but the repo owns visited-place hydration.
- [x] Preserve `_firstServerPayloadReceived`, `_serverPayloadSettled`, `_cloudSettingsLoaded`, listener cleanup, and optimistic rollback behavior.
- [x] Removed dead `handleVisitedPlacesSync()` after grep proved it had zero callers.
- [x] Removed unused `VaultRepo.mutate()` after grep proved it had zero real callers.
- [x] Renamed `refreshVisitDerivedAuthUi()` to `refreshAuthSnapshotUi()` as a local mechanical cleanup.
- [x] No Phase 2 cleanup, cache invalidation centralization, auth UI change, write-logic change, or ownership move was included.

1C.2 verification:

- [x] `node --check services/authService.js repos/VaultRepo.js`
- [x] `rg "handleVisitedPlacesSync\\(" services modules renderers repos engines 2>/dev/null || true`
- [x] `rg "userVisitedPlaces" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- [x] `rg "__legacyMapView" --glob '!plans/**' --glob '!*.md' --glob '!tests/**'`
- [x] `node tests/phase1c-vault-subscription.test.js`
- [x] `node tests/phase1b-pending-delete-canonical-replacement.test.js`
- [x] `git diff --check`
- [ ] Manual signed-in smoke after 1C.2 cleanup.
- [ ] Automated signed-in Playwright before deployment, or accepted manual substitute before release.

## Deferred Out Of Phase 1

- Centralizing all visited-id cache invalidation through `VaultRepo.subscribe()` is deferred to Phase 1.5 or Phase 2. Keep the manual `invalidateVisitedIdsCache()` calls during Phase 1.
