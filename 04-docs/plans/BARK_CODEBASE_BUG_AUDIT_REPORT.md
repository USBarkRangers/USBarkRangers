# BARK Codebase Bug Audit Report

Date: 2026-05-04
Scope: BARK Ranger Map only.
Current commit before BUG-AUDIT-007 fix: `bdd10f3`
Workspace: `/Users/carterswarm/BarkRangerMap`

## Important Scope Note

This audit was run from the BARK repo. Static search found no current source-code references to Just Dee Dee / JDDM in the BARK repo outside ignored/generated browser artifacts.

However, Playwright/Chromium did reproduce a local environment problem where a localhost browser context served a cached Just Dee Dee app while the filesystem and `curl` were serving BARK. That is listed as BUG-AUDIT-001 because it can make QA look like the BARK code is contaminated when the repo itself is not.

## Severity Scale

- P0: security/payment/data-loss/showstopper
- P1: likely controlled-beta blocker or serious trust/runtime bug
- P2: visible user bug or significant maintainability/testing risk
- P3: polish, tooling, or lower-impact issue

## Confidence Scale

- 95-100%: reproduced or directly proven by code/test output
- 80-94%: strong static evidence, likely reproducible
- 60-79%: plausible bug; needs targeted reproduction before fixing
- Below 60%: suspicion only; not included as a primary bug

## Commands Run

| Command | Result |
|---|---|
| `node --test tests/phase1b-pending-delete-canonical-replacement.test.js tests/phase1c-vault-subscription.test.js` | PASS 2/2 |
| `npm --prefix functions test` | PASS 65/65 |
| `npm run test:rules` | PASS 17/17 |
| `npm run test:functions:emulator` | PASS 9/9 |
| signed-in `npm run test:e2e:smoke` against `localhost:4173` | FAIL 31/31 because server on 4173 returned `ERR_EMPTY_RESPONSE` |
| signed-in `npm run test:e2e:smoke` against a fresh BARK server on 4174 | BLOCKED: default Chromium context served stale cached Dee Dee app until service workers/cache were blocked |
| one-off Playwright page load with `serviceWorkers: "block"` and cache-bust | PASS: loaded BARK page and BARK scripts |
| `git status --short` after cleanup | Only pre-existing dirty files remain |

Generated artifacts from the audit were cleaned: `firestore-debug.log`, `test-results/`, and the emulator change to tracked `firebase-debug.log`.

Pre-existing dirty files not touched by this report:

- `functions/index.js`
- `functions/tests/checkout-session.test.js`
- `plans/BETA_TESTER_7PM_MEETING_CHECKLIST.md`
- `plans/PHASE_4E_LEMONSQUEEZY_CHECKOUT_PLAN.md`

## Fix Batch 1 Results

Scope: BUG-AUDIT-001, BUG-AUDIT-002, and BUG-AUDIT-003.

| Check | Result |
|---|---|
| BARK identity smoke with cache/service-worker blocking | PASS 1/1 |
| signed-in `npm run test:e2e:smoke` with storage states | PASS 32/32 |
| `node --test tests/data-integrity.test.js tests/render-safety.test.js tests/phase1b-pending-delete-canonical-replacement.test.js tests/phase1c-vault-subscription.test.js` | PASS 8/8 |
| `npm run test:rules` | PASS 17/17 |
| `npm --prefix functions test` | PASS 65/65 |
| `node --check` on changed JavaScript files | PASS |
| conflict marker scan for repaired CSV files | PASS |
| `npm run test:functions:emulator` | FAIL before ORS assertions because the Functions emulator did not load the worker within discovery timeout; no files in this fix batch touch Functions |

The e2e smoke was rerun against `http://localhost:4173/index.html` because the saved Playwright storage states are origin-bound to `localhost:4173`.

## Fix Batch 2 Results

Scope: BUG-AUDIT-004.

| Check | Result |
|---|---|
| `node --check modules/dataService.js` | PASS |
| `node --check tests/playwright/bug004-static-fallback-data-smoke.spec.js` | PASS |
| `node --test tests/data-integrity.test.js` | PASS 3/3 |
| focused BUG-AUDIT-004 Sheet-blocked cold-boot smoke | PASS 1/1 |
| signed-in `npm run test:e2e:smoke` with storage states | PASS 35/35 |
| `git diff --check` | PASS |

Notes:

- The focused smoke blocked the public Google Sheet request, cleared `localStorage.barkCSV`, and verified the app still rendered more than 300 canonical parks and markers from the hosted fallback snapshot.
- Functions and Firestore rules were not rerun for this batch because the fix only touched hosted static data, client data boot logic, Playwright coverage, and this report.

## Fix Batch 3 Results

Scope: BUG-AUDIT-006 and BUG-AUDIT-026.

| Check | Result |
|---|---|
| `node --check engines/tripPlannerCore.js` | PASS |
| `node --check renderers/routeRenderer.js` | PASS |
| `node --check tests/playwright/bug026-trip-save-custom-stop-smoke.spec.js` | PASS |
| focused BUG-AUDIT-026 custom-stop route-save smoke | PASS 1/1 |
| focused BUG-022 settings cloud-sync smoke rerun after a transient full-suite timeout | PASS 3/3 |
| signed-in `npm run test:e2e:smoke` with storage states | PASS 36/36 |
| `git diff --check` | PASS |

Notes:

- The focused smoke uses a signed-in storage state, creates a trip with a custom Hinckley start, a custom Gainesville end, one ID-less custom midpoint, and five canonical BARK stops.
- It saves the route to Firestore, verifies the success dialog does not contain `Unsupported field value`, confirms the saved custom stop omits the missing `id`, confirms start/end bookends were persisted, loads the route back into the planner, verifies the bookends restore, and deletes the test route.
- The first full signed-in smoke run passed the new trip-save test but had one transient BUG-022 premium-entitlement wait timeout; the focused BUG-022 rerun passed 3/3 and the full suite passed 36/36 on rerun.

## Fix Batch 4 Results

Scope: BUG-AUDIT-027.

| Check | Result |
|---|---|
| `node --check modules/renderEngine.js` | PASS |
| `node --check engines/tripPlannerCore.js` | PASS |
| `node --check services/authPremiumUi.js` | PASS |
| `node --check tests/playwright/bug027-route-only-filter-smoke.spec.js` | PASS |
| focused BUG-AUDIT-027 route-only filter smoke | PASS 2/2 |
| signed-in `npm run test:e2e:smoke` with storage states | PASS 38/38 |
| `npm run test:rules` | PASS 17/17 |
| `git diff --check` | PASS |

