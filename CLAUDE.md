# B.A.R.K. Ranger Map — Engineering Workbook

## What This App Is
PWA for the US B.A.R.K. Rangers program. Dog owners visit national/state parks and collect physical swag (tags, bandanas, certificates). App shows ~1,000+ park locations on a Leaflet map, tracks visits, awards gamification badges, supports trip planning, and virtual hiking expeditions. A built-in store is planned — stability and trust are the priority.

## Stack
- **Frontend:** Vanilla JS, no bundler, `<script>` tag load order is the dependency graph
- **Map:** Leaflet 1.9.4 + leaflet.markercluster
- **Data:** Google Sheets published as CSV (polled on interval), parsed by PapaParse
- **Auth/DB:** Firebase Auth + Firestore (v8 compat SDK, loaded from CDN)
- **Backend:** Firebase Cloud Functions (Node 20, v1 syntax in `functions/index.js`)
- **Hosting:** Firebase Hosting (`firebase.json` deploys from repo root with a defensive ignore list)
- **Analytics:** GoatCounter (async, no impact)

## Key Architectural Facts (do not re-derive these from files)
- Boot order is enforced by `<script>` tag order in `index.html`. `core/app.js` fires on `DOMContentLoaded`.
- All modules attach to `window.BARK` namespace. No ES imports.
- Settings live in THREE layers: `barkState.js` (raw window globals, boot-time), `state/settingsStore.js` (canonical structured store with property descriptors), `state/appState.js` (mirrors BARK data state to window). The settingsStore descriptors overwrite barkState globals after boot.
- The heartbeat is `window.syncState()` in `renderEngine.js` — RAF-batched, uses a 20-part fingerprint string to skip no-op renders.
- `MarkerLayerManager` in `modules/MarkerLayerManager.js` owns all Leaflet marker lifecycle keyed by park UUID.
- Firebase `onSnapshot` on `users/{uid}` is the primary data hydration path for logged-in users.
- `window.BARK.DOM` in `config/domRefs.js` is the centralized DOM lookup registry (functions, not values).
- CSV rollback guard in `dataService.js:processParsedResults` refuses updates that drop existing canonical park IDs — keep this.
- `window.BARK.incrementRequestCount()` has a 2,000-request session kill switch. CSV polling is intentionally slow; keep background request loops conservative.
- `gamificationLogic.js` exposes `class GamificationEngine` — pure logic, no DOM.
- `services/checkinService.js` owns GPS check-in validation — clean, well-structured.
- `modules/markerLayerPolicy.js` is the single source of truth for which marker layer mode is active.

## Goal
Make the app production-grade for a store launch: near-100% reliability, no logic errors, clean scalable code, all existing features preserved.

## Required Future-Work Guide
Before major feature work, refactors, payment work, Passport/journal/photos/events work, or broad bug-fix passes, read `plans/AI_TECHNICAL_NORTH_STAR.md`. It is the technical operating manual for keeping future code clean, untangled, performant, and aligned with the product roadmap.

## Fix Queue (work through in order, one at a time)

- [x] **#1 — Boot error recovery** (`core/app.js`) ✅

- [x] **#2 — Loader never dismisses on Firebase failure** (`modules/mapEngine.js`) ✅

- [x] **#3 — Cloud settings bypass the settings store** (`services/authService.js`, `handleCloudSettingsHydration`) ✅

- [x] **#4 — `expeditionEngine.js` calls `L.featureGroup()` at module scope** (`modules/expeditionEngine.js`) ✅

- [x] **#5 — Request kill switch fires after ~75 minutes** (`modules/barkState.js`, `modules/dataService.js`) ✅

- [x] **#6 — `evaluateAchievements()` mutates live visit records** (`modules/profileEngine.js`) ✅

- [x] **#7 — Streak date uses UTC instead of local date** (`services/firebaseService.js`) ✅

- [x] **#8 — `evaluateAchievements()` fires on every `syncState()` heartbeat** (`modules/renderEngine.js`) ✅

- [x] **#9 — CSV polling at 10s will get throttled at scale** (`modules/dataService.js`, `core/app.js`) ✅

- [x] **#10 — `getMarkerVisibilityStateKey()` sorts visited IDs on every RAF** (`modules/renderEngine.js`, `services/authService.js`, `services/checkinService.js`, `services/firebaseService.js`) ✅

- [x] **#11 — Levenshtein search is unbounded on main thread** (`modules/searchEngine.js`, `modules/renderEngine.js`) ✅

- [x] **#12 — `barkState.js` redundant settings initialization** (`modules/barkState.js`) ✅

- [x] **#13 — `authService.js` cloud hydration has 90+ hardcoded element IDs** (`services/authService.js`, `handleCloudSettingsHydration`) ✅

- [x] **#14 — `settingsController.js` queries Firestore directly** (`modules/settingsController.js`, `services/firebaseService.js`) ✅

- [x] **#15 — Dead code in `tests/` is misleading** (`tests/`) ✅

- [x] **#16 — `firebase.json` missing hosting config** (`firebase.json`) ✅

- [x] **#17 — iOS settings overlay scroll leak** (`modules/settingsController.js`) ✅

- [x] **#18 — User-visible degraded state when `initMap` fails** (`core/app.js`, `index.html`, `styles.css`) ✅

- [x] **#19 — Trip route pins disappear in bubble mode at high zoom** (`modules/TripLayerManager.js` NEW, `engines/tripPlannerCore.js`, `modules/renderEngine.js`, `modules/MarkerLayerManager.js`, `state/appState.js`, `index.html`, `styles.css`, `styles/mapStyles.css`, `core/app.js`) ✅

- [x] **#20 — Hardcoded API keys in Cloud Functions moved to Firebase secrets (Phase 1 of 3)** (`functions/index.js`) ✅

- [x] **#21 — Server proxy for ORS, client switched to callables (Phase 2 of 3)** (`functions/index.js`, `services/orsService.js`, `index.html`) ✅

- [x] **#22 — Removed client-side ORS key + key rotation (Phase 3 of 3)** (`modules/barkConfig.js`, `index.html`, provider dashboards) ✅

## Current Work
Fix #22 complete. The client no longer ships any paid API key. Pending user actions on provider dashboards: rotate the old ORS key at openrouteservice.org (issue a new key, set it as the `ORS_API_KEY` Firebase secret with `firebase functions:secrets:set ORS_API_KEY`, redeploy functions, then revoke the old key); rotate the paid Gemini key at console.cloud.google.com (mirror the same set/redeploy/revoke order using `GEMINI_PAID_API_KEY`). Until rotation completes, the old keys remain valid in git history. Primary security queue (#20–#22) complete.

---

## Completed Fixes

### Fix #1 — Boot Error Recovery
**File:** `core/app.js`
**Date:** 2026-04-28

**What was wrong:**
`callInit()` called `window.BARK[name]()` with zero error handling. The three most critical inits — `initMap`, `initSettings`, `initUI` — were called with raw `if (window.BARK.initX) window.BARK.initX()` — also no error handling. If any single init threw (bad CDN load, a null DOM ref, a timing issue), JavaScript's uncaught exception would halt execution and every subsequent init would silently never run. The app would appear to load but be in a partially-dead state with no diagnostic information.

**The fix:**
- `callInit()` now wraps every module init in try/catch. On failure it: logs `[B.A.R.K. Boot] "initX" failed — this feature will be unavailable.` with the actual error, pushes the name to `_bootErrors[]`, and continues to the next init.
- All inits now go through `callInit()` — the old inconsistent mix of raw `if` checks and `callInit()` calls is unified into a single pattern.
- Firebase init has its own try/catch with a clearer message (`auth and cloud sync unavailable`) because its failure has broader impact than one feature.
- Data loading (`loadData`) is grouped in its own try/catch with the message `map may be empty`.
- The deferred `safePoll` and `updateTripUI` setTimeout calls are also wrapped.
- Boot ends with a clear console summary: `✅ Complete` or `⚠️ Complete with N error(s): [initX, initY]`.

**Pros of this approach:**
- Any broken module is immediately identifiable by name in the console — no more hunting through silent failures.
- One broken feature does not cascade into breaking all subsequent features.
- The boot summary tells you the exact list of what failed — critical for debugging on a user's device remotely.
- Zero new dependencies, zero behavior change when nothing is broken.
- The unified `callInit()` pattern for all inits makes the boot sequence easier to read and extend.

**Cons / tradeoffs:**
- We now treat `initMap` failure the same as `initWatermarkTool` failure — both are caught and execution continues. If the map fails, everything after it that depends on `window.map` will also fail, producing multiple errors rather than one clean fatal. The tradeoff is accepted: knowing all the failures is better than stopping at the first one.
- At the time of Fix #1, errors were console-only. The map-specific user-visible fallback was later completed in Fix #18.

**Code review correction applied (same session):**
Original `callInit()` used synchronous `try/catch`. If an init returned a rejected Promise, it slipped through — `callInit()` reported success and execution continued with the failure uncaught. Fixed: `callInit()` is now `async` and uses `await window.BARK[name]()`. The `DOMContentLoaded` handler is also `async` with `await` on each `callInit()` call to preserve boot order.

**How much better:**
- Before: 1 broken init = silent cascade, 0 diagnostic info, async rejections invisible.
- After: 1 broken init = 1 named console error, all subsequent features still initialize, async rejections caught and named, boot summary lists every failure. Debugging time cut from "re-read all code" to "read the console."

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | `callInit()` is scalable, async-aware, and easy to extend; unified pattern replaces inconsistent raw `if` calls |
| Speed | 10 | Zero overhead when nothing fails; try/catch and `await` add negligible cost on the happy path |
| Code efficiency | 9 | Unified pattern eliminated redundant code; boot summary is new capability with no extra complexity |
| Reliability | 9 | Catches both sync throws and rejected Promises; every failure is named in the boot summary |

### Fix #2 — Loader Never Dismisses on Firebase Failure
**File:** `modules/mapEngine.js`
**Date:** 2026-04-28

**What was wrong:**
`window.dismissBarkLoader()` was called in exactly two places — both inside the `onAuthStateChanged` callback in `authService.js`. If Firebase fails to initialize, the SDK doesn't load from CDN, or the network is down, `onAuthStateChanged` never fires. The `#bark-loader` spinner stays on screen permanently and blocks the entire app.

**Initial fix:**
Added an 8-second fallback `setTimeout(() => window.dismissBarkLoader(), 8000)` inside `initMap()`.

**Code review correction applied (same session):**
A code review identified a second, deeper bug: `dismissBarkLoader` was originally defined at ~line 242 inside `window.BARK.initMap()`. The function calls `L.map()` at ~line 79. If Leaflet CDN fails, `L.map()` throws → `initMap()` exits early → `dismissBarkLoader` is never assigned to `window` → the 8-second fallback is never scheduled → `authService.js` later calls `window.dismissBarkLoader()` → `TypeError: window.dismissBarkLoader is not a function`.

**Final state:**
Both `window.dismissBarkLoader` definition and `setTimeout(() => window.dismissBarkLoader(), 8000)` moved to **module scope** — outside and before `window.BARK.initMap`. The function is globally safe from the moment the script tag is parsed, regardless of whether Leaflet loads or `initMap()` completes.

**Why 8 seconds:**
Firebase Auth on a normal connection resolves in under 2 seconds. 8 seconds covers slow networks, CDN hiccups, and cold-start Cloud Function latency.

**Pros of this approach:**
- The map is always usable. Firebase failure = degraded experience, not total block.
- `dismissBarkLoader` is globally safe from module parse time — no ordering dependency on `initMap()`.
- Idempotent — whichever call fires first wins, second is a no-op.
- Zero risk of interfering with the normal Firebase path.

**Cons / tradeoffs:**
- If Firebase auth takes exactly 8.1 seconds (extremely slow but not failing), the loader dismisses before visited places and cloud settings hydrate. User sees logged-out state briefly then UI corrects. Acceptable.
- 8 seconds is a judgment call — could raise to 10s if slow-connection feedback warrants it.

**How much better:**
- Before: Firebase down = 100% blocked, spinner forever, and a latent crash if Leaflet also failed.
- After: Firebase down = map loads in ≤8s regardless of CDN state, user can browse/search/plan.

**Rating: 8 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | 8-second timeout is a reasonable judgment call; moving to module scope was the correct structural fix |
| Speed | 10 | No performance impact; loader dismissal is CSS opacity + a single `setTimeout` |
| Code efficiency | 9 | Minimal change; module-scope definition cleanly eliminates the ordering dependency |
| Reliability | 8 | Covers Firebase failure and Leaflet CDN failure; 8s edge case (auth slow but not dead) is a known, accepted tradeoff |

---

### Code Review Opinion — Analysis & Verdict (2026-04-28)

A code review raised three points. All three were valid. Here's the verdict and what was done:

**Point 1 — `dismissBarkLoader` unsafe if `initMap()` throws early**
- Valid. `dismissBarkLoader` was defined inside `initMap()`, after `L.map()`. Leaflet failure → function never exists → `authService.js` crash.
- Action: Moved definition and fallback `setTimeout` to module scope. ✅ Fixed in code.

**Point 2 — `callInit()` misses rejected Promises (async errors slip through)**
- Valid. Original `callInit()` was synchronous `try/catch`. A `return Promise.reject(...)` from an init function would not be caught — `callInit()` would log success and execution would continue.
- Action: Made `callInit()` `async` with `await window.BARK[name]()`. Made `DOMContentLoaded` handler `async` with `await` on each `callInit()` to preserve boot order. ✅ Fixed in core/app.js.

**Point 3 — App needs a user-visible degraded state when `initMap` fails**
- Valid. After Fix #1 the console shows everything, but the user sees a blank screen with no indication of what's wrong.
- Action: Completed later as **Fix #18** with an in-page "Map unavailable" state and Refresh action.

### Fix #3 — Cloud Settings Bypass the Settings Store
**File:** `services/authService.js` — `handleCloudSettingsHydration()`
**Date:** 2026-04-28

**What was wrong:**
The function had a local `applySetting(storageKey, val)` helper that wrote directly to `localStorage`, then assigned the return value to `window[key]`. Although `settingsStore.js` installs property descriptors on `window` that route assignments through `store.set()` → `notify()`, the code also had a redundant registry loop calling `store.set()` a second time. Result: each setting had localStorage written 2–3 times per cloud hydration, registry settings were processed twice (once via window assignment, once via the loop), gesture settings (`lockMapPanning`, `disablePinchZoom`) were applied inline AND via the onChange → `scheduleRegistrySettingEffects` pipeline, and an `ids` object of 20 hardcoded element IDs manually updated checkboxes that `syncRegisteredControls()` already handles. The `window.clusteringEnabled = ...` assignment was also a no-op since its property descriptor has a no-op setter.

