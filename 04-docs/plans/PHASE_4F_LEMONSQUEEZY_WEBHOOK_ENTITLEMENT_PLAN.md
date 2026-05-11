# Phase 4F Lemon Squeezy Webhook Entitlement Plan

Date: 2026-05-03

Status: 4F.1 local backend implementation is complete. Do not edit runtime app code, add frontend checkout buttons, deploy, use live mode, collect money, or write entitlement from the client in Phase 4F.

Readiness verdict: 4F.1 is ready for local QC with mocked webhook payloads and fake secrets; NOT READY to deploy or collect money until the webhook secret is set, explicit deploy approval is given, and Lemon Squeezy test-mode webhook smoke confirms real payload paths.

4F.1 implementation update:

- Added local HTTPS function `lemonSqueezyWebhook`.
- Added raw-body `X-Signature` HMAC-SHA256 verification with `LEMONSQUEEZY_WEBHOOK_SECRET`.
- JSON parsing happens only after signature verification succeeds.
- Added local handler tests with fake raw payloads, fake signatures, and mocked Firestore.
- Added entitlement mappings for active, expired, past due/payment failed, canceled-with-remaining-period, and refunded paths.
- Added idempotency handling with `lastProviderEventId` and derived event IDs.
- Preserved `manual_active` admin overrides from provider downgrades.
- MAX-strength QC added tests for missing raw body, missing secret, malformed signature length/encoding, valid-signature malformed JSON, raw-byte HMAC verification, header event fallback and meta precedence, empty/non-string/path-like UID, store mismatch, live-mode payload ignore, resumed/recovered/unpaid/canceled-ended mappings, repeated duplicate terminal events, and broader manual override protection.
- No frontend checkout button, paywall modal, deploy, live mode, real Lemon Squeezy call, Firestore rules change, ORS change, or live money collection was added.
- Webhook secret still must be set before deploy.
- Real Lemon Squeezy payload paths still need test-mode smoke confirmation before paid launch.
- Out-of-order provider timestamp protection is not implemented in 4F.1; this must be resolved or explicitly accepted after real Lemon Squeezy test-mode payloads are captured.
- Phase 4F.2 payload capture and ordering decision planning is documented in `plans/PHASE_4F2_LEMONSQUEEZY_WEBHOOK_PAYLOAD_CAPTURE_PLAN.md`.
- Phase 4F.3 test-mode capture deploy gate is documented in `plans/PHASE_4F3_LEMONSQUEEZY_TESTMODE_CAPTURE_GATE.md`.

4F.1 verification status:

- `node --check functions/index.js`: PASS.
- `node --check functions/tests/lemonsqueezy-webhook.test.js`: PASS.
- `npm --prefix functions test`: PASS, 62 tests.
- `npm run test:functions:emulator`: PASS.
- `npm run test:rules`: PASS.
- `git diff --check`: PASS.

## 1. Current State

- Phase 4E `createCheckoutSession` exists locally as a backend-only Firebase callable.
- `createCheckoutSession` requires Firebase auth and trusts only `context.auth.uid`.
- `createCheckoutSession` forces Lemon Squeezy store ID `363425`, annual variant ID `1604336`, app base URL `https://outswarming.github.io/bark-ranger-map/`, and `test_mode: true`.
- `createCheckoutSession` includes `checkout_data.custom.firebase_uid = context.auth.uid`.
- `createCheckoutSession` returns only `checkoutUrl`.
- Checkout success URL does not unlock premium.
- Entitlement still only changes through manual/admin data in deployed code today.
- Webhook verification and webhook-driven entitlement updates now exist locally only.
- No frontend checkout buttons, paywall modal, deploy, or live money collection has been added.

## 2. Lemon Squeezy Webhook Prerequisites

Manual setup required before deployed test-mode smoke:

1. Set or confirm the Firebase project target for test/staging.
2. Deploy the future HTTPS webhook function only after approval.
3. Copy the deployed HTTPS endpoint URL for the webhook function, likely:
   - `https://<region>-<project>.cloudfunctions.net/lemonSqueezyWebhook`
