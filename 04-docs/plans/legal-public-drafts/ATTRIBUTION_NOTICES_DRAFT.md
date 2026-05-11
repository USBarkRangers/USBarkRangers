# Attribution And Notices Draft

Status: **Draft pending legal review.**
Effective date: **TBD.**

This draft is not legal advice. It is a public-facing attribution/notice starting point. Final wording, placement, and required links must be reviewed against each provider's current terms.

## Map Rendering

The app uses Leaflet for interactive map rendering.

Draft notice:

- Map interface powered by Leaflet.

Review needed:

- Leaflet license notice and whether app needs a bundled NOTICE/credits page.
- CDN/source integrity and whether libraries should be bundled or pinned.

## Map Tiles

The app currently includes map tile layers for:

- OpenStreetMap.
- OpenTopoMap.
- Esri satellite imagery.
- Esri street/roads tiles.

Current code includes map attribution strings in the map UI for OpenStreetMap contributors, OpenTopoMap/SRTM, and Esri/source suppliers.

Draft public notice:

- Map data and tiles may be provided by OpenStreetMap contributors, OpenTopoMap, Esri, and their listed data suppliers. Attribution appears in the map interface where provided by the tile layer.

Review needed:

- Whether the current visible map attribution is sufficient on desktop and mobile.
- Whether screenshots, shared images, or exported materials need additional attribution.
- Whether expected app traffic and commercial/paid use are allowed by each tile provider.
- Whether the app needs to use a paid/commercial tile provider before public launch.

## OpenRouteService

Premium routing and geocode/global search requests may use OpenRouteService through Firebase Functions.

Draft notice:

- Routing and geocode results may be powered by OpenRouteService.

Review needed:

- Required ORS attribution wording and placement.
- Privacy disclosure for route coordinates, stop names, search terms, and location-like inputs sent to ORS through server-side requests.
- ORS usage limits and commercial/paid-app terms.

## Public Catalog Data

The park/program catalog is loaded from a published Google Sheets CSV and/or static fallback CSV files.

Draft notice:

- Park/program information is compiled from app-maintained catalog data and may be incomplete or outdated. Users should verify current rules and conditions with the park or official source before traveling.

Review needed:

- Who owns the Google Sheet and local CSV/JSON snapshots.
- Whether data was copied from public agency pages, park websites, maps, social posts, user submissions, or other sources.
- Whether row-level attribution or source links are required.
- Whether the app can cache, host, and redistribute this data.

## Payments

Payments, subscriptions, billing portal, receipts, and coupon processing are handled by Lemon Squeezy.

Draft notice:

- Payments and subscriptions are processed by Lemon Squeezy.

Review needed:

- Whether Lemon Squeezy merchant-of-record, tax, refund, and subscription notices need specific wording in checkout/account UI.

## Firebase And Google

The app uses Firebase/Google services for hosting, authentication, database, server functions, Google sign-in, email verification, and some admin/data workflows.

Draft notice:

- Account sign-in and app data storage are powered by Firebase/Google services.

Review needed:

- Whether public notices should link to Google/Firebase privacy and terms.
- Whether Google OAuth consent branding is correct.
- Whether admin Google Sheets/Gemini workflows need separate disclosure.

## Analytics

The app currently loads GoatCounter analytics.

Draft notice:

- The app may use privacy-focused analytics to understand usage and improve reliability.

Review needed:

- Exact GoatCounter disclosure, retention, opt-out, and cookie/no-cookie wording.
- Whether analytics consent is required for target users/locations.

## Fonts, Icons, And Browser Libraries

The app loads browser assets/libraries from CDNs and uses fonts/icons/resources including Google Fonts/gstatic, Firebase SDK CDN, unpkg, jsDelivr, and cdnjs.

Review needed:

- License notices for each browser library.
- Whether any assets should be bundled locally.
- Whether external browser requests need privacy disclosure.

## Brand And Logo Notices

The app uses BARK Ranger / US BARK RANGERS / B.A.R.K.-related names and logo/watermark assets.

Do not publish final ownership, registration, endorsement, or affiliation claims until legal review confirms the correct wording.

Draft placeholder:

- Brand names, logos, and marks are used subject to ownership and permission review. Final trademark notice TBD.

## No Endorsement Placeholder

Draft only:

- Unless expressly stated after legal review, third-party names, maps, data providers, parks, agencies, payment processors, and service providers are referenced for identification and service operation only and do not imply endorsement.

This draft must be reviewed by counsel before publication.
