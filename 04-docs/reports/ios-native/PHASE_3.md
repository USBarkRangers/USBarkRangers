# Phase 3 — Accounts, persistence and sync

Build: **0.3.0 (19)**. Branch: `codex/ios-native-setup`. Baseline: Phase 2 `e4d5756`.

The user explicitly authorized Phase 3. This is the native development build and local test-account handoff. No customers were migrated, no production service was deployed, and no Phase 4 adventure actions were added. The original web app remains operational.

## What is implemented

- Firebase email creation/sign-in, verification/reset, linking/unlinking, reauthentication and sign-out; real Apple/Google credential adapters and callback configuration. Actual provider registration/device checks remain prerequisites below.
- One active account lifetime. UID changes clear old presentation/access immediately; old repositories/tasks remain bound to their original store and cannot submit as the next account. Provider and callable actions check the initiating UID too.
- Account-scoped SwiftData schema 1. Accepted baseline, pending profile/mapStyle operations and receipt metadata save atomically; failed saves publish nothing. Pending changes survive reopening. Credentials remain in Firebase/Keychain, with no second remembered-user cache.
- Current-format reads retain IDs, route order/notes/custom stops, visits, historical expedition/score fields, both achievement representations and unknown data. Unresolved records remain visible as a notice; no importer, schema conversion or identity guessing was added.
- Concrete profile/display-name and eligible cloud appearance edits. Device camera/search/grouping/units/overview stay device-local. Resetting device preferences cannot preserve an old appearance hidden by an account override. Account settings never copy into device defaults.
- One durable outbox and one sync worker. Exact UUID envelopes survive retries; accepted receipts clear only the matching intent. Concurrent web edits produce a visible conflict, with local/server values and explicit resolution. A lost accepted response cannot undo a later web edit. Conflict resolution uses the latest accepted baseline rather than replaying an older receipt value.
- UID-bound membership and bounded offline access. A connection failure preserves an unexpired cache and all saved history. Existing server statuses/paid route-read rules remain; a fresh free account cannot fetch Premium-protected saved routes.
- Existing membership recovery, billing portal, cancellation and account deletion. Local tests use explicit simulated providers. Deletion requires recent authentication and DELETE; Apple-linked deletion obtains/revokes the Apple authorization token. Both retained web and native deletion now remove native receipts before Auth removal, so receipt-cleanup failure remains retryable under the deletion tombstone.
- A separate **BarkRanger Local Accounts** Xcode scheme, demo emulators, fixed synthetic fixtures, native SDK/UI contract helper, pinned dependencies and backend/native CI. The emulator configuration is blocked from deployment.

Use [the step-by-step testing instructions](../../operations/NATIVE_ACCOUNT_TESTING.md). Start the two local service terminals, select the local-account scheme, then sign in as **ranger-a@example.test / BarkTest123!**. B/free, expired, manual and access-code accounts use the same synthetic password.

## Code ownership and boundaries

[ARCHITECTURE.md](../../../01-code/ios/ARCHITECTURE.md) maps every implemented file, its functions and direct calls. [ADR 0002](../../adr/0002-catalog-personal-storage-and-receipts.md) records the state/receipt/threading decisions and growth tradeoffs. [Config/README.md](../../../01-code/ios/Config/README.md) explains actual provider configuration.

The main paths are:

1. `AccountAssembly → AccountService → AccountSession → LocalStore / SyncEngine / EntitlementRepository` for identity and account lifetime.
2. `AccountView → AccountModel → ProfileRepository → LocalStore.commit → store observation → AccountSession.requestSync` for a profile edit. The button does not manually update maps, scoring, trips or multiple caches.
3. `SettingsView → SettingsModel → SettingsRepository → ProfileRepository` only for the implemented cloud preference; other preferences remain device-local.
4. `SyncEngine → CloudUserClient → applyUserMutation → exact receipt → LocalStore`, followed by an authoritative server read. Firestore memory cache is not another durable write queue.
5. Existing catalog/discovery/selected-Park/search ownership is unchanged. No account workflow enters Discovery. Its only runtime edit is a wrapping, scalable offline-attribution caption found by the broader accessibility run.

