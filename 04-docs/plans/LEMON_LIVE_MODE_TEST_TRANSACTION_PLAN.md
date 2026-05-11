# Lemon Squeezy Live-Mode Test Transaction Plan

Date: 2026-05-09
Status: future RC smoke plan. Do not run until Carter approves live mode.

## 1. Goal

Run one controlled live transaction to prove checkout, webhook, entitlement, customer portal, cancellation, refund, and rollback behavior before paid public launch.

## 2. Preconditions

- [ ] Carter explicitly approves live-mode RC.
- [ ] Live-mode code/config patch is reviewed.
- [ ] Budget alerts are active.
- [ ] Rollback playbook is open.
- [ ] Lemon dashboard live mode is selected.
- [ ] Firebase logs are open.
- [ ] Firestore `users/{uid}.entitlement` is visible for the test user.
- [ ] Support/refund policy draft is ready.
- [ ] Test user email is verified.

## 3. Transaction Smoke

1. Use a real test account controlled by Carter.
2. Start Premium checkout from production app.
3. Confirm Lemon checkout is live mode and correct product/annual variant.
4. Complete payment with a low-risk payment method.
5. Confirm Lemon order/subscription exists.
6. Confirm `lemonSqueezyWebhook` receives valid signed live event.
7. Confirm Firestore entitlement becomes:
   - `source: lemon_squeezy`
   - `premium: true`
   - `status: active`
   - provider customer/subscription IDs present
8. Confirm app account UI shows Paid Premium.
9. Confirm Manage Billing opens a signed customer portal URL.
10. Confirm premium route/geocode/saved-route gates work.

## 4. Coupon Smoke

1. Create one live test discount in Lemon.
2. Start checkout from app.
3. Enter coupon on Lemon checkout.
4. Confirm discount applies only to intended product/variant.
5. Complete checkout.
6. Confirm Premium is not active until webhook confirmation.
7. Confirm webhook grants Premium after checkout completes.

## 5. Cancellation Smoke

Use Lemon dashboard or customer portal:

1. Cancel subscription with future access end.
2. Confirm webhook maps to `cancelled_active`.
3. Confirm app shows:
   - Premium cancelled,
   - Access ends: date,
   - Auto-renew: No.
4. Confirm premium tools remain available until period end.

## 6. Refund / Expiration Smoke

Use the safest Lemon-supported live method:

1. Refund the live test payment, or simulate/trigger expiration only if Lemon supports a safe live test path.
2. Confirm webhook maps to `refunded` or `expired`.
3. Confirm Premium becomes inactive.
4. Confirm account UI shows inactive/refunded state.
5. Confirm premium route/geocode/saved-route gates lock again.

## 7. Evidence To Save Outside Public Repo

- Lemon order/subscription screenshots.
- webhook delivery screenshots.
- Firebase logs screenshots.
- Firestore entitlement before/after.
- account UI screenshots.
- refund/cancel confirmation.

Do not save sensitive screenshots in the public repo.

## 8. Pass Criteria

Live RC smoke passes only if:

- checkout creates correct live subscription,
- webhook grants Premium,
- coupon behavior is correct,
- Manage Billing works,
- cancellation preserves access until end date,
- refund/expired removes Premium,
- no live secrets appear in logs,
- rollback remains available.

If any item fails, disable checkout immediately and use `plans/LEMON_LIVE_MODE_ROLLBACK_PLAN.md`.
