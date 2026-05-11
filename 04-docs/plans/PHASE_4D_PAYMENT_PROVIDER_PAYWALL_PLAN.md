# Phase 4D Payment Provider And Paywall UX Plan

Date: 2026-05-01

Status: design only. Do not edit runtime app code, add a payment provider SDK, add checkout buttons, add webhooks, deploy, or collect money in Phase 4D.

Readiness verdict: NOT READY to implement paid collection. Ready to implement Phase 4E only after the ORS key is rotated, provider account/test-mode details are chosen, and the first backend-only test-mode PR is approved.

## 1. Current Deployed Safety Status

Backend premium safety layer is deployed:

- Firestore rules are deployed.
- `getPremiumRoute` and `getPremiumGeocode` are deployed.
- Rules tests passed before deploy.
- Function handler tests passed before deploy.
- Callable emulator entitlement tests passed before deploy.
- E2E smoke passed after deploy.
- Payment provider work has not started.
- Checkout buttons have not been added.
- No money is being collected.

Remaining warning:

- The ORS key was exposed in terminal/chat during prior work and must be rotated before public beta or paid launch.
- Treat ORS key rotation as a paid-launch blocker even though backend callable entitlement enforcement is deployed.

## 2. Provider Comparison

Primary candidates: Stripe and Lemon Squeezy.

Official source notes used for this plan:

- Stripe Checkout supports hosted checkout flows and subscription mode.
- Stripe Customer Portal supports subscription/payment-method/customer-info management and cancellation.
- Stripe subscription webhook docs call out events such as `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, and active entitlement updates.
- Stripe Tax can calculate/collect taxes when configured, while Stripe Managed Payments can provide Merchant-of-Record coverage for an additional fee.
- Lemon Squeezy states that it is Merchant of Record and handles payment liability, sales tax, refunds, chargebacks, and PCI responsibility.
- Lemon Squeezy supports subscriptions, checkouts, customer portal, refunds, API resources, webhooks, test mode, and webhook simulation.

| Area | Stripe | Lemon Squeezy |
|---|---|---|
| Setup complexity | Medium. Checkout/Billing/Portal are mature, but account, product/price, tax, webhook, and billing-portal setup need careful configuration. | Low-medium. Hosted checkout, products, subscriptions, portal, taxes, and MoR are packaged around digital products. |
| Taxes / Merchant of Record | By default, Stripe is a processor plus billing/tax tooling. Stripe Tax and/or Managed Payments can help, but tax setup and business responsibility still need deliberate review. | Lemon Squeezy is explicitly Merchant of Record, which greatly reduces sales tax/VAT/GST operational burden for a tiny team. |
| Webhook complexity | Medium. Very capable, but event ordering and subscription/invoice lifecycle need careful handling. Recommended events include checkout, subscription, invoice paid, payment failed, deleted/refunded. | Medium-low. Subscription lifecycle events are direct and `subscription_updated` can be used as a catch-all, but entitlement mapping still must be server-verified. |
| Subscriptions support | Strong. Stripe Billing is the most flexible long-term option, with annual subscriptions, coupons, trials, customer portal, and detailed lifecycle states. | Strong enough for beta. Supports recurring products and subscription lifecycle webhooks. |
| Customer portal / cancel / refund | Strong. Stripe-hosted portal can update payment methods, manage subscriptions, cancel, and view invoices. Refunds are handled through Dashboard/API. | Strong enough. Hosted customer portal can manage subscriptions, payment methods, billing info, tax IDs, pause/resume/cancel; API supports refunds. |
| Fit for small niche student-built app | Good long-term, but initial tax/compliance choices may be heavy for a low-price hobby product. | Best beta fit because MoR reduces operational and legal/tax surface while keeping integration scope small. |
| Risks | Tax/compliance responsibility can be misunderstood; webhook state machine is easy to underbuild; more configuration choices; may invite overengineering. | Higher fee burden at low annual prices; less flexible than Stripe for complex billing; platform approval/support/provider-lock risk; future migration may require care. |

## 3. Recommended Provider

Recommended for fastest safe beta: **Lemon Squeezy**.

Reason:

- The app is a small niche hobby/student-built product with likely low annual ARPU.
- Merchant-of-Record handling is the biggest simplifier before collecting real money.
- Hosted checkout, customer portal, subscriptions, refunds, and webhook simulation fit the needed beta workflow.
- The app already has a Firestore entitlement cache, rules protection, and backend callable enforcement, so the provider only needs to create verified payment events that the backend maps into `users/{uid}.entitlement`.

Recommended for most scalable long-term path: **Stripe Billing**, optionally with Stripe Tax or Stripe Managed Payments depending on tax/compliance posture.

Reason:

- Stripe has deeper APIs, richer billing lifecycle tooling, broader ecosystem support, and more control if the product grows.
- Stripe is the likely migration target if pricing, reporting, multi-product plans, or custom billing workflows become more important than MoR simplicity.

Decision for Phase 4E:

- Use Lemon Squeezy test mode for beta unless account approval, API limitations, or webhook testing blocks progress.
- If Lemon Squeezy setup stalls, fall back to Stripe Checkout/Billing in test mode, but do not collect money until tax/MoR responsibility is explicitly resolved.

## 4. Pricing Model

Product assumptions:

- Audience: BARK Ranger map users, niche hobby audience, likely older/small beta group.
- Premium value: visited tracking and visited-aware map controls, map style controls, trail tools, global search/routing, and future premium feature buttons.
- Beta needs to feel friendly and low-pressure while still covering ORS/provider/support costs.

Pricing options:

| Price | Pros | Cons |
|---|---|---|
| `$10/year` | Very friendly; low barrier for hobby users. | Too little room after MoR/payment fees, ORS usage, support, refunds, and future costs. Can undervalue the product. |
| `$15/year` | Best beta balance. Still casual-gift-card cheap, but leaves more room for fees and support. | Some users may compare it to free park apps; needs clear value copy. |
| `$20/year` | Better cost coverage and simpler path to sustainable ORS usage. | More friction for a small older beta audience; higher expectation of polish/support. |
| Optional 2-year / 3-year | Useful for loyal users and fewer renewals. | Adds refund/cancel/support complexity and complicates early beta learning. Defer. |

Recommended beta pricing:

- Launch paid beta at **$15/year**.
- Do not offer monthly billing for beta; it adds churn, payment-failure, and support complexity for a tiny annual product.
- Do not offer 2-year or 3-year plans in the first paid beta.
- Revisit after 20-50 paying users and real ORS/provider/support cost data.

Free vs premium split:

- Free:
  - Browse map and park/place details.
  - Search existing local map/place data.
  - Sign in and manage account basics.
  - See clear previews of premium controls without being trapped in a hard sell.
- Premium:
  - Visited tracking and visited-aware map controls, if product chooses to make tracking paid.
  - Visited filter and richer map state controls.
  - Alternate map styles.
  - Active/conquered trail controls.
  - Global city/town search and ORS-backed premium route/geocode paths.
  - Future premium feature buttons.

Product caution:

- Do not hide existing user-owned data management unexpectedly. If visited history is moved behind premium, design a humane read-only/export path for previous users before public launch.

## 5. Paywall UX

Core states:

| User state | Interaction | UX result |
|---|---|---|
| Signed out | Clicks premium feature | Sign-in prompt opens first. Copy explains that an account is required before upgrade. No checkout button until authenticated. |
| Signed-in free | Clicks premium feature | Upgrade modal opens with annual price, premium benefits, support/refund link, and a single upgrade action. |
| Premium active/manual | Clicks premium feature | Feature opens immediately. No paywall. |
| Checkout success redirect | Returns from provider | App shows verifying payment state. Premium remains locked until Firestore entitlement updates. |
| Checkout canceled | Returns from provider cancel URL | App shows no-charge/still-free message and keeps controls locked. |
| Entitlement delayed | User paid but webhook not processed yet | Show pending/verifying message, refresh/retry affordance, and support link. Do not unlock from URL params. |
| Entitlement active | Firestore snapshot changes to `premium: true`, `active` or `manual_active` | `premiumService` unlocks controls and a small success state confirms premium is active. |

Upgrade modal requirements:

- Clear annual price and renewal language.
- Plain list of included premium features.
- Login-required state for signed-out users.
- Safe disabled/loading state while creating checkout.
- Cancel/close action that keeps the user in the app.
- Support link for payment trouble.
- No visible implementation details, provider secrets, or webhook state internals.

Account/status UX:

- Profile/account area should show current plan: Free, Premium active, Manual active, Payment pending, Past due, Canceled until period end, or Expired.
- Premium users should get a manage billing action that opens the provider customer portal.
- Free users should see an upgrade card, but not an aggressive full-page interstitial.

## 6. Frontend Paywall Surfaces

Paywall entry points should be consistent and go through one paywall controller/service later:

- `#visited-filter`
- `#map-style-select`
- `#toggle-virtual-trail`
- `#toggle-completed-trails`
- Global search UI and submit path
- Future premium feature buttons
- Profile page premium card
- Account/status area
- Any future ORS-backed route/geocode UI