Notes:

- The focused smoke verifies Premium users can pick `Only Trip Route Pins`, the map hides every park pin except official parks currently in `tripDays`, and adding another stop while the filter is active updates the visible pin set.
- It also verifies a signed-in free user cannot unlock the route-only filter from fake `localStorage`; the app sanitizes back to `all`.

## Fix Batch 5 Results

Scope: BUG-AUDIT-028.

| Check | Result |
|---|---|
| `node --check modules/uiController.js` | PASS |
| `node --check tests/playwright/bug028-fixed-ui-scroll-guard-smoke.spec.js` | PASS |
| focused BUG-AUDIT-028 fixed UI scroll guard smoke | PASS 1/1 |
| signed-in `npm run test:e2e:smoke` with storage states | PASS 39/39 |
| `git diff --check` | PASS |

Notes:

- The focused mobile smoke verifies the filter panel and bottom nav prevent wheel scroll by default.
- It also checks wheel gestures over the filter panel do not zoom the map, and wheel gestures over the fixed bottom nav do not scroll the Profile view underneath it.

## Fix Batch 6 Results

Scope: BUG-AUDIT-007.

| Check | Result |
|---|---|
| `node --check engines/tripPlannerCore.js` | PASS |
| `node --check tests/playwright/bug007-route-bookends-smoke.spec.js` | PASS |
| focused BUG-AUDIT-007 sparse trip bookend routing smoke | PASS 1/1 |
| signed-in `npm run test:e2e:smoke` with storage states | PASS 40/40 |
| `git diff --check` | PASS |

Notes:

- The focused smoke creates a Premium sparse trip where the first original day has one stop plus a trip start, the middle day is empty, and the last original day has one stop plus a trip end.
- The regression verifies the route planner calls ORS twice: once from the start bookend to the first-day stop, and once from the last-day stop to the end bookend. The empty middle day is skipped without moving either bookend to another day.

## Ranked Bug Table

| ID | Title | Area | Severity | Confidence | Evidence | Status |
|---|---|---|---|---:|---|---|
| BUG-AUDIT-001 | Local browser cache can serve Dee Dee while auditing BARK | QA/runtime | P1 | 100% | Playwright loaded `Just Dee Dee Music Live Map`; cache-blocked run loaded BARK | FIXED / QC PASSED |
| BUG-AUDIT-002 | Sheet data can inject HTML into marker detail panel | Security/UI | P1 | 95% | `panelRenderer.js` previously wrote sheet fields through `innerHTML` | FIXED / QC PASSED |
| BUG-AUDIT-003 | CSV data files contain unresolved merge-conflict markers | Data/tooling | P1 | 100% | `data/data.csv` had 216 markers; `data/sheet_data_fetched.csv` had 504 | FIXED / QC PASSED |
| BUG-AUDIT-004 | Hosted fallback data is excluded, so first-time cold boot can show empty map if Sheet fetch fails | Runtime/data | P1 | 90% | `firebase.json` ignores `data/**`; `loadData()` relied on localStorage or live Sheet | FIXED / QC PASSED |
| BUG-AUDIT-005 | Free 5-visit limit backend enforcement | Product/security | P1 | 95% | Rules now deny non-premium `visitedPlaces` writes above 5; client/runtime cap also lowered to 5 | FIXED / QC PASSED |
| BUG-AUDIT-006 | Saved routes do not persist trip start/end bookends | Trip planner | P1 | 95% | `saveCurrentTrip()` saved only `tripDays`; load restored only `tripDays` | FIXED / QC PASSED |
| BUG-AUDIT-007 | Route generation attaches trip bookends after filtering days | Trip planner | P1 | 100% | Focused sparse-trip smoke proves start/end bookends stay on original first/last days after fix | FIXED / QC PASSED |
| BUG-AUDIT-008 | Current worktree has uncommitted Functions/payment files | Release safety | P1 | 100% | `git status --short` shows modified function files | Proven |
| BUG-AUDIT-009 | Repo root is used as Hosting public directory | Hosting/security | P1 | 85% | `firebase.json` has `"public": "."` with an ignore allowlist | Proven static |
| BUG-AUDIT-010 | Version sources disagree | Runtime/update UX | P2 | 100% | `version.json=1`, default runtime version `26`, UI default `12` | Proven static |
| BUG-AUDIT-011 | Third-party scripts/styles are loaded from CDNs without SRI/CSP | Security/reliability | P2 | 90% | Leaflet, markercluster, Turf, QR, Firebase, PapaParse remote loads | Proven static |
| BUG-AUDIT-012 | External links using `target="_blank"` omit `rel` | Security/UI | P2 | 95% | Static links and generated links lack `rel="noopener noreferrer"` | Proven static |
| BUG-AUDIT-013 | Native alerts/confirms/prompts remain in core mobile flows | Mobile UX | P2 | 95% | Check-in, settings, routes, search, expedition, profile flows use native dialogs | Proven static |
| BUG-AUDIT-014 | `updateCurrentUserVisitedPlaces()` can fail on a missing user doc | Auth/new user | P2 | 80% | Uses Firestore `update()` instead of merge `set()` | Strong static |
| BUG-AUDIT-015 | `localStorage` map restore lacks range validation | Runtime/UI | P2 | 75% | `parseFloat(savedLat/Lng)` and `parseInt(savedZoom)` used directly | Strong static |
| BUG-AUDIT-016 | CSV cache writes can throw and interrupt accepted data | Runtime/data | P2 | 80% | `commitCSVCache()` uses raw `localStorage.setItem()` without `try/catch` | Strong static |
| BUG-AUDIT-017 | Admin/share/trip render paths still use dynamic `innerHTML` | Security/UI | P2 | 75% | Multiple user/admin/content fields interpolate into HTML | Needs focused repro |
| BUG-AUDIT-018 | Functions emulator depends on Java 18 despite Firebase CLI warning | Tooling | P2 | 90% | CLI warns Java <21 support will drop in firebase-tools@15 | Observed |
| BUG-AUDIT-019 | Full e2e suite does not protect itself from stale origin/service-worker cache | Test reliability | P2 | 95% | Same smoke loaded Dee Dee until cache/service workers blocked | Reproduced |
| BUG-AUDIT-020 | Functions test suite is slow | CI/tooling | P3 | 80% | `npm --prefix functions test` passed but took about 161 seconds | Observed |
| BUG-AUDIT-021 | Native destructive local reset clears broad origin storage | UX/data safety | P3 | 75% | Settings reset uses broad local storage behavior and native confirm copy | Needs focused repro |
| BUG-AUDIT-022 | Browser geolocation warnings are noisy on boot | Console/UX | P3 | 70% | Playwright boot logs repeated location permission warnings | Observed |
| BUG-AUDIT-023 | Cluster ghost bubble survives Limit Zoom / Bubble Mode transition | Map runtime | P2 | 95% | User reproduced a stale 350-count bubble; layer handoff did not hard-clear markercluster internals | FIXED / QC PASSED |
| BUG-AUDIT-024 | Settings modal state survives bottom-nav tab switches | Navigation/UX | P2 | 95% | Bottom nav was clickable above Settings, but nav transitions did not close Settings | FIXED / QC PASSED |
| BUG-AUDIT-025 | Cloud settings autosave can log an error after sign-out | Settings/console | P3 | 90% | Full smoke caught `cloud settings autosave failed: You must be logged in` after settings/sign-out timing | FIXED / QC PASSED |
| BUG-AUDIT-026 | Saving a trip with custom/geocoded stops can fail with Firestore `undefined` field error | Trip planner/data persistence | P1 | 100% | User reproduced `addDoc()` failing on `Unsupported field value: undefined`; `saveCurrentTrip()` always wrote `id: s.id` | FIXED / QC PASSED |
| BUG-AUDIT-027 | Visited filter cannot isolate pins currently in the trip route | Map filters/trip planner | P2 | 100% | User requested a third dropdown option to hide all pins except current trip stops; no such route-only filter existed | FIXED / QC PASSED |
| BUG-AUDIT-028 | Fixed bottom nav and map filter panel leak scroll gestures into the map/page | Navigation/map UI | P2 | 100% | User reproduced scroll gestures over the bottom nav and filter panel moving the underlying surface | FIXED / QC PASSED |

