# How much code can this plan remove?

**Planning estimate: about 18,100 fewer maintained runtime lines, or 36%, for the consumer app plus backend.** The iOS app itself is estimated at about half the current consumer frontend's size. Broader retirement of historical web releases could remove about **46,100 lines, or 58%,** from the currently measured app/functions source tree.

These are different comparisons. The larger number includes retirement of preserved release source; it is not entirely an architectural improvement. **Zero application lines have been removed today.** Only planning documents were created or revised.

## Measured baseline

| Current scope | Files | Physical lines | Nonblank lines |
|---|---:|---:|---:|
| Latest beta consumer dependency set, 0.145 | 75 | 39,957 | 35,178 |
| Functions production modules, tests excluded | 19 | 10,039 | 9,073 |
| Comparable consumer + backend baseline | 94 | **49,996** | **44,251** |
| All app-tree first-party HTML/CSS/JS, including older releases/admin/legal | 106 | 69,512 | 61,435 |
| All app-tree source + functions production | 125 | **79,551** | **70,508** |

The 31 app files outside the beta dependency set total 29,555 lines. Of those, **1,054** are retained admin pages, **449** are retained legal pages, **130** are a legacy trophy fragment, and **27,922** are other entry/release/runtime source. Some are still production dependencies or immutable cache artifacts; their presence is not evidence they are safe to delete now.

Counting method and every measured file appear in [CURRENT_SOURCE_INVENTORY.md](CURRENT_SOURCE_INVENTORY.md). Physical lines include comments and whitespace; nonblank lines are a secondary sanity check. No claimed executable-SLOC figure is fabricated. Before/after percentages use the same physical-line convention.

## Proposed native budgets, summed from every mapped file

| Swift responsibility group | Files | Planning lines |
|---|---:|---:|
| Domain values and pure rules | 18 | 3,050 |
| App assembly/startup | 7 | 920 |
| Catalog data pipeline | 5 | 950 |
| Personal persistence/sync/recording storage | 11 | 2,720 |
| Apple/Firebase/account/platform adapters | 18 | 3,500 |
| Discovery/map | 12 | 2,270 |
| Trips | 8 | 1,530 |
| Passport/leaderboard | 6 | 1,190 |
| Expeditions/recording | 6 | 1,380 |
| Account/settings/support/home/sharing | 12 | 2,500 |
| Shared activity contract + extension | 2 | 300 |
| **Total production Swift** | **105** | **20,310** |

The function/file map has no hidden generic service layer or unbudgeted watch app. Health workout import, motion source selection, sharing and the offline outline are included. The dedicated migration archive/importer and separate legacy/store-migration scaffolding were removed; normal field decoding remains in CloudUserDecoder. Resources and configuration are separately inventoried; their bytes/lines are not passed off as executable Swift savings.

## Revision from the earlier blueprint

The six-phase revision removes five proposed Swift files: the account archive model, archive import service/screen, separate legacy decoder and speculative store-migration file. Ordinary conversion is consolidated into CloudUserDecoder, and the unnecessary account-archive export action is removed. A concrete purchase-context operation is now explicitly budgeted in the existing cloud client/backend purchase module so account-token setup is not hidden work. Net change from the earlier estimate: **five fewer Swift files, 660 fewer Swift lines, 50 additional backend lines, and 610 fewer comparable runtime lines**. These remain estimates, not code deletions.

## Conservative full-feature comparison

| Runtime scope | Current | Planned | Reduction |
|---|---:|---:|---:|
| Consumer frontend / native Swift app and activity extension | 39,957 | 20,310 | **19,647 fewer (49.2%)** |
| Functions backend | 10,039 | 11,497 | **1,458 more (14.5% growth)** |
| New catalog-publication signal script | 0 | 130 | 130 more |
| **Comparable runtime total** | **49,996** | **31,937** | **18,059 fewer (36.1%)** |

The backend forecast is deliberately honest. There are 35 proposed cohesive modules totaling 11,497 budgeted lines. StoreKit verification, provider grant resolution, idempotent native mutations and catalog publication add necessary behavior while ORS and some browser-specific work leave. Preserving existing billing, support, admin and business reports prevents a large backend deletion claim.

Lower backend **cost** is still plausible through fewer routing calls/warm instances, public catalog assets, coalesced publication and fewer repeated writes. It must be measured. Backend source length, backend endpoint count, request volume and monthly cost are not interchangeable metrics.

## Broader source-tree retirement

| Source tree comparison | Lines |
|---|---:|
| Current first-party app tree + functions | 79,551 |
| Planned native Swift + backend + new catalog signal | 31,937 |
| Retained existing admin/legal pages | 1,503 |
| Future compared total | **33,440** |
| Potential source-tree reduction after retirement gates | **46,111 (58.0%)** |

