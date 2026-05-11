# Lemon Squeezy Live-Mode RC Checklist

Date: 2026-05-09
Status: release-candidate plan only. Do not switch live mode from this checklist.

## 1. Hard Lock Status

Current code remains locked to Lemon Squeezy test mode:

- `functions/index.js` builds checkout payloads with `attributes.test_mode: true`.
- `functions/index.js` ignores webhook payloads where `attributes.test_mode !== true`.
- `getLemonSqueezyModeConfig()` names the lock and exposes the future approval env var, but current behavior still fails closed to test mode.
- Carter approval remains required before any live-mode code/config change.

## 2. Code Paths Audited

| Area | Current file/path | Current behavior |
|---|---|---|
| Checkout payload | `functions/index.js` `buildLemonSqueezyCheckoutPayload()` | Forces `test_mode: true`. |
| Checkout callable | `functions/index.js` `handleCreateCheckoutSession()` | Requires verified auth, sanitizes optional `discountCode`, calls Lemon checkouts API. |
| Webhook mode gate | `functions/index.js` `mapLemonSqueezyEntitlement()` | Ignores non-test-mode payloads with `reason: non_test_mode`. |
| API key | `functions/index.js` `getLemonSqueezyConfig()` | Reads `LEMONSQUEEZY_API_KEY` secret/env. |
| Webhook secret | `functions/index.js` `getLemonSqueezyWebhookSecret()` | Reads `LEMONSQUEEZY_WEBHOOK_SECRET` secret/env. |
| Store ID | `functions/index.js` constants | Locked to `363425`. |
| Annual variant ID | `functions/index.js` constants | Locked to `1604336`. |
| Customer portal | `functions/index.js` `handleGetCustomerPortalUrl()` | Fetches signed `customer_portal` URL from Lemon subscription API. |
| Coupons | `functions/index.js` checkout payload | Optional sanitized `discountCode` passes to `checkout_data.discount_code`; normal users enter coupons on Lemon checkout. |
| Webhook state machine | `functions/index.js` Lemon mapping/processing helpers | Durable idempotency, event ordering, cancellation, refund, expired, past_due handling. |

## 3. Live-Mode Switch Preconditions

Do not begin live-mode RC until all are true:

- [ ] Carter explicitly approves the final live-mode RC switch.
- [ ] Legal/privacy/terms/refund/support drafts are approved or accepted for launch risk.
- [ ] Budget alerts are configured.
- [ ] Monitoring dashboards are ready.
- [ ] Rollback/kill switch playbook is reviewed.
- [ ] Lemon live store/product/variant IDs are confirmed.
- [ ] Lemon live API key is available as a Firebase/Secret Manager secret.
- [ ] Lemon live webhook signing secret is available as a Firebase/Secret Manager secret.
- [ ] Lemon live webhook endpoint is configured in Lemon dashboard.
- [ ] Lemon live discounts/coupons are created in live mode if needed.
- [ ] App Check decision is made: enforced, staged, or consciously deferred.
- [ ] Current test-mode suites pass.

## 4. Code Change Required Later

When Carter approves live mode, make a controlled RC patch that:

1. Changes checkout mode only through a centralized Lemon mode config.
2. Requires exact approval value `BARK_LEMON_LIVE_MODE_APPROVAL=CARTER_APPROVED_LIVE_RC`.
3. Requires live API key and live webhook secret to be present.
4. Requires live store and variant IDs to be explicitly configured or confirmed.
5. Accepts live webhooks only when live checkout is also enabled.
6. Keeps test-mode tests proving the old lock cannot accidentally drift.
7. Adds live-mode tests with fixture payloads before deploy.

Do not edit random literals directly. Use the central Lemon mode helper.

## 5. Manual Dashboard Checks

In Lemon Squeezy live dashboard:

- [ ] Store identity and merchant details are correct.
- [ ] Premium product is correct.
- [ ] Annual variant price is correct.
- [ ] Discount field is enabled on hosted checkout.
- [ ] Admin/mod/VIP/support coupons are live-mode discounts if needed.
- [ ] Refund/cancellation language is correct.
- [ ] Webhook URL points to production Firebase Function endpoint.
- [ ] Webhook events include subscriptions, payments, refunds, cancellation, expiration, and recovery events.
- [ ] Webhook signing secret matches Firebase secret.

In Firebase/GCP:

- [ ] Live API secret is set.
- [ ] Live webhook secret is set.
- [ ] Functions deploy target is the production project.
- [ ] Firestore rules are the expected version.
- [ ] Hosting points to the expected commit.
- [ ] Logs Explorer query for `lemonSqueezyWebhook` is saved.

## 6. Final Go / No-Go

Live mode is **NO-GO** if any of these are true:

- Carter has not explicitly approved the switch.
- checkout still points to test secrets with live mode enabled.
- webhook accepts live events but checkout is still test mode.
- live checkout works but webhook does not grant Premium.
- refund/expired/cancelled fixtures fail.
- support/refund/contact docs are not ready.
- budget alerts are missing.

Live mode is **GO for RC smoke only** when all preconditions pass and Carter is present to watch the real test transaction.
