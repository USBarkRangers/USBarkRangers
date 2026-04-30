# Code Audit Report

## Executive Summary

This audit found several production-blocking risks. The biggest are unauthenticated Cloud Functions that can write to the production spreadsheet, exposed paid API keys, multiple XSS paths from sheet data and saved trip data, corrupt CSV files containing unresolved merge-conflict markers, and map cluster/filter logic that can keep hidden pins inside clusters.

The app has some solid defensive work already: marker lifecycle management is centralized, search is chunked, several trip overlay popups escape HTML, data refreshes try to reject destructive spreadsheet updates, and the current non-legacy JavaScript passes a syntax check. The risk is concentrated in trust boundaries: user/sheet data is often inserted with `innerHTML`, premium/admin controls are mostly frontend gates, and production data/fetch failure paths need stronger fallbacks.

Scope notes:
- I inspected the project statically file by file and ran focused `rg` searches, CSV/JSON validation, and JavaScript syntax checks.
- I did not rewrite app behavior or run live Firebase/Google/ORS calls.
- Syntax check passed for app JavaScript excluding dependencies and `legacy/`. `legacy/snippet.js` has a syntax error, but `firebase.json` excludes `legacy/**` from hosting.

## Critical Issues

### 1. Admin spreadsheet and AI Cloud Functions do not enforce backend admin authorization

- Severity: Critical
- File: `functions/index.js`
- Line or function: `extractParkData()` at lines 75-185, `syncToSpreadsheet()` at lines 190-348
- Problem: The callable functions never check `context.auth`, a custom claim, or the user's Firestore `isAdmin` flag. The only admin gate found is frontend code in `pages/admin.js` lines 50-64, which can be bypassed by calling the function directly.
- Why it matters: Any user who can reach the callable endpoint may burn AI quota, use the paid Gemini route, or update/append production spreadsheet rows.
- How to reproduce, if possible: From a browser with the Firebase config, call `firebase.functions().httpsCallable('syncToSpreadsheet')({...})` as a non-admin or unauthenticated caller and observe that the function proceeds until spreadsheet/API work fails or succeeds.
- Recommended fix: At the start of both functions, require `context.auth`, verify an admin custom claim or `users/{uid}.isAdmin === true` with the Admin SDK, reject with `permission-denied`, enable Firebase App Check enforcement, and add rate limits.
- Confidence level: High

### 2. Paid API keys are exposed or hardcoded

- Severity: Critical
- File: `modules/barkConfig.js`, `functions/index.js`, `engines/tripPlannerCore.js`
- Line or function: ORS key in `barkConfig.js` line 35, ORS key in `functions/index.js` lines 22-24, Gemini paid key in `functions/index.js` lines 110-112, client ORS call in `tripPlannerCore.js` line 657
- Problem: The OpenRouteService key is shipped to every browser and also duplicated in Cloud Functions. A paid Gemini key is hardcoded in source. Trip route generation calls ORS directly from the browser instead of the protected `getPremiumRoute()` function.
- Why it matters: API keys can be copied and abused, causing quota exhaustion, billing exposure, or service denial for legitimate users.
- How to reproduce, if possible: Open DevTools, inspect `window.BARK.config.ORS_API_KEY`, or inspect network requests during route generation.
- Recommended fix: Rotate the exposed keys, move paid keys to Firebase secrets/environment variables, proxy ORS route generation through a callable function that verifies the user and premium status, and remove client-side paid keys entirely.
- Confidence level: High

### 3. XSS risk from unescaped sheet, route, and trip-planner data

- Severity: Critical
- File: `renderers/panelRenderer.js`, `modules/renderEngine.js`, `engines/tripPlannerCore.js`, `renderers/routeRenderer.js`
- Line or function: `panelRenderer.js` lines 75-94 and 116-119, `renderEngine.js` lines 40-49, `tripPlannerCore.js` lines 26, 308-318, 395, 478, 494, 510, `routeRenderer.js` lines 35-44 and 69-74
- Problem: Data from the spreadsheet, geocoded trip stops, user route names, day notes, and saved route colors/names are inserted through `innerHTML` without escaping. The day notes textarea is especially risky because a saved note containing `</textarea>` can break out into executable markup.
- Why it matters: A malicious or accidental sheet value or saved route name could run JavaScript in another user's browser, steal session data, alter saved routes, or corrupt UI.
- How to reproduce, if possible: Put `<img src=x onerror=alert(1)>` into a sheet info field, trip stop name, route name, or day note and open the related panel/list.
- Recommended fix: Replace dynamic `innerHTML` with DOM creation plus `textContent`. For intentional rich text, sanitize with a strict allowlist. Validate URLs with `new URL()`, allow only `http:` and `https:`, and add `rel="noopener noreferrer"` to external links.
- Confidence level: High

