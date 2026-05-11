# Phase 4F.3 Lemon Squeezy Test-Mode Capture Gate

Date: 2026-05-03

Status: planning only. Do not edit runtime app code, Functions code, frontend code, Firestore rules, payment UI, or deploy configuration in this phase. Do not set secrets, deploy, add checkout buttons, use live mode, or collect money.

Readiness verdict: NOT READY to execute capture yet. This gate defines the exact approval checklist for later deploying only `createCheckoutSession` and `lemonSqueezyWebhook` long enough to capture Lemon Squeezy test-mode webhook payload shapes safely.

## 1. Current State

- Phase 4E `createCheckoutSession` exists locally.
- Phase 4F.1 `lemonSqueezyWebhook` exists locally.
- Phase 4F.1 webhook handler has mocked tests for signature verification, entitlement mapping, idempotency, ignored paths, and manual override protection.
- Phase 4F.2 payload capture plan exists in `plans/PHASE_4F2_LEMONSQUEEZY_WEBHOOK_PAYLOAD_CAPTURE_PLAN.md`.
- Real Lemon Squeezy test-mode payload field paths are not confirmed yet.
- Out-of-order provider timestamp handling is not finalized.
- No frontend checkout button, paywall modal, or payment UI exists.
- Checkout success URL still must not unlock premium.
- No live money should be collected.

## 2. Capture Deploy Gate Checklist

Do not proceed unless every item is true:

- Maintainer explicitly approves a test-mode capture deploy.
- Correct Firebase project/alias is selected and visible in terminal output.
- Lemon Squeezy dashboard is in test mode.
- Lemon Squeezy product/variant being used is the test-mode annual variant.
- `LEMONSQUEEZY_API_KEY` is a test-mode API key.
- `LEMONSQUEEZY_WEBHOOK_SECRET` is a test-mode webhook signing secret.
- No secrets are pasted into chat, docs, code, logs, snapshots, or commits.
- No frontend checkout button exists or links users to checkout.
- No live-mode checkout or live product URL is used.
- No raw payload capture files are staged.
- No debug logs, storage-state files, `.secret.local`, or test artifacts are staged.
- This deploy is limited to `createCheckoutSession` and `lemonSqueezyWebhook`.

## 3. Required Pre-Capture Checks

Run before any deploy approval. These commands are required verification, not optional polish:

```bash
npm --prefix functions test
npm run test:functions:emulator
npm run test:rules
npm run test:e2e:smoke
git status --short
git diff --check
```

Expected results:

- Function tests pass.
- Callable emulator tests pass.
- Firestore rules tests pass.
- E2E smoke passes or any skip is explicitly classified as environment/setup and approved.
- `git status --short` contains only approved changes.
- `git diff --check` passes.

## 4. Secret Setup Commands

Documented for later only. Do not run in this planning task.

```bash
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
```

Secret handling rules:

- Do not paste secrets into chat.
- Do not write secrets into docs.
- Do not commit secrets.
- Do not echo secrets in logs.
- Do not use live-mode keys.
- Do not store secrets in frontend files.
- Do not store secrets in `.env`, `.secret.local`, screenshots, or snapshots that can be committed.

## 5. Candidate Deploy Commands

Documented for later only. Do not run in this planning task.

```bash
firebase use <correct-project-alias>
firebase deploy --only functions:createCheckoutSession,functions:lemonSqueezyWebhook
```

Deployment constraints:

- Do not deploy all functions.
- Do not deploy Firestore rules in this capture slice.
- Do not deploy hosting/frontend.
- Do not deploy payment UI.
- Do not deploy live-mode provider settings.
- Do not deploy if the selected Firebase target is uncertain.

## 6. Lemon Squeezy Dashboard Setup

After the approved capture deploy:

1. In Lemon Squeezy, confirm test mode is enabled.
2. Create a test-mode webhook for the BARK Ranger store.
3. Use the deployed HTTPS URL for `lemonSqueezyWebhook`, likely:
   - `https://<region>-<project>.cloudfunctions.net/lemonSqueezyWebhook`
4. Configure the test-mode webhook signing secret used in `LEMONSQUEEZY_WEBHOOK_SECRET`.
5. Subscribe to required events:
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
   - `subscription_expired`
   - `subscription_payment_success`
   - `subscription_payment_failed`
   - `subscription_payment_recovered`
   - `subscription_payment_refunded`
   - `order_refunded`
   - Optional `order_created`
6. Use webhook simulator, resend, and test-purchase flows where available.
7. Do not use live mode.
8. Do not use real card details.
9. Do not expose a public checkout button.

## 7. Capture Safety Process

Payload capture rules:

- Save raw payloads outside the repo.
- Never commit full raw payloads containing email, customer, address, receipt, checkout, tax, payment, or provider-account data.
- Never commit `X-Signature`.
- Never commit webhook secret.
- Never commit Lemon Squeezy API key.
- Prefer sanitized field-path notes in docs over committed fixtures.
- Commit sanitized fixtures only if they are needed for durable regression tests.
- Redact email, names, receipt URLs, checkout URLs, signatures, customer identifiers, and any provider IDs that can identify a real person.
- Keep test-only user data clearly fake.
- Delete or archive raw local captures after sanitized notes/tests are produced.

