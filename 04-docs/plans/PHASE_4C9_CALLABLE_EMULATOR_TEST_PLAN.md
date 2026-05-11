# Phase 4C.9 Callable Emulator Test Plan

Status: implemented locally. Test infrastructure only; no runtime app code, Functions handler code, Firestore rules, payment provider work, payment buttons, checkout, webhooks, or deployment were changed in this slice.

## Goal

Add callable emulator integration coverage proving the Phase 4C.8 ORS entitlement enforcement works through the real Firebase callable boundary:

- A real Firebase client `httpsCallable(...)` request reaches the local Functions emulator.
- Auth state is supplied by the Firebase Auth emulator.
- `users/{uid}.entitlement` is seeded in the Firestore emulator and read by the function through Admin SDK.
- Non-premium users are rejected before ORS transport.
- Premium/manual override users reach a stubbed ORS transport.
- No real ORS quota, production Firebase data, real secrets, deployment, or payment code is involved.

## Implementation Result

Phase 4C.9 added a live callable emulator integration suite:

- `functions/tests/ors-callable-emulator.test.js`
  - Starts from Firebase client SDK calls to `httpsCallable(...)`.
  - Connects to Auth and Functions emulators.
  - Uses Admin SDK against the Firestore emulator to seed `users/{uid}.entitlement`.
  - Uses demo project `demo-bark-ranger-callable-test`.
  - Creates and deletes Auth emulator users during the suite.
- `functions/tests/ors-emulator-http-stub.js`
  - Preloads into Functions emulator workers with `NODE_OPTIONS`.
  - Activates only with `BARK_ORS_EMULATOR_STUB=1`.
  - Uses `nock.disableNetConnect()` and allows only localhost-style emulator traffic.
  - Intercepts only ORS route/geocode endpoints and writes ORS hits to JSONL under `os.tmpdir()`.
  - Writes an activation marker under `os.tmpdir()` so tests fail closed before allowed calls if the preload did not reach the worker.
- Root `package.json`
  - Added `test:functions:emulator`.
  - The script creates a temporary dummy `functions/.secret.local` containing only `ORS_API_KEY=emulator-test-key`, restores/removes it after the run, and does not require a real secret.
  - Puts local Node 20 first in `PATH` because `firebase-tools@14.26.0` and the Functions runtime require Node 20.
- `firebase.json`
  - Added Auth emulator port `9099`.
  - Added Functions emulator port `5001`.
  - Preserved Firestore emulator port `8080`.
  - Added `.secret.local` to the Functions packaging ignore list as an extra guard.
- Root dev dependencies
  - Added `nock@13.5.6`.
  - Added `firebase-tools@14.26.0` because the older local/global CLI path failed to load `firebase-functions` v7, while CLI 15 requires Java 21 on this machine.

Covered callable cases:

- Unauthenticated `getPremiumGeocode` is rejected and does not hit ORS.
- Signed-in free `getPremiumGeocode` is rejected and does not hit ORS.
- Signed-in manual premium `getPremiumGeocode` reaches the stubbed ORS geocode path.
- Signed-in free `getPremiumRoute` is rejected and does not hit ORS.
- Signed-in manual premium `getPremiumRoute` reaches the stubbed ORS route path.
- Client-provided `isPremium`, `entitlement`, `status`, and `uid` fields are ignored.
- Missing entitlement is rejected.
- Malformed entitlement values are rejected.
- `canceled`, `expired`, and `past_due` premium statuses are rejected.

Verification on May 1, 2026:

- `node --check functions/tests/ors-emulator-http-stub.js`: PASS.
- `node --check functions/tests/ors-callable-emulator.test.js`: PASS.
- `npm --prefix functions test`: PASS, 10 tests.
- `npm run test:functions:emulator`: PASS, 9 tests.
- `npm run test:rules`: PASS, 12 tests.
- `npm run test:e2e:entitlement`: PASS as configured; 2 tests skipped because E2E storage-state env vars were not present.
- `npm run test:e2e:global-search`: PASS as configured; 3 tests skipped because E2E storage-state env vars were not present.
- `npm run test:e2e:smoke`: PASS as configured; 9 tests skipped because E2E storage-state env vars were not present.

