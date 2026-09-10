# Native iOS maintainability audit — September 10, 2026

**Current assessment: build 0.2.5 (7), after the focused correction pass. No remaining blocker from this review before Phase 3.** Phase 3 itself has not started. The original 0.2.3 inspection and the 0.2.4 ranking are preserved below as historical evidence.

| Assessment | Current score | Reason |
|---|---:|---|
| Overall code quality | 8.5 / 10 | Corrected state/task ownership and measured update boundaries; no broad rewrite. |
| Spaghetti-code risk | 2 / 10 | Low current tangling. Ten means severely tangled. Future features must keep their own business owners. |
| Maintainability | 8.5 / 10 | One explicit query source, one selected Park, bounded task ownership and regression coverage. |
| Architecture clarity | 8.5 / 10 | Mutable authorities and derived projections are now distinguishable; no new global service or event framework. |
| Performance / efficiency | 8 / 10 | Search/filter computation is off MainActor; geometry-only map work is constant with respect to catalog size. Physical-device rendering remains unprofiled. |

Scores are engineering judgments, not production certification. The implemented runtime is 48 Swift files / 3,237 physical lines; the largest file is CatalogRepository at 207 lines, followed by MapFeatureModel at 191. This is 172 net runtime lines over 0.2.4, mostly explicit cancellation/diagnostic handling and the immutable background projection. SearchModel was removed and ParkResults added: no net runtime-file increase. Test code is 15 files / 1,759 lines. A strict line ceiling would have made these corrections harder to follow; no coherent owner was split merely to reduce its line count.

## Focused findings and resolution

| Finding | Correction and regression evidence | Status |
|---|---|---|
| Selected identity/details/Directions could diverge or outlive their selection. | ParkDetailModel.park remains the sole selected Park; selectedID derives from it. Directions captures that Park synchronously, owns its task, and cancels queued work/late completions when selection changes, closes or stops. Tests cover A→B, queued dismissal, accepted catalog facts changing while selected, and an old handoff failure arriving while a newer action is busy. | Corrected |
| Search/filter work had duplicate paths and reacted to camera/units writes. | setFilters only writes SettingsRepository. The settings/catalog observers feed one revision+query gate. An owned task computes one immutable ParkResults off MainActor; obsolete/cancelled completions cannot publish. SearchModel’s copied mutable query is gone. Tests count exactly one computation per effective changed input, no extra computation for camera/units/map style/clustering/status/unchanged query, and correct reset/restart behavior. | Corrected |
| Sheet geometry entered full marker reconciliation. | MapCoordinator checks an annotation version and clustering before touching park arrays or marker views. A new catalog revision or changed matching IDs advances the version; a labels-only change does not. Selection, camera, attribution and sheet geometry remain independent native presentation work. Actual MapKit lookup/mutation counts verify the boundary at 393 and 5,000 records; identity survives filtering and refresh. | Corrected |
| Failures all looked alike internally. | Diagnostics accepts only fixed stage/reason enums. Disk read/decode, validation, transport, timeout, Retry-After, commit and cancellation categories retain the current simple fallback. Missing first-launch cache files are quiet. Catalog-specific classification stays in the catalog owner; the logger does not depend back on services. Tests verify emitted categories and retained accepted records. | Corrected |
| Stop/restart ownership had cancellation gaps. | AppLifecycle retains and orders catalog-stop completion before new foreground startup/polling. CatalogRepository clears only the matching request and refuses already-cancelled callers. SettingsModel owns queued manual refresh. Startup rechecks cancellation after its catalog read. Locate cleanup retains ownership until completion, and cancellation carries its request identity. Rapid lifecycle restart, manual-refresh cancellation and location replacement tests pass. | Corrected |

An Apple Maps request already handed to iOS cannot be recalled. The guarantee is that the action uses the Park displayed at invocation, queued cancelled work never submits it, and an obsolete completion cannot alter the current selection or action state.

## Authoritative state and call paths

- **Query/filter source:** SettingsRepository.value.filters. The view forwards edits; it does not hold another editable query. ParkResults.Input and requestedInput are immutable provenance/comparison keys, not independent writers.
- **Selection source:** ParkDetailModel.park. MapFeatureModel.selectedID is computed. Annotation/framing identifiers are native presentation caches and do not persist another selected Park.
- **Catalog source:** CatalogRepository’s validated accepted snapshot. Search indexes, catalog-ID sets, result arrays and map annotations remain derived values.
- **Result path:** settings/catalog change → effective-input comparison → owned task → ParkResults.compute → one atomic projection publication → count/list/pins.
- **Geometry path:** sheet height/camera/selection → MapCoordinator.apply → native presentation. The annotation gate returns before scanning/reconfiguring unchanged markers.
- **Directions path:** button intent → ParkDetailModel.navigate captures Park → owned task → MapsHandoff. The SwiftUI view no longer creates an unowned task.