### 4. Repository CSV data files contain unresolved merge-conflict markers

- Severity: High
- File: `data/data.csv`, `data/sheet_data_fetched.csv`
- Line or function: Both files start at line 1 with `<<<<<<< HEAD`
- Problem: `data/data.csv` has 72 `<<<<<<<`, 72 `=======`, and 72 `>>>>>>>` markers. `data/sheet_data_fetched.csv` has 168 of each marker. Python `csv.DictReader` sees the only header as `<<<<<<< HEAD`.
- Why it matters: Any script, fallback, QA task, or future build that uses these files will parse bad headers and malformed rows. This can create missing IDs, missing coordinates, duplicate rows, and broken rollback data.
- How to reproduce, if possible: Run a CSV parser against either file and inspect headers; the first header is `<<<<<<< HEAD`.
- Recommended fix: Resolve the conflicts, regenerate the CSVs from the authoritative source, and add a predeploy/data validation step that fails on `<<<<<<<`, `=======`, or `>>>>>>>` in data files.
- Confidence level: High

### 5. Verified GPS check-ins can fail for new user documents

- Severity: High
- File: `services/checkinService.js`, `services/firebaseService.js`
- Line or function: `verifyGpsCheckin()` calls `updateCurrentUserVisitedPlaces()` at `checkinService.js` line 147; `updateCurrentUserVisitedPlaces()` uses Firestore `update()` at `firebaseService.js` line 240
- Problem: Firestore `update()` fails if `users/{uid}` does not exist. A newly created account that has not yet had a user document created can fail verified check-in even though the local GPS verification succeeded.
- Why it matters: The user sees a failed check-in after allowing location access and being within range. This is a high-friction failure at a core app moment.
- How to reproduce, if possible: Create a fresh user with no Firestore user doc, open a park panel near the location, and try verified GPS check-in.
- Recommended fix: Use `set({ visitedPlaces }, { merge: true })` for this path, or ensure user docs are created on auth signup before any check-in path can run.
- Confidence level: Medium-High

### 6. Saved routes lose start/end bookends

- Severity: High
- File: `engines/tripPlannerCore.js`, `renderers/routeRenderer.js`
- Line or function: `saveCurrentTrip()` lines 604-619, `loadRouteIntoPlanner()` lines 77-90
- Problem: Saving a route stores `tripDays` only. It does not save `window.tripStartNode` or `window.tripEndNode`. Loading a route only restores `tripDays`.
- Why it matters: A user can carefully plan a trip with a custom start/end city, save it, and later reload a different route than the one they saved.
- How to reproduce, if possible: Set a trip start, add stops, set a trip end, save the route, reload it, and observe that start/end nodes are gone.
- Recommended fix: Save `tripStartNode` and `tripEndNode` with route data, validate their lat/lng on load, and include migration defaults for old routes.
- Confidence level: High

### 7. Trip route generation can attach bookends to the wrong day

- Severity: High
- File: `engines/tripPlannerCore.js`
- Line or function: `generateAndRenderTripRoute()` lines 625-660
- Problem: The code filters `tripDays` to only days with two or more stops, then applies the trip start to the first filtered day and trip end to the last filtered day. If a user has sparse days, empty days, or one-stop days, bookends can attach to a different original day than intended.
- Why it matters: Generated driving routes can be logically wrong while still looking successful.
- How to reproduce, if possible: Create Day 1 with one stop, Day 2 with two stops, set a start bookend intended for Day 1, then generate the route. The start is applied to Day 2.
- Recommended fix: Iterate original day indexes, include bookends before filtering, and decide explicitly whether one-stop days with bookends are routable.
- Confidence level: High

## Map Behavior Issues

### 1. Filtered-out markers remain inside cluster counts

