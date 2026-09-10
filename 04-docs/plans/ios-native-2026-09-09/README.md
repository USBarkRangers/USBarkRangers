# Bark Ranger: native iOS build blueprint

Prepared September 9, 2026 from working-tree source at commit `8451e06`; six-phase workflow revised September 10, 2026. The original blueprint was planning only. Phase 1 was explicitly started on September 10; see the current status and evidence below. Infrastructure, accounts, payments and deployments remain unchanged.

## The recommendation

Build a native iPhone app in **Swift and SwiftUI**, with **MapKit**, **Core Location**, **ActivityKit**, and **StoreKit 2**. Keep Firebase Authentication, Firestore, and a reorganized JavaScript functions backend in **`barkrangermap-auth`**. Build and test the native app while the existing web app remains in place. Plan distribution and moving users separately after the build.

Your confirmed requirements are to preserve existing users and features, and choose the backend on efficiency, speed, cost, and scaling. Replacing the backend language does not itself improve those things. Removing unnecessary requests, route proxies, repeated catalog parsing, and competing state owners does. Firebase's supported Functions languages do not include Swift; moving to a Swift server would introduce a separate container deployment and server SDK integration problem. That is not recommended for this migration. [Firebase Functions](https://firebase.google.com/docs/functions), [Hosting backend options](https://firebase.google.com/docs/hosting/serverless-overview).

**All new iOS application logic is Swift.** JSON assets, Xcode configuration, Firebase rules, CI configuration, and the retained backend are necessarily separate from Swift application source. No web views host core app screens.

## Workspace preparation

September 10: the user requested Xcode/GitHub preparation before phase 1. A [buildable starter project](../../../01-code/ios/README.md) now exists in the planned iOS folder on `codex/ios-native-setup`. The earlier no-code statements describe creation of this blueprint; the subsequent setup reused the existing Desktop template. The subsequent phase-1 build replaces that template; [the phase report](../../reports/ios-native/PHASE_1.md) records implementation and testing. User migration has not started.

## Six builds, with your testing between them

Start with [the six implementation phases and prompts](IMPLEMENTATION_PHASES.md). Each prompt names its files, staged operations, call paths, backend changes, AI checks, your testing checklist and an explicit stop. Complete one phase, test it, fix what you find, and only then explicitly start the next. Phase 1 was explicitly started by the user on September 10 ("do phase 1"). Its [report](../../reports/ios-native/PHASE_1.md) and the status table are the current handoff; phases 2–6 remain unstarted.

Existing accounts, memberships and saved formats stay in place. Ordinary decoding reads them. Archive import/export for migration, a dedicated legacy-conversion layer and speculative migration scaffolding were removed. A small durable offline queue remains because it is needed for everyday saves. Journaling, customer transfer and server data restructuring are later decisions.

## Read this plan in this order

| Document | What it answers |
|---|---|
| [Six implementation phases and prompts](IMPLEMENTATION_PHASES.md) | What to build in each of the six prompts, dependencies, testing handoffs and when to stop. |
| [Architecture and behavior](ARCHITECTURE.md) | Exactly how launch, offline updates, account isolation, maps, tracking, purchases, and sync work. |
| [Every proposed Swift file](SWIFT_FILE_MAP.md) | Each production Swift file, its functions, allowed dependencies, responsibility, phase, and estimated size. |
| [Backend file and endpoint map](BACKEND_FILE_MAP.md) | What remains, what changes, what can eventually be retired, and how spreadsheet publication becomes cheaper. |
| [Build support and test inventory](BUILD_AND_TEST_INVENTORY.md) | Planned test/resources/configuration, verification cases and existing-data preservation; later rollout is outside the build. |
| [Code reduction estimate](CODE_REDUCTION.md) | Measured baseline, proposed budgets, honest savings, and what is excluded. |
| [Current source inventory](CURRENT_SOURCE_INVENTORY.md) | Per-file measured lines and the distinction between the beta entry's dependencies and other maintained source. |

The file map is a proposed implementation contract. Function names describe responsibilities and call paths; they are **not implementation code**. Private helper names should follow actual implementation needs rather than being invented prematurely. Public entry points, state ownership, persistence ownership, and cross-file calls are mapped here.

## Decisions that keep the code understandable

1. One local source of truth for personal records: a user-scoped SwiftData store, with durable pending operations. Firestore is the server authority; its client cache is not a competing offline journal.
2. One immutable, validated park catalog shared across the app. Park data never contains a marker, view, user visit, or trip editing state.
3. One composition root creates dependencies. Screens receive the few collaborators they need; nothing resolves dependencies through a global container.
4. Small feature models coordinate actions; views render state. Views do not write Firestore, parse sheets, calculate scores, or request purchases directly.
5. Pure policies own identity, filtering, scoring, itinerary boundaries, and expedition arithmetic. They can be tested without a phone, network, map, or Firebase.
6. Native adapters own Apple and Firebase APIs. A single MapKit bridge preserves clustering and overlays without making every screen understand UIKit.
7. One pending-operation queue handles offline personal writes. Every success message distinguishes **saved on this iPhone** from **synced to your account**.
8. Existing business rules remain explicit. Five free visits, Premium access, earned badge dates, old billing providers, and historical scores are preserved unless a later product decision changes them.

