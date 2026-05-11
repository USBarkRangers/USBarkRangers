# Phase 4F.2 Lemon Squeezy Webhook Payload Capture Plan

Date: 2026-05-03

Status: planning only. Do not edit runtime app code, Functions code, frontend code, Firestore rules, payment UI, or deploy configuration in this phase. Do not set secrets, deploy, add buttons, use live mode, or collect money.

Readiness verdict: NOT READY to deploy/capture yet. Capture becomes ready only after explicit maintainer approval, correct Firebase target confirmation, test-mode secrets are set, and the maintainer confirms that temporary payload handling will not commit raw customer/payment data.

Phase 4F.3 capture deploy gate:

- The deploy/capture approval checklist is documented in `plans/PHASE_4F3_LEMONSQUEEZY_TESTMODE_CAPTURE_GATE.md`.
- Do not set secrets or deploy capture functions until that gate is explicitly approved.

## 1. Current State

- Phase 4E `createCheckoutSession` exists locally and creates Lemon Squeezy test-mode checkout URLs from a backend callable.
- `createCheckoutSession` trusts only `context.auth.uid`, forces store ID `363425`, annual variant ID `1604336`, and writes `checkout_data.custom.firebase_uid`.
- Phase 4F.1 `lemonSqueezyWebhook` exists locally as a Firebase HTTPS function.
- The webhook handler has mocked tests for raw-body `X-Signature` verification, entitlement mapping, idempotency, ignored events, and manual override preservation.
- Checkout success URL does not unlock premium.
- No frontend checkout buttons or payment UI exist yet.
- Deployment is blocked until real Lemon Squeezy test-mode payloads confirm field paths.
- Out-of-order provider timestamp protection is incomplete; 4F.1 has duplicate event ID protection but no newest-provider-timestamp comparison.

## 2. Source Notes

Official Lemon Squeezy docs used to shape this plan:

- Webhooks are POST requests that include `Content-Type: application/json`, `X-Event-Name`, and `X-Signature`, and successful handling should return `200` to avoid retries.
- Lemon Squeezy signs the raw payload with the webhook signing secret and sends the HMAC digest in `X-Signature`.
- Custom checkout data appears in webhook payloads under `meta.custom_data` for order, subscription, and license-key events.
- Test mode supports checkout flow, subscriptions, webhooks, API integrations, and test cards without live transactions.
- Test-mode webhook simulation supports subscription and order events, and test and live mode webhooks are separate.

References:

- https://docs.lemonsqueezy.com/help/webhooks/webhook-requests
- https://docs.lemonsqueezy.com/help/webhooks/signing-requests
- https://docs.lemonsqueezy.com/help/webhooks/event-types
- https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events
- https://docs.lemonsqueezy.com/help/checkout/passing-custom-data
- https://docs.lemonsqueezy.com/help/getting-started/test-mode

## 3. Required Secrets And Setup Later

Documented for later only. Do not run in this planning phase.

```bash
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
```

Later deploy command, after explicit approval only:

```bash
firebase deploy --only functions:createCheckoutSession,functions:lemonSqueezyWebhook
```

Preconditions before running either command later:

- Correct Firebase project alias is selected and printed in the terminal.
- Lemon Squeezy dashboard is in test mode.
- API key is a test-mode key.
- Webhook signing secret is newly generated and not pasted into docs, tests, logs, snapshots, or chat.
- No live product checkout is used.
- No frontend button or public route points users into checkout.

## 4. Test-Mode Webhook Endpoint Setup

Later capture sequence, after explicit approval only:

1. Run the full local verification set:
   - `npm --prefix functions test`
   - `npm run test:functions:emulator`
   - `npm run test:rules`
   - `git diff --check`
2. Confirm there are no staged debug logs, storage-state files, raw payload captures, `.secret.local`, or secrets.
3. Select the approved Firebase target:

```bash
firebase use <correct-project-alias>
```

4. Set test-mode secrets using the commands in section 3.
5. Deploy only the checkout and webhook functions with the section 3 deploy command.
6. Copy the deployed HTTPS endpoint for `lemonSqueezyWebhook`, likely:
   - `https://<region>-<project>.cloudfunctions.net/lemonSqueezyWebhook`
7. In Lemon Squeezy test mode, create a webhook pointing at that endpoint.
8. Subscribe to the required test-mode events:
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
   - Optionally `order_created`, because subscription creation can send it alongside subscription events.