Behavior:

- Signed-out users get sign-in first.
- Signed-in free users get upgrade modal.
- Premium/manual users proceed.
- Disabled controls should still be understandable, preferably with a nearby upgrade affordance or tooltip/copy.

## 7. Backend Flow

Provider-independent target flow:

1. Client calls `createCheckoutSession` callable.
2. Backend requires `context.auth.uid`.
3. Backend reads `users/{uid}` and checks whether user is already premium.
4. Backend creates or reuses provider customer for that UID/email.
5. Backend creates provider checkout in test/live mode depending on environment.
6. Backend includes Firebase `uid` in provider metadata/custom data.
7. Provider redirects user to hosted checkout.
8. Provider redirects back to success or cancel URL.
9. Success URL only starts a verifying state. It does not unlock premium.
10. Provider sends signed webhook event.
11. Backend verifies webhook signature with provider webhook secret.
12. Backend maps verified provider customer/subscription/order to the Firebase `uid`.
13. Backend writes `users/{uid}.entitlement` with Admin SDK.
14. Client unlocks only when Firestore entitlement snapshot shows effective premium.

Required backend functions for later phases:

- `createCheckoutSession`
- `createCustomerPortalSession`
- Provider webhook endpoint, such as `paymentsWebhook`
- Optional support/admin callable for manual entitlement status inspection

Backend invariants:

- Trust `context.auth.uid`, not client-provided `uid`.
- Trust provider webhooks only after signature verification.
- Store provider IDs server-side under protected fields.
- Never unlock from client checkout success URL alone.
- Make webhook processing idempotent by storing event IDs.

## 8. Webhook And Entitlement Mapping

Canonical Firestore entitlement shape:

```js
users/{uid}: {
  entitlement: {
    premium: false,
    status: "free",
    source: "lemon_squeezy",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: null,
    updatedAt: serverTimestamp,
    lastProviderEventId: null
  }
}
```

Provider state mapping:

| Provider event/state | Entitlement mapping |
|---|---|
| Checkout/session completed but subscription not verified | Do not unlock from redirect alone. Wait for subscription/order webhook or verified provider lookup. |
| Subscription active / paid initial order | `premium: true`, `status: "active"`, `source: "lemon_squeezy"` or `"stripe"`, set provider IDs, set `currentPeriodEnd`. |
| Renewal payment success | Keep `premium: true`, `status: "active"`, update `currentPeriodEnd`, provider IDs, `updatedAt`. |
| Payment failed / dunning | `premium: false` or grace-policy-dependent, `status: "past_due"`, keep provider IDs and period data. For beta, fail closed unless a grace period is explicitly approved. |
| Canceled but paid period remains | Prefer `premium: true`, `status: "active"`, set cancel metadata separately if available, keep `currentPeriodEnd`. On period end, move to expired. |
| Canceled immediately | `premium: false`, `status: "canceled"`, keep provider IDs for support/audit. |
| Expired after cancellation or dunning | `premium: false`, `status: "expired"`, keep provider IDs and prior `currentPeriodEnd`. |
| Refunded | `premium: false`, `status: "refunded"` if backend is updated to recognize it, or `status: "canceled"`/`"expired"` if status enum stays narrow; keep refund metadata in protected audit fields. |
| Manual support grant | `premium: true`, `status: "manual_active"`, `source: "admin_override"`, provider IDs optional/null. |
| Manual support revoke | `premium: false`, `status: "expired"` or `"free"`, `source: "admin_override"`, reason recorded in protected audit field. |

Current backend premium check only treats `active` and `manual_active` as premium, so any new status such as `refunded` must either be added intentionally to normalization/tests or mapped to an existing non-premium status.

## 9. Tests Required Before Real Money

Required test-mode coverage before any live payment launch:

- Signed-out premium click opens sign-in prompt.
- Signed-in free premium click opens upgrade modal.
- Checkout canceled returns to app and user remains free.
- Checkout success redirect does not unlock until Firestore entitlement changes.
- Webhook signature verification rejects invalid signatures.
- Verified webhook updates `users/{uid}.entitlement`.
- Reload restores premium from Firestore.
- Account switch isolation: premium user does not leak premium UI to free user.
- Refund/cancel/revoke changes entitlement to non-premium at the correct time.
- Past_due behavior is covered according to chosen grace policy.
- Provider test-mode smoke: checkout, success redirect, webhook, entitlement update, customer portal, cancel/refund path.
- Full E2E smoke passes after payment test-mode implementation.
- ORS callable emulator tests still pass.
- Firestore rules tests still pass, including client denial of entitlement/provider/payment fields.