No duplicate editable source of truth remains for selected park or search state. While a new background query computes, the previous complete projection remains visible briefly; it is replaced atomically only if its revision and query are still current. Cancellation checks occur between bounded computation stages; this is cooperative cancellation, not an attempt to interrupt a sort midway.

## Performance verification

The source uses the explicit [Swift `@concurrent` execution contract](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md). A plain async function would not be sufficient with this project’s approachable-concurrency configuration. Search, filtering, sorting and lookup construction execute off MainActor. MainActor still publishes the result and performs native MapKit work when marker inputs actually change.

Final Debug simulator measurements, with a main-actor progress task running during the computation:

| Records | Median projection time across tested queries | 300 geometry-only updates | Marker lookups / add-remove calls during those updates |
|---|---:|---:|---:|
| 393 bundled records | 3.15–4.43 ms | 45.99 ms total (about 0.15 ms/update) | 0 / 0 |
| 5,000 synthetic/public records | 12.99–29.30 ms | 57.53 ms total (about 0.19 ms/update) | 0 / 0 |

Queries include empty, broad “park”, “hulls cove”, no match and exact synthetic identity. Each query has five timing samples; matching counts and ordered IDs are checked against the returned parks. MainActor made progress for every case. These are simulator computation/update timings, not physical iPhone frame rates, network benchmarks or proof that rendering 5,000 markers never drops a frame. Initial/changed marker reconciliation remains an O(n) native main-actor operation; this pass removes repeated unrelated work rather than claiming that operation is free.

The optimized Release run also passed both record-count cases (`-O -whole-module-optimization`, with testability enabled): per-query medians were **1.52–2.26 ms for 393** and **6.74–15.73 ms for 5,000**. The largest individual sample was 3.02/17.00 ms respectively, off MainActor. Evidence: `/tmp/BarkCleanupReleasePerformance.xcresult` and `/tmp/bark-cleanup-release-performance.log`.

## Remaining concerns — none blocks the next phase

1. **Keep new feature ownership out of Discovery (ongoing design constraint).** MapFeatureModel and MapCoordinator remain the main growth watchpoints. Visits, scoring, trips, purchases and sync must have their own owners; none exists here yet.
2. **Physical-device profiling before release (4/10).** The automated checks cover result responsiveness and avoided annotation work. Initial MapKit rendering, older-phone GPU/frame behavior, actual iOS 18.4 and real cellular/provider performance remain separate device work.
3. **Optional colocation of sole-use views (3/10).** FilterSummaryView can live in FilterSheet; ParkDetailActions/Metadata can live in ParkDetailView. Keeping separate types is useful, but separate files are not required. No correctness issue justifies sweeping consolidation now. MapOverlayRenderer’s small styling boundary is defensible.
4. **Small synchronous bundled reads (2/10).** Home content and offline geography still read small local resources at construction. Avoid a caching/service framework unless profiling finds a meaningful delay. Existing bounded catalog reads/validation run in their actor.
5. **Minor test/API housekeeping (2/10).** Older unrelated tests still use a few fixed sleeps and do not consistently remove every temporary preference suite. New delayed-completion regressions use controlled continuations and owned-task completion; new shared fixtures clean up their resources. Unused small domain helpers can be removed when their owners are touched.

The composition root, Foundation-only domain, typed IDs, one settings store, actor-isolated catalog acceptance, atomic saved envelopes, native map identity/clustering, thumbnail replacement boundary and safe Maps URL construction should remain as they are. No mutable global, custom singleton, circular feature dependency, force unwrap, try!, fatalError, Firebase-in-view access, generic manager hierarchy, or multi-system button orchestration was found in the reviewed runtime.

## Verification and scope

Strict formatting and whitespace checks passed. Nine domain tests and 39 app tests passed (36 Swift Testing functions plus three XCTest cases). Nine relevant Pro UI scenarios passed, including live search/count/pins, filter persistence, large text, Apple Maps return, map gestures, three detents, background dismissal and navigation/relaunch. The final lifecycle UI rerun passed; optimized results are recorded in the current Phase 2 report. An earlier UI invocation was deliberately interrupted after discovering a test-build issue; it is not counted as passing evidence.

