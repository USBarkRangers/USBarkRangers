# Phase 4C.7 Firestore Rules Entitlement Protection Plan

Date: 2026-05-01

Status: Phase 4C.7A planning is complete. Phase 4C.7B local rules baseline and emulator rules test harness are implemented and verified locally. Do not deploy these rules until a separate reviewed deployment gate.

## Evidence

Inventory commands run:

```sh
ls -la
find . -maxdepth 3 -type f | grep -Ei "firestore.rules|storage.rules|firebase.json|rules|emulator|emulators|@firebase/rules-unit-testing|firebase-tools|jest|vitest|mocha"
cat firebase.json
rg -n "users/|visitedPlaces|settings|entitlement|premium|manualOverride|providerCustomerId|providerSubscriptionId|savedRoutes|leaderboard|collection\\('users'\\)|collection\\(\"users\"\\)" services modules renderers repos state engines core functions tests -g '*.js'
```

Additional targeted write-surface checks were run against:

- `services/firebaseService.js`
- `services/authService.js`
- `modules/profileEngine.js`
- `modules/expeditionEngine.js`
- `engines/tripPlannerCore.js`
- `renderers/routeRenderer.js`
- `repos/VaultRepo.js`
- `functions/index.js`

## 1. Current Rules State

| Area | Current state |
|---|---|
| Root Firestore rules file | No `firestore.rules` file exists in this repo. |
| Storage rules file | No `storage.rules` file found in the inventory. |
| `firebase.json` Firestore config | `firebase.json` configures Functions and Hosting only. It does not reference Firestore rules. |
| Emulator config | No Firestore emulator config exists in `firebase.json`. |
| Rules test harness | No `@firebase/rules-unit-testing`, Jest, Vitest, Mocha, or repo-local rules test harness was found. |
| Existing test tooling | Root `package.json` has Playwright E2E scripts and Firebase Admin/Functions dependencies, but no rules-test script. |
| Current deployed rules | Unknown from this repo. The repo does not currently provide a source-controlled rules baseline. |

Important implication:

- Paid launch cannot rely on UI gating alone. The repo needs source-controlled rules plus emulator tests before any premium entitlement deployment.
- Any new broad `users/{uid}` owner-write rule would be dangerous unless it explicitly blocks entitlement/provider/admin fields.

## 2. User Document Write Inventory

Current client write needs found in runtime code:

| Area | Current write path | Current fields / collection | Notes |
|---|---|---|---|
| Visit lifecycle | `services/firebaseService.js` via `syncUserProgress()` and `updateCurrentUserVisitedPlaces()` | `users/{uid}.visitedPlaces` | Core app data. Phase 1/2 made local ownership safer, but Firestore still stores the compact visit array. |
| Visit date/remove | `services/firebaseService.js` | `users/{uid}.visitedPlaces` | Date edit and removal rewrite the compact visit array. |
| Settings | `modules/settingsController.js` -> `firebaseService.saveUserSettings()` | `users/{uid}.settings` | Cloud-backed settings include performance/map/filter settings and `premiumClustering` as a setting, not entitlement. |
| Daily streak | `services/firebaseService.js` | `users/{uid}.streakCount`, `users/{uid}.lastStreakDate` | Uses client write with merge. |
| Walk points backfill | `services/authService.js` | `users/{uid}.walkPoints` | Backfills `walkPoints` from `lifetime_miles` if needed. |
| Walk points admin edit | `services/firebaseService.js` | `users/{uid}.walkPoints` | Client path gated by `window.isAdmin`; rules must not allow users to self-grant admin. This may need separate admin/backend treatment later. |
| Expedition start | `modules/expeditionEngine.js` | `users/{uid}.virtual_expedition` | Active trail state is client-written today. |
| Expedition mileage | `modules/expeditionEngine.js` | `users/{uid}.virtual_expedition`, `users/{uid}.lifetime_miles`, `users/{uid}.walkPoints` | Uses `FieldValue.increment(...)`. |
| Expedition edit/delete walk logs | `modules/expeditionEngine.js` | nested `virtual_expedition.history`, `virtual_expedition.miles_logged`, `lifetime_miles`, `walkPoints` | Client-owned profile/expedition management. |
| Expedition reward claim | `modules/expeditionEngine.js` | `completed_expeditions`, nested `virtual_expedition.*`, `walkPoints` | User progress state. |
| Saved trip routes | `engines/tripPlannerCore.js`, `services/firebaseService.js`, `renderers/routeRenderer.js` | `users/{uid}/savedRoutes/{routeId}` | User-owned subcollection. Create/read/delete are required. |
| Score sync to user doc | `modules/profileEngine.js` | `users/{uid}.totalPoints`, `totalVisited`, `displayName`, `hasVerified` | Client-written leaderboard/profile summary. Not ideal for anti-cheat, but currently required. |
| Leaderboard doc | `modules/profileEngine.js` | `leaderboard/{uid}` | Client writes ranking data, while Cloud Function builds `system/leaderboardData` from `leaderboard`. |
| Admin signal read | `functions/index.js` | reads `users/{uid}.isAdmin` | Critical adjacent risk: if rules allow users to write `isAdmin`, admin callables can be escalated. Protect admin fields with premium fields. |
| Premium entitlement | `services/authService.js`, `services/premiumService.js` | reads `users/{uid}.entitlement` | Client must read this field but must never write it. Admin/backend only. |

