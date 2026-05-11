# Phase 3B Profile / Leaderboard Split Plan

Date: 2026-05-01

Status: 3B.2 implemented. The first extraction moved pure leaderboard rank/row presentation helpers only. No Firestore behavior, score calculation, achievement logic, auth/session behavior, settings, trip planner, premium gating, VaultRepo, RefreshCoordinator, tests, or deployment changes were made.

## Evidence

Inventory commands run:

```sh
rg -n "function |async function |loadLeaderboard|syncScoreToLeaderboard|evaluateAchievements|renderManagePortal|updateStatsUI|renderLeaderboard|loadMoreLeaderboard|leaderboard|achievement|rank|title|firebase|Firestore|collection\\(" modules/profileEngine.js
wc -l modules/profileEngine.js
```

Original size at 3B.1:

```text
828 modules/profileEngine.js
```

Size after 3B.2:

```text
774 modules/profileEngine.js
 92 renderers/leaderboardRenderer.js
```

High-level layout found:

| Area | Approx lines | Notes |
|---|---:|---|
| Repo/visit helpers | 7-40 | Reads `ParkRepo` and `VaultRepo`; normalizes visit arrays/counts. |
| Manage portal rendering | 43-130 | Builds manage list, remove button, date input, update button. |
| Leaderboard sync/write helpers | 134-239 | Reads Firebase auth, writes `users/{uid}` and `leaderboard/{uid}`. |
| Achievement evaluation/rendering | 242-480 | Calls gamification engine, updates rank/title, renders badge HTML, syncs score. |
| Stats UI | 483-543 | Calculates visit score, updates stat DOM, calls manage portal render. |
| Leaderboard rank/render helpers | 549-695 | Formats ranks, builds fallback row data, renders leaderboard rows and controls. |
| Leaderboard queries/pagination | 696-786 | Firestore leaderboard query, REST aggregate rank lookup, load more. |
| Rank-up celebration | 789-828 | Modal/confetti UI after title change. |

## 1. Current Responsibility Map

| Responsibility | Current owner | Coupling | Risk notes |
|---|---|---|---|
| Manage portal rendering | `profileEngine.js` | `VaultRepo`, `window.BARK.removeVisitedPlace`, `window.BARK.updateVisitDate`, direct DOM | Covered by Phase 3A.3 smoke, but remove/date actions are user data mutations. |
| Visit stats rendering | `profileEngine.js` | `VaultRepo`, `ParkRepo`, `window.BARK.calculateVisitScore`, direct DOM | Low data risk, medium UI risk because stats are visible profile surface. |
| Achievement evaluation/rendering | `profileEngine.js` plus `window.gamificationEngine` | Firebase auth uid, `currentWalkPoints`, rank/title DOM, badge DOM, score sync | High risk; mixes data evaluation, persistence side effects, and large HTML render blocks. |
| Score calculation usage | `profileEngine.js` calls `window.BARK.calculateVisitScore` | Visit array, walk points, leaderboard sync | Medium-high because score feeds rank and leaderboard writes. |
| Score sync to leaderboard | `syncScoreToLeaderboard()` in `profileEngine.js` | Firebase auth, Firestore `users` and `leaderboard` writes, cached leaderboard data | High risk; direct user data writes and debounce state. |
| Leaderboard loading | `loadLeaderboard()` in `profileEngine.js` | Firestore query, REST aggregate rank lookup, local fallback row | High risk; query semantics and exact-rank behavior are user-visible. |
| Leaderboard rendering | `renderLeaderboard()` in `profileEngine.js` | Direct DOM, current Firebase uid, cached data, `loadMoreLeaderboard` callback | Medium risk; no writes, but ranking display and self-row behavior are sensitive. |
| Leaderboard pagination | `loadMoreLeaderboard()` in `profileEngine.js` | Firestore cursor, cached data, REST aggregate fallback | High risk; easy to break cursor/personal fallback behavior. |
| Rank/title UI | `evaluateAchievements()` and `showRankUpCelebration()` | Auth hydration flags, `_lastKnownRank`, title DOM, modal DOM | High risk; tied to auth hydration guard and achievement unlock timing. |
| Firestore reads/writes | `syncScoreToLeaderboard()`, `loadLeaderboard()`, `loadMoreLeaderboard()` | Firebase SDK, REST aggregation endpoint, request counter | High risk; do not move until leaderboard-specific coverage exists. |
| DOM helpers/utilities | Inline helpers inside profileEngine | Direct DOM creation, HTML strings, rank/date formatting | Mixed risk; pure formatting/render helpers are good extraction candidates. |