## Detailed Findings

### BUG-AUDIT-001: Local browser cache can serve Dee Dee while auditing BARK

- Severity: P1
- Confidence: 100%
- Area: QA/runtime environment
- Evidence:
  - `curl http://127.0.0.1:4174/index.html` returned BARK HTML: title `US BARK Rangers`.
  - A normal Playwright page load on the same URL reported title `Just Dee Dee Music Live Map` and body text from the Dee Dee app.
  - A one-off Playwright load with `serviceWorkers: "block"`, cache-busting, and no-cache request headers loaded BARK correctly.
- Why this matters:
  - It makes test failures look like source contamination.
  - It can cause the user to believe BARK code has Dee Dee code when the repo source is still BARK.
  - It invalidated the first full e2e smoke attempt.
- Likely cause:
  - Stale browser service-worker/cache data on localhost after using similar app filenames and origins during the Dee Dee prototype.
- Repro:
  - Serve BARK locally on a reused localhost port.
  - Load with Playwright/Chromium default context.
  - Observe stale Dee Dee title/body.
- Recommended fix:
  - Add a Playwright config that blocks service workers for smoke tests.
  - Use a unique port per app, or clear service workers/caches before e2e.
  - Add a first smoke assertion that `document.title === "US BARK Rangers"` before running deeper tests.
  - Consider adding app-specific cache namespace/versioning if a service worker exists in copied prototypes.
- Fix implemented:
  - Added `playwright.config.js` with `serviceWorkers: "block"`.
  - Added `tests/playwright/helpers/barkContext.js` so specs that manually create contexts also block service workers and clear cache storage.
  - Added `tests/playwright/bark-app-identity-smoke.spec.js`, now first in `npm run test:e2e:smoke`, to fail immediately if the wrong copied app loads.
- User-visible repro before fix:
  - A tester could open the BARK repo on localhost and see the Dee Dee title/body from a stale browser cache even though BARK files were being served.
- Pros of the fix:
  - Smoke tests now fail fast if the wrong app identity loads.
  - Manually created Playwright contexts use the same cache/service-worker protection as default contexts.
  - This reduces false alarms about Dee Dee code contaminating BARK.
- Cons / tradeoffs:
  - E2E tests now intentionally do not exercise service-worker behavior. That is the right default for BARK QA right now, but a future service-worker feature would need its own explicit test.
- QC:
  - Focused identity smoke passed against a fresh BARK localhost server.
  - Full signed-in smoke passed 32/32 with the new identity check included.

### BUG-AUDIT-002: Sheet data can inject HTML into marker detail panel

- Severity: P1
- Confidence: 95%
- Area: security/UI
- Evidence:
  - `renderers/panelRenderer.js` sets `infoEl.innerHTML = d.info.replace(/\n/g, '<br>')`.
  - `modules/renderEngine.js` builds `formatSwagLinks()` strings with raw URL interpolation.
  - `panelRenderer.js` injects formatted picture links into `picsEl.innerHTML`.
- Why this matters:
  - Spreadsheet/CSV data is not code. A malformed or malicious sheet value can become executable markup.
  - This is especially risky because the app relies on external sheet data and opens marker detail panels frequently.
- Repro idea:
  - Add `<img src=x onerror=alert(1)>` to an info field in a test CSV row and open that marker.
- Recommended fix:
  - Render info text with `textContent`, splitting lines into text nodes plus `<br>`.
  - Build links with DOM APIs and validate URLs through `new URL()`.
  - Add tests for HTML/script payloads in `info`, `pics`, `website`, route names, and trip notes.
- Fix implemented:
  - `renderers/panelRenderer.js` now renders marker info as text nodes with explicit `<br>` nodes.
  - Marker meta pills, picture links, website links, video links, map links, and add-to-trip footer controls are created with DOM APIs instead of interpolating sheet data into `innerHTML`.
  - External marker-panel links are validated as `http:` or `https:` and get `rel="noopener noreferrer"`.
  - `modules/renderEngine.js` now validates URLs and adds `rel="noopener noreferrer"` in `formatSwagLinks()`.
- User-visible repro before fix:
  - A sheet row with HTML in an info/link field could render as markup inside the marker detail card instead of plain text.
- Pros of the fix:
  - Spreadsheet text now stays text in the marker panel.
  - Malformed or non-http URLs are ignored instead of becoming clickable markup.
  - New tests guard the specific high-risk rendering paths.
- Cons / tradeoffs:
  - Non-URL picture field notes are no longer displayed as picture-button text; the picture section now only appears for valid `http`/`https` links.
- QC:
  - `tests/render-safety.test.js` covers escaped marker info, safe URL extraction, safe swag-link formatting, and static guards against the old dangerous `innerHTML` assignments.