Current read needs:

- Signed-in users read their own `users/{uid}` document for visits, settings, entitlement, streak/walk points, expedition state, admin state, and profile state.
- `VaultRepo` subscribes to `users/{uid}.visitedPlaces`.
- Saved route reads are under `users/{uid}/savedRoutes`.
- Leaderboard reads use `leaderboard` and/or generated leaderboard data.
- Admin SDK writes in `functions/index.js` bypass Firestore rules and are suitable for future entitlement/provider writes.

## 3. Protected Fields

Rules must prevent client create/update/delete paths from granting or changing premium/provider/admin state.

Protect these top-level user fields:

- `entitlement`
- `premium`
- `premiumStatus`
- `subscription`
- `subscriptions`
- `plan`
- `manualOverride`
- `providerCustomerId`
- `providerSubscriptionId`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `lemonSqueezyCustomerId`
- `lemonSqueezySubscriptionId`
- `currentPeriodEnd`
- `checkoutSessionId`
- `provider`
- `paymentProvider`
- `paymentStatus`
- `isAdmin`
- `admin`
- `role`
- `roles`
- `customClaims`

Within `entitlement`, the client must not write:

- `premium`
- `status`
- `source`
- `manualOverride`
- `currentPeriodEnd`
- provider customer/subscription IDs
- future provider, payment, override, or audit fields

Recommended stance:

- Deny any client write that changes the top-level `entitlement` map at all. This covers nested updates such as `entitlement.premium`.
- Deny client deletion of `users/{uid}` by default because it could remove protected fields. If a user-account deletion feature is required, handle it through a separately planned backend/admin path.

## 4. Read / Write Policy Proposal

Conceptual policy:

| Path | Proposed client policy | Notes |
|---|---|---|
| `users/{uid}` read | Signed-in user can read only their own document. | Needed for entitlement, settings, visits, profile, and expedition hydration. |
| `users/{uid}` create | Signed-in user can create their own document only if protected fields are absent. | Supports first visit/settings/progress writes. |
| `users/{uid}` update | Signed-in user can update their own document only if protected fields are unchanged. | First beta-compatible approach. |
| `users/{uid}` delete | Deny client delete initially. | Avoid protected-field removal and accidental full data loss. Revisit if account deletion needs client support. |
| `users/{uid}/savedRoutes/{routeId}` | Signed-in user can create/read/update/delete only their own saved routes. | Current app needs create/read/delete; update should be allowed only if route editing exists or planned. |
| `leaderboard/{uid}` read | Public or signed-in read, depending product choice. | Current leaderboard UI expects broad reads. |
| `leaderboard/{uid}` write | Signed-in user can write only their own leaderboard doc with allowed display/score fields. | Compatibility path. Still gameable because score is client-calculated. |
| `system/leaderboardData` | Client read if app uses it; no client writes. | Cloud Function writes with Admin SDK. |
| entitlement/provider/admin fields | Client cannot create, update, or delete. | Admin SDK/webhooks/manual admin only. |

Important distinction:

- Firestore rules protect paid/admin fields from client self-grant.
- They do not make client-written leaderboard or score fields authoritative. Leaderboard hardening should be a later backend-owned score-sync plan.

## 5. Rules Shape Options

