# Prompt 2 — Catalog and discovery

## Activation and objective

On an explicit **“start phase 2,”** read [the shared execution contract](../IMPLEMENTATION_PHASES.md), phase 1's report, [architecture](../ARCHITECTURE.md) and the relevant file maps. Resolve outstanding foundation regressions before proceeding. Implement this phase only.

Give the user real parks on every first launch, fast validated updates when reachable, native map/discovery and complete park details. Catalog startup cannot depend on signing in. Provide reproducible local refresh tests without deploying a publisher or modifying the real spreadsheet.

## Source behavior to preserve

Read the current `dataService.v143.js`, `mapEngine.v143.js`, `renderEngine.js`, search/filter/config modules and official fallback assets listed in [the source inventory](../CURRENT_SOURCE_INVENTORY.md). Preserve stable IDs, categories, swag, aliases, approved links and every detail field. The measured bundled fallback has 393 rows; 399 is an example, never a fixed count. Preserve visit/trip filter semantics in the pure filter contract using input ID sets, while interactive personal features arrive in phase 4.

Review publisher input header variants and the existing `catalogSnapshot`/`dataIntegrity` guards. Derive the bundled snapshot from an explicitly identified checked-in approved source; record source/version/date and do not label it the latest live sheet unless verified. Any conversion must be reproducible using the publisher's schema, not an unrelated second parser.

## File ownership

| New/extended files | Operations for this phase |
|---|---|
| D01; new D02, D08, D10–D11 | Complete Park/CatalogSnapshot/manifest contract; device settings; one pure filter/count result; immutable local search index. `ParkFilter.apply` takes visited/trip ParkID sets, defaulting to empty during this development phase. |
| New C01–C04 | CatalogRepository owns revision/refresh coalescing; HTTPClient owns conditional HTTP/deadlines; DiskStore owns atomic current/previous/bundle storage; Validator owns whole-snapshot acceptance. |
| A01–A07 | Replace shell-only startup with the real local-first state machine. Add catalog lifecycle/reconnect handling and real discovery routes, keeping auth absent from the dependency chain. |
| New P18 and P16 | Network path hints and an offline geographic outline/opaque background. The monitor does not prove server reachability. |
| New P08 and P13 | LocationClient's bounded one-shot locate request; MapsHandoff's single-park Apple Maps action. No background location mode yet. |
| New M01–M12 | Map screen/model, one MapKit bridge/coordinator, annotation/overlay rendering, filters/summary, complete detail screen/model and local search screen/model. ParkDetailModel loads/navigates now; visit/trip/correction submission actions arrive in 4–5. |
| New U08 and F04–F05; extend F12 | Device-only settings, catalog status/manual refresh, static Home/education, bundled legal/attribution access. No cloud save or personal store yet. |

Add the catalog, education, legal, attribution and offline-geography resources and necessary location-on-action wording. Keep source licensing/provenance with assets. Do not add a custom tile downloading service. There must be an accessible local results list as well as pins, including when imagery cannot load; keep its small layout within existing discovery views unless a separate responsibility justifies a mapped file.

Backend: implement B21–B24's source/schema/publisher/signal responsibilities, with only necessary registry/config/auth integration. Add the narrow B35 publication signal after an accepted admin write. Implement the separate `catalog-publication` Apps Script source/config/README. Preserve old CSV endpoints, snapshots, ORS, admin review behavior and all exported names. Write the catalog-publication runbook with local verification, eventual configuration, validation and manifest rollback procedures. Code and tests are local; do not deploy functions, install triggers or change the real sheet.

## Behavior and call sequence