## Native feature decisions

| Current feature | Native destination | Important qualification |
|---|---|---|
| Leaflet map, clusters, markers | `MKMapView` inside one SwiftUI bridge | MapKit manages clustering and rendering; Bark still owns selection and annotation identity. |
| Directions and generated routes | Apple Maps handoff; `MKDirections` for in-app previews | Apple routing needs successful service access and can throttle. It does not provide a free traveling-salesperson optimizer. |
| “99 of 399 parks” | Accessible in-app filter summary | Counts come from the accepted catalog, never a hardcoded 399. A persistent filter count is not a suitable Live Activity. |
| Active expedition/walk banner | Live Activity on Lock Screen and Dynamic Island | Only a real, user-started session; always retain in-app controls and progress. |
| Browser walk tracking | Core Location background session | Durable recovery is still necessary; force-quit and denied permissions are real limits. |
| Optional step-based mileage | Core Motion `CMPedometer` | Alternative source for an explicit session; do not add it on top of GPS distance. |
| Optional import of Apple workouts | HealthKit | Permission-based import, deduplicated by workout identity; no automatic sharing of raw Health data. |
| Photo watermark and cards | PhotosPicker, Core Graphics/ImageRenderer, share sheet | Preserve positioning, resizing, export, QR, and all current share-card content. |
| New iOS purchases | StoreKit 2 | Keep existing Lemon Squeezy subscribers entitled; do not double-bill or pretend their subscriptions moved to Apple. |
| Admin refinery and support operations | Existing restricted web tools/backend | Preserve their functions; they do not need to become phone screens. |

Apple documents Live Activities as bounded, ongoing tasks. The plan therefore deliberately keeps filter status in the map while using Dynamic Island for an active walk. This is the practical platform adjustment to your proposed placement. [Live Activities design guidance](https://developer.apple.com/design/human-interface-guidelines/live-activities).

## What “offline first, fresh when available” means

On every cold launch, the app opens its local catalog and personal store first. A validated catalog ships inside the app, so **even a first launch in airplane mode has parks**. While a SwiftUI loading screen is visible, one bounded network attempt checks the published catalog version and downloads a changed catalog. If it finishes in time, the first revealed screen has the fresh data. If it fails or stalls, the screen reveals local data and continues recovery without blocking the user.

The proposed launch budget is **3 seconds for the network decision**, with a fast offline path after local loading. That is a target to measure on devices, not a claimed result. Cellular bars cannot guarantee a working endpoint, and no design can promise both indefinitely fresh data and a bounded launch during a service failure. The detailed state machine handles that explicitly.

Offline **park records, search, filters, saved visits/trips, education, and session persistence** are guaranteed by bundled/local storage. Apple street imagery is not guaranteed offline. A small bundled geographic outline layer provides context when necessary; Apple Maps downloads are not treated as an app-controlled cache. [Apple MapKit engineer explanation](https://developer.apple.com/forums/thread/772258).

## What the source review found

The latest beta entry is `01-code/app/index.v145.html`, selected by the root landing page. `firebase.json` still redirects production to `index.v142.html`. Neither was changed. This plan uses beta 0.145's improved offline behavior as the migration reference while retaining production compatibility.

The consumer beta dependency set contains **39,957 physical lines** of first-party HTML, CSS, and JavaScript, including its service worker and release manifest. The functions backend contains **10,039** physical lines, excluding tests. The comparable consumer-plus-backend baseline is therefore **49,996 lines**. Additional admin/legal pages, older entry points, tests, tools, data, and vendored dependencies are accounted for separately in the reduction report.

The problem is not simply file length. For example, the 1,839-line Firebase service coordinates storage, canonical IDs, journals, server proof, UI refresh, routes, and settings. The 1,778-line trip planner mixes itinerary editing, route requests, and rendered controls. The 4,634-line backend entry mixes billing, routing, support, admin ingestion, monitoring, and exports. The plan separates these responsibilities while retaining the hard-won data integrity behavior.

Do not delete the legacy code to make the graph look better before users can safely move. The measurable cleanup happens after compatibility and retirement gates pass.

## Estimated result

The revised map proposes **105 production Swift files**, **35 cohesive backend modules**, and explicit test/resource inventories. These are final ownership targets, not files to create up front. Summed budgets estimate **20,310 Swift lines** and **11,497 backend lines**, plus a small catalog-publication trigger. Compared with the current active consumer/backend baseline, the future replacement is about **18,100 runtime lines smaller (36%)**. The frontend itself is about **49.2% smaller**; the backend may grow because native purchases and reliable write handling add responsibilities.

After supported older web releases can separately be retired, the broader source-tree reduction could reach **46,100 lines (58%)**. This includes historical release source; it is not a deletion promised by the six build phases. While both apps remain, the repository grows. See [CODE_REDUCTION.md](CODE_REDUCTION.md) for uncertainty and the distinction between replacement size and actual removal. No application code has been created or deleted by this planning work.