### Option A - Broad Owner Write With Forbidden Field Check

Shape:

```rules
function protectedUserKeys() {
  return [
    "entitlement",
    "premium",
    "premiumStatus",
    "subscription",
    "subscriptions",
    "plan",
    "manualOverride",
    "providerCustomerId",
    "providerSubscriptionId",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "lemonSqueezyCustomerId",
    "lemonSqueezySubscriptionId",
    "currentPeriodEnd",
    "checkoutSessionId",
    "provider",
    "paymentProvider",
    "paymentStatus",
    "isAdmin",
    "admin",
    "role",
    "roles",
    "customClaims"
  ];
}

function createsNoProtectedFields() {
  return !request.resource.data.keys().hasAny(protectedUserKeys());
}

function changesNoProtectedFields() {
  return !request.resource.data.diff(resource.data).affectedKeys().hasAny(protectedUserKeys());
}
```

Pros:

- Most compatible with the current legacy user document.
- Lowest risk of breaking existing visit/settings/expedition/score writes.
- Directly blocks `entitlement` and adjacent premium/admin fields.
- Good first source-controlled beta baseline.

Cons:

- Still allows arbitrary non-protected user fields.
- Does not enforce exact shapes for `visitedPlaces`, `settings`, `virtual_expedition`, or leaderboard score fields.
- Does not stop leaderboard/game score cheating.

Security strength:

- Strong for premium/admin self-grant protection if tests prove nested `entitlement` updates are blocked.
- Moderate for general user data integrity.

Implementation risk:

- Low to medium.

### Option B - Allowlist Exact Writable User Fields

Shape:

- Allow create/update only if changed keys are within an approved set such as:
  - `visitedPlaces`
  - `settings`
  - `streakCount`
  - `lastStreakDate`
  - `walkPoints`
  - `lifetime_miles`
  - `virtual_expedition`
  - `completed_expeditions`
  - `totalPoints`
  - `totalVisited`
  - `displayName`
  - `hasVerified`

Pros:

- Stronger than a forbidden-field block.
- Prevents unknown fields and accidental future privilege fields.
- Easier to reason about after the user doc model stabilizes.

Cons:

- Higher compatibility risk with existing legacy fields and merge writes.
- Requires more complete field inventory and emulator/E2E coverage.
- Can break unobserved user-owned writes.

Security strength:

- High for user document schema control.

Implementation risk:

- Medium to high until all write surfaces are tested.

### Option C - Split Entitlement Into Protected Subdocument/Collection

Shape examples:

- `users/{uid}/privateEntitlement/current`
- `entitlements/{uid}`
- `users/{uid}/admin/entitlement`

Pros:

- Cleaner boundary between user-owned app state and server-owned billing state.
- Easier to write strict rules for entitlement paths.
- Reduces risk from broad user document updates.

Cons:

- Current app reads `users/{uid}.entitlement` through the auth snapshot.
- Requires runtime migration and possibly data migration.
- More moving parts before payments.

Security strength:

- High once migrated.

Implementation risk:

- Medium. Not the first rules PR.

### Option D - Move Client Writes To Backend

Shape:

- Visits, settings, score sync, expedition progress, and saved routes move to callable/backend-owned writes.
- Clients request mutations; backend validates and writes.

Pros:

- Strongest long-term integrity.
- Enables authoritative score, anti-cheat, validation, audit logs, and rate limits.
- Simplifies client rules over time.

Cons:

- Large refactor.
- Requires many callables and tests.
- Not appropriate as a first premium rules slice.

Security strength:

- Highest.

Implementation risk:

- High.

## 6. Recommended First Rules Approach

Recommended for 4C.7B:

- Start with **Option A: broad owner write with forbidden field checks**, plus focused emulator tests.
- Add a repo-owned `firestore.rules` baseline and wire it into `firebase.json`.
- Add emulator/rules tests before any deployment.
- Keep current required app writes working.
- Explicitly protect premium/provider/admin fields.
- Treat this as a compatibility baseline, not the final user-data integrity model.

Why Option A first:

- The current app still writes many user-owned fields from the browser.
- An exact allowlist is better long-term, but it risks breaking legacy writes unless every path is tested first.
- The immediate paid-launch blocker is client self-grant of entitlement. A forbidden-field rule can address that without forcing a broad data-model migration.
- The adjacent `isAdmin` field must be protected at the same time because Cloud Functions trust it for admin callable access.

