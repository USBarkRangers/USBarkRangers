# B.A.R.K. Ranger Map — Senior Codebase Audit Report

**Auditor:** Roo (Senior Software Engineer)  
**Date:** 2026-04-27  
**Codebase Version:** v26 (Modular Architecture)  
**Total Lines:** ~5,611 across 14 JS files + 1,437-line `index.html`

---

## 1. EXECUTIVE SUMMARY

This codebase is a **client-side-only web application** built with vanilla JavaScript, Leaflet.js, and Firebase (auth + Firestore), split from a monolithic file into 12 module files plus 2 root-level class files. The refactor achieved **physical file separation** but failed to achieve **architectural separation**. The fundamental problem is that every module communicates through a single global namespace (`window.BARK` and raw `window.*` variables), creating a **tightly-coupled god-object masquerading as modular architecture**. The "data service" file ([`dataService.js`](modules/dataService.js)) is the worst offender at 1,250 lines — it contains CSV parsing, Firebase auth initialization, the entire `onAuthStateChanged` handler (270+ lines of deeply nested logic), UI rendering for admin panels, cloud settings hydration, and DOM manipulation for the slide panel. This single file alone violates every principle of separation of concerns. State is scattered across `window.*` globals (20+ mutable settings), `localStorage` (20+ keys), and Firestore documents with no clear ownership boundary. There is zero testability — no dependency injection, no interfaces, no seams. Error handling is inconsistent: some Firebase calls have try/catch, many don't, and critical operations like `syncUserProgress()` will silently crash if Firebase is unavailable. The codebase would not survive a 2x feature expansion without significant rearchitecting.

---

## 2. TOP 5 STRUCTURAL ISSUES (Ranked by Severity)

### Issue #1: `dataService.js` Is a 1,250-Line God Module

**Problem:** [`dataService.js`](modules/dataService.js) contains:
- Firebase initialization and auth state management (lines 874–1230)
- CSV parsing engine (lines 86–531)
- Data polling with hash-based deduplication (lines 536–660)
- Version checking (lines 662–711)
- The entire marker click handler with full DOM manipulation (lines 177–481)
- Visited place sync, streak tracking, admin tools
- Cloud settings hydration (lines 937–1026)
- Saved routes CRUD with pagination (lines 717–851)

**Why it matters:** This file is the #1 source of coupling in the system. Any change to Firebase schema, UI rendering, or data format requires editing this file. An AI agent asked to "fix the marker click behavior" would also find itself in the middle of auth logic and CSV parsing. The 270-line `onAuthStateChanged` callback is a maintenance landmine — it handles settings hydration, expedition sync, leaderboard loading, admin UI, premium filter unlocking, and visited places hydration in a single nested callback.

**Concrete fix:**
1. Extract [`initFirebase()`](modules/dataService.js:874) and `onAuthStateChanged` into a dedicated `authController.js`
2. Extract the marker click handler (lines 177–481) into [`renderEngine.js`](modules/renderEngine.js) or a new `panelRenderer.js`
3. Extract cloud settings hydration into [`settingsController.js`](modules/settingsController.js)
4. Extract saved routes CRUD into [`tripPlanner.js`](modules/tripPlanner.js)
5. Keep only CSV fetch/parse/poll in [`dataService.js`](modules/dataService.js)

---

### Issue #2: Global Mutable State Explosion (`window.*` as State Store)

**Problem:** [`barkState.js`](modules/barkState.js) declares 20+ boolean settings as raw `window.*` properties:

```javascript
window.allowUncheck = localStorage.getItem('barkAllowUncheck') === 'true';
window.standardClusteringEnabled = localStorage.getItem('barkStandardClustering') !== 'false';
window.premiumClusteringEnabled = localStorage.getItem('barkPremiumClustering') === 'true';
window.lowGfxEnabled = false;
window.simplifyTrails = ...
window.instantNav = ...
// ... 15 more
```

These are read and written by [`settingsController.js`](modules/settingsController.js), [`mapEngine.js`](modules/mapEngine.js), [`dataService.js`](modules/dataService.js), [`renderEngine.js`](modules/renderEngine.js), and [`expeditionEngine.js`](modules/expeditionEngine.js) — with no validation, no change notification, and no single source of truth. The same `window.clusteringEnabled` is computed **twice** in [`barkState.js`](modules/barkState.js:22) (line 22 and line 52). Cloud settings hydration in [`dataService.js`](modules/dataService.js:937) overwrites these globals silently, potentially mid-render.