### BUG-AUDIT-003: CSV data files contain unresolved merge-conflict markers

- Severity: P1
- Confidence: 100%
- Area: data/tooling
- Evidence:
  - `data/data.csv` contains 216 conflict marker lines.
  - `data/sheet_data_fetched.csv` contains 504 conflict marker lines.
- Why this matters:
  - These files are excluded from hosting today, but they are still repo data assets.
  - Any future fallback-data work, data repair script, import, or audit can consume corrupt headers/rows.
- Recommended fix:
  - Regenerate these files from the authoritative source.
  - Add a data validation test that fails on `<<<<<<<`, `=======`, or `>>>>>>>`.
- Fix implemented:
  - Resolved conflict blocks in `data/data.csv` and `data/sheet_data_fetched.csv` by keeping the current/HEAD side.
  - Added `tests/data-integrity.test.js` to fail on future conflict markers and verify the expected CSV headers.
- User-visible repro before fix:
  - Any fallback/import path that consumed these CSV files could show conflict marker rows, duplicate headers, or missing/corrupt place data.
- Pros of the fix:
  - The repo data files are parseable again.
  - A dedicated data-integrity test prevents this specific corruption from silently returning.
- Cons / tradeoffs:
  - The repair kept the current/HEAD side of each conflict block. If the discarded side had newer human edits, those should be restored from the authoritative sheet rather than by reintroducing conflict text.
- QC:
  - `rg -n "^(<<<<<<<|=======|>>>>>>>)" data/data.csv data/sheet_data_fetched.csv` returns no matches.
  - `tests/data-integrity.test.js` passes.

### BUG-AUDIT-004: Hosted fallback data is excluded, so cold boot can show an empty map

- Severity: P1
- Confidence: 90%
- Area: runtime/data availability
- Evidence:
  - `firebase.json` excludes `data/**` from Hosting.
  - `loadData()` uses cached `localStorage.barkCSV` if present, then polls the live Google Sheet.
  - If there is no local cache and the Sheet request fails, there is no hosted static snapshot fallback.
- Why this matters:
  - First-time users on slow, blocked, or offline networks can see zero pins.
  - The app's map trust depends on always having at least the last known official dataset.
- Recommended fix:
  - Publish a sanitized/versioned static data snapshot outside ignored `data/**`.
  - Use load order: local cache, hosted snapshot fallback, then live Sheet update.
  - Add Playwright/network tests for first boot with Sheet blocked and no `localStorage.barkCSV`.
- Fix implemented:
  - Added a deployable fallback snapshot at `assets/data/bark-fallback.csv`; it is outside the ignored `data/**` Hosting path and contains the current public Sheet export including canonical `Park id`.
  - Updated `modules/dataService.js` so cold boot without local `barkCSV` starts the hosted fallback while still polling the live Sheet.
  - The fallback is skipped if cached/live data has already been accepted, and a newer live Sheet update can still replace the fallback in the normal polling path.
  - Bumped the `dataService.js` cache-buster in `index.html`.
  - Added `tests/playwright/bug004-static-fallback-data-smoke.spec.js` to block the Google Sheet, clear local CSV cache, and prove the hosted fallback renders hundreds of parks/markers instead of an empty map.
  - Added `assets/data/bark-fallback.csv` checks to `tests/data-integrity.test.js`.
- User-visible repro before fix:
  - Open the app in a fresh browser/profile with no `localStorage.barkCSV`.
  - Block or delay the Google Sheet CSV request.
  - The map can load with zero pins because there is no shipped snapshot to fall back to.
- User-visible behavior after fix:
  - The app renders official fallback pins from the hosted snapshot even when the live Sheet request fails on first boot.
  - When the live Sheet becomes available, the existing poller can update the map to the newer live dataset.
- Pros of the fix:
  - First-time users are no longer dependent on a successful live Sheet fetch to see the map.
  - The fallback file is served by Firebase Hosting because it lives under `assets/data/`, not the ignored `data/**` directory.
  - The regression test simulates the exact cold-boot/Sheet-failure edge case.
- Cons / tradeoffs:
  - The static snapshot can become stale if the live Sheet changes and the repo fallback is not refreshed.
  - The fallback is still a client-delivered CSV; it improves availability, not data authority or backend validation.
- QC:
  - `tests/data-integrity.test.js` verifies the fallback exists, has no conflict markers, includes `Location`, `State`, `lat`, `lng`, and canonical `Park id`, and contains the official dataset scale.
  - `tests/playwright/bug004-static-fallback-data-smoke.spec.js` proves a Sheet-blocked, no-cache cold boot renders more than 300 canonical parks and markers.

### BUG-AUDIT-005: Free 5-visit limit backend enforcement

- Severity: P1
- Confidence: 95%
- Area: product/security
- Evidence:
  - `checkinService` enforces a 5-visit free limit in client/runtime paths.
  - `firestore.rules` now denies non-premium `visitedPlaces` writes above 5 and lets active/manual-active premium users exceed 5.
  - Rules do not use `get()`/`exists()` for this check because entitlement lives on the same user document.
- Why this matters:
  - Normal app UI and direct Firestore writes now agree on the free tier cap.
- Fix:
  - Lowered free tier tracked visits from 20 to 5.
  - Added rules tests for free 5/6 writes, premium over-limit writes, malformed writes, and legacy free trim-down behavior.
  - Keep removals/date edits allowed as long as the resulting free `visitedPlaces` array is 5 or fewer.

### BUG-AUDIT-006: Saved routes do not persist trip start/end bookends

- Severity: P1
- Confidence: 95%
- Area: trip planner/data persistence
- Evidence:
  - `saveCurrentTrip()` saves `tripName`, `createdAt`, and `tripDays`.
  - It does not save `window.tripStartNode` or `window.tripEndNode`.
  - `loadRouteIntoPlanner()` restores only `tripDays` and `tripName`.
- Why this matters:
  - Users can save a trip with custom start/end cities and later reload an incomplete route.
- Recommended fix:
  - Save `tripStartNode` and `tripEndNode`.
  - Validate `lat/lng/name` on load.
  - Backfill old routes with null bookends.
- Fix implemented:
  - Added a route-save serializer in `engines/tripPlannerCore.js` that persists valid `tripStartNode` and `tripEndNode` alongside `tripDays`.
  - Updated `renderers/routeRenderer.js` so loading a saved route restores `window.tripStartNode` and `window.tripEndNode`.
  - Bumped route renderer and trip planner cache-busters in `index.html`.