The backend addition is five focused modules plus thin registrations and shared deletion cleanup. The existing large backend registry has not been broadly refactored. Billing, payment alerts, project ownership hooks and unrelated user changes were preserved. The historical web `walkPoints` rule remains its existing contract; native profile/settings operations cannot modify it. Phase 4 must review score-write policy before adding native scoring.

## Verification

Toolchain: Xcode **26.6 (17F113)**, Swift **6.3.3**, Swift 6 language mode/complete concurrency; iOS **26.5** Simulator. Node locally is 24; backend CI uses its declared Node 22. Local emulators ran with the installed Java 18; CI pins Java 21. Minimum supported iOS remains 18.4, with that runtime/device validation still outstanding.

Completed core checks:

| Check | Result |
|---|---|
| Signed Debug build-for-testing | Passed; ad-hoc Keychain entitlement required for Firebase Auth |
| Unsigned generic-device Release compile | Passed; not a provisioning or device-launch claim |
| Native app tests | **73 passed**: 63 Swift Testing functions and 10 XCTest methods, including parameterized cases |
| Foundation-only domain package | **14 passed** |
| Existing backend suite, extended deletion contract | **379 passed** |
| Real native transaction/rules emulator suite | **7 passed**, including a fresh emulator start |
| Firebase project isolation | **2 passed** |
| Ordinary UI interaction coverage | 19 tests exercised; initial map-caption accessibility and outdated external-handoff expectations corrected and their tests rerun successfully |
| Workflow/configuration syntax and whitespace | Passed locally; hosted CI status is separate |

The first broad UI run passed grouping toggles, pin-to-pin zoom/selection, search/keyboard behavior, the sheet’s three detents, scroll locking, dismissal, tab restoration, landscape, preferences/reset and large-text discovery. The existing Maps test wrongly expected an external app launch from the Phase 2 sandbox, which deliberately injects a failed handoff; it now verifies the real failure message and continued discovery. Real Maps return remains a physical/manual check.

The actual Firebase SDK test exercises email sign-in, local offline save/reopen/reconnect, UID switching and rejection of wrong-account cloud/provider requests. The Account UI test exercises real taps, name save, relaunch and sign-out. On iPhone 17 Pro and iPhone SE (3rd generation), the SDK and Account UI tests pass, including contrast/semantic/hit-target audits before and after scrolling, plus direct checks that the name field and Save button grow and remain reachable at the largest Dynamic Type size. The destructive-action color now has readable light/dark variants. The automatic audit excludes Dynamic Type/text-clipping heuristics for lazy Form rows in favor of the direct largest-size test; disabled controls and content in the system bar/fade area are excluded from contrast sampling. Those obscured rows are checked again after scrolling into view. This is focused coverage, not a claim that every account/provider state has passed a complete accessibility audit.

The final three-detent/discovery restoration test also passed on iPhone SE. The current-source signed Debug build and unsigned generic-device Release compile both passed. Xcode is set to **BarkRanger Local Accounts → iPhone 17 Pro**; its per-user build location reuses `/tmp/BarkStableAnchor` to avoid duplicate build storage.

A concurrency test exposed an intermittent emulator transaction-initialization error when several first reads were launched independently. The dispatcher now batches its initial reads with transaction.getAll; fresh-emulator contract tests pass. Native transport failures retain the same durable operation for retry.

Performance measurements from the final native regression run:

- **393 / 5,000 personal records:** decode plus baseline saves and a UI-originated profile edit took approximately **9 / 52 ms** in Debug Simulator. The save-thread probe recorded **no main-thread saves** through the actual ProfileRepository boundary.
- **393 / 5,000 parks:** 300 geometry-only coordinator updates produced **zero marker lookups and zero add/remove calls** (approximately **38 / 39 ms** total loops). Query/camera/settings invalidation tests remain passing.
- These are application work measurements, not physical-device frame-rate, GPU, energy or memory benchmarks. A SwiftData ModelActor alone did not guarantee caller-thread behavior; ProfileRepository’s three explicit `@concurrent` entry points fix that without custom executors or detached tasks.

Useful local evidence (temporary files may later be reclaimed): `/tmp/bark-phase3-final-corrections.log`, `/tmp/bark-phase3-full-regression.log`, `/tmp/bark-phase3-release-handoff.log`, `/tmp/bark-phase3-domain-final.log`, `/tmp/bark-phase3-existing-backend-final.log`, `/tmp/bark-phase3-backend-cold.log` `/tmp/bark-phase3-project-final.log`, `/tmp/bark-phase3-account-handoff-pro.log`, `/tmp/bark-phase3-account-handoff-se.log` and `/tmp/bark-phase3-sheet-final-se.log`. Commands are in the linked test runbook and checked-in CI workflows.

