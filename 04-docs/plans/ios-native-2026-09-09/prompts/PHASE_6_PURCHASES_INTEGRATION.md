# Phase 6 — Apple-only Premium and Sign in with Apple

Updated September 14, 2026. This replaces the previous legacy/multi-provider Phase 6.
The owner reports paid Apple enrollment approved. This is an implementation plan,
not a claim that purchasing, Apple sign-in or storefront setup is already complete.

## Product and scope

- One Premium tier in one App Store subscription group. Billing periods, prices,
  product IDs and any introductory offer require owner confirmation; do not invent them.
- Account and existing paid-feature gates open the **same Upgrade to Premium screen**:
  current benefits, Apple's localized price/period, Subscribe, Restore Purchases,
  terms/privacy links. An active subscriber sees status and Manage Subscription.
  Apple's payment sheet handles payment details. Cancel/pending/error remain clear.
- **Apple subscriptions only in iOS and `bark-ranger-ios`.** No Lemon Squeezy,
  legacy payment migration, multi-provider grant resolver or new billing vendor.
  This does not remove email sign-in or require Apple sign-in to buy Premium.
- No journal, photos, multi-dog UI or broad NativeStore rewrite in this phase.
  Existing web, database, billing and users remain untouched. Retirement is owner-led later.

## Checkpoint 1 — Working purchase and sign-in path

1. Verify the actual paid team, bundle `swarm.USBARKRANGERS`, App Store Connect app,
   agreements/banking/tax prerequisites, sandbox testers, product/group IDs and capabilities.
   The owner handles agreements and payment details. Confirm Family Sharing before enabling
   it; recommend leaving it off initially for a single-owner entitlement model.
2. Finish the existing `AppleSignInAdapter` / `AccountModel` flow: nonce validation,
   cancellation, first-use name, explicit linking to the signed-in Firebase account,
   Hide My Email, recent reauthentication and Apple token revocation on account deletion.
   Never merge accounts solely because email strings match. Configure only the native
   Firebase provider and paid-team entitlements; enable the button after device verification.
3. Add one app-owned `PurchaseService` and a thin paywall. It loads configured StoreKit 2
   products and has one transaction observer, not an observer or purchase service per screen.
   Require a signed-in Bark account before purchase. Fetch/reuse a stable server-issued
   UUID `appAccountToken` bound to that UID; include it in the purchase request.
4. Add a small `functions-native/purchases` boundary for purchase context and verification.
   Use Apple's official Node library to verify signatures, bundle/app/product/environment,
   ownership, subscription status, expiry and revocation. Enforce unique original-transaction
   ownership. Both verification and notifications use **one entitlement application function**.
   Existing access checks continue reading the existing server-owned entitlement document;
   no custom claims or duplicate Premium state in individual features.
5. Show Premium as confirmed after the backend accepts it. Finish the StoreKit transaction
   only after durable server acceptance. Use StoreKit's unfinished transactions for redelivery
   plus idempotent server processing—do not build another disk-backed billing mailroom.
   A failed connection or account switch must not lose a paid transaction or grant it to
   the wrong UID. Distinguish Apple-paid/awaiting-account-confirmation from payment failure;
   never encourage a second purchase to solve a delayed acknowledgment.

Review and commit the vertical slice with local StoreKit and isolated backend checks.
Keep real purchasing gated until checkpoint 2 and sandbox acceptance are complete.

## Checkpoint 2 — Lifecycle, cleanup and real-device acceptance

1. Add verified App Store Server Notifications V2 and bounded reconciliation for missed
   events. Duplicate/out-of-order deliveries must not regrant refunded access or roll back
   newer state. Fetch authoritative current status when ordering is ambiguous. Reuse the
   same application function for purchase, restore and reconciliation.
2. Retain only required owner/token/subscription state and bounded processing records.
   Define indexes, retry and TTL explicitly; do not create a row for every app launch or
   ordinary save. Extend account deletion to these records. Late notifications cannot
   recreate a deleted account. Deletion does **not** cancel Apple billing: show Manage
   Subscription and a clear warning without making deletion depend on canceling first.
3. Preserve the approved offline rules: normal expiry allows edits for 40 days and the
   server accepts eligible paid changes through 45 days after expiry, by server time.
   Operation age still has its separate 45-day limit. Refund/revocation is not normal expiry
   and grants no new grace once learned. Retain unsynced work; never discard it on expiry.
   Describe the unavoidable limit that a disconnected phone cannot learn a new revocation.
4. Restore uses Apple's explicit user-initiated sync, then server verification. Manage opens
   Apple's subscription management. Account/token ownership remains stable through reinstall,
   renewal and switching devices. Wrong-account restore explains which action is needed;
   it never silently transfers ownership or automatically creates another subscription.
5. Keep sandbox evidence distinguishable from production purchases. Decide and test a
   server-enforced sandbox/test-build policy before device tests; never label sandbox evidence
   as `app-store-production` or accept Xcode-local signatures in the live verifier.
   Retire the owner's temporary administrative Premium grant only after sandbox access works.
6. Deploy only through `firebase.native.json`, explicit `bark-ranger-ios` and the scoped
   native deployer. Keep private Apple keys in Secret Manager, never the app or GitHub.
   Verify App Check and Release App Attest with the paid team. No store submission or real
   purchase is implied by development testing.

Must pass: buy/cancel/pending; duplicate callback and lost acknowledgment; restart before
and after confirmation; wrong account and account switch mid-purchase; reinstall/restore;
renewal/expiry/refund/revocation; duplicate/out-of-order/missed notifications; deletion and
late notification; 40/45-day boundaries; accessibility and unavailable products.
Local StoreKit tests are not a substitute for a real **Apple sandbox → native backend → iPhone**
round trip. Record actual per-purchase/restore/notification operations and ordinary-save
regressions. Require green GitHub checks, then install and have the owner verify the flow.
Commit each checkpoint; report measured results, code changes and remaining configuration.

## Current implementation anchors and official references

Extend `App/AccountAssembly.swift`, `Platform/AppleSignInAdapter.swift`, account views/model,
the current entitlement publisher and native account deletion. Keep purchase orchestration
out of NativeStore; preserve its one atomic writer and shared user-edit mailroom.
`functions-native/index.js` remains a thin registry, not the purchase implementation.

- [Firebase Apple authentication, linking and revocation](https://firebase.google.com/docs/auth/ios/apple)
- [Apple's official server verification library](https://github.com/apple/app-store-server-library-node)
- [StoreKit current entitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements)
- [Explicit restore synchronization](https://developer.apple.com/documentation/storekit/appstore/sync%28%29)
- [App Store Server Notifications setup](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications)
