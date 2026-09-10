# Prompt 6 — Purchases and integration hardening

## Activation and objective

On an explicit **“start phase 6,”** read [the shared execution contract](../IMPLEMENTATION_PHASES.md), all accepted phase reports, architecture/file maps and project ownership. Implement this phase only. A phase-6 build is not an instruction to distribute the app or move users.

Complete native purchasing and the integrated app, preserve existing subscriber access, finish the backend's readable module structure, and document measured quality and remaining external release checks. Continue the same user-test/fix cycle after this phase; production testing/deployment/migration plans come later.

## Existing contracts and platform review

Inspect current premium/auth/Lemon webhook/checkout/restore/management/deletion paths, access-code policy and protected rules. Preserve existing subscribers' effective status, historical provider references and lifecycle events. Do not cancel, rebill or transfer real Lemon subscriptions to Apple.

Verify current official StoreKit 2, App Store Server Library, notification, privacy, sign-in and App Review documentation before implementation. Use the official Node verification library at the server boundary. Product/bundle/group IDs, signing configuration, storefront behavior and service credentials must be real configured values or clearly unavailable prerequisites; do not invent them.

## File ownership

| Files | Operations for this phase |
|---|---|
| P05 `PurchaseService.swift` | Product loading, user-initiated purchase/restore/manage, transaction updates, durable server delivery/retry and transaction completion. It does not determine server access independently. |
| F03 `PaywallView.swift`; extend F01–F02 | Store-provided prices/terms, benefits, pending/cancellation/error states, restore and provider-aware management. An already entitled account sees current access instead of a second checkout. |
| P04/D07; extend U01–U02/U11–U12 | Same effective access publisher/contract, separate provider grants, persistent pending transaction delivery and typed purchase-context/verification transport. |
| A02–A04, existing feature gates | One transaction observer/lifetime wired through composition; pending results cannot leak between account scopes. No per-screen purchase service. |
| P17 and current views/resources/config | Targeted crash/hang/timing diagnostics, accessibility fixes, privacy/permissions/attribution and actual release configuration validation. No new monitoring framework by default. |
| Backend B15–B20 and B05 | Apple verification/context/notifications and retained Lemon/access-code handlers with one effective entitlement policy. |
| Backend B01–B06 and B28–B35 | Finish thin registry/shared boundaries and cohesive retained support/admin/operations ownership, preserving all live contracts. Existing ORS/CSV compatibility remains available. |

Add the StoreKit test configuration, actual privacy declarations, ADR 0004 and engineering readiness notes in `04-docs/runbooks/IOS_RELEASE_AND_ROLLBACK.md` (prerequisites and unverified checks only at this stage). Update existing setup/architecture rather than creating a second source of truth. Do not create migration/archive screens or a journal feature. Keep original web endpoints, schedules, legal/admin pages and ORS secrets intact.

## Purchase and entitlement call sequence

1. `AccountModel → PurchaseService.loadProducts` obtains configured products and localized metadata. No hardcoded prices or guessed product IDs. Missing configuration/store access produces a truthful unavailable state while existing members retain legitimate access.
2. Before purchase, `PurchaseService → CloudUserClient.purchaseContext → getAppStorePurchaseContext` obtains a stable server-issued `appAccountToken` bound to the authenticated UID. The backend creates/returns that mapping idempotently; it is provider metadata, not a user-data migration. No temporary random per-tap token or email-based ownership claim.
3. User purchase returns canceled, pending, unverified or verified outcome. Persist verified transaction delivery intent under the initiating UID/token before relying on later callbacks. Do not mark unverified local transactions as paid. The UI distinguishes provisional local state from server-confirmed access.
4. `CloudUserClient.verifyPurchase → verifyAppStorePurchase` verifies Apple's signed data/environment/bundle/product/expiry/revocation and original-transaction ownership. Prevent another UID from claiming the transaction. Derive the Apple provider grant and then effective access across Apple/Lemon/manual/code grants. A revoked Apple grant cannot erase an active unrelated grant.
5. On server acceptance, update the one entitlement repository and complete the transaction lifecycle. Lost responses, termination, sign-out/account change and redelivery reuse persistent identity; they cannot charge twice or lose recoverable delivery. Keep unacknowledged delivery work bound to its original account and retry on the correct scope.
6. `appStoreNotifications` verifies signed notifications and durable processing state, handles duplicate/out-of-order events, and applies authoritative current subscription status. Persist/retry failures; a receipt that says pending is not a completed duplicate. Deleted accounts cannot be recreated by a notification.
7. Restore is an explicit user action and verifies ownership. Management uses the appropriate provider; deleting Firebase identity is not represented as canceling Apple billing. Existing Lemon renewals/recovery/management keep their current contracts, exercised through synthetic provider adapters during this build.

