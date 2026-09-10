# Prompt 3 — Accounts, persistence and sync

## Activation and objective

On an explicit **“start phase 3,”** read [the shared execution contract](../IMPLEMENTATION_PHASES.md), prior phase reports, [architecture](../ARCHITECTURE.md), [Swift ownership](../SWIFT_FILE_MAP.md), [backend ownership](../BACKEND_FILE_MAP.md), and project ownership. Implement this phase only after resolving earlier blocking regressions.

Build native sign-in, ordinary reading of existing stored formats, account-scoped local persistence, existing membership access and a small durable sync path. Prove offline writes using **profile/display-name and cloud-syncable settings edits**. Visits/trip/expedition feature actions arrive later. Existing customers are not moved or used as test fixtures.

## Source contracts to inspect

Read current `authService.v145.js`, `authAccountUi.js`, `firebaseService.v145.js`, `premiumService.v145.js`, `VaultRepo.v141.js`, `visitMutationCoordinator.v141.js`, current functions/rules and relevant regression tests. Preserve the difference between saved locally and accepted by the server; stale callbacks cannot change another account's UI. Preserve existing entitlement statuses/expiry, protected fields, deletion tombstones and provider linking behavior.

Read current field layouts directly: `users/{uid}`, `visitedPlaces`, `settings`, profile/streak fields, `virtual_expedition`, completed expeditions, mileage/history/point adjustments, saved-route documents and both achievement representations. These are the app's current server format. Do not build a “legacy conversion path,” run data upgrades, mirror collections or change customer IDs. Unknown or ambiguous records must be preserved and surfaced, not silently matched or discarded.

## File ownership and staged APIs

| Files | Build now |
|---|---|
| D03–D07, D18 | Visit, Trip, Expedition, UserProfile and Entitlement values needed to decode current records; concrete settings/profile mutation envelopes and result types. Add later operation cases only in their owning phase. Model values may inspect themselves but cannot depend on future feature policies. |
| U01–U02 | First LocalSchema and actor-owned LocalStore: account baseline/projection, outbox, sync metadata and cached access. Atomic local change plus pending operation, reopen/close and accepted server snapshot application. Introduce purchase/draft/recording storage later. |
| U12 `CloudUserDecoder.swift` | All ordinary Firestore date/unit/identity/shape conversion and callable receipt decoding in one owner. No U09 LegacyUserDecoder, U03 speculative migration file or archive importer. |
| U10–U11 | One SyncEngine and CloudUserClient for reads/submission. Configure Firestore memory cache for this design; SwiftData owns durable pending writes. No simultaneous SDK write queue/direct personal writes. |
| U07; extend U08 | Profile/display-name operations and selected scoped settings. Device-only settings remain device-only. Achievement evaluation and visit/trip mutation logic remain phase 4. |
| P01–P04 | Remembered account scope/generation, Firebase auth operations, Apple/Google credential adapters, UID-bound existing entitlements and expiry. Credentials remain SDK/Keychain-owned. |
| F01–F02 | Native account forms, verification/reset/linking, basic profile editing, current membership status, existing provider management/recovery and deletion flow. Current saved-record counts/unresolved data can be shown as a compact account summary. |
| A02–A05/A07, F04–F05 and discovery models | Inject account scope/access, open personal storage independently of catalog, display sync state and gate implemented paid operations. No StoreKit purchase screen/service dependency yet. |

Profile editing must not call the not-yet-built AchievementPolicy. AccountModel must compile without PurchaseService: existing-provider actions use CloudUserClient.restoreExistingAccess/existingBillingURL/cancelExistingSubscription and current account/Functions contracts; StoreKit actions are added in phase 6. Local public discovery still opens when auth or the personal store is unavailable.

Backend: B05 reads existing access states; B07/B08 own exact operation receipts and a fixed settings/profile dispatcher; B12 validates those mutations; B13 preserves the existing recent-auth/deletion contract; B14 `currentSchema.js` reads/patches existing shapes. Retain existing billing handlers unchanged. Unknown native operation kinds are rejected, not routed to placeholder handlers. Rules deny client writes to receipts/provider grants and continue protecting entitlement/admin/score fields.

## Implementation sequence and calls