- Severity: High
- File: `modules/renderEngine.js`, `modules/MarkerLayerManager.js`, `modules/mapEngine.js`
- Line or function: marker visibility in `renderEngine.js` lines 320-351, cluster add logic in `MarkerLayerManager.js` lines 179-205, cluster count in `mapEngine.js` lines 376-382
- Problem: In cluster mode, invisible markers are still kept inside `markerClusterGroup`; only their DOM icon gets a hidden class when rendered. Leaflet cluster counts are based on child markers, not CSS visibility.
- Why it matters: Bubble/cluster mode can show counts for pins the current search/filter should have removed. Users can zoom into a cluster expecting visible results and see unrelated or hidden pins.
- How to reproduce, if possible: Enable cluster/bubble mode, apply a narrow swag or search filter, and compare cluster counts against the visible result count.
- Recommended fix: In cluster mode, add only currently visible markers to the cluster layer, or maintain separate visible marker arrays and refresh clusters when filters/search/visited state changes.
- Confidence level: High

### 2. Route-stop badges can collapse when the same location appears twice

- Severity: Medium-High
- File: `modules/TripLayerManager.js`, `engines/tripPlannerCore.js`
- Line or function: `stableStopKey()` lines 84-86, `syncBadges()` lines 258-281, add-day duplication in `tripPlannerCore.js` lines 430-435
- Problem: Trip badges are keyed by park ID or raw `lat,lng`. If the same stop appears twice, the first occurrence wins and later occurrences do not get their own badge.
- Why it matters: Day handoff stops and duplicated custom stops can make route numbers look detached from the visible route.
- How to reproduce, if possible: Add a day after a day with stops; the previous last stop is copied into the new day. The overlay only shows one badge for that shared stop.
- Recommended fix: Add a generated `tripStopId` for every stop instance and key badges by stop instance, not only park ID or coordinates. Keep separate `placeId` for official park identity.
- Confidence level: High

### 3. Saved map position is restored without validating coordinates

- Severity: Medium-High
- File: `modules/mapEngine.js`
- Line or function: `setInitialMapView()` lines 123-137
- Problem: `mapLat`, `mapLng`, and `mapZoom` are read from `localStorage` and passed to Leaflet after `parseFloat`/`parseInt`, but the code never checks for `NaN`, infinity, valid latitude/longitude ranges, or zoom range.
- Why it matters: Corrupt localStorage can make the map initialize at invalid coordinates or fail to render.
- How to reproduce, if possible: Set `localStorage.mapLat = 'abc'`, reload with remember-map-position enabled, and observe invalid map state or console errors.
- Recommended fix: Validate finite lat/lng, clamp lat to -90..90, lng to -180..180, clamp zoom to map min/max, and fall back to default US center if invalid.
- Confidence level: High

### 4. One-finger mobile zoom has mixed timer cleanup

- Severity: Medium
- File: `modules/mapEngine.js`
- Line or function: one-finger zoom engine lines 413-495
- Problem: `zoomRAF` stores either a `requestAnimationFrame` id or a `setTimeout` id. `resetZoomState()` always calls `cancelAnimationFrame(zoomRAF)`, so timeout-based zoom updates can survive gesture cleanup when `window.stopResizing` is true.
- Why it matters: On mobile or low-power settings, a stale zoom callback can fire after the user's gesture ended, causing a jumpy map.
- How to reproduce, if possible: Enable the setting path that sets `window.stopResizing`, double-tap-hold zoom, release quickly, and watch for delayed zoom jumps.
- Recommended fix: Track timeout and RAF handles separately, or store a handle type and call `clearTimeout` for timeout handles.
- Confidence level: Medium-High

### 5. Route generation uses the global `map` variable instead of `window.map`

- Severity: Medium
- File: `engines/tripPlannerCore.js`, also visible in several modules
- Line or function: route layer add/fit at lines 660 and 669
- Problem: Several files rely on the browser exposing `window.map` as an unqualified global `map`. This works in current non-module scripts, but it is fragile and can conflict with DOM globals or break during module/bundler migration.
- Why it matters: A future production build or script-mode change could make route rendering fail with `ReferenceError: map is not defined`.
- How to reproduce, if possible: Run the code as ES modules or in stricter bundler scope.
- Recommended fix: Use `window.map` or inject the map reference consistently, as `TripLayerManager` already partly does.
- Confidence level: Medium

## Performance Issues

### 1. Every marker sync scans all pins and recomputes visibility

