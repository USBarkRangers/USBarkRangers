# Six implementation prompts and the testing handoff

Revised September 10, 2026. Status: **phase 1 in progress**, explicitly started by the user on September 10, 2026 ("do phase 1"). This is the current execution contract. It replaces the former foundation/catalog phase 1 and the former migration/rollout phase 7. The user explicitly requested "do phase 1" on September 10, 2026. That instruction authorizes phase 1 only; phase 2 still requires a separate explicit start.

## Workspace preparation

At the user's request on September 10, the existing Desktop Xcode starter was copied into `01-code/ios/BarkRanger.xcodeproj`, configured for iPhone/iOS 18.4/Swift 6 and given a shared BarkRanger scheme. That historical setup preceded phase 1. The phase-1 implementation now replaces the temporary Hello, world! ContentView; the table below records the current status. See the [native setup README](../../../01-code/ios/README.md). GitHub setup branch: `codex/ios-native-setup` on `USBarkRangers/USBarkRangers`.

## How we will work

For each phase: implement its complete scope → run the relevant checks → give the user a runnable build and testing checklist → fix reported problems in that phase → wait for the user to start the next phase. A prompt can span multiple work sessions. Six prompts are six milestones, not a promise that six unattended AI runs produce a finished app.

Do not begin the next phase merely because tests pass, because the user asks a question, or because one build has been delivered. A request to fix a problem keeps work in the current phase. Record explicit user acceptance/start instructions in the status table; never infer them from silence. Later discoveries can require repairs to earlier files while remaining part of the active phase.

| Phase | Reusable AI prompt | What the user gets to test | Implementation status | User acceptance |
|---|---|---|---|---|
| 1 | [Foundation and app shell](prompts/PHASE_1_FOUNDATION.md) | A native app that builds, launches, navigates and has a documented structure. | In progress | Pending |
| 2 | [Catalog and discovery](prompts/PHASE_2_CATALOG_DISCOVERY.md) | Real offline parks, refresh/reconnect behavior, map, search, filters and details. | Not started | Pending |
| 3 | [Accounts, persistence and sync](prompts/PHASE_3_ACCOUNTS_SYNC.md) | Test-account sign-in, current-format data reads, memberships, persistent settings/profile edits and account isolation. | Not started | Pending |
| 4 | [Visits, trips and passport](prompts/PHASE_4_VISITS_TRIPS.md) | Durable visits, itinerary planning, saved trips, passport, achievements and leaderboard. | Not started | Pending |
| 5 | [Expeditions and native capabilities](prompts/PHASE_5_EXPEDITIONS_NATIVE.md) | Recording/recovery, expedition progress, Live Activities, sharing and support. | Not started | Pending |
| 6 | [Purchases and integration hardening](prompts/PHASE_6_PURCHASES_INTEGRATION.md) | StoreKit test purchasing, provider-aware access and a complete integrated development build. | Not started | Pending |

Status updates should include the build identifier/commit if available, checked devices/toolchain, unresolved issues and the user's acceptance wording/date. Do not create empty phase reports or runtime files now. During implementation, keep one report per phase under `04-docs/reports/ios-native/PHASE_N.md`; update that report for fixes instead of generating a new report for every small change.

## Instructions shared by all six prompts

These instructions are part of every linked prompt. Read them when starting or resuming a phase, together with repository `AGENTS.md`, the phase report, the relevant file-map rows and the current source. The current user instruction takes precedence. Recheck assumptions against the checkout: the source analysis was made at `8451e06`; it is not permission to overwrite subsequent work.

### Scope and project boundaries

- Build the iOS app in Swift/SwiftUI with a small Foundation-only `BarkDomain` package. Keep the efficient existing JavaScript Firebase platform. No Swift server, web-view app shell, CloudKit mirror, journal feature, new user database or generic migration framework.
- Keep existing account UIDs, visits, trips, achievements, historical scores and paid-access semantics. Read their existing format normally. No archive-import screen, Safari-storage reader, mass conversion or permanent “old user/new user” branches.
- Work in the current repository and preserve all unrelated edits. New native source belongs in `01-code/ios/`. Never scaffold the entire proposed file list before the current phase needs it.
- The only production Firebase project is `barkrangermap-auth`. Read [project ownership](../../FIREBASE_PROJECT_OWNERSHIP.md) before backend/configuration changes. Preserve all functions, hosting and rules predeploy project checks. Do not use JDDM resources.
- These six prompts authorize local code, tests and build configuration only. They do not authorize production deployments, editing real users or payments, cloud backfills, creating cloud projects, installing live sheet triggers, submitting to App Review, sending support messages or moving users. Keep old web source, endpoints, secrets, schedules and data in place.
- Use local Firebase emulators and synthetic test accounts/data. A `demo-barkranger-ios` identifier may identify the local emulator setup; it is not a cloud project to create. Development provider adapters must prevent real Lemon charges/cancellations, real email/Discord delivery and private-sheet writes. Test-only success is visibly identified and must never masquerade as live verification.
- If a physical-device/provider check needs signing, registration, credentials or configuration that is unavailable, complete independent work and report the precise missing prerequisite. Never invent identifiers/secrets, weaken production checks or claim the blocked check passed. Any external setup beyond local development needs its own explicit user instruction.