1. Create dedicated emulator configuration and an idempotent seed tool that refuses non-emulator hosts/projects. Seed synthetic account A/B, free/Premium/expired/manual/Lemon states and representative current-format records. Emulator Functions must use provider test adapters that cannot send real emails, support messages, charges or cancellations.
2. Add pinned Firebase/Google packages and required authentication callback/sign-in configuration. Build the real credential adapters. Document missing iOS registration/signing/provider prerequisites without contacting production accounts or disguising fixture auth as real Apple/Google verification.
3. `AccountService → AccountSession → AppLifecycle/AppComposition` establishes one active UID/generation and store. Restoring a remembered scope is distinct from server-confirmed sign-in. During A→B change, cancel reads/writes/observation, clear A's presentation, close that scope, then open B. A's pending records may remain protected on disk but are invisible and never sent as B.
4. `CloudUserClient → CloudUserDecoder → SyncEngine → LocalStore` accepts valid current-account server snapshots. A failed/incomplete decode cannot replace valid local data with empty records. Preserve stored identity and unrelated fields; convert miles/timestamps at the boundary and encode writes to the current server format.
5. `AccountModel/SettingsModel → ProfileRepository/SettingsRepository → LocalStore.commit` atomically saves the visible value and operation intent. Show “saved on this iPhone” after that transaction; if storage fails, do not claim success. Backgrounding/termination cannot erase a completed local save.
6. `SyncEngine → CloudUserClient.submit → applyUserMutation` sends the same stable operation ID across retries. The server checks auth, deletion, entitlement/field policy and expected entity content against its latest record. Commit the change and receipt atomically. After receipt loss, retry returns the prior result; another payload reusing the ID is rejected.
7. `LocalStore.acknowledge` clears only exactly accepted intent. Rebase remaining pending fields over new server snapshots; preserve a visible conflict for incompatible edits. Old web writers do not increment new revisions, so compare touched content/fingerprints where needed. Do not replace entire user documents or create new per-visit collections.
8. Existing entitled accounts gain permitted access from the one entitlement publisher. Keep UID binding, earlier expiry and the current maximum offline cache policy. A network failure is not a confirmed revocation. Expiry changes future paid operations without deleting saved history. Test-source access cannot enter release configuration.

The first native store needs a declared schema and safe reopen/recovery. Only an actual installed native schema change justifies an upgrade step. Guest/current-account policy must match source; do not silently transfer local records into a newly signed-in account or invent an import feature.

## AI verification

Implement/extend Entitlement, PersonalStore, CloudUserDecoder, AccountIsolation, SyncEngine and ProfileSettingsRepository tests using synthetic shared fixtures. Exercise real local persistence and emulator transactions, not only mocks. Test:

- Current data fields, saved-route IDs/order/notes/custom stops, both achievement forms, retired/unresolved park identities and historical scores survive decode/read unchanged.
- Offline edit → process termination → reopen → reconnect; remote commit with dropped response; duplicate/late receipt; changed payload with reused ID; stale server snapshot; permanent rejection; low storage; conflict without data loss.
- Sign-out, failed sign-out and A→B while a read/write is delayed. No A data flash, hidden-record overwrite, token reuse or callback acceptance in B.
- Cache UID mismatch, expiry and existing status matrix; client cannot grant itself Premium, scores, admin status or server confirmation.
- Recent-auth deletion, tombstone protection and retry against test accounts only. Deletion messaging must distinguish identity deletion from external subscription management.
- Auth SDK initialization or failed personal store cannot stall phase 2 catalog startup/reconnect.

Write ADR 0002 for the implemented catalog/personal-store boundary and receipt tradeoff. Add backend mutation and emulator tests, native contract parity checks and backend CI. Extend current rules/isolation tests while preserving unrelated user edits. Use narrow interfaces for HTTP/clock/provider fault injection, not a second synchronization framework. Run prior offline/discovery smoke coverage to catch account-startup regressions.

## User testing checklist

| User action | Expected result |
|---|---|
| Follow the seed/start instructions and sign into test account A. | Expected existing-format records/counts and membership appear. Clearly labeled test data is used. |
| Change display name and an eligible cloud preference offline, then close/reopen. | Changes persist locally and show pending sync. |
| Reconnect or trigger the delayed/lost-response case. | Changes sync once, with no disappearance, rollback or duplicate operation. |
| Switch to B while A has pending work, then return to A. | Accounts remain isolated; A's pending work is recoverable only in A. |
| Test free, Premium and expired fixtures. | Appropriate access appears; existing saved data stays readable according to the preserved policy. |
| Try password/reset/verification/provider cancellation and a test-account deletion. | Clear success/error states, no stuck form and no real customer/provider side effects. |
| Launch offline while previously signed in or with auth unavailable. | Public parks still load; only the remembered account's local content is eligible to display. |

## Completion and stop

Deliver the phase report, simple test-account/emulator setup, implemented API/ownership changes, automated evidence and explicit provider/device checks still unverified. Recount runtime lines and review whether the queue/decoding stayed within a small concrete design. Remove any duplicate cache or speculative migration layer discovered during review.

**Stop for the user's account/offline tests and fixes. Do not build visits, trips, StoreKit purchasing or start phase 4 without the user's instruction.**
