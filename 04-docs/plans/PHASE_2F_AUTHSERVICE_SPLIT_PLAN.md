# Phase 2F AuthService Split Plan

Date: 2026-05-01

Status: **2F.2 implemented** on 2026-05-01. Manual smoke is pending.

## Summary

Phase 2F reduces `services/authService.js` responsibility without changing auth/session behavior. The first implementation is a tiny move-only extraction of premium gating UI logic. It does not move the auth listener, the broad `users/{uid}` snapshot, Firestore writes, settings hydration, leaderboard behavior, expedition behavior, login/logout UI behavior, or runtime reset semantics.

## Implementation Status

Phase 2F.2 extracted the premium gating DOM logic into `services/authPremiumUi.js`.

Runtime files changed:

- `services/authPremiumUi.js`
- `services/authService.js`
- `index.html`

Docs changed:

- `plans/PHASE_2F_AUTHSERVICE_SPLIT_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- `plans/PHASE_1_PROGRESS.md`

Exact helper extracted:

- `window.BARK.authPremiumUi.applyPremiumGating(isLoggedIn)`

`services/authService.js` keeps a tiny `handlePremiumGating(isLoggedIn)` wrapper, so the signed-in and signed-out call sites and call order remain unchanged.

Behavior preserved:

- `premium-filters-wrap` still toggles `premium-locked` / `premium-unlocked`.
- `visited-filter` still enables when signed in and disables/resets to `all` when signed out.
- `map-style-select` still enables when signed in and disables/resets to `default` when signed out.
- `toggle-virtual-trail` and `toggle-completed-trails` still enable with `aria-disabled="false"` when signed in.
- Trail buttons still remove `active`, disable, and set `aria-disabled="true"` when signed out.

Runtime categories intentionally left alone:

- Auth/session behavior.
- `onAuthStateChanged` semantics.
- Broad `users/{uid}` snapshot behavior.
- Cloud settings hydration.
- Walk points/streak.
- Expedition sync.
- Leaderboard behavior.
- Saved routes.
- Logout/reset behavior.
- Firestore writes.
- `VaultRepo`.
- `RefreshCoordinator`.

Pre-2F inventory line count:

```sh
wc -l services/authService.js
# 843 services/authService.js
```

Post-2F.2 line count:

```sh
wc -l services/authService.js services/authPremiumUi.js
# 813 services/authService.js
#  47 services/authPremiumUi.js
```

Inventory command run:

```sh
rg -n "function |const |let |onAuthStateChanged|onSnapshot|handleCloudSettings|handleAdmin|handleExpedition|premium|leaderboard|walkPoints|streak|logout|reset" services/authService.js
```

## Current AuthService Responsibility Map

| Responsibility | Current code | Runtime role | Coupling notes |
|---|---|---|---|
| Auth/session lifecycle | `initFirebase()`, `firebase.initializeApp()`, `firebase.auth().onAuthStateChanged()`, Google sign-in button, logout button, `authenticatedSessionSeen`, `lastAuthenticatedUid` | Owns Firebase auth initialization, login/logout listener, sign-in popup, sign-out button, signed-in/signed-out branches | Must stay in `authService` for 2F. Highest blast radius. |
| Broad `users/{uid}` snapshot | `userSnapshotUnsubscribe`, `stopUserSnapshotSubscription()`, `onSnapshot()` in `initFirebase()` | Listens to the broad user document for non-visit fields | Do not move yet. Snapshot metadata and stale-user guard must remain unchanged. |
| Visit subscription wiring | `startVaultRepoVisitSubscription()`, `stopVaultRepoVisitSubscription()`, `buildVaultRepoSubscriptionOptions()` | Starts/stops `VaultRepo` visitedPlaces subscription and injects refresh/canonicalization callbacks | Do not move in 2F; `VaultRepo` ownership remains unchanged. |
| Cloud settings hydration | `handleCloudSettingsHydration()`, `getCloudSettingsRevision()`, `syncCloudSettingsControls()`, setting DOM helpers, `_cloudSettingsLoaded`, `_lastAppliedCloudSettingsRevision`, `_savingCloudSettingsRevision`, `_pendingLocalSettingsChanges`, `isHydratingCloudSettings` | Applies cloud settings into settings store, localStorage, map style/filter, global style/performance policy | High coupling with settings store, localStorage, map layer, and revision/race guards. |
| Admin check | `handleAdminCheck()`, `resetAdminUi()`, `window.isAdmin` | Sets admin global and renders/clears admin controls | Small but auth-owned permission state; low data risk, medium UI permission risk. |
| Walk points/streak hydration | Inline broad snapshot block for `streakCount`, `walkPoints`, `lifetime_miles`, `currentWalkPoints`, `streak-count-label` | Hydrates progress labels and score globals; backfills walkPoints from lifetime miles | Contains Firestore write-back, profile/stat coupling, and global score state. |
| Expedition sync | `handleExpeditionSync()`, reset via `window.BARK.resetExpeditionRuntimeState()` | Hydrates active/completed expedition UI and overlays from user data | Touches expedition DOM, trail overlays, education modal, completion UI. |
| Leaderboard trigger | `_leaderboardLoadedOnce`, `window.BARK.loadLeaderboard()` | Loads leaderboard after first broad snapshot and on signed-out branch | Profile/leaderboard timing; do not move with auth cleanup. |
| Premium gating | `handlePremiumGating(isLoggedIn)` | Locks/unlocks premium filters, map style select, and expedition trail buttons based on signed-in state | DOM-only, no Firestore, no snapshot semantics. Best first extraction candidate if move-only. |
| Logout/reset runtime cleanup | `resetLoggedOutRuntimeState()` and helpers: settings reset, map style reset, search/filter reset, visited/panel reset, saved route reset, map view reset, guest marker restore | Clears signed-in runtime state after logout or no-session path | Crosses settings, map, search, visit, trip, expedition, profile stats, and marker rendering. |
| Active pin/auth UI refresh | `refreshActivePinVisitedButton()`, `refreshAuthSnapshotUi()` | Refreshes active pin button, marker/state heartbeat, stats UI after snapshots | Tied to visit state, panel DOM, stats timing. |
| Saved routes loading/reset | `loadSavedRoutes(user.uid)`, `resetSavedRouteLists()` | Loads signed-in saved routes and clears route lists on logout/no-session | Route UI coupling; safe only as later focused extraction. |
| Error handling | `showAuthFailureNotice()` and many catch blocks | Logs auth/snapshot/setup failures, surfaces failure notice, dismisses loader | Small, but changing it can hide auth failures or loader dismissal. |

## Risk Ranking

Risk criteria:

- User data risk.
- Auth/session risk.
- UI breakage risk.
- Number of files touched.
- Whether Firestore snapshot semantics could change.

| Candidate extraction | Rank | Why |
|---|---|---|
| Premium gating UI helper | LOW | DOM-only signed-in/signed-out control locking. No Firestore writes, no snapshot fields, no auth listener movement. Main risk is visual/disabled-state regression. |
| Error notice helper | LOW | Small wrapper around existing failure notice and loader dismissal. Low data risk, but little responsibility reduction. |
| Admin UI rendering helper | LOW-MEDIUM | Small DOM rendering, but depends on `window.isAdmin` permission state and must not misrepresent admin access. |
| Saved route list reset helper | LOW-MEDIUM | DOM-only reset, but coupled to route UI and signed-out state. Good later candidate after premium gating smoke. |
| Active pin visited button helper | MEDIUM | Small DOM update, but coupled to live marker selection and visit-state query behavior. |
| Logout/reset helper module | MEDIUM-HIGH | Many domains: settings, map, search, visits, trip planner, expedition, route lists, stats, marker restore. Too broad for first 2F. |
| Expedition sync helper | MEDIUM-HIGH | UI-only in broad terms, but touches expedition overlays, education modal, completion/claim UI, and trail history. |
| Cloud settings hydration helper | HIGH | Revision guards and pending-save semantics can overwrite settings if changed. Crosses localStorage, settings store, map style/filter, and performance policy. |
| Walk points/streak hydration helper | HIGH | Includes score globals, DOM labels, Firestore backfill write, profile/leaderboard side effects. |
| Broad user snapshot extraction | HIGH | Could alter `users/{uid}` snapshot timing, metadata handling, stale-user guard, first-server-payload flags, and downstream UI refresh. |
| Auth listener extraction | HIGH | Direct auth/session lifecycle semantics; explicitly out of scope. |
| Leaderboard trigger extraction | HIGH | Auth/profile timing and `_leaderboardLoadedOnce` behavior; defer. |

## Recommended First Extraction

Pick exactly one first implementation target:

**2F.2: Extract premium gating UI helper.**

Implemented shape:

- Create `services/authPremiumUi.js`.
- Export through a small namespace, for example:

```js
window.BARK.authPremiumUi = {
    applyPremiumGating
};
```

- Move the current `handlePremiumGating(isLoggedIn)` DOM logic into `applyPremiumGating(isLoggedIn)`.
- Keep `authService` call sites exactly where they are:
  - after successful signed-in setup, call with `true`.
  - after signed-out/no-session cleanup, call with `false`.
- Keep a tiny `handlePremiumGating(isLoggedIn)` wrapper in `authService`.
- In the classic-script app, add the new script before `services/authService.js` in `index.html`.

Why this is safest:

- It does not change `onAuthStateChanged` branches.
- It does not touch the broad user snapshot.
- It does not touch Firestore.
- It does not touch `VaultRepo`.
- It does not touch cloud settings revision logic.
- It does not touch walk points, streak, expedition, leaderboard, or saved route loading.
- It has one visible manual smoke surface: premium controls locked while signed out and unlocked while signed in.

Do not choose cloud settings hydration as the first extraction. It looks modular by function name, but its revision guards and pending local change checks are data-protection logic.

Do not choose logout reset as the first extraction. It crosses too many runtime domains.

## Proposed PR Breakdown

### 2F.1 - Plan / Baseline

Status: complete.

Scope:

- Record authService responsibility inventory.
- Rank extraction candidates.
- Choose one first candidate.
- No runtime changes.

Baseline commands before any implementation:

```sh
node --check services/authService.js
git diff --check
```

### 2F.2 - Extract Premium Gating Helper

Status: implemented; manual smoke pending.

Scope:

- Add `services/authPremiumUi.js`.
- Add a script tag in `index.html` before `services/authService.js`.
- Move only the premium gating DOM logic out of `services/authService.js`.
- Preserve the same DOM IDs, class changes, disabled states, select values, and `aria-disabled` values.
- Preserve the same call order in the signed-in and signed-out branches.

Expected runtime files:

- `services/authPremiumUi.js`
- `services/authService.js`
- `index.html`

Expected docs:

- `plans/PHASE_2F_AUTHSERVICE_SPLIT_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- optionally `plans/PHASE_1_PROGRESS.md`