## 2. Risk Ranking

Criteria used:

- User data risk: could the change alter visits, score, settings, profile, or leaderboard records?
- Firestore write risk: could it change writes to `users/{uid}` or `leaderboard/{uid}`?
- UI breakage risk: could visible profile/manage/leaderboard output regress?
- Leaderboard/rank behavior risk: could it alter ranking, pagination, title, or exact-rank fallback?
- Number of files touched: fewer is safer.
- Existing smoke coverage: Phase 3A profile/manage and full smoke coverage lower risk; leaderboard-specific coverage is still thin.

| Candidate | Risk | Why |
|---|---|---|
| Extract pure leaderboard rank formatting and row DOM helper | LOW | No Firestore, no query semantics, no score math, no data shape change. UI-only. Needs manual/automated leaderboard check because current smoke does not assert leaderboard rows. |
| Extract pure stat formatting helper | LOW | Small and visible; no writes. Less valuable for profile/leaderboard separation than row rendering. |
| Extract date formatting helper for manage portal | LOW | Tiny pure helper. Existing profile/manage smoke covers date input presence, but extraction impact is small. |
| Extract full manage portal renderer | MEDIUM | Phase 3A.3 covers it, but remove/date actions call mutation APIs. Could break cleanup flow. |
| Extract full `renderLeaderboard()` body | MEDIUM | No Firestore writes, but includes personal rank, pinned fallback row, show-more button callback, and current-user highlighting. |
| Extract `updateStatsUI()` | MEDIUM | Stats are visible and call `renderManagePortal()`. Score display regressions would be user-facing. |
| Extract `showRankUpCelebration()` | MEDIUM | UI-only but tied to rank/title timing and modal cleanup. |
| Extract `loadLeaderboard()` or `loadMoreLeaderboard()` | HIGH | Firestore reads, cursors, REST aggregation, exact-rank fallback, and cached data all interact. |
| Extract `syncScoreToLeaderboard()` | HIGH | Writes to user and leaderboard docs. Do not touch first. |
| Extract `evaluateAchievements()` | HIGH | Achievement unlock logic, rank/title UI, score sync, badge rendering, and auth hydration guard are tangled. |

## 3. Recommended First Extraction

Pick exactly one first target:

**3B.2 should extract the pure leaderboard rank/row renderer helper.**

Proposed boundary:

- New helper module: `renderers/leaderboardRenderer.js` or `modules/leaderboardRenderer.js`.
- Expose a small namespace such as `window.BARK.leaderboardRenderer`.
- Move only pure display helpers:
  - `getSafeLeaderboardRank(rank)`
  - `formatLeaderboardRank(rank)`
  - row style/rank-icon selection
  - `createLeaderboardRow({ user, rank, currentUid, isPinnedSelf, previousUser })`
- Keep these in `profileEngine.js` for now:
  - `cachedLeaderboardData`
  - `renderLeaderboard()` orchestration
  - DOM target lookup for `#leaderboard-list`, `#personal-rank-display`, `#leaderboard-controls`
  - show-more button creation and `loadMoreLeaderboard` callback
  - Firebase uid lookup if needed by orchestration
  - all Firestore reads/writes
  - exact-rank fallback construction

Why this is the safest first extraction:

- It removes real leaderboard presentation responsibility from `profileEngine.js`.
- It does not change data shape.
- It does not change Firestore reads or writes.
- It does not change score calculation, achievements, rank computation, pagination, auth, or session behavior.
- It should require only a script-order addition plus one call-site update.