No Functions deploy, Firestore rules deploy, real ORS traffic, production Firebase data, payment provider code, checkout, webhooks, or payment buttons were added.

Remaining before deploy:

- Re-run the Playwright E2E suites with the required free and premium storage states so they execute instead of skip.
- Re-run the full verification stack immediately before deployment approval.
- Keep the deploy gate explicit: Functions and Firestore rules are still not deployed by Phase 4C.9.
- Plan a Java 21 upgrade for future Firebase CLI 15+ use; CLI 14.26.0 works locally with the current Java 18 but warns support will be dropped.

## Current Coverage

| Coverage | Files / commands | What it proves | What it does not prove |
|---|---|---|---|
| Handler-level function tests | `functions/tests/ors-entitlement.test.js`, `npm --prefix functions test` | `normalizeEntitlement`, `isEffectivePremium`, `requirePremiumCallable`, route/geocode handler ordering, denied users do not call mocked transport, premium users do call mocked transport. | Does not prove real Firebase callable request shape, Auth emulator token handling, Functions emulator invocation, Admin SDK reading the Firestore emulator, or client SDK error mapping. |
| Firestore rules tests | `tests/rules/firestore-entitlement.rules.test.js`, `npm run test:rules` | Clients cannot self-write entitlement, premium/provider/payment, or admin fields; current owner writes remain compatible. | Does not prove Cloud Functions can read `users/{uid}.entitlement` server-side, or that callables enforce entitlement. Admin SDK bypasses rules by design. |
| Playwright entitlement/UI tests | `npm run test:e2e:entitlement`, `npm run test:e2e:global-search`, `npm run test:e2e:smoke` | UI state consumes entitlement, global search UI does not intentionally call client ORS path for free users, smoke workflows still work. | Does not prove direct callable abuse is blocked. A user can bypass UI and call `getPremiumRoute` / `getPremiumGeocode` directly. |
| Manual diff/QC | Phase 4C.8 QC | The source order in `functions/index.js` puts `requirePremiumCallable(...)` before ORS key lookup and axios calls. | Does not exercise a live emulator boundary or Firebase client SDK behavior. |

## Current Repo Inventory

- `functions/index.js`
  - Exports v1 callable functions `getPremiumRoute` and `getPremiumGeocode`.
  - `requirePremiumCallable(context, action, options)` uses `context.auth.uid` via `requireAuthCallable(...)`.
  - It reads `admin.firestore().collection("users").doc(uid).get()` and normalizes `userData.entitlement`.
  - Effective premium is `premium === true` with `status` of `active` or `manual_active`.
  - ORS transport is fixed through axios to `https://api.openrouteservice.org/...`.
  - Test hooks are only exported under `NODE_ENV === "test"` and are suitable for handler tests, not live callable tests.
- `functions/package.json`
  - Current script: `test` runs `NODE_ENV=test node --test tests/ors-entitlement.test.js`.
  - No callable emulator integration script exists yet.
- `firebase.json`
  - Defines Functions source and Firestore rules.
  - Emulator config currently includes Firestore only on port `8080`.
  - No Auth emulator or Functions emulator config yet.
- Root `package.json`
  - Has `test:rules` through `firebase emulators:exec --only firestore`.
  - Has Playwright smoke scripts.
  - No `test:functions:emulator` script yet.
- Existing rules setup
  - Uses `@firebase/rules-unit-testing` and Firestore emulator.
  - Seeds Firestore with test-only data, not production data.
- Existing functions test setup
  - Uses Node `node:test`.
  - Uses mocked Firestore and injected mocked axios transport.

## Recommended Emulator Strategy

Use a real three-emulator integration test:

1. Start Firebase Auth, Firestore, and Functions emulators with a demo project ID.
2. In the test process, initialize the Firebase client SDK with the demo project ID.
3. Connect the client SDK to the Auth and Functions emulators.
4. Create/sign in test users through the Auth emulator.
5. Seed `users/{uid}.entitlement` through Admin SDK pointed at the Firestore emulator.
6. Invoke `httpsCallable(functions, "getPremiumGeocode")` and `httpsCallable(functions, "getPremiumRoute")`.
7. Stub ORS in the Functions emulator process so premium calls return local stub data and denied calls can prove the stub was not reached.