- Severity: High
- File: `modules/renderEngine.js`, `modules/MarkerLayerManager.js`
- Line or function: `updateMarkers()` lines 316-370, `MarkerLayerManager.sync()` lines 219-239
- Problem: Every `syncState()` calls `markerManager.sync(allPoints)`, then loops all points to evaluate filters/search/visited/culling, then calls `applyVisibility(allPoints)`. This is acceptable around a few hundred pins but will stutter as data grows.
- Why it matters: With 1,000+ pins, search typing, filter toggles, visited changes, and map movement can become main-thread heavy on older phones.
- How to reproduce, if possible: Load a 1,000+ row dataset, enable performance profiling, type in search, toggle filters, and observe repeated full-array work.
- Recommended fix: Separate data-sync from visibility-sync. Only fingerprint/sync marker data when the data revision changes; for filters, update only affected IDs or use precomputed indexes.
- Confidence level: High

### 2. Budgeted search publishes partial results through full map sync

- Severity: Medium-High
- File: `modules/searchEngine.js`, `modules/renderEngine.js`
- Line or function: `publishSearchProgress()` lines 553-559, chunk loop lines 562-591
- Problem: Search correctly chunks CPU work, but each partial publish calls `window.syncState()`, which performs full marker visibility work. Chunking the search can still produce repeated whole-map updates.
- Why it matters: On large datasets, search may flicker and consume frames even though the search algorithm itself is chunked.
- How to reproduce, if possible: Use a large dataset and type a broad query; watch marker updates happen multiple times before search completes.
- Recommended fix: Render suggestion progress during chunks, but delay map filtering until the search run completes or throttle map sync to a lower rate.
- Confidence level: High

### 3. Cluster filtering by CSS does not reduce cluster workload

- Severity: Medium-High
- File: `modules/renderEngine.js`, `modules/MarkerLayerManager.js`
- Line or function: `marker-filter-hidden` class at `renderEngine.js` lines 353-365, cluster layer add at `MarkerLayerManager.js` lines 202-204
- Problem: CSS hiding avoids some DOM churn, but the cluster plugin still manages markers that are no longer relevant to the current filter/search.
- Why it matters: Cluster calculations and counts stay tied to total pins rather than visible pins.
- How to reproduce, if possible: Apply a restrictive filter in cluster mode and profile cluster recalculation/child counts.
- Recommended fix: Maintain a visible-marker set and update cluster membership when filters/search change.
- Confidence level: High

### 4. Watermark tool can allocate very large canvases

- Severity: Medium
- File: `modules/shareEngine.js`
- Line or function: `drawWatermark()` lines 163-180, high-res toggle at lines 166-172, download at line 194
- Problem: If high-res mode is enabled, the canvas uses the original image dimensions plus border with no file size, megapixel, or memory guard.
- Why it matters: A large phone photo or panorama can crash mobile Safari/Chrome or make the tab unresponsive.
- How to reproduce, if possible: Upload a very large image, enable high-res mode, and download.
- Recommended fix: Add max megapixels, max file size, and user-facing downscale behavior. Prefer `toBlob()` over `toDataURL()` for large exports.
- Confidence level: High

### 5. Visited places are written as a full array after each change

- Severity: Medium
- File: `services/firebaseService.js`
- Line or function: `syncUserProgress()` lines 208-221 and `updateCurrentUserVisitedPlaces()` lines 231-240
- Problem: Every visit update writes the full `visitedPlaces` array.
- Why it matters: Heavy users can approach Firestore document-size limits and pay repeated bandwidth costs. Offline/pending mutations also become harder to reconcile as the array grows.
- How to reproduce, if possible: Create a user with hundreds of visited records and profile mark/unmark latency and payload size.
- Recommended fix: Store visits in a subcollection or keyed map with incremental updates. Keep a denormalized summary count on the user doc.
- Confidence level: Medium-High

### 6. Data polling always hits the live Google Sheet after cached load

- Severity: Medium
- File: `modules/dataService.js`
- Line or function: `loadData()` lines 438-464, `pollForUpdates()` lines 295-345
- Problem: Even when a cached CSV is loaded, the app immediately starts polling and fetches the live spreadsheet on startup.
- Why it matters: Slow networks and Google Sheets failures can still add startup work and request pressure. With many users, this pushes every client toward the sheet endpoint.
- How to reproduce, if possible: Load the app with a cached CSV and watch network requests.
- Recommended fix: Add a freshness window before first poll, serve a versioned static data file from hosting/CDN, or use a backend cache.
- Confidence level: High