Reviewed the changed owners and their callers, then rechecked runtime state/task/platform-access patterns and unchanged shell/settings/map boundaries. No backend, live spreadsheet, customer, payment, deployment, migration or Phase 3 work was performed. Physical/provider certification and user acceptance remain pending as documented in Phase 2.

---

## Original 0.2.3 audit and 0.2.4 ranking — historical record


**Verdict:** the core architecture remains sound, but Discovery is beginning to accumulate unnecessary state coordination and file fragmentation. It is not spaghetti code. It does need a small corrective pass before adding accounts and personal data. Short files alone are not evidence of good separation.

The original audit is an inspection of build 0.2.3, not authorization to implement its recommendations. No app, test, project, backend, or deployment code was changed for that inspection. The final section records the subsequent user-requested UI work in 0.2.4, the related selection fix, and the remaining cleanup priorities.

**Scope and evidence**

- Inspected all 48 runtime Swift files: 3,046 physical lines, including the five BarkDomain source files. Discovery contains 23 files / 1,300 lines; nine files contain 35 lines or fewer. The largest runtime file is MapFeatureModel at 164 lines.
- Inspected the ten Swift test files, implemented ownership map, original architecture and Phase 2 contract, build configuration, and iOS CI workflow. Source baseline: `60c5c41`, build 0.2.3 (5). Pre-existing unrelated working-tree changes were preserved.
- Reran the nine BarkDomain tests successfully. Did not rerun the complete simulator suite or claim new device/CI verification.
- Ran a temporary, instrumented copy of the current model/repository code outside the repository. Instrumentation only counted rebuild calls. The Apple Maps opener used an injected closure; its UIKit default was replaced in the temporary copy so the harness could run on macOS. These are model-level probes, not reproductions of a human tapping the simulator at a particular instant.
- Measured the unchanged optimized domain search/filter code on this Mac, with the bundled 393 records and 5,000 synthetic records derived from their names and metadata. These are computation timings, not iPhone frame-rate measurements.
- Accounts, cloud sync, visits, trips, passport, achievements, leaderboard and tracking are not implemented yet. Their placeholder tabs cannot demonstrate that future cross-feature boundaries will remain clean.

| Assessment | Score | Interpretation |
|---|---:|---|
| Overall code quality | 7.5 / 10 | Good foundation with specific correctness and efficiency issues. |
| Spaghetti-code risk | 3 / 10 | Low current tangling; 10 means severely tangled. Discovery is the concentration of risk. |
| Maintainability | 7 / 10 | Most ownership is clear, but several state paths and tiny files add navigation cost. |
| Architecture clarity | 8 / 10 | Composition, domain, storage and native adapters remain distinguishable. |
| Performance / efficiency | 6.5 / 10 | Reasonable at today's size, with confirmed unnecessary work and a larger-catalog main-thread concern. |

These are engineering judgments about the implemented phases, not a mathematical certification or a score for the unfinished app.

**Five biggest findings, in priority order**