Recommended conceptual rules:

- `isSignedIn()`: `request.auth != null`
- `isOwner(uid)`: `isSignedIn() && request.auth.uid == uid`
- `protectedUserKeys()`: premium/provider/admin top-level keys
- `createsNoProtectedFields()`: no protected keys in `request.resource.data`
- `changesNoProtectedFields()`: no protected keys in `diff(resource.data)`
- `match /users/{uid}`:
  - `allow read: if isOwner(uid)`
  - `allow create: if isOwner(uid) && createsNoProtectedFields()`
  - `allow update: if isOwner(uid) && changesNoProtectedFields()`
  - `allow delete: if false`
- `match /users/{uid}/savedRoutes/{routeId}`:
  - `allow read, create, update, delete: if isOwner(uid)`
- `match /leaderboard/{uid}`:
  - read policy to preserve current app behavior
  - write own doc only, preferably with an allowlist of leaderboard fields
- `match /system/{docId}`:
  - client read only if current app needs it
  - no client writes

Open questions to resolve during 4C.7B/4C.7C:

- Does the app require client deletion of `users/{uid}` for account termination? If yes, plan a backend deletion flow instead of allowing client document delete.
- Does any current write create a user document with `displayName`, `photoURL`, or other fields outside the candidate allowlist? Rules tests and E2E smoke should reveal this.
- Should leaderboard reads be public or signed-in only? Current product likely expects broad leaderboard visibility.
- Should `leaderboard/{uid}` client writes remain compatible short-term or move to backend score sync later?

## 7. Rules Test Plan

Recommended harness:

- Add `@firebase/rules-unit-testing` for Firestore emulator rules tests.
- Use Node 20's built-in `node:test` runner to avoid adding Jest/Vitest/Mocha unless the repo later standardizes on one.
- Add `firebase-tools` as a dev dependency or document that the local Firebase CLI is required for `emulators:exec`.
- Add a focused script such as:
  - `test:rules:firestore`
  - or `test:rules:entitlement`

Likely files for 4C.7B/4C.7C:

- `firestore.rules`
- `firebase.json`
- `tests/rules/firestore-entitlement.rules.test.js`
- `package.json`
- `package-lock.json`

Required emulator tests:

| Test | Expected result |
|---|---|
| Authenticated user can read own `users/{uid}` doc | Allow |
| Authenticated user cannot read another user's `users/{otherUid}` doc | Deny |
| Signed-out user cannot read a user doc | Deny |
| Authenticated user can create own doc with `settings` | Allow |
| Authenticated user can create own doc with `visitedPlaces` | Allow |
| Authenticated user cannot create own doc with `entitlement` | Deny |
| Authenticated user cannot update own doc with `entitlement` | Deny |
| Authenticated user cannot update nested `entitlement.premium` | Deny |
| Authenticated user cannot remove/overwrite existing `entitlement` | Deny |
| Authenticated user cannot write `premium`, `premiumStatus`, `plan`, `manualOverride`, or provider IDs | Deny |
| Authenticated user cannot write `isAdmin`, `admin`, `roles`, or `customClaims` | Deny |
| Authenticated user can still update allowed `settings` when existing doc already has server-written entitlement | Allow |
| Authenticated user can still update `visitedPlaces` when existing doc already has server-written entitlement | Allow |
| Authenticated user can create/read/delete own `savedRoutes` | Allow |
| Authenticated user cannot read/write another user's `savedRoutes` | Deny |
| Leaderboard read behavior matches product decision | Allow/deny as designed |
| Authenticated user can write only own `leaderboard/{uid}` if compatibility requires it | Allow own, deny others |
| Client cannot write `system/leaderboardData` | Deny |

Post-rules app verification before deploy:

- `npm run test:e2e:entitlement`
- `npm run test:e2e:premium`
- `npm run test:e2e:global-search`
- `npm run test:e2e:smoke`
- Manual sign-in smoke if rules are being tested against a staging project.

Do not deploy the rules until emulator tests and smoke tests pass.

## 8. Implementation PR Breakdown

### 4C.7A - Plan Only

Goal:

- Create this plan.
- No rules, tests, runtime code, deploys, ORS changes, or payment work.

