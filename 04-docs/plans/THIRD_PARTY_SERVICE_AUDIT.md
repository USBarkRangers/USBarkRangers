# Third-Party Service Audit

Date: 2026-05-09
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1699a921928086b5b81e6bb48bee6be0691cfa88`

This is a service and data-flow inventory for legal/privacy/terms review.

| Service | What app uses it for | User/app data sent | Payment/billing role | Secrets/API key storage evidence | Terms/attribution/privacy concerns | Risk | Questions |
|---|---|---|---|---|---|---|---|
| Firebase Auth | Email/password auth, Google sign-in account identity | Email, UID, provider identifiers, email verification state | None directly | Firebase config in client; Auth service in `services/authService.js` | Privacy policy, account deletion/export, email verification notices | Medium | Who controls user accounts and deletion requests? |
| Firestore | User profiles, visits, entitlements, saved routes, leaderboard, feedback/server collections, legacy access-code compatibility records | UID, visited places, settings, entitlement, saved route metadata, leaderboard rows | Stores entitlement state | Firebase config; rules in `firestore.rules` | User data storage, security rules, retention, export/deletion | Medium/high | What user data is personal/sensitive? |
| Firebase Functions | Premium routes/geocodes, checkout, webhook, disabled legacy access-code callable, admin tools | UID, entitlement checks, route/geocode queries, checkout metadata | Creates Lemon checkouts and processes webhooks | Secrets via Functions config/secrets in `functions/index.js` | Server logs, secrets handling, outbound API data | Medium/high | What logs are retained and who can access them? |
| Firebase Hosting | Static app hosting | Browser requests, app files | None | `firebase.json` hosting config | Public file distribution; ignored files must stay private | Low/medium | Are docs/private files excluded from deploy? |
| Lemon Squeezy | Checkout, subscriptions, webhooks, customer portal | UID in checkout custom data, customer email/payment data via Lemon, subscription IDs/status | Merchant/payment/subscription provider | Secret names in `functions/index.js`; do not print values | Terms, refunds, subscriptions, tax, merchant identity, customer data | High | Who owns store, payouts, refunds, and customer records? |
| Google Sheets published CSV | Public park/pin data feed | Public CSV fetch; no user data from app fetch | None | URL in `modules/dataService.js` | Data ownership, publication, caching, privacy if sheet has hidden/sensitive fields | High | Who owns the Sheet and data? |
| Google Sign-In | OAuth login | Google account identifiers/email/profile basics | None | Firebase Auth provider setup | Privacy policy, OAuth consent, account linking | Medium | Are OAuth branding/consent screens correct? |
| OpenRouteService | Premium route generation/geocode/global search | Route coordinates/search text, app-origin server requests, possibly user intent/location | None | `ORS_API_KEY` secret referenced in `functions/index.js` | Terms, attribution, rate limits, route/location privacy | Medium/high | What exact user data goes to ORS and how must it be disclosed? |
| Leaflet | Browser map rendering | No direct server data unless library CDN loads | None | CDN from unpkg in `index.html` | License notice, CDN supply-chain/privacy | Low/medium | Should it be bundled locally or SRI-pinned? |
| OpenStreetMap tile service | Default map tiles | Browser IP/user map viewport tile requests to OSM tile servers | None | Tile URL in `modules/mapEngine.js` | Tile usage policy, attribution, commercial/public traffic | Medium/high | Is OSM tile usage allowed at expected traffic? |
| OpenTopoMap | Topographic map tiles | Browser IP/user map viewport requests | None | Tile URL/attribution in `modules/mapEngine.js` | CC-BY-SA/style attribution, tile usage policy | Medium/high | Is attribution sufficient? |
| Esri tile services | Satellite/street map backgrounds | Browser IP/user map viewport requests | None | Tile URLs/attribution in `modules/mapEngine.js` | Esri terms, attribution, commercial use | Medium/high | Are these public tile endpoints allowed for this use? |
| Google APIs / Google Sheets admin | Admin spreadsheet sync/geocoding/data management | Spreadsheet data, admin inputs, possible park data | None | `googleapis`, scopes/keys in `functions/index.js` | API scopes, service account/key handling, spreadsheet ownership | Medium/high | Who owns admin spreadsheets and API credentials? |
| Google Gemini / Generative AI | Admin data extraction/AI workflows | Admin-provided text/data, prompts, spreadsheet context if used | None | `@google/generative-ai`, `GEMINI_API_KEY` referenced | AI service terms, data retention, user/customer data disclosure | Medium/high | Is any user/customer data sent to Gemini? |
| Google Fonts / gstatic | Inter font and Google sign-in icon/Firebase SDK CDN | Browser IP/user agent requests | None | `index.html` URLs | Third-party browser requests/privacy, font license | Low/medium | Is external font loading okay under privacy policy? |
| unpkg / jsDelivr / cdnjs | Browser JS/CSS libraries | Browser requests to CDNs | None | `index.html`, `modules/shareEngine.js` | Supply chain, SRI, uptime, license notices | Medium | Should libraries be vendored or pinned with integrity? |
| GoatCounter | Web analytics | Page/path/referrer-ish analytics depending config | None | `index.html` GoatCounter script | Analytics disclosure, opt-out, privacy | Medium | What analytics notice is needed? |
| Apple Maps / Google Maps links | External map links for users | Query/coordinates when clicked | None | `renderers/panelRenderer.js` | External navigation privacy/disclaimer | Low/medium | Should external links be disclosed? |
| eBay / AllTrails / social links | Product/social/community outbound links | Browser click/referrer when clicked | Possible affiliate or product role if configured | `index.html` links | Affiliate/endorsement/disclosure/brand relationship | Medium | Are any links affiliate or partnership links requiring disclosure? |

## Production Readiness Notes

- Lemon Squeezy must remain test mode until Carter's final release-candidate approval; this is documented elsewhere in hardening reports.
- Do not print or share secret values in legal packet materials.
- Review tracked `firebase-debug.log` before sharing repo access.
- Hosting ignores many private/dev paths in `firebase.json`, but git history and GitHub visibility are separate from Firebase Hosting deploy safety.

## Questions For Lawyer

1. Which service terms require attribution or user notice?
2. Which services are processors/subprocessors for privacy policy purposes?
3. Does the app need consent for analytics, location/route/geocode processing, or third-party map tiles?
4. Is Lemon Squeezy merchant/customer-data ownership aligned with the public brand?
5. Are Google Sheets and admin API credentials controlled by the correct entity?