### 2F.3 - Optional Second Helper After Smoke

Only after 2F.2 manual smoke passes, consider one of:

- Admin UI rendering helper.
- Saved route list reset helper.
- Error notice helper.

Do not combine 2F.2 and 2F.3 in one PR.

## Stop Lines

- Do not change `onAuthStateChanged` semantics.
- Do not change `users/{uid}` snapshot fields.
- Do not change login/logout UI behavior.
- Do not change cloud settings revision logic unless specifically scoped.
- Do not change walk points/streak behavior.
- Do not change expedition behavior.
- Do not change leaderboard behavior.
- Do not change Firestore writes.
- Do not change `VaultRepo` ownership.
- Do not deploy.
- Do not split multiple domains in one PR.

## Verification Plan

Static verification for 2F.2:

```sh
node --check services/authService.js services/authPremiumUi.js
git diff --check
```

If `index.html` changes, inspect script order manually and confirm the new helper loads before `services/authService.js`.

Static verification status:

- `node --check services/authPremiumUi.js services/authService.js`: PASS
- `rg "handlePremiumGating|authPremiumUi|premium-filters-wrap|premium-locked|premium-unlocked" services/authService.js services/authPremiumUi.js index.html`: PASS
- `git diff --check`: PASS
- Script order inspected: `services/authPremiumUi.js?v=1` loads before `services/authService.js?v=19`.