## Maintainability review

Current native engineering judgment, not a certification:

| Measure | Score |
|---|---:|
| Code quality | 8.3/10 |
| Spaghetti risk (10 = severely tangled) | 3.0/10 |
| Maintainability | 8.2/10 |
| Architecture clarity | 8.5/10 |
| Performance/efficiency | 8.1/10 |

The strongest parts are the independent catalog, explicit UID lifetime, single durable mutation authority, exact/current-content receipt protocol, and real persistence/emulator regression coverage. State flows are explicit and do not coordinate unrelated feature systems from buttons. No custom mutable global/singleton, circular feature dependency, `try!`, force unwrap or runtime `fatalError` was found in the added stack. Firebase/Google/UIKit’s own shared registries stay inside platform/assembly boundaries.

The main growth risks, in order:

1. The existing custom map/sheet/gesture presentation remains the hardest code to change safely. Keep its interaction tests and verify real/minimum-OS devices before release. Phase 3 does not add account coupling there.
2. One account payload rewrites the baseline/outbox together. This is deliberate and measured for the current two edit types; profile its size/write frequency before adding frequent visit/trip/recording changes. Avoid a generic sync framework now.
3. AccountSession owns lifecycle scheduling; AccountModel owns form/provider intentions. Keep future trip, achievement, recording and purchase logic out of both. Their current size is reasonable for their cohesive responsibilities.
4. Server reads currently refresh complete allowed personal snapshots on foreground/reconnect/manual changes and at five-minute idle intervals. Add selective reads only when actual account history/use warrants them. SDK cancellation cannot retract an already accepted remote request; exact receipts and UID/generation guards handle late outcomes.
5. The retained backend registry and web scoring contract need coordinated future work. They were not disguised as cleaned-up native architecture or silently rewritten during this phase.

No broad file consolidation is needed. Short ProfileRepository has a real intent/thread boundary; LocalSchema owns the actual installed schema; the domain projections are colocated rather than split into one file per tiny type. Optional Phase 2 view colocation can still wait.

## Source size and scope

Physical lines, including comments/blanks, compared with Phase 2 `e4d5756`; generated files, assets, dependency source and configuration are excluded from runtime counts.

| Source | Phase 2 | Phase 3 | Change |
|---|---:|---:|---:|
| Native runtime Swift | 50 files / 3,587 lines | 70 files / 5,474 lines | +20 files / +1,887 lines |
| Native app/UI/domain tests | 17 files / 2,753 lines | 27 files / 3,566 lines | +10 files / +813 lines |
| Backend native modules and existing registrations | No Phase 3 account handlers | 5 modules / 149 lines, plus 23 integration lines | +172 runtime lines |

The account-specific adaptive destructive color is an asset, not an extra Swift helper file. The largest native file is AccountModel at 210 lines, followed by CatalogRepository at 207 and LocalStore at 198. Emulator fixtures/scripts, CI, schema configuration and the backend contract tests are separate supporting code. Closely related views/domain values remain colocated; the 20 new runtime files have explicit ownership in the implemented file map.

**Legacy web lines retired: 0.** This phase adds native account functionality while the existing app keeps working. It does not justify a backend cost-reduction or total code-cut claim. Retirement savings belong to the later approved rollout/removal plan.

## Remaining prerequisites and stop point

Read-only Firebase inspection found only a web app registered in `barkrangermap-auth`. Real Apple/Google sign-in/link/cancellation, Apple revocation, native Firebase registration, physical-device signing and minimum-iOS checks are **not yet verified**. The adapters compile, but emulator email success is not evidence of those real provider flows. Account/publisher deployment, receipt TTL, production privacy/account-deletion checks, StoreKit and customer rollout all require their later authorized work.

**GO for Phase 3 local user testing. No remaining architecture/correctness blocker was found for that development scope.** Real-device/provider verification and rollout remain gated as described above. Phase 3 is for the user's local account/offline testing and fixes. Do not start Phase 4, migrate customers, redesign stored user data or retire web services without the next instruction.