1. `StartupModel → CatalogRepository.loadLocal → CatalogDiskStore/CatalogValidator`. Choose the newest compatible validated revision among disk/previous/bundle. First launch offline always has catalog records. Invalid personal state is irrelevant here.
2. Independently start one conditional manifest attempt. A changed supported revision triggers bounded download → full hash/schema/identity/count validation → atomic disk commit → one published snapshot. No partial rows, authentication wait or repeated CSV parsing on the phone.
3. Use the proposed three-second network-decision budget. Reveal fresh data if accepted in time; otherwise reveal valid local data and continue recovery. Offline can take the fast path. Stalled response bodies and captive portals obey the deadline too. Show truthful saved/fresh status, with no artificial spinner duration.
4. Refresh on eligible foreground, explicit action and reconnect **even when valid parks already exist**. Coalesce requests and respect jitter/backoff/Retry-After. Successful regular checks while browsing are at most once per minute; reconnect can retry sooner. Later snapshots preserve filter state, selection and camera.
5. `MapFeatureModel → ParkFilter/ParkSearchIndex` derives one coherent set of matching IDs/counts. `NativeMapView → MapCoordinator` updates existing annotations by ID. Counts represent matching catalog records; no filter Live Activity or notification is created.
6. Details retain fees, swag locations, approved areas/trails, restrictions, hazards, extra swag and source links. Directions use safe URL construction. Browsing does not prompt for location; Locate Me prompts on action. Town search and live personal filters become operational with their later account/trip dependencies.
7. Publisher reads source rows once, validates and uploads immutable content before promoting the manifest with a generation precondition. Rejected/concurrent publication leaves the previous accepted pointer. Signal/API-write/reconciliation paths reuse it. Ordinary phone freshness checks read public assets, not a function or Firestore park documents.

Do not weaken the loader requirement to “internet connected means fresh.” Only an accepted response proves freshness. Street-level Apple imagery is best effort offline; the bundled geographic overview and local records provide the offline guarantee.

## Development setup and AI verification

Create the development-only `serve-ios-catalog.js` fixture server and fixture cases for unchanged, valid update, malformed/shrunk/hash-mismatched update, stalled body and recovery. Keep its scenario control out of release UI. Provide exact start/stop and device-connection instructions. Publisher cloud-generation semantics may use a faithful fake where emulators lack support; record that limitation rather than claiming cloud verification.

Run CatalogIdentity, ParkFilter, ParkSearch, Startup, CatalogPersistence, MapPresentation, single-park MapsHandoff, OfflineLaunch and Discovery tests appropriate to implemented behavior. Add backend publication/signal and Apps Script tests plus `.github/workflows/catalog-checks.yml`; backend test CI must not publish data. Test interrupted disk commits, newer bundle over older disk, invalid revision retention, repeated reconnect with existing data, cancellation and annotation stability. Keep all current web tests intact.

Measure local-ready and loader dismissal separately on available devices/simulators; report actual measurements and platform. Exercise the full public fixture and a synthetic 5,000-record catalog, territories/antimeridian, zero matches, large text and repeated filters. Inspect a running map visually. No staging/production load test or live sheet edit is authorized.

## User testing checklist

| User action | Expected result |
|---|---|
| Fresh install and launch in airplane mode. | Bundled parks, searchable details and an offline overview appear without sign-in. |
| Browse, change filters, select a park and restart offline. | Valid local data and supported preferences remain available; count matches results. |
| Use the provided local valid-update scenario. | If accepted within the loader budget, the first revealed catalog is fresh; otherwise saved data opens and refresh completes visibly. |
| Keep valid parks loaded, lose/recover connection and publish a fixture revision. | Refresh occurs without requiring an empty catalog or resetting selection/filters. |
| Use slow/broken/invalid update scenarios. | Loading remains bounded; accepted local data survives. |
| Search names/abbreviations, get zero results, inspect all detail fields. | Results/counts/details agree; empty filters never mean the catalog vanished. |
| Deny Locate Me, then use Apple Maps directions and return. | Browsing remains usable; permission/launch failure is clear; navigation state survives return. |

## Completion and stop

Deliver phase 2's report, catalog provenance, actual test/latency evidence and simple local refresh instructions. Clearly identify unverified live publisher setup and later personal/town-search actions. Remove obsolete shell placeholders for areas now complete. **Stop for user testing and fixes; do not start phase 3.**