**Why it matters:** Any module can mutate any setting at any time with no traceability. Race conditions between localStorage hydration, cloud hydration, and ultra-low override logic are inevitable. Debugging "why is this setting wrong" requires tracing 5+ files.

**Concrete fix:** Create a `SettingsStore` class with:
- Typed getters/setters
- Change event emission (pub/sub)
- Single hydration entry point (local → cloud → override)
- Validation on set

---

### Issue #3: Massive DOM Manipulation Inlined in Business Logic

**Problem:** Almost every module directly manipulates the DOM using `document.getElementById()` with hardcoded element IDs. Examples:

- [`dataService.js`](modules/dataService.js:192) line 192: `titleEl.textContent = d.name || 'Unknown Park'` (inside CSV processing)
- [`dataService.js`](modules/dataService.js:196) line 196: `metaContainer.innerHTML = \`...\`` (HTML template string in data layer)
- [`profileEngine.js`](modules/profileEngine.js:201) line 201: Full HTML badge rendering with inline styles
- [`expeditionEngine.js`](modules/expeditionEngine.js:253) line 253: `document.getElementById('expedition-intro-state').style.display = 'none'`
- [`tripPlanner.js`](modules/tripPlanner.js:393) line 393: 400+ characters of inline HTML/CSS per stop item

**Why it matters:** This creates **invisible coupling** to the HTML structure. Renaming an element ID in [`index.html`](index.html) silently breaks functionality with no error. There's no templating system — all UI is built via string concatenation with inline styles, making visual changes require editing 5+ JS files. This is the antithesis of separation of concerns.

**Concrete fix:**
1. Introduce a minimal view-binding pattern: each module exports data, a separate renderer consumes it
2. Replace inline HTML strings with template functions or a lightweight template engine
3. Centralize element ID references into a `domRefs.js` constants file

---

### Issue #4: Duplicated Distance Calculation Logic

**Problem:** The Haversine distance formula appears in **three separate implementations**:

1. [`barkState.js`](modules/barkState.js:116): `haversineDistance(lat1, lon1, lat2, lon2)` — returns km
2. [`expeditionEngine.js`](modules/expeditionEngine.js:268): `getDistanceMeters(lat1, lon1, lat2, lon2)` — returns meters
3. [`tripPlanner.js`](modules/tripPlanner.js:39): Calls `window.BARK.haversineDistance()` but also does inline `distKm * 0.621371` conversion

Score calculation is duplicated between:
- [`profileEngine.js`](modules/profileEngine.js:86) line 86: `(verifiedCount * 2) + regularCount + sanitizeWalkPoints(walkPoints)`
- [`profileEngine.js`](modules/profileEngine.js:391) line 391: Same formula repeated in `updateStatsUI()`
- [`gamificationLogic.js`](gamificationLogic.js:60) line 60: Same formula inside `evaluate()`

**Why it matters:** If the scoring formula changes (e.g., verified visits become 3 points), it must be updated in 3+ locations. The distance functions use different units (km vs meters) with no consistent API, creating conversion bugs.

**Concrete fix:**
1. Consolidate into a single `geoUtils.js` with `distanceKm()`, `distanceMeters()`, `distanceMiles()`
2. Move score calculation into [`gamificationLogic.js`](gamificationLogic.js) exclusively; other modules call `gamificationEngine.calculateScore()`

---

### Issue #5: Hardcoded API Keys in Client-Side Code

**Problem:** Two API keys are embedded directly in source:

1. [`barkConfig.js`](modules/barkConfig.js:24): Firebase config (apiKey, appId, etc.) — **acceptable** for client-side Firebase
2. [`searchEngine.js`](modules/searchEngine.js:287): OpenRouteService API key hardcoded as `hardcodedApiKey`
3. [`tripPlanner.js`](modules/tripPlanner.js:512): Same ORS key duplicated

**Why it matters:** The ORS API key is exposed in client-side code and **duplicated** across two files. If the key is rotated, both files must be updated. More critically, there's no rate limiting on geocode calls beyond the global session counter — a malicious user could exhaust the ORS quota.

**Concrete fix:**
1. Move ORS calls to a Firebase Cloud Function (the project already has a `functions/` directory)
2. At minimum, extract the key to [`barkConfig.js`](modules/barkConfig.js) as `window.BARK.ORS_API_KEY` to eliminate duplication