1. **Selected identity and displayed/actionable park are not updated as one coherent state. Fix before Phase 3.**

   [MapFeatureModel.selectPark](../../../01-code/ios/BarkRanger/Features/Discovery/MapFeatureModel.swift#L102) changes `selectedID` and the camera immediately, then creates an unretained task to call `detail.load`. [ParkDetailModel.load/navigate](../../../01-code/ios/BarkRanger/Features/Discovery/ParkDetailModel.swift#L18) retains the previous `park` until its separate repository read finishes. Directions reads that retained park.

   The probe loaded A, selected B and immediately called the existing Directions intent: selection was B while the detail and captured directions URL still referred to A. This establishes a model-level inconsistency window; it does not establish how frequently a person would hit it in the running UI. A busy catalog actor can widen that window.

   Task ownership is also incomplete: selecting a park and calling `stop()` before the queued load starts still allowed the load to publish afterward. `cancel()` invalidates an already-started load's token; a queued load subsequently creates a fresh token. Dismissal only clears `selectedID` and does not invalidate detail work.

   Prefer resolving the selected park from the already accepted snapshot synchronously, with one authoritative selected identity. If a separate asynchronous load remains necessary, own its task and invalidate selection, loading state, and actions together. No generic navigation or event framework is needed. Add regression coverage for A→B, selection→dismiss/stop, and refresh while selected.

2. **Preference observation causes duplicate and unrelated search/filter work. Fix before Phase 3.**

   [MapFeatureModel](../../../01-code/ios/BarkRanger/Features/Discovery/MapFeatureModel.swift#L73) observes `settings.value.filters`, but `value` is one observable struct property. Updating the camera or distance units replaces that same property. The callback does not compare the old and new filter query before rebuilding. `setFilters` also calls `rebuild()` immediately, so a genuine filter change reaches it through two paths.

   Instrumented results after allowing the observation callback to run:

   | Action | Search/filter rebuilds |
   |---|---:|
   | One changed search query | 2 |
   | Camera-only change | 1 |
   | Distance-unit-only change | 1 |
   | Submit the unchanged filters | 1 |

   One authoritative device-settings value is appropriate. The problem is the breadth of observation and lack of an effective-input equality check. Keep external preference resets working, while ensuring a catalog/query change causes one result computation and camera/units changes cause none. Do not introduce another preferences store to solve this.

3. **Map reconciliation runs through every matching park even for presentation-only changes. Fix the invalidation boundary before expanding Discovery.**

   [MapCoordinator.apply](../../../01-code/ios/BarkRanger/Features/Discovery/MapCoordinator.swift#L21) always calls `updateAnnotations`. That method builds ID sets, filters the annotation dictionary, visits every matching park and reconfigures materialized marker views. There is no change check for catalog revision, matching IDs, clustering or marker appearance.

   [ParkDetailSheet](../../../01-code/ios/BarkRanger/Features/Discovery/ParkDetailSheet.swift#L53) reports changing geometry to MapScreen, which forwards it through NativeMapView to the same broad `apply` method. Updating attribution margins while dragging therefore also takes the full annotation reconciliation path. Catalog status-only changes can invalidate the same path.

   This is **not** wholesale destruction/recreation of pins or MKMapView: stable annotation objects and add/remove set differences already work correctly. Preserve them. Add a narrow distinction between annotation changes and geometry/camera-only changes rather than replacing the map architecture.

   Search/filter work is also synchronous on MainActor. One optimized search-plus-filter pass on this Mac took roughly 1.4–1.9 ms for 393 records and 17–27 ms for the 5,000-record fixture across empty, broad, matching, typo and no-match queries. The confirmed duplicate pass compounds that cost. Eliminate unnecessary passes first; profile supported phones before deciding whether remaining work warrants a cancellable off-main projection.

4. **Discovery has started splitting by visual fragment rather than by independent ownership. Simplify selectively.**

   Twenty-three files for 1,300 lines is not inherently wrong. However, several files now require a reader to move between files without gaining a meaningful boundary. SearchModel is the clearest unnecessary stateful wrapper: its only runtime consumer is MapFeatureModel, it duplicates the query already in device settings, and no view observes it directly.

   The merge recommendations below would reduce Discovery from 23 files to about 19 without creating a God view. They are recommendations, not changes made during this audit. Source-line savings would be modest; the benefit is fewer places to follow.

5. **Failure handling protects data better than it supports diagnosis, and the tests miss state-timing defects. Improve before adding more asynchronous systems.**

   [CatalogRepository's catch path](../../../01-code/ios/BarkRanger/Data/Catalog/CatalogRepository.swift#L135) preserves accepted data and retries correctly, but most failures collapse to `.unavailable` without a compact diagnostic reason. [Local candidate validation](../../../01-code/ios/BarkRanger/Data/Catalog/CatalogRepository.swift#L54) and disk decoding also silently skip failures. A malformed response, invalid identity, hash mismatch and failed disk commit are difficult to distinguish from the app's diagnostics. The existing Diagnostics vocabulary only covers lifecycle, links and timing.

   Keep the simple user-facing status. Add bounded diagnostic categories at existing boundaries, without raw URLs or personal data. Do not build a telemetry subsystem.

   Existing tests have useful corruption, cancellation, reconnect, identity and UI coverage. However, [CatalogTests](../../../01-code/ios/BarkRangerTests/CatalogTests.swift) uses fixed sleeps for several asynchronous expectations and does not assert rebuild counts or selection/action coherence. Add targeted behavioral regressions and deterministic completion points when fixing the defects. The passing test suite did not disprove these findings.

**Discovery file decisions**

| File(s) | Recommendation | Reason |
|---|---|---|
| `SearchModel.swift` | Likely remove as a separate observable model; fold the necessary projection into MapFeatureModel. | One runtime consumer, copied mutable query, no independent UI owner. Preserve the pure ParkSearchIndex. |
| `FilterSummaryView.swift` | Likely make a private view in FilterSheet.swift. | Its sole caller is that sheet; 26 lines of count/label/Clear presentation. The combined file would be about 81 lines before cleanup. |
| `ParkDetailActions.swift` and `ParkDetailMetadata.swift` | Likely colocate as private subviews in ParkDetailView.swift. | Both are sole-use pieces of the same card. Separate types can preserve readable SwiftUI bodies without requiring separate files. Combined with the current view: about 123 lines before deduplication. |
| `MapOverlayRenderer.swift` | Borderline; optional merge into the coordinator as a private renderer helper. | One 20-line factory and one caller. A separate styling boundary is defensible, so this is not a necessary cleanup. |
| `ParkThumbnailStrip.swift` | Keep. | Its media-layout responsibility and explicitly requested future image replacement boundary are useful despite its small size. No image framework is needed yet. |
| `ParkSheetPosition.swift` / `ParkSheetLayout` | Keep together as they are. | Shared by the screen and sheet; isolates detent geometry from gestures and map data. Focused geometry tests would have value. |
| `MapSelectionFraming.swift` | Keep. | Independently tested coordinate/viewport behavior with its own state; protects the coordinator from extra geometry logic. |
| `ParkDetailSheet.swift`, `ParkDetailView.swift`, `ParkDetailContent.swift` | Keep their principal separation. | Gesture/size mechanics, card composition/scrolling, and long-form supplied facts have distinct reasons to change. Consolidating all three would reduce clarity. |
| `ParkDetailModel.swift` | Keep a focused action owner, but simplify how it receives the selected park. | Maps handoff/error state is a real responsibility; a second asynchronous catalog selection authority is unnecessary today. |
| `NativeMapView.swift`, `MapCoordinator.swift` | Keep. | SwiftUI lifecycle bridge and MapKit delegate/reconciliation ownership are legitimate boundaries. Narrow update inputs before adding more behavior. |
| `ParkAnnotation.swift`, `ParkAnnotationView.swift`, `ParkClusterView.swift` | Keep. | Native annotation identity, individual rendering/reuse, and cluster rendering/reuse are distinct, testable roles. |
| `MapSearchBar.swift`, `MapSearchResults.swift`, `FilterChipsView.swift`, `FilterSheet.swift` | Keep. | Focus, accessible result list, removable selections and filter editing are coherent controls. Their separation keeps MapScreen understandable. |
| `MapScreen.swift`, `MapFeatureModel.swift` | Keep as the feature's main entry points; constrain growth. | The screen owns presentation. The model already owns observation, projection, selection, camera persistence, location and connectivity fallback. Do not add trips, scoring, account sync or purchase responsibilities here. |

**Five strongest parts**

1. **Explicit assembly without global lookup.** AppComposition constructs dependencies once; feature code does not retrieve services from a global container. AppRouter holds navigation only. This is not a giant app-wide business-state object.
2. **A genuinely separate domain layer.** BarkDomain imports Foundation only. Stable typed identities, validated coordinates, immutable park/catalog values and pure search/filter rules do not depend on SwiftUI, Firebase or MapKit.
3. **One authoritative catalog writer.** Actor-isolated CatalogRepository validates complete revisions, commits before publication, coalesces requests and retains good local data on failure. HTTP, disk and validation responsibilities are already separated sensibly.
4. **Shared discovery semantics with native rendering.** Count, list and pins consume the same filter result. Annotation identity and MapKit reuse/clustering are retained. Apple Maps owns directions rather than a recreated web routing stack.
5. **Useful behavioral safeguards.** Strict concurrency, bounded HTTP bodies/deadlines, retry limits, stream termination, explicit lifecycle stops, safe URL construction, tests for corrupted storage/reconnect, and real UI interaction coverage are substantial strengths.

**Checklist conclusions**

| Requested concern | Finding |
|---|---|
| Global mutable state / unnecessary singletons | No custom mutable global, `static shared` service or global event bus found. UIApplication.shared and UserDefaults.standard are normal platform entry points; the preferences dependency is injectable. Static lookup/validation constants are immutable. |
| Circular dependencies / feature-to-feature reach | No architectural dependency cycle or unrelated feature model reaching into another found. Discovery's MapKit callbacks form a normal feedback path, but the preference invalidation makes that path do unnecessary work. Settings and Discovery share the same repository, which is appropriate. |
| One button manually coordinating multiple systems | No current action writes Firebase, achievements, leaderboard, trips and storage together. Directions expresses one handoff intent; filter edits express one query intent. Hiding the keyboard, opening a sheet and dismissing a card are related presentation work, not business-system orchestration. |
| Duplicate sources of truth | Catalog snapshots, lookup dictionaries, indexes and annotations are derived projections/caches, not independent data authorities. The problematic duplication is selectedID versus asynchronously loaded detail.park, plus the unnecessary copied query in SearchModel. |
| Business logic in SwiftUI | Filtering/ranking/validation/persistence rules are outside views. View-side chip removal and binding construction are reasonable UI mapping. HomeView does synchronously read/decode small bundled files in stored-property initializers, an intentional small exception in the implemented map; it can repeat on view reconstruction. This is low-priority boundary/efficiency cleanup, not a reason to invent a HomeRepository. |
| God objects / multiple responsibilities | None is oversized by lines. MapFeatureModel is the earliest responsibility hotspot; MapCoordinator and MapScreen are the other growth watchpoints. CatalogRepository's refresh/storage acceptance responsibilities remain one coherent workflow and do not justify further fragmentation. |
| Hidden side effects / misleading names | `SettingsModel.load()` starts an ongoing subscription; `cameraChanged` persists preferences; `setFilters` also normalizes personal filters to `.all` for Phase 2. These are documented but worth making explicit when those areas change. `ParkDetailModel.cancel()` currently invalidates a token, not every queued load. |
| Direct Firebase / database access from views | None. There is no Firebase SDK or personal database in the current native implementation. SwiftUI Links and the MapKit representable's platform calls are appropriate native presentation. SettingsModel opens iOS Settings directly; adding a narrow injectable closure is reasonable only if its side effect needs a deterministic test. |
| Tight coupling among search/map/details/settings | Search, filters and map correctly belong to one Discovery feature. The callback/observation path for settings and the separate detail load are the current weak points. Future trips/visits/passport cannot yet be assessed from placeholder tabs. |
| Excessive callbacks / surprising call paths | No app-wide callback maze or recursive business-operation loop found. Sheet height and scroll-position callbacks are understandable but span several owners; their broad map invalidation is the issue. The detail action passes through several small views without transforming the intent, supporting the selective colocation recommendation. |
| Unnecessary abstractions | No generic repository hierarchy, base view model, protocol-per-class design, or wrapper framework. SearchModel and several one-use presentation files are the main excess. `Park.displayLocation`, `CatalogSnapshot.isNewer`, `ParkFilter.reset`, and the production-unused synchronous Diagnostics.measure are small unused API candidates, not urgent defects. |
| MainActor / repeated work | Catalog parsing/validation/disk commits run in the catalog actor, not MainActor. Search/filter/sort and annotation reconciliation run on MainActor. Redundant rebuilds are confirmed; geometry changes unnecessarily enter annotation reconciliation. Offline geography is synchronously read/decoded when each coordinator is constructed; the bundled file is about 136 KB, so profile before adding a cache. |
| Tasks / streams / resources | Catalog and network streams have bounded buffering and teardown; long-running app tasks have explicit lifecycle stops. The unretained detail-load task has the confirmed post-stop hole. Locate task cleanup and the fire-and-forget catalog cancellation deserve stop→immediate-restart tests before expanding lifecycle responsibilities; this audit does not claim a reproduced leak or failure in those two paths. Test preferences/temp directories are not consistently removed by every existing test, a minor test-hygiene issue. |
| Unsafe assumptions / failure handling | No force unwraps, `try!`, `fatalError`, or unsafeBitCast found in runtime Swift. The stateless redirect delegate's unchecked Sendable conformance is contained. Unique-key dictionary construction relies on validated catalog IDs, a reasonable invariant. Generic failure statuses and silent fallbacks need better bounded diagnostics, as above. |
| Old web architecture mechanically ported | No DOM/event-bus/service-locator/global-browser state recreated. Native MapKit clustering, SwiftUI observation and Core Location are used. The custom draggable sheet addresses the explicit tab-bar/detent behavior; it is not itself evidence of a bad web port. |
| Authoritative changes drive UI | Mostly yes: accepted catalog state flows to consumers, and one result drives count/list/pins. Preference edits currently combine observation with a manual rebuild, and park selection has a separate asynchronous detail write. Those two exceptions should be corrected. |

**Call paths most in need of attention**

`MapCoordinator.regionDidChange → MapFeatureModel.cameraChanged → SettingsRepository.update → preference observation → MapFeatureModel.rebuild → SwiftUI map update → MapCoordinator.apply`

The cycle is reactive feedback rather than infinite recursion, but a camera save should not recompute park matching.

`MapScreen / MapCoordinator → MapFeatureModel.selectPark → selectedID + cameraRequest now → queued Task → ParkDetailModel.load → another catalog read → detail.park later`

Selection and its actionable data should agree immediately, or be explicitly unavailable until they agree.

`ParkDetailSheet geometry → MapScreen.detailHeight → NativeMapView.updateUIView → MapCoordinator.apply → annotation scan + selection framing`

Only layout/framing work is needed when the park/marker inputs did not change.

**Before the next phase**

1. Correct selection/detail/action coherence and queued-load cancellation. Add the focused regression cases listed above.
2. Make discovery projection run once per effective catalog/query change. Verify camera-only and unit-only changes do not rerun it.
3. Gate annotation reconciliation independently from sheet geometry and other presentation changes. Preserve existing IDs, reuse and clustering.
4. Add compact catalog failure reasons and focused lifecycle tests while these boundaries are still small. This is not a request for a telemetry or synchronization framework.
5. Prefer the four-file consolidation described above as a small readability cleanup; it is not a functional blocker. Avoid a broad rewrite or a new package/protocol structure.

**Leave alone**

Keep the composition root, Foundation-only domain package, typed identities, single catalog authority, atomic current/previous catalog storage, one device-settings repository, native MapKit bridge/clustering, safe Apple Maps handoff, fixed thumbnail boundary, and useful corruption/reconnect/UI tests. Do not split CatalogRepository or MapFeatureModel merely to satisfy a line-count target. Do not add a migration framework or future-feature stubs during cleanup. App and test code remain unchanged pending the user's decision.


**Ranked cleanup decision after the requested map/sheet refinements**

The original audit above remains a record of build 0.2.3. The subsequent UI work also addresses its selection inconsistency: the detail Park is now the selection authority, accepted selection data is supplied synchronously, and the unretained detail-load task is removed. Broader audit cleanup has not been performed.

These numbers rate the importance of handling each item before adding more feature complexity; they are not security severity scores.

| Rank | Cleanup | Importance | Honest decision |
|---|---|---:|---|
| 1 | Keep selected identity, displayed Park and Directions coherent; remove queued detail-load races. | 8/10 | Addressed in the related selection/dismissal change. This was the correctness issue I would not carry forward. |
| 2 | Stop duplicate result rebuilds and unrelated camera/units changes triggering search. | 7/10 | Recommended before Phase 3. The app can function now, but this is a poor update pattern to extend. Keep one effective-input change check. |
| 3 | Skip annotation reconciliation for sheet-only geometry and unchanged marker inputs. | 7/10 | Recommended before adding more map/personal-state inputs. Keep current MapKit identity/reuse; narrow invalidation rather than rebuilding the adapter. |
| 4 | Add deterministic stop/restart and delayed-completion tests for remaining lifecycle tasks. | 6/10 | Include when introducing account-scoped work in Phase 3. The remaining paths are review risks, not reproduced data leaks. |
| 5 | Record compact catalog failure reasons. | 5/10 | Useful soon for debugging; does not block the architecture or require a telemetry system. |
| 6 | Colocate the sole-use filter summary and detail actions/metadata; simplify SearchModel. | 3/10 | Worth a small readability pass, safe to defer. Separate source files here do not by themselves cause incorrect behavior. |
| 7 | Remove unused tiny APIs and avoid repeated small bundled-content reads. | 2/10 | Optional housekeeping when touching those owners. Do not create new service layers to solve it. |

**Go/no-go judgment:** the codebase is safe to keep developing and does not need a rewrite. I recommend finishing ranks 2–3 as a bounded cleanup before Phase 3, then treating lifecycle tests as part of Phase 3's actual account work. File merging and minor housekeeping are not blockers. The overall quality remains approximately 7.5/10; UI polish and one corrected race do not justify claiming 9/10 while the other measured issues remain.