Safe capture notes should record only:

- Event names.
- Field paths.
- Whether expected fields are present.
- Safe synthetic IDs or redacted provider IDs.
- Mapping decision.
- Ordering/timestamp decision.

## 8. Payload Field Checklist

For every captured payload, confirm:

- Event name path.
- Event ID path.
- `firebase_uid` path.
- Customer ID path.
- Subscription ID path.
- Order ID path.
- Status path.
- `renews_at`, `ends_at`, or `current_period_end` path.
- `updated_at` or provider timestamp path.
- `test_mode` path.
- `store_id` path.
- Custom data shape.
- `X-Event-Name` behavior.
- `X-Signature` behavior.
- Whether the payload matches 4F.1 mocked test assumptions.
- Whether simulator payloads differ from real test-purchase payloads.

Minimum event matrix:

| Event | Field-path confirmation | Entitlement relevance |
| --- | --- | --- |
| `subscription_created` | Required | Initial active grant. |
| `subscription_updated` active | Required | Catch-all active refresh. |
| `subscription_cancelled` | Required | Grace-period/period-end behavior. |
| `subscription_expired` | Required | Revocation after end. |
| `subscription_payment_success` | Required | Successful payment/invoice path. |
| `subscription_payment_failed` | Required | Past-due path. |
| `subscription_payment_recovered` | Required if available | Recovery active path. |
| `subscription_payment_refunded` | Required if available | Refund revocation path. |
| `order_refunded` | Required if applicable | Order-level refund path. |
| `order_created` | Optional | Companion order/custom-data validation. |

## 9. Out-Of-Order Decision Gate

Do not proceed to public/paid launch until one of these decisions is implemented and tested:

### Preferred Decision

If reliable provider timestamps exist:

- Extract provider timestamp from real payload field paths.
- Store it as `providerUpdatedAt`.
- Keep `lastProviderEventId` for exact duplicate suppression.
- Ignore older events that would downgrade newer provider state.
- Allow terminal downgrades only when their provider timestamp is newer than stored provider state.

### Fallback Decision

If only subscription object `updated_at` exists:

- Use subscription `updated_at` for subscription-object events.
- Treat invoice/order events as refresh signals unless they include reliable timestamps.
- Prefer subscription state over older invoice/order events for final entitlement.

### Blocker Decision

If no reliable timestamp exists:

- Add a provider lookup fallback before live use, or
- Explicitly accept idempotency-only risk for a private beta test-mode capture only.

Hard rule:

- Do not public/paid launch with stale terminal events able to downgrade newer active state.

## 10. Post-Capture Implementation Follow-Up

Expected later slice after capture:

- Update `functions/index.js` if real payload paths differ from current assumptions.
- Add provider timestamp extraction.
- Add stale-event guard.
- Update `functions/tests/lemonsqueezy-webhook.test.js`.
- Add sanitized fixtures or field-shape tests if useful.
- Add provider ordering tests.
- Re-run:

```bash
node --check functions/index.js
node --check functions/tests/lemonsqueezy-webhook.test.js
npm --prefix functions test
npm run test:functions:emulator
npm run test:rules
npm run test:e2e:smoke
git diff --check
```

Do not proceed to frontend paywall until webhook payload paths and entitlement writes are verified.

## 11. Stop Lines

- Do not deploy in this planning task.
- Do not set secrets in this planning task.
- Do not add frontend paywall.
- Do not add checkout buttons.
- Do not collect live money.
- Do not use live mode.
- Do not deploy all functions.
- Do not commit raw sensitive payloads.
- Do not weaken signature verification.
- Do not unlock premium from success URL.
- Do not trust client payment state.
- Do not proceed to frontend paywall until webhook payload paths and entitlement writes are verified.

## 12. Return Summary

Capture/deploy gate checklist:

- All tests pass.
- Correct Firebase project confirmed.
- Test-mode Lemon Squeezy confirmed.
- Test-mode secrets ready.
- Explicit deploy approval given.
- Deploy limited to `createCheckoutSession` and `lemonSqueezyWebhook`.
- Raw payload handling stays outside git.

Exact later commands, DO NOT RUN YET:

```bash
npm --prefix functions test
npm run test:functions:emulator
npm run test:rules
npm run test:e2e:smoke
git status --short
git diff --check
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
firebase use <correct-project-alias>
firebase deploy --only functions:createCheckoutSession,functions:lemonSqueezyWebhook
```

Dashboard setup checklist:

- Create test-mode webhook.
- Point it to deployed `lemonSqueezyWebhook`.
- Subscribe to required subscription/payment/refund events.
- Use simulator, resend, and test purchases.
- Keep live mode off.

Safe payload capture rules:

- Raw payloads outside repo.
- Sanitized field-path notes only unless fixtures are explicitly needed.
- No secrets, signatures, emails, customer data, payment data, or raw provider payloads in commits.

Out-of-order decision criteria:

- Use `providerUpdatedAt` if reliable timestamp exists.
- Use subscription `updated_at` carefully if it is the only timestamp.
- Add provider lookup fallback or block paid launch if no reliable timestamp exists.

Ready to execute capture: NO, not during this planning task. Ready after explicit approval, clean pre-checks, confirmed test-mode secrets, and safe payload handling: YES.
