# BARK Ranger Lemon Coupon Runbook

Status: Lemon-only coupon flow for private-beta hardening. Lemon Squeezy remains locked in test mode until Carter explicitly approves the final RC live-mode switch.

## Product Decision

BARK Ranger no longer uses an app-side `Promo / Access Code` box for new users.

All codes are Lemon Squeezy discount codes:

1. User clicks Subscribe / Upgrade in BARK Ranger Map.
2. The app creates a Lemon Squeezy checkout in test mode.
3. The user enters the coupon code on the secure Lemon checkout page.
4. Lemon applies the coupon according to the Lemon dashboard discount rules.
5. BARK grants Premium only after the verified Lemon webhook confirms the subscription/order.

No app-side code grants Premium directly. There is no BARK-managed coupon/admin code flow in the private-beta user journey.

## Current App Behavior

- The BARK paywall modal does not show a `Promo / Access Code` input.
- The checkout callable still supports an optional sanitized `discountCode` parameter for future/internal prefilled checkout links, but normal users do not enter codes in the app.
- The default checkout payload does not set `checkout_options.discount: false`, so the app is not intentionally hiding Lemon's discount field.
- Checkout remains test-mode-only through `attributes.test_mode: true`.
- The old `redeemAccessOrPromoCode` callable is disabled for new redemptions and returns a clean message telling users to enter codes at Lemon checkout.
- Existing legacy `source: access_code` entitlements, if any exist, are still displayed as billing-free compatibility states until their `expiresAt` date. Do not create new ones.

## Why The Lemon Discount Field May Be Missing

Code-side findings:

- `functions/index.js` builds Lemon checkout payloads without `checkout_options.discount: false`.
- Lemon's checkout API documents `checkout_options.discount`; when set to `false`, it hides the discount code field.
- Lemon's hosted checkout settings also include a Discount code toggle.
- Lemon discount codes are created in Lemon's Store -> Discounts area and can be limited by product/variant, date, and redemption count.

Official Lemon docs checked:

- https://docs.lemonsqueezy.com/api/checkouts/create-checkout
- https://docs.lemonsqueezy.com/help/checkout/hosted-checkout
- https://docs.lemonsqueezy.com/help/checkout/prefilled-checkout-fields
- https://docs.lemonsqueezy.com/help/orders/creating-discount-codes
- https://docs.lemonsqueezy.com/api/discounts/create-discount

Most likely causes if Carter cannot see the Lemon discount field:

1. The Lemon hosted checkout setting for Discount code is toggled off.
2. No active test-mode discount exists for the BARK Premium product/variant.
3. The discount was created in live mode while checkout is still in test mode, or vice versa.
4. The discount is expired, inactive, redemption-limited, or not attached to the correct product/variant.
5. The user is viewing a stale checkout URL created before the discount setup changed.

## Create Admin / Mod / VIP Free Codes In Lemon

Recommended for admins/mods/VIPs who should not be charged:

1. Open Lemon Squeezy dashboard in test mode for beta testing.
2. Go to Store -> Discounts.
3. Create a discount code such as `ADMIN2026ABCD` or `MOD2026WXYZ`.
4. Set amount type to percent and amount to `100`.
5. Limit the discount to the BARK Ranger Premium product/annual variant.
6. Limit max redemptions to `1` for individual codes.
7. Set the subscription discount duration to apply forever if the person should keep free Premium without a surprise renewal charge.
8. Save the discount and test it in Lemon test checkout.

Recommended policy: individual one-use 100%-off forever codes for admins/mods/VIPs.

## One-Year Free Code Warning

If Carter wants a one-year-only free code, use Lemon's limited-duration subscription discount settings carefully.

Warning: a 100%-off discount that applies only once or only for a limited period can allow the subscription to renew later at full price unless the user cancels before renewal. Use this only when that behavior is clearly explained.

For no-surprise admin/mod access, prefer 100%-off forever codes limited to one redemption.

## Create Normal Launch Discount Codes In Lemon

Example launch discount:

1. Create code `LAUNCH20` in Lemon Squeezy Discounts.
2. Set amount type to percent and amount to `20`.
3. Limit it to the BARK Ranger Premium product/annual variant.
4. Choose whether it applies once, for a set duration, or forever.
5. Set start/end dates and max redemptions if needed.
6. Test in Lemon test-mode checkout before sharing.

Use uppercase letters and numbers for Lemon coupon codes, matching Lemon's API guidance. Avoid spaces and punctuation.

## Optional Prefilled Discount Checkout

The backend still supports a sanitized optional `discountCode` parameter on `createCheckoutSession`.

That path is for future controlled links or admin tooling only. It passes the code as Lemon `checkout_data.discount_code` and does not grant Premium directly. Premium still activates only from Lemon webhook confirmation.

## Testing Checklist

Before sharing a coupon code:

1. Confirm Lemon dashboard is in test mode.
2. Confirm the discount exists in test mode.
3. Confirm the discount is active and not expired.
4. Confirm it is attached to the correct Premium product/variant.
5. Confirm max redemptions and duration are correct.
6. Start checkout from the app.
7. Enter the coupon on Lemon checkout.
8. Complete a Lemon test checkout.
9. Confirm the webhook grants Premium in Firebase.
10. Confirm account UI shows paid Lemon subscription billing state, including Manage Billing when subscription data exists.

## Live Mode Lock

Do not enable Lemon live mode yet.

The final live-mode switch remains locked until Carter explicitly approves the release-candidate step. Keep `attributes.test_mode: true` during private beta hardening.