### 4C.7B - Add Rules Baseline And Emulator Config

Goal:

- Add source-controlled `firestore.rules`.
- Add `firebase.json` Firestore rules reference and emulator config.
- Add package test script/dependencies for rules tests.
- Do not deploy.

Likely files:

- `firestore.rules`
- `firebase.json`
- `package.json`
- `package-lock.json`

### 4C.7C - Add Entitlement Rules Tests

Goal:

- Add emulator tests for entitlement/provider/admin protected fields.
- Add tests proving current allowed user writes still work.
- Add saved routes and leaderboard compatibility tests.

Likely files:

- `tests/rules/firestore-entitlement.rules.test.js`
- `package.json`
- `package-lock.json`

### 4C.7D - Adjust Rules Until App Write Paths Pass

Goal:

- Refine rules only as needed to preserve current app behavior.
- Run focused rules tests and E2E smoke.
- Do not loosen entitlement/provider/admin protection.

Likely files:

- `firestore.rules`
- tests/docs only

### 4C.7E - Deploy Rules Only After Gate

Goal:

- Deploy rules only after explicit approval.
- Required gate:
  - rules tests pass
  - Phase 4C entitlement/premium/global-search smoke passes
  - full smoke bundle passes
  - manual release smoke accepted

Do not combine this with payment work or ORS callable enforcement.

## 9. Stop Lines

- Do not deploy rules without emulator tests.
- Do not break existing user data writes.
- Do not protect entitlement by relying on UI.
- Do not let client writes create, update, delete, or overwrite entitlement/provider/admin fields.
- Do not let client write `isAdmin` or other admin escalation fields.
- Do not change payment/provider code.
- Do not add checkout buttons.
- Do not move client writes to backend in this PR unless separately planned.
- Do not touch ORS callables in 4C.7.
- Do not claim paid security is complete until Firestore rules and ORS callable enforcement both pass tests.

## Final Recommendation

Recommended rules approach:

- Implement a beta-compatible rules baseline using owner-only reads/writes plus forbidden-field checks for entitlement/provider/admin fields.
- Keep saved routes user-owned.
- Keep current leaderboard compatibility, but explicitly document that client-written leaderboard score is not authoritative.
- Add emulator tests before any deploy.

Test harness recommendation:

- Use `@firebase/rules-unit-testing` with Node 20's built-in `node:test`.
- Add a focused `test:rules:firestore` or `test:rules:entitlement` script.
- Use `firebase emulators:exec --only firestore` through local Firebase CLI or `firebase-tools`.

Likely implementation files:

- `firestore.rules`
- `firebase.json`
- `tests/rules/firestore-entitlement.rules.test.js`
- `package.json`
- `package-lock.json`
- Planning docs

Highest risks:

- A broad owner-write rule that forgets to block `entitlement` would allow premium self-grant.
- A broad owner-write rule that forgets to block `isAdmin` would allow admin callable escalation.
- An exact allowlist introduced too early could break visits, settings, saved routes, expedition, or leaderboard writes.
- Existing deployed rules are unknown from this repo, so 4C.7B should not deploy anything until tests and release smoke pass.

Ready to implement 4C.7B?

YES for adding a source-controlled rules baseline, emulator config, and rules-test tooling in a small non-deployed PR. NO for deploying those rules, changing ORS backend enforcement, or adding payments in the same slice.

## Phase 4C.7B Implementation Status

Phase 4C.7B is implemented as a local-only rules baseline and emulator test harness.

Files added or updated:

- `firestore.rules`
- `firebase.json`
- `tests/rules/firestore-entitlement.rules.test.js`
- `package.json`
- `package-lock.json`
- `plans/PHASE_4C7_FIRESTORE_RULES_ENTITLEMENT_PLAN.md`
- Status notes in Phase 4 premium planning docs

Rules baseline behavior:

- Signed-in users can read their own `users/{uid}` document.
- Signed-in users cannot read or write another user's `users/{uid}` document.
- Signed-in users can create/update their own user document for app-owned fields.
- Client deletes of `users/{uid}` are denied.
- Client writes to premium/provider/payment/admin fields are denied.
- Client writes that create or modify `users/{uid}.entitlement` are denied, including nested `entitlement.premium` and `entitlement.status`.
- Signed-in users can read/create/update/delete their own `users/{uid}/savedRoutes/{routeId}`.
- Signed-in users cannot read/write another user's saved routes.
- `leaderboard/{uid}` remains readable and owner-writable for the current client score-sync path.
- `system/{docId}` is client-readable and client-write-denied.