9. Use Lemon Squeezy webhook simulation/resend tools and test purchases only.
10. Do not use live mode, real card details, live product URLs, or public checkout buttons.

## 5. Payloads Needed

Capture safe, redacted samples for each event family that can affect entitlement:

| Payload | Required? | Why |
| --- | --- | --- |
| `subscription_created` | Yes | Proves initial active subscription shape and `firebase_uid` propagation. |
| `subscription_updated` active | Yes | Proves catch-all active refresh shape. |
| `subscription_cancelled` | Yes | Proves grace-period fields such as `ends_at` and cancellation semantics. |
| `subscription_expired` | Yes | Proves final expiration shape. |
| `subscription_payment_success` | Yes | Proves invoice payment success object shape and subscription/customer IDs. |
| `subscription_payment_failed` | Yes | Proves past-due/payment-failure object shape. |
| `subscription_payment_recovered` | Yes if simulator/test flow supports it | Proves recovery from payment failure. |
| `subscription_payment_refunded` | Yes if simulator/test flow supports it | Proves subscription invoice refund shape. |
| `order_refunded` | Yes if applicable | Proves order refund shape and whether subscription linkage is present. |
| `order_created` | Helpful | Confirms companion order event behavior and custom data propagation. |

For each payload, record these field paths in a private capture checklist:

- Event name path: `meta.event_name` and `X-Event-Name`.
- Event ID path: `meta.event_id`, `meta.webhook_event_id`, `meta.id`, or another stable provider ID if present.
- Custom UID path: expected `meta.custom_data.firebase_uid`.
- Customer ID path.
- Subscription ID path.
- Order ID path.
- Status path.
- Period end paths: `renews_at`, `ends_at`, `trial_ends_at`, and any current-period field.
- Provider timestamp paths: `updated_at`, `created_at`, invoice timestamp, or event timestamp.
- Test-mode path and value.
- Store ID path and value.
- Signature header behavior.
- Whether `subscription_updated` arrives with the same or newer timestamp after each lifecycle event.
- Whether webhook simulator payloads differ from real test-purchase payloads.

## 6. Safe Capture Process

Recommended capture approach:

1. Use a dedicated test Firebase user and a dedicated Lemon Squeezy test-mode checkout.
2. Prefer real test-mode checkout and webhook deliveries for active/payment success/custom UID confirmation.
3. Use simulator/resend for lifecycle events that are hard to produce manually, such as expiration, recovery, or refund.
4. Inspect payloads in the Lemon Squeezy delivery UI or a temporary private capture tool only if needed.
5. Save raw payloads outside the repo, for example under a local ignored scratch directory or secure notes.
6. Redact before any fixture is committed:
   - emails
   - names
   - addresses
   - receipt URLs
   - checkout URLs
   - card/payment references
   - signatures
   - webhook signing secret
   - API key
   - order identifiers if they can identify a real customer
7. Commit only sanitized fixtures if they are necessary for durable tests.
8. Keep local capture files out of git.
9. Remove or rotate any temporary capture endpoint after payload capture.

Safe log policy:

- Do not log raw payloads in production function logs.
- Do not log `X-Signature`.
- Do not log secrets or Authorization headers.
- Log only event name, derived/safe event ID, test-mode flag, store ID, uid presence, and mapping decision.
- If a temporary capture branch is needed, guard it behind an explicit test/capture flag and remove it before any paid-launch deploy.

## 7. Out-Of-Order Decision

Recommended decision rule after payload capture:

1. If real payloads include a reliable provider event timestamp and stable event ID:
   - Store `lastProviderEventId`.
   - Store `providerUpdatedAt`.
   - Ignore exact duplicate event IDs.
   - Ignore older provider events that would downgrade a newer state.
2. If payloads include only object timestamps such as subscription `updated_at`:
   - Use `data.attributes.updated_at` for subscription-object events.
   - Use invoice/order timestamp only when mapping invoice/order events.
   - Prefer a later subscription `updated_at` over earlier invoice/order events for final state.
3. If no reliable timestamp exists:
   - Keep idempotency only.
   - Do not deploy paid launch until the risk is explicitly accepted or a provider lookup fallback is added.
4. Do not let older `expired`, `canceled`, `past_due`, or refund events downgrade newer active state.
5. Terminal events may downgrade only when their provider timestamp is newer than the stored provider state, or when a provider lookup confirms the subscription is currently terminal.
6. Preserve `manual_active` admin override regardless of provider ordering unless an admin explicitly removes the override.

Recommended implementation after capture:

- Add `providerUpdatedAt` to the entitlement map for Lemon Squeezy-sourced entitlements.
- Compare provider timestamps before writes.
- Keep `updatedAt` as the server write timestamp.
- Keep `currentPeriodEnd` as the provider period/grace timestamp.
- If a terminal event is older than stored active provider state, return `200` with ignored reason such as `stale_event`.
- If timestamps are missing or unparsable, fail closed for downgrades and log a safe summary for manual review.

## 8. Implementation PR After Capture

Expected later files:

- `functions/index.js`
  - Add provider timestamp extraction.
  - Add stale-event guard.
  - Possibly refine event ID path extraction from real payloads.
- `functions/tests/lemonsqueezy-webhook.test.js`
  - Add real-shape sanitized fixtures and ordering tests.
- `functions/tests/fixtures/lemonsqueezy/*.json`
  - Optional sanitized fixtures only; raw payloads must not be committed.
- Plan docs
  - Update capture results, field path decisions, and deploy readiness.

Do not include:

- Frontend checkout buttons.
- Paywall modal.
- Firebase rules changes.
- ORS changes.
- Live-mode provider configuration.
- Raw payloads, signatures, receipt URLs, customer emails, or secrets.

## 9. Tests After Payload Capture

Add or update tests for:

- Real captured active subscription shape.
- Real captured canceled-with-future-period shape.
- Real captured expired shape.
- Real captured failed/past-due shape.
- Real captured refund shape if available.
- Real captured custom data path for `firebase_uid`.
- Event name path from both body and header.
- Stable event ID path from real payloads.
- Provider timestamp extraction from real payloads.
- Out-of-order active vs expired.
- Out-of-order active vs failed/past_due.
- Out-of-order resumed/recovered vs stale terminal event.
- Duplicate event ID.
- Missing timestamp fallback behavior.
- Store mismatch ignored.
- Test-mode false ignored during test-mode phase.
- `manual_active` admin override not downgraded.
- No entitlement write before signature verification.

Verification after implementation:

```bash
node --check functions/index.js
node --check functions/tests/lemonsqueezy-webhook.test.js
npm --prefix functions test
npm run test:functions:emulator
npm run test:rules
git diff --check
```

## 10. Stop Lines

- Do not collect live money.
- Do not add frontend paywall buttons.
- Do not add payment UI.
- Do not deploy until explicit approval.
- Do not set secrets in this planning phase.
- Do not commit secrets.
- Do not commit raw sensitive payloads.
- Do not weaken signature verification.
- Do not parse unsigned webhook data.
- Do not write entitlement from the client.
- Do not unlock premium on success URL.
- Do not trust email, customer ID, subscription ID, order ID, or client data as Firebase UID.
- Do not let stale provider events downgrade newer provider state without a documented ordering decision.

## 11. Blockers

- Explicit approval is required before any secret setup or deploy.
- `LEMONSQUEEZY_API_KEY` and `LEMONSQUEEZY_WEBHOOK_SECRET` are not confirmed as set in Firebase Functions.
- No deployed webhook endpoint exists for capture.
- No safe redacted payload capture has been completed.
- Real event ID and provider timestamp paths are not confirmed.
- Out-of-order handling is not implemented.
- Frontend paywall/checkout UX remains future work.
- No live-money collection is allowed until webhook, ordering, frontend UX, cancel/refund, and final smoke all pass.

## 12. Return Summary

Payloads needed:

- `subscription_created`
- `subscription_updated` active
- `subscription_cancelled`
- `subscription_expired`
- `subscription_payment_success`
- `subscription_payment_failed`
- `subscription_payment_recovered`
- `subscription_payment_refunded`
- `order_refunded`
- Optional `order_created`

Safe capture process:

- Use test mode only.
- Deploy only approved backend functions.
- Capture raw samples outside git.
- Redact before committing any fixtures.
- Commit only sanitized fixture shapes needed for tests.

Exact later commands, DO NOT RUN YET:

```bash
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
firebase deploy --only functions:createCheckoutSession,functions:lemonSqueezyWebhook
```

Out-of-order strategy recommendation:

- Implement `providerUpdatedAt` comparison if real payloads expose reliable timestamps.
- Prefer newest provider state.
- Treat stale terminal downgrades as ignored.
- Keep idempotency by event ID.
- If no reliable timestamp exists, add a provider lookup fallback or explicitly block paid launch.

Ready to implement/deploy capture: NO, not during this planning task. Ready after explicit approval and test-mode setup: YES.
