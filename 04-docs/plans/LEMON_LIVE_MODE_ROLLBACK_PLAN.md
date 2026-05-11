# Lemon Squeezy Live-Mode Rollback Plan

Date: 2026-05-09
Status: rollback plan only. Lemon remains test-mode locked today.

## 1. Rollback Principle

If live checkout, webhook, entitlement, coupon, cancellation, or refund behavior is wrong, stop new paid checkouts first. Preserve existing user account access while investigating.

## 2. Immediate Kill Switches

Server-side:

```bash
BARK_ENABLE_CHECKOUT=false
```

This blocks `createCheckoutSession` before a Lemon API call.

App-side:

```js
checkoutEnabled: false
```

This disables the upgrade UI before Lemon redirect after a Hosting deploy.

## 3. Rollback Scenarios

| Scenario | Action |
|---|---|
| Live checkout creates orders but webhook fails | Disable checkout, keep webhook endpoint online, inspect Lemon delivery logs, replay only after fix. |
| Webhook grants wrong entitlement | Disable checkout, patch mapping, manually repair affected users after Carter review. |
| Coupon/discount mispriced | Disable or expire Lemon discount in Lemon dashboard immediately, then disable app checkout if needed. |
| Refund/expired does not remove Premium | Disable checkout, patch webhook state test, manually correct affected user docs. |
| Cancelled-but-active loses access early | Disable checkout, patch `cancelled_active` mapping, repair affected docs. |
| Customer portal URL broken | Keep checkout disabled if cancellations/refunds would be unsupported; patch portal lookup or provide support process. |
| Wrong live variant/product | Disable checkout, fix live IDs/config, void/refund any mistaken orders. |

## 4. Logs To Watch During Rollback

- `createCheckoutSession`
- `lemonSqueezyWebhook`
- Lemon dashboard webhook deliveries
- Firestore user entitlement writes
- support inbox
- refunds/cancellations/orders in Lemon dashboard

## 5. User Messaging

Use plain language:

> Premium checkout is paused while we verify billing. If you already checked out, your account will be reviewed and corrected manually if needed.

For refund/cancel issue:

> We are reviewing your Premium billing state manually. Your account and map progress are safe.

## 6. Repair Process

For every affected user:

1. Record Firebase UID, email, Lemon customer/order/subscription IDs, event IDs, and timestamps.
2. Compare Lemon dashboard state to Firestore `users/{uid}.entitlement`.
3. Apply the smallest server/admin repair.
4. Document why the repair was made.
5. Confirm account UI and premium tools match the intended state.

Do not ask users to create a second account to work around billing bugs.

## 7. Re-Open Criteria

Re-enable live checkout only after:

- failed path has a regression test,
- function suite passes,
- webhook fixture passes,
- one live or test replay confirms the fix,
- Carter approves reopening.