Protected fields in the baseline include:

- `entitlement`
- `premium`
- `premiumStatus`
- `subscription`
- `subscriptions`
- `plan`
- `manualOverride`
- `providerCustomerId`
- `providerSubscriptionId`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `lemonSqueezyCustomerId`
- `lemonSqueezySubscriptionId`
- `currentPeriodEnd`
- `source`
- `status`
- `checkoutSessionId`
- `provider`
- `paymentProvider`
- `paymentStatus`
- `isAdmin`
- `admin`
- `role`
- `roles`
- `customClaims`

Rules test harness:

- Added `@firebase/rules-unit-testing`, `firebase`, and `firebase-tools` as dev dependencies.
- Added npm script `test:rules`.
- The local Firebase CLI is provided by `node_modules/.bin/firebase`; no global Firebase CLI is required.
- The script runs:

```sh
firebase emulators:exec --only firestore "node --test tests/rules/firestore-entitlement.rules.test.js"
```

Rules tests covered:

- User can read own `users/{uid}`.
- User cannot read another user's `users/{uid}`.
- User can write allowed own `settings`.
- User can write allowed own `visitedPlaces`.
- User can update app-owned fields while preserving server-written entitlement.
- User cannot create own doc with `entitlement`.
- User cannot update own doc with `entitlement`.
- User cannot update nested `entitlement.premium`.
- User cannot update nested `entitlement.status`.
- User cannot write top-level premium/provider fields.
- User cannot write `isAdmin`, `admin`, `role`, or `roles`.
- User cannot delete own user document.
- User can write/read own saved routes.
- User cannot read/write another user's saved routes.
- User can write own leaderboard doc for current client compatibility.
- User cannot write another user's leaderboard doc.
- Unknown user subcollections are denied by default.

Verification:

- `node --check tests/rules/firestore-entitlement.rules.test.js`: PASS.
- `npm run test:rules`: PASS, 10 tests passed.
- `npm run test:e2e:smoke`: PASS, 9 tests passed.
- Rules were not deployed.

Compatibility decisions:

- The first baseline uses forbidden-field checks instead of exact user-doc allowlists to preserve current browser-owned writes.
- Client-written leaderboard remains compatible but is still not authoritative. Backend-owned score sync should remain a later hardening phase.
- User document deletion is denied client-side. If account deletion needs full document removal, it should be implemented through a separately planned backend/admin flow.

Recommended next step:

- Mechanical QC for 4C.7B, then either 4C.8 ORS callable entitlement enforcement planning/implementation or a reviewed rules deployment gate. Do not deploy rules as part of 4C.7B.

## Phase 4C.7C Test Coverage Update

Phase 4C.7C is implemented as rules-test coverage only.

Files changed:

- `tests/rules/firestore-entitlement.rules.test.js`
- `plans/PHASE_4C7_FIRESTORE_RULES_ENTITLEMENT_PLAN.md`

Rules changes:

- None. The Phase 4C.7B rules baseline already denied these paths.

Additional tests added:

- Unauthenticated users cannot create `users/{uid}`.
- Unauthenticated users cannot read `users/{uid}`.
- Unauthenticated users cannot update `users/{uid}`.
- Unauthenticated users cannot read `users/{uid}/savedRoutes/{routeId}`.
- Unauthenticated users cannot write `users/{uid}/savedRoutes/{routeId}`.
- Authenticated users cannot read arbitrary top-level `randomCollection/{docId}`.
- Authenticated users cannot write arbitrary top-level `randomCollection/{docId}`.
- Unauthenticated users cannot write arbitrary top-level `randomCollection/{docId}`.

Verification:

- `node --check tests/rules/firestore-entitlement.rules.test.js`: PASS.
- `npm run test:rules`: PASS, 12 tests passed.
- `git diff --check`: PASS.

Deployment status:

- Rules were not deployed.

Recommended next step:

- If verification passes, Phase 4C.7C closes the small rules-test gaps found in mechanical QC. Phase 4C.8 ORS callable entitlement enforcement remains the next security slice; any rules deployment should still be a separate reviewed gate.