---

## 3. WHAT IS ACTUALLY WELL-DESIGNED

1. **Boot sequence orchestrator ([`app.js`](app.js))**: Clean, zero-logic entry point with defensive `typeof` checks before calling each init function. The numbered phase comments create a clear mental model of startup order. This is textbook orchestration.

2. **Request safety throttle ([`barkState.js`](modules/barkState.js:78))**: The `incrementRequestCount()` / `SESSION_MAX_REQUESTS` pattern is a genuine production safeguard against runaway Firebase costs. The kill-switch propagation through polling loops (`safeDataPoll`, `safePoll`) is well-implemented with exponential backoff.

3. **CSS-based marker visibility ([`renderEngine.js`](modules/renderEngine.js:165))**: Using `classList.add('marker-filter-hidden')` instead of Leaflet's `addLayer`/`removeLayer` is a smart performance optimization that avoids cluster recalculation. The batched class updates (lines 180–183) prevent layout thrashing.

4. **Property accessors on BARK namespace ([`barkState.js`](modules/barkState.js:139))**: Using `Object.defineProperties` with getters/setters ensures modules always get live references to mutable arrays like `allPoints`. This prevents stale-reference bugs that plague naive module splits.

5. **Data polling with hash deduplication ([`dataService.js`](modules/dataService.js:536))**: The `quickHash` + `seenHashes` Map with revision-time ordering prevents both unnecessary re-renders and stale-data regressions. The debounced rendering queue (`isRendering` / `pendingCSV`) correctly handles overlapping fetches.

6. **GamificationEngine class ([`gamificationLogic.js`](gamificationLogic.js))**: The only properly encapsulated module. It's a pure class with constructor config, no DOM access, stable session timestamps to prevent badge flicker, and a batched Firestore write pattern. This is the architectural model the rest of the codebase should follow.

7. **WalkTracker object ([`expeditionEngine.js`](modules/expeditionEngine.js:565))**: Well-structured object literal with clear lifecycle (`start` → `processGpsPing` → `stopAndSave` / `cancel` → `cleanup`). Handles wake lock, visibility API, and iOS blackout fallback — real production edge cases.

---

## 4. ARCHITECTURE DIAGRAM (Textual)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        index.html (1,437 lines)                         │
│   Loads all scripts via <script defer> in strict order                  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
   ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐
   │ gamificationLogic│  │ MapMarkerConfig  │  │   Firebase SDK     │
   │  (pure class)    │  │  (pure class)    │  │   PapaParse        │
   │  NO DOM access   │  │  Leaflet wrapper │  │   Leaflet + Turf   │
   └────────┬────────┘  └────────┬─────────┘  └────────┬───────────┘
            │                    │                      │
            ▼                    ▼                      ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    window.BARK (Global Namespace)                      │