`getAppStorePurchaseContext` and `verifyAppStorePurchase` belong together in B15; `appStoreNotifications` belongs in B16. Add exact registry entries and transport methods to the maps. They are local/additive code here, not deployed endpoints. App-side paid gating and server authorization must agree, but a local Boolean never permits a protected server write.

## Integration and maintainability work

- Audit every requested existing feature against the six reports and current source inventory. Replace remaining development placeholders with implemented behavior or a clearly documented external configuration prerequisite. Remove accidental dead paths and duplicate state owners. A journal/watch app/offline street-map service remains outside scope.
- Finish the backend module extraction while retaining exported names and runtime options. Move existing ORS handlers behind their compatibility boundary and preserve CSV snapshot paths. Support/email-bank/admin/report/cost functions keep their outputs. Consolidate only demonstrated duplication covered by comparisons; no schedule/function/secret deletion as “cleanup.”
- Confirm single ownership of catalog, personal persistence, location session and entitlement updates. Check task cancellation, observers, temporary images/files, bounded queues and cache retention. Avoid replaying an entire catalog/user graph for a single changed record.
- Measure startup, large catalog filtering, route request count, representative sync reads/writes, recording battery/memory and large-photo export on available hardware. Record method, device and limitations; no fabricated dollar/scale claims or live load tests.
- Check VoiceOver, largest text, Reduce Motion, non-color status, touch targets, keyboard/form behavior, dark mode and smaller supported phones across all implemented screens. Do this as integration completion, while retaining the accessibility work already done per phase.
- Audit actual permission prompts/data flows, required privacy declarations, SDK manifests, source licenses, URLs and local diagnostic redaction. Validate production configuration fails clearly when prerequisites are missing and cannot enable emulator grants, test receipt verification, debug menus or mock support delivery as live behavior.
- Prepare an unsigned/archive build check where tooling permits and a documented list of later signing/App Store/provider prerequisites. Do not upload a build, register new cloud infrastructure or change real storefront settings automatically.

## AI verification

Use Xcode StoreKit configuration for local purchase UI/state tests, and official verification-boundary fixtures for server unit tests. **Local StoreKit success does not prove an App Store sandbox/server notification round trip.** Complete real sandbox/device checks only in an already explicitly authorized test setup; otherwise keep that external check pending without weakening production signature verification.

Run PurchaseService, Entitlement, Purchases UI and Apple transaction/notification tests, plus relevant account/deletion/rules suites. Cases include purchase cancellation, pending approval, unavailable products, verified/unverified transactions, duplicate callback, crash before/after local persistence/server response, restore on another device/account, wrong UID/token/bundle/product/environment, refund/expiry/grace and overlapping provider grants.

Run meaningful complete integration checks now: offline launch → test sign-in → pending visit/trip → reconnect → expedition completion → membership change → sign-out/reopen. Exercise a second account and failed services. Run retained backend/rules/project-isolation tests after extraction and compare support/report outputs. Distinguish existing failures from new regressions, preserving unrelated edits.

## User testing checklist

| User action | Expected result |
|---|---|
| Open the paywall with local test products, cancel and retry a purchase. | Accurate store metadata and clear state; cancellation does not unlock access. |
| Simulate pending approval, successful purchase, lost response and relaunch. | Pending/retry state survives; entitlement arrives once through the right account. |
| Restore and try account-switch/wrong-owner cases. | Legitimate access recovers and another account cannot claim the purchase. |
| Use existing Lemon/manual and dual-provider test accounts; revoke one test grant. | Current valid access remains correct without a second purchase. |
| Use the entire app offline/online, including trips and a walk. | Previously accepted features remain functional and saved data is preserved. |
| Test large text/VoiceOver, repeated tab switches and long sessions. | Navigation, performance and controls remain usable without accumulating work. |

## Completion, measurements and stop

Update phase 6's report and the native README/code walkthrough with **implemented** file counts/line counts and measured behavior. Reconcile all maps against actual paths/callers. Report runtime/test/config separately using the same physical-line method as [CODE_REDUCTION.md](../CODE_REDUCTION.md). Old web code retained for existing users is not “cut”; report replacement size and later removable source separately.

Deliver a complete development build, test results, user checklist and an explicit list of unverified external/device checks. State whether the build is awaiting user testing/fixes or is blocked by a concrete implementation prerequisite. **Stop.** After the user accepts the build, propose the separate final testing, deployment and existing-user rollout plan. Do not move users, simplify the server's user-data layout, delete web code or start a new phase automatically.