Expected implementation files for 3B.2:

- `renderers/leaderboardRenderer.js` or `modules/leaderboardRenderer.js`
- `modules/profileEngine.js`
- `index.html` to load the helper before `profileEngine.js`
- Optional plan/status docs

Do not move `parseLeaderboardRankCount()` in 3B.2. It is pure-looking, but it belongs to the REST aggregate query path, so moving it with display helpers would blur the first slice.

## 4. Proposed PR Breakdown

### 3B.1 - Plan Only

This document.

Rules:

- No runtime code.
- No tests.
- No deployment.

Verification:

- Inventory commands above.
- `git diff --check`.

### 3B.2 - Extract One Pure Leaderboard Rendering Helper

Status: implemented.

Goal:

- Move only pure leaderboard row/rank display helper logic out of `profileEngine.js`.

Allowed behavior:

- Output DOM should be byte-for-byte or visually equivalent.
- `profileEngine.renderLeaderboard()` still owns data orchestration and DOM insertion.

Not allowed:

- No Firestore query changes.
- No score sync changes.
- No pagination changes.
- No exact-rank fallback changes.
- No auth/session changes.

Minimum verification:

```sh
node --check renderers/leaderboardRenderer.js modules/profileEngine.js
npm run test:e2e:profile-manage
npm run test:e2e:smoke
git diff --check
```

Because this is leaderboard-specific, also run one of:

- Manual signed-in leaderboard check: open Profile, verify leaderboard renders, personal rank text renders, current user highlighting/fallback row still looks correct, and Show More still works if present.
- Or add a focused leaderboard smoke before expanding further extraction.

3B.2 implementation summary:

- Added `renderers/leaderboardRenderer.js`.
- Exported `window.BARK.leaderboardRenderer`.
- Moved display-only helpers:
  - `getSafeLeaderboardRank(rank)`
  - `formatLeaderboardRank(rank)`
  - leaderboard row DOM creation
  - row rank icon/style selection
  - score-pill/rivalry-pill presentation logic
- Updated `modules/profileEngine.js` to call `leaderboardRenderer` for personal rank formatting and row creation.
- Added `renderers/leaderboardRenderer.js?v=1` to `index.html` before `modules/profileEngine.js`.
- Bumped `modules/profileEngine.js` cache bust from `v=4` to `v=5`.

Intentionally kept in `profileEngine.js`:

- `cachedLeaderboardData`
- `buildPersonalLeaderboardFallback()`
- `parseLeaderboardRankCount()`
- `renderLeaderboard()` orchestration
- `loadLeaderboard()`
- `loadMoreLeaderboard()`
- `syncScoreToLeaderboard()`
- `evaluateAchievements()`
- `updateStatsUI()`
- Firestore reads/writes
- Firebase auth uid lookup
- leaderboard controls/show-more button creation
- exact-rank fallback construction
- personal rank display orchestration

3B.2 verification:

```sh
node --check renderers/leaderboardRenderer.js modules/profileEngine.js
BARK_E2E_BASE_URL=http://localhost:4173/index.html BARK_E2E_STORAGE_STATE="$PWD/node_modules/.cache/bark-e2e/storage-state.json" npm run test:e2e:profile-manage
BARK_E2E_BASE_URL=http://localhost:4173/index.html BARK_E2E_STORAGE_STATE="$PWD/node_modules/.cache/bark-e2e/storage-state.json" BARK_E2E_STORAGE_STATE_B="$PWD/node_modules/.cache/bark-e2e/storage-state-b.json" npm run test:e2e:smoke
```

Results:

- `node --check`: PASS.
- `npm run test:e2e:profile-manage`: PASS, 1 passed.
- `npm run test:e2e:smoke`: PASS on rerun, 9 passed.
- First full-bundle run had a transient settings-persistence timeout unrelated to leaderboard code; focused `npm run test:e2e:settings` passed immediately afterward, and the full bundle passed on rerun.

Manual leaderboard check:

- PASS via signed-in Playwright browser session.
- Profile opened successfully.
- `#leaderboard-list` rendered 6 rows before Show More.
- `#personal-rank-display` rendered `Rank: 17`.
- Current-user fallback row rendered as `You 0 PTS`.
- `#lb-load-more-btn` was present; clicking it loaded safely and row count increased to 11.
- No relevant console/page errors for `profileEngine`, `leaderboardRenderer`, leaderboard, rank, Firebase, Firestore, or score sync.

### 3B.3 - Add Or Expand Leaderboard Smoke If Needed

Goal:

- Add automated coverage only if 3B.2 exposes a gap or if we plan to extract more than row rendering.

Potential smoke scope:

- Open signed-in profile view.
- Confirm `#leaderboard-list` renders either rows or the empty-state message.
- Confirm `#personal-rank-display` renders a rank label.
- If `#lb-load-more-btn` is present, click it and confirm no relevant console errors.

Avoid:

- Do not assert exact global leaderboard rank.
- Do not depend on exact leaderboard population.
- Do not write leaderboard data directly.

### 3B.4 - Extract Leaderboard Data Query/Service Later

Only after leaderboard-specific coverage exists and passes.

Potential target:

- `loadLeaderboard()` and `loadMoreLeaderboard()` into a leaderboard service/query module.

Risks to address before 3B.4:

- Firestore cursor behavior.
- REST aggregate rank fallback.
- Personal fallback row semantics.
- Cached leaderboard data dedupe.
- Auth state and request counter behavior.

## 5. Required Tests Before Implementation

Before implementing 3B.2:

```sh
npm run test:e2e:profile-manage
npm run test:e2e:smoke
```

For 3B.2 specifically:

```sh
node --check <new-helper-file> modules/profileEngine.js
npm run test:e2e:profile-manage
npm run test:e2e:smoke
git diff --check
```

Manual leaderboard check is required unless a leaderboard smoke is added first:

- Sign in using the Firebase Email/Password E2E storage state.
- Open Profile.
- Confirm leaderboard list or empty state renders.
- Confirm personal rank display renders.
- Confirm current user row/fallback styling still makes sense if present.
- Confirm Show More still loads or disappears safely if present.
- Confirm no console errors related to `profileEngine`, leaderboard, rank, Firebase, Firestore, or score sync.

Existing Phase 3A smoke coverage remains required:

- `npm run test:e2e:profile-manage`
- `npm run test:e2e:smoke`

## 6. Stop Lines

- Do not change Firestore writes.
- Do not change score calculation.
- Do not change achievement unlock logic.
- Do not change leaderboard query semantics.
- Do not change exact-rank fallback semantics.
- Do not change leaderboard pagination semantics.
- Do not change auth/session.
- Do not change settings, trip planner, or premium gating code.
- Do not deploy.
- Do not combine profile split with settings/auth/trip split.
- Do not move `syncScoreToLeaderboard()` in the same PR as renderer extraction.
- Do not move `loadLeaderboard()` or `loadMoreLeaderboard()` until leaderboard-specific smoke/manual validation exists.

## 7. Final Recommendation

First extraction:

- Extract the pure leaderboard rank/row renderer helper.

Why it is safe:

- It is presentation-only.
- It does not write to Firestore.
- It does not alter score calculation, achievement unlocks, rank computation, pagination, auth, or data shape.
- It leaves `profileEngine.js` in charge of data orchestration while reducing its DOM-rendering load.

Files 3B.2 would touch:

- `renderers/leaderboardRenderer.js` or `modules/leaderboardRenderer.js`
- `modules/profileEngine.js`
- `index.html`
- Optional docs

Tests that must pass:

- `node --check` on the new helper and `modules/profileEngine.js`
- `npm run test:e2e:profile-manage`
- `npm run test:e2e:smoke`
- `git diff --check`
- Manual leaderboard check, unless a focused leaderboard smoke is added first

Ready to implement Phase 3B.2?

DONE. Next implementation work should be Phase 3B.3 only if additional leaderboard smoke coverage is explicitly requested, or Phase 3B.4 only after leaderboard-specific coverage exists.
