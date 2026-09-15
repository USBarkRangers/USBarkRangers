# Phase 6 — Apple-only Premium and Sign in with Apple

Updated September 14, 2026. This replaces the previous legacy/multi-provider Phase 6.
The owner reports paid Apple enrollment approved. This is an implementation plan,
not a claim that purchasing, Apple sign-in or storefront setup is already complete.
Start gate satisfied: Native iOS checks passed for `16020fe` (run `34903360552`).
Complete and verify each checkpoint before starting the next; checkpoint 1 requires
the owner's connected, unlocked iPhone and Apple authorization.

## Product and scope

- One Premium tier in one App Store subscription group. Owner selected **20 per year,
  seven-day free trial, no Family Sharing**. Currency/exact price, Apple billing-grace
  duration and TestFlight access remain awaiting clarification. TestFlight cannot charge
  real money. Do not create products, offers or settings before those choices are confirmed.
- Account and existing paid-feature gates open the **same Upgrade to Premium screen**:
  current benefits, Apple's localized price/period, Subscribe, Restore Purchases,
  terms/privacy links. An active subscriber sees status and Manage Subscription.
  Apple's payment sheet handles payment details. Cancel/pending/error remain clear.
- **Apple subscriptions only in iOS and `bark-ranger-ios`.** No Lemon Squeezy,
  legacy payment migration, multi-provider grant resolver or new billing vendor.
  This does not remove email sign-in or require Apple sign-in to buy Premium.
- No journal, photos, multi-dog UI or broad NativeStore rewrite in this phase.
  Existing web, database, billing and users remain untouched. Retirement is owner-led later.

## Checkpoint 1 — Sign in with Apple alone

1. Verify the actual paid team, bundle `swarm.USBARKRANGERS`, App Store Connect app,
   and capabilities. The owner handles sign-in, two-factor prompts and any agreements.
   Do not create subscription products or change billing settings in this checkpoint.
2. Finish the existing `AppleSignInAdapter` / `AccountModel` flow: nonce validation,
   cancellation, first-use name, explicit linking to the signed-in Firebase account,
   Hide My Email, recent reauthentication and Apple token revocation on account deletion.
   Never merge accounts solely because email strings match. Configure only the native
   Firebase provider and paid-team entitlements. Enable the button in the development
   build for device acceptance after configuration; do not release it before verification.
3. Verify real-device sign-in, cancellation, first-use/returning account, Hide My Email,
   linking without duplicate accounts, sign-out/relaunch, recent reauthentication and
   deletion/revocation. Never delete the owner's account as a test. Checkpoint, push,
   verify CI, install and obtain device acceptance before starting purchasing.

## Checkpoint 2 — Purchase vertical slice

1. Confirm the owner's product choices and verify App Store Connect app, agreements,
   banking/tax prerequisites and sandbox testers. The owner handles financial/legal setup.
2. Add one app-owned `PurchaseService` and a thin paywall. It loads configured StoreKit 2
   products and has one transaction observer, not an observer or purchase service per screen.
   Require a signed-in Bark account before purchase. Fetch/reuse a stable server-issued
   UUID `appAccountToken` bound to that UID; include it in the purchase request.
3. Add a small `functions-native/purchases` boundary for purchase context and verification.
   Use Apple's official Node library to verify signatures, bundle/app/product/environment,
   ownership, subscription status, expiry and revocation. Enforce unique original-transaction
   ownership. Both verification and notifications use **one entitlement application function**.
   Existing access checks continue reading the existing server-owned entitlement document;
   no custom claims or duplicate Premium state in individual features.
4. The live `bark-ranger-ios` verifier accepts genuine **Apple sandbox and production**
   transactions. Verify signatures/environment, label and retain each environment distinctly,
   and prevent sandbox updates from replacing production entitlement evidence. Reject
   Xcode-local signatures; never use a client-supplied environment flag as proof.
5. Show Premium as confirmed after the backend accepts it. Finish the StoreKit transaction
   only after durable server acceptance. Use StoreKit's unfinished transactions for redelivery
   plus idempotent server processing—do not build another disk-backed billing mailroom.
   A failed connection or account switch must not lose a paid transaction or grant it to
   the wrong UID. Distinguish Apple-paid/awaiting-account-confirmation from payment failure;
   never encourage a second purchase to solve a delayed acknowledgment.

Review and commit the vertical slice with local StoreKit and isolated backend checks.
Keep public purchasing gated until checkpoint 3 and sandbox acceptance are complete.

## Checkpoint 3 — Lifecycle, cleanup and real-device acceptance

1. Add verified App Store Server Notifications V2. **No scheduled reconciliation job.**
   Rely on production notification retries, verify on explicit restore, and refresh status
   on app foreground near/past expiry with server throttling and shared in-flight work.
   Apple sends sandbox notifications only once. Acknowledge success only after durable
   processing; log failures and support on-demand recovery after an observed outage.
   Add a scheduled job only if observed missed events justify it. A missed refund can
   leave access stale until the next refresh; this tradeoff must remain visible.
   Duplicate/out-of-order deliveries must not regrant refunded access or roll back
   newer state. Fetch authoritative current status when ordering is ambiguous. Reuse the
   same application function for purchase, restore, notifications and status refresh.
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
   Apple billing grace is distinct from Bark's offline grace: honor verified renewal state
   without silently resetting or extending the existing 40/45-day clocks on every refresh.
4. Restore uses Apple's explicit user-initiated sync, then server verification. Manage opens
   Apple's subscription management. Account/token ownership remains stable through reinstall,
   renewal and switching devices. Wrong-account restore explains which action is needed;
   it never silently transfers ownership or automatically creates another subscription.
5. Verify both environment paths on the same live native verifier; never label sandbox
   evidence as `app-store-production` or accept Xcode-local signatures in that verifier.
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

## Signed in without an Apple subscription

For an account with no Apple subscription or other valid native access, show **Free account —
No active Apple subscription on this account**, Upgrade to Premium and Restore Apple Purchases.
Keep existing free features and native saved data viewing available. Paid edits require
Premium; applicable confirmed grace remains honored and pending work is never discarded.
Do not imply Restore imports Lemon Squeezy purchases or that an old subscription was canceled.
Existing Lemon Squeezy subscribers, legacy account/data migration and the old web app are
outside this phase. A status-check failure means temporarily unavailable, not proven Free.

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