4. In Lemon Squeezy test mode, create a webhook for the BARK Ranger store.
5. Configure the webhook callback URL to the deployed Firebase HTTPS endpoint.
6. Create and save a webhook signing secret.
7. Store the signing secret in Firebase Functions secrets:

```bash
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
```

8. Confirm the existing Phase 4E checkout secret is set before checkout deploy:

```bash
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
```

9. Subscribe to test-mode events needed for subscriptions and refunds:
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
   - `subscription_resumed`
   - `subscription_expired`
   - `subscription_payment_success`
   - `subscription_payment_failed`
   - `subscription_payment_recovered`
   - `subscription_payment_refunded`
   - `order_refunded`
10. Use Lemon Squeezy test mode and webhook simulation/resend tools where available.
11. Capture one real test-mode payload per event family before paid launch to confirm exact field paths.

Official docs used for this plan:

- https://docs.lemonsqueezy.com/help/webhooks/signing-requests
- https://docs.lemonsqueezy.com/help/webhooks/webhook-requests
- https://docs.lemonsqueezy.com/help/webhooks/event-types
- https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events
- https://docs.lemonsqueezy.com/help/checkout/passing-custom-data
- https://docs.lemonsqueezy.com/help/getting-started/test-mode

## 3. Backend Webhook Design

Recommended function name: `lemonSqueezyWebhook`.

Use a Firebase HTTPS request function rather than callable:

```js
exports.lemonSqueezyWebhook = functions
  .runWith({ secrets: ["LEMONSQUEEZY_WEBHOOK_SECRET"] })
  .https.onRequest(async (req, res) => {
    // Implemented locally in 4F.1.
  });
```

Design requirements:

- Accept only `POST`; return `405` for other methods.
- Read `req.rawBody` and verify the Lemon Squeezy `X-Signature` header before JSON parsing.
- Compute `HMAC-SHA256(rawBody, LEMONSQUEEZY_WEBHOOK_SECRET)` and compare with the header using `crypto.timingSafeEqual`.
- Reject missing or invalid signatures with `401` or `403`.
- Parse the event only after signature verification succeeds.
- Read event name from `meta.event_name` and/or `X-Event-Name`.
- Extract Firebase UID from `meta.custom_data.firebase_uid`; Phase 4E writes it through `checkout_data.custom.firebase_uid`.
- Validate UID is a non-empty string before any entitlement write.
- Extract provider identifiers from the signed payload only:
  - `data.id` for subscription/order object ID depending on event type.
  - `data.attributes.customer_id`
  - `data.attributes.order_id`
  - `data.attributes.status`
  - `data.attributes.renews_at`
  - `data.attributes.ends_at`
  - `data.attributes.trial_ends_at`
  - `data.attributes.test_mode`
- Verify `data.attributes.test_mode === true` in 4F test mode if the field is present.
- Optionally verify `data.attributes.store_id === 363425` if present.
- Write `users/{uid}.entitlement` using Admin SDK only.
- Preserve manual override semantics:
  - If existing entitlement has `status: "manual_active"` and `source` is not `lemon_squeezy`, do not downgrade it automatically.
  - Store provider state separately or leave manual override intact with an audit note.
- Store provider metadata needed for future support:
  - `providerCustomerId`
  - `providerSubscriptionId`
  - `providerOrderId`
  - `currentPeriodEnd`
  - `updatedAt`
  - `lastProviderEventId`
- Return `200` for known, safely handled events.
- Return `200` for unknown but validly signed events after logging a safe summary, so Lemon Squeezy does not retry forever.
- Do not trust client data.
- Do not unlock from checkout success URL.

## 4. Entitlement Mapping

Current backend premium checks only treat `active` and `manual_active` as premium. All other statuses must remain non-premium unless a later phase intentionally changes `normalizeEntitlement` and tests.

