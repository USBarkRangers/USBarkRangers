# Legal / License Red Flags

Date: 2026-05-09
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1699a921928086b5b81e6bb48bee6be0691cfa88`

This is not legal advice. Severity is a diligence priority ranking.

## P0 / Resolve Before Public Paid Launch

| Risk | Evidence | Why it matters | Suggested next action | Question for Carter/lawyer |
|---|---|---|---|---|
| Firebase debug log was tracked in git history | `firebase-debug.log` was tracked by git and later removed from tracking | Current scan did not find private key blocks, Google API-key-shaped values, or access-token-shaped values in the checked copy, but it did find deployment/emulator metadata, project IDs, private email addresses, Secret Manager secret names, and signed upload URL signatures. Git history still contains prior versions unless rewritten. | Keep ignored/untracked; decide separately whether history cleanup is worth doing; rotate any values if counsel/security decides the historical log is sensitive enough | Should Carter remove this file from git history and rotate any exposed operational values? |
| Brand/trademark ownership unclear | `index.html`, `manifest.json`, `modules/shareEngine.js`, docs use `US BARK RANGERS`, `US BARK RANGERS®`, `BARK Ranger`, `B.A.R.K.`, logos/social links | Paid app branding can create trademark, partnership, endorsement, or ownership issues | Confirm ownership/license/permission for all brand names, logos, slogans, social handles, and payment names | Can Carter use this branding for a paid app, and who owns the mark/customer relationship? |
| Unknown-origin public logo/watermark/image assets | `assets/images/USBarkRangerLogoWatermark.jpeg`, `assets/images/WatermarkBARK.PNG`, `assets/images/bark-logo.jpeg`, `assets/images/bark-tag.jpeg` | Public images/logos need ownership or license proof, especially in a branded paid product | Build asset provenance list: creator, date, owner, license/permission, allowed uses | Who created these images and are they cleared for app/payment/marketing use? |
| Park/pin data rights unclear | `assets/data/bark-fallback.csv`, `BARK Master List.csv`, `data/data.csv`, `data/data.json`, `data/sheet_data_fetched.csv`, Google Sheets CSV URL in `modules/dataService.js` | Dataset rights, copied facts, curated data, images/links, and attribution obligations can be separate from code | Document exact source of each row/source sheet and any terms or contributor permissions | Can this data be used commercially and redistributed/cached in the app? |
| Lemon/payment business ownership unclear | `functions/index.js`, `services/authAccountUi.js`, paywall/account UI docs | Merchant identity, customer receipts, refunds, chargebacks, tax, and customer ownership must match legal/business setup | Confirm Lemon Squeezy account owner, store identity, payout owner, refund/support terms | Who legally sells Premium and owns customer/payment records? |

## P1 / Resolve Before Broader Beta

| Risk | Evidence | Why it matters | Suggested next action | Question for Carter/lawyer |
|---|---|---|---|---|
| No repo-level license/notice found | `find` did not locate root `LICENSE`, `NOTICE`, or `COPYING` | Public distribution, partner collaboration, contractor work, and open-source obligations need clear license/notice policy | Decide whether repo remains private/proprietary and add notices/third-party attributions if needed | What license/copyright notice should the app carry? |
| Transitive `node-forge` dual-license metadata | `node-forge@1.4.0` reports `(BSD-3-Clause OR GPL-2.0)` | GPL option needs review, even when permissive option may be available | Confirm package is used/distributed under BSD-3-Clause path and include notices if needed | Does this require any notice or source-disclosure action? |
| Unknown transitive dependency license | `valid-url@1.0.9` root transitive reports `UNKNOWN` | Unknown license packages need review before distribution | Inspect upstream package/repo license and replace or document if needed | Is this package acceptable for app tooling/distribution? |
| CDN-loaded browser libraries not captured by npm audit | `index.html`, `modules/shareEngine.js` load Leaflet, markercluster, Turf, qrcodejs, PapaParse, html2canvas, Firebase compat SDKs via external CDNs | Runtime CDN dependencies have licenses, integrity/supply-chain, availability, and privacy implications | Create a CDN dependency notice list and consider pinned integrity/version/local hosting | Are CDN terms and licenses acceptable for production? |
| Map tile attribution/terms need review | `modules/mapEngine.js` uses OSM, OpenTopoMap, Esri tiles and attribution strings | Tile providers can restrict commercial/high-volume use and require attribution | Confirm tile provider terms, attribution placement, and expected launch traffic | Are these tile providers allowed for this paid app? |
| OpenRouteService attribution/terms need review | `functions/index.js`, `services/orsService.js` | Route/geocode providers may require attribution, rate limits, privacy disclosure | Confirm ORS terms, attribution language, and whether routes/geocodes send user data | What attribution/privacy language is needed for ORS? |
| Privacy policy / terms not confirmed | App uses Firebase Auth, Google sign-in, Firestore, payments, analytics, feedback, route/geocode APIs | Public users need clear terms/privacy before accounts/payments | Draft Privacy Policy, Terms, refund/cancellation terms, data deletion process | What minimum documents are needed before private/broader beta? |
| Google Sheet published CSV source/terms unclear | `modules/dataService.js` published Google Sheets CSV URL | Public sheet data may contain contributed/curated third-party information | Confirm sheet owner, contributors, data sources, update rights, privacy | Who owns the Sheet and can the app cache/serve it? |
| GoatCounter analytics disclosure needed | `index.html` includes GoatCounter script | Analytics use may need disclosure even if privacy-friendly | Decide analytics notice and whether opt-out is needed | How should analytics be disclosed? |
| AI-assisted development disclosure needs review | Repository docs and user request state AI-assisted coding was used | Contracts/ownership/disclosure can matter with partners/investors/customers | Use factual disclosure draft; avoid overclaiming | Is this disclosure sufficient for IP representations? |
| Project package/license metadata unclear | Root `package.json` has no clear project license field; no root `LICENSE` found | Private/proprietary status and third-party notices should be explicit before partner/public sharing | Decide proprietary notice, contributor ownership, and third-party notice approach | What should the app/repo copyright and license notice say? |

## P2 / Cleanup / Polish

| Risk | Evidence | Why it matters | Suggested next action | Question for Carter/lawyer |
|---|---|---|---|---|
| `.DS_Store` exists locally in assets | `assets/.DS_Store` appears in filesystem but is not tracked by git in this audit | Not legal risk by itself, but clutter can leak local metadata if committed | Keep ignored; remove locally in a cleanup-only task | Any concern if local metadata files were ever published? |
| Nonstandard license strings in transitive packages | Installed metadata includes strings such as `BSD`, `public domain`, and license object metadata | Notice generation may need normalization | Normalize third-party notices before public distribution | Are these notice strings acceptable? |
| Social/product external links imply affiliation/endorsement questions | `index.html` links to eBay, AllTrails, Facebook, Instagram, YouTube, TikTok, usbarkrangers.com | External links may imply partnership, affiliate, brand, or endorsement relationships | Confirm link permissions and affiliate/disclosure needs | Do any outbound links need disclaimers? |
| Internal docs mention launch/payment/legal risks | `plans/`, `docs/audits/`, `HARDENING_PROGRESS.md` | Not a product issue, but external sharing should be curated | Share only final diligence packet/report with lawyer; keep raw engineering notes internal unless requested | What docs should be shared externally? |
