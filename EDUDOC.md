# EDUDOC — A Guided Tour of BarkRangerMap

> A walkthrough of this codebase for someone who just finished Data Structures & Algorithms and wants to understand what a "real" production-ish app actually looks like.
>
> Read this top-to-bottom once, then jump back to any section as a reference.

---

## 0. How to read this document

You just finished DSA. That means you've seen linked lists, hash maps, trees, graphs, sorting, complexity analysis. You've written code that solves a problem in isolation: one file, one `main()`, you run it, it prints the answer.

This is the next level up: a real codebase. It is **not** a single algorithm. It is **dozens of interacting pieces** that have to start up in the right order, stay in sync, talk to a database, talk to a server, handle a user changing their mind, handle the network dying, and *still* look like it just works.

There are basically three things to learn from a codebase like this:

1. **The shape** — what are the parts, where do they live, how do they connect?
2. **The patterns** — the named tricks the code uses repeatedly (repository, observer, debounce, feature flag, etc.).
3. **The health** — what's clean, what's gnarly, and how would you grade it?

We'll cover all three.

A note on emoji-style ratings I'll use throughout:
- 🟢 **Clean** — small, focused, easy to reason about
- 🟡 **Yellow** — works, but mixed concerns or growing
- ⚠️ **Watch** — clear smell, would refactor someday
- 🔴 **God module** — too many jobs in one file

---

## 1. What this app actually is

**BarkRangerMap** is a Progressive Web App (PWA) for the U.S. **B.A.R.K. Ranger** program — a real National Park Service / state-park program where dog owners collect physical swag (tags, bandanas, certificates) for visiting parks with their dog. The app shows a map of all the participating parks, lets users mark which they've visited, plan multi-day road trips between them, earn achievements, and eventually pay for a premium tier that unlocks routing and global geocoding.

Three sentences of context for understanding *why* the code looks the way it does:

1. It is built by **one person, part-time** (an EE student) — every shortcut and "good enough" you'll see came from finite time, not laziness.
2. It is **pre-launch**, with a payment flow about to go live, which is why you'll see a lot of safety scaffolding, kill switches, feature flags, and rate limits.
3. The primary tech bet is **"vanilla JS + Firebase, no build step"** — no React, no Vite, no TypeScript, no Webpack. You drop a `<script>` tag in HTML and it loads.

That last bet shapes *everything*. Once you understand the consequences of "no module system, no build step, everything attaches to a global object," half the weird patterns in this codebase suddenly make sense.

---

## 2. The 30,000-foot view

```
BarkRangerMap/
├── 01-code/        ← the app
│   ├── app/        ← frontend (browser code, runs on the user's phone)
│   └── functions/  ← backend (Firebase Cloud Functions, runs on Google's servers)
├── 02-data/        ← raw CSVs and GeoJSON trail data
├── 03-tests/       ← unit tests + Playwright end-to-end tests
├── 04-docs/        ← every plan, audit, and report ever written
├── 05-tools/       ← one-off scripts (geocode, CSV cleanup, migrations)
└── 06-config/      ← Firestore security rules
```

The leading numbers (`01-`, `02-`...) are not standard — they're a personal convention to **sort folders by importance** so the top level of the repo stays readable. That's it. Files at the root (`package.json`, `firebase.json`, `playwright.config.js`) sit there only because the tools that read them expect them at the root.

### By the numbers

- **~21,000 lines of frontend JS** spread across ~45 files
- **~2,600 lines in one backend file** (`functions/index.js`) — yes, one file
- **~3,500 lines of CSS** (`styles.css`)
- **~1,600 lines of HTML** (one big `index.html`)
- **~16 unit tests, ~27 Playwright e2e tests**
- **~102 markdown docs** in `04-docs/` (most are launch checklists and audits)

Total app + backend code is in the **25–30K LOC** range. That's not huge by industry standards, but it's *big* compared to anything you wrote in DSA. The biggest single source file in the app is [engines/tripPlannerCore.js](01-code/app/engines/tripPlannerCore.js) at **1,577 lines**.

---

## 3. The frontend: how a vanilla-JS PWA holds itself together

### 3.1 The "no build step" model

Open [01-code/app/index.html](01-code/app/index.html). Scroll to around line 1400. You'll see **40+ `<script>` tags in a specific order**. That is the entire "module system."

There is no `import` statement. There is no `package.json` for the browser. There is no bundler. When the browser loads the page, it loads each script tag in order, and each script attaches its public functions to a single global object: `window.BARK`.

So `window.BARK` is the closest thing this app has to a namespace. It looks like:

```js
window.BARK = {
  config: { ... },               // constants
  services: { auth, firebase, ors, checkin, ... },  // I/O layer
  repos: { ParkRepo, VaultRepo },                   // data layer
  appState: { get, set, onChange },                 // state layer
  settings: { get, set, onChange },                 // user-pref state
  paywall: { show },                                // payment UI
  refreshCoordinator: { ... },                      // orchestration
  DOM: { ... },                                     // DOM helper refs
  // plus ~200 loose function references:
  initMap, initUI, initSearchEngine, loadData, updateMarkers, ...
};
```