## Data Issues

### 1. Local master list schema does not match runtime schema

- Severity: High
- File: `BARK Master List.csv`, `pages/admin.js`
- Line or function: admin load/search at `pages/admin.js` lines 66-82 and 405-424
- Problem: `BARK Master List.csv` headers are `Location`, `State`, `Swag Cost`, etc. Admin search expects `name`, `state`, and `lat_lng`.
- Why it matters: Admin fuzzy matching is likely broken or partially blank, causing syncs to target the wrong site or lose coordinate identity.
- How to reproduce, if possible: Open the admin page, search for a known park, and inspect `res.item.name`/`res.item.lat_lng`; they are not present in the loaded CSV rows.
- Recommended fix: Normalize master CSV rows on load, or update the admin code to use the actual headers. Add a CSV header validator before enabling sync.
- Confidence level: High

### 2. Latitude/longitude validation is incomplete

- Severity: Medium-High
- File: `modules/dataService.js`, `modules/TripLayerManager.js`
- Line or function: data row skip at `dataService.js` line 122, trip badge lat/lng type check at `TripLayerManager.js` lines 262-265
- Problem: Data service skips rows with falsy lat/lng but does not validate finite numeric values or coordinate ranges. Trip badges require numeric lat/lng and silently skip string coordinates from old saved routes.
- Why it matters: Bad coordinates can create broken markers, while string coordinates can make route badges disappear after loading saved data.
- How to reproduce, if possible: Add a row with `lat=abc`, `lng=999`, or saved route stop lat/lng as strings and load the app/route.
- Recommended fix: Normalize all lat/lng with `Number()`, reject non-finite values, validate ranges, and convert saved route stops during load.
- Confidence level: High

### 3. Destructive refresh guard can keep deleted/renamed pins forever

- Severity: Medium
- File: `modules/dataService.js`
- Line or function: destructive refresh rejection at lines 170-184
- Problem: If the live sheet intentionally removes or renames canonical Park IDs, the client rejects that refresh and keeps stale cached points.
- Why it matters: Deleted, merged, or corrected locations may remain visible indefinitely for users with old caches.
- How to reproduce, if possible: Load data, then publish a sheet version missing an existing Park ID; the refresh is rejected.
- Recommended fix: Keep the guard, but add a signed/versioned deletion list or a migration version that permits intentional removals.
- Confidence level: Medium

### 4. CSV cache writes can throw and interrupt data acceptance

- Severity: Medium
- File: `modules/dataService.js`
- Line or function: `commitCSVCache()` lines 203-207
- Problem: `localStorage.setItem()` is not wrapped in `try/catch`. In private browsing, disabled storage, or quota-exceeded states, it can throw.
- Why it matters: A storage failure can break the data parse complete path after data was otherwise valid.
- How to reproduce, if possible: Simulate quota exceeded or disabled localStorage and load fresh data.
- Recommended fix: Wrap cache writes and reads in storage helper functions that fail soft with a console warning.
- Confidence level: Medium-High

### 5. Build and repair scripts point at wrong paths

- Severity: Medium
- File: `scripts/buildTrails.js`, `scripts/fix_csv.py`
- Line or function: `buildTrails.js` lines 19-20, `fix_csv.py` lines 18 and 28
- Problem: `buildTrails.js` looks for `scripts/raw_trails` and writes `scripts/trails.json`, while the repo has root `raw_trails/` and root `trails.json`. `fix_csv.py` reads/writes `data.csv` in the current directory, not `data/data.csv`.
- Why it matters: Data maintenance scripts can silently fail or write files that production never uses.
- How to reproduce, if possible: Run the scripts from repo root and inspect paths/read errors/output location.
- Recommended fix: Resolve paths relative to repo root or accept explicit CLI input/output paths.
- Confidence level: High

## Mobile and UX Issues

### 1. Mobile viewport disables user zoom