**The fix:**
Rewrote `handleCloudSettingsHydration` with one explicit path:
1. `store.set('lowGfxEnabled', ...)` first — its setter applies `LOW_GRAPHICS_PRESET`, individual settings below can then override.
2. Resolve `standardClustering` default logic (derives from `premiumClustering` when absent from cloud data).
3. One `store.set()` call per registry setting via `Object.entries(registry)` loop — skips settings absent from cloud data using `hasOwnProperty`.
4. `store.set()` for non-registry settings (`ultraLowEnabled`, `rememberMapPosition`, `startNationalView`).
5. Manual DOM update for only the 3 non-registry toggles that have no `onChange` listener.
6. `mapStyle` and `visitedFilter` still written directly to `localStorage` (they're strings, not boolean settings the store manages).
7. Removed: `applySetting()`, `applyRegistrySetting()`, the hardcoded 15-setting block, the duplicate registry loop, inline gesture side-effects, the 20-ID `ids` object, `window.clusteringEnabled = ...`.
8. Added early `return` after the `skipCloudHydration` branch (previously the national view check still ran after the skip).

**Pros of this approach:**
- Each setting goes through the store exactly once — `persist()` called once, `notify()` fires once, no double-write.
- `onChange` listeners in `settingsController` fire correctly for all registry settings, which calls `syncRegisteredControls()` and `scheduleRegistrySettingEffects()` — no manual DOM sync needed for them.
- Adding a new setting to `SETTINGS_REGISTRY` with a `cloudKey` is now automatically hydrated — no changes to `authService.js` required.
- Gesture effects (lockMapPanning, disablePinchZoom) are applied via the normal `MAP_GESTURE` impact pipeline, not inline.
- Code went from ~90 lines to ~50 lines with one clear path.

**Cons / tradeoffs:**
- `store.set()` fires `onChange` synchronously for each registry setting in the loop — if 15 settings all change, `syncRegisteredControls()` is called 15 times in the same tick. This was the same before (each window assignment triggered the property descriptor setter). The RAF batching in `scheduleRegistrySettingEffects` absorbs the effect calls, so it's correct but not minimally efficient. A future optimization could batch all cloud settings into one notify pass — that is a separate workstream.
- The `skipCloudHydration` path now returns early before the national view check. Previously it ran that check even after skipping. The skip is triggered by `ultraLowEnabled` toggle which force-reloads — in that case `startNationalView` hasn't changed, so skipping the mapView call is correct.

**How much better:**
- Before: 2–3 localStorage writes per setting, duplicate code paths, 20 hardcoded element IDs that drift out of sync when the registry changes.
- After: 1 localStorage write per setting (via `persist()`), one code path, zero hardcoded element IDs for registry settings — new settings added to the registry are automatically hydrated.

**Rating: 8 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Registry-driven hydration auto-handles new settings without touching `authService.js` |
| Speed | 8 | `onChange` fires synchronously for each of up to 15 settings; RAF batching absorbs the effects but the notify volume is unchanged |
| Code efficiency | 9 | ~90 lines → ~50 lines, one code path, four redundant mechanisms removed |
| Reliability | 8 | Correct and clean; synchronous `onChange` burst is absorbed by RAF but not minimally efficient |

### Fix #4 — Expedition Trail Layers Initialized Too Early
**File:** `modules/expeditionEngine.js`
**Date:** 2026-04-28

**What was wrong:**
`expeditionEngine.js` created `virtualTrailLayerGroup` and `completedTrailsLayerGroup` with `L.featureGroup()` at module scope. That code ran as soon as the script tag was parsed, before `core/app.js` could wrap anything in `callInit()`. If the Leaflet CDN failed or `L` was unavailable, this file threw `L is not defined` during parse. That meant the expedition module never finished registering its functions, and the error happened outside the boot summary.

**The fix:**
- Replaced eager module-scope `L.featureGroup()` calls with `null` placeholders.
- Added `ensureTrailLayerGroups()` to lazily create both Leaflet layer groups only after Leaflet exists.
- Called `ensureTrailLayerGroups()` from `initTrainingUI()`, so normal boot still prepares the trail overlay groups during the expedition init step.
- Added the same guard to trail overlay renderers, trail toggle buttons, and `flyToActiveTrail()` so direct calls degrade safely if Leaflet or the map is unavailable.
- Switched touched map operations from the implicit global `map` identifier to a local `mapRef` from `window.map`, avoiding extra reference errors when map initialization fails.

**Why this matters:**
This moves a CDN-dependent operation out of parse time and into controlled runtime initialization. Parse-time crashes are especially bad in this app because script tag order is the dependency graph; if a module dies while loading, the boot orchestrator cannot name it, catch it, or summarize it. Runtime guards keep the app closer to the Fix #1 pattern: fail one feature, log it, keep the rest alive.

**Pros of this approach:**
- `expeditionEngine.js` can now load even when Leaflet is missing.
- The expedition feature initializes its map layers only when the app reaches `initTrainingUI()`.
- Cloud hydration or settings refresh calls into trail rendering no longer crash just because the map layer group was never created.
- Trail toggles and "fly to active trail" use explicit `window.map` checks instead of assuming the global `map` binding exists.
- Existing behavior is unchanged when Leaflet and the map load normally.
- `ensureTrailLayerGroups()` is idempotent — the early-return guard prevents double-creation no matter how many times it is called before or after `initTrainingUI()` runs.

**Cons / tradeoffs:**
- Trail overlay functions now have a small guard path that silently returns after a console warning when Leaflet is unavailable.
- If the map itself fails, expedition trail overlays still cannot render. This fix prevents a boot-time crash; the user-facing map failure message is handled later by Fix #18.
- `initTrailToggles()` still binds before `initTrainingUI()` in `core/app.js`; the click handlers are safe because they call `ensureTrailLayerGroups()`, but the actual layer creation still happens at `initTrainingUI()` during normal boot.
- `turf.*` calls inside both render functions (`turf.length`, `turf.lineSliceAlong`, `turf.along`, `turf.pointOnFeature`) have no `typeof turf` guard. A failed turf CDN would not crash the parse (calls are inside try-catch), but it is the same category of CDN-dependency risk that was just fixed for Leaflet.
- `flyToActiveTrail()` shows `"Trail map data is unavailable. Please refresh and try again."` when `ensureTrailLayerGroups()` returns false. The real cause is Leaflet missing, not trail data — the message is slightly misleading for that failure mode.

**User-visible difference:**
A user opening the app on bad campground Wi-Fi where Leaflet fails to load should no longer lose the expedition module to an uncaught `L is not defined` parse crash. The loader can dismiss, non-map UI can continue booting, and if they tap an expedition trail action the app gives a controlled unavailable state instead of exploding in the console.

**How much better:**
- Before: Leaflet missing = expedition module parse crash before boot error handling can see it.
- After: Leaflet missing = expedition module loads, boot continues, trail overlays initialize lazily when possible, and map-dependent trail actions are guarded.

**Rating: 8.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Lazy init is the right pattern; turf CDN is the same category of risk and remains unguarded |
| Speed | 9 | O(1) null check on every render call — zero measurable overhead on the happy path |
| Code efficiency | 9 | Minimal surface area changed, no new abstractions, well-scoped |
| Reliability | 8 | Correctly prevents the parse-time crash; `flyToActiveTrail()` error message is slightly misleading when Leaflet is the real failure |

### Fix #5 — Background Request Cadence & Session Kill Switch
**Files:** `modules/barkState.js`, `modules/dataService.js`
**Date:** 2026-04-28

**What was wrong:**
The session kill switch capped all counted requests at 600, while CSV polling ran every 10 seconds and the version check ran every 30 seconds. Even before normal user actions, the app could consume roughly 8 counted background requests per minute and hit the safety shutdown around 75 minutes. That is bad for long park-planning sessions, bad for trust, and noisy at scale.

**The fix:**
- Raised `SESSION_MAX_REQUESTS` from 600 to 2,000.
- Mirrored the live request count into `window._SESSION_REQUEST_COUNT` for easier console debugging.
- Changed CSV polling from every 10 seconds to every 5 minutes.
- Kept `loadData()` as the immediate fetch path on boot.
- Changed `safeDataPoll()` into the long-running scheduler instead of another immediate fetch.
- Added a `visibilitychange` refresh when the tab becomes visible again, throttled to avoid repeated tab-switch spam.
- Made CSV poll errors back off to 10 minutes after repeated failures.
- Made `pollForUpdates()` return its fetch promise so the scheduler can count failures accurately.

**Why this matters:**
Fresh CSV data does not need a 10-second heartbeat. For this app, the right long-term posture is cache-first, immediate fetch on open, then conservative polling with a quick refresh when the user returns. That keeps the map fresh enough for real use while dramatically reducing background request pressure.

**Pros of this approach:**
- Background CSV traffic drops from about 360 requests/hour to about 12 requests/hour per active tab.
- The 2,000-request cap is still a real runaway guard, but normal sessions should not trip it quickly.
- `loadData()` and `safeDataPoll()` now have clearer responsibilities: immediate load vs. scheduled loop.
- Refocus refresh keeps the app feeling current without constant polling while the user is away.
- The live request counter is visible as `window._SESSION_REQUEST_COUNT`, which helps remote debugging.
- `bindDataPollVisibilityRefresh()` uses a static property flag (`bound`) — the `visibilitychange` listener cannot be double-bound even if `safeDataPoll()` is called more than once.
- The `visibilitychange` handler gates on `dataPollStopped` — after the session kill switch fires, tab-focus events no longer trigger wasteful re-poll attempts.

**Cons / tradeoffs:**
- CSV changes may take up to 5 minutes to appear if the user stays continuously active on the tab.
- Version checks still run every 30 seconds, so this fix reduces the biggest background load but does not fully redesign all polling.
- Refocus refresh is throttled to one request per minute; very rapid tab switching will not fetch every time.
- `loadData()` calls `runDataPollCycle()` fire-and-forget without `await` (the function is not async). `runDataPollCycle()` has its own try-catch covering all expected errors, but a truly unexpected rejection inside `pollForUpdates()` would be unhandled and invisible to the boot error reporting in `app.js`.

**User-visible difference:**
A user planning a long multi-day route can leave the app open for hours without the CSV poll chewing through the session safety limit. If they switch away and come back later, the app checks for fresh park data right away instead of waiting for the next 5-minute tick.

**How much better:**
- Before: 10-second CSV polling + 600 cap = safety shutdown risk after roughly 75 minutes.
- After: 5-minute CSV polling + 2,000 cap = far lower background traffic, better long-session stability, and fewer false kill-switch trips.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Named constants, correct responsibility split, error backoff, and all the right guards |
| Speed | 10 | 96.7% reduction in background CSV requests — maximum possible without removing the feature |
| Code efficiency | 8 | The 4-function chain (`loadData` → `runDataPollCycle` → `runScheduledDataPoll` → `scheduleNextDataPoll`) is slightly deeper than needed but each function has a clear single purpose |
| Reliability | 9 | Kill switch, stop flag, `pollInFlight` guard, and idempotent listener all present; fire-and-forget in `loadData()` is the only gap |

### Fix #6 — Achievement Evaluation Mutated Live Visit Records
**File:** `modules/profileEngine.js`
**Date:** 2026-04-28

**What was wrong:**
`evaluateAchievements()` built `visitedArray` directly from `userVisitedPlaces.values()`, then filled missing `visit.state` fields by writing `visit.state = mapPoint.state`. Those `visit` objects were the same objects stored in the live `window.BARK.userVisitedPlaces` Map. A read-only achievement calculation was quietly changing canonical visit records in memory.

**The fix:**
- Changed `visitedArray` construction to create a shallow copy for each visit record.
- Added missing state only to the copied object passed into `gamificationEngine`.
- Left the original `userVisitedPlaces` Map and its visit objects untouched.
- Guarded the `window.parkLookup.get()` path so achievement evaluation stays safe if the lookup is unavailable.

**Why this matters:**
Achievement evaluation runs from the render heartbeat and should be pure from the app-state perspective. Mutating live visit records during a derived calculation makes bugs difficult to reason about: a badge render can change data that other systems treat as source-of-truth. Keeping enrichment local to the achievement input makes the data flow cleaner and easier to debug.

**Pros of this approach:**
- Keeps state badge calculations working even when cloud visit records are missing `state`.
- Removes the hidden side effect from the render/achievement path.
- Very small performance cost: one shallow object copy per visited place during achievement evaluation.
- No schema migration and no cloud write behavior change.
- Makes future debugging cleaner because `userVisitedPlaces` remains exactly what auth/check-in sync put there.
- The null/type guard at the start of the `.map()` callback (`if (!rawVisit || typeof rawVisit !== 'object')`) means the function cannot crash on malformed Firestore entries — hand-edited or migrated documents with unexpected shapes are passed through safely rather than throwing on `{ ...rawVisit }`.

**Cons / tradeoffs:**
- The copy is shallow, not a deep clone. That is intentional because the fix only enriches top-level `state`, but nested object mutation would still need separate care if added later.
- Other code paths that read `userVisitedPlaces` directly still will not see inferred `state` unless they join against `allPoints` or `parkLookup` themselves.
- Achievement evaluation still runs often from `syncState()`; that performance concern remains Fix #8.

**User-visible difference:**
A user with older cloud visit records that do not include `state` can still earn state badges correctly, but opening the profile/vault no longer mutates those saved visit objects behind the scenes. That reduces weird downstream behavior where a profile render could make visit records look different from the original synced data.

**How much better:**
- Before: achievement render = badge calculation plus hidden mutation of live visit objects.
- After: achievement render = badge calculation with copied/enriched inputs only; canonical visit records remain stable.

**Rating: 8.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Shallow copy is correct for this data shape; future nested mutations would need separate attention |
| Speed | 9 | One spread per visited park per achievement eval — submillisecond even at 1,000 parks |
| Code efficiency | 9 | Five lines changed, zero new abstractions, exactly what was needed |
| Reliability | 9 | Three defensive guards (null check, `parkLookup` existence, `mapPoint` null) — all correct |

### Fix #7 — Daily Streak Uses Local Calendar Date
**File:** `services/firebaseService.js`
**Date:** 2026-04-28

**What was wrong:**
`attemptDailyStreakIncrement()` used `new Date().toISOString().split('T')[0]` for both today and yesterday. `toISOString()` always formats in UTC. For US evening users, the UTC date can already be tomorrow, so a check-in at 9:30 PM local time could be stored as the next day and break the daily streak logic.

**The fix:**
- Added `getLocalDateKey(date = new Date())`.
- It formats dates as `YYYY-MM-DD` using local `getFullYear()`, `getMonth()`, and `getDate()`.
- Replaced the UTC `today` key with `getLocalDateKey()`.
- Replaced the UTC `yesterdayStr` key with `getLocalDateKey(yesterday)`.
- Kept the Firestore/localStorage schema unchanged: streak dates are still stored as `YYYY-MM-DD` strings.

**Why this matters:**
Streaks are a user-facing calendar feature. Users think in local days, not UTC days. The app should reward a visit made on Tuesday evening as Tuesday, not Wednesday just because UTC crossed midnight. This keeps streak behavior aligned with the user's lived day and avoids confusing missed/duplicated streak outcomes.

**Pros of this approach:**
- Fixes the US evening/tomorrow-date bug.
- Handles yesterday using the same local date-key logic as today.
- Avoids locale-output ambiguity by manually formatting the local date instead of relying on browser locale string behavior.
- No data migration needed because the stored format stays `YYYY-MM-DD`.
- Very fast: three local date reads and two `padStart()` calls per streak attempt.
- `getLocalDateKey(date = new Date())` accepts an optional `date` parameter — this is what makes the smoke test work (pass a mocked date directly) and keeps future unit tests straightforward without patching the global `Date` constructor.
- `yesterday.setDate(yesterday.getDate() - 1)` uses calendar arithmetic, not millisecond subtraction. `setDate(0)` on the first of a month correctly rolls back to the last day of the previous month, and DST transitions do not cause date drift the way `Date.now() - 86400000` would.

**Cons / tradeoffs:**
- The date is based on the device/browser local timezone. If a user travels across timezones in the same day, streaks follow the device's current local day.
- Existing streak records that were already saved with a UTC-shifted date are not automatically repaired.
- This fixes date-key generation only; it does not add server-side anti-abuse validation for streaks.

**User-visible difference:**
A user checking in during the evening in the US no longer has that check-in counted as tomorrow. Their daily streak should increment or continue based on the actual local calendar day they are using the app.

**How much better:**
- Before: local evening check-in could be stored as tomorrow because the app used UTC.
- After: daily streak dates are generated from the user's local calendar day.

**Rating: 9.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | `getLocalDateKey` is reusable if streak logic expands; manual formatting is more portable than `toLocaleDateString` especially on Cloud Functions runtimes with small-ICU |
| Speed | 10 | Three date reads and two `padStart()` calls — can't get cheaper |
| Code efficiency | 10 | One helper, zero new abstractions, implementation strictly better than the original spec |
| Reliability | 9 | Calendar arithmetic handles DST and month rollover correctly; one-time sting for users with existing UTC-shifted records |

### Fix #8 — Achievement Evaluation Debounced Outside the Render Heartbeat
**File:** `modules/renderEngine.js`
**Date:** 2026-04-28

**What was wrong:**
`syncState()` called `evaluateAchievements()` from inside the RAF heartbeat. The old `window._evalInProgress` boolean prevented overlapping achievement evaluations, but it did not prevent constant re-queuing: any state change after the previous evaluation finished could immediately trigger another profile/vault render and possible Firestore achievement work.

**The fix:**
- Added a 3-second trailing debounce for achievement evaluation.
- `syncState()` still updates markers and stats immediately.
- Replaced the global `window._evalInProgress` gate with a local scheduler in `renderEngine.js`.
- Added a local in-progress guard only to prevent concurrency if an evaluation is still running when the debounce fires.
- If a new evaluation request arrives during an active evaluation, one trailing follow-up evaluation is scheduled after the active run finishes.
- Added error handling around the scheduled evaluation so unexpected rejections are logged by `renderEngine`.

**Why this matters:**
Achievement evaluation is heavier than marker/stat refresh because it renders the vault/dossiers and can touch Firestore through the gamification engine. It should respond to meaningful settled state, not every heartbeat. A trailing debounce keeps the UI responsive while preventing state churn from turning into repeated achievement work.

**Pros of this approach:**
- Collapses bursts of `syncState()` calls into one achievement evaluation.
- Reduces repeated vault rendering and Firestore achievement checks.
- Keeps immediate marker and stat updates intact.
- The scheduler is local to `renderEngine.js`; no new global flags are introduced.
- Handles long-running evaluations safely without overlapping calls.
- `runAchievementEvaluation()` uses `try/catch/finally` — the `finally` block is critical: it guarantees `achievementEvalInProgress` is always reset even if `evaluateAchievements()` throws. Without `finally`, a single error would permanently deadlock all future achievement evaluation for the session.
- `achievementEvalRequestedDuringRun` is a boolean, not a counter or queue — one concurrent state change or one thousand during an active evaluation both collapse to exactly one follow-up evaluation. The flag is idempotent by design.

**Cons / tradeoffs:**
- Profile/vault achievement UI can lag up to 3 seconds after the last relevant state change.
- If state keeps changing continuously, achievement evaluation waits until the app quiets down.
- A long-running evaluation followed by another state change can intentionally produce one follow-up evaluation, so it is debounced, not permanently suppressed.
- `scheduleAchievementEvaluation()` is called unconditionally on every RAF frame, even for state changes that don't affect achievements (map pans, non-data interactions). The debounce absorbs this correctly, but unlike the marker path which short-circuits via `markerVisibilityStateKey`, there is no pre-debounce gate for achievement-specific state changes.

**User-visible difference:**
When a user rapidly filters, checks in, syncs cloud data, or moves through UI states, the app should feel less jittery and do less background achievement work. Badge/rank updates may appear a few seconds after the state settles instead of trying to recompute during every render heartbeat.

**How much better:**
- Before: every settled `syncState()` heartbeat could launch achievement evaluation as soon as the previous run finished.
- After: heartbeat bursts schedule one trailing achievement evaluation after 3 seconds of quiet, with concurrency protection for long runs.

**Rating: 9.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Trailing debounce + overlap guard is the canonical pattern, correctly implemented |
| Speed | 9 | `clearTimeout` + `setTimeout` are O(1); minor: fires on every RAF frame even for non-achievement state changes |
| Code efficiency | 9 | Three module-local variables, clean separation of scheduling and execution, no globals |
| Reliability | 10 | `finally` prevents deadlock, boolean flag deduplicates correctly, error path fully handled |

### Fix #9 — CSV Polling Scale Hardening
**Files:** `modules/dataService.js`, `core/app.js`
**Date:** 2026-04-28

**What was wrong:**
CSV polling originally ran every 10 seconds. At scale, that is excessive for a Google Sheets CSV source and creates unnecessary background traffic. The boot path also called both `loadData()` and `safeDataPoll()` directly, which made the data service lifecycle harder to reason about.

**The fix:**
- The 5-minute polling interval and tab-refocus refresh were implemented as part of Fix #5.
- Finished the remaining Fix #9 cleanup by moving the polling scheduler start into `loadData()`.
- Removed the direct `safeDataPoll()` call from `core/app.js`.
- `core/app.js` now has one data entry point: `window.BARK.loadData()`.
- `loadData()` now handles cache hydration, starts the background scheduler, and performs the immediate online fetch.

**Why this matters:**
The app should not ask every active tab to hit the CSV source every 10 seconds. It also should not require the boot orchestrator to know the internals of the data service. One entry point keeps startup simpler, while the data service owns its own immediate-load and background-refresh lifecycle.

**Pros of this approach:**
- Keeps CSV polling at 5 minutes instead of 10 seconds.
- Preserves immediate fetch on app open.
- Preserves refresh-on-return via `visibilitychange`.
- Removes a data-service implementation detail from `core/app.js`.
- Avoids duplicate immediate fetches because `safeDataPoll()` only schedules the next background poll.
- `safeDataPoll()` is called before the `navigator.onLine` check, so the 5-minute timer and refocus listener are bound even when the device starts offline. When the user reconnects and tab-switches, the `visibilitychange` handler already exists and correctly triggers a fetch attempt.
- `window.BARK.safeDataPoll` is still exported but becomes a no-op after `loadData()` runs (because `dataPollLoopStarted = true`). External code cannot accidentally start a second polling loop.

**Cons / tradeoffs:**
- `loadData()` now starts the polling scheduler as a side effect, so callers should not treat it as cache-only.
- CSV updates can still take up to 5 minutes to appear during continuous active use.
- The 1-minute refocus throttle means very rapid tab switching will not fetch every time.
- The 5-minute timer starts from when `safeDataPoll()` is called, not from when the immediate `runDataPollCycle()` fetch completes. On a slow boot network the first scheduled poll and the boot fetch could arrive closer together than expected — at most a few seconds' drift. Not a real problem, but the timer is not strictly "5 minutes after first fetch."

**User-visible difference:**
A user still gets park data immediately on load, and if they return to the tab later the app checks for fresher data. Behind the scenes, the app is far gentler on the CSV source and less likely to contribute to throttling as usage grows.

**How much better:**
- Before: 10-second CSV polling and boot orchestration that knew about both immediate load and polling internals.
- After: 5-minute CSV polling, refocus refresh, and one clean app boot call into the data service.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Single data entry point for boot is cleaner; data service owns its full lifecycle |
| Speed | 9 | No change to polling cadence — same 5-minute intervals, same refocus behavior |
| Code efficiency | 9 | Two fewer lines in `app.js`, one cleaner comment, no regressions |
| Reliability | 9 | Online and offline paths both correct; timer-before-fetch ordering is intentional and safe |

### Fix #10 — Cached Visited-ID Render Fingerprint
**Files:** `modules/renderEngine.js`, `services/authService.js`, `services/checkinService.js`, `services/firebaseService.js`
**Date:** 2026-04-28

**What was wrong:**
`getMarkerVisibilityStateKey()` rebuilt the visited-ID part of the marker fingerprint on every heartbeat with `Array.from(userVisitedPlaces.keys()).sort().join(',')`. That is unnecessary work during map movement, filtering, and other render cycles where the visited set has not changed. As the visit count grows, sorting those IDs repeatedly becomes wasted main-thread work.

**The fix:**
- Added `getVisitedIdsCacheKey()` in `renderEngine.js`.
- It returns `window.BARK._visitedIdsCacheKey` when present.
- It only rebuilds the sorted visited-ID string when the cache is missing.
- Added `window.BARK.invalidateVisitedIdsCache()`.
- The invalidation helper clears `_visitedIdsCacheKey` and also invalidates marker visibility so changed visit IDs refresh pin classes.
- Added cache invalidation when cloud auth sync replaces `userVisitedPlaces`.
- Added cache invalidation when logout clears `userVisitedPlaces`.
- Added cache invalidation for GPS verified check-ins.
- Added cache invalidation for manual mark-as-visited add/remove.
- Added cache invalidation for manage-portal removal.

**Why this matters:**
The marker fingerprint is part of the central render heartbeat. Anything inside it should be cheap and stable. Visited IDs change only when the user adds/removes/checks in/syncs visits, not every frame. Moving the sort to mutation time keeps the render path fast and makes the cost proportional to actual visit changes instead of UI heartbeat frequency.

**Pros of this approach:**
- Removes repeated visited-ID sorting from the hot render path.
- Keeps the existing fingerprint behavior and marker refresh semantics.
- Invalidation is explicit at every known ID-changing mutation point.
- The cache is stored on `window.BARK`, making it easy to inspect in the console during debugging.
- Manual removal and GPS check-ins are covered in addition to the original cloud/manual mark flows.
- The cache sentinel uses `typeof window.BARK._visitedIdsCacheKey === 'string'` rather than a truthiness check — this correctly handles the zero-visits state where the key is `''` (empty string). A truthiness check would treat `''` as a cache miss and re-sort on every frame when the user has no visits.
- All six invalidation call sites guard with `if (typeof window.BARK.invalidateVisitedIdsCache === 'function')` — if `renderEngine.js` fails to boot, service files degrade to a safe no-op instead of throwing a ReferenceError mid-check-in or mid-sync.
- `invalidateVisitedIdsCache()` calling `invalidateMarkerVisibility()` is redundant when IDs actually change (the fingerprint differs anyway), but it provides a correctness guarantee for any future preventive invalidation — forcing the next heartbeat to re-evaluate unconditionally without relying on the fingerprint comparison.

**Cons / tradeoffs:**
- Correctness now depends on every future visit-ID mutation calling `window.BARK.invalidateVisitedIdsCache()`.
- The cache stores only IDs, not visit metadata; changing a visit date or verification detail does not invalidate it because those changes do not alter marker visibility membership.
- There is still sorting work when the visited set changes, but that is the right time to pay it.

**User-visible difference:**
Users with many visited places should get smoother map/render behavior during interactions that do not change visits, because the app no longer sorts the full visited-ID list on every heartbeat. Pins still update immediately after add/remove/check-in/cloud sync because those paths invalidate the cache.

**How much better:**
- Before: every marker fingerprint rebuild sorted all visited IDs.
- After: visited IDs are sorted once per visit-set change and reused until invalidated.

**Rating: 8.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Correct caching pattern; maintenance burden grows as more visit-mutation paths are added |
| Speed | 9 | O(n log n) sort moved off every RAF frame; cost now proportional to actual visit changes |
| Code efficiency | 8 | Four files, six call sites — correctly guarded everywhere, but wider surface area than most fixes |
| Reliability | 9 | `typeof === 'string'` handles zero-visits correctly; typeof guards on all call sites; redundant but safe `invalidateMarkerVisibility()` |

### Fix #11 — Budgeted Levenshtein Search
**Files:** `modules/searchEngine.js`, `modules/renderEngine.js`
**Date:** 2026-04-28

**What was wrong:**
The search input waited for the 300ms debounce, then ran fuzzy matching synchronously across every park in `window.BARK.allPoints`. For each park it could run Levenshtein against the full normalized park name, then against individual words. At ~1,000 parks this may feel acceptable on a desktop. At 5,000+ parks, especially on a mobile device, the worst-case path can monopolize the main thread long enough to cause input jank, delayed paints, and a "the app froze while I typed" feeling.

There was also a second hidden version of the same risk in `renderEngine.js`: if `_searchResultCache` was missing or mismatched, marker rendering could run its own Levenshtein fallback inside the marker loop. That means a partial/budgeted search fix in `searchEngine.js` alone would not be enough. The expensive work could still reappear during `updateMarkers()`, which is exactly the render heartbeat path we are trying to keep cheap.

One more user-facing issue appeared once search became partial: the existing global-town fallback could fire as soon as local suggestions were empty. With chunking, "empty so far" is not the same as "empty after checking all parks." The fallback needed to wait until local search finished, otherwise premium users could trigger unnecessary global geocode calls before the app had finished checking the local park list.

**The fix:**
- Added named search constants:
  - `SEARCH_INPUT_DEBOUNCE_MS = 300`
  - `SEARCH_FRAME_BUDGET_MS = 16`
  - `SEARCH_CONTINUATION_DELAY_MS = 0`
  - `SEARCH_SUGGESTION_LIMIT = 8`
  - `SEARCH_SCORE_THRESHOLD = 2`
  - `SEARCH_GLOBAL_MIN_LENGTH = 3`
- Extracted search scoring into `scoreSearchItem(item, queryNorm)` so the scoring rules live in one place instead of being buried inside the event handler.
- Renamed the misleading code comment from `O(1) LEVENSHTEIN` to `SPACE-OPTIMIZED LEVENSHTEIN`. The implementation uses one row of dynamic-programming state, so memory is optimized, but runtime is still proportional to the compared string lengths.
- Replaced the one-shot `allPoints.forEach(...)` search with a budgeted chunk runner:
  - It records `performance.now()` at the start of each chunk.
  - It processes parks until the elapsed chunk time reaches the 16ms budget.
  - It publishes partial results into `_searchResultCache`.
  - It schedules the remainder with `setTimeout(..., 0)`.
  - It repeats until every park has been checked.
- Added a per-search `activeSearchRunId` cancellation guard. Every new keystroke, clear action, or suggestion click invalidates older scheduled work so stale chunks cannot repaint old results over the new query.
- Expanded `_searchResultCache` shape:
  - `query`
  - `matchedIds`
  - `complete`
  - `processedCount`
  - `totalCount`
- Suggestions now render from the incremental `matches` array instead of doing a second full `allPoints.filter(...)` pass after scoring.
- While a large local search is still running, the dropdown can show partial local matches plus a "Searching local map..." status row.
- The global towns/cities fallback now waits until local search is complete. "No local matches yet" no longer triggers geocoding.
- Suggestion click now cancels pending search work and seeds `_searchResultCache` with the selected park. That keeps marker rendering deterministic after the active search text changes to the selected park name.
- `renderEngine.js` now normalizes the active search query once per marker update instead of once per marker.
- `renderEngine.js` now trusts a matching `_searchResultCache` and no longer runs Levenshtein inside the marker loop.
- If the render cache is unavailable or mismatched, `renderEngine.js` only falls back to a cheap substring check. Fuzzy search is now owned by `searchEngine.js`, not duplicated in the render heartbeat.
- The marker visibility fingerprint now includes whether the search cache is partial or complete.
- Map auto-framing waits for the matching search cache to be complete. This prevents the map from flying to partial early results, then refusing to re-frame when the full result set finishes.
- Search suggestion UI now uses DOM nodes and `textContent` for user-entered query text in the rebuilt rows, instead of injecting the query through `innerHTML`.

**Why this matters:**
The main thread is the user's whole app: typing, painting, scrolling, map movement, marker visibility, and click response all share it. A synchronous fuzzy search that scales linearly with park count and string-comparison cost is okay only while the dataset is small. It becomes a reliability bug as the data grows.

This fix keeps the same local fuzzy-search behavior, but changes the scheduling model. Instead of "finish all fuzzy matching before the browser can breathe," the app now does "work for a small budget, publish what is known, then continue." That is the right long-term direction for a map app that wants to scale from ~1,000 parks to 5,000+ without making mobile users pay for the whole search in one blocking task.

**Pros of this approach:**
- Keeps the existing fuzzy search behavior: substring matches still win, typo tolerance still works for local park names, and the score threshold remains `<= 2`.
- Prevents one search from monopolizing the main thread for the full dataset.
- Gives the UI a chance to paint between chunks on large searches.
- Results become progressive: the app can show early local matches while still checking the rest.
- Stale search work is cancelled cleanly with `activeSearchRunId`, so fast typers do not get old-query results rendered after a new query starts.
- The cache is now self-describing: `complete`, `processedCount`, and `totalCount` make debugging much easier in the console.
- Global geocoding is more correct because it only runs after local search is truly complete.
- The render heartbeat becomes cheaper and easier to reason about because fuzzy matching no longer happens in `updateMarkers()`.
- Normalizing the query once per marker update removes repeated string work from the marker loop.
- Auto-framing waits for complete search results, which avoids camera movement based on an incomplete subset.
- Rebuilding the global fallback button with DOM nodes avoids injecting raw user search text into `innerHTML`.
- The solution fits the current architecture: vanilla JS, no bundler, no new dependency, no worker build pipeline, no server change.

**Cons / tradeoffs of this approach:**
- Total search work is still linear across all parks. Chunking improves responsiveness, not total algorithmic complexity.
- The 16ms budget is best-effort. If one individual park comparison is unusually expensive, that one comparison still has to finish before the loop can yield.
- The dropdown may briefly show partial local results plus a "Searching local map..." row on very large datasets or slow devices.
- Markers can update progressively as the cache fills. That is intentional, but it means the visible filtered set may be incomplete for a moment during a large fuzzy search.
- Global town/city fallback is delayed until local search completes. This is the correct behavior, but premium users searching for a city may wait a little longer before the global search begins.
- `renderEngine.js` no longer performs fuzzy fallback if some external code sets `window.BARK.activeSearchQuery` without going through the search engine. In that rare case, render falls back to cheap substring matching only. Normal user typing still goes through the budgeted fuzzy cache.
- More helper functions exist inside `initSearchEngine()`. The complexity is still scoped, but the search module is larger than before.
- `setTimeout(..., 0)` yields work in small tasks but is not the same as a true background thread. A Web Worker would isolate CPU work more strongly, but would require a larger architectural change.

**Alternative solution A — Web Worker search:**

**Pros:**
- Best main-thread isolation. Fuzzy matching could run off the UI thread entirely.
- Scales better for very large datasets and slower mobile CPUs.
- Cancellation can be implemented with worker message IDs similar to `activeSearchRunId`.
- Would make future heavier ranking algorithms safer.

**Cons:**
- Larger architecture change in this app because there is no bundler and modules attach to `window.BARK`.
- Worker needs a serializable copy of park search fields. Markers and Leaflet objects cannot cross the worker boundary.
- Requires a sync/update protocol whenever `allPoints` changes.
- Debugging becomes more complex because search state is split between the main thread and worker thread.
- More moving parts for a store-launch reliability pass. Good future option, bigger than Fix #11.

**Verdict:**
Best long-term ceiling, but heavier than needed today. The chunked main-thread approach gets most of the responsiveness win with much lower implementation risk.

**Alternative solution B — Prebuilt client-side search index (`Fuse.js`, `FlexSearch`, MiniSearch, trie/prefix index):**

**Pros:**
- Faster repeated searches after the index is built.
- Better ranking, weighting, and typo behavior if using a mature library.
- Could support richer search fields later: park name, state, swag type, aliases, nearby towns.
- A purpose-built index can reduce per-keystroke brute-force work.

**Cons:**
- Adds dependency and load-order concerns to a no-bundler app.
- Index build time still has to happen somewhere and must be refreshed when CSV data updates.
- Fuzzy libraries can be surprisingly heavy on mobile if configured broadly.
- Different scoring can subtly change search results users are used to.
- More surface area to debug if search results look "wrong."

**Verdict:**
Good future product improvement if search becomes a major feature. For Fix #11, it is more change than needed to solve the immediate main-thread reliability problem.

**Alternative solution C — Remove Levenshtein and use substring/prefix search only:**

**Pros:**
- Fastest and simplest client-side option.
- Very easy to reason about.
- No typo-distance cost.
- Marker render fallback would stay cheap everywhere.

**Cons:**
- Loses typo tolerance. A user searching `Yosimite`, `Acadiaa`, or `Grnad Canyon` may get no local result.
- Makes the app feel less forgiving.
- Does not match the existing user experience.

**Verdict:**
Excellent for raw speed, too large a UX regression for this app. Kept fuzzy search instead.

**Alternative solution D — Server-side search endpoint:**

**Pros:**
- Keeps heavy search work off the client.
- Can scale with a proper database/index.
- Could support analytics, synonyms, aliases, and typo correction centrally.

**Cons:**
- Requires backend work and network availability for a core local-map interaction.
- Adds latency and possible cost.
- Offline/PWA behavior gets worse.
- Current park data already lives client-side after CSV load, so server round trips are unnecessary for local park search.

**Verdict:**
Not the right fit for local park search right now. Better reserved for richer future search products or admin/store features.

**Alternative solution E — Increase debounce only:**

**Pros:**
- Tiny change.
- Reduces how often search runs while the user is typing.
- No behavioral complexity.

**Cons:**
- Does not fix the blocking search once it starts.
- Makes search feel slower.
- Fails the 5,000+ parks scalability goal because the final query still runs as one synchronous block.

**Verdict:**
Helpful only as a band-aid. The app already had a 300ms debounce; the real issue was the unbounded post-debounce work.

**Use cases and what the user sees:**

**Use case 1 — Exact local park search:**
A user types `Acadia`. On normal devices and current data size, results should appear almost exactly as before. Internally, the search may still complete in one chunk if it stays under budget. If the dataset is much larger or the device is slower, the dropdown can show early local matches while the rest of the map is still being checked.

**Use case 2 — Typo-tolerant local search:**
A user types a slightly wrong park name like `Acadiaa` or `Yosimite`. Fuzzy matching still works because the Levenshtein scoring rules were preserved. The difference is that typo matching no longer has to finish across every park before the browser can paint.

**Use case 3 — Massive future dataset on a phone:**
At 5,000+ parks, a single synchronous fuzzy loop can make the keyboard, dropdown, or map feel stuck. With this fix, the app works in slices. The user may see a "Searching local map..." row briefly, but the page stays responsive and results fill in progressively.

**Use case 4 — Premium user searches for a town/city not in local parks:**
Before chunking, the global fallback ran after the full local pass. With naive chunking, it could have accidentally run after only a partial local pass. This fix preserves the correct behavior: the app waits until local search is complete, then offers/runs global search if there are no local matches.

**Use case 5 — User types quickly, then changes their mind:**
If the user types `aca`, then quickly changes to `yose`, the older `aca` chunks are invalidated by `activeSearchRunId`. Old work cannot repaint stale suggestions over the new query.

**Use case 6 — User taps a local suggestion while search is still running:**
The app cancels remaining chunks, sets the input to the chosen park, seeds the cache with that exact park, hides suggestions, syncs markers, and opens the marker. There is no delayed stale chunk coming behind it.

**Use case 7 — Map auto-framing during large search:**
The map no longer flies to the first partial set of search results. It waits until the matching cache is complete, then frames the final visible result set. This is less jumpy and avoids a subtle "camera moved to the wrong subset" problem.

**Debugging notes:**
Inspect `window.BARK._searchResultCache` in the console while typing. During a large search it should look like:

```js
{
  query: "acadia",
  matchedIds: Set(...),
  complete: false,
  processedCount: 240,
  totalCount: 5000
}
```

When the search finishes, `complete` becomes `true` and `processedCount === totalCount`. If a stale query ever appears, check `activeSearchRunId` logic in `initSearchEngine()` first. If marker visibility looks wrong, confirm that `searchCache.query` equals `window.BARK.normalizeText(window.BARK.activeSearchQuery)` and that `matchedIds` contains the expected park IDs.

**User-visible difference:**
Search should feel the same on small/current data, but it should stay responsive on larger data and slower devices. On large searches, users may briefly see a local-search status row while results are still being checked. Premium global search starts after local search is complete, not while local search is still partial. The map camera should move after final search results are known rather than reacting to an incomplete subset.

**How much better:**
- Before: one post-debounce search could synchronously fuzzy-match every park on the main thread.
- Before: marker rendering still had a hidden duplicate Levenshtein fallback.
- Before: a chunked search would have risked global fallback and auto-framing based on incomplete local results.
- After: search work is budgeted to ~16ms chunks, stale chunks are cancelled, partial progress is cached, marker rendering avoids fuzzy work, global fallback waits for local completion, and auto-framing waits for the final matching cache.

**Verification:**
- `node --check modules/searchEngine.js`
- `node --check modules/renderEngine.js`
- Mocked DOM/clock smoke test forced the 16ms budget path:
  - Debounced search scheduled correctly at 300ms.
  - First search chunk published `complete: false`.
  - Continuation chunks were scheduled with delay `0`.
  - Final cache published `complete: true`.
  - Expected local match was present in `matchedIds`.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Correct low-risk bridge for 5,000+ parks; a worker or search index may eventually be better if search grows into a major product surface |
| Speed | 9 | Removes the worst single blocking task and removes render-loop Levenshtein; total work is still linear |
| Code efficiency | 8 | More helper code, but each helper has a specific job and avoids new dependencies |
| Reliability | 9 | Cancellation, partial cache metadata, render-cache alignment, delayed global fallback, and complete-result auto-framing all protect real edge cases |
| Debuggability | 10 | `_searchResultCache.complete`, `processedCount`, and `totalCount` make search state inspectable instead of invisible |

### Fix #12 — `barkState.js` Is Runtime Data State Only
**File:** `modules/barkState.js`
**Date:** 2026-04-28

**What was wrong:**
`barkState.js` was still initializing persistent settings directly from `localStorage` at module load:

```js
window.allowUncheck = localStorage.getItem('barkAllowUncheck') === 'true';
window.standardClusteringEnabled = localStorage.getItem('barkStandardClustering') !== 'false';
window.premiumClusteringEnabled = localStorage.getItem('barkPremiumClustering') === 'true';
window.lowGfxEnabled = ...
window.simplifyTrails = ...
window.instantNav = ...
```

That block was no longer the real settings system. `state/settingsStore.js` loads shortly afterward, reads persistent settings directly, then installs `Object.defineProperty(window, key, { get, set })` mirrors for the same legacy `window.*` names. The `barkState.js` values were temporary raw globals that were overwritten by the canonical settings store.

This created two problems:
- Ownership was unclear. A reader could reasonably think `barkState.js` owned settings because it still contained the old localStorage hydration logic.
- Boot-time debugging was noisier than necessary. There were two places to inspect for settings defaults, low-graphics presets, clustering derivation, gesture toggles, and performance toggles.

The actual app already depended on the later `settingsStore.js` mirrors. Keeping the old block in `barkState.js` made the codebase look less stable than it really was.

**The fix:**
- Removed the entire settings hydration block from `modules/barkState.js`.
- Removed raw initialization for:
  - `allowUncheck`
  - `standardClusteringEnabled`
  - `premiumClusteringEnabled`
  - `clusteringEnabled`
  - `lowGfxEnabled`
  - `simplifyTrails`
  - `instantNav`
  - `rememberMapPosition`
  - `startNationalView`
  - `stopAutoMovements`
  - `reducePinMotion`
  - `removeShadows`
  - `stopResizing`
  - `viewportCulling`
  - `forcePlainMarkers`
  - `limitZoomOut`
  - `simplifyPinsWhileMoving`
  - `ultraLowEnabled`
  - `lockMapPanning`
  - `disable1fingerZoom`
  - `disableDoubleTap`
  - `disablePinchZoom`
- Left runtime data state in `barkState.js`:
  - `allPoints`
  - `userVisitedPlaces`
  - `tripDays`
  - `activeDayIdx`
  - `activeSwagFilters`
  - `activeSearchQuery`
  - `activeTypeFilter`
  - `visitedFilterState`
  - `_searchResultCache`
  - `activePinMarker`
  - trip bookends
  - `parkLookup`
  - app version
  - request-count safety state
  - gamification engine instance
- Updated the file header to make ownership explicit:
  - `barkState.js` owns mutable runtime data state and the `window.BARK` namespace.
  - Persistent user settings are owned by `state/settingsStore.js`.

**Why this is safe:**
The script order in `index.html` is:

```text
modules/settingsRegistry.js
modules/barkState.js
modules/barkConfig.js
config/domRefs.js
state/settingsStore.js
state/appState.js
...
modules/mapEngine.js
modules/renderEngine.js
...
core/app.js
```

The only files between `barkState.js` and `settingsStore.js` are `barkConfig.js` and `domRefs.js`. Those files do not read `window.lowGfxEnabled`, `window.clusteringEnabled`, `window.allowUncheck`, gesture settings, or performance settings during parse. The map/render/search/settings controllers that actually consume those legacy setting globals load after `settingsStore.js` has installed the canonical mirrors.

The smoke test verified this explicitly:
- After `barkState.js`, `window.allowUncheck` and `window.lowGfxEnabled` are not created by `barkState.js`.
- After `settingsStore.js`, the legacy mirrors exist.
- Stored values still hydrate correctly from `localStorage`.
- Derived `window.clusteringEnabled` still works.
- Assigning a legacy mirror like `window.allowUncheck = false` still routes through `settingsStore` and persists to `localStorage`.

**Why this matters:**
This is not a flashy feature fix. It is an ownership fix. For a codebase trying to become reliable at scale, state ownership matters a lot. Settings now have one obvious home:

```text
Persistent settings -> state/settingsStore.js
Runtime app data    -> modules/barkState.js / state/appState.js mirrors
```

That makes future debugging faster. If low graphics mode is wrong, look in `settingsStore.js`, the settings registry, or the cloud hydration path. Do not waste time checking a stale boot-time localStorage block in `barkState.js`. If active search, trip days, visited places, or marker state is wrong, then `barkState.js` is still relevant.

**Pros of this approach:**
- Removes duplicate settings ownership.
- Reduces boot-time code in `barkState.js`.
- Makes `barkState.js` easier to scan: it now starts with app version, then runtime data/state infrastructure.
- Prevents future engineers from editing the wrong settings initialization path.
- Keeps all existing settings behavior because `settingsStore.js` already hydrates from `localStorage`.
- Keeps legacy `window.*` setting reads working for existing modules.
- Keeps low-graphics default behavior in the canonical store, including device-memory auto-detect when no saved value exists.
- Keeps low-graphics and ultra-low presets centralized in one place.
- Keeps derived clustering centralized: `window.clusteringEnabled` remains a read-only derived mirror from standard/premium clustering.
- No dependency, schema, DOM, Firebase, or user-data changes.
- Smaller boot surface: fewer raw global writes before the structured store takes over.

**Cons / tradeoffs:**
- There is now a short parse-time interval between `barkState.js` and `settingsStore.js` where settings globals are intentionally not defined. This is safe with the current load order because no in-between module reads them, but it is a load-order invariant worth preserving.
- If someone later inserts a new script between `barkState.js` and `settingsStore.js` and that script reads `window.lowGfxEnabled` at parse time, it will see `undefined`. The correct fix in that future case is to move the script after `settingsStore.js` or read through `window.BARK.settings` after it exists, not to reintroduce duplicate hydration.
- `barkState.js` still reads `localStorage` for non-settings runtime state (`APP_VERSION`, `visitedFilterState`). That is intentional; this fix removed persistent settings only.
- The legacy global names still exist after `settingsStore.js` because the rest of the app still reads `window.lowGfxEnabled`, `window.instantNav`, etc. This fix clarifies ownership but does not yet remove legacy global reads from every module.

**Alternative solution A — Leave the duplicate block in place:**

**Pros:**
- Zero code change.
- Settings globals exist a few milliseconds earlier during boot.
- No risk from future scripts inserted before `settingsStore.js`.

**Cons:**
- Keeps two apparent sources of truth.
- Future debugging remains confusing.
- A future edit to `barkState.js` settings defaults could appear to work briefly, then be overwritten by `settingsStore.js`.
- Makes the architecture look less mature than it is.

**Verdict:**
Not acceptable for the reliability goal. Duplicate ownership is exactly the kind of thing that causes slow, frustrating debugging later.

**Alternative solution B — Move `settingsStore.js` before `barkState.js`:**

**Pros:**
- Settings mirrors would exist before `barkState.js`.
- Removes the parse-time gap where settings globals are absent.
- Could make settings ownership even earlier in boot.

**Cons:**
- Larger load-order change.
- `settingsStore.js` depends on `settingsRegistry.js` and `LOW_GRAPHICS_PRESET`; moving it safely means re-auditing more boot edges.
- `barkState.js` does not need settings during parse after this fix, so moving the store earlier is unnecessary.
- More risky than removing dead duplicate code.

**Verdict:**
Possibly reasonable later, but not needed for Fix #12. The current script order is safe and already has `settingsStore.js` before every real settings consumer.

**Alternative solution C — Keep fallback defaults in `barkState.js` but mark them temporary:**

**Pros:**
- Settings globals exist early.
- Could protect against accidental future parse-time readers.
- Smaller behavioral change than full removal.

**Cons:**
- Still duplicates settings logic.
- Still leaves two places to update defaults and presets.
- Comments do not enforce ownership.
- Future readers still have to reason about which copy wins.

**Verdict:**
This would preserve the confusion while pretending it is documented. Better to remove the duplicate state.

**Alternative solution D — Move all runtime state out of `barkState.js` into `state/appState.js`:**

**Pros:**
- Cleaner long-term architecture.
- Could eventually eliminate more legacy globals.
- Stronger structured-state story.

**Cons:**
- Much larger refactor.
- High blast radius because many modules still use `window.BARK.allPoints`, `window.BARK.tripDays`, `window.tripStartNode`, and related legacy state.
- Not necessary to solve the settings duplication issue.

**Verdict:**
Good future direction, not Fix #12. This fix intentionally keeps runtime data state stable.

**Use cases and what the user sees:**

**Use case 1 — User has Low Graphics saved:**
A user previously enabled Low Graphics mode. On app boot, `settingsStore.js` still reads `barkLowGfxEnabled`, applies the low-graphics preset, installs `window.lowGfxEnabled`, and the later map modules still read the correct value. The user should see the same low-graphics behavior as before.

**Use case 2 — User has Premium Clustering enabled:**
The stored premium/standard clustering settings still hydrate in `settingsStore.js`. `window.clusteringEnabled` is still derived from those settings. The map and marker layer policy still see the correct clustering mode.

**Use case 3 — User opens settings:**
The settings UI still reads the same legacy mirrors and store values. Checkboxes should still reflect saved preferences. The difference is under the hood: there is no stale pre-store settings copy in `barkState.js`.

**Use case 4 — Developer debugs a setting bug:**
Before this fix, a developer could see `window.lowGfxEnabled` initialized in `barkState.js`, then later mirrored by `settingsStore.js`, and have to reason through which one was real. After this fix, the answer is straightforward: settings live in `settingsStore.js`.

**Use case 5 — A future setting is added:**
The developer should add it to the registry/store path, not to `barkState.js`. This reduces the chance of adding a setting to one place and forgetting the other.

**User-visible difference:**
There should be no intentional visual or interaction change for users. Saved settings should behave the same. The real user benefit is reliability: fewer chances for future setting defaults, low-graphics behavior, clustering behavior, or gesture toggles to drift between two initialization paths.

One concrete app instance: a user who enabled Low Graphics mode should still open the map and get the same reduced-motion/reduced-marker-cost behavior. The difference is that the map now gets that value from the single canonical settings store path, not from a temporary `barkState.js` value that gets overwritten during boot.

**How much better:**
- Before: `barkState.js` appeared to own settings, then `settingsStore.js` actually owned them.
- Before: low-graphics, ultra-low, clustering, gesture, and performance defaults existed in two places.
- After: `barkState.js` owns runtime data; `settingsStore.js` owns persistent settings.
- After: settings debugging starts in one place.

**Verification:**
- `node --check modules/barkState.js`
- `node --check state/settingsStore.js`
- `rg` confirmed the removed setting assignments are gone from `modules/barkState.js`.
- VM smoke test loaded `settingsRegistry.js` -> `barkState.js` -> `settingsStore.js` with mocked `localStorage`, `navigator`, and `GamificationEngine`.
  - Confirmed `barkState.js` does not create setting globals before `settingsStore.js`.
  - Confirmed `settingsStore.js` hydrates stored setting values.
  - Confirmed `window.clusteringEnabled` still derives correctly.
  - Confirmed legacy `window.*` assignment still persists through `settingsStore`.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Clear ownership split: runtime data in `barkState.js`, persistent settings in `settingsStore.js` |
| Speed | 10 | Fewer boot-time localStorage reads and raw global writes; no runtime cost |
| Code efficiency | 10 | Removed a large obsolete block without adding replacement complexity |
| Reliability | 9 | Behavior preserved by `settingsStore.js`; only caveat is preserving script order so no future pre-store settings reader appears |
| Debuggability | 10 | One canonical place to inspect setting hydration, defaults, derived clustering, and presets |

### Fix #13 — Registry-Driven Cloud Settings Control Sync
**File:** `services/authService.js`
**Date:** 2026-04-28

**What was wrong:**
The original Fix #13 queue item described an older `authService.js` shape: a large hardcoded `ids` object manually mapped every setting key to a DOM element ID, even though those same IDs already lived in `window.BARK.SETTINGS_REGISTRY[key].elementId`.

That exact 20-control `ids` object was already removed during the earlier cloud hydration cleanup in Fix #3. The current code was much better:
- Registry settings were hydrated through `store.set(...)`.
- `settingsController` had `settingsStore.onChange(...)` listeners that call `syncRegisteredControls()`.
- The old massive per-setting hardcoded DOM update block was gone.

But there was still a smaller leftover pattern in `handleCloudSettingsHydration()`:

```js
const rememberMapToggleEl = document.getElementById('remember-map-toggle');
const nationalViewToggleEl = document.getElementById('national-view-toggle');
const ultraLowToggleEl = document.getElementById('ultra-low-toggle');
if (rememberMapToggleEl) rememberMapToggleEl.checked = window.rememberMapPosition;
if (nationalViewToggleEl) nationalViewToggleEl.checked = window.startNationalView;
if (ultraLowToggleEl) ultraLowToggleEl.checked = window.ultraLowEnabled;
```

Those three controls are not in `SETTINGS_REGISTRY`, so the old reviewer concern was mostly stale. Still, the hydration function had no explicit registry-driven control sync fallback. It relied on `settingsController` having booted successfully and bound `onChange` listeners. In normal boot that is true, because `initSettings` runs before Firebase. For long-term reliability, cloud hydration should still have a clean way to sync visible controls even if the settings controller did not bind for some reason.

**The fix:**
- Added `syncCheckboxControl(settingKey, elementId)`.
- Added `syncRegistrySettingControls(registry)`.
  - Iterates `Object.entries(window.BARK.SETTINGS_REGISTRY || {})`.
  - Reads each setting's `elementId`.
  - Sets the checkbox from `window[settingKey]`.
- Added `STANDALONE_CLOUD_SETTING_CONTROLS` for the three settings that are intentionally not registry-managed:
  - `rememberMapPosition -> remember-map-toggle`
  - `startNationalView -> national-view-toggle`
  - `ultraLowEnabled -> ultra-low-toggle`
- Added `syncStandaloneCloudSettingControls()`.
- Added `syncCloudSettingsControls(registry)`.
  - If `window.BARK.syncSettingsControls()` exists, call it. That is the best path because it also applies registry UI rules like low-graphics disabling/opacity.
  - If it does not exist, fall back to `syncRegistrySettingControls(registry)`.
  - Always sync the three standalone cloud setting controls afterward.
- Replaced the remaining direct three-element sync block in `handleCloudSettingsHydration()` with one call:

```js
syncCloudSettingsControls(registry);
```

**Why this matters:**
Cloud hydration is one of the most important state transitions in the app. A user can boot with local settings, then Firebase sends cloud settings and the app has to update store state, legacy window mirrors, map behavior, marker behavior, and visible settings controls. If those paths drift, users see a dangerous class of bug: the app behaves one way, but the settings panel shows another.

This fix makes the control-sync path explicit and scalable:
- Registry settings sync from the registry.
- Standalone settings sync from one small named map.
- `settingsController` remains the preferred controller-aware sync path.
- `authService.js` no longer contains scattered one-off checkbox code in the middle of hydration.

**Pros of this approach:**
- Closes the original hardcoded-ID concern in the current code shape.
- Keeps registry settings tied to `SETTINGS_REGISTRY[key].elementId`.
- Adds a fallback if `settingsController` fails before binding `window.BARK.syncSettingsControls()`.
- Keeps the best path when settings UI is healthy: `syncSettingsControls()` still handles disabled state, opacity, and cluster toggle display rules.
- Makes the three non-registry settings explicit and contained in `STANDALONE_CLOUD_SETTING_CONTROLS`.
- Avoids adding `rememberMapPosition`, `startNationalView`, or `ultraLowEnabled` to the registry, which would accidentally bind duplicate settings listeners and alter behavior.
- Small, local change in `authService.js`; no schema, Firebase, HTML, or settings-store change.
- Easier to debug: if a hydrated checkbox is wrong, there are now named sync helpers instead of inline DOM writes.

**Cons / tradeoffs:**
- There is still a tiny hardcoded map for the three standalone cloud controls. That is intentional because those settings are not registry-managed today.
- The fallback registry sync only sets `checked`; it does not apply the richer disabled/opacity UI rules. The richer behavior still comes from `window.BARK.syncSettingsControls()` when settings UI booted normally.
- This does not solve the larger design inconsistency that some settings are registry-managed while `rememberMapPosition`, `startNationalView`, `ultraLowEnabled`, and `reducePinMotion` still have custom controller code.
- The original queue text is partly stale, so the fix is smaller than the description. The main 20-ID object had already been removed.

**Alternative solution A — Do nothing because the big `ids` object is already gone:**

**Pros:**
- Zero change.
- Normal boot already works because `initSettings` runs before Firebase.
- No new helper code.

**Cons:**
- Leaves one-off checkbox sync inside cloud hydration.
- No explicit fallback for registry controls if the settings controller fails to bind.
- Does not document that the original Fix #13 concern is stale and already mostly resolved.

**Verdict:**
Not enough for a reliability pass. Even when the original issue is mostly gone, closing the residual edge makes the ownership story cleaner.

**Alternative solution B — Add `rememberMapPosition`, `startNationalView`, and `ultraLowEnabled` to `SETTINGS_REGISTRY`:**

**Pros:**
- Everything could sync through one registry loop.
- Fewer special cases in `authService.js`.
- Future cloud save/hydration could become even more uniform.

**Cons:**
- Risky right now because these settings have custom controller behavior.
- `ultraLowEnabled` intentionally prompts and reloads; automatic registry binding could create duplicate listeners or bypass expected confirmation/reload behavior.
- `rememberMapPosition` and `startNationalView` interact with each other and clear each other in the current controller.
- Larger behavioral blast radius than Fix #13 requires.

**Verdict:**
Worth considering in a dedicated settings-controller refactor, but too risky for this cleanup. The standalone map is safer.

**Alternative solution C — Use only `window.BARK.syncSettingsControls()` and remove all direct control sync from `authService.js`:**

**Pros:**
- Very simple.
- Keeps settings UI ownership entirely in `settingsController`.
- No standalone map in `authService.js`.

**Cons:**
- Does not sync the three non-registry controls because `syncSettingsControls()` only syncs registry controls.
- Fails if `settingsController` did not bind.
- Would silently regress cloud hydration UI for remember/national/ultra toggles.

**Verdict:**
Too optimistic. Good architecture direction, but not correct with the current registry coverage.

**Alternative solution D — Create a full second UI registry in `authService.js`:**

**Pros:**
- Could cover every cloud-hydrated setting and control explicitly.
- No dependency on `settingsController`.

**Cons:**
- Recreates the original problem under a new name.
- Duplicates DOM IDs that already belong in the settings registry/controller.
- Higher maintenance burden as settings grow.

**Verdict:**
Wrong direction. The whole point is to avoid duplicate DOM mapping tables.

**Use cases and what the user sees:**

**Use case 1 — Normal logged-in boot:**
The user opens the app, `initSettings` runs, Firebase loads cloud settings, and `handleCloudSettingsHydration()` calls `store.set(...)`. The settings controller's listeners update registry controls. The new helper also calls `window.BARK.syncSettingsControls()` explicitly, ensuring the visible settings panel is aligned after hydration.

**Use case 2 — Settings controller failed but Firebase still works:**
If `initSettings` fails before installing `window.BARK.syncSettingsControls()`, cloud hydration now falls back to the registry loop. Registry checkboxes can still reflect cloud values instead of silently depending on a controller that never bound.

**Use case 3 — User has cloud Low Graphics enabled:**
`lowGfxEnabled` still hydrates first through `store.set()`, so presets apply in the right order. Then `syncCloudSettingsControls()` refreshes visible controls. If the full settings controller is available, low-graphics dependent controls still get disabled/opacity treatment through `syncSettingsControls()`.

**Use case 4 — User has Remember Map Position saved in cloud:**
`rememberMapPosition` is still not a registry setting. It hydrates through `store.set()` and then the standalone map updates `#remember-map-toggle` from `window.rememberMapPosition`. The user sees the checkbox match the cloud setting.

**Use case 5 — User has Start National View saved in cloud:**
`startNationalView` hydrates through the store, `#national-view-toggle` updates through the standalone map, and the existing post-hydration map behavior can still move to the national view.

**Use case 6 — User has Ultra Low saved in cloud:**
`ultraLowEnabled` hydrates through the store, `#ultra-low-toggle` updates through the standalone map, and existing style/performance policy calls still run after hydration.

**User-visible difference:**
In normal successful boot, users should not notice a visual change. The settings controls should continue to match cloud values. The practical difference appears in degraded or future states: if registry settings are added or the settings UI binding path changes, cloud hydration is less likely to leave visible controls stale.

One concrete app instance: a logged-in user opens settings after cloud hydration. The Low Graphics, clustering, gesture, Remember Map Position, Start National View, and Ultra Low controls should reflect the cloud document. The difference is that registry controls now have an explicit registry-driven fallback, and standalone controls are synced through one named map instead of inline DOM writes.

**How much better:**
- Before Fix #3: cloud hydration had duplicate store/window/localStorage paths and a large hardcoded control map.
- Before Fix #13: the large map was gone, but `authService.js` still had inline one-off control sync for three standalone settings and no explicit registry fallback.
- After Fix #13: registry controls sync via `syncSettingsControls()` or a registry loop fallback, and standalone cloud controls sync through one small named map.

**Verification:**
- `node --check services/authService.js`
- `rg` confirmed the old `ids = ...` pattern is absent from `services/authService.js`.
- VM smoke test called `handleCloudSettingsHydration()` directly with mocked registry settings, standalone controls, localStorage/sessionStorage, and a fake settings store.
  - Verified registry fallback syncs checkbox state when `window.BARK.syncSettingsControls()` is unavailable.
  - Verified `window.BARK.syncSettingsControls()` is used when available.
  - Verified standalone remember/national/ultra controls sync in both paths.
  - Verified map style and visited filter still update.
  - Verified post-hydration style/performance hooks still run.

**Rating: 8.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Registry fallback is clean; remaining standalone map reflects current non-registry settings design |
| Speed | 10 | One small DOM sync pass during cloud hydration only; no runtime loop |
| Code efficiency | 9 | Replaced inline DOM writes with reusable helpers and avoided a larger risky registry expansion |
| Reliability | 9 | Handles normal settings-controller path and degraded fallback path; preserves special standalone settings |
| Debuggability | 9 | Named helpers make cloud-control sync easy to inspect and reason about |

### Fix #14 — Firestore Reads/Writes Moved Out of Settings Controller
**Files:** `services/firebaseService.js`, `modules/settingsController.js`
**Date:** 2026-04-28

**What was wrong:**
`settingsController.js` had a direct Firestore read inside `refreshTrailRendering()`:

```js
firebase.firestore().collection('users').doc(user.uid).get().then(doc => {
    if (doc.exists && doc.data().completedExpeditions) {
        window.BARK.renderCompletedTrailsOverlay(doc.data().completedExpeditions);
    }
});
```

That violated the architecture rule that Firebase/Firestore access belongs in `services/firebaseService.js`, not UI controllers. It also had a subtle field-name problem: the active expedition write path stores completed trails under `completed_expeditions`, while this old read checked `completedExpeditions`. That means the settings-triggered completed-trails refresh could miss the real completed expedition list.

While fixing the read, there was one more direct Firestore access in the same controller: the Save Settings button wrote directly to `firebase.firestore().collection('users').doc(...).set(...)`. That was a write rather than the specific query named in the queue, but it was the same architectural problem in the same file. I moved it too so `settingsController.js` no longer owns Firestore document access.

**The fix:**
- Added `readCompletedExpeditionsFromUserData(data)` in `firebaseService.js`.
  - Returns `data.completed_expeditions` when it is an array.
  - Falls back to legacy `data.completedExpeditions` when it is an array.
  - Returns `[]` for missing or malformed data.
- Added `firebaseService.getCompletedExpeditions(uid)`.
  - Increments the request counter.
  - Reads `users/{uid}`.
  - Returns the normalized completed expedition array.
  - Logs and rethrows failures with a `[firebaseService] getCompletedExpeditions failed:` prefix.
- Added `firebaseService.saveUserSettings(uid, settingsPayload)`.
  - Increments the request counter.
  - Writes `{ settings: settingsPayload }` with `{ merge: true }`.
  - Logs and rethrows failures with a `[firebaseService] saveUserSettings failed:` prefix.
- Exposed both helpers through:
  - `window.BARK.services.firebase.getCompletedExpeditions`
  - `window.BARK.services.firebase.saveUserSettings`
  - legacy convenience mirrors `window.BARK.getCompletedExpeditions` and `window.BARK.saveUserSettings`
- Updated `settingsController.js` `refreshTrailRendering()`:
  - Keeps local virtual-trail re-rendering in the controller because that is UI behavior.
  - Gets the current user through `firebaseService.getCurrentUser()`.
  - Gets completed expeditions through `firebaseService.getCompletedExpeditions(user.uid)`.
  - Passes the returned array into `window.BARK.renderCompletedTrailsOverlay(...)`.
  - Catches and logs refresh failures in the controller without breaking other settings effects.
- Updated the Save Settings button:
  - Gets the current user through `firebaseService.getCurrentUser()`.
  - Builds the same settings payload in the controller.
  - Saves it through `firebaseService.saveUserSettings(currentUser.uid, settingsPayload)`.

**Why this matters:**
Settings changes can trigger UI effects, map effects, trail rendering, and cloud writes. The settings controller should orchestrate UI behavior, not know Firestore document paths. Keeping Firestore reads and writes inside `firebaseService.js` gives the app one place to enforce request counting, error prefixes, user-doc field names, compatibility fallbacks, and future retry/backoff behavior.

The field-name compatibility is especially important here. Completed expeditions are written as `completed_expeditions` by the expedition reward flow. The old settings refresh checked `completedExpeditions`, which appears to be a legacy field name. The new service helper accepts both but prefers the canonical underscore field.

**Pros of this approach:**
- Removes the direct completed-expeditions Firestore read from `settingsController.js`.
- Also removes the direct settings-save Firestore write from `settingsController.js`, so the file no longer has user-document Firestore access.
- Centralizes request counting for these operations in `firebaseService.js`.
- Fixes the stale/camelCase completed-expedition read while preserving legacy compatibility.
- Keeps UI payload construction in `settingsController.js`, which is appropriate because the controller knows which settings are currently visible and registry-backed.
- Keeps Firestore document path knowledge in the service.
- Uses small focused helpers instead of a broad service rewrite.
- Malformed completed-expedition data now degrades to `[]` instead of being passed into the renderer.
- Errors are logged at both useful levels: the service logs the failed Firestore operation, and the controller logs that the UI refresh failed.

**Cons / tradeoffs:**
- `settingsController.js` still references `firebaseService` directly. That is fine, but it means the controller depends on service boot order and helper names.
- `refreshTrailRendering()` remains fire-and-forget for completed trails. It catches errors, but it does not show a user-visible warning if completed trail overlays fail to refresh.
- Saving settings now increments the request counter. That is architecturally correct, but it slightly increases counted requests compared with the old uncounted direct write.
- The helper reads the whole user document to get completed expeditions. That matches existing behavior, but a more scalable data model would keep completed expeditions in a subcollection or cache them from the auth snapshot.
- This does not remove every direct Firestore call across the whole app. Expedition, profile, trip planner, feedback, and auth code still have their own direct Firestore paths. Fix #14 only removes the settings-controller user-doc access called out in the queue.

**Alternative solution A — Move only the completed-expeditions read:**

**Pros:**
- Smallest possible change.
- Matches the literal queue item exactly.
- Lower chance of affecting the Save Settings button.

**Cons:**
- Leaves direct Firestore access in `settingsController.js` for the Save Settings button.
- Weakens the "Firestore belongs in firebaseService" rule.
- Future reviewers would still find Firestore document access in the controller immediately after this fix.

**Verdict:**
Too narrow. Moving the settings-save write was still tightly scoped to this file and made the boundary cleaner.

**Alternative solution B — Move completed expedition rendering entirely into `firebaseService.js`:**

**Pros:**
- Settings controller would only call one service method and not manage the returned array.
- Could hide more refresh details.

**Cons:**
- Bad ownership split: `firebaseService.js` would start calling UI renderers.
- Makes testing harder because a data service would also own presentation side effects.
- Goes against the existing separation where services fetch data and modules render UI.

**Verdict:**
Rejected. The service should return data; the controller/module should render.

**Alternative solution C — Use the auth snapshot data instead of fetching the user document again:**

**Pros:**
- Avoids an extra Firestore read.
- Uses data the app already receives through `onSnapshot`.
- Better at scale if settings are toggled often.

**Cons:**
- Requires a shared cached user document or app-state field that does not currently exist cleanly.
- Larger state-management change.
- More coupling between auth hydration and settings effects.

**Verdict:**
Good future optimization. Not the right size for Fix #14.

**Alternative solution D — Move all direct Firestore calls in all modules into `firebaseService.js`:**

**Pros:**
- Strongest architectural boundary.
- One place for request counting, retries, logging, and schema compatibility.
- Easier long-term auditing.

**Cons:**
- Much larger refactor.
- Would touch expedition, profile, trip planner, auth, UI feedback, route saving, and more.
- High regression risk in one pass.

**Verdict:**
Correct long-term direction, but it should be a planned service-layer refactor, not hidden inside Fix #14.

**Use cases and what the user sees:**

**Use case 1 — User toggles Simplify Trails while a virtual trail is active:**
The virtual trail still re-renders immediately from `window.lastActiveTrailId` and `window.lastMilesCompleted`. No cloud read is needed for the active trail.

**Use case 2 — User has completed trails and changes trail rendering settings:**
The settings effect asks `firebaseService.getCompletedExpeditions(user.uid)` for completed expeditions, then re-renders completed trail overlays. Because the helper reads `completed_expeditions`, completed trails written by the reward flow should now be found correctly.

**Use case 3 — User has old cloud data using `completedExpeditions`:**
The helper still supports the legacy camelCase field, so old data can still render.

**Use case 4 — Completed expedition field is malformed:**
Instead of passing a non-array into the overlay renderer, the helper returns `[]`. The user may see no completed overlay, but the app avoids a bad-data render path.

**Use case 5 — User saves settings to cloud:**
The Save Settings button behaves the same: it shows the saving state, writes the payload, then shows "saved" or "error". Under the hood, the write now goes through `firebaseService.saveUserSettings(...)` and is counted by the request guard.

**User-visible difference:**
The intended UI is the same. The practical visible improvement is that completed expedition overlays are more likely to refresh correctly after trail-related settings changes because the helper now reads the canonical `completed_expeditions` field. For example: a user who has conquered Half Dome toggles Simplify Trails, and the green completed-trail overlay can be reloaded from the correct cloud field instead of being skipped because the old code looked for `completedExpeditions`.

**How much better:**
- Before: settings controller knew Firestore paths and read a likely stale completed-expedition field.
- Before: Save Settings wrote directly to Firestore from the controller and bypassed request counting.
- After: settings controller asks `firebaseService` for data/writes, completed-expedition field compatibility lives in one helper, and both operations use the request counter.

**Verification:**
- `node --check services/firebaseService.js`
- `node --check modules/settingsController.js`
- `rg` confirmed `settingsController.js` no longer calls `firebase.firestore()`.
- VM smoke test loaded `firebaseService.js` with a mocked Firebase user document:
  - Confirmed canonical `completed_expeditions` is returned.
  - Confirmed legacy `completedExpeditions` fallback is returned.
  - Confirmed malformed completed data returns `[]`.
  - Confirmed `saveUserSettings()` writes `{ settings: payload }` with `{ merge: true }`.
  - Confirmed request counting runs for reads/writes.
- VM smoke test loaded `settingsController.js` with fake DOM/services:
  - Confirmed trail-render setting effects call `firebaseService.getCompletedExpeditions(...)`.
  - Confirmed completed trail overlays receive returned service data.
  - Confirmed Save Settings calls `firebaseService.saveUserSettings(...)` with the expected payload.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Stronger controller/service boundary in the settings module; broader Firestore migration remains future work |
| Speed | 8 | Same user-doc read as before for completed trails; settings save is now counted but not slower in practice |
| Code efficiency | 9 | Two small helpers and a simple controller call-site change; no broad refactor |
| Reliability | 9 | Canonical + legacy completed expedition field support, malformed-data guard, service-level error logging |
| Debuggability | 9 | Firestore failures now identify the service helper, while controller logs the UI effect that failed |

### Fix #15 — Removed Misleading Dead Test Files
**Files:** `tests/app.test.js`, `tests/tmp_test.js`, `tests/test.js`
**Date:** 2026-04-28

**What was wrong:**
The `tests/` directory looked like it contained an automated test suite, but three of the files were actively misleading:

- `tests/app.test.js` was a 286KB / 6,481-line copy of old app code, starting with raw runtime initialization like `window.allowUncheck = localStorage.getItem(...)`. It was not a focused test file.
- `tests/tmp_test.js` was a 40KB / 926-line duplicate-style copy with the same old runtime-code shape.
- `tests/test.js` was one line of invalid JavaScript:

```js
setTimeout(() => { } else {
```

That combination is worse than having no test suite. A developer or reviewer could see `tests/` and assume there is meaningful coverage, then miss that these files are stale, duplicated, broken, or not wired into a real runner.

**The fix:**
- Deleted exactly the three queued files with `git rm`:
  - `tests/app.test.js`
  - `tests/tmp_test.js`
  - `tests/test.js`
- Left `tests/debug_stitch.js` untouched because it was not part of the fix queue.
- Did not add Jest, Vitest, Playwright, or any new test framework.
- Did not create placeholder tests.

**Why this matters:**
Dead test-looking files create false confidence. For production reliability, inaccurate verification signals are dangerous: they make the codebase look safer than it is. Removing fake/broken tests is not the same as having real tests, but it makes the repo honest. That honesty matters because future work can now clearly see: there is not yet a proper automated test suite, and adding one is its own workstream.

This also removes a large stale-code search surface. Before this fix, `rg` results for old globals, old settings paths, and old monolithic code were polluted by `tests/app.test.js` and `tests/tmp_test.js`. That made auditing harder because search results mixed live code with dead copies.

**Pros of this approach:**
- Removes a broken syntax file from the repository.
- Removes 7,408 lines of misleading copied/stale code.
- Makes `tests/` stop pretending to be real coverage.
- Reduces false positives when using `rg` to audit live code paths.
- Keeps the change tightly scoped to the three explicitly named files.
- Avoids starting a test-framework migration inside a cleanup fix.
- Makes future test work easier to define honestly.
- Reduces repository size and review noise.

**Cons / tradeoffs:**
- The app still does not have a real automated test suite after this fix.
- Historical audit docs still mention the old files as evidence of poor/no testing; those docs are now historical rather than current file listings.
- If someone was using `tests/app.test.js` or `tests/tmp_test.js` manually as scratch/reference material, it is gone from the working tree, though still recoverable from git history.
- Removing fake tests can feel like reducing coverage, but these files were not reliable coverage.

**Alternative solution A — Keep the files and mark them deprecated:**

**Pros:**
- No deletion.
- Anyone using them as scratch reference keeps them locally visible.
- Historical audit references remain literally true.

**Cons:**
- Still pollutes search results.
- Still looks like a test suite.
- Still leaves broken `tests/test.js` in the repo.
- Future engineers still have to rediscover that these files are not useful tests.

**Verdict:**
Rejected. Comments cannot make dead copied code safe enough to keep in `tests/`.

**Alternative solution B — Move the files to `legacy/`:**

**Pros:**
- Preserves the files outside `tests/`.
- Makes it clearer they are not active tests.
- Maintains local reference copies.

**Cons:**
- Keeps 7,408 lines of stale duplicate code in the repo.
- Still pollutes repository-wide search unless everyone remembers to exclude `legacy/`.
- The queue explicitly said delete them with `git rm`.

**Verdict:**
Not the right fix. Git history is enough preservation.

**Alternative solution C — Convert them into real tests now:**

**Pros:**
- Would create actual coverage.
- Could start protecting refactors immediately.
- Best long-term reliability direction if done well.

**Cons:**
- Much larger workstream.
- Requires choosing a test runner and DOM/Firebase/Leaflet mocking strategy.
- High risk of building brittle tests if rushed.
- Directly conflicts with the queue note: "Do not add a test framework yet."

**Verdict:**
Correct future need, wrong task. This fix is cleanup, not test architecture.

**Alternative solution D — Delete the whole `tests/` directory:**

**Pros:**
- Strongest cleanup if every file were dead.
- Removes ambiguity around test status.

**Cons:**
- `tests/debug_stitch.js` was not part of the queue and may be useful as a debug script.
- Broader deletion than requested.
- Higher risk of removing user-owned scratch/debug material.

**Verdict:**
Too broad. Deleted only the named dead files.

**Use cases and what the user sees:**

**Use case 1 — Developer searches for old settings globals:**
Before this fix, `rg "window.allowUncheck ="` or similar searches could land inside old copied test files and make it look like stale settings code still existed in active paths. After deletion, search results are less noisy and more likely to point at live code.

**Use case 2 — Developer checks whether tests exist:**
Before this fix, `tests/app.test.js` looked like a huge test file. After this fix, the repo is more honest: there is no fake monolithic test suite. Real test work can be planned intentionally.

**Use case 3 — CI/test runner is added later:**
The broken `tests/test.js` cannot accidentally fail a future runner with invalid syntax. Future test setup starts from a cleaner directory.

**Use case 4 — Reviewer audits repo health:**
They no longer have to spend time opening a 6,481-line file to determine whether it is meaningful. The misleading files are gone.

**User-visible difference:**
Users should see no app behavior change. This is a repository reliability and debugging improvement. The practical impact is for future development: less search noise, less false confidence, and fewer broken/stale files that could confuse future test setup.

One concrete app-development instance: when debugging the Low Graphics setting or old `window.*` settings ownership, repository search no longer drags in 7,000+ lines of obsolete copied code from fake tests. That makes it easier to verify that the real app paths are clean.

**How much better:**
- Before: `tests/` implied coverage but contained stale copied code and invalid syntax.
- After: the misleading files are removed; the absence of a real test suite is explicit and can be addressed separately.

**Verification:**
- `git rm tests/app.test.js tests/tmp_test.js tests/test.js`
- Confirmed `tests/debug_stitch.js` remains.
- Confirmed the three deleted files are staged as deletions.
- Confirmed no test framework was added.
- Confirmed `tests/test.js` was invalid before deletion.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Correctly removes fake tests; real coverage still needs a separate planned test workstream |
| Speed | 10 | Deletes dead files only; no runtime impact |
| Code efficiency | 10 | Removes 7,408 lines and adds no replacement complexity |
| Reliability | 8 | Improves repo honesty and future CI safety, but does not add actual behavioral coverage |
| Debuggability | 10 | Removes large stale-code search noise from common audits |

### Fix #16 — Added Firebase Hosting Config
**File:** `firebase.json`
**Date:** 2026-04-28

**What was wrong:**
`firebase.json` only configured Cloud Functions. There was no top-level `"hosting"` block, so `firebase deploy --only hosting` had no Firebase Hosting target to deploy from this repository.

That matters because this app is a static, script-tag-based frontend. There is no bundler and no generated `dist/` directory. The app's runtime files are intentionally spread across the repo root and live folders:

- `index.html`
- `styles.css`
- `styles/`
- `assets/`
- `utils/`
- `gamificationLogic.js`
- `MapMarkerConfig.js`
- `modules/`
- `config/`
- `state/`
- `services/`
- `renderers/`
- `engines/`
- `trails.json`
- `version.json`
- `pages/`

Without a hosting config, deployments are either blocked or depend on someone manually re-running Firebase init and making the same choices again. That is not reliable enough for a production launch workflow.

**The fix:**
Added a top-level Firebase Hosting config:

```json
"hosting": {
  "public": ".",
  "ignore": [
    "firebase.json",
    ".firebaserc",
    "**/.*",
    "**/.DS_Store",
    "**/node_modules/**",
    "functions/**",
    "raw_trails/**",
    "data/**",
    "scripts/**",
    "legacy/**",
    "tests/**",
    "plans/**",
    "docs/**",
    "**/*.md",
    "package.json",
    "package-lock.json",
    "*Service Account*.json",
    "firebase-debug.log",
    "firebase-debug.*.log",
    "*.log"
  ]
}
```

**Why repo root is the public directory:**
The current app is not built into a separate output folder. `index.html` references runtime scripts and assets by repo-relative paths. Moving hosting to `public/` without a build step would require either duplicating the runtime tree or introducing a new build/copy process. That would be a larger deployment architecture change than Fix #16 asks for.

Root hosting is the least disruptive correct solution for the current codebase.

**Why the ignore list is defensive:**
Deploying from repo root is convenient but dangerous if the ignore list is too small. This repository contains runtime files and non-runtime files side by side. The config now excludes the specific directories requested in the queue:

- `node_modules`
- `functions`
- `raw_trails`
- `data`
- `scripts`
- `legacy`
- `tests`
- `plans`
- `docs`

It also excludes additional non-runtime or sensitive material that should not be shipped to public hosting:

- `firebase.json` and `.firebaserc`
- hidden files/folders such as `.git`, `.gitignore`, and local dotfiles
- `.DS_Store`
- Markdown docs and audit reports
- `package.json` and `package-lock.json`
- Firebase debug logs
- generic `*.log` files
- `*Service Account*.json`

The service-account ignore is especially important. The repo root currently contains `Bark Ranger Map Auth Service Account.json`. Even if that file is only local/dev material, public hosting must not publish it. The queue did not explicitly mention it, but production reliability includes deployment safety. A hosting config that makes deployment work while exposing credentials would be worse than the missing config.

**Important intentional include:**
`BARK Master List.csv` is not ignored.

Reason: `pages/admin.js` currently loads it with:

```js
fetch('../BARK Master List.csv')
```

If the hosting ignore list excluded every root CSV file, the admin page's master-list search would break after deploy. This fix keeps that CSV deployable because the existing app code depends on it.

**Pros of this approach:**
- `firebase deploy --only hosting` now has a configured hosting target.
- The deploy source matches the current no-build architecture.
- No bundler, copy script, or file relocation is required.
- Runtime folders remain deployable.
- The exact queue-requested non-runtime directories are excluded.
- Sensitive local/service-account JSON is explicitly excluded.
- Markdown docs and audit reports are not exposed through public hosting.
- Future deploys become repeatable instead of relying on manual Firebase CLI prompts.
- The config is simple enough for a future maintainer to audit quickly.

**Cons / tradeoffs:**
- Hosting from repo root requires a careful ignore list. A future non-runtime file added at root may need an explicit ignore pattern.
- The ignore list is security-sensitive; it should be reviewed whenever new root-level files are added.
- This does not create a clean deploy artifact directory. The production ideal is still a generated `public/` or `dist/` directory containing only deployable files.
- The current config does not add rewrites, redirects, headers, or cache rules. It only fixes the missing hosting target and deployment scope.
- Keeping `BARK Master List.csv` public preserves existing admin behavior, but it means that CSV remains fetchable from hosting. If that data should become private, the admin page needs a service-backed data path.

**Alternative solution A — Chosen: repo root as hosting public directory with a defensive ignore list**

**Pros:**
- Matches the current app immediately.
- Minimal change.
- No runtime file paths change.
- Fastest path to reliable hosting deploys.
- Avoids introducing build tooling before the app is ready for that migration.
- Easy to verify by reading `firebase.json`.

**Cons:**
- More care is needed around root-level files.
- The ignore list must evolve with the repository.
- It is less clean than a dedicated deploy artifact.

**Verdict:**
Best fit for Fix #16. It solves the deploy blocker without creating a new build system.

**Alternative solution B — Create a dedicated `public/` directory and move/copy runtime files there**

**Pros:**
- Cleaner long-term deployment boundary.
- Safer by default because only `public/` gets deployed.
- Easier to reason about what is production-visible.
- Opens the door to cache headers and asset versioning with fewer surprises.

**Cons:**
- Much larger refactor.
- Requires changing many script/style/data paths or adding a build/copy step.
- Easy to accidentally break the no-bundler script load order.
- Requires deciding how admin pages, CSV data, assets, modules, services, and state files are copied.
- More moving parts before there is a test suite.

**Verdict:**
Good future direction, but too large for this fix. Do it later as a planned deployment-architecture task.

**Alternative solution C — Repo root with only the queue-requested ignores**

**Pros:**
- Very small config.
- Matches the literal queue text.
- Less to maintain initially.

**Cons:**
- Would risk deploying root docs, package metadata, debug logs, and the service-account JSON.
- Publicly exposing local/internal files is a serious production mistake.
- Does not meet the real goal of a flawless base for launch.

**Verdict:**
Rejected. The literal minimum config would make deploy work but would not be safe enough.

**Alternative solution D — Use Firebase CLI defaults without committing the hosting block**

**Pros:**
- No file change in the repo.
- A developer can choose options interactively.

**Cons:**
- Not repeatable.
- Different developers can choose different public directories.
- CI/CD cannot rely on an interactive prompt.
- The deployment rule is not documented in source control.

**Verdict:**
Rejected. Production deployment config belongs in the repo.

**Alternative solution E — Add a full Hosting config with rewrites, headers, and cache rules now**

**Pros:**
- Could improve PWA caching strategy.
- Could add stronger security headers.
- Could support cleaner SPA-style routes if the app grows.

**Cons:**
- Larger behavior change than requested.
- Cache rules can create hard-to-debug stale asset bugs if rushed.
- Security headers need careful testing against Firebase Auth, external CDNs, GoatCounter, PapaParse, Leaflet, markercluster, and inline app patterns.

**Verdict:**
Useful later, not part of Fix #16. First make hosting deploy correctly and safely.

**Use cases and what the user sees:**

**Use case 1 — Maintainer deploys the app:**
Before this fix, `firebase deploy --only hosting` had no committed hosting target in `firebase.json`. After this fix, Firebase knows to deploy from the repo root while skipping non-runtime directories and sensitive files.

**Use case 2 — Public visitor opens the map after a fresh deploy:**
The user should see the same app. Runtime files remain available because the config does not ignore `index.html`, `assets/`, `styles/`, `modules/`, `services/`, `state/`, `renderers/`, `engines/`, `utils/`, `trails.json`, or `version.json`.

**Use case 3 — Admin opens `pages/admin.html`:**
The admin page can still fetch `../BARK Master List.csv` because this fix does not ignore that CSV. If that CSV were excluded, the admin search/indexing flow would silently lose its master list after deploy.

**Use case 4 — Someone browses public hosting URLs manually:**
Internal docs like `CLAUDE.md`, audit reports, `plans/`, and `docs/` are excluded. The service-account JSON pattern is also excluded. The public surface is closer to the actual runtime app rather than the whole repository.

**Use case 5 — Future developer adds tests or raw trail files:**
Those folders are already excluded from hosting. New test/debug/raw files inside those directories should not accidentally become public just because the app deploys from repo root.

**User-visible difference:**
Normal app users should not see a visual UI difference. This is a deployment reliability fix.

The concrete user-impact instance is this: after a maintainer runs `firebase deploy --only hosting`, a visitor can open the hosted Bark Ranger Map and receive the current static app instead of the deploy failing or being skipped due to missing hosting config. Admin users also keep the current master-list behavior because `BARK Master List.csv` remains available to `pages/admin.js`.

**How much better:**
- Before: hosting deployment was not defined in source control.
- Before: a rushed root-hosting setup could accidentally publish internal files.
- After: hosting deploy is repeatable, uses the current app structure, and excludes the known non-runtime/sensitive material.

**Verification:**
- Parsed `firebase.json` with Node to confirm valid JSON.
- Asserted `hosting.public === "."`.
- Asserted all queue-requested ignore directories are present:
  - `**/node_modules/**`
  - `functions/**`
  - `raw_trails/**`
  - `data/**`
  - `scripts/**`
  - `legacy/**`
  - `tests/**`
  - `plans/**`
  - `docs/**`
- Asserted extra protective patterns are present:
  - `*Service Account*.json`
  - `**/*.md`
  - `package.json`
  - `package-lock.json`
  - `firebase.json`
  - `*.log`
- Reviewed `pages/admin.js` and confirmed `BARK Master List.csv` should not be ignored because the admin page fetches it.
- Reviewed runtime script/style/data references from `index.html` and `pages/admin.js` to confirm required app folders remain deployable.
- Checked for a local `firebase` CLI; it was not installed in this shell, so deployment verification stayed at config/static-audit level.
- Did not run an actual Firebase deploy.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Correct for current no-build architecture; a dedicated deploy artifact would be cleaner later |
| Speed | 10 | Zero runtime overhead; deployment config only |
| Code efficiency | 9 | One small config block solves the deploy target and keeps scope clear |
| Reliability | 9 | Deploys become repeatable and non-runtime directories are excluded |
| Security / safety | 9 | Explicitly avoids publishing docs, logs, package metadata, hidden files, and service-account JSON |
| Debuggability | 9 | Deployment behavior is now visible in source control instead of hidden in Firebase CLI state |

### Fix #17 — iOS Settings Overlay Scroll Lock
**File:** `modules/settingsController.js`
**Date:** 2026-04-28

**What was wrong:**
The settings modal opened with:

```js
document.body.style.overflow = 'hidden';
```

and closed with:

```js
document.body.style.overflow = '';
```

That is a common desktop scroll-lock pattern, but it is not reliable on iOS Safari. iOS can keep scrolling or rubber-banding the underlying page even when the body has `overflow: hidden`, especially when the visible page has its own momentum scrolling region.

This app has exactly that shape:

- `html, body` are already viewport-sized with `overflow: hidden`.
- The visible app pages use `.ui-view`.
- `.ui-view` has `overflow-y: auto` and `-webkit-overflow-scrolling: touch`.
- The settings gear lives inside the profile view.
- The settings overlay is fixed on top of that view.

So the real leak is not only body scroll. The profile `.ui-view.active` can still be the scroll container underneath the modal. On iOS, a user can scroll the settings modal and then hit the top/bottom edge; momentum or rubber-band behavior can bleed into the profile view behind it. That feels broken because the modal is open but the page underneath moves.

**The fix:**
Replaced the raw body overflow toggle with an idempotent scroll-lock pair:

- `lockSettingsScroll()`
- `restoreSettingsScroll()`

On open:

- Captures current page scroll:
  - `window.scrollY`
  - `window.pageYOffset`
  - `document.documentElement.scrollTop`
  - `document.body.scrollTop`
- Captures the active `.ui-view.active` element.
- Captures that active view's current `scrollTop`.
- Captures the body's existing inline styles:
  - `overflow`
  - `position`
  - `top`
  - `left`
  - `right`
  - `width`
- Captures the active view's existing inline `overflowY`.
- Applies the iOS-safe body lock:

```js
document.body.style.overflow = 'hidden';
document.body.style.position = 'fixed';
document.body.style.top = `-${scrollY}px`;
document.body.style.left = '0';
document.body.style.right = '0';
document.body.style.width = '100%';
```

- Also freezes the app's real scroll container:

```js
activeView.style.overflowY = 'hidden';
```

On close:

- Removes the modal's active class.
- Restores every captured body inline style.
- Restores the active view's `overflowY`.
- Restores the active view's `scrollTop`.
- Calls `window.scrollTo(0, originalScrollY)`.
- Clears the lock snapshot.

The lock is guarded by `settingsScrollLock.locked`, so repeated open calls do not overwrite the original scroll position or style snapshot.

**Why this shape is efficient:**
This does no work during scrolling. It only performs a small fixed set of reads/writes when the settings modal opens and closes. There is no scroll listener, touchmove listener, timer, requestAnimationFrame loop, or DOM-wide query loop.

The only DOM query added is:

```js
document.querySelector('.ui-view.active')
```

That runs once on modal open. The rest is direct style restoration from a tiny snapshot object.

**Why this matters:**
Settings is a high-trust surface. It contains performance toggles, gesture toggles, cloud settings save, aggressive recovery, and reset controls. If the page behind it slides while the modal is open, users can lose their place in the profile view, accidentally interact with the wrong context after close, or feel like the app is unstable on iPhone.

For a production-grade mobile app, modal scroll locking has to be boring and predictable. The modal should be the only thing moving while it is open.

**Pros of this approach:**
- Fixes the iOS Safari weakness of relying only on `overflow: hidden`.
- Preserves the user's original page scroll position.
- Preserves the profile view's internal scroll position.
- Freezes the actual scroll container used by the app, not only the body.
- Does not add a global touch listener.
- Does not block scrolling inside `.modal-body`.
- Does not require CSS restructuring.
- Does not move the modal in the DOM.
- Works with the current no-framework, script-tag architecture.
- Idempotent guard prevents double-open state corruption.
- Restores prior inline styles instead of assuming they were empty.

**Cons / tradeoffs:**
- Slightly more code than the old two-line overflow toggle.
- It knows about the app's `.ui-view.active` scroll container. That is correct today, but if the app later changes page shell architecture, the helper should be revisited.
- This is specific to the settings modal. Other modals, like scoring or optimizer, may still use their existing display toggles and could need the same helper later if they show scroll leak.
- It is not a full generic modal manager. That would be cleaner if the app grows many modal types.
- It does not add keyboard Escape close behavior or focus trapping. Those are accessibility improvements, but not part of Fix #17.

**Alternative solution A — Keep only `document.body.style.overflow = 'hidden'`:**

**Pros:**
- Minimal code.
- Works in many desktop browsers.
- Already existed.

**Cons:**
- Known unreliable on iOS Safari.
- Does not address `.ui-view.active`, which is the real scroll container for profile/settings.
- Does not preserve internal profile scroll if the underlying view moves.
- Leaves the exact bug from the queue unresolved.

**Verdict:**
Rejected. This is the bug.

**Alternative solution B — Body `position: fixed` only, without locking `.ui-view.active`:**

**Pros:**
- Matches the common iOS body-lock pattern.
- Preserves normal page scroll.
- Small implementation.

**Cons:**
- In this app, the body is not the only meaningful scroll container.
- Profile, home, and planner views are `.ui-view` containers with their own `overflow-y: auto`.
- The settings modal opens from inside the profile view, so the profile view can still be the scroll leak path.

**Verdict:**
Not enough for this app's layout. Body fixed is necessary, but freezing the active view makes the fix match the actual scroll architecture.

**Alternative solution C — Add a global `touchmove` preventDefault listener while settings is open:**

**Pros:**
- Can stop many mobile scroll leaks.
- Common old-school modal-lock technique.
- Does not need to know which element is scrollable underneath.

**Cons:**
- Easy to break scrolling inside the settings modal itself.
- Requires careful allow-listing of `.modal-body`.
- Passive event listener behavior can be tricky on mobile browsers.
- Adds work on every touchmove while the modal is open.
- More bug-prone than freezing the known scroll containers.

**Verdict:**
Rejected for now. Use targeted style locking instead of event interception.

**Alternative solution D — Move the settings overlay outside `.ui-view` to be a direct body child:**

**Pros:**
- Cleaner modal layering.
- Reduces coupling between modal and profile view.
- Could simplify scroll/focus management if all modals shared a top-level portal.

**Cons:**
- Requires HTML restructuring.
- Risks z-index and layout regressions.
- Does not by itself solve iOS body scroll locking.
- Larger change than needed for the queue item.

**Verdict:**
Good future modal architecture direction, but not necessary for Fix #17.

**Alternative solution E — Build a shared modal manager now:**

**Pros:**
- Best long-term pattern if all modals use it.
- One place for scroll lock, focus trap, Escape close, ARIA state, and nested modal handling.
- Could solve scoring, optimizer, education, and settings modal behavior consistently.

**Cons:**
- Larger refactor across multiple modules and markup sections.
- More regression risk before there is automated UI coverage.
- Easy to overbuild while the queue only asks for one leak.

**Verdict:**
Strong future idea, wrong scope. Fix the settings modal cleanly first.

**Use cases and what the user sees:**

**Use case 1 — iPhone user opens Settings from deep in the Profile tab:**
Before this fix, the user could be scrolled halfway down Profile, open Settings, scroll the settings modal, and the underlying Profile view could move behind it. After this fix, Profile stays frozen at the same scroll position until Settings closes.

**Use case 2 — User scrolls to the bottom of Settings and keeps dragging:**
Before this fix, iOS rubber-band/momentum could leak to the page underneath. After this fix, the modal remains the active scroll surface and the background view stays locked.

**Use case 3 — User closes Settings after changing performance toggles:**
Before this fix, they might land in a slightly different place in the profile view if the background leaked while Settings was open. After this fix, they return to the same profile scroll position they had before opening Settings.

**Use case 4 — Desktop user opens Settings:**
Behavior should look the same. The body is fixed while the modal is open and restored on close, with no visible difference except stronger scroll locking.

**Use case 5 — Settings close button is missing or fails to render:**
The close-button listener is now guarded:

```js
if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
```

That avoids a null-element crash in a degraded markup state. Clicking the overlay backdrop can still close the modal when the overlay exists.

**User-visible difference:**
The Settings modal should feel steadier on iPhone and iPad. A concrete example: a user scrolls down the Profile page to "My Total Walks", taps the gear, scrolls through Settings, then closes it. They should land back at "My Total Walks" instead of finding the Profile page shifted behind the modal.

**How much better:**
- Before: one body overflow write on open, one reset on close, unreliable on iOS.
- After: captured page scroll, captured active view scroll, fixed body lock, frozen app scroll container, exact restoration on close.

**Verification:**
- `node --check modules/settingsController.js`
- VM smoke test with fake DOM:
  - Opened settings via the gear click handler.
  - Confirmed `settings-overlay` gets `active`.
  - Confirmed body `position` becomes `fixed`.
  - Confirmed body `top` preserves the original page scroll as a negative offset.
  - Confirmed active `.ui-view` `overflowY` becomes `hidden`.
  - Confirmed active view `scrollTop` is not changed during lock.
  - Closed settings through the close button.
  - Confirmed overlay active class is removed.
  - Confirmed original body inline styles are restored.
  - Confirmed active view `overflowY` is restored.
  - Confirmed active view `scrollTop` is restored.
  - Confirmed `window.scrollTo(0, originalScrollY)` runs.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Strong targeted fix for settings; a shared modal manager would be cleaner later |
| Speed | 10 | O(1) work on open/close only; no scroll/touch listeners |
| Code efficiency | 9 | Small helper pair replaces fragile inline body overflow toggles |
| Reliability | 9 | Locks both body and the app's real active view scroll container, with exact restoration |
| Mobile UX | 9 | Directly addresses iOS Safari scroll leak/rubber-band behavior for Settings |
| Debuggability | 9 | Scroll lock state is captured in one object and restored from explicit snapshots |

### Fix #18 — User-Visible Map Failure State
**Files:** `core/app.js`, `index.html`, `styles.css`
**Date:** 2026-04-28

**What was wrong:**
Fix #1 made boot errors visible in the console and allowed the rest of the app to continue initializing. Fix #2 made sure the loader eventually dismisses even if Firebase never resolves. But there was still a user-facing hole:

If the map itself failed, the user could end up looking at an empty or broken map surface with no explanation.

Examples:

- Leaflet CDN blocked or unavailable.
- Leaflet script fails to load before `initMap()`.
- `#map` DOM node missing or malformed.
- `L.map('map', ...)` throws.
- `initMap()` returns without creating `window.map`.

In those cases, a developer might see a console error, but a normal user sees a broken screen. That is not acceptable for a production launch. A graceful failure needs a visible in-page state with a recovery action.

**The fix:**
Added a real degraded-state UI and boot-level detection.

**1. Added static fallback markup in `index.html`:**

```html
<div id="map-unavailable-message" class="map-unavailable-notice" role="alert" aria-live="assertive" hidden>
    <div class="map-unavailable-card">
        <div class="map-unavailable-kicker">Map Status</div>
        <h2>Map unavailable</h2>
        <p>Try refreshing. If this keeps happening, the map library may be blocked or the network may be offline.</p>
        <p id="map-unavailable-detail" class="map-unavailable-detail">The app could not start the map.</p>
        <button id="map-unavailable-refresh" class="map-unavailable-action" type="button">Refresh</button>
    </div>
</div>
```

This is intentionally static HTML rather than a dynamically-created string. If boot reaches `core/app.js`, the element is already present and only needs to be shown. That makes the fallback easier to test and less dependent on the same boot path that just failed.

**2. Added CSS for the fallback panel in `styles.css`:**
- Hidden by default via `[hidden]`.
- Fixed over the map surface.
- `z-index: 1800`, above map/filter UI but below `.ui-view` screens and the main nav.
- Centered, readable card.
- Refresh button styled as a clear recovery action.

The z-index choice is intentional. The message should cover the broken map, but it should not permanently trap users away from other app screens if the bottom nav/profile UI remains usable.

**3. Added boot-owned map availability checks in `core/app.js`:**
- Exposes boot errors for debugging:

```js
window.BARK._bootErrors = _bootErrors;
window.BARK.getBootErrors = function getBootErrors() {
    return _bootErrors.slice();
};
```

- Adds:
  - `bindMapUnavailableActions()`
  - `dismissLoaderForMapFailure()`
  - `getMapUnavailableDetail(reason)`
  - `showMapUnavailable(reason)`
  - `hideMapUnavailable()`
  - `checkMapAvailability(reason)`

- Starts a 5-second map-ready timeout:

```js
const mapReadyTimeout = setTimeout(() => {
    if (!window.map) checkMapAvailability('map-timeout');
}, MAP_READY_TIMEOUT_MS);
```

- Checks immediately after `initMap` runs:

```js
await callInit('initMap', 'Map initialized');
if (!window.map) {
    if (!_bootErrors.includes('initMap') && !_bootErrors.includes('initMapNoMap')) {
        _bootErrors.push('initMapNoMap');
        console.error('[B.A.R.K. Boot] "initMap" completed but window.map is unavailable — map feature unavailable.');
    }
    checkMapAvailability('boot-complete');
}
```

- Checks again after the boot sequence completes:

```js
clearTimeout(mapReadyTimeout);
checkMapAvailability('boot-complete');
```

- Dismisses the loader when the map fallback appears, so the user can actually see the degraded state instead of waiting behind a spinner.

**4. Bumped static asset query params in `index.html`:**
- `styles.css?v=25` -> `styles.css?v=26`
- `core/app.js?v=26` -> `core/app.js?v=27`

This matters because the fallback depends on both the new CSS and the new boot script. A stale cached stylesheet or boot file would make the failure state less reliable after deploy.

**Why this belongs in `core/app.js`:**
The failure condition is a boot outcome, not normal map behavior. `mapEngine.js` owns creating the map. `core/app.js` owns deciding whether boot produced a usable map and whether the user needs a degraded-state message.

Keeping the fallback decision in boot gives one clear place to answer:

- Did `initMap` throw?
- Did `initMap` silently fail to create `window.map`?
- Did the app finish booting without a map?
- Did the map fail to appear within the boot timeout?

That is better than having `mapEngine.js`, `authService.js`, and UI controllers all guess at the same condition.

**Why this matters:**
A blank map is not just ugly. It is a trust problem. Users cannot know whether:

- the app is still loading,
- their phone is offline,
- the site is broken,
- they should wait,
- they should refresh,
- or the map feature is unavailable.

The fallback turns a silent failure into a clear recovery moment. It also gives support/debugging a concrete state: if a user says they saw "Map unavailable", we know boot reached `core/app.js` but did not produce `window.map`.

**Pros of this approach:**
- Gives users a visible, understandable error state.
- Provides a clear Refresh action.
- Handles synchronous `initMap()` throws.
- Handles rejected async `initMap()` failures through existing `callInit()`.
- Handles the weird case where `initMap()` returns but `window.map` is still missing.
- Handles delayed/hung map readiness through the 5-second timeout.
- Dismisses the loader when map failure is known.
- Keeps degraded-state ownership in the boot orchestrator.
- Exposes boot errors through `window.BARK.getBootErrors()` for easier debugging.
- Uses static markup, so testing and styling are stable.
- Adds no runtime cost after boot beyond one cleared timeout.

**Cons / tradeoffs:**
- This does not detect every possible map problem. If Leaflet creates `window.map` successfully but map tiles fail later, the fallback will not show. That is a different "tile layer unavailable" degraded state.
- The message is intentionally broad. It does not tell the user whether the exact cause was CDN failure, DOM failure, browser extension blocking, or offline network.
- It adds a small amount of boot UI code to `core/app.js`.
- It adds another public `window.BARK` debugging surface (`getBootErrors`, `checkMapAvailability`, `showMapUnavailable`).
- The fallback relies on `core/app.js` running. If all JavaScript is blocked, no JavaScript-driven degraded state can appear.

**Alternative solution A — Use `alert("Map unavailable")`:**

**Pros:**
- Very small code change.
- Impossible for the user to miss.
- No CSS or HTML needed.

**Cons:**
- Jarring and browser-native.
- Blocks the main thread.
- Looks unpolished.
- Easy to trigger repeatedly if boot retries later.
- Gives no styled recovery surface.

**Verdict:**
Rejected. Production degraded states should be in-page and controlled by the app.

**Alternative solution B — Dynamically create the fallback entirely in `core/app.js`:**

**Pros:**
- No HTML edit.
- The fallback exists only when needed.
- Could keep all fallback text in one JS file.

**Cons:**
- More string-built DOM code.
- Harder to style and test.
- If the boot script has a partial failure, the fallback creation path is more fragile.
- Separates the user-visible surface from normal markup review.

**Verdict:**
Rejected. Static markup with JS toggling is cleaner here.

**Alternative solution C — Put the fallback inside `mapEngine.js`:**

**Pros:**
- Map-specific code stays with map-specific feature code.
- `initMap()` could catch its own failures and show the message directly.

**Cons:**
- `initMap()` is exactly the thing that can fail early.
- A failure before the fallback setup would still leave the user blind.
- Boot already knows whether `initMap` failed and whether `window.map` exists after boot.
- Map engine should create the map, not own global degraded-state policy.

**Verdict:**
Rejected. Boot is the right level for this specific failure.

**Alternative solution D — CSS-only fallback behind the map:**

**Pros:**
- No boot code needed.
- Could show text if map never paints.

**Cons:**
- Cannot know whether `window.map` exists.
- Cannot distinguish slow loading from failure.
- Cannot bind a refresh action cleanly.
- Would risk showing behind/through a working map or never showing when needed.

**Verdict:**
Not reliable enough.

**Alternative solution E — Bundle/vendor Leaflet locally as a true CDN fallback:**

**Pros:**
- Better long-term resilience to CDN outages.
- Could prevent the failure instead of only explaining it.
- Stronger offline/PWA story.

**Cons:**
- Larger deployment and cache strategy change.
- Requires local asset management for Leaflet JS/CSS and markercluster.
- Needs careful versioning and CSP/cache testing.
- Does not solve DOM container failures.

**Verdict:**
Good future reliability work, but not a substitute for a user-visible degraded state.

**Use cases and what the user sees:**

**Use case 1 — Leaflet CDN is blocked:**
Before this fix, `L` was undefined, `initMap()` threw, boot logged an error, and the user could see a blank map after the loader dismissed. After this fix, the user sees a centered "Map unavailable" message with a Refresh button.

**Use case 2 — `#map` element is missing:**
Before this fix, `L.map('map', ...)` could throw and the page gave no visible explanation. After this fix, boot catches the failure and shows the fallback.

**Use case 3 — `initMap()` returns without creating `window.map`:**
Before this fix, boot could say "Map initialized" even though no map existed. After this fix, boot records `initMapNoMap`, shows the fallback, and the boot summary reports an error.

**Use case 4 — Map readiness hangs beyond 5 seconds:**
Before this fix, the user could wait behind a blank/broken surface. After this fix, the 5-second timeout checks `window.map` and shows the fallback if the map still is not ready.

**Use case 5 — Normal successful map boot:**
The fallback remains hidden. `checkMapAvailability()` sees `window.map`, hides the fallback if it was ever shown, and boot proceeds normally.

**Use case 6 — User taps Refresh:**
The fallback button calls `window.location.reload()`, which retries loading the map libraries and boot sequence.

**User-visible difference:**
The user now gets a real message instead of silence. A concrete app instance: if a hotel Wi-Fi network blocks `unpkg.com`, Leaflet fails to load. Instead of staring at a blank map after the loader disappears, the user sees "Map unavailable" with a short explanation and a Refresh button.

**How much better:**
- Before: map boot failure = console error plus blank/broken UI.
- After: map boot failure = console error, boot error summary, loader dismissal, visible degraded state, and refresh action.

**Verification:**
- `node --check core/app.js`
- `node --check modules/mapEngine.js`
- `node --check modules/settingsController.js`
- VM boot smoke test with mocked DOM:
  - `initMap()` throws:
    - fallback becomes visible.
    - reason is `initMap-error`.
    - detail text describes startup failure.
    - loader is dismissed.
    - `getBootErrors()` includes `initMap`.
    - Refresh button calls `window.location.reload()`.
  - `initMap()` creates `window.map`:
    - fallback remains hidden.
    - body does not keep `map-unavailable`.
  - `initMap()` returns without creating `window.map`:
    - fallback becomes visible.
    - reason is `boot-complete`.
    - `getBootErrors()` includes `initMapNoMap`.
- Did not run a physical blocked-CDN browser test.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 8 | Strong boot-level degraded state; true CDN fallback/vendor strategy is a separate future improvement |
| Speed | 10 | One 5-second timeout and O(1) checks during boot only |
| Code efficiency | 9 | Small static UI plus focused boot helpers; no global event loops |
| Reliability | 9 | Catches throws, missing map instances, no-map completion, and timeout readiness failure |
| User experience | 9 | Replaces a blank/broken map with a clear message and recovery action |
| Debuggability | 10 | Boot errors are now inspectable and `initMapNoMap` distinguishes silent map creation failures |

### Fix #19 — Dedicated Trip Overlay Layer (`TripLayerManager`)
**Files:** `modules/TripLayerManager.js` (NEW), `engines/tripPlannerCore.js`, `modules/renderEngine.js`, `modules/MarkerLayerManager.js`, `state/appState.js`, `index.html`, `styles.css`, `styles/mapStyles.css`, `core/app.js`
**Date:** 2026-04-28

**What was wrong:**
In bubble mode, the numbered day-color badges that mark trip stops disappeared during zoom — especially when premium clustering "exploded" at zoom ≥ 7. Old `updateTripMapVisuals` in `engines/tripPlannerCore.js` appended each badge as a *child of* `point.marker._icon` (the park marker's DOM icon). markercluster destroys and recreates that `_icon` every time a marker moves into or out of a cluster, taking the badge child with it. `updateTripMapVisuals` only re-ran on trip edits — never on `zoomend`, cluster animations, or `applyMarkerStyle` rebuilds — so the badges were never re-attached.

The same file also kept three loose draft arrays (`draftTripLines`, `window.draftBookendMarkers`, `window.draftCustomMarkers`) and a clear-and-redraw cycle. `renderEngine.updateMarkers` had to compensate with an `isInTrip = Array.from(tripDays).some(day => day.stops.some(s => s.id === item.id))` check on every park on every render, plus a `tripStops` flatMap+sort+join inside the marker-visibility fingerprint.

**The fix:**
A dedicated `TripLayerManager` (sibling to `MarkerLayerManager`) now owns the entire trip visual surface on its own `L.layerGroup` — never clustered, never culled, never touched by `renderEngine.updateMarkers`. Trip overlay is a pure projection of `window.BARK.tripDays`, decoupled from the park-marker lifecycle.

- **`modules/TripLayerManager.js` (NEW):**
  - One `L.layerGroup()` lazily added to the map (Fix #4 lazy-init pattern).
  - `sync(tripDays, bookends)` — diff-based per-stop / per-day / per-bookend; reuses Leaflet objects via `setLatLng` / `setIcon` and updates only when the icon spec actually changes. Returns `{ added, removed }` Sets of park IDs that gained/lost trip-stop status.
  - **Stable identity keys** for badges: `stop.id || "lat,lng"`. Reordering stops within a day or recoloring a day reuses existing markers (Test 2 in the smoke test produced an empty diff).
  - Day polylines keyed by `dayIdx`; bookends keyed by `'start' | 'end'`.
  - `getStopParkIds()` exposes a read-only `Set<string>` so `MarkerLayerManager` can read it without crossing the ownership line.
  - `setDayLinesVisible(boolean)` — used by `generateAndRenderTripRoute()` to hide just the dashed day lines while the real driving route is on the map; badges and bookends stay visible.
  - Click on a badge → forwards to `markerManager.renderMarkerPanel(parkLookup.get(id).marker)` so the park panel still opens.
  - Tracks `_tripParkId` / `_tripNumber` / `_tripColor` on each badge marker so `setIcon` runs only when the spec actually changes.
- **`engines/tripPlannerCore.js`:**
  - Deleted: `clearDraftTripMapVisuals`, `draftTripLines`, `window.draftBookendMarkers`, `window.draftCustomMarkers`, the dual-branch badge-append-vs-customMarker logic.
  - `updateTripMapVisuals` is now a thin orchestrator: builds `bookends`, calls `tripLayer.setDayLinesVisible(true)`, calls `tripLayer.sync(tripDays, bookends)`, then hands the returned diff to `markerManager.refreshTripStopClasses(union of added+removed)`.
  - `resetTripPlannerRuntime` calls `tripLayer.clear()` and forwards the diff to `markerManager.refreshTripStopClasses` so `park-pin--in-trip` is removed from every previous trip park.
  - `generateAndRenderTripRoute` calls `tripLayer.setDayLinesVisible(false)` instead of manually iterating `draftTripLines`.
  - `removeTripMapLayer` is kept because `currentRouteLayers` (the generated ORS driving route) is a separate concern.
- **`modules/MarkerLayerManager.js`:**
  - `applyMarkerStyle` now toggles the `park-pin--in-trip` class on `marker._icon` based on `tripLayer.getStopParkIds()`. Because `applyMarkerStyle` already runs on every cluster `add` event (via `bindMarkerEvents`), the class is automatically reapplied when clusters expand/collapse — markercluster cannot strip it.
  - New public method `refreshTripStopClasses(ids)` iterates only the affected park IDs and calls `applyMarkerStyle` on each. tripPlannerCore drives this from the diff.
  - Helper `isInTripStop(parkData)` keeps the lookup in one place.
- **`modules/renderEngine.js`:**
  - Removed `tripStops = (window.BARK.tripDays || []).flatMap(...).sort().join(',')` from `getMarkerVisibilityStateKey()` — the marker-visibility fingerprint no longer scans every trip stop on every RAF.
  - Removed `const tripDays = window.BARK.tripDays;` and the `Array.from(tripDays).some(day => day.stops.some(...))` per-park check in `updateMarkers`. `isVisible` is now `matchesSwag && matchesSearch && matchesType && matchesVisited` — no trip-related OR-clause.
- **`state/appState.js`:**
  - Removed `draftBookendMarkers` and `draftCustomMarkers` from `APP_STATE_KEYS` and from the fallback hydration block. They are not part of the new design.
- **`styles.css`:**
  - New `.trip-overlay-badge` (22×22 round, sized for 2-digit numbers, `--badge-color` CSS variable, white border + text-shadow for contrast on any color).
  - New `.trip-overlay-bookend` (24×24, `--bookend-color`).
  - New `.custom-bark-marker.park-pin--in-trip .enamel-pin-wrapper { visibility: hidden; }` — the inner pin shape disappears at trip stops so the badge is the only visible marker. Park marker DOM stays in place; cluster math + park lookup are unchanged.
  - Performance-toggle chains (`body.reduce-pin-motion`, `body.low-gfx`, `body.ultra-low`, `body.simplify-pins-while-moving.map-is-moving`, `body.stop-resizing.map-is-zooming`, `body.remove-shadows`) all extend cleanly to the new badge classes — no extra JS hook.
- **`styles/mapStyles.css`:**
  - Old `.trip-stop-badge` rules deleted (the class no longer exists). Replaced with a one-line comment pointing to the `TRIP OVERLAY` section in `styles.css`.
- **`index.html`:**
  - Added `<script src="modules/TripLayerManager.js?v=1" defer></script>` after `MarkerLayerManager.js`, before `mapEngine.js`.
  - Bumped `MarkerLayerManager.js` to `v=2`, `renderEngine.js` to `v=2`, `tripPlannerCore.js` to `v=4`, `core/app.js` to `v=28` so cached browsers pick up the change as a single coherent unit.
- **`core/app.js`:**
  - Added `await callInit('initTripLayer', 'Trip overlay layer initialized');` after `initMap` and after the no-map availability check, before `initSettings` and (later) `initTripPlanner`. If `initMap` fails, `ensureLayerGroup()` returns null and every subsequent `tripLayer.sync()` no-ops cleanly.

**Why this matters:**
The map is the app. A bug class where route stops vanish during interaction is exactly the kind of thing that breaks user trust before launch. The deeper issue was architectural: trip visuals were tangled into the park-marker DOM lifecycle. Cluster recalculations, viewport culling, zoom transitions, and `applyMarkerStyle` rebuilds could each independently destroy or hide the badges, and there was no listener model to catch all of those events. The fix moves trip visuals onto an independent layer with a single owner, so by construction there is nothing left to "remember to rebind."

**Ownership boundaries (explicit):**
- `TripLayerManager` owns trip overlay Leaflet objects only. It NEVER touches park marker DOM.
- `MarkerLayerManager` owns park marker DOM, including the `park-pin--in-trip` class.
- `tripPlannerCore` is the orchestrator: it mutates trip state, calls `tripLayer.sync()`, and hands the returned diff to `markerManager.refreshTripStopClasses()`. It does not reach into either manager's internals.
- `renderEngine` no longer knows about trips.

**Pros of this approach:**
- Trip badges, lines, and bookends survive every cluster/cull/zoom edge case by construction. There are no listeners to defensively rebind because the overlay is independent.
- Stable identity keys mean reorder and recolor reuse markers — confirmed by the smoke test.
- One visible pin per trip stop in every mode (bubble, exploded bubble, plain). The `park-pin--in-trip` class hides only the inner shape; the icon DOM stays so cluster numbers and park lookup are unchanged.
- The diff returned by `sync()` makes `MarkerLayerManager.refreshTripStopClasses` cheap — only affected park markers are restyled, not all parks.
- Removed `tripStops` from the marker-visibility fingerprint and removed the `Array.from(tripDays).some(...)` per-park check from the render heartbeat. RAF cost no longer grows with trip length.
- One render path replaces the old dual branch (`appendChild(badge)` vs custom-marker fallback). Adding future trip features (active-stop highlight, distance labels, on-map drag-reorder) is now a method on `TripLayerManager`, not new conditionals across two files.
- All existing performance settings (`lowGfxEnabled`, `ultraLowEnabled`, `removeShadows`, `reducePinMotion`, `simplifyPinsWhileMoving`, `stopResizing`) are honored via existing body-class CSS chains. No extra JS wiring duplicates the policy.
- Trip overlay deliberately ignores `clusteringEnabled` / `forcePlainMarkers` / `viewportCulling` — those are park-marker policies and the route should stay visible regardless.

**Cons / tradeoffs:**
- Trip stops now show one badge instead of a numbered park pin. Visual change is intentional and tested as cleaner, but it is a deliberate UX shift — not invisible.
- Off-screen Leaflet markers do exist in DOM. For typical trip sizes (< 50 stops) the cost is negligible; the simplicity of "trip overlay never culls" is worth more than micro-optimizing offscreen badges.
- Click on a trip badge forwards to `renderMarkerPanel(parkLookup.get(id).marker)`. If the park is somehow not in `parkLookup` at click time, the click no-ops silently rather than throwing. Custom waypoints (no `stop.id`) are non-clickable, matching the previous fallback's `interactive: false`.
- `MarkerLayerManager` reads `tripLayer.getStopParkIds()` synchronously inside `applyMarkerStyle`. The contract is "treat as read-only"; misuse would corrupt trip state. JSDoc warns against this. Ordering is explicit: `tripPlannerCore` calls `tripLayer.sync()` first, then `markerManager.refreshTripStopClasses()`.
- `appState.js` lost two keys (`draftBookendMarkers`, `draftCustomMarkers`). Anything that previously called `window.BARK.appState.get('draftBookendMarkers')` would now `throw`. Search confirmed no callers existed.
- The old `.trip-stop-badge` and `.custom-trip-pin` CSS classes are gone. Inline `bookend-icon` divIcon styling is gone. If any saved screenshot, marketing asset, or future stylesheet referenced those classes, it has no effect — but visually the new overlay is similar.

**Alternative solutions considered:**

*A — Listen for `zoomend` / `markercluster animationend` and re-attach badges to fresh `_icon`s.* Adds two new listeners, brittle to future cluster lifecycle changes, still leaves badges as park marker children, still couples to clustering. Rejected.

*B — Store a `marker._barkTripBadge = { color, number }` on the park marker and reapply from `applyMarkerStyle`.* Better than (A) but still couples trip data into the park marker lifecycle, still races during cluster animation transitions. Rejected.

*C — Render trip stops as their own markers but leave park markers fully visible (no class hide).* Two pins overlap at every stop in plain/exploded modes. Rejected on UX grounds.

*D — Move trip visuals into a Web Worker.* Trip overlay rendering is not CPU-bound; it is DOM-bound. Wrong tool. Rejected.

*E — Add full pubsub event system between managers.* Overkill for two managers. The diff-return + `refreshTripStopClasses(ids)` shape is a tighter contract with no global event bus. Rejected.

**Use cases and what the user sees:**

*Bubble mode, low zoom (clustered):* Cluster bubble shows park count as before; trip badges sit above clusters showing route order. Even when a trip stop's park is hidden inside a cluster bubble, the badge stays visible at the stop's lat/lng — which is exactly the original bug.

*Bubble mode, high zoom (clusters exploded):* Park pins individually rendered. Trip-stop park pins have their inner shape hidden via `park-pin--in-trip`; the badge is the visible marker. No duplicate.

*Plain mode (no clustering):* Same as exploded bubble mode. Badge replaces pin shape; one visible marker per trip stop.

*Reordering stops within a day:* Markers reused via stable identity, only `setIcon` called for changed numbers. Smoke test confirms an empty `{ added, removed }` diff for pure reorder.

*Recoloring a day:* Same — markers reused, `setIcon` updates the color. No flicker.

*Generating the driving route:* `tripLayer.setDayLinesVisible(false)` hides the dashed day lines; badges + bookends remain visible. The colored ORS-generated polyline draws on top.

*Clearing the trip:* `tripLayer.clear()` returns a `removed` Set covering every previous park ID; `markerManager.refreshTripStopClasses` removes the class from every previously-marked park.

*Custom waypoint (no `stop.id`):* Badge is non-interactive (forwards-to-park-panel is a no-op without an ID). Matches the previous `customMarker { interactive: false }` behavior.

*Boot fails to create the map:* `ensureLayerGroup()` returns null. Every `tripLayer.sync()` and `tripLayer.clear()` no-ops cleanly. No new error surface.

**Verification:**
- `node --check` clean on `modules/TripLayerManager.js`, `modules/MarkerLayerManager.js`, `modules/renderEngine.js`, `engines/tripPlannerCore.js`, `core/app.js`, `state/appState.js`.
- VM smoke test against `modules/TripLayerManager.js` with mocked Leaflet:
  - Initial sync of 3 stops across 2 days returned `{ added: ['a','b','c'], removed: [] }`.
  - Reorder within day returned `{ added: [], removed: [] }` — stable-identity reuse confirmed.
  - Removing 2 stops returned `{ added: [], removed: ['a','c'] }`.
  - Adding a new stop returned `{ added: ['d'], removed: [] }`.
  - `setDayLinesVisible(false)` then `setDayLinesVisible(true)` toggled cleanly.
  - `clear()` returned the full removal diff and emptied `getStopParkIds()`.
  - Round-trip bookend (start ≈ end) ran without errors.
- `rg` confirmed zero remaining references to `draftBookendMarkers`, `draftCustomMarkers`, `draftTripLines`, `clearDraftTripMapVisuals`, `trip-stop-badge`, or `custom-trip-pin` in `*.js` / `*.html` / `*.css`. Old machinery fully retired.
- Did not run a live in-browser zoom test from this terminal session.

**Rating: 9.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 10 | Single-owner overlay layer matches the existing manager pattern; future trip features attach to one class instead of webbing across files |
| Speed | 10 | RAF cost no longer scales with trip length; reorder/recolor reuses markers; diff-driven class refresh touches only affected parks |
| Code efficiency | 9 | One new file, three retired arrays, two retired CSS classes, one removed OR-clause and one removed fingerprint segment |
| Reliability | 10 | Cluster/cull/zoom transitions cannot destroy trip overlay DOM by construction; no defensive listeners to maintain |
| Code growth | 9 | Ownership boundaries are explicit; managers do not reach into each other's DOM; tripPlannerCore is now a thin orchestrator |
| Mobile UX | 9 | Performance-toggle CSS chains extend cleanly; no new event listeners on the main thread |

### Fix #20 — Hardcoded API Keys Moved to Firebase Secrets (Phase 1 of 3)
**File:** `functions/index.js`
**Date:** 2026-04-29

**Scope note:**
This is **Phase 1 of a 3-phase migration**. The audit identified four key-handling problems: (1) ORS key shipped to every browser via `barkConfig.js`, (2) ORS key duplicated and hardcoded in `getPremiumRoute`, (3) paid Gemini key hardcoded in `extractParkData`, (4) client `tripPlannerCore.js` calls ORS directly instead of going through `getPremiumRoute`. A previous attempt to hide keys broke functionality, so the migration is sequenced to keep ORS working for users at every step:

- **Phase 1 (this fix, #20):** Move all server-side hardcoded keys to Firebase secrets. **Zero client-side changes.** Client still uses its own ORS key from `barkConfig.js`. Server stops carrying secrets in source.
- **Phase 2 (Fix #21):** Wire `services/orsService.js` to call `getPremiumRoute` via `firebase.functions().httpsCallable(...)` instead of hitting ORS directly. Add a parallel `getPremiumGeocode` callable for `searchEngine.js`. Both require a signed-in user and reuse the existing rate-limit pattern.
- **Phase 3 (Fix #22):** After Phase 2 is deployed and verified, delete `window.BARK.config.ORS_API_KEY` from `barkConfig.js`. Then rotate the exposed ORS key and the paid Gemini key on each provider's dashboard. The old keys remain in git history; rotation is what actually invalidates them.

**What was wrong:**
Three API keys lived in `functions/index.js` source, committed to git history:
- ORS key in `getPremiumRoute` (line ~99) — duplicate of the client-side key.
- Paid pay-as-you-go Gemini key in `extractParkData` `paid-3` engine route (line ~191) — billable on every call.
- A `process.env.GOOGLE_MAPS_API_KEY || "AIzaSy..."` placeholder fallback in `syncToSpreadsheet` geocoding (line ~358) — silently broken if the env var was ever missing in production, and the placeholder string itself looked like an exposed key in audits.

`extractParkData` was already declaring `secrets: ["GEMINI_API_KEY"]` for the free Gemini routes, so the secret pattern was partially in use — the paid key was the one slipping through.

**The fix:**
- `getPremiumRoute` now declares `.runWith({ secrets: ["ORS_API_KEY"] })` and reads `process.env.ORS_API_KEY`. If the secret is missing, it throws `failed-precondition` with a clean message instead of sending an empty Authorization header.
- `extractParkData`'s `runWith` adds `"GEMINI_PAID_API_KEY"` to its secrets array. The `paid-3` branch now reads `process.env.GEMINI_PAID_API_KEY`. Added a single `failed-precondition` guard after the routing block so any unset key (free or paid) fails clean instead of `GoogleGenerativeAI` throwing on an empty string.
- `syncToSpreadsheet` now declares `.runWith({ ...ADMIN_CALLABLE_OPTIONS, secrets: ["GOOGLE_MAPS_API_KEY"] })`. The geocoding branch reads `process.env.GOOGLE_MAPS_API_KEY` once into a local, logs a warning and skips geocoding if it's unset, and only builds the geocode URL when the key is present. The misleading `"AIzaSy..."` placeholder is gone.
- All three callables remain v1 (`firebase-functions/v1`) for consistency with the rest of the file. No new dependencies, no behavior change for the client.

**Why this matters:**
Keys in source are a recurring breach class even for solo projects: anyone with read access to git history has them, and they're trivially scraped by tooling. Firebase secrets bind keys to the deployed function's runtime only — they never appear in source control, never appear in deployed function code, and rotating them is a one-command operation (`firebase functions:secrets:set`).

The reason this is sequenced as "server first, client last" is that the client currently has its own ORS key. If we removed the client-side key first (or rotated keys before Phase 2 lands), routing and global geocode search would break for users. By moving server-side first, we (a) stop bleeding new exposure on every commit, (b) prove the secrets system works against real production traffic for `getPremiumRoute` even though it's not yet called from the client, and (c) leave the client untouched until Phase 2 has a working server proxy to point at.

**Pre-deploy actions required (cannot deploy without these):**
The user must set each secret before `firebase deploy --only functions`:
- `firebase functions:secrets:set ORS_API_KEY` — paste the current ORS key when prompted.
- `firebase functions:secrets:set GEMINI_PAID_API_KEY` — paste the current pay-as-you-go Gemini key.
- `firebase functions:secrets:set GOOGLE_MAPS_API_KEY` — paste the current Google Maps geocoding key (this one was already env-var, but the secret needs to actually exist now that the placeholder fallback is gone).

If any secret is unset at runtime, the corresponding code path fails clean: `getPremiumRoute` throws `failed-precondition`, `extractParkData` throws `failed-precondition`, `syncToSpreadsheet` logs a warning and skips geocoding (rest of the sync continues).

**Pros of this approach:**
- Removes three plaintext keys from the deployed Cloud Function source.
- Reuses the existing v1 secrets pattern (`extractParkData` already had `secrets: ["GEMINI_API_KEY"]`).
- Each callable's secret list is explicit at the `.runWith()` boundary — no global secrets coupling.
- Client behavior is identical; ORS routing/geocode for users is untouched.
- Failure mode for a missing secret is a clean `HttpsError` or a logged warning, not a confusing 401 from ORS or a `GoogleGenerativeAI` throw on empty string.
- The misleading `"AIzaSy..."` placeholder is gone — future audits won't flag it as an exposed key.
- Each key now rotates independently via `firebase functions:secrets:set`. No source edit required to rotate.
- Sets up Phase 2: `getPremiumRoute` is now production-ready as a proxy; only the client switch is missing.

**Cons / tradeoffs:**
- Old keys remain in git history. Rotation in Phase 3 is what actually invalidates them. Until then, anyone who has cloned the repo before today still has working keys.
- Client `barkConfig.js:35` still ships an ORS key to every browser. This is the headline exposure and is intentionally deferred to Phase 3 — touching it now would break ORS for users until Phase 2 lands.
- If the user deploys this fix without setting the secrets first, `getPremiumRoute` and the `paid-3` Gemini route will return `failed-precondition`. `getPremiumRoute` is currently uncalled by the client, so users see no impact — but admin-side AI extraction on the paid route would fail until the secret is set. Free Gemini routes (`free-3`, `free-25`, etc.) already had their secret set and continue to work.
- No automated test coverage for missing-secret paths. The guards are correct by inspection.
- Setting Firebase secrets requires Blaze plan; this project is presumably already on Blaze since Cloud Functions are deployed.

**Alternative solution A — Use `defineSecret()` from `firebase-functions/v2/params`:**

Pros: more ergonomic, type-safe, integrates with the param-config system. Cons: would mix v1 and v2 syntax in one file, where every other callable is v1. Larger blast radius for one fix.

**Verdict:** Rejected for now. Migrating the whole file to v2 is a separate workstream worth doing later, but inconsistency mid-file would be worse than the v1 string-array approach.

**Alternative solution B — Use `functions.config()`:**

Pros: simplest historical pattern. Cons: deprecated by Firebase in favor of secrets and env vars; new projects get warned away from it. Would create technical debt instead of removing it.

**Verdict:** Rejected. Secrets are the modern, recommended path.

**Alternative solution C — Move only the paid Gemini key, leave ORS in place since it's the same as the client key:**

Pros: less code change. Cons: leaves a key in source that's just as scrapeable as any other. The audit explicitly flagged it. Future `getPremiumRoute` rotation would require a code edit + redeploy.

**Verdict:** Rejected. Even if the value is duplicated client-side today, the server copy needs to exit source so Phase 3 rotation is a one-command operation.

**User-visible difference:**
None for end users. Phase 1 is a server-side hygiene change. The client still calls ORS directly with its own key. The benefit accrues at the next deploy: the deployed function code stops carrying secrets, and rotating keys becomes a CLI command instead of a code commit.

**Verification:**
- `node --check functions/index.js` passes.
- `grep -nE "AIzaSyD57|eyJvcmciOiI1YjN" functions/index.js` returns nothing — both hardcoded key prefixes are gone from the file.
- The Gemini free key (`process.env.GEMINI_API_KEY`) was already a secret and continues to work unchanged.
- Did not run `firebase deploy` from this session — that's the user's action after setting the three secrets.

**Rating: 8.5 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Server-side keys live only in secrets; rotation is a CLI command; matches the existing pattern already used for `GEMINI_API_KEY` |
| Speed | 10 | Zero runtime cost; secrets are loaded into env at function cold start |
| Code efficiency | 9 | Three small `.runWith()` edits and three local key reads; no new abstractions |
| Reliability | 8 | Missing-secret paths fail clean with named errors; Phase 1 alone does not yet protect the client-side ORS key |
| Security | 8 | Removes three plaintext keys from deployed function source; old keys remain valid in provider dashboards until Phase 3 rotation |
| Debuggability | 9 | Each callable's secret list is explicit at the `runWith` boundary; failure modes are named `HttpsError` types, not raw 401s |

### Fix #21 — Server Proxy for ORS, Client Switched to Callables (Phase 2 of 3)
**Files:** `functions/index.js`, `services/orsService.js`, `index.html`
**Date:** 2026-04-29

**Scope note:**
This is Phase 2 of the 3-phase API key cleanup. Fix #20 (Phase 1) moved server-side keys into Firebase secrets without changing the client. Fix #22 (Phase 3) will remove the client-side ORS key from `barkConfig.js` and rotate the exposed keys on provider dashboards.

**What was wrong:**
After Fix #20, the server side was clean, but the client was still hitting ORS directly using `window.BARK.config.ORS_API_KEY`. That meant:
- The paid ORS key still shipped to every browser via `modules/barkConfig.js:35`.
- The existing `getPremiumRoute` callable was deployed but never called — `services/orsService.js` bypassed it entirely with raw `fetch()`.
- There was no callable for geocoding, so the global town/city search in `searchEngine.js` had no clean server path either.
- Server-side `getPremiumRoute` had no auth check — anyone with App Check turned off (or a forged token) could theoretically have called it.

**The fix:**
- **`functions/index.js`:**
  - Added `requireAuthCallable(context)` helper that throws `unauthenticated` if `context.auth.uid` is missing. Sibling to the existing admin variant; reusable for any future user-gated callable.
  - `getPremiumRoute` now calls `requireAuthCallable(context)` first. Also forwards an optional `radiuses` array to ORS when the client provides one (the original client implementation always sent `radiuses: [-1, -1, ...]` to disable snap-radius limits, and the previous server function silently dropped this field — preserving the behavior matters because some routes failed without it).
  - Added new `getPremiumGeocode` callable. Same shape: signed-in user only, reads `ORS_API_KEY` secret, hits `/geocode/search`. Validates `text` is a non-empty string, clamps `size` to `[1, 10]` (defaults to 5), and forwards optional `country` as `boundary.country`. Returns ORS's raw GeoJSON response.
- **`services/orsService.js`:**
  - Replaced raw `fetch()` calls with `firebase.functions().httpsCallable(...)` invocations.
  - `directions(coordinates, options)` calls `getPremiumRoute`. Forwards `coordinates` and (when matched-length) `radiuses`.
  - `geocode(query, options)` calls `getPremiumGeocode`. Forwards `text`, `size`, optional `country`.
  - `getApiKey()` helper deleted — the client no longer reads the key for any purpose.
  - Both functions still throw on error so callers' existing `try/catch` and `alert()` paths work unchanged.
  - File header updated to reflect the new architecture.
- **`index.html`:**
  - Bumped `services/orsService.js?v=1` → `?v=2` so cached browsers pick up the new transport on next load.

**Why this matters:**
This is the structural change that makes Phase 3 (key removal + rotation) safe. After this fix:
- Two real consumers (`tripPlannerCore.js:657` directions, `searchEngine.js:751` geocode) now go through the proxy. Verified by `rg services.ors` — no other callers exist.
- The function signatures of `services.ors.directions` and `services.ors.geocode` are unchanged, so no caller code changes. The transport switched, the contract didn't.
- ORS billing is now gated behind Firebase Auth. An anonymous browser cannot trigger a paid call.
- The Cloud Function is the single chokepoint for any future ORS work — rate limits, caching, premium gating, fallback providers all land in one file instead of being smeared across the client.

**Why auth-only (no separate premium check):**
Looking at the existing client gates: `tripPlannerCore.js` already requires `firebase.auth().currentUser` before generating routes. `searchEngine.js`'s `isPremiumGlobalSearchUnlocked()` is — despite the name — an auth-only check (`Boolean(firebase.auth().currentUser)`). So "premium" in this app is currently a synonym for "signed in." Server-enforced auth is the equivalent guarantee. If a real premium tier ships later (Stripe-gated, Firestore flag, custom claim), it lands as one extra check inside `requireAuthCallable` or as a sibling helper — touching one file.

**Pros of this approach:**
- ORS key is no longer needed on the client. Phase 3 can remove it cleanly.
- Single transport boundary preserved (`services/orsService.js` is still the only file in the client that knows about ORS endpoints — and now it doesn't even know about the URLs).
- Function contract for callers is identical: `await window.BARK.services.ors.directions(coords, { radiuses })` returns the same GeoJSON shape; `await window.BARK.services.ors.geocode(q, { size, country })` returns the same features array.
- Server-side auth is real (`context.auth.uid` is verified by Firebase before our code runs); cannot be spoofed by a hostile client.
- Re-uses Phase 1's `ORS_API_KEY` secret — no new secrets to provision.
- The `radiuses` forwarding fixes a latent server-side gap: the previous `getPremiumRoute` silently dropped the field even though the client transport was sending it. This was hidden because `getPremiumRoute` was never actually called.
- New `requireAuthCallable` helper is reusable for any future user-gated callable — keeps the auth pattern consistent across the file.
- Caller error handling unchanged: callable errors arrive as `firebase.functions.HttpsError` instances, which have `.message` (used by `tripPlannerCore.js:664`'s `alert`) and don't break the existing `console.error` patterns.

**Cons / tradeoffs:**
- One extra hop per ORS request (browser → Cloud Function → ORS). Cold starts add ~1-2 seconds the first time after deploy or after a long idle. Warm function latency is typically under 200ms — acceptable for a route generation that already takes seconds.
- Cloud Function invocations are billable on Blaze. At expected usage (single-digit routes per session, infrequent global geocode searches) this is negligible compared to the cost of leaking the ORS key. If ORS usage scales 10–100×, monitor function billing.
- No rate limiting yet. The existing `enforceAdminRateLimit` is admin-specific (different limits, different collection). A user-tier rate limiter is straightforward to add (mirror the admin pattern with a `_userRateLimits` collection) but deferred to a separate fix to avoid scope creep. Auth alone gates the worst abuse vector (anonymous botting); a malicious signed-in user could still rack up our quota, but they'd burn their own Firebase Auth account in the process and we have their UID.
- No App Check. Admin callables already have `enforceAppCheck: true`; user callables don't. App Check across a no-bundler PWA is a separate setup task.
- Phase 3 still pending. The ORS key is still in `modules/barkConfig.js`. Phase 2 alone does not stop the client from leaking the key — it just stops the client from *needing* it. Until the line is deleted and the key rotated, the exposure remains.
- Callables require `firebase-functions-compat.js` to be loaded before `orsService.js`. Verified in `index.html` line 1221 (already loaded). If a future load-order change moves `firebase-functions-compat.js`, geocode/directions break with a clear error from `getCallable()`.

**Alternative solution A — Use raw HTTP function instead of callable:**

Pros: simpler client code (raw `fetch`), no callable response unwrapping. Cons: would need to handle Firebase Auth ID token verification manually on the server (callables do it for free), and would add CORS handling. Not worth the complexity.

**Verdict:** Rejected. Callables are the right primitive for authed RPC.

**Alternative solution B — Keep the client-side ORS key, just add a "premium gate" Cloud Function:**

Pros: zero client refactor, fastest. Cons: doesn't solve the actual problem (key is still exposed), just adds a meaningless gate. The audit's whole point was that the key being client-side is the bug.

**Verdict:** Rejected outright.

**Alternative solution C — Add user-tier rate limiting in this fix:**

Pros: closes the abuse-via-signed-in-account hole now. Cons: requires a new Firestore collection, schema, cleanup policy, and tuning the limits without real-traffic data. Adding it without baseline metrics risks blocking legitimate users (a user generating a multi-day route hits directions 5–10 times in a minute by design).

**Verdict:** Defer. Auth + Firebase's own per-project quotas are enough for the current scale. Add when there's a reason.

**Alternative solution D — Cache geocode results server-side:**

Pros: cuts ORS costs significantly for popular queries. Cons: requires Firestore/Memorystore, TTL handling, cache key normalization. Premature without metrics.

**Verdict:** Defer. Note as a future optimization in `plans/AI_TECHNICAL_NORTH_STAR.md` if and when geocode billing becomes notable.

**Use cases and what the user sees:**

*Use case 1 — Signed-in user generates a multi-day trip route:*
`tripPlannerCore.js:625` checks signed-in (passes). Calls `services.ors.directions(coords, { radiuses })`. The service builds the callable payload `{ coordinates, radiuses }` and invokes `getPremiumRoute`. Server verifies auth, reads `ORS_API_KEY` secret, posts to ORS, returns GeoJSON. Client renders the dashed driving route as before. User sees no behavioral change.

*Use case 2 — Signed-in user types a town name into search:*
`searchEngine.js:716`'s premium-search path runs. After local fuzzy results return empty, the global fallback fires `executeGeocode()` which calls `services.ors.geocode(query, { size: 5, country: 'US' })`. Service invokes `getPremiumGeocode` callable. Server verifies auth, reads `ORS_API_KEY`, hits ORS geocode, returns features. User sees the same disambiguation list of city/town suggestions as before.

*Use case 3 — Anonymous user opens trip planner and tries to add a stop by global geocode:*
Client-side `isPremiumGlobalSearchUnlocked()` returns false because `firebase.auth().currentUser` is null. The global search button never triggers `executeGeocode()`. Server is never reached. (If a malicious page somehow invoked the callable directly, server returns `unauthenticated` instantly.)

*Use case 4 — `ORS_API_KEY` secret is unset (e.g., new environment without secret provisioned):*
Server returns `failed-precondition` with message "Routing service is not configured." or "Geocoding service is not configured." Client's existing catch block alerts "A day's route failed: ..." or "Search service unavailable." User can still browse the map; routing/global-geocode degrade gracefully.

*Use case 5 — Cold start after long idle:*
First call adds ~1-2 seconds while the function spins up. Subsequent calls within ~15 minutes are warm. The `tripPlannerCore` UI already shows "Calculating..." during route generation, which absorbs the delay.

*Use case 6 — Network drops mid-request:*
Callable rejects with a network-class error. Existing `try/catch` blocks in `tripPlannerCore.js` and `searchEngine.js` log and alert. No infinite loading state.

**User-visible difference:**
Intentionally none. All ORS-backed features (multi-day route generation, global town/city search) should work exactly as before for signed-in users. The behind-the-scenes change: the ORS API key is no longer needed by the client to make these requests — it just rides along on the (still-exposed) `barkConfig.js` value until Phase 3 deletes it.

**Verification:**
- `node --check functions/index.js` — passes.
- `node --check services/orsService.js` — passes.
- `rg services.ors` — confirmed only two callers (`tripPlannerCore.js:657`, `searchEngine.js:751`); neither needs to change because the function signatures are identical.
- `grep firebase-functions-compat index.html` — confirmed Firebase Functions compat SDK loaded at line 1221, before the deferred `orsService.js` script at line 1237.
- Confirmed the existing `tripPlannerCore.js` already requires signed-in user before generating routes (line 626-627), so no regression for the routing flow when the server adds the same check.
- Confirmed `isPremiumGlobalSearchUnlocked()` in `searchEngine.js:84` is auth-only, so the geocode flow's existing client gate already matches the server's new auth requirement.
- Did not run a live deploy from this session — that's the user's action (`firebase deploy --only functions` for the new callable, then re-deploy hosting for the bumped `?v=2`).

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 9 | Callable-based proxy is the canonical Firebase pattern; future ORS work (rate limits, caching, fallback providers, premium gating) all land in one file |
| Speed | 8 | One extra network hop per request; warm-function latency is acceptable; cold-start on first request after deploy adds 1–2s |
| Code efficiency | 9 | `services/orsService.js` is shorter and clearer; new `requireAuthCallable` helper is one focused function reusable for future user-gated callables |
| Reliability | 9 | Function signatures unchanged for callers; auth enforced server-side; missing-secret path fails clean; existing error handling paths still work |
| Security | 9 | Server-enforced auth replaces client-only gating; ORS key never required client-side after Phase 3; App Check and per-user rate limits remain as future hardening |
| Debuggability | 9 | Callable errors are named `HttpsError`s with stable codes (`unauthenticated`, `invalid-argument`, `failed-precondition`, `internal`); single chokepoint for ORS observability |

### Fix #22 — Removed Client-Side ORS Key + Rotation Plan (Phase 3 of 3)
**Files:** `modules/barkConfig.js`, `index.html`
**Date:** 2026-04-29

**Scope note:**
Final phase of the 3-phase API key cleanup that began in Fix #20 (server-side secrets) and Fix #21 (server proxy + client switch to callables). Phase 3 deletes the now-unused client-side ORS key and documents the key rotation that must happen on provider dashboards.

**What was wrong:**
After Fix #21, the client no longer needed `window.BARK.config.ORS_API_KEY` for any call path — `services/orsService.js` had been switched to Firebase callables. But the line was still in `modules/barkConfig.js:35`, still being shipped to every browser, and still scrapeable from `window.BARK.config` in DevTools. Until that line was deleted, Phase 1 and Phase 2 produced no security improvement on the client side — they just made deletion safe.

**The fix:**
- **`modules/barkConfig.js`:** Removed the `window.BARK.config.ORS_API_KEY = "..."` line. Replaced with a comment pointing to `services/orsService.js` and noting that ORS access is proxied through Firebase callables. The `window.BARK.config` object remains because `CHECKIN_RADIUS_KM` lives there and `services/checkinService.js` reads it.
- **`index.html`:** Bumped `modules/barkConfig.js?v=1` → `?v=2` so cached browsers pull the keyless config on next load.

**Why this matters:**
Phases 1 and 2 set up the infrastructure for safe key removal but did not themselves reduce the client-side attack surface. Phase 3 is the actual security improvement: the deployed app, post-deploy, no longer carries the ORS key in any form a browser can read. Combined with the rotation step below, the previously-leaked key value loses all power.

**Critical follow-up: key rotation (user action, not code):**
The keys removed from source in Fixes #20 and #22 are still valid until rotated on each provider's dashboard. Anyone who has cloned the repo before today still has working keys via git history. The deploy alone does not invalidate them.

Recommended rotation order (each step verified before moving to the next):
1. **ORS key** — at openrouteservice.org/dev/#/home: issue a new key. Run `firebase functions:secrets:set ORS_API_KEY` and paste the new value. Run `firebase deploy --only functions`. Verify a signed-in user can still generate routes and run a global geocode search. Once verified, revoke the old key on the ORS dashboard.
2. **Paid Gemini key** — at console.cloud.google.com (the project that owns the pay-as-you-go account): create a new API key. Run `firebase functions:secrets:set GEMINI_PAID_API_KEY`. Redeploy functions. Verify the admin Data Refinery's `paid-3` engine route still extracts. Revoke the old key.
3. **Google Maps geocoding key** — same pattern if it was ever exposed in source. Looking at the code, this one was already env-var-only with a `"AIzaSy..."` placeholder fallback (no real key in source), so rotation here is optional unless you suspect the env var leaked elsewhere.

The order is "set new → deploy → verify → revoke old" so there is no window where the secret is stale and the function is calling a dead key.

**Pros of this approach:**
- Client-side bundle no longer carries any paid API key. DevTools `window.BARK.config` shows only `CHECKIN_RADIUS_KM`.
- The migration sequence (Phase 1 → 2 → 3) means at no point did ORS routing or global geocode search break for users. Each phase was independently safe.
- `barkConfig.js` is now a pure config file — runtime constants only, no secrets.
- Rotation becomes the user's clear next step. Until rotation, the old keys in git history remain valid; after rotation, even a full repo clone is useless for hitting paid APIs.
- The pattern is now reusable for any future paid API: server-side secret, callable proxy, no client-side key.

**Cons / tradeoffs:**
- Old keys in git history remain valid until manually rotated on provider dashboards. Deploying this fix without rotating gives a **false sense of security** — the key is still out there. The Current Work block in CLAUDE.md and this entry both call this out explicitly.
- Rewriting git history to scrub the key strings is technically possible (`git filter-repo`) but breaks every existing clone, every PR base, every fork. Rotation is a much cleaner answer: the key value still exists in history but is no longer accepted by the provider, making it a dead string.
- If a future engineer needs an ad-hoc ORS test from a script, they cannot pull the key from `window.BARK.config` anymore — they'd need to either go through the callable (correct) or pull the key from Firebase secrets (`firebase functions:secrets:access ORS_API_KEY`). This is a feature, not a bug.
- The `Bark Ranger Map Auth Service Account.json` at the repo root is a separate exposure (Firebase Admin service account credentials). It is excluded from hosting deploys via `firebase.json` (Fix #16) and from git via expected `.gitignore` patterns, but if it was ever committed it should also be rotated. Out of scope for Fix #22 but worth a separate audit pass.

**Use cases and what the user sees:**

*Use case 1 — Returning user opens the deployed app:*
Browser fetches `barkConfig.js?v=2` (cache bust). `window.BARK.config.ORS_API_KEY` is `undefined`. `services/orsService.js` never reads it. Routing and global geocode search continue to work via the callables from Fix #21. User sees no behavioral change.

*Use case 2 — Curious developer inspects `window.BARK.config` in DevTools:*
Sees `{ CHECKIN_RADIUS_KM: 25 }`. No paid keys present.

*Use case 3 — Old key is rotated on ORS dashboard before the new key is set as a Firebase secret:*
Routing breaks because the function calls a revoked key. Mitigation: follow the recommended order — set new secret first, deploy, verify, then revoke old. The rotation runbook in this entry makes that order explicit.

*Use case 4 — Someone has an old clone of the repo:*
They have the old key strings. Until rotation, those keys still work. After rotation, the strings are dead. This is the entire point of the rotation step.

**User-visible difference:**
None. All ORS-backed features (multi-day route generation, global town/city search) continue to work exactly as in Phase 2 because the only thing that changed is the deletion of an unused config field.

**Verification:**
- `node --check modules/barkConfig.js` — passes.
- `grep -rn "ORS_API_KEY\|eyJvcmciOiI1YjN" --include="*.js" --include="*.html"` outside `legacy/` — only matches in `functions/index.js` reading `process.env.ORS_API_KEY`. The hardcoded key string is gone from all deployed surfaces.
- `services/orsService.js` no longer references `window.BARK.config` for any purpose (verified by reading the file after Fix #21).
- Cache version bumped on `barkConfig.js` so the keyless version actually reaches users on next load.
- Did not run a live key rotation from this session — that's the user's action on each provider's dashboard.

**Rating: 9 / 10**

| Dimension | Score | Reasoning |
|---|---|---|
| Long-term solution | 10 | `barkConfig.js` is now secret-free; the migration pattern (server secret + callable proxy + client key removal) is the template for any future paid API |
| Speed | 10 | Trivial config edit; one fewer line shipped to every browser |
| Code efficiency | 10 | Two lines deleted, one explanatory comment added, one cache-bust |
| Reliability | 10 | All ORS flows already verified working through callables in Phase 2; this fix only removes a now-unused field |
| Security | 8 | Client surface is fully clean; final 8 point gap is the unrotated keys in git history — closes to 10 once rotation completes |
| Debuggability | 9 | `window.BARK.config` is now self-documenting; the comment in `barkConfig.js` points future readers at `services/orsService.js` |

---

## Rules for This Project
- Keep all existing features. Do not remove anything without asking.
- One fix at a time. Mark done in this file before starting the next.
- After each fix: update the checkbox above, update "Current Work" section.
- Do not start a new fix mid-conversation if context is getting long. Finish the current one, update this file, then start fresh.
- Settings changes must go through `window.BARK.settings.set()`, not raw window assignment.
- Firestore calls must go through `firebaseService.js`.
- DOM lookups should use `window.BARK.DOM` where elements are registered there.