**Why does this matter for you?** Two reasons:

1. **Load order is the dependency graph.** If `searchEngine.js` calls `window.BARK.services.firebase.foo()`, then `firebaseService.js` has to load *before* `searchEngine.js`. There is no compiler to yell at you if you get this wrong — you just get a `TypeError: undefined is not a function` at runtime. [core/app.js](01-code/app/core/app.js) even has a guardrail (`assertSettingsStartupOrder`) that warns when load order is wrong.
2. **Privacy is by convention only.** Anything attached to `window.BARK` is callable from the browser console. Anything *not* attached to it (variables inside the IIFE) is private. You'll see almost every file follow the same pattern:

```js
(function () {
    // private stuff here — nothing outside this file can see it
    let _cache = new Map();
    function _helper() { ... }

    // public stuff — explicit attach to the global
    window.BARK.doTheThing = function () { ... };
})();
```

That's the **IIFE module pattern** (Immediately-Invoked Function Expression). Before ES Modules existed, this was *the* way to fake private scope in browser JS. You'll see it used over a hundred times in this codebase.

### 3.2 The boot sequence

[core/app.js](01-code/app/core/app.js) is the conductor. It's only 225 lines because all the heavy lifting lives elsewhere — its only job is to **start things in the right order**. The shape:

```
DOMContentLoaded fires
  → assertSettingsStartupOrder()       // verify load order
  → setTimeout(map-ready watchdog, 5s)  // safety net
  → await initMap()                     // Leaflet map
  → await initTripLayer()               // overlay layer (must exist before tripPlanner)
  → await initSettings()
  → await initUI()
  → await initSearchEngine()
  → await initTrailToggles()
  → await initSpinWheel()
  → ... 9 more init calls ...
  → initFirebase()                      // auth + cloud sync (separate try/catch)
  → loadData()                          // CSV from Google Sheets
  → setTimeout(safePoll, 2s)            // background polling
  → setTimeout(updateTripUI, 500ms)     // deferred UI
  → log "✅ Boot Complete" or "⚠️ Complete with N errors"
```

