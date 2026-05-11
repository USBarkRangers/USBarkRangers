# Privacy Policy Draft

Status: **Draft pending legal review.**
Effective date: **TBD.**
Operator/legal entity: **TBD after legal review.**
Support contact: **TBD.**

This draft is not legal advice. It is a public-facing policy starting point for lawyer review before paid/public release.

## Overview

BARK Ranger Map helps users browse dog-friendly park and program information, track visited places, plan trips and routes, and manage optional BARK Ranger Premium access.

This policy should explain what information the app collects, how it is used, which third-party services process it, and how users can request support, deletion, or export.

## Information We Collect

### Account Information

If a user creates or signs into an account, the app may collect and store:

- Firebase user ID.
- Email address.
- Sign-in provider information, such as email/password or Google sign-in.
- Email verification status.
- Account profile fields and settings the user chooses to save.
- Premium entitlement state, such as active, cancelled, expired, refunded, or other subscription status.

Email/password users may be asked to verify their email address before using paid checkout or Premium-only server features.

### Google Sign-In

If a user signs in with Google, Firebase Auth and Google may process Google account identifiers, email address, and related sign-in information. Google sign-in users are handled through Firebase Auth.

### Visited Places

Signed-in users may save visited places. The app stores visited-place records connected to the user's account. These records may include park/place IDs, names, dates, verification flags, and related metadata used for profile, map, and leaderboard features.

The app should not describe GPS or visit verification as perfect. Any location or visit-verification feature should be treated as a best-effort app feature, not a guarantee.

### Saved Routes And Trip Planner

Premium users may save routes or trip-planner data. Saved route records may include route names, stops, coordinates, route metadata, timestamps, and user-entered notes.

Route generation and geocode requests may send route coordinates, stop names, and search text to server-side Firebase Functions, which may then send route/geocode requests to OpenRouteService.

### Feedback And Support Messages

If feedback/support is enabled, users may send message text and related account/app context. Support messages may include information the user chooses to provide, such as device/browser details, screenshots, or account email.

Users should not send passwords, payment card details, or other sensitive information through support messages.

### Payment And Subscription Information

Payments and subscriptions are handled by Lemon Squeezy. The app creates Lemon checkout sessions and may send Lemon Squeezy:

- Firebase user ID in checkout custom metadata.
- User email if available.
- Product/variant checkout context.
- Coupon/discount code data when used through Lemon checkout or a controlled prefilled checkout link.

Lemon Squeezy handles payment method details. The app should not store full payment card numbers.

The app receives Lemon Squeezy webhook events to update Premium access, subscription status, cancellation, expiration, refund, and customer portal metadata.

### Analytics

The app currently loads GoatCounter analytics. Depending on configuration, analytics may process page views, referrer information, browser/device metadata, IP-derived information, and usage patterns.

Lawyer review should decide the final analytics disclosure, retention language, and opt-out language.

### Public Catalog Data

The public park/pin catalog is loaded from a published Google Sheets CSV and/or a static fallback CSV. This catalog is public app data, not user account data, but its ownership and attribution are pending review.

### Map Tiles And External Map Services

When users view maps, the browser may request map tiles directly from providers such as OpenStreetMap, OpenTopoMap, or Esri. Those providers may receive browser request information such as IP address, user agent, requested tile coordinates, and timing.

When users click external map links, such as Apple Maps or Google Maps, those external services may receive the query/coordinate information and handle it under their own terms and privacy policies.

## How We Use Information

The app may use collected information to:

- Create and manage accounts.
- Verify email status.
- Save visited places and routes.
- Render profile, passport, achievement, leaderboard, and map features.
- Enforce free and Premium feature limits.
- Create Lemon Squeezy checkout sessions.
- Process Lemon Squeezy webhook updates and subscription state.
- Provide support and respond to user messages.
- Improve app reliability, safety, and launch-readiness.
- Prevent abuse, fraud, excessive route/geocode usage, and unauthorized access.

## Third-Party Services

The app may use the following services:

- Firebase Auth, Firestore, Functions, and Hosting.
- Google Sign-In.
- Lemon Squeezy for checkout, subscriptions, coupons, refunds, and customer portal.
- OpenRouteService for Premium route/geocode functionality.
- OpenStreetMap, OpenTopoMap, and Esri map tiles.
- Google Sheets published CSV for public catalog data.
- GoatCounter analytics.
- Google Fonts, Firebase SDK CDN, and other browser CDNs.

Final public policy should link to relevant third-party privacy policies and terms after legal review.

## Data Sharing

The app does not sell payment card information. The app may share/process data with service providers needed to operate the app, including the services listed above.

The app may disclose information if required by law, to protect the app or users, to investigate abuse, or as part of a business/ownership change, subject to lawyer-approved language.

## Data Retention

Draft retention approach:

- Account data is kept while the account is active.
- Visited places and saved routes are kept until the user deletes them or requests account deletion, subject to technical and legal retention needs.
- Payment/subscription records may be retained as needed for accounting, taxes, fraud prevention, refunds, chargebacks, and legal obligations.
- Logs and analytics may be retained for operational and security purposes for a period to be determined.

Retention periods need legal review.

## Deletion And Export Requests

Users should be able to contact support to request:

- Account deletion.
- Export or copy of account data.
- Deletion of visited places or saved routes.
- Help correcting account or subscription status.

Draft process:

1. User contacts support at **[support email TBD]** from the email associated with the account.
2. Support verifies the account owner.
3. Support processes export/deletion within a lawyer-approved timeframe.
4. Some payment, tax, security, or backup records may need to be retained where legally required.

## Children's Privacy

The app is not intended for children without parent/guardian involvement. Final age threshold and compliance language require lawyer review.

## Security

The app uses Firebase security rules, server-side checks, and third-party service security controls. No system is perfectly secure. Users should protect their login credentials and should not share passwords or payment details through support messages.

## Changes To This Policy

The app may update this policy. Final language should explain how users will be notified and when changes become effective.

## Contact

Support/legal contact: **[support email or legal contact TBD]**

This draft must be reviewed by counsel before publication.
