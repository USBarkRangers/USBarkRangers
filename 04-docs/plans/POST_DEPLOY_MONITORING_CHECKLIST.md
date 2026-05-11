# BARK Ranger Map Post-Deploy Monitoring Checklist

Date: 2026-05-09
Status: release-day monitoring checklist.
Scope: broader controlled release and paid-public readiness.

## 1. First 15 Minutes

- [ ] Production app loads.
- [ ] Public pins load.
- [ ] Local search works.
- [ ] No fatal browser console errors on public map.
- [ ] Firebase Auth sign-in loads account state.
- [ ] Free account shows 5-visited-place limit.
- [ ] Premium/test entitlement account shows premium tools.
- [ ] Lemon checkout opens in test mode.
- [ ] Lemon coupon is entered on Lemon checkout, not in the app.
- [ ] Firestore rules deploy is the expected version.
- [ ] Functions deploy is the expected version.
- [ ] Hosting deploy is the expected version.

## 2. Firestore Metrics

Firebase Console -> Firestore Database -> Usage:

- [ ] Reads by hour look normal.
- [ ] Writes by hour look normal.
- [ ] Deletes by hour look normal.
- [ ] No sudden sustained read spike after deploy.
- [ ] No sudden sustained write spike after deploy.
- [ ] No permission-denied flood from normal app use.

Watch these paths/features:

- `users/{uid}`
- `users/{uid}/savedRoutes`
- `users/{uid}/achievements`
- `leaderboard/{uid}`
- `_premiumCallableRateLimits`
- Lemon webhook processed-event storage
- feedback path, if enabled

## 3. Functions Metrics

Firebase Console -> Functions:

For each function, check invocations, errors, latency, and logs:

- [ ] `createCheckoutSession`
- [ ] `lemonSqueezyWebhook`
- [ ] `getPremiumRoute`
- [ ] `getPremiumGeocode`
- [ ] `syncLeaderboardScore`

Action thresholds:

- Any sustained 5xx/error spike: inspect logs immediately.
- Any ORS spike: consider route/geocode kill switches.
- Any webhook retry loop: pause checkout until entitlement impact is known.
- Any checkout spike without webhook completions: inspect Lemon dashboard and support inbox.

## 4. Payment And Entitlement Monitoring

Lemon Squeezy:

- [ ] Checkout starts appear in Lemon test mode.
- [ ] Discount/coupon attempts behave as expected.
- [ ] Test subscriptions/orders generate webhook events.
- [ ] Webhooks are delivered with success responses.
- [ ] No live-mode events are accepted while lock is active.

Firebase/logs:

- [ ] `createCheckoutSession` has no unexpected Lemon API errors.
- [ ] `lemonSqueezyWebhook` accepts valid test-mode signed events.
- [ ] invalid signatures are rejected.
- [ ] variant/store/product mismatches are rejected.
- [ ] duplicate events are idempotent.
- [ ] entitlement downgrades are expected and explainable.

Watch statuses:

- active subscription,
- cancelled with future access end,
- expired,
- refunded,
- past due/payment failed,
- payment recovered/resumed.

## 5. Coupon And Discount Watch

Expected current model:

- All user-facing codes are Lemon Squeezy discounts.
- Users enter coupons on Lemon checkout.
- App does not show a user-facing Promo / Access Code field.
- Premium activates only after Lemon webhook confirmation.

After deploy:

- [ ] Test checkout page shows or applies discount behavior in Lemon test mode.
- [ ] A known valid test coupon applies in Lemon checkout.
- [ ] invalid coupon produces Lemon's checkout error, not app Premium.
- [ ] 100%-off Lemon test coupon still requires webhook confirmation before Premium.
- [ ] Manage Billing appears only for Lemon subscription users with billing data.

## 6. Route And Geocode Monitoring

Watch:

- [ ] `getPremiumRoute` invocation count.
- [ ] `getPremiumRoute` errors.
- [ ] `getPremiumGeocode` invocation count.
- [ ] `getPremiumGeocode` errors.
- [ ] rate-limit denials.
- [ ] ORS network/API errors.

Confirm:

- Signed-out users are rejected before external ORS call.
- Free users are rejected before external ORS call.
- Unverified email users are rejected where policy requires.
- Premium/test users under limit succeed.
- Over-limit users are blocked with safe messages.
- Kill switches stop calls even for premium users.

## 7. Leaderboard Monitoring

Watch:

- [ ] Initial leaderboard load.
- [ ] See More when enabled.
- [ ] `syncLeaderboardScore` invocations.
- [ ] `syncLeaderboardScore` errors.
- [ ] Firestore leaderboard reads.
- [ ] exact-rank behavior if used.

Confirm:

- Clients cannot write fake leaderboard totals.
- Server-authoritative sync still updates legitimate user scores.
- Signed-out leaderboard view works.

## 8. Support Inbox Review

Track each report with:

- time,
- user email if provided,
- account type: signed-out/free/premium/test,
- device/browser,
- exact action,
- screenshot/video if available,
- whether console error appeared,
- whether Firebase/Lemon dashboard shows matching event.

Common beta tags:

- checkout,
- coupon,
- entitlement,
- route,
- global search,
- visited cap,
- sign-in,
- email verification,
- leaderboard,
- mobile layout,
- map data.

## 9. End-Of-Day Release Review

Record:

- total testers invited,
- active users observed,
- Firestore reads/writes/deletes,
- function invocations/errors,
- checkout starts,
- webhook completions,
- coupon issues,
- refunds/cancels/expired events,
- support tickets,
- kill switches used,
- follow-up bugs.

Decision:

- Continue private beta.
- Pause invites.
- Disable specific feature.
- Roll back.
- Prepare next patch.