This broader reduction decomposes exactly into **18,059** runtime redesign lines plus **28,052** historical/legacy lines (27,922 other release source + 130 old trophy fragment). Do not add the frontend reduction again, subtract tests, or count vendored libraries/JSON assets as original authored business logic to inflate the result.

If the full consumer web app remains supported indefinitely, its source cannot be counted as removed. An iOS-only main application can coexist with retained admin, legal, support and subscriber-management web pages. The user's feature preservation requirement is not automatic authorization to end web support; a later rollout/retirement plan must decide that explicitly using observed users and a suitable transition path.

## Forecast uncertainty

These budgets are a design estimate, not compiled code. Use **±20% for native Swift**, **±15% for backend**, and **100–160 lines for the trigger** until the first account/settings sync slice in phase 3 and visit slice in phase 4 are measured.

| Scenario | Native Swift | Backend | Trigger | Total | Reduction from 49,996 |
|---|---:|---:|---:|---:|---:|
| Lower implementation size | 16,248 | 9,772 | 100 | 26,120 | 23,876 (47.8%) |
| Planning midpoint | 20,310 | 11,497 | 130 | 31,937 | 18,059 (36.1%) |
| Higher implementation size | 24,372 | 13,222 | 160 | 37,754 | 12,242 (24.5%) |

The range excludes a watchOS app, fully downloadable street/topographic maps, two-way synchronization to a new database, and a complete rewrite of the admin web tool. Those are explicitly outside this migration. Exact topographic cartography would require its own provider/design/size decision; Apple elevation is a native presentation change, not identical imagery.

Backend consolidation may fail to remove some planned duplication once output parity is tested. Conversely, measured native adapters may be smaller than these conservative budgets. Recount after phase 3 and before any retirement commitment.

## What is actually removable, and when

| Work currently maintained | Native replacement / gate |
|---|---|
| 7,105 CSS lines in active beta dependencies | SwiftUI/native views included in the new estimate; remove CSS only once corresponding web release is unsupported. |
| 1,964-line beta HTML shell | Native screen hierarchy and resources; browser markup/event bindings leave with the web consumer. |
| Service-worker installation, immutable HTML selection, CDN fallback, cache manifests | App Store app bundle + atomic catalog files; existing installed workers still need preserved old resources during coexistence. |
| Browser viewport, keyboard, Safari return, touch-cancel and Android recovery | Native lifecycle/safe area controls; retain behavioral accessibility/return tests. |
| Leaflet/Turf/markercluster lifecycle logic | MapKit bridge, native clustering and a small trail interpolation policy. Vendored libraries were never included in the authored-line baseline. |
| Client CSV parsing, repeated normalization and full-sheet polling | Shared publication/validation plus small manifest requests. Client validation remains necessary. |
| ORS proxy, snapping/recovery, compact route response, provider retry telemetry | Native search/directions preview and Apple Maps handoff; remove ORS code/resources only after old callers retire. |
| Repeated auth/UI/premium refresh glue and global DOM registries | AccountSession, one entitlement publisher, scoped observation and typed feature models. |
| Duplicate visit cache/journal/reconciliation responsibilities across services | One LocalStore + outbox + SyncEngine; **do not remove** durable save/server acknowledgement semantics. |
| Old entry points and preserved versioned modules | Remove after migration/rollback gates; those are the separately stated historical-source savings. |

## Tests, tools, configuration and transition costs

Existing backend tests contain **10,147 lines** and root tests/support/fixtures contain **29,015 lines**, totaling **39,162**. They are not included in the runtime savings. New native tests are likely another 6,000–10,000 lines, plus approximately 2,000–4,000 lines of added backend/contract tests; these are rough separate allowances, not file-budgeted runtime reductions. Keep the web suites until the web platform retires. Do not reduce tests to improve the percentage.

Existing tools total 3,475 lines and rules total 201 lines under the measurement convention. Unchanged tools and admin/legal pages cancel when included on both sides. The new 130-line catalog script is explicitly included above so publisher work is not hidden. Xcode/config/CI/privacy/resource metadata and documentation have separate inventories but no speculative line target; do not pad a code-reduction claim with those generated formats.

During coexistence, the repository will grow: old consumer source, native source, temporary ORS/catalog compatibility and added tests coexist. No migration exporter/importer is in this build. Local catalog/emulator development tools and phase handoffs are accounted for separately from production runtime. No immediate decrease or cost reduction is promised during that period.

For a hiring portfolio, the useful outcome is a reviewer-readable codebase around clear responsibilities, deterministic tests and measured behavior. The target is not the fewest possible lines. In this plan, the defensible midpoint is **about 18,100 runtime lines removed**, while preserving the requested features and strengthening the offline/tracking architecture.