Manual verification:

- Boot app.
- Sign in.
- Confirm cloud settings load.
- Confirm premium controls show/unlock correctly while signed in.
- Confirm admin controls still correct if applicable.
- Confirm walk points/streak display.
- Confirm expedition UI still correct.
- Sign out.
- Confirm premium controls lock and reset to signed-out defaults.
- Confirm runtime clears as before.
- Sign in again.
- Confirm state restores.
- Confirm console has no red errors.

Manual smoke status: **PENDING**.

## Expected Files For First Implementation

Runtime:

- `services/authPremiumUi.js`
- `services/authService.js`
- `index.html`

Docs:

- `plans/PHASE_2F_AUTHSERVICE_SPLIT_PLAN.md`
- `plans/PHASE_2_GLOBAL_INVENTORY.md`
- optionally `plans/PHASE_1_PROGRESS.md`

No expected changes:

- `services/firebaseService.js`
- `services/checkinService.js`
- `repos/VaultRepo.js`
- `modules/RefreshCoordinator.js`
- `modules/settingsController.js`
- `modules/profileEngine.js`
- expedition modules
- tests

## Final Readiness

Phase 2F.1 status: **complete**.

Phase 2F.2 status: **complete for code/static verification; manual smoke pending**.

Ready to start Phase 2F.3: **NO**.

Ready to extract cloud settings, broad snapshot ownership, auth listener, walk points/streak, expedition, leaderboard, or logout reset: **NO**.