Suggested commands for later phases:

```bash
npm run test:rules
npm --prefix functions test
npm run test:functions:emulator
npm run test:e2e:entitlement
npm run test:e2e:global-search
npm run test:e2e:smoke
```

## 10. Support And Admin Needs

Before public paid launch, add:

- Support email/link in the upgrade modal, account area, and verifying payment state.
- Manual entitlement override process for testers, comps, and payment recovery.
- Admin-only instructions for granting/revoking `manual_active`.
- Refund/cancel instructions that point users to the provider portal or support.
- "I paid but premium did not unlock" recovery flow:
  - Show verifying state.
  - Offer refresh/recheck.
  - Let user contact support with account email and approximate payment time.
  - Admin can inspect provider customer/subscription and Firestore entitlement.
- Privacy and terms basics:
  - What data is stored.
  - What provider handles billing.
  - Refund/cancellation policy.
  - Support contact.
  - Statement that checkout/payment data is handled by the provider, not by client app code.

Admin/support data hygiene:

- Keep provider IDs protected by Firestore rules.
- Never expose provider secrets or webhook secrets to the client.
- Log enough provider event IDs to debug duplicate/delayed webhooks.
- Avoid storing full payment details in Firestore.

## 11. PR Breakdown

Recommended phase split:

- **4D plan only**
  - This document.
  - Update existing premium/deploy docs with design status.
  - No runtime code.
- **4E provider setup + backend checkout session in test mode**
  - Add provider account/product/price configuration notes.
  - Add backend `createCheckoutSession` callable in test mode.
  - No frontend upgrade buttons yet except developer-only invocation if needed.
  - No live money.
- **4F webhook + entitlement update in test mode**
  - Add webhook endpoint.
  - Verify signatures.
  - Store processed event IDs.
  - Write `users/{uid}.entitlement` from verified events only.
  - Add tests for active, failed, canceled, refunded/expired.
- **4G frontend paywall modal + upgrade buttons**
  - Add shared paywall modal/service.
  - Wire premium surfaces to sign-in or upgrade.
  - Add profile/account premium card and billing portal entry.
  - Keep unlock tied to Firestore entitlement.
- **4H payment test-mode smoke**
  - End-to-end checkout success/cancel/webhook/entitlement/customer-portal/refund/cancel coverage.
  - Re-run existing entitlement, rules, function, callable emulator, and smoke tests.
- **4I final paid beta release gate**
  - Rotate ORS key before public/paid launch.
  - Confirm provider live mode, webhook secret, product/price, support links, terms/privacy, refund policy.
  - Explicit go/no-go review.
  - Only then consider live payment deploy.

## 12. Stop Lines

- Do not collect real money yet.
- Do not add live checkout buttons in Phase 4D.
- Do not unlock on success URL alone.
- Do not trust client payment state.
- Do not trust client-provided `uid`, `isPremium`, entitlement, provider ID, or status.
- Do not skip webhook signature verification.
- Do not add broad refactors during payment implementation.
- Do not deploy payment code without test-mode payment smoke.
- Do not launch paid/public beta before ORS key rotation.
- Do not weaken existing Firestore rules, ORS callable enforcement, or entitlement tests.

## Phase 4D Recommendation Summary

- Recommended provider for beta: Lemon Squeezy.
- Recommended long-term scalable provider: Stripe Billing, with Stripe Tax or Stripe Managed Payments considered separately.
- Recommended beta price: `$15/year`, annual only.
- First implementation PR: Phase 4E backend-only provider setup and test-mode `createCheckoutSession`; no frontend payment buttons, no webhooks yet unless explicitly moved into 4F, no live money.
- Ready to implement 4E: NO, not until ORS key rotation is scheduled/owned and Lemon Squeezy test-mode/provider account assumptions are confirmed.

## Phase 4E Checkout Planning Update

Phase 4E backend-only Lemon Squeezy checkout planning is captured in `plans/PHASE_4E_LEMONSQUEEZY_CHECKOUT_PLAN.md`.

Phase 4E recommended scope:

- Add `createCheckoutSession` callable later.
- Use Lemon Squeezy test mode only.
- Backend chooses the `$15/year` annual variant.
- Backend includes Firebase `uid` in Lemon Squeezy checkout custom data for later webhook reconciliation.
- Return checkout URL only.
- Do not write entitlement.
- Do not add frontend checkout buttons.
- Do not add webhooks until Phase 4F unless explicitly moved.
- Do not deploy or collect money.

Ready to implement 4E: NO until the Lemon Squeezy test-mode store, annual variant, test API key, and `APP_BASE_URL` values are available to the implementation task.