- User-visible repro before fix:
  - Add a custom start city and end city, save the route, then load it later.
  - The saved route restored the stops, but the start/end bookends disappeared.
- User-visible behavior after fix:
  - Saved routes keep custom start and end cities when loaded back into the planner.
- Pros of the fix:
  - Trips saved after this change preserve the planner shape users saw at save time.
  - Existing routes without bookends still load because missing bookends fall back to `null`.
- Cons / tradeoffs:
  - Old saved routes cannot magically regain dropped start/end bookends because the previous save payload never stored them.
- QC:
  - `tests/playwright/bug026-trip-save-custom-stop-smoke.spec.js` saves a route with Hinckley start and Gainesville end, then loads it and verifies both bookends restore.

### BUG-AUDIT-026: Saving a trip with custom/geocoded stops can fail with Firestore undefined field error

- Severity: P1
- Confidence: 100%
- Area: trip planner/data persistence
- Evidence:
  - User reproduced the mobile alert: `Could not save route: Function addDoc() called with invalid data. Unsupported field value: undefined`.
  - Repro route included custom/geocoded places (`Hinckley Township, OH, USA`, `Gainesville, FL, USA`) plus BARK pins.
  - Static root cause: `saveCurrentTrip()` serialized every stop as `{ id: s.id, name: s.name, lat: s.lat, lng: s.lng }`; custom/geocoded stops do not have canonical BARK IDs, so `id` became `undefined`.
- Why this matters:
  - Route save failed at the final step after the user had spent time building and optimizing a trip.
  - Firestore rejects any nested `undefined` value, so one ID-less custom stop can prevent the entire trip from saving.
- Fix implemented:
  - Added `serializeTripNodeForSave()` and `buildSavedRouteData()` in `engines/tripPlannerCore.js`.
  - Required saved nodes to have a name plus finite `lat/lng`.
  - Optional fields such as `id`, `state`, `category`, `swagType`, `customPlaceId`, and `placeId` are included only when present, never as `undefined`.
  - Save now rejects only if the sanitized route has no valid stops.
- User-visible repro before fix:
  - Set a custom trip start such as Hinckley, OH.
  - Set a custom trip end such as Gainesville, FL.
  - Add several BARK pins and at least one custom/geocoded stop.
  - Optimize the trip and tap Save.
  - Firestore throws the `Unsupported field value: undefined` alert.
- User-visible behavior after fix:
  - The same route shape saves successfully.
  - ID-less custom stops remain in the saved route by name and coordinates.
  - Canonical BARK stops keep their IDs.
- Pros of the fix:
  - Fixes the actual Firestore rejection instead of hiding the error.
  - Makes saved-route payloads safer for mixed BARK/custom trips.
  - Preserves trip start/end bookends at the same time.
- Cons / tradeoffs:
  - Invalid stops missing a name or coordinates are dropped from the saved payload. That is safer than saving broken route data, but if such a stop appears in the UI, a future UI validation message would be useful.
- QC:
  - `tests/playwright/bug026-trip-save-custom-stop-smoke.spec.js` saves the reproduced custom-stop/bookend route to Firestore, verifies success, verifies no `undefined` ID is written for the custom stop, verifies bookends persist, loads the route back, verifies bookends restore, and deletes the test route.

### BUG-AUDIT-027: Visited filter cannot isolate pins currently in the trip route

- Severity: P2
- Confidence: 100%
- Area: map filters / trip planner
- Evidence:
  - User asked for a third option in the visited/unvisited pin dropdown that removes all pins except parks added to the trip route.
  - Before this fix, `#visited-filter` only supported `all`, `visited`, and `unvisited`.
  - `renderEngine.updateMarkers()` filtered by swag, search, type, and visited state, but did not have a route-only branch.
- How the user saw it:
  - Build a trip route with several parks.
  - Open the map filter dropdown.
  - There was no way to declutter the map to only the pins already in the trip, so route work still happened over a full map of unrelated park pins.
- Root cause:
  - Trip stop state lived in `TripLayerManager`, while the pin visibility filter lived in `renderEngine`.
  - The existing trip overlay intentionally stopped forcing park-marker visibility after the cluster bug fix, so there was no explicit filter state for "only current trip stops."
- Fix implemented:
  - Added `Only Trip Route Pins` to the visited filter dropdown.
  - Added `route` to the premium-allowed visited filter values in `authPremiumUi`.
  - Added route-stop ID lookup helpers in `renderEngine`.
  - `updateMarkers()` now treats `visitedFilterState === 'route'` as "visible only when this official park ID is in the current trip."
  - `updateTripMapVisuals()` invalidates marker visibility and calls `syncState()` when route-only mode is active, so adding/removing trip stops updates the visible pins immediately.
  - Bumped cache-busters for `authPremiumUi`, `renderEngine`, and `tripPlannerCore`.
- User-visible behavior after fix:
  - Premium users can select `Only Trip Route Pins` from the filter dropdown.
  - All non-route park pins disappear.
  - Adding another official park to the trip while the filter is active makes that park pin appear in the route-only set.
  - Switching back to `Show All Places` restores the broader map.
- Pros of the fix:
  - Gives route planning a clean declutter mode without changing trip overlay ownership.
  - Keeps free-user premium gating intact.
  - Uses the existing marker visibility pipeline instead of removing markers ad hoc.
- Cons / tradeoffs:
  - The filter only applies to official BARK park pins. Custom/geocoded trip stops still render through the separate trip overlay, not the park-pin filter.
  - Like the existing visited/unvisited filters, this route-only filter remains a Premium map filter.
- QC:
  - `tests/playwright/bug027-route-only-filter-smoke.spec.js` verifies Premium route-only filtering, live update after adding another trip stop, reset back to all pins, and free-user fake-storage sanitization.
  - Full signed-in e2e smoke with the new regression included: PASS 38/38.

### BUG-AUDIT-028: Fixed bottom nav and map filter panel leak scroll gestures into the map/page

- Severity: P2
- Confidence: 100%
- Area: navigation / map UI
- Evidence:
  - User reported that trying to scroll on the bottom nav bar and map filter area caused the underlying app surface to scroll.
  - Static root cause: only `#slide-panel` had Leaflet scroll propagation disabled. The fixed filter panel and bottom nav were not guarded against wheel/touchmove scroll chaining.
  - `#profile-view` and other `.ui-view` panels are scrollable, so wheel/touch gestures over the fixed bottom nav could scroll the active tab behind the nav.
