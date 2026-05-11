# Asset And Data Source Audit

Date: 2026-05-09
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1699a921928086b5b81e6bb48bee6be0691cfa88`

This is a diligence inventory, not a legal conclusion.

## Non-Code Assets And Data Files

| File/path | Type | Source if known | License if known | Attribution requirement if known | Used where | Risk | Notes/questions |
|---|---|---|---|---|---|---|---|
| `assets/images/USBarkRangerLogoWatermark.jpeg` | Image/logo/watermark | UNKNOWN | UNKNOWN | UNKNOWN | Public branding/share/account imagery likely | High | Confirm creator, owner, brand permission, and app/payment/marketing use. |
| `assets/images/WatermarkBARK.PNG` | Image/logo/watermark | UNKNOWN | UNKNOWN | UNKNOWN | `modules/shareEngine.js` watermark | High | BARK/brand asset; needs ownership and trademark review. |
| `assets/images/bark-logo.jpeg` | Image/logo | UNKNOWN | UNKNOWN | UNKNOWN | App icon/branding via manifest/UI | High | Confirm not copied from third-party/public agency/stock source. |
| `assets/images/bark-tag.jpeg` | Image/logo/tag | UNKNOWN | UNKNOWN | UNKNOWN | App/brand imagery | High | Confirm creator/permission. |
| `assets/data/bark-fallback.csv` | CSV data | Likely local fallback for Google Sheet data; exact source UNKNOWN | UNKNOWN | UNKNOWN | `modules/dataService.js` fallback | High | Need row-level source/provenance, contributor permission, attribution/redistribution rights. |
| `BARK Master List.csv` | CSV data | UNKNOWN | UNKNOWN | UNKNOWN | Data/source artifact | High | Need source and whether it contains copied public/web/user data. |
| `data/data.csv` | CSV data | UNKNOWN | UNKNOWN | UNKNOWN | Data artifact | High | Needs provenance and permission review. |
| `data/data.json` | JSON data | UNKNOWN | UNKNOWN | UNKNOWN | Data artifact | High | Needs provenance and permission review. |
| `data/sheet_data_fetched.csv` | CSV data | Likely fetched from Google Sheet; exact source UNKNOWN | UNKNOWN | UNKNOWN | Data snapshot | High | Confirm whether cached public Sheet data can be stored/redistributed. |
| `trails.json` | JSON trail/route data | UNKNOWN | UNKNOWN | UNKNOWN | Virtual trail/route features | Medium/high | Confirm route/trail source, whether copied from AllTrails/parks/maps/websites. |
| `manifest.json` | App manifest | Internal | N/A | N/A | Browser install metadata | Medium trademark | Uses `US BARK Rangers` brand and app icons. |
| `assets/.DS_Store` | macOS metadata | Local machine | N/A | N/A | Not app-useful | Low cleanup | Present locally under `assets`; not tracked by git in this audit. Do not commit. |

## External Data Sources

| Source | Evidence | Data used | Risk | Questions |
|---|---|---|---|---|
| Google Sheets published CSV | `modules/dataService.js` published CSV URL | Park/pin catalog data | High | Who owns the Sheet? Who contributed rows? Can the app cache/serve it? Any personal data? |
| Static fallback CSV | `assets/data/bark-fallback.csv` | Offline/catalog fallback | High | Is it derived from the Google Sheet or copied from another source? |
| OpenStreetMap tiles/data | `modules/mapEngine.js` OSM attribution | Map background | Medium/high | Are attribution and tile usage terms satisfied for paid/public app traffic? |
| OpenTopoMap tiles | `modules/mapEngine.js` OpenTopoMap URL/attribution | Map background/topography | Medium/high | CC-BY-SA map style/data attribution and usage limits need review. |
| Esri tile services | `modules/mapEngine.js` Esri tile URLs/attribution | Satellite/street map backgrounds | Medium/high | Confirm Esri tile terms for public/commercial app. |
| OpenRouteService | `functions/index.js`, `services/orsService.js` | Routes/geocoding; user search/routing inputs | Medium/high | Terms, attribution, rate limits, privacy disclosures. |

## UI Attribution Notes

Found map attribution strings in `modules/mapEngine.js` for:

- OpenStreetMap contributors
- OpenTopoMap / SRTM
- Esri and named data suppliers

Needs manual UI verification:

- Attribution remains visible on desktop/mobile map.
- Attribution is visible in screenshots/share outputs if required.
- Route/geocode provider attribution is shown where required by OpenRouteService terms.

## Brand / Logo Questions

Bring to lawyer:

1. Who owns each logo/watermark/image file?
2. Are any logos derived from official B.A.R.K. / NPS / park / public agency marks?
3. Is `US BARK RANGERS®` a registered mark owned/licensed by Carter or USBARKRANGERS LLC?
4. Can these assets be used in a paid app, app icon, payment checkout, email/support, and social previews?
5. If a partner relationship ends, who retains rights to app branding and user/customer lists?

## Data Provenance Questions

1. Were park names, coordinates, notes, or tags copied from websites, park pages, Google Maps, Facebook posts, AllTrails, or other databases?
2. Were contributors told their submissions may be used in a paid app?
3. Does the app need to attribute data contributors or source organizations?
4. Can Carter publish/cache the Google Sheet data in Firebase Hosting/static CSVs?
5. Are there inaccurate/unsafe fields that could create liability if users rely on them?