Notice the `callInit(name, label)` helper at [core/app.js:131](01-code/app/core/app.js#L131). Every init call is wrapped in a try/catch and the failure name is pushed into `_bootErrors`. If one feature fails to initialize, the rest of the app still tries to come up. This is a **graceful degradation** pattern — one of the most important real-world differences between toy code and production code. In a homework problem, you `throw` and quit. In production, you log the failure, hide the broken UI, and keep going so the user can still use the other 90% of the app.

### 3.3 The layer cake

If you squint, the frontend has **eight layers**, stacked roughly bottom-up:

| Layer | Folder | What it does | Examples |
|---|---|---|---|
| 1. Utils | `utils/` | Pure functions, no state | `haversineDistance`, `levenshtein` |
| 2. Config | `config/`, `modules/barkConfig.js` | Constants & DOM refs | `CHECKIN_RADIUS_KM`, `firebaseConfig` |
| 3. Repos | `repos/` | Single source of truth for domain data | `ParkRepo`, `VaultRepo` |
| 4. State | `state/`, `modules/barkState.js` | Runtime + persisted state | `appState`, `settingsStore` |
| 5. Services | `services/` | I/O — talks to the outside world | `authService`, `firebaseService`, `orsService` |
| 6. Engines | `engines/`, big `modules/*Engine.js` | Domain logic | `tripPlannerCore`, `expeditionEngine` |
| 7. Modules | `modules/` | Feature controllers | `searchEngine`, `uiController`, `paywallController` |
| 8. Renderers | `renderers/` | View logic — turns state into DOM | `panelRenderer`, `routeRenderer` |

The **rule of layering**, if you want to follow it cleanly, is: **a higher layer can call a lower layer, but not the other way around.** Utils never call services. Services never call renderers. Repos never call engines.

This codebase mostly follows the rule, with leaks. We'll look at the leaks in §5.

### 3.4 The data flow on a typical user action

Let's trace what happens when a user clicks "Mark as Visited" on a park:

1. User clicks a button in the `<div id="slide-panel">` (HTML)
2. Click handler in [renderers/panelRenderer.js](01-code/app/renderers/panelRenderer.js) fires
3. It calls `window.BARK.services.checkin.markVisited(parkId)` (services layer)
4. `checkinService` validates the user is signed in, builds the canonical visit record
5. It calls `window.BARK.updateCurrentUserVisitedPlaces(...)` in [services/firebaseService.js](01-code/app/services/firebaseService.js) (still services, but lower)
6. `firebaseService` writes to Firestore via the Firebase SDK
7. Firestore fires a snapshot listener (it was already subscribed on sign-in)
8. The snapshot listener updates `VaultRepo` (repos layer)
9. `VaultRepo` notifies its subscribers
10. `refreshCoordinator.refreshAllVisitDerived('mark-visited')` runs
11. `markerManager.refreshMarkerStyles()` repaints the pin
12. `profileEngine.updateStatsUI()` repaints the user's stats card
13. `gamificationEngine.evaluateAchievements()` checks for newly unlocked badges
14. If a badge unlocked, `panelRenderer` shows a toast

That is **fourteen hops** for one click. That's the cost of a layered app — but also why it stays maintainable. Each piece only knows about its neighbors.

---

## 4. The major files, explained like you've never seen them

I'll go in dependency order (bottom of the cake up). For big files I'll stick to the highlights.

### Utils — `utils/geoUtils.js` (33 lines) 🟢

Tiny, pure, important. Three functions:
- **`haversineDistance(lat1, lon1, lat2, lon2)`** — great-circle distance between two points on Earth, in km. This is the **haversine formula** — given Earth's curvature, you can't just do Pythagorean distance on lat/lon. You memorize this once and reuse it for the rest of your career.
- **`generatePinId(lat, lng)`** — creates a stable string ID from a coordinate. Used as a hash-map key.
- **`sanitizeWalkPoints(raw)`** — float precision guard. Because JavaScript's `0.1 + 0.2 !== 0.3`, you have to round somewhere before storage.

### Utils — `utils/scoringUtils.js` (72 lines) 🟢

Helpers for the gamification scoring. Pure, no DOM, no state. **Pure functions are the best functions** — easy to test, easy to reason about. Always try to push your logic toward pure functions when you can.

### `MapMarkerConfig.js` (64 lines) 🟢

A factory for Leaflet markers. Given a park's type and visited status, it returns a styled marker. This is the **factory pattern**: instead of every caller knowing how to build the right marker, they ask the factory.

### `gamificationLogic.js` (414 lines) ⚠️

Defines the `GamificationEngine` class. Tracks which **achievements** a user has unlocked: rare feats ("visit 10 national parks"), state badges ("collect every park in Florida"), and mystery feats.

Three things to study here:
- **`getNormalizedStateCode('Florida') → 'FL'`** — input normalization. Real user data is messy. You'll see typos and aliases mapped to canonical forms.
- **`getVisitProgressMaps()`** — turns the visit list into hash maps indexed two different ways (by state, by feature). This is **building indexes for fast lookup** — exactly what a database does internally. DSA pays off here.
- **Session timestamp caching** — once an achievement unlocks during a session, the timestamp is frozen. Otherwise it would change every render and the UI would flicker.

⚠️ **Smell:** achievement definitions are hardcoded inside the class. As more achievements get added this will balloon. Better design: each achievement is a data object with a `predicate(visits)` function, all stored in an array. The engine then becomes a loop.

### Config — `modules/barkConfig.js` (53 lines) and `config/domRefs.js` (211 lines) 🟢 / 🟡

`barkConfig.js` holds constants — Firebase config, normalization dictionary (e.g. `"ft" → "fort"`), check-in radius, the data for the 10 famous virtual expedition trails (Half Dome, Angels Landing, etc.). Immutable, frozen.

`domRefs.js` 🟡 is a centralized registry of DOM element accessors. Instead of `document.getElementById('filter-panel')` sprinkled everywhere, you call `window.BARK.DOM.filterPanel()`. The function form (not a cached reference) is intentional — it always returns the *current* element, even if the DOM has been re-rendered. It also exports `bindDismissableOverlay()`, which standardizes Escape-key-to-close and click-outside-to-close behavior across every modal in the app. **Code smell here:** hardcoded element IDs everywhere mean that if you rename `<div id="filter-panel">` in HTML, you also have to grep through JS. A cleaner approach uses `[data-ref="filterPanel"]` attributes.

### State — `modules/barkState.js` (148 lines) ⚠️

Initializes `window.BARK` and the gamification engine. Owns the *runtime* mutable state: `tripDays`, `activeDayIdx`, `activeSwagFilters`, the search cache, etc.

The clever-but-dangerous pattern here is **`Object.defineProperty` accessors**:

```js
Object.defineProperty(window.BARK, 'tripDays', {
    get() { return _tripDays; },
    set(value) { _tripDays = value; }
});
```

This means `window.BARK.tripDays = newValue` *looks* like a property assignment but actually fires getter/setter logic. It's how the codebase pretends to have reactive state without using a framework. Powerful, but it makes the code surprising — what looks like a field access is actually a function call.

⚠️ **Smell:** This is a global mutable bag. Every module on Earth can read and write it, with zero log of who changed what when. Real apps eventually hit a "where did this value come from?" wall and migrate to Redux/MobX/Zustand. For now, careful conventions hold it together.

### State — `state/settingsStore.js` (293 lines) and `state/appState.js` (147 lines) 🟢 / 🟢

This is the *good* layer. Two reactive stores with `get(key)`, `set(key, value)`, `onChange(key, callback)` APIs.

- **`settingsStore`** persists to localStorage, hydrates from Firestore on sign-in, and even has **device-aware defaults** — on a low-RAM phone, it auto-enables low-graphics mode. That's a nice quality-of-life touch most apps skip.
- **`appState`** is a thin adapter that lets new code use a clean API while legacy code still reads/writes via `window.BARK.foo` aliases. This is the **adapter pattern** in action, and it's specifically a **strangler-fig migration** — keep the old surface working while you grow a new one.

### State — `modules/settingsRegistry.js` (183 lines) 🟢

This is the **best-designed file in the app**. A frozen schema mapping every user-configurable setting to:
- its localStorage key
- its Firestore cloud key
- its DOM element ID
- its default value
- its **impact area** — which subsystems need to invalidate when this setting changes (markers, map, gestures, trails)

Why this matters: when you have *N* settings and *M* things that need to update when settings change, the naive approach is *N×M* hardcoded "if setting X changes, also call Y and Z" branches. Sets of impact tags let you write `for each impact in setting.impacts: invalidate(impact)` and you're done. Adding a new setting is now a one-line change. **Configuration-as-data** is one of the most powerful patterns in software engineering.

### Repos — `repos/ParkRepo.js` (191 lines) 🟢

The **repository pattern**, textbook. Single in-memory source of truth for the list of parks (loaded from CSV). API:

```js
ParkRepo.getAll()
ParkRepo.getById(id)
ParkRepo.replaceAll(newParks, options)   // ← bulk update
ParkRepo.subscribe(listener)             // ← observer pattern
```

The slick part: `replaceAll` has a **destructive-refresh guard**. If a CSV poll would drop more than 10% of parks or more than 25 IDs, the repo *rejects the refresh* and keeps the old data. This protects against catastrophic data loss from a malformed CSV — a real-world failure mode. **Defensive programming at the data layer is one of the most underrated skills.**

### Repos — `repos/VaultRepo.js` (674 lines) 🟡

The user's "vault" of visited places. Bigger and stickier than `ParkRepo` because it has to handle:
- **Canonical ID migration** — early versions used coordinate-based IDs; new versions use park IDs. Old visits have to be matched and merged.
- **Conflict reconciliation** — if you check in offline and later sign in, the cloud has one version and your phone has another. The vault has to merge them sensibly.
- **Staged writes** — `stageVisitedPlaceUpsert()` collects pending changes before committing, so a partial failure can roll back.

This is the kind of file that exists because **real data is messy** and **users are offline sometimes**. There's no clean version of this code; it's just careful version.

### Services — `services/orsService.js` (120 lines) 🟢

Thin client for OpenRouteService (the routing engine). Notice it doesn't call ORS directly — it calls a Firebase Cloud Function that proxies ORS. **Why?** Because the ORS API key would be visible in the browser if the frontend called ORS directly. By proxying through the backend, the secret stays on the server and the backend can also rate-limit, log, and gate by premium status. **Never put a paid-API secret in client code.**

### Services — `services/firebaseService.js` (796 lines) 🟡

The low-level Firestore wrapper. CRUD operations on user docs, visited places, leaderboard syncs. The interesting bits:
- **Snapshot subscriptions** — Firestore lets you listen to a document and get a callback every time it changes. Most of "cloud sync just works" comes from setting these up correctly on sign-in and tearing them down on sign-out.
- **Reconciliation logic** — merging cloud snapshots with local pending changes.

### Services — `services/authService.js` (1,017 lines) ⚠️

The auth orchestrator. Handles sign-in, sign-out, hydrating user data, subscribing to Firestore, and tearing everything down on sign-out. It's huge because **auth events cascade everywhere** — when a user signs in, the trip planner needs to refresh, the profile needs to load, the leaderboard subscribes, the settings hydrate, the visited places sync, the premium entitlement loads. When they sign out, all of that has to unwind cleanly.

⚠️ **Smell:** This is a god coordinator. It calls into eight other modules by name (`window.BARK.resetTripPlannerState`, etc.). If any of those modules aren't loaded, this throws. A cleaner design would publish an `auth:signed-in` event and let interested modules subscribe.

### Services — `services/authAccountUi.js` (1,067 lines) ⚠️

UI logic for sign-in, sign-up, account-switching, password reset, and email verification. Why is this 1,000 lines? Because **auth UI is full of edge cases**: passwords that don't meet rules, emails already in use, network errors, verification reminders, "you're signed in with a different account, switch?" flows. Each one is small; together they pile up.

### Services — `services/checkinService.js` (395 lines) 🟢

Handles the **geofenced check-in** — the user has to actually be within `CHECKIN_RADIUS_KM` of the park's coordinates for a "Verified" check-in. Reads GPS via `navigator.geolocation`, validates the distance, writes the visit. The check is server-side too (Firestore rules will fall back to "honor" tier if you fake it) but the client check is for UX.

### Services — `services/premiumService.js` (195 lines) 🟢 and `services/authPremiumUi.js` (150 lines) 🟢

The "is the user a paying customer?" interface. Reads the entitlement object out of the user's Firestore document and exposes `isPremium()`. Premium status has multiple states: `active`, `manual_active`, `past_due`, `paused`, `cancelled_active`, `access_code_active`. Each represents a real customer scenario you have to handle.

### Modules — `modules/mapEngine.js` (596 lines) ⚠️

Initializes Leaflet, sets up the tile layer, creates the marker layer and cluster group, hooks up zoom/pan events. Three patterns to study:

1. **Batch DOM writes** — `applyGlobalStyles()` collects all classes to add and all classes to remove, then makes exactly two `classList` calls. **Reflow** is when the browser recalculates layout; it happens after each style change. Batching turns *N* reflows into 1.
2. **Motion flags** — `_isMoving`, `_isZooming`, `_pendingMarkerSync`. The map updates a lot during a pan; you don't want to rebuild markers on every frame. The flags let expensive work be **deferred until motion ends**.
3. **Lazy policy evaluation** — the active policy is computed at event time, not boot. So changing settings at runtime can change behavior without restarting.

### Modules — `modules/dataService.js` (577 lines) 🟢

Loads the park CSV from a Google Sheets published URL, parses it with PapaParse, polls in the background for updates. The clever bit: **hash the CSV string**, compare to the last hash, and skip the rebuild if nothing changed. Bandwidth wasted on identical data is a real cost at scale.

### Modules — `modules/searchEngine.js` (1,095 lines) ⚠️

The search bar. Two interesting algorithmic pieces:

- **Levenshtein distance, space-optimized** — the textbook DP version uses an `O(n×m)` matrix. This one rolls a single array, reducing to `O(n)` space. Same algorithm, half the memory. You'll see this trick in interview prep.
- **Debouncing + frame budgeting** — search input is debounced 300ms (don't re-search on every keystroke), then heavy scoring is time-sliced (`SEARCH_FRAME_BUDGET_MS = 16`) so each render frame stays under ~16ms (60fps).
- **LRU cache** — global geocode results are cached in a `Map` with a 50-entry cap. When the cap is hit, the oldest entry is evicted. This is the **least-recently-used cache eviction** policy.

⚠️ **Smell:** 1,100 lines is too many. The algorithm code is clean; the DOM/UI handling around it is sprawling. A proper split would be `searchCore.js` (pure logic) + `searchUi.js` (event handlers, rendering).

### Modules — `modules/renderEngine.js` (478 lines) 🟢

The visibility orchestrator for map pins. Combines filters (swag type, visited-only, search query, type filter) into a single "what should be visible right now?" decision. Builds a **state key** (a hash of all the filter inputs) and short-circuits the render if the key matches the last render — **memoization** on the filter state. Achievement evaluation is deferred to `requestIdleCallback`, so it only runs when the browser would otherwise be idle.

### Modules — `modules/MarkerLayerManager.js` (363 lines) 🟡

Owns the actual Leaflet markers. Maintains a `Map<id, marker>` so re-renders **reuse existing markers** instead of creating new ones (DOM churn is expensive). Switches between cluster mode (zoomed out) and plain mode (zoomed in) based on the marker layer policy.

### Modules — `modules/TripLayerManager.js` (578 lines) 🟡

Draws the trip-planner polylines and numbered stop badges on the map. One polyline per day, color-coded. Badge DOM elements are cached and reused on update.

### Modules — `modules/RefreshCoordinator.js` (149 lines) 🟢

A small adapter layer. Instead of fifteen modules calling `markerManager.refreshMarkerStyles()` directly and the next person reading the code wondering *why* and *when*, they call `refreshCoordinator.refreshVisitedVisuals(reason)` with a string explaining the cause. The coordinator logs the reasons, which is gold for debugging "why did the map repaint?" bugs.

### Modules — `modules/profileEngine.js` (946 lines) 🟡

The profile tab: stats, achievements, leaderboard, trip history, "manage visited places" UI. Big because it does a lot, but reasonably organized. **Graceful degradation** here: if the leaderboard API fails, it builds a fake leaderboard from local data so the UI doesn't break.

### Modules — `modules/expeditionEngine.js` (1,139 lines) ⚠️

Virtual expedition trails — users log miles walked IRL and progress along a virtual trail (Half Dome's 16 miles, the Grand Canyon Rim-to-Rim's 24 miles, etc.). Walk log management, prestige mode, spin-wheel trail assignment, points calculation, leaderboard sync. **Feature creep** at its finest — this should probably be three files.

### Modules — `modules/paywallController.js` (929 lines) ⚠️

The premium upsell flow. Shows the paywall modal, kicks off LemonSqueezy checkout, polls for entitlement confirmation, manages feature gating. The "polling after checkout" pattern is important: after the user pays, the webhook from the payment provider takes a few seconds to arrive at the backend and update Firestore. The client polls until the entitlement flips to active, with a fallback timeout so the UI doesn't hang forever.

### Modules — `modules/settingsController.js` (663 lines) 🟢

The bridge between settings storage and the runtime. Watches the `settingsRegistry`, applies setting changes, debounces cloud autosaves, and handles **hydration collision** — when cloud settings arrive after sign-in, the controller flags `isHydratingCloudSettings = true` so the local writes don't fire back during hydration. **Feedback-loop prevention** is one of those things you don't think about until it bites you.

### Modules — `modules/uiController.js` (491 lines) 🟡

Navigation, slide-panel logic, filter-panel logic, iOS-specific viewport fixes. A coordination module. Half of the iOS handling is workarounds for Safari mobile bugs that you cannot solve correctly — only paper over. **Welcome to mobile web development.**

### Modules — `modules/shareEngine.js` (290 lines) 🟢

Watermark generator (Canvas-based), QR code, CSV export. Three small focused tools.

### Modules — `modules/markerLayerPolicy.js` (43 lines) and `modules/launchFlags.js` (16 lines) 🟢 / 🟢

Tiny but mighty. The **policy** decides cluster vs plain markers based on zoom and settings — extracted from `mapEngine` so the decision logic can be unit-tested in isolation. The **launch flags** module is a feature-flag registry. Before launch, you can flip `premiumGeocodeEnabled` off without redeploying, killing the feature globally if you discover a bug. This is **kill-switch architecture** — a beta-launch must.

### Engines — `engines/tripPlannerCore.js` (1,577 lines) 🔴

The biggest, hairiest file in the app. Handles:
- Multi-day trip state (`tripDays` array)
- The day-pager UI (the row of "Day 1 / Day 2 / Day 3" tabs)
- Stop add/remove/reorder
- Long-route warnings (>6 hours/day triggers a confirmation)
- Greedy nearest-neighbor trip optimization (the Traveling Salesman Problem is NP-hard, so you approximate)
- Saving/loading routes to Firestore
- ORS direction calls
- Premium gating

🔴 **Verdict:** classic god module. Has to do too many things in one place. A textbook refactor would split it three ways: state, UI, routing. The fact that it works is a credit to careful naming inside the file.

### Renderers — `renderers/panelRenderer.js` (537 lines) 🟡, `renderers/routeRenderer.js` (308 lines) 🟢, `renderers/leaderboardRenderer.js` (92 lines) 🟢

These are pure view code: take state, output DOM. The smaller they are, the healthier. `panelRenderer` is doing too much (geofence check-in UI, swag info, distance, edit links, premium upsell — all in the same file). The other two are tight.

---

## 5. The backend: one file, twelve cloud functions

Open [01-code/functions/index.js](01-code/functions/index.js). It's **2,636 lines** — one file, all the backend logic.

A **Firebase Cloud Function** is a small server-side function you write in Node.js and Firebase runs it on demand. You don't manage a server; Firebase does. You just write the function and define its trigger (HTTPS call, Firestore change, scheduled cron, etc.).

The 12 exported functions are:

| Function | Trigger | Job |
|---|---|---|
| `getPremiumRoute` | HTTPS callable | Premium: generate a routed path between stops via ORS |
| `getPremiumGeocode` | HTTPS callable | Premium: turn a town name into lat/lon via ORS |
| `createCheckoutSession` | HTTPS callable | Start a LemonSqueezy checkout for premium |
| `redeemAccessOrPromoCode` | HTTPS callable | Apply a coupon/access code |
| `getCustomerPortalUrl` | HTTPS callable | Return the URL to LemonSqueezy's billing portal |
| `restorePremiumPurchase` | HTTPS callable | If a user signs in on a new device, look up their existing subscription |
| `lemonSqueezyWebhook` | HTTPS request | Receives payment events from LemonSqueezy, updates entitlement |
| `syncLeaderboardScore` | HTTPS callable | Validate + persist a leaderboard score (server-recalculated) |
| `submitFeedback` | HTTPS callable | Write user feedback to a private Firestore collection |
| `generateHourlyLeaderboard` | Pub/Sub cron (`0 * * * *`) | Every hour, rebuild leaderboard rankings |
| `extractParkData` | HTTPS callable (admin) | Admin tool: use Gemini AI to pull structured park data from text |
| `syncToSpreadsheet` | HTTPS callable (admin) | Admin tool: push edits back to the Google Sheets master |

A few patterns worth studying in the backend:

### 5.1 Rate limiting via Firestore transactions ([functions/index.js:102-138](01-code/functions/index.js#L102))

To prevent an attacker (or a buggy client) from spamming the premium route endpoint:

```js
async function enforcePremiumCallableRateLimit(uid, action, options) {
    // ... compute windowStart from current time bucket ...
    const ref = firestore.collection('_userRateLimits')
        .doc(`${action}_${uid}_${windowStart}`);

    await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = snap.exists ? snap.data().count : 0;
        if (count >= limit.maxRequests) throw new HttpsError('resource-exhausted');
        tx.set(ref, { count: count + 1 });
    });
}
```

What you're seeing: **a distributed counter, atomic via a transaction**. Multiple Cloud Function instances might run in parallel for the same user. Without the transaction, two reads could both see `count = 99` and both write `count = 100`, letting through 2 requests when the limit is 100. The transaction reads + writes atomically. The "windowed" key (`_userRateLimits/{action}_{uid}_{windowStart}`) is a classic **sliding window approximation** — bucket time into one-hour windows and count per bucket.

### 5.2 Webhook signature verification

LemonSqueezy POSTs to `lemonSqueezyWebhook` when a user buys, cancels, or refunds. *Anyone* could POST to that URL. So LemonSqueezy includes an HMAC signature in the headers, computed from the request body using a shared secret. The function uses `crypto.timingSafeEqual` to compare signatures — **constant-time comparison** prevents timing attacks (an attacker measuring how long the comparison takes could otherwise infer the secret one byte at a time).

### 5.3 Kill switches via environment variables

Every premium callable checks `requireFunctionFlagEnabled('getPremiumRoute')` first. If the env var `BARK_ENABLE_PREMIUM_ROUTE` is set to `false`, the function throws "feature paused for beta safety" without ever calling ORS. You can disable a feature with one env-var flip in the Firebase console — no deploy required.

### 5.4 Server-side score recalculation

Look at `handleSyncLeaderboardScore`. The client *suggests* a score, but the server **recomputes it from the user's visit history** before writing to the leaderboard. **Never trust the client.** This is why client-side cheating doesn't work for honest scoring.

---

## 6. Firestore Security Rules: the second backend

[06-config/firestore.rules](06-config/firestore.rules) is *also* backend code — it just runs on Firebase's servers in a special rules language. These rules govern who can read/write what in the database.

The interesting parts:

```rules
function protectedUserKeys() {
    return ['entitlement', 'premium', 'subscription', ..., 'isAdmin', ...];
}

allow update: if isOwner(uid)
              && changesNoProtectedUserKeys()
              && updatesValidVisitedPlacesForPlan();
```

Translation: a user can update *their own* document, but they cannot touch the `entitlement` or `isAdmin` fields directly — those can only be set by Cloud Functions running with admin credentials.

```rules
function freeVisitedPlaceLimit() { return 5; }

function withinFreeVisitedPlaceLimit(data) {
    return data.visitedPlaces.size() <= freeVisitedPlaceLimit();
}
```

Free tier gets 5 visited places. The rules enforce this **server-side**, so a client that disables the local check still can't bypass it. The check is also smart enough to allow *shrinking* a legacy over-limit list (so users who got grandfathered in can still remove visits).

**The rules are the last line of defense.** Client-side checks are for UX; rules are for security.

---

## 7. The architecture, summarized

If someone in an interview asks you to describe this architecture, here's a one-paragraph answer:

> **A layered, IIFE-based vanilla-JS PWA that namespaces everything onto a single `window.BARK` global. The frontend has eight layers (utils, config, repos, state, services, engines, modules, renderers) loaded in strict order via 40+ `<script>` tags, with a bootstrap orchestrator (`core/app.js`) that initializes features one by one and tolerates individual failures. State is partly reactive (typed stores with `onChange` subscriptions in `settingsStore` and `appState`) and partly old-school globals (`window.BARK.tripDays`, etc.). The backend is a single Firebase Cloud Functions file (~2.6K LOC) exposing 12 callables — half handle premium routing/geocoding through ORS with rate limits and kill switches, the rest handle payments via LemonSqueezy webhooks and a scheduled hourly leaderboard rebuild. Firestore security rules enforce entitlement and free-tier limits on the server. Tests are split into Node unit tests, Firebase rules tests, and ~27 Playwright end-to-end smoke tests.**

If you can deliver that paragraph and then point at five specific files when asked, you understand this codebase better than 95% of the people who'd walk into it cold.

---

## 8. Code health: the honest report card

| Area | Grade | Why |
|---|---|---|
| File organization | A− | The numbered top-level folders + layered subfolders are unusually clean for a solo project |
| Naming | A | Almost every function name tells you what it does; the few exceptions (`safePoll`, `_isMoving`) are old |
| State management | C+ | Mix of reactive stores and global mutables; the globals are well-conventioned but still globals |
| Module boundaries | C | Every module reads `window.BARK.*` directly — no DI, no events, no contracts |
| Defensive coding | A | Destructive-refresh guards, rate limits, kill switches, geofencing, score recomputation. Real attention to "what if?" |
| Testing | B− | Strong Playwright coverage of the critical user flows, but unit tests are sparse for a 21K-LOC frontend |
| Documentation | A− | `04-docs/` is essentially a small Wikipedia of decisions, plans, and post-mortems. Most projects have nothing |
| Backend | B | One 2.6K-line file is too big, but the *logic* is sound — proper transactions, signature verification, server-side validation |
| Security rules | A | Tight. Protected keys, free-tier limits, achievement field whitelisting, no over-permissive wildcards |
| Type safety | F | No TypeScript, no JSDoc types. Refactors are scary because errors are runtime-only |
| Build/tooling | C | "No build step" is a feature (simple to deploy) but a cost (no tree-shaking, no minification, every page load fetches ~40 files) |

**Overall: B / B+.** This is a much-better-than-average solo project. The defensive coding and operational thinking (kill switches, rate limits, server-side score validation, destructive-refresh guards) are well above what you'd expect from a student build. The cost is paid in two places: **bigness of certain files** (tripPlanner, expedition, search) and **implicit dependencies via `window.BARK`** that make refactoring risky without a type checker.

---

## 9. Patterns worth stealing for your own projects

Here's the list of things from this codebase that will pay you dividends *anywhere* you write code:

1. **The repository pattern.** Centralize each domain entity behind one object that owns reads, writes, and change notifications. Don't let every file fetch its own data.
2. **Configuration-as-data.** When you have N things that interact with M things, make the interactions data, not code. The `settingsRegistry` is the example.
3. **Pure utilities at the bottom.** Push everything you can into pure functions in `utils/`. They're trivial to test and reuse.
4. **Graceful degradation.** `try/catch` around init code; if a feature fails, the rest of the app still loads. Almost no toy programs do this; almost all real ones must.
5. **State keys for memoization.** Hash all your inputs into one string and short-circuit work when the key is unchanged. `renderEngine` uses this.
6. **Debouncing and frame-budgeting.** For anything user-input driven: don't react to every keystroke; wait for them to stop. For heavy work: slice it into 16ms chunks so the UI stays at 60fps.
7. **Kill switches.** A boolean env var that disables a feature is worth ten emergency deploys.
8. **Server-side validation, always.** Whatever the client claims, recompute it on the server. Especially scores, prices, and entitlements.
9. **Constant-time comparisons for secrets.** Never use `===` to compare hashes; always use `timingSafeEqual`.
10. **Versioned cache busters.** Notice every `<script>` tag has `?v=11` — when you update a file, you bump the version, and browsers re-download instead of using the old cached copy. Crude but reliable.

---

## 10. Patterns *not* worth stealing

Honest list of things this codebase does that you should not copy on a new project:

1. **One huge global namespace (`window.BARK`).** Worked once, won't scale, hard to refactor. Use ES Modules or TypeScript modules from day one.
2. **God modules.** `tripPlannerCore.js` at 1.5K lines is what happens when "just one more feature" wins for two years straight. Split early.
3. **No type checker.** Every refactor is dangerous. JSDoc types are free; TypeScript is one config file. Use them.
4. **40 `<script>` tags in a fixed order.** Use a bundler. Vite + ES modules takes 10 minutes to set up and pays for itself the first day.
5. **One 2.6K-line backend file.** Split `functions/index.js` by feature: `functions/premium.js`, `functions/payments.js`, `functions/admin.js`. Re-export from a small `index.js`.

---

## 11. Where to go next

If you want to deepen your understanding of this codebase, here's a study order:

1. Read [core/app.js](01-code/app/core/app.js) — see the boot sequence.
2. Read [modules/settingsRegistry.js](01-code/app/modules/settingsRegistry.js) — see configuration-as-data done well.
3. Read [repos/ParkRepo.js](01-code/app/repos/ParkRepo.js) — see the repository pattern with safety guards.
4. Read [state/settingsStore.js](01-code/app/state/settingsStore.js) — see a minimal reactive store.
5. Read [06-config/firestore.rules](06-config/firestore.rules) — see how server-side authorization works.
6. Skim [functions/index.js](01-code/functions/index.js) sections on rate limiting and webhook verification.
7. Read one Playwright test in [03-tests/playwright/](03-tests/playwright/) — see how end-to-end testing simulates real users.

If you want to *contribute*, the queue of work is tracked elsewhere (the owner uses CLAUDE.md files to maintain a fix queue) — don't go ripping out the god modules just because they're big. They are big *because they work*, and refactoring without tests is how you break shipping software.

---

*This document is a teaching artifact, not a spec. Specific line counts and file shapes will drift as the code evolves; the patterns will not.*