| Lemon Squeezy signal | Firestore entitlement mapping | Notes |
| --- | --- | --- |
| `subscription_created` with status `active` | `premium: true`, `status: "active"` | Initial subscription activation. |
| `subscription_updated` with status `active` | `premium: true`, `status: "active"` | Catch-all refresh for active subscription state. |
| `subscription_resumed` with status `active` | `premium: true`, `status: "active"` | Restores access after resume. |
| `subscription_payment_success` | Keep or set `premium: true`, `status: "active"` when subscription/customer UID is known | Prefer subscription object events for final state, but success can refresh active state. |
| `subscription_payment_recovered` | `premium: true`, `status: "active"` | Recovery after failed payment. |
| `subscription_cancelled` with future `ends_at`/period end | `premium: true`, `status: "active"` until `currentPeriodEnd` | Recommended grace: customer retains paid access through current period. Store cancellation marker separately if needed later. |
| `subscription_updated` with status `cancelled` and future `ends_at` | `premium: true`, `status: "active"` until `currentPeriodEnd` | Do not revoke early if paid period remains. |
| `subscription_expired` | `premium: false`, `status: "expired"` | Access ends. |
| `subscription_updated` with status `expired` | `premium: false`, `status: "expired"` | Catch-all expiration. |
| `subscription_payment_failed` | `premium: false`, `status: "past_due"` | Conservative 4F choice unless an explicit grace policy is chosen. |
| `subscription_updated` with status `past_due` or `unpaid` | `premium: false`, `status: "past_due"` | Existing ORS callable enforcement rejects `past_due`. |
| `subscription_payment_refunded` | `premium: false`, `status: "canceled"` or `"expired"` | Do not add `refunded` unless entitlement normalization/tests are updated later. |
| `order_refunded` | `premium: false`, `status: "canceled"` or `"expired"` | Use only when the order/subscription can be tied to the same UID. |
| Unknown signed event | No entitlement change | Log safe summary and return `200`. |

If the product owner wants a grace period for `past_due`, that must be a separate decision because current backend premium checks reject `past_due`.

## 5. Firestore Shape

Use the existing entitlement map shape and avoid adding a new status unless normalization/tests are intentionally expanded:

```js
{
  premium: boolean,
  status: "active" | "manual_active" | "free" | "past_due" | "canceled" | "expired",
  source: "lemon_squeezy",
  providerCustomerId,
  providerSubscriptionId,
  providerOrderId,
  currentPeriodEnd,
  updatedAt,
  lastProviderEventId
}
```

Clarifications:

- `active` and `manual_active` are currently the only premium-allowed statuses.
- `manual_active` remains separate from Lemon Squeezy and should not be overwritten by provider downgrades unless an admin explicitly removes the manual override.
- If adding a new `refunded` status later, update entitlement normalization, ORS enforcement tests, rules expectations, and UI copy first.
- Use Admin SDK server timestamps for `updatedAt`.
- Normalize provider date strings into Firestore timestamps or ISO strings consistently with the existing entitlement plan before implementation.

## 6. Idempotency And Ordering

Plan:

- Store `lastProviderEventId` on `users/{uid}.entitlement`.
- If Lemon Squeezy exposes a stable event ID in the real payload/header, use that.
- If no stable event ID is present, derive a deterministic event ID from signed data, for example a SHA-256 hash of:
  - `meta.event_name`
  - `data.type`
  - `data.id`
  - `data.attributes.status`
  - `data.attributes.updated_at`
  - `data.attributes.ends_at`
  - `data.attributes.renews_at`
  - raw signed body as fallback
- Ignore duplicate event IDs.
- Avoid rewriting entitlement if the computed entitlement state is unchanged.
- Store `providerUpdatedAt` when available in a later hardening slice.
- Out-of-order timestamp protection is not implemented in 4F.1 because the real signed provider timestamp fields still need confirmation.
- Before paid launch, either implement newest-provider-timestamp comparison or explicitly accept Lemon Squeezy event-order behavior based on real test-mode payloads and retry logs.
- Never allow an older provider event to downgrade a newer active state unless the event is a terminal event with a later provider timestamp once ordering fields are confirmed.

## 7. Tests Required

Future function tests should cover:

- Invalid signature rejected.
- Missing signature rejected.
- Valid signature accepted.
- Event parsing happens only after signature verification.
- Active subscription writes `premium: true`, `status: "active"`.
- Subscription updated active writes/refreshes `premium: true`, `status: "active"`.
- Canceled with future period end remains active until `currentPeriodEnd`.
- Expired writes `premium: false`, `status: "expired"`.
- Past due/payment failed writes `premium: false`, `status: "past_due"`.
- Refunded maps to an existing non-premium status.
- Missing `meta.custom_data.firebase_uid` fails safely and writes nothing.
- Malformed UID fails safely and writes nothing.
- Unknown validly signed event is ignored safely.
- Duplicate event ID is ignored.
- Client cannot spoof webhook without valid signature.
- No entitlement write occurs before signature verification.
- Manual override is not downgraded by provider events.
- Test-mode-only guard rejects or ignores live-mode payloads during 4F test mode.

Test mechanics:

- Use fake webhook secret in tests only.
- Generate HMAC signatures in tests with Node `crypto`.
- Use `req.rawBody` fixtures.
- Mock Admin SDK/Firestore writes for handler-level unit tests.
- Do not call Lemon Squeezy in tests.
- Do not use production Firebase data.

## 8. Expected Implementation Files Later

Likely files for 4F.1/4F.2:

- `functions/index.js`
  - Add `lemonSqueezyWebhook` HTTPS function.
  - Add signature verification helper.
  - Add event parsing and entitlement mapping helpers.
  - Add test exports only under `NODE_ENV === "test"`.
- `functions/tests/lemonsqueezy-webhook.test.js`
  - Handler-level tests with fake raw bodies, fake signatures, and mocked Firestore.
- `functions/package.json`
  - Update test script so ORS, checkout, and webhook tests run.
- Plan docs
  - Update 4F status after implementation/QC.

Not expected:

- No frontend files.
- No checkout buttons.
- No paywall modal.
- No Firebase rules changes.
- No ORS callable changes.
- No deployed functions in implementation PR unless explicitly approved.

## 9. Secret Setup

Required before deploying 4F webhook function:

```bash
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
```

Already required by 4E checkout function:

```bash
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
```

Do not commit either secret. Do not paste either secret into docs, tests, logs, snapshots, or frontend code.

## 10. Stop Lines

- Do not deploy.
- Do not add frontend buttons.
- Do not add paywall modal.
- Do not collect live money.
- Do not use live mode.
- Do not unlock premium from checkout success URL.
- Do not trust unsigned webhook data.
- Do not parse event data before signature verification.
- Do not write entitlement from client.
- Do not weaken Firestore rules.
- Do not change ORS entitlement enforcement.
- Do not overwrite manual entitlement overrides without an explicit admin decision.

## 11. PR Breakdown

- 4F plan only.
- 4F.1 webhook function + raw-body signature verification tests: implemented locally.
- Entitlement mapping + idempotency tests: implemented locally as part of 4F.1.
- 4F.2 real test-mode payload capture and provider ordering decision: planned in `plans/PHASE_4F2_LEMONSQUEEZY_WEBHOOK_PAYLOAD_CAPTURE_PLAN.md`.
- 4F.3 test-mode capture deploy gate: planned in `plans/PHASE_4F3_LEMONSQUEEZY_TESTMODE_CAPTURE_GATE.md`.
- 4F.4 test-mode webhook smoke with finalized payload-path/order handling: remaining.
- 4G frontend paywall modal/buttons later.

## Return Summary

Recommended webhook function name: `lemonSqueezyWebhook`.

Required Lemon Squeezy setup values:

- Test-mode webhook callback URL.
- `LEMONSQUEEZY_WEBHOOK_SECRET`.
- Test-mode event subscriptions.
- Confirmation that `meta.custom_data.firebase_uid` appears in subscription/order webhook payloads from 4E checkouts.
- Test-mode payload samples for active, canceled, expired, past due/payment failed, and refund paths.

Expected files:

- `functions/index.js`
- `functions/tests/lemonsqueezy-webhook.test.js`
- `functions/package.json`
- Plan docs

Blockers:

- No deployed webhook endpoint exists yet.
- `LEMONSQUEEZY_WEBHOOK_SECRET` is not set.
- Real Lemon Squeezy test-mode payload paths must be confirmed before paid launch.
- Frontend paywall and payment-state UX remain future work.
- No live-money collection until webhook verification, entitlement updates, frontend UX, refund/cancel behavior, and final smoke pass.

Ready to implement 4F.1: YES; local mocked implementation and tests are complete.

Ready to deploy or collect money: NO.