This is preferable to `firebase-functions-test` wrapping because it proves the live callable boundary. `firebase-functions-test` remains useful as a diagnostic fallback, but it should not be the final Phase 4C.9 target.

## ORS Stubbing Strategy

Recommended approach: preload a test-only HTTP stub into the Functions emulator process with `NODE_OPTIONS` and `nock`.

Expected shape:

- Add a test-only preload file such as `functions/tests/ors-emulator-http-stub.js`.
- Add `nock` as a dev dependency at the root or in `functions`, whichever makes module resolution cleanest for the emulator process.
- Run the emulator script with:
  - `BARK_ORS_EMULATOR_STUB=1`
  - `ORS_API_KEY=emulator-test-key`
  - `NODE_OPTIONS="--require=$PWD/functions/tests/ors-emulator-http-stub.js"`
- The preload should:
  - Refuse to activate unless `BARK_ORS_EMULATOR_STUB === "1"`.
  - Disable non-local network with `nock.disableNetConnect()`.
  - Allow localhost/127.0.0.1 so Firebase emulators still communicate.
  - Intercept only `https://api.openrouteservice.org/v2/directions/driving-car/geojson`.
  - Intercept only `https://api.openrouteservice.org/geocode/search`.
  - Return deterministic stub route/geocode payloads.
  - Append each intercepted ORS call to a temp JSONL log, such as under `os.tmpdir()`, so tests can assert denied users did not reach ORS and allowed users did.

Why this is the safest first approach:

- It does not require changing `functions/index.js` or adding runtime-only branches.
- It exercises the real exported callable functions, not just handler hooks.
- It prevents accidental real ORS traffic by blocking non-local network access in the function process.
- It requires only a dummy `ORS_API_KEY`, not a real secret.

Fallback if `NODE_OPTIONS` does not reliably reach the Functions emulator worker:

- Stop and document the blocker.
- Consider a tiny, reviewed test-only ORS transport seam in `functions/index.js` guarded by an emulator-only env var.
- Do not proceed with any approach that can hit real ORS.

## Test Cases

Use stable helper names such as:

- `createSignedInUser(label)`
- `seedEntitlement(uid, entitlement)`
- `callGeocode(data, authState)`
- `callRoute(data, authState)`
- `readOrsStubLog()`
- `expectHttpsCode(error, code)`

Required cases:

| Case | Setup | Callable | Expected result | ORS stub count |
|---|---|---|---|---|
| Unauthenticated geocode rejected | No signed-in user | `getPremiumGeocode({ text: "Seattle" })` | `unauthenticated` | No increment |
| Signed-in free geocode rejected | `users/{uid}.entitlement = { premium: false, status: "free" }` | `getPremiumGeocode({ text: "Seattle", isPremium: true })` | `permission-denied` | No increment |
| Premium/manual geocode allowed | `premium: true`, `status: "manual_active"` | `getPremiumGeocode({ text: "Seattle", size: 3, country: "US" })` | Stub geocode payload returned | Increment by 1 |
| Signed-in free route rejected | Free entitlement | `getPremiumRoute({ coordinates, isPremium: true })` | `permission-denied` | No increment |
| Premium/manual route allowed | Manual active entitlement | `getPremiumRoute({ coordinates, radiuses })` | Stub route payload returned | Increment by 1 |
| Client premium claims ignored | Free entitlement plus payload `isPremium`, `entitlement`, `status`, `uid` claims | Route and/or geocode | `permission-denied` | No increment |
| Missing entitlement rejected | User doc missing or no `entitlement` field | Route and geocode if practical | `permission-denied` | No increment |
| Malformed entitlement rejected | `entitlement = "premium"` and `{ premium: true }` | At least geocode; preferably both callables | `permission-denied` | No increment |
| Canceled rejected | `premium: true`, `status: "canceled"` | At least geocode; preferably both callables | `permission-denied` | No increment |
| Expired rejected | `premium: true`, `status: "expired"` | At least geocode; preferably both callables | `permission-denied` | No increment |
| Past due rejected | `premium: true`, `status: "past_due"` | At least geocode; preferably both callables | `permission-denied` | No increment |