│                    window.* (20+ mutable globals)                      │
│                    window.map (Leaflet instance)                       │
│                    window.parkLookup (Map)                             │
│                    window.gamificationEngine (instance)                │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │barkState │→│ barkConfig   │→│ mapEngine    │→│renderEngine  │ │
│  │  (state) │  │ (constants)  │  │ (Leaflet map)│  │ (heartbeat)  │ │
│  └──────────┘  └──────────────┘  └──────────────┘  └──────┬───────┘ │
│                                                            │         │
│  ┌──────────────┐  ┌──────────────┐                        ▼         │
│  │searchEngine  │  │ dataService  │────────────→ syncState()         │
│  │ (fuzzy match)│  │ (1250 lines!)│  CSV parse + Firebase auth       │
│  └──────────────┘  │  + marker    │  + cloud settings + admin        │
│                    │  click handler│  + saved routes + polling        │
│  ┌──────────────┐  └──────────────┘                                  │
│  │profileEngine │  ┌──────────────┐  ┌──────────────┐               │
│  │ (achievements│  │expeditionEng │  │ tripPlanner  │               │
│  │  leaderboard)│  │ (walks/trails│  │ (route build)│               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ shareEngine  │  │settingsCtrl  │  │uiController  │               │
│  │ (export/QR)  │  │ (toggles)    │  │ (nav/panels) │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
            │
            ▼
   ┌─────────────────┐
   │     app.js       │
   │ (boot sequence)  │
   │ calls init*()    │
   └─────────────────┘

DEPENDENCY DIRECTION:
  Every module reads/writes → window.BARK / window.*
  Every module reads/writes → DOM (document.getElementById)
  Every module reads → firebase.* (global)
  Every module reads → map (global Leaflet instance)

  ⚠️ No clean dependency DAG — it's a star topology with window.BARK as hub
```

---

## 5. AGENT BEHAVIOR SIMULATION

### Task: "Add a new pin feature — when a user taps a pin, show the nearest 3 parks"

**Files the agent would open:**

1. [`renderEngine.js`](modules/renderEngine.js) — "This must be where markers are rendered" ✅ (finds `updateMarkers()`)
2. [`dataService.js`](modules/dataService.js) — Agent finds the marker `click` handler here (line 177) ⚠️ **Confusion**: Why is the click handler in the "data service"?
3. [`barkState.js`](modules/barkState.js) — Needs `haversineDistance` for proximity calc ✅
4. [`mapEngine.js`](modules/mapEngine.js) — Agent looks here for map interaction logic, finds zoom handlers but NOT the click handler ⚠️
5. [`profileEngine.js`](modules/profileEngine.js) — Agent incorrectly checks here thinking "nearest parks" might be gamification-related ❌

**Where confusion occurs:**

| Expected Location | Actual Location | Confusion Level |
|---|---|---|
| Marker click → [`renderEngine.js`](modules/renderEngine.js) or [`mapEngine.js`](modules/mapEngine.js) | [`dataService.js`](modules/dataService.js:177) line 177 | 🔴 HIGH |
| Park data lookup → [`dataService.js`](modules/dataService.js) | `window.parkLookup` declared in [`barkState.js`](modules/barkState.js:70), populated in [`dataService.js`](modules/dataService.js:159) | 🟡 MEDIUM |
| Distance utility → utils file | [`barkState.js`](modules/barkState.js:116) | 🟡 MEDIUM |
| UI panel update → uiController | Inline in [`dataService.js`](modules/dataService.js:192) marker click handler | 🔴 HIGH |

**Agent over-fetch:** The agent would need to open **at minimum 4 files** and have [`dataService.js`](modules/dataService.js) (1,250 lines) fully in context. This is a retrieval precision failure — the relevant code is buried in a file whose name suggests data fetching, not UI interaction.

### Task: "Change the scoring formula"

**Files the agent would open:**

1. [`gamificationLogic.js`](gamificationLogic.js) — ✅ Correctly finds `evaluate()` with score calculation
2. [`profileEngine.js`](modules/profileEngine.js:86) — ⚠️ Finds **duplicate** score formula at line 86 and line 391
3. [`dataService.js`](modules/dataService.js) — ⚠️ Finds score-adjacent logic in cloud sync

**Risk:** Agent updates [`gamificationLogic.js`](gamificationLogic.js) but misses the duplicate in [`profileEngine.js`](modules/profileEngine.js), causing score inconsistency.

---

## 6. REFACTOR PLAN (High Impact, Minimal Changes)

### Change 1: Split `dataService.js` into 4 files
**Impact: 🔴 Critical | Effort: Medium**

| New File | Extracted From | Lines |
|---|---|---|
| `authController.js` | `initFirebase()`, `onAuthStateChanged`, login/logout binding | ~350 |
| `panelRenderer.js` | Marker click handler (DOM rendering for slide panel) | ~300 |
| `cloudSettingsSync.js` | Cloud settings hydration block | ~100 |
| `dataService.js` (remaining) | CSV parse, poll, loadData, version check | ~400 |

### Change 2: Create a `SettingsStore` singleton
**Impact: 🔴 Critical | Effort: Medium**

Replace 20+ `window.*` booleans with:
```javascript
class SettingsStore {
    #settings = {};
    #listeners = new Map();
    
    get(key) { return this.#settings[key]; }
    set(key, value) { this.#settings[key] = value; this.#notify(key); }
    onChange(key, fn) { /* pub/sub */ }
    hydrateFromLocal() { /* single pass */ }
    hydrateFromCloud(payload) { /* single pass */ }
}
```

### Change 3: Extract utility functions into `utils/geo.js` and `utils/scoring.js`
**Impact: 🟡 Medium | Effort: Low**

- Move `haversineDistance`, `getDistanceMeters`, `generatePinId`, `sanitizeWalkPoints` to `utils/geo.js`
- Move score calculation to `utils/scoring.js` (single source of truth)
- Both [`gamificationLogic.js`](gamificationLogic.js) and [`profileEngine.js`](modules/profileEngine.js) import from there

### Change 4: Move ORS API key to `barkConfig.js`
**Impact: 🟡 Medium | Effort: Trivial**

Add `window.BARK.ORS_API_KEY = "..."` to [`barkConfig.js`](modules/barkConfig.js). Remove duplication from [`searchEngine.js`](modules/searchEngine.js:287) and [`tripPlanner.js`](modules/tripPlanner.js:512).

### Change 5: Create a `domRefs.js` constants file
**Impact: 🟡 Medium | Effort: Low**

```javascript
// domRefs.js
window.BARK.DOM = {
    slidePanel: () => document.getElementById('slide-panel'),
    panelTitle: () => document.getElementById('panel-title'),
    filterPanel: () => document.getElementById('filter-panel'),
    // ... all 50+ element references
};
```
This creates a single breakage surface when HTML changes, instead of silent failures across 12 files.

### Change 6: Add JSDoc type annotations to `window.BARK` namespace
**Impact: 🟢 Low | Effort: Low**

Create a `types.js` or `bark.d.ts` that documents the shape of `window.BARK`, enabling IDE autocomplete and catching typos:
```javascript
/**
 * @typedef {Object} BARKNamespace
 * @property {Array<ParkData>} allPoints
 * @property {Map<string, VisitedPlace>} userVisitedPlaces
 * @property {function(): void} syncUserProgress
 * ...
 */
```

### Change 7: Extract inline HTML templates to template functions
**Impact: 🟢 Low | Effort: Medium**

Replace inline template strings (e.g., [`profileEngine.js`](modules/profileEngine.js:201) badge HTML, [`tripPlanner.js`](modules/tripPlanner.js:393) stop items) with named template functions at the top of each file:
```javascript
function renderBadgeCard(badge) { return `<div class="skeuo-badge ${badge.tierClass}">...`; }
```

---

## 7. DETAILED DIMENSION ANALYSIS

### 7.1 Architecture & Separation of Concerns

| Module | Stated Responsibility | Actual Responsibility | Verdict |
|---|---|---|---|
| [`barkState.js`](modules/barkState.js) | Central state store | State + utility functions + gamification init | 🟡 Leaky |
| [`barkConfig.js`](modules/barkConfig.js) | Constants | Clean ✅ | 🟢 Good |
| [`mapEngine.js`](modules/mapEngine.js) | Map initialization | Map + global styles + loader dismiss | 🟡 Leaky |
| [`renderEngine.js`](modules/renderEngine.js) | Marker rendering | Rendering + heartbeat + helper functions | 🟢 Acceptable |
| [`searchEngine.js`](modules/searchEngine.js) | Search | Search + geocoding + inline search for trip planner | 🟡 Leaky |
| [`dataService.js`](modules/dataService.js) | Data fetching | **Everything** | 🔴 God module |
| [`profileEngine.js`](modules/profileEngine.js) | Gamification UI | Achievements + stats + leaderboard + manage portal | 🟡 Overloaded |
| [`expeditionEngine.js`](modules/expeditionEngine.js) | Expeditions | Clean within domain ✅ | 🟢 Good |
| [`tripPlanner.js`](modules/tripPlanner.js) | Trip building | Clean within domain ✅ | 🟢 Good |
| [`shareEngine.js`](modules/shareEngine.js) | Export/share | Clean ✅ | 🟢 Good |
| [`settingsController.js`](modules/settingsController.js) | Settings UI | Toggle wiring only (no cloud sync!) | 🟡 Incomplete |
| [`uiController.js`](modules/uiController.js) | Navigation/panels | Clean ✅ | 🟢 Good |

### 7.2 Error Handling Gaps

| Location | Issue |
|---|---|
| [`dataService.js`](modules/dataService.js:56) `syncUserProgress()` | No try/catch — Firestore `set()` can throw on network errors |
| [`dataService.js`](modules/dataService.js:442) `markVisitedBtn.onclick` | `await firebase.firestore()...update()` without try/catch |
| [`profileEngine.js`](modules/profileEngine.js:79) `syncScoreToLeaderboard()` | No try/catch on two Firestore writes |
| [`expeditionEngine.js`](modules/expeditionEngine.js:193) Spin wheel | If `firebase.auth().currentUser` becomes null mid-operation, unhandled |
| [`tripPlanner.js`](modules/tripPlanner.js:524) Route generation | Good — has try/catch per day ✅ |
| [`searchEngine.js`](modules/searchEngine.js:284) Geocode | Good — has try/catch ✅ |

### 7.3 Testability Assessment

**Score: 1/10 — Untestable**

- **Zero dependency injection**: Every module reads globals (`window.BARK`, `firebase`, `map`, `document`)
- **No interface boundaries**: Functions directly call Firestore, Leaflet, and DOM APIs
- **No pure functions**: Even utility functions like `haversineDistance` are exposed via `window.BARK` rather than importable modules
- **Existing test file ([`app.test.js`](app.test.js))**: Would need to mock `window.BARK`, `firebase`, `L` (Leaflet), `Papa`, `turf`, `QRCode`, `html2canvas`, and the entire DOM
- **The only testable unit is [`GamificationEngine`](gamificationLogic.js)**: It's a class with no DOM dependencies (except the Firebase write in `evaluateAndStoreAchievements`)

### 7.4 Scalability Risk Matrix

| Scenario | What Breaks | Severity |
|---|---|---|
| 10x users | Firestore reads in leaderboard (no pagination caching) | 🟡 |
| 10x parks (5000+ pins) | `updateMarkers()` iterates ALL points every `syncState()` call | 🔴 |
| 10x settings | `window.*` globals become unmanageable | 🔴 |
| Adding new feature (e.g., social feed) | No clear module boundary to add to; would need to tap into `dataService.js` | 🔴 |
| Mobile offline mode | `localStorage` has 5-10MB limit; CSV + settings could exceed | 🟡 |
| Multiple developers | Merge conflicts guaranteed in `dataService.js` and `window.BARK` | 🔴 |

---

## 8. FILE SIZE DISTRIBUTION ANALYSIS

```
dataService.js    ████████████████████████████████████████████ 1250 (22.3%)  ← 🔴 GOD MODULE
expeditionEngine  ██████████████████████████ 711 (12.7%)
profileEngine     ████████████████████████ 670 (11.9%)
tripPlanner       ████████████████████ 559 (10.0%)
mapEngine         ███████████████ 432 (7.7%)
searchEngine      ██████████████ 389 (6.9%)
settingsController████████████ 325 (5.8%)
shareEngine       █████████ 261 (4.7%)
renderEngine      ████████ 210 (3.7%)
uiController      ██████ 159 (2.8%)
barkState         ██████ 156 (2.8%)
app.js            ████ 100 (1.8%)
gamificationLogic ██████████ 289 (5.2%) [root level]
MapMarkerConfig   ██ 54 (1.0%) [root level]
barkConfig        ██ 46 (0.8%)
```

The ideal post-refactor target: No file exceeds 400 lines. [`dataService.js`](modules/dataService.js) at 1,250 lines is 3x over budget.

---

## 9. SECURITY OBSERVATIONS

| Issue | Location | Risk |
|---|---|---|
| Firebase config in source | [`barkConfig.js`](modules/barkConfig.js:24) | 🟢 Low (normal for client-side Firebase; Firestore rules are the real gate) |
| ORS API key in source | [`searchEngine.js`](modules/searchEngine.js:287), [`tripPlanner.js`](modules/tripPlanner.js:512) | 🟡 Medium (quota abuse possible) |
| No input sanitization on feedback | [`uiController.js`](modules/uiController.js:130) | 🟡 Medium (stored XSS if feedback is ever rendered in admin) |
| `innerHTML` used throughout | All modules | 🟡 Medium (XSS risk if any user-provided data flows into templates) |
| Admin check is client-side only | [`dataService.js`](modules/dataService.js:1033) `window.isAdmin = data.isAdmin === true` | 🔴 High (trivially bypassable via console — Firestore rules must enforce this server-side) |

---

## 10. CONCLUSION

This codebase achieves the **appearance** of modular architecture while retaining the **reality** of a monolith. The `window.BARK` namespace is a service locator anti-pattern — every module depends on every other module through this single global. The refactor from a single file was a necessary first step, but the job is only 40% complete. The critical next steps are: (1) break up [`dataService.js`](modules/dataService.js), (2) formalize state management, and (3) establish clear module boundaries that an AI agent or new developer can reason about without loading the entire codebase into context.