- Severity: High
- File: `index.html`
- Line or function: viewport meta line 6
- Problem: The page sets `maximum-scale=1.0, user-scalable=no`.
- Why it matters: Users with low vision cannot pinch-zoom the UI. This is an accessibility and mobile usability problem.
- How to reproduce, if possible: Open the app on iPhone Safari and try to pinch-zoom UI text.
- Recommended fix: Remove `maximum-scale=1.0, user-scalable=no`. Manage map gestures through Leaflet settings rather than disabling page zoom globally.
- Confidence level: High

### 2. App prompts for location shortly after load

- Severity: Medium
- File: `modules/mapEngine.js`
- Line or function: automatic `map.locate()` at lines 346-354
- Problem: The app requests location automatically after 500 ms unless a saved position or national view is active.
- Why it matters: Immediate permission prompts can feel invasive, especially before the user understands why location is needed.
- How to reproduce, if possible: Visit the app for the first time on a phone/browser with no saved map position.
- Recommended fix: Start at national/default view and request location only after a clear user action, such as "Find me" or verified check-in.
- Confidence level: High

### 3. External links opened in new tabs lack `rel`

- Severity: Medium
- File: `index.html`, `renderers/panelRenderer.js`, `modules/renderEngine.js`
- Line or function: `index.html` lines 196, 292-344; panel links around `panelRenderer.js` lines 127-160; generated swag links at `renderEngine.js` lines 47-49
- Problem: Many `target="_blank"` links do not include `rel="noopener noreferrer"`.
- Why it matters: The opened page can access `window.opener` and potentially redirect the app tab.
- How to reproduce, if possible: Inspect rendered external links.
- Recommended fix: Add `rel="noopener noreferrer"` to every new-tab link.
- Confidence level: High

### 4. Right-click/context menu is disabled across most of the app

- Severity: Low-Medium
- File: `controllers/uiController.js`
- Line or function: document `contextmenu` handler lines 11-15
- Problem: The app prevents the context menu outside input fields.
- Why it matters: Desktop users lose expected browser behavior, and some accessibility workflows rely on context menus.
- How to reproduce, if possible: Right-click map/UI areas outside text inputs.
- Recommended fix: Remove the global block or limit it to specific drag/gesture surfaces where it is truly needed.
- Confidence level: High

### 5. No clear empty-state when filters/search hide all pins

- Severity: Medium
- File: `modules/renderEngine.js`, `modules/searchEngine.js`
- Line or function: visibility loop at `renderEngine.js` lines 320-367
- Problem: The map can end up with zero visible pins after filters/search, but the map itself does not show a clear empty-state or reset CTA.
- Why it matters: Users may think the map broke or pins disappeared.
- How to reproduce, if possible: Apply a filter or search that has no matching local pins.
- Recommended fix: Show a small non-blocking "No pins match" state with reset-filter/search actions.
- Confidence level: Medium

### 6. Admin image preview leaks object URLs during a session

- Severity: Low-Medium
- File: `pages/admin.js`
- Line or function: thumbnail object URL at lines 120-127
- Problem: Object URLs are created for scheduled files but are not revoked when thumbnails are removed or rerendered.
- Why it matters: Long admin sessions with many screenshots can leak memory.
- How to reproduce, if possible: Add/remove many screenshots and observe increasing blob URLs/memory.
- Recommended fix: Track object URLs and revoke them on remove, clear, and before rerender.
- Confidence level: High

## Security/Privacy Issues

### 1. Premium checks are client-side for route/search/map behavior

- Severity: High
- File: `services/authService.js`, `modules/searchEngine.js`, `engines/tripPlannerCore.js`
- Line or function: premium flags in `authService.js` lines 234-269, global search gating in `searchEngine.js` lines 263-272, route generation in `tripPlannerCore.js` lines 625-660
- Problem: Premium state controls are set in frontend globals/localStorage. Route generation and global geocoding still rely on client-visible logic and keys.
- Why it matters: Users can tamper with frontend flags. Any paid or quota-bearing feature must be enforced on the server.
- How to reproduce, if possible: Modify localStorage/globals in DevTools and inspect enabled UI/network paths.
- Recommended fix: Move paid operations behind callable functions that verify auth and premium entitlement server-side.
- Confidence level: High

### 2. GPS verification is entirely client-side