- How the user saw it:
  - On mobile or trackpad, swipe/scroll over the bottom nav instead of a content card.
  - The Profile/Planner page behind it could move.
  - On the map, scroll gestures over the top filter/search panel could leak to the map/page instead of being swallowed by the fixed UI surface.
- Root cause:
  - Fixed overlays were visually above the app but did not act as scroll boundaries.
  - CSS `overscroll-behavior` on the document was not enough for wheel/touch gestures that target fixed child controls.
- Fix implemented:
  - Added a `bindFixedSurfaceScrollGuard()` helper in `modules/uiController.js`.
  - The helper stops `wheel` and `touchmove` propagation on fixed UI surfaces and prevents default scrolling when the gesture is not inside a child that can legitimately scroll.
  - Applied the guard to `#filter-panel` and `.glass-nav`.
  - Added Leaflet click/scroll propagation blocking for `#filter-panel` and `.glass-nav`.
  - Added CSS overscroll/touch hints to `#filter-panel`, `.filter-content`, `.suggestions-container`, and `.glass-nav`.
  - Bumped `styles.css` and `uiController.js` cache-busters in `index.html`.
- User-visible behavior after fix:
  - Scrolling over the bottom nav no longer scrolls the active tab underneath it.
  - Scrolling over the filter panel no longer zooms/pans/scrolls the map behind it.
  - Legitimate internal scroll areas, such as a long suggestions list, can still scroll because the guard allows scroll when the child has room to move.
- Pros of the fix:
  - Fix is localized to UI event ownership rather than changing page-wide scrolling.
  - Click/tap behavior on nav and filter controls stays intact.
  - The guard protects both wheel and touchmove paths.
- Cons / tradeoffs:
  - A gesture over the fixed nav is always treated as nav chrome, not content scroll. That matches user expectation, but users must start scrolling inside the actual content area to move a page.
- QC:
  - `tests/playwright/bug028-fixed-ui-scroll-guard-smoke.spec.js` verifies wheel events are prevented on the fixed filter/nav surfaces, filter-panel wheel does not change map zoom, and bottom-nav wheel does not move Profile scroll position.
  - Full signed-in e2e smoke with the new regression included: PASS 39/39.

### BUG-AUDIT-007: Route generation attaches trip bookends after filtering days

- Severity: P1
- Confidence: 100%
- Area: trip planner/route logic
- Status: FIXED / QC PASSED
- Evidence:
  - Before the fix, `generateAndRenderTripRoute()` did `const daysWithStops = tripDays.filter(d => d.stops.length >= 2)`.
  - It then added `tripStartNode` to the first filtered day and `tripEndNode` to the last filtered day.
- Why this matters:
  - Sparse trip days can move the start/end to a different original day than the user intended.
- How a user would see this bug:
  - Create a trip with a custom Trip Start, one stop on Day 1, an empty middle day, one stop on the final day, and a custom Trip End.
  - Tap `Generate Route`.
  - Before the fix, the app could say each day needs at least two stops or attach the start/end to a filtered day instead of the actual first/last trip day.
- Root cause:
  - Route generation decided which days were routable before applying trip start/end bookends.
  - One-stop first/last days that should become two-point route segments after adding the bookend were filtered out too early.
- Fix:
  - `generateAndRenderTripRoute()` now iterates the original `tripDays` indexes, applies start/end bookends to the original first/last day, and only then filters for days with at least two route points.
  - Empty middle days are skipped, but they no longer change which original day owns the start or end.
- Pros of the fix:
  - Sparse trips with real start/end bookends now generate expected route segments.
  - The change is limited to route-generation planning; trip UI ordering, saved-route shape, and overlay rendering are unchanged.
- Cons / tradeoffs:
  - Days with fewer than two route points are still skipped. That is correct for route generation, but users may still need clearer day-level messaging later if they expect an empty day to route.
- QC:
  - `tests/playwright/bug007-route-bookends-smoke.spec.js` verifies a Premium sparse trip calls ORS from start-to-first-stop and last-stop-to-end, with no alert.
  - Full signed-in e2e smoke with the new regression included: PASS 40/40.

### BUG-AUDIT-008: Current worktree has uncommitted Functions/payment files

- Severity: P1
- Confidence: 100%
- Area: release safety
- Evidence:
  - `git status --short` shows modified `functions/index.js` and `functions/tests/checkout-session.test.js`.
- Why this matters:
  - A future deploy or commit could accidentally include unreviewed payment/backend changes.
- Recommended fix:
  - Review and either commit or intentionally shelve those changes before any deployment or beta tag.
  - Keep docs/report commits separate from function changes.

### BUG-AUDIT-009: Repo root is used as Hosting public directory

- Severity: P1
- Confidence: 85%
- Area: hosting/security
- Evidence:
  - `firebase.json` sets Hosting `public` to `"."`.
  - Safety depends on a long ignore list.
- Why this matters:
  - Any future file that does not match the ignore list could be published accidentally.
  - This is risky for generated logs, local notes, copied credentials, or one-off scripts.
- Recommended fix:
  - Move public assets into `public/` or `dist/`.
  - Make Hosting publish only that directory.
  - Add a predeploy file-list check.

### BUG-AUDIT-010: Version sources disagree

- Severity: P2
- Confidence: 100%
- Area: runtime/update UX
- Evidence:
  - `version.json` says `1`.
  - `modules/barkState.js` defaults `APP_VERSION` to `26`.
  - `index.html` defaults the visible settings version to `12`.
- Why this matters:
  - Users can see inconsistent versions.
  - The update-toast logic can behave unexpectedly after localStorage changes.
- Recommended fix:
  - Make one source of truth.
  - Generate the visible version and runtime default from `version.json` or a build step.
  - Add a test that asserts all three version surfaces match.

### BUG-AUDIT-011: Third-party scripts/styles are loaded from CDNs without SRI/CSP

- Severity: P2
- Confidence: 90%
- Area: security/reliability
- Evidence:
  - `index.html` loads Leaflet, markercluster, Turf, QRCode, Firebase compat SDKs, and PapaParse from third-party CDNs.
  - No Subresource Integrity attributes or Content-Security-Policy were found.
- Why this matters:
  - CDN outage breaks app boot.
  - CDN compromise or unexpected asset drift can affect all users.
- Recommended fix:
  - Pin and self-host critical assets, or add SRI and CSP.
  - Add a smoke test for offline/static asset availability if self-hosted.

### BUG-AUDIT-012: External links using `target="_blank"` omit `rel`

- Severity: P2
- Confidence: 95%
- Area: security/UI
- Evidence:
  - Static links in `index.html` and generated links in `panelRenderer.js`/`renderEngine.js` use `target="_blank"` without `rel="noopener noreferrer"`.
