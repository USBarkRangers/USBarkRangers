# BARK Ranger Map Legal / License / IP Diligence Packet

Date: 2026-05-09
Scope: pre-lawyer diligence audit only; no legal conclusions.
Repo: `/Users/carterswarm/BarkRangerMap`
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1699a921928086b5b81e6bb48bee6be0691cfa88`

## 1. Executive Summary

This packet gathers the repository facts Carter should review with a lawyer before broader beta, paid launch, or any partner/admin promotion.

This is not legal advice. Items marked HIGH, P0, or "needs lawyer review" are not conclusions that the app is unlawful; they are the highest-priority unknowns to resolve.

Highest-priority review areas:

1. `firebase-debug.log` was tracked in git at audit time and has now been removed from tracking in a cleanup commit. Current-pattern scanning did not find private key blocks, Google API-key-shaped values, or access-token-shaped values in the checked copy, but it did find deployment/emulator metadata, project IDs, private email addresses, Secret Manager secret names, and signed upload URL signatures. Do not publish broader diligence materials without deciding whether git history cleanup and any conservative rotation are needed.
2. Public-facing `US BARK RANGERS`, `BARK Ranger`, `B.A.R.K.`, logos, watermarks, and payment/product names need trademark/brand ownership review.
3. Park/pin datasets and CSV snapshots have unclear source/permission/attribution records.
4. Several browser libraries and map/data services are loaded from CDNs or third-party APIs and need attribution/terms review.
5. One transitive dependency, `node-forge@1.4.0`, reports `(BSD-3-Clause OR GPL-2.0)` and should be reviewed for the permissive-license election/notice path.
6. `valid-url@1.0.9` in the root dependency tree reports an unknown license in installed metadata.
7. There is no repo-level `LICENSE` or `NOTICE` file found in this audit. That may be fine for a private repo, but public distribution and partner/license expectations should be decided.

## 2. Files Generated

- `plans/LEGAL_LICENSE_DILIGENCE_PACKET.md`
- `plans/LEGAL_LICENSE_RED_FLAGS.md`
- `plans/DEPENDENCY_LICENSE_AUDIT.md`
- `plans/ASSET_DATA_SOURCE_AUDIT.md`
- `plans/THIRD_PARTY_SERVICE_AUDIT.md`
- `plans/AI_ASSISTED_DEVELOPMENT_DISCLOSURE_DRAFT.md`
- `plans/root-npm-ls-all.json`
- `plans/functions-npm-ls-all.json`

## 3. Dependency License Summary

Full dependency inventory is in `plans/DEPENDENCY_LICENSE_AUDIT.md`.

Root app direct dependencies/devDependencies audited:

- `@firebase/rules-unit-testing`
- `@google/generative-ai`
- `@playwright/test`
- `axios`
- `firebase`
- `firebase-admin`
- `firebase-functions`
- `firebase-tools`
- `googleapis`
- `nock`

Functions direct dependencies audited:

- `@google/generative-ai`
- `axios`
- `firebase-admin`
- `firebase-functions`
- `googleapis`

Tooling note: `license-checker` was not installed and was not added. License metadata was extracted from package lockfiles and installed `node_modules/*/package.json` metadata.

Summary from installed metadata:

| Scope | Packages in full tree | Low | Medium | High | Unknown |
|---|---:|---:|---:|---:|---:|
| Root | 766 | 762 | 2 | 1 | 1 |
| Functions | 247 | 246 | 0 | 1 | 0 |

Direct dependencies are mostly MIT / Apache-2.0. The main license flags found are transitive packages:

- `node-forge@1.4.0` reports `(BSD-3-Clause OR GPL-2.0)`. Needs lawyer/developer review to confirm use under BSD-3-Clause and any notice requirements.
- `valid-url@1.0.9` reports `UNKNOWN` license in installed metadata in the root tree.
- A small number of transitive packages use nonstandard license strings such as `BSD`, `public domain`, or package metadata license objects. These need notice cleanup/review, not panic.

No direct GPL/AGPL/LGPL/SSPL/BUSL/Commons Clause dependency was found from installed package metadata.

## 4. High-Risk Licenses Found

No direct dependency with GPL, AGPL, LGPL, SSPL, BUSL, or Commons Clause was found.

Transitive high-priority review:

| Package | Scope | Version | License metadata | Why review |
|---|---|---:|---|---|
| `node-forge` | root/functions transitive | 1.4.0 | `(BSD-3-Clause OR GPL-2.0)` | Dual-license package includes GPL option. Confirm distribution can rely on BSD-3-Clause and include notices if required. |

## 5. Unknown Licenses Found

| Package | Scope | Version | License metadata | Notes |
|---|---|---:|---|---|
| `valid-url` | root transitive | 1.0.9 | `UNKNOWN` | Installed metadata did not expose a clear license. Needs package/source review before public release. |

Additional unknowns:

- CDN-loaded libraries in `index.html` and `modules/shareEngine.js` are not captured in `package-lock.json` and need separate license/attribution review.
- Images/logos/watermarks in `assets/images/` have unknown source/permission in repo metadata.
- CSV/data files have unknown source/permission/attribution in repo metadata.

## 6. Asset / Data-Source Risks

Full asset table is in `plans/ASSET_DATA_SOURCE_AUDIT.md`.

Highest-priority items:

- `assets/images/USBarkRangerLogoWatermark.jpeg`
- `assets/images/WatermarkBARK.PNG`
- `assets/images/bark-logo.jpeg`
- `assets/images/bark-tag.jpeg`
- `assets/data/bark-fallback.csv`
- `BARK Master List.csv`
- `data/data.csv`
- `data/data.json`
- `data/sheet_data_fetched.csv`
- Google Sheets published CSV URL in `modules/dataService.js`
- Map tiles and attributions in `modules/mapEngine.js`

Questions to answer:

- Who created each logo/image/watermark?
- Does Carter or USBARKRANGERS LLC own those assets?
- Were any images derived from third-party art, NPS/public agency marks, stock images, or user-submitted material?
- Who owns and maintains the Google Sheet data?
- Were park/pin records copied from websites, Facebook groups, public park pages, maps, or user submissions?
- Are OSM/OpenTopoMap/Esri attribution and usage requirements satisfied in app UI and public marketing?

## 7. Third-Party Service Risks

Full service table is in `plans/THIRD_PARTY_SERVICE_AUDIT.md`.

Key services and APIs:

- Firebase Auth, Firestore, Functions, Hosting
- Google Sign-In
- Lemon Squeezy
- Google Sheets published CSV
- OpenRouteService
- OpenStreetMap tile provider
- OpenTopoMap
- Esri tile services
- Google APIs / Gemini / Google Sheets admin integrations
- Google Fonts / gstatic / Firebase CDN
- unpkg / jsDelivr / cdnjs browser dependencies
- GoatCounter analytics
- External social/product links including eBay, AllTrails, Facebook, Instagram, YouTube, TikTok

Main privacy/terms questions:

- What privacy policy covers Firebase Auth emails, Google sign-in, visited places, routes, feedback, payment metadata, analytics, and support access?
- Is Carter/USBARKRANGERS LLC the correct merchant/operator for Lemon Squeezy?
- What happens to customer data, payment access, and brand permissions if a partnership ends?
- Are map tile providers allowed for this app's traffic/commercial use?
- Are required map/data/service attributions visible enough in the app?

## 8. Branding / Trademark Risks

User-facing brand strings found include:

- `US BARK RANGERS`
- `US BARK RANGERS®`
- `BARK Ranger`
- `BARK Ranger Premium`
- `BARK Ranger Map`
- `B.A.R.K.`
- `USBARKRANGERS.COM`
- `usbarkrangers@gmail.com`
- social handles/links for `usbarkrangers`

These appear in `index.html`, `manifest.json`, `modules/shareEngine.js`, tests, functions, and many planning docs. Several appear in payment/account/paywall-related copy.

Questions for lawyer:

1. Can Carter use `US BARK RANGERS`, `BARK Ranger`, and `B.A.R.K.` branding in a paid app?
2. Does USBARKRANGERS LLC own the relevant marks/logos or license them from another owner?
3. Does any government/NPS/public agency B.A.R.K. program mark require separate permission?
4. Who owns the app code, app data, user accounts, customer emails, and payment relationship?
5. Who controls Lemon Squeezy merchant accounts and payout information?
6. What happens if Carter and any partner/admin/community relationship ends?

## 9. AI-Assisted Development Disclosure Draft

See `plans/AI_ASSISTED_DEVELOPMENT_DISCLOSURE_DRAFT.md`.

Short draft:

> Carter developed the app using AI-assisted coding tools at times. AI tools helped with coding suggestions, debugging, tests, documentation, and planning. Carter directed the product design, architecture decisions, implementation choices, QA, deployment, and final acceptance of changes.

The app also includes product code that can call Google/Gemini-related APIs for admin data workflows. That is separate from AI-assisted development disclosure and should be reviewed for service terms/privacy.

## 10. Privacy / Customer-Data Questions

Bring these to counsel:

1. What privacy policy is required before collecting Firebase account emails, Google sign-in identifiers, visited places, saved routes, feedback, and payment metadata?
2. Is user location or route data stored, inferred, or sent to OpenRouteService?
3. Does feedback submission collect personal information or support content that needs retention rules?
4. What analytics notice is needed for GoatCounter?
5. What disclosures are needed for Google Fonts/CDN requests, Firebase, Lemon Squeezy, OpenRouteService, map tiles, and Google Sheets?
6. Who can access user data in Firebase, Lemon Squeezy, Google Sheets, and admin tooling?
7. What user data deletion/export process is needed?

## 11. Payment / Lemon Squeezy Business-Ownership Questions

1. Is the Lemon Squeezy store owned by Carter, USBARKRANGERS LLC, or another entity?
2. Who is merchant of record and who handles tax, refunds, chargebacks, and customer support?
3. Does public app branding match the legal merchant/customer receipt identity?
4. Does the app need Terms of Service and refund/subscription disclosures before paid launch?
5. Can admins/mods/VIPs receive free access without creating tax/accounting or disclosure problems?
6. Are Lemon coupon policies documented clearly enough for users?

## 12. Exact Commands Run

These were run during the diligence audit:

```bash
git status -sb
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm ls --depth=0
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions ls --depth=0
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm ls --all --json > plans/root-npm-ls-all.json
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions ls --all --json > plans/functions-npm-ls-all.json
command -v license-checker
find assets -type f
find . -iname "*license*" -o -iname "*notice*" -o -iname "*copying*"
rg -n "Copyright|copyright|License|license|Licensed|MIT|Apache|BSD|GPL|LGPL|AGPL|Creative Commons|CC-BY|CC BY|Attribution|trademark|Trademark|OpenStreetMap|Leaflet|ORS|OpenRouteService|Google|Firebase|Lemon|Mapbox|Font|font|icon|logo|image|CSV|dataset|sheet|spreadsheet"
rg -l "AIza|LEMONSQUEEZY|ORS_API_KEY|GEMINI_API_KEY|GOOGLE_MAPS_API_KEY|POSTHOG_API_KEY|PRIVATE KEY|BEGIN PRIVATE KEY|api[_-]?key|secret" --glob "!node_modules/**" --glob "!functions/node_modules/**"
git ls-files | rg "(^|/)(firebase-debug|firestore-debug|.*\\.log$|.*\\.auth/|storageState|serviceAccount|service-account|.*secret.*|.*private.*|.*key.*\\.json$)"
```

Command result notes:

- `npm` was not on the default shell `PATH`; Node 20 at `$HOME/.nvm/versions/node/v20.20.2/bin` was used.
- `license-checker` was not installed. No package was installed for this audit.
- `plans/root-npm-ls-all.json` and `plans/functions-npm-ls-all.json` were generated successfully.
- `find` did not locate a repo-level `LICENSE`, `NOTICE`, or `COPYING` file outside dependencies.
- `firebase-debug.log` was tracked by git at audit time and was removed from tracking in a later cleanup commit. Git history still contains prior versions unless Carter approves a separate history rewrite.
- No tracked Playwright auth storage states, private key files, service-account JSON files, or `.env` files were found by `git ls-files`; only `.env.example` is tracked from that pattern.
- Root project package metadata does not define a clear project license field in `package.json`.

## 13. Top 10 Questions Carter Should Bring To Lawyer

1. Can Carter and/or USBARKRANGERS LLC use `US BARK RANGERS`, `BARK Ranger`, `B.A.R.K.`, logos, and related social handles in a paid app?
2. Who legally owns the app code, design, data, brand assets, user accounts, and payment/customer relationship?
3. Who owns the Google Sheet and local CSV/data files, and what permissions/attribution apply?
4. Are the app's map tile providers and OpenRouteService use allowed for this app's traffic and business model?
5. What privacy policy and terms are needed before collecting account emails, visited parks, route data, feedback, analytics, and payment metadata?
6. Does `firebase-debug.log` or any tracked local/debug file expose sensitive data that requires removal from git history or key rotation?
7. Do AI-assisted coding disclosures affect ownership, partner representations, or investor/customer diligence?
8. Are 100%-off Lemon discount codes for admins/mods/VIPs/support users okay from a business, tax, and consumer-disclosure standpoint?
9. What refund/cancellation/subscription language is required for Lemon Squeezy checkout and account UI?
10. What happens to app/customer/payment/data ownership if Carter's relationship with a partner, admin group, or brand owner ends?

## 14. Send This To ChatGPT / Lawyer Summary

Paste this summary into a lawyer intake or follow-up:

> I am preparing to launch a web app called BARK Ranger Map / BARK Ranger Premium. It uses Firebase Auth, Firestore, Functions, Hosting, Lemon Squeezy, Google Sheets CSV data, OpenRouteService, Leaflet, OpenStreetMap/OpenTopoMap/Esri map tiles, Google APIs/Gemini admin tooling, Google Fonts/CDNs, and GoatCounter analytics. The app uses US BARK RANGERS / BARK Ranger / B.A.R.K. branding and several logo/watermark image files whose source/ownership needs review. The park/pin data comes from a Google Sheet and local CSV/JSON snapshots, and I need to confirm ownership, permission, and attribution. The repo has no root LICENSE/NOTICE file found. Direct npm dependencies are mostly MIT/Apache-2.0, but a transitive dependency reports `(BSD-3-Clause OR GPL-2.0)` and one root transitive package reports unknown license. A tracked `firebase-debug.log` may contain environment/debug information and should be reviewed for sensitive data. AI-assisted coding tools were used for suggestions, debugging, tests, docs, and planning, with Carter directing product and final acceptance. I need legal review for trademarks, data rights, open-source notices, privacy policy, terms/refunds, Lemon Squeezy merchant ownership, and customer-data ownership.