### Code ownership and simplicity

- Use [SWIFT_FILE_MAP.md](SWIFT_FILE_MAP.md) for each file's purpose, public operations and direct calls, and [BACKEND_FILE_MAP.md](BACKEND_FILE_MAP.md) for backend contracts. The phase prompt decides which of those operations exists now. File IDs are stable review references, not generated class names.
- Views render and forward actions. Feature models coordinate. Repositories own personal changes. `LocalStore` owns persistence transactions. `CatalogRepository` owns accepted catalog revisions. One composition root wires dependencies through initializers. No global service lookup, event bus, generic base view model or one protocol per type.
- Keep the durable personal queue concrete: operation ID, account scope, entity, supported payload, retry state and exact acknowledgement. Add operation kinds when their feature arrives. No generic command framework, plugin registry, generalized conflict DSL or extra queue behind Firestore's cache.
- Model files may hold closely related values. A new file requires an actual separate responsibility and an update to the map explaining its callers. Budget/line limits are review guides, not a reason to split coherent code or remove error handling.
- Add concise purpose/ownership comments and documentation for non-obvious persistence, cancellation and error behavior. Keep implemented architecture and setup instructions current. Prefer deleting obsolete development placeholders over keeping parallel paths.
- Validate platform choices against current official Apple/Firebase documentation when implementing; pin the actual supported toolchain/dependencies rather than guessing versions from this plan. The proposed minimum remains iOS 18.4 until explicitly revised with its consequences documented.

### Sequential dependency rule

Each phase must compile using only implemented collaborators. Earlier screens accept small value inputs and actions; they do not import future repositories or fabricate success. In unfinished areas, show a clearly identified development placeholder or omit the action. Test fakes stay in previews/tests or an explicitly selected development configuration. No force unwraps, `fatalError` placeholders or release-access bypasses stand in for missing features.

| File/responsibility introduced early | What exists first | Later extension |
|---|---|---|
| `AppComposition`, `AppLifecycle`, `AppRouter`, `RootView`, startup | Phase 1 shell and scene/navigation handling | Catalog in 2; account scope in 3; feature routes in 4–6. |
| `Park`, catalog/filter values | Stable identity/coordinates in 1; full catalog/filter contract in 2 | Visit/trip ID projections in 4. Filters take sets of IDs, not repositories. |
| `StartupModel` | Phase 1 shell readiness | Real local catalog/network deadline in 2; independently opened personal store in 3. |
| `SettingsRepository` and settings UI | Phase 2 device-only preferences | Scoped cloud fields/access checks in 3. |
| `ParkDetailModel` | Phase 2 read-only details and directions | Visit/check-in/add-to-trip in 4; feedback in 5. |
| `LocationClient` | Phase 2 one-shot locate request | Phase 4 proximity request; phase 5 continuous recording/background session. |
| `MapsHandoff` / map overlays | Phase 2 single park and local outline | Phase 4 itinerary legs/waypoints; phase 5 trail and recording geometry. |
| `Visit`, `Trip`, `Expedition`, `UserProfile` | Phase 3 values to decode stored records and show an account summary | Feature policies, mutators and screens in 4–5. Values do not call those later features. |
| `LocalSchema`, `UserMutation`, sync dispatcher | Phase 3 baseline, settings/profile operations and receipts | Visits/trips in 4; walks/awards/drafts in 5; pending purchase delivery in 6. |
| `ProfileRepository` | Phase 3 display-name/profile editing | Phase 4 achievements/streaks. |
| `AccountModel` / entitlement contract | Phase 3 sign-in, current provider access/management | Phase 6 StoreKit product/purchase/restore actions through the same access contract. |
| `MapSearchClient` | Phase 4 paid town/custom-stop search | Shared with trip stop selection; phase 2 still has fully local park search. |
| `Diagnostics` | Phase 1 redacted local logs and timing | Targeted measurements in each phase; MetricKit/approved transport review in 6. |

From phase 3 onward, an earlier phase build counts as an installed native schema. Preserve the user's test records when upgrading between phases. Prefer supported lightweight schema changes; introduce an explicit upgrade step in the schema owner only when the actual change requires it. Never wipe/reseed the local store merely to avoid handling an upgrade. This is normal native app maintenance, separate from transferring old web users.

### Required handoff after every phase