- Why this matters:
  - Opened pages can access `window.opener` in older/browser-specific cases.
- Recommended fix:
  - Add `rel="noopener noreferrer"` everywhere target blank is used.
  - Enforce in a static test.

### BUG-AUDIT-013: Native alerts/confirms/prompts remain in core mobile flows

- Severity: P2
- Confidence: 95%
- Area: mobile UX
- Evidence:
  - `panelRenderer.js` uses `alert()` for check-in success/failure and free-limit messages.
  - `routeRenderer.js`, `settingsController.js`, `expeditionEngine.js`, `profileEngine.js`, `searchEngine.js`, and `firebaseService.js` use native dialogs.
- Why this matters:
  - Native dialogs feel rough on mobile, interrupt flow, and are hard to test.
  - Some browsers throttle or present them inconsistently.
- Recommended fix:
  - Replace highest-frequency alerts first: check-in, route delete, settings reset, search unavailable.
  - Use existing app modal/toast patterns.

### BUG-AUDIT-014: `updateCurrentUserVisitedPlaces()` can fail on a missing user doc

- Severity: P2
- Confidence: 80%
- Area: auth/new user
- Evidence:
  - `syncUserProgress()` uses `set(..., { merge: true })`.
  - `updateCurrentUserVisitedPlaces()` uses `update({ visitedPlaces })`.
- Why this matters:
  - Fresh account flows can fail if visit write happens before a user document exists.
- Recommended fix:
  - Use `set({ visitedPlaces }, { merge: true })` or guarantee user doc creation before check-in paths.
  - Add a test with a signed-in user whose `users/{uid}` doc does not exist.

### BUG-AUDIT-015: `localStorage` map restore lacks range validation

- Severity: P2
- Confidence: 75%
- Area: runtime/UI
- Evidence:
  - `setInitialMapView()` parses `mapLat`, `mapLng`, and `mapZoom` directly from localStorage and passes them to Leaflet.
- Why this matters:
  - Corrupt or hand-edited localStorage can put the map at invalid coordinates/zoom.
- Recommended fix:
  - Validate finite lat/lng and zoom range before restoring.
  - Clear invalid persisted values.

### BUG-AUDIT-016: CSV cache writes can throw and interrupt accepted data

- Severity: P2
- Confidence: 80%
- Area: runtime/data
- Evidence:
  - `commitCSVCache()` uses raw `localStorage.setItem()` without `try/catch`.
- Why this matters:
  - Private browsing, disabled storage, or quota exceeded can break the data acceptance path.
- Recommended fix:
  - Wrap cache read/write helpers.
  - Treat storage failures as non-fatal warnings.

### BUG-AUDIT-017: Admin/share/trip render paths still use dynamic `innerHTML`

- Severity: P2
- Confidence: 75%
- Area: security/UI
- Evidence:
  - `profileEngine.js`, `shareEngine.js`, `routeRenderer.js`, and `tripPlannerCore.js` interpolate dynamic values into HTML.
- Why this matters:
  - Some values are controlled app constants, but others come from route names, notes, profile data, or extracted/admin data.
- Recommended fix:
  - Audit each render path by ownership.
  - Replace user/sheet/admin-provided values with DOM nodes and `textContent`.

### BUG-AUDIT-018: Functions emulator depends on Java 18 despite Firebase CLI warning

- Severity: P2
- Confidence: 90%
- Area: tooling
- Evidence:
  - Emulator output warns Firebase Tools will drop support for Java <21 in `firebase-tools@15`.
  - Current Java detected: 18.
- Why this matters:
  - Future Firebase Tools update can break local rules/functions tests.
- Recommended fix:
  - Install JDK 21 and document the requirement.
  - Pin/verify Firebase Tools major version in CI.

### BUG-AUDIT-019: Full e2e suite does not protect itself from stale origin/service-worker cache

- Severity: P2
- Confidence: 95%
- Area: test reliability
- Evidence:
  - The browser loaded Dee Dee content even though the BARK HTTP response was correct.
  - Tests failed broadly instead of failing early with "wrong app loaded".
- Why this matters:
  - It wastes debugging time and can hide real regressions behind environment failure.
- Recommended fix:
  - Add Playwright config with service workers blocked for this suite.
  - Add a `beforeEach` app identity assertion.
  - Use unique base URLs/ports per copied prototype.

### BUG-AUDIT-020: Functions test suite is slow

- Severity: P3
- Confidence: 80%
- Area: CI/tooling
- Evidence:
  - `npm --prefix functions test` passed but took about 161 seconds.
- Why this matters:
  - Slow tests discourage frequent full verification.
- Recommended fix:
  - Split unit tests from heavier webhook/payment integration tests.
  - Check for lingering timers/network mocks that delay process exit.

### BUG-AUDIT-021: Native destructive local reset clears broad origin storage

- Severity: P3
- Confidence: 75%
- Area: UX/data safety
- Evidence:
  - Settings reset copy says it wipes local app memory and logs out.
- Why this matters:
  - Broad origin storage clears are easy to overuse and can erase test/local state unexpectedly.
- Recommended fix:
  - Reset only known BARK keys unless a full origin reset is explicitly required.
  - Show app-native confirmation with exact scope.

### BUG-AUDIT-022: Browser geolocation warnings are noisy on boot

- Severity: P3
- Confidence: 70%
- Area: console/UX
- Evidence:
  - One-off boot captured repeated "Could not access your location" warnings.
- Why this matters:
  - Location prompts/noise on boot can feel intrusive.
- Recommended fix:
  - Request location only after a user action unless there is a specific auto-locate requirement.

### BUG-AUDIT-023: Cluster ghost bubble survives Limit Zoom / Bubble Mode transition

- Severity: P2
- Confidence: 95%
- Area: map runtime / marker layer lifecycle
- Evidence:
  - User reproduced a stale cluster bubble showing about 350 pins after using Bubble Mode with Limit Zoom, turning Limit Zoom off, zooming out, then zooming back in.
  - `MarkerLayerManager.moveMarkersToLayer()` removed marker objects from the cluster group when switching to plain pins, but it did not hard-clear the Leaflet.markercluster group internals.
- How the user saw it:
  - Use the map for a while with Limit Zoom and Bubble Mode enabled.
  - Turn off Limit Zoom.
  - Zoom out, then zoom back in.
  - A large bubble can remain visible even though the map should have exploded back into normal pins.