Prefer parameterized tests for malformed/inactive statuses to keep the suite compact.

## Expected Files For Implementation

Primary expected files:

- `functions/tests/ors-callable-emulator.test.js`
  - Node `node:test` integration test.
  - Uses Firebase client SDK for Auth and Functions.
  - Uses Admin SDK only for emulator Firestore seeding/cleanup.
  - Invokes real `httpsCallable(...)` requests.
- `functions/tests/ors-emulator-http-stub.js`
  - Test-only `nock` preload for the Functions emulator process.
  - Blocks non-local network and stubs ORS.
- `firebase.json`
  - Add Auth and Functions emulator ports if needed:
    - `auth`: `9099`
    - `functions`: `5001`
    - keep existing `firestore`: `8080`
- Root `package.json`
  - Add `test:functions:emulator` orchestration script.
- `package-lock.json`
  - Add `nock` if using the recommended HTTP-layer stub.

Optional:

- `functions/package.json`
  - Add a local script only if the implementation chooses to keep function test commands under `functions`.
  - The root script is still recommended because `firebase emulators:exec` is already root-oriented.

Not expected:

- No `functions/index.js` changes for the recommended path.
- No `services/orsService.js` changes.
- No `modules/searchEngine.js` changes.
- No `firestore.rules` changes.
- No payment/provider/checkout/webhook files.

## Proposed Scripts And Commands

Recommended root script:

```json
"test:functions:emulator": "BARK_ORS_EMULATOR_STUB=1 ORS_API_KEY=emulator-test-key NODE_OPTIONS=\"--require=$PWD/functions/tests/ors-emulator-http-stub.js\" firebase emulators:exec --only auth,firestore,functions \"node --test functions/tests/ors-callable-emulator.test.js\""
```

Implementation verification commands:

```bash
node --check functions/tests/ors-callable-emulator.test.js
node --check functions/tests/ors-emulator-http-stub.js
npm --prefix functions test
npm run test:functions:emulator
npm run test:rules
npm run test:e2e:entitlement
npm run test:e2e:global-search
npm run test:e2e:smoke
git diff --check
```

Notes:

- The emulator test should use a demo/local project ID, for example `demo-bark-ranger-callable-test`.
- The test should assert emulator env vars are present before seeding data.
- The test should fail closed if `BARK_ORS_EMULATOR_STUB` is not set.
- The test should fail if the ORS stub log changes for denied users.

## Risks

- Auth emulator setup can be finicky if users are not cleaned up between tests.
- Functions emulator startup is slower than handler tests and can be flaky if ports are already in use.
- `NODE_OPTIONS` preload must reach the actual Functions emulator worker process; verify this before writing the full matrix.
- Accidentally allowing real network could spend ORS quota. The preload must block non-local network.
- Tests must not depend on production Firebase project IDs, production users, or production Firestore data.
- Real secrets must not be required. Use dummy `ORS_API_KEY=emulator-test-key`.
- Firebase debug logs and temporary ORS stub logs can dirty the worktree if written inside the repo.
- The Functions emulator may surface unrelated function-source loading issues because it loads all exports in `functions/index.js`.
- Root env-var script syntax is shell-specific; this repo is currently macOS/zsh oriented, but CI portability should be considered later.

## Stop Lines

- Do not deploy Functions.
- Do not deploy Firestore rules.
- Do not call real ORS.
- Do not use production Firebase data.
- Do not use real provider secrets.
- Do not add payment provider work.
- Do not add payment buttons.
- Do not weaken or remove existing handler-level tests.
- Do not change runtime app code.
- Do not change Firestore rules.
- Stop if the ORS stub cannot prove that denied users avoided transport.

## Ready To Implement 4C.9?

YES, for a focused callable emulator integration test slice using Auth, Firestore, and Functions emulators plus a test-only ORS HTTP stub.

NO, for deployment, payment work, runtime UI changes, Firestore rules changes, or any implementation path that can call real ORS.