Update its phase report with: implemented behavior; files added/changed and their ownership; exact build/test commands and results; known pre-existing failures separated from regressions; environment/toolchain and device evidence; user testing steps with expected outcomes; remaining prerequisites; source-line counts for implemented runtime versus tests/config; and known later-phase features. Give the user a short explanation and a clickable link to the report.

Distinguish **implemented**, **automatically verified**, **physically/provider verified** and **accepted by the user**. “Build complete” is not permission to advance or a claim of production readiness. If critical checks cannot run, mark the phase incomplete or awaiting that check and explain why. Run focused regression checks after fixes; do not repeatedly run unrelated expensive suites without a new reason.

## Backend work by phase

The 35-module map is a responsibility target. Introduce new behavior alongside retained endpoints; use existing modules until extracting them is necessary or phase 6 consolidates the final structure. The old routing/catalog contracts remain available throughout this build.

| Phase | Backend ownership and scope |
|---|---|
| 1 | Read-only baseline, emulator/CI strategy and fixture layout. No production handler refactor. |
| 2 | B21–B24 catalog schema, publisher, edit signal and reconciliation; minimal B01–B04/B06 integration using existing equivalent auth/config/rate limiting. B35 gets only the tested publication hook after an accepted sheet write; no live trigger installation. |
| 3 | B05 existing entitlement normalization; B07–B08 receipt/dispatcher; B12 profile/settings operations; B13 existing account deletion contract; B14 `currentSchema`. Existing Lemon handling continues; no changes to external billing. |
| 4 | B09–B10 visits/trips, B25 scores/leaderboard; extend B12 for earned achievements/streaks. Current protected rules and old-client transactions are covered by emulator tests. |
| 5 | B11 walks/expeditions; B26–B27 feedback/durable acknowledgement/attachments. Reuse existing support delivery through a test adapter. No raw GPS/Health sample storage. |
| 6 | B15–B20 Apple verification/notifications and retained Lemon/access-code ownership; complete B01 registry and B02–B06 shared extraction; B28–B35 retain support/admin/report/cost behavior in cohesive modules. Consolidate duplicate logic only with output parity. All old exported functions remain. |

## Additional development/support files and when they belong

The full resource/test inventory remains in [BUILD_AND_TEST_INVENTORY.md](BUILD_AND_TEST_INVENTORY.md). Add these practical implementation aids only in the owning phase:

| Proposed file | Phase | Responsibility and callers |
|---|---:|---|
| `01-code/ios/Config/README.md` | 1 | Explains local demo, emulator and eventual live configuration; identifiers/capabilities required later; read by setup/phase handoffs. |
| `01-code/ios/BarkRangerTests/AppShellTests.swift` | 1 | Tests root navigation/deep-link rejection and cancellation boundaries actually implemented in the shell. |
| `01-code/ios/BarkRangerUITests/AppShellUITests.swift` | 1 | Launch, tab/sheet dismissal, background/foreground and accessible navigation smoke tests. |
| `05-tools/scripts/serve-ios-catalog.js` | 2 | Development-only local HTTP fixture server for unchanged/new/invalid/slow manifest/payload cases; uses synthetic or public catalog fixtures. Binds loopback by default; explicit documented local-network binding is for a user test device. No production writes or general backend service. |
| `06-config/firebase.ios-emulators.json` | 3 | Dedicated local emulator ports/rules/functions configuration; no deploy hooks or production deployment alternative. Existing production config/predeploy checks remain authoritative. |
| `05-tools/scripts/seed-ios-emulators.js` | 3 | Refuses non-emulator targets; idempotently seeds synthetic A/B/free/Premium/current-format records and test provider state. No real customer IDs or admin credentials. Extend fixtures in 4–6. |
| `01-code/ios/BarkRanger/GoogleService-Info.plist.example` | 3 | Documented configuration shape with unmistakable placeholders; never pass it off as a registered iOS app. A real registered file is separately required for live provider verification. |
| `01-code/ios/BarkRangerTests/ProfileSettingsRepositoryTests.swift` | 3 | Verifies the first real offline-write slice, conflict/receipt behavior and scoped settings. |
| `04-docs/reports/ios-native/PHASE_N.md` | 1–6 | One maintained implementation/testing handoff per started phase. |

Source files are created only by their explicitly started phase, not merely because they appear in this plan. These development tools/tests are excluded from production Swift/runtime savings. Their actual size is reported separately during implementation.

## After phase 6

Create a separate proposal for final production testing, provider registration/configuration gaps, controlled backend deployment, beta distribution and moving existing users. Keep the current web app usable. Decide browser-only unsynced-data handling and future server data simplification then, based on actual records and the small user population. Journaling does not enter these six phases.

No consumer web deletion, ORS retirement, historical release cleanup or claimed deployed cost reduction occurs during the build. The line-reduction report remains a forecast until the replacement is implemented and any later retirement is explicitly approved.