- Severity: Medium-High
- File: `services/checkinService.js`, `modules/barkConfig.js`
- Line or function: check-in flow at `checkinService.js` lines 121-148, radius config at `barkConfig.js` line 36
- Problem: GPS check-in relies on browser geolocation and client-side distance checks. The accepted radius is 25 km.
- Why it matters: Users can spoof browser location or alter client code, and the radius is broad enough to verify from far away.
- How to reproduce, if possible: Use browser geolocation overrides in DevTools and verify a nearby park.
- Recommended fix: Treat GPS verification as trust-limited, reduce radius if product allows, record audit metadata, and consider server-side sanity checks for repeated impossible movement.
- Confidence level: Medium

### 3. Screenshot export loader can hang concurrent callers

- Severity: Medium
- File: `modules/shareEngine.js`
- Line or function: `loadScreenshotEngine()` lines 8-25
- Problem: If `html2canvas` is loading and a second caller waits in the interval branch, a script-load failure resets `window.isDownloadingCanvas` but the waiting promise never rejects or resolves.
- Why it matters: Export buttons can remain stuck after CDN failure or ad-blocking.
- How to reproduce, if possible: Block cdnjs, click multiple export actions quickly.
- Recommended fix: Store a single shared load promise with both resolve and reject paths, plus a timeout.
- Confidence level: Medium-High

### 4. Raw AI output is logged in Cloud Functions

- Severity: Low-Medium
- File: `functions/index.js`
- Line or function: `console.log("AI RAW OUTPUT", ...)` at line 179
- Problem: Extracted AI data from screenshots/text is logged.
- Why it matters: Logs may retain user-submitted screenshot-derived content longer than intended.
- How to reproduce, if possible: Call `extractParkData()` and inspect Cloud Function logs.
- Recommended fix: Remove raw content logs or log only counts/metadata. Keep detailed logs behind a short-lived debug flag.
- Confidence level: High

## Reliability and Production-Readiness Issues

### 1. No test or validation scripts are defined

- Severity: High
- File: `package.json`, `functions/package.json`
- Line or function: both files have dependencies only, no `scripts`
- Problem: There is no standard `npm test`, lint, syntax check, data validation, or predeploy script.
- Why it matters: Regressions like conflict markers, exposed keys, bad CSV headers, and syntax errors can land without a repeatable check.
- How to reproduce, if possible: Run `npm test`; no script is defined.
- Recommended fix: Add scripts for JS syntax/lint, data validation, secret scanning, and a small browser smoke test.
- Confidence level: High

### 2. First-time offline or blocked-spreadsheet users get an empty map

- Severity: High
- File: `modules/dataService.js`, `firebase.json`
- Line or function: `loadData()` lines 438-464, hosting ignores `data/**` at `firebase.json` lines 23-25
- Problem: The app relies on cached localStorage or the live Google Sheet. The repo has `data/data.json`, but hosting ignores `data/**`, and `loadData()` does not use a bundled fallback.
- Why it matters: First-time users on slow/offline networks or blocked Google Sheets can see no pins.
- How to reproduce, if possible: Clear localStorage, block the Google Sheet URL or go offline, and load the app.
- Recommended fix: Host a versioned static data snapshot and load it as fallback before/after live sheet polling.
- Confidence level: High

### 3. Geocoding fallback key can silently fail

- Severity: Medium
- File: `functions/index.js`
- Line or function: Google geocode URL at line 275
- Problem: If `GOOGLE_MAPS_API_KEY` is missing, the function uses the literal placeholder `"AIzaSy..."`.
- Why it matters: Geocoding appears to run but fails at runtime, which can append rows without coordinates.
- How to reproduce, if possible: Deploy without `GOOGLE_MAPS_API_KEY` and sync a new park requiring geocode.
- Recommended fix: If the env var is missing, throw `failed-precondition` before attempting the request.
- Confidence level: High

### 4. Legacy file has a syntax error

- Severity: Low
- File: `legacy/snippet.js`
- Line or function: line 440
- Problem: `node --check legacy/snippet.js` reports `SyntaxError: missing ) after argument list`.
- Why it matters: `legacy/**` is excluded from hosting, so this is not a runtime issue today. It is still a repo hygiene risk if someone copies code from it or changes hosting ignores.
- How to reproduce, if possible: Run `node --check legacy/snippet.js`.
- Recommended fix: Delete, archive outside the app repo, or fix the syntax and mark it clearly as non-runtime reference code.
- Confidence level: High

## Suggested Test Plan

### Desktop

