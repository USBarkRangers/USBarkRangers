# Refund And Cancellation Policy Draft

Status: **Draft pending legal review.**
Effective date: **TBD.**
Operator/legal entity: **TBD after legal review.**
Support contact: **TBD.**

This draft is not legal advice. It should be reviewed against Lemon Squeezy settings, actual product pricing, consumer protection requirements, tax/accounting needs, and final checkout copy before live payments.

## Payment Processor

BARK Ranger Premium checkout, subscriptions, coupons, payment methods, receipts, and billing portal functions are handled through Lemon Squeezy.

The app does not collect or store full payment card numbers. Payment details are handled by Lemon Squeezy.

## Subscription Renewal

Draft behavior:

- Premium may be sold as a recurring subscription.
- Renewal timing, price, tax, and discount behavior should be shown at Lemon checkout.
- Users are responsible for reviewing the Lemon checkout terms before completing checkout.
- Premium access is attached to the app account used during checkout.

Final renewal language must match the live Lemon product/variant configuration.

## Coupons And 100% Off Codes

All coupon codes are Lemon Squeezy discount codes entered at Lemon checkout.

The app does not have an app-side Promo / Access Code box and does not grant Premium directly from a user-entered app code.

100% off admin/mod/VIP/support codes should be configured in Lemon Squeezy. Their rules may include:

- Product/variant restrictions.
- One-use redemption limits.
- Expiration dates.
- Discount duration such as once, limited period, or forever.

Important draft warning:

If a 100% off coupon applies only once or only for a limited duration, the subscription may renew later at the normal price unless cancelled before renewal. For no-surprise admin/mod access, current internal guidance prefers 100% off coupons that apply forever and are limited to one redemption.

This coupon policy needs lawyer and Lemon dashboard review before public use.

## Cancellation

Draft behavior:

- Users should be able to manage or cancel subscriptions through Lemon Squeezy's billing/customer portal when a Lemon subscription exists.
- Cancelling a subscription may stop future renewal.
- A cancelled subscription may keep Premium active until the end of the paid billing period.
- The app account UI should show access end date and auto-renew status when available.

Free/admin/mod 100% off coupons may still create a Lemon subscription if redeemed through Lemon checkout. Users may still need to manage/cancel that subscription depending on the discount duration.

## Refunds

Draft behavior:

- Refund requests should be sent to **[support email TBD]** or handled through Lemon Squeezy support/processes as configured.
- Approved refunds may remove Premium access after the refund is processed.
- Refunds may be reviewed based on timing, usage, duplicate purchase, billing error, accidental purchase, technical issue, chargeback risk, and applicable law.
- Taxes, fees, and payment processor behavior may affect refund timing and amount.

Final refund window, eligibility rules, and mandatory consumer-law language require lawyer review.

## Expired, Refunded, Or Failed Payments

Draft product behavior:

- Expired subscriptions are Premium inactive.
- Refunded subscriptions/orders are Premium inactive/refunded.
- Payment-failed or past-due states may keep Premium temporarily active during a grace/retry period.
- Payment recovered/resumed can restore Premium after Lemon webhook confirmation.

## Account Matching

Premium access is tied to the app account used at checkout. Users should sign into the intended account before subscribing.

If Premium does not appear after checkout, the user should contact support with:

- App account email.
- Lemon receipt/order email.
- Approximate checkout time.
- Screenshot of receipt if available, with payment card details hidden.

## Contact

Support contact: **[support email TBD]**

This draft must be reviewed by counsel before publication.