- Root cause:
  - The plain-marker transition removed cluster markers and removed the cluster layer from the map, but it left markercluster's internal cluster/icon state available to survive rapid zoom/mode churn.
- Fix implemented:
  - Added `MarkerLayerManager.clearClusterLayerInternals()`.
  - When target layer type becomes `plain`, the manager now removes any cluster markers, removes the cluster layer from the map, and calls `clearLayers()` on the cluster group before re-attaching plain pins.
  - Added `tests/playwright/bug023-cluster-ghost-smoke.spec.js`.
  - Added that regression to `npm run test:e2e:smoke`.
- Pros of the fix:
  - The visual ghost bubble is cleared at the layer owner instead of being hidden with CSS.
  - The fix is localized to marker layer ownership and does not change clustering policy, zoom policy, or pin styling.
  - The regression exercises the user path: Premium Bubble Mode, Limit Zoom on, Limit Zoom off, zoom out, zoom in, then assert zero cluster bubbles at plain-pin zoom.
- Cons / tradeoffs:
  - Switching from clusters to plain pins now does a harder cluster purge. That is slightly more work during the transition, but only happens when changing layer type.
- QC:
  - Focused BUG-AUDIT-023 Playwright smoke: PASS 1/1.
  - Full signed-in e2e smoke with the new regression included: PASS 33/33.
  - `node --check` on changed files: PASS.
- Follow-up:
  - Manual browser feedback showed Bubble Mode could still look broken after deploy because `index.html` still referenced `modules/MarkerLayerManager.js?v=8`.
  - Bumped the script URL to `modules/MarkerLayerManager.js?v=9` so browsers fetch the fixed marker-layer manager instead of a cached copy.
  - Rechecked the exact user sequence locally: start in plain pins, enable Premium Bubble Mode, zoom to the Limit Zoom floor, turn Limit Zoom off, zoom out farther, then zoom back in. Bubbles appear at zoom 4/5/6 and explode cleanly at zoom 7+.

### BUG-AUDIT-024: Settings modal state survives bottom-nav tab switches

- Severity: P2
- Confidence: 95%
- Area: navigation / modal UX
- Evidence:
  - User reported that after opening Settings and returning to the map, the Map tab sometimes needed two taps.
  - Mobile layout check showed the bottom nav is clickable above the Settings modal, but the nav click path did not clear the active Settings state.
- How the user saw it:
  - Open Profile.
  - Open Settings.
  - Tap the Map tab in the bottom nav.
  - Before the fix, Settings could survive the tab switch, so returning to Profile could reopen into stale Settings state or make the first tab transition feel dead.
- Root cause:
  - Settings is rendered inside Profile, while the bottom nav lives above app views. The nav handler changed views but did not close transient Profile-owned modals first.
- Fix implemented:
  - Added `window.BARK.closeSettingsModal`.
  - Bottom-nav clicks now close Settings before changing views.
  - Bumped `modules/settingsController.js` to `v=7` in `index.html`.
  - Bumped `modules/uiController.js` to `v=10` in `index.html`.
  - Added `tests/playwright/bug024-settings-nav-smoke.spec.js` and included it in `npm run test:e2e:smoke`.
- Pros of the fix:
  - One tap now closes Settings and navigates to the intended tab.
  - Plain backdrop taps still just close Settings.
  - Local settings autosave means closing the modal on navigation does not discard setting changes.
- Cons / tradeoffs:
  - A tap on a visible nav item while Settings is open is treated as navigation intent. That is generally what users expect, but it means accidental bottom-nav taps leave Settings immediately.
- Product expectation:
  - Settings should not remain open after switching away from Profile. Users generally expect modal settings to be transient; returning to Profile should show the profile page, not a stale modal from a previous tab.
- QC:
  - Focused BUG-AUDIT-024 Playwright smoke: PASS 1/1.
  - Full signed-in e2e smoke with the new regression included: PASS 34/34.

### BUG-AUDIT-025: Cloud settings autosave can log an error after sign-out

- Severity: P3
- Confidence: 90%
- Area: settings / console cleanup
- Evidence:
  - Full smoke caught `[settingsController] cloud settings autosave failed: Error: You must be logged in.` after a settings save/sign-out path.
- How the user saw it:
  - Most users would not see visible UI breakage, but the console could show a red settings error after changing settings and signing out quickly.
- Root cause:
  - Cloud autosave checked the signed-in Premium context before scheduling, but did not re-check it when the delayed autosave timer fired.
- Fix implemented:
  - The autosave timer now re-checks current auth/premium context before writing. If the user is signed out or no longer Premium, it clears the pending local-cloud flag and exits quietly.
- Pros of the fix:
  - Local settings still autosave for everyone.
  - Premium cloud sync still works for Premium users.
  - Signing out during a delayed autosave no longer creates a false console error.
- Cons / tradeoffs:
  - A pending cloud autosave is dropped if the user signs out before the debounce finishes, which is the correct behavior because there is no current account to write to.
- QC:
  - Focused settings persistence smoke: PASS 1/1.
  - Full signed-in e2e smoke: PASS 34/34.

## Top Fix Queue

### First 3 fixes

1. BUG-AUDIT-001 / BUG-AUDIT-019: harden e2e against stale Dee Dee/browser cache.
   - Add Playwright config or fixture that blocks service workers and asserts BARK identity.
   - Rerun full signed-in smoke.

2. BUG-AUDIT-002: escape marker detail sheet content.
   - Convert info/pics/website/directions rendering to DOM creation and text nodes.
   - Add XSS regression tests for marker panel fields.

3. BUG-AUDIT-003 / BUG-AUDIT-004: repair data fallback path. DONE.
   - Regenerated corrupt CSV files.
   - Added hosted static data fallback and a first-boot Sheet-blocked test.

### Next 3 fixes

4. BUG-AUDIT-007: fix sparse-day routing after bookend persistence.
5. BUG-AUDIT-008 / BUG-AUDIT-009: clean release hygiene and move Hosting public files out of repo root.
6. BUG-AUDIT-010: unify version labels and runtime update logic.

## Go/No-Go Impact

Current premium/auth/payment backend tests are green, but this audit should downgrade broad confidence until the local cache/e2e harness issue is fixed. The app may still be acceptable for very controlled beta if testers use fresh browsers and the known trip/data risks are accepted, but it is not clean enough for a broad public launch.

Recommended gate wording:

GO for narrow controlled BARK beta only after e2e is rerun in a cache-clean BARK browser context.
NO-GO for broad public/live launch until trip bookend persistence, backend quota hardening, dirty release files, and hosting-root risk are fixed.