- Load the app with a clean profile and confirm map, pins, filters, panel, profile, and route planner initialize with no console errors.
- Search for exact, partial, misspelled, and no-result park names.
- Toggle each swag filter, visited/unvisited filter, clustering/bubble mode, premium/standard settings, and map style.
- Open several pin panels and verify external links, images, video link, directions links, and "suggest edit" links.
- Save, load, delete, and load-more saved routes.

### iPhone Safari

- Verify page zoom is possible after fixing the viewport issue.
- Test pinch zoom, double-tap zoom, one-finger zoom, dragging, bottom nav, slide panel, popups, and keyboard behavior in search fields.
- Check that popups and the slide panel do not overflow the screen.
- Test geolocation permission denial, allow, and repeated verified check-in taps.

### Android Chrome

- Repeat map gestures: pan, pinch, double-tap, one-finger zoom, cluster tap, and marker tap.
- Test route planner scrolling, day tabs, moving stops, notes entry, and export-to-maps links.
- Test low-power/performance settings and confirm they do not leave delayed zoom or stale marker state.

### Slow Network

- Throttle to Slow 3G.
- Block the Google Sheet URL and verify fallback/empty state.
- Block ORS and verify route errors are actionable and buttons recover.
- Block cdnjs/html2canvas and verify screenshot/export buttons recover.
- Block Turf and verify expedition trails show a friendly unavailable state.

### 1,000+ Pins

- Load a generated 1,000+ pin dataset with valid IDs and coordinates.
- Profile search typing, filter toggles, cluster toggles, zooming, panning, and visited toggles.
- Confirm no duplicate markers remain after data refresh or mode changes.
- Confirm memory does not grow after repeated filter/search/cluster cycles.

### Mode Switching

- Switch profile/map/trip/settings tabs repeatedly.
- Toggle premium and standard performance settings.
- Change cluster/bubble, low graphics, no animations, culling, zoom lock, map panning lock, and map position memory.
- Confirm active buttons visually match real state.

### Route Planning

- Add official parks, custom geocoded places, duplicate stops, empty days, one-stop days, and multi-day routes.
- Set start/end bookends, save, reload, generate route, and confirm bookends persist.
- Test route generation while signed out, signed in non-premium, premium, ORS failure, and with invalid stop coordinates.

### Bubble/Cluster Mode

- Enable cluster mode, apply filters/search, and verify clusters count only visible matching pins.
- Add route stops while cluster mode is enabled and confirm route badges stay visible and correctly numbered.
- Zoom from cluster to plain markers and back; confirm no duplicate/stale markers remain.

### Premium/Standard Mode

- Confirm premium-only actions are enforced server-side, not only hidden/disabled in the UI.
- Attempt premium route/global search from DevTools with tampered frontend flags.
- Verify guest defaults, logout reset, login hydration, and cloud settings persistence.

### Invalid Data

- Test missing IDs, duplicate IDs, blank names, invalid lat/lng, out-of-range lat/lng, malformed URLs, missing images, and invalid categories.
- Confirm bad rows are rejected with clear logs and do not break the whole map.

### Missing Data

- Test no cached CSV, no network, failed Google Sheet, stale cache, and intentional deleted Park IDs.
- Confirm the user sees a helpful empty/error/fallback state.

## Recommended Fix Order

1. Lock down `extractParkData()` and `syncToSpreadsheet()` with backend admin authorization, App Check, and rate limits.
2. Rotate exposed ORS/Gemini keys and move all paid/quota-bearing operations behind server-side functions.
3. Replace unsafe dynamic `innerHTML` paths for sheet data, trip planner data, saved routes, and generated links.
4. Resolve CSV merge conflicts and add a data validation script that blocks conflict markers, bad headers, bad IDs, and invalid coordinates.
5. Fix route persistence by saving/loading start and end bookends, then validate saved route stop coordinates on load.
6. Fix cluster filtering so hidden pins are removed from cluster membership, not only hidden with CSS.
7. Add hosted static data fallback for first-time offline/blocked-spreadsheet loads.
8. Make GPS check-in writes use `set(..., { merge: true })` or guarantee user doc creation before check-in.
9. Harden mobile map initialization and gestures: validate saved map position, separate one-finger zoom timers, and remove viewport zoom lock.
10. Add CI/predeploy checks: JS syntax, CSV schema validation, secret scanning, basic browser smoke test, and script path validation.
