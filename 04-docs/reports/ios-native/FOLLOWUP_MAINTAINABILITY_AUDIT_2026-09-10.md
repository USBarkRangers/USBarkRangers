# Native iOS follow-up maintainability audit

September 10, 2026 · original deep audit: commit **b0e5e67**, build **0.2.5 (7)**. The **0.2.6 (8)** implementation follow-up and current priorities appear first below.

**Recommendation: GO for Phase 3 development, after the user's Phase 2 acceptance. The cleanup materially improved correctness and execution cost; it was not cosmetic. No remaining finding requires a broad rewrite or blocks starting accounts/persistence/sync.** The original audit found two smaller map issues; 0.2.6 fixes coordinate framing and retains the order-only invalidation finding. Test limitations and ownership/readability constraints remain. This is not release approval or verification of account isolation that has not been implemented.

This is a deeper follow-up to [the previous audit](MAINTAINABILITY_AUDIT_2026-09-10.md). No runtime, test, project, backend or production behavior was changed for the original audit. The later interaction patch is documented separately below. Experiments used a disposable copy of the native project. All 63 existing runtime/test Swift files in that copy were checked byte-for-byte against the working source; extra probe files existed only in that copy. Pre-existing unrelated changes, including the string catalog, were preserved.

**Map interaction follow-up — build 0.2.6 (8)**

The follow-up below was updated after the requested camera, grouping-setting and sheet-position fixes. The original deep audit remains the baseline for unchanged code. Current size is **48 runtime files / 3,283 lines** and **23 Discovery files / 1,427 lines**: 46 additional runtime lines, no new runtime files. MapCoordinator is 166 lines, MapScreen 138, MapSelectionFraming 51 and NativeMapView 48; no type requires speculative splitting. Rechecked the map bridge/coordinator/framing, selection and Directions owner, result invalidation, sheet state, settings, composition/lifecycle and Phase 3 contract. The small fix does not warrant inflating any score: **quality 8, spaghetti risk 2, maintainability 8, architecture clarity 8.5, efficiency 8, test quality 7.5 out of 10**. No new architecture blocker was found; Phase 3 still requires the user's explicit start.

The camera jump was a direct `setCenter(..., animated: false)` in MapSelectionFraming. NativeMapView now reads the system Reduce Motion environment; MapCoordinator passes the resulting animation policy into framing and native cluster expansion. MapKit owns the animation and its retargeting. The fix adds no runtime file, timer, task, animation manager, persistence field or selectable-park writer. Pin selection still preserves zoom and heading. Framing uses MapKit’s inset viewport center, accounting for safe-area/attribution margins during animation. It targets the lower visible map in low mode and about 40 points above the sheet in medium mode. The chosen low/medium detent survives the next selection. Live drag-height updates do not replay camera commands or enter marker reconciliation; settling on another detent intentionally reframes once. The sheet already follows the same system accessibility preference. A selected park is excluded from grouping and given required display priority. Grouping-setting changes re-register the same annotation objects, including members hidden in existing clusters. Ordinary selection changes update at most two grouping participants. Re-registration removes them before applying a new clustering identifier; changing that identifier while attached to a live cluster caused a MapKit exception during verification and is now avoided. `renderedSelection` is a private cache of applied native presentation, not a new authority; it cannot select a park or drive Directions. Expanding a cluster clears the old park selection before the native zoom so the old sheet/camera cannot fight it.

**Settings decision:** follow iPhone Settings → Accessibility → Motion → Reduce Motion automatically. A separate app switch would be feasible and small, but currently duplicates system behavior and adds a preference/override/testing matrix without a demonstrated need. Do not add animation speed, duration, easing or per-action switches. If users later need app-specific suppression, one “Reduce map motion” opt-in can combine with the system flag using OR; it should never force animation over the system's reduced-motion request. Keep this local presentation policy out of account/cloud settings. [Apple's native center animation](https://developer.apple.com/documentation/mapkit/mkmapview/setcenter(_:animated:)) preserves zoom; [the SwiftUI accessibility value](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion) exposes the system preference.

**Growth priority ranking** — urgency 10 means fix before proceeding; 1 means optional housekeeping. Future-phase gates are distinguished from defects in today's app.

| Finding | Urgency | Decision and trigger |
|---|---:|---|
| Pin-to-pin movement jumps | 7 → resolved | Fixed in this pass using native animation, with system reduced motion. No custom animation framework. |
| Test setup can use ordinary preferences/cache and `makeLive` | 8 at provider integration | Fix as an early Phase 3 task **before connecting auth/account providers to the test graph**. Use isolated stores and synthetic/emulator adapters; prevent tests from inheriting real account/provider side effects. This is the strongest required growth safeguard, not evidence of a current customer-data leak. |
| Grouping preference leaves stale clusters / selected park can be hidden by grouping | 7 → resolved | Re-register the same canonical annotations on an actual grouping preference change and keep the selected park individual. The UI regression checks actual cluster disappearance/reappearance, not only a model count. |
| Same-ID coordinate correction misses framing invalidation | 6 → resolved | The framing cache now includes the selected coordinate. A regression changes that coordinate without changing ID and verifies the new location is framed. |
| Result reordering rescans unchanged markers | 5 now; rises with larger catalogs | Fix before substantial catalog growth or a marker-performance claim. Separate membership/facts/appearance invalidation from dropdown order; do not add a general diff engine. At today's 393 records it is waste, not a blocking stall. |
| Account/sync work could broaden MapFeatureModel, MapCoordinator or AppLifecycle | 7 as a phase boundary | Enforce during Phase 3 design/review. UID scope, personal persistence, outbox, entitlements and sync get their own owners; Discovery consumes their published values. These types are not current God objects and do not need speculative splitting. |
| Some UI/performance assertions are proxies; older tests use sleeps/broad catches | 5 | Strengthen when the relevant flow changes and before release/performance certification. Add native annotation-membership checks, precise expected failures and visible-map/device profiling. Current counters prove app reconciliation work, not frame-rate or allocation bounds. |
| Custom sheet's live height/settled detent/tab overlap coordination | 4 | Watch. Add cancellation/rotation/mid-drag regressions when modifying it. These are different presentation values, not competing park or search authorities. Do not rebuild the sheet solely to reduce its state-property count. |
| Sole-use Actions/Metadata/FilterSummary files | 2 | Optional colocation when editing their parent views; keep coherent private view types. Three fewer files could improve navigation, but merging them does not fix state races or improve runtime performance. |
| Small per-query allocations, preference encoding and bundled synchronous reads | 2–3 | Profile as data/features grow. Current background query work and tiny local reads do not justify a cache, scheduler or generic settings framework. |

The order-only marker rescan remains **confirmed and unfixed**; the coordinate-framing finding is now corrected. The remaining rescan does not require blocking account implementation or broadening this interaction patch. The native domain/catalog boundary, single query/selected-Park owners, stale-result guards, canonical annotation reuse and composition-root injection should be left intact. Public catalog startup must remain independent of authentication/personal-store availability in Phase 3.

One existing location cancellation test also exposed an isolation weakness: its CLLocationManager subclass still received real authorization notifications. Its controlled test double now suppresses those delegate notifications and delivers callbacks explicitly; no location runtime behavior changed. Both cancellation cases and the full app suite subsequently passed. The wider provider-test isolation gate above still stands.

Verification for this patch is recorded in the [Phase 2 report](PHASE_2.md#native-camera-glide--026-8). The initial native rendering probe did not establish intermediate animation frames and was not retained as a flaky regression. An on-screen simulator recording subsequently showed intermediate pin/map positions during the native glide; the deterministic test separately verifies normal/reduced-motion policy and absence of geometry-driven replays. Neither is a physical-device frame-rate certificate.

---

**Scores**

| Dimension | Original 0.2.3 audit | This independent follow-up | Explanation |
|---|---:|---:|---|
| Overall code quality | 7.5/10 | **8/10** | Real ownership fixes and meaningful regressions; some over-invalidation, presentation edge cases and test overclaims remain. |
| Spaghetti-code risk | 3/10 | **2/10** | Ten means severely tangled. No business-operation callback maze, duplicate editable query, or global service graph. |
| Maintainability | 7/10 | **8/10** | Easier state reasoning and safer cancellation; Discovery is still more fragmented than necessary. |
| Architecture clarity | 8/10 | **8.5/10** | Explicit assembly, pure domain and identifiable state owners; native presentation remains the most involved path. |
| Performance/efficiency | 6.5/10 | **8/10** | Unrelated result computation and sheet-driven marker scans removed. Real annotation changes still do broad native work. |
| Test quality | Not separately scored | **7.5/10** | Stronger race/failure tests; important assertions still use proxies, and older timing/isolation weaknesses remain. |

I would revise the immediately preceding correction handoff's 8.5 overall/maintainability ratings to 8 after this broader review. The code did not regress between those judgments. This audit examined additional marker-order, coordinate-update and test-evidence boundaries. Scores are engineering judgments, not measured production guarantees, and do not include unfinished features.

**Scope and method**

- Read every implemented Swift runtime file: **48 files / 3,237 lines**, including all five BarkDomain source files. Read all **15 test files / 1,759 lines**, the package manifest, implemented architecture, README/CONTRIBUTING, the previous audit, current Phase 2 report, six-phase contract, Phase 3 prompt and native CI workflow.
- Discovery is **23 files / 1,381 lines**, seven files at 35 lines or fewer. Largest runtime files: CatalogRepository 207, MapFeatureModel 191, MapScreen 136, MapCoordinator 135, RootView 129. These are not God files by size; responsibility breadth matters more.
- Compared actual source at `60c5c41` (original audit), `4be5d68` (selection/UI refinement) and `b0e5e67` (focused corrections). Selection authority was already substantially repaired in 0.2.4; 0.2.5 finished action/task ownership and performance boundaries.
- Reran domain/app regressions, 393/5,000-record measurements and audit-only probes. Used Xcode 26.6 / Swift 6.3.3 / iPhone 17 Pro simulator, iOS 26.5. No physical-device, Instruments allocation/frame-time, actual iOS 18.4, live catalog or hosted-CI certification is claimed.
- Reviewed existing UI tests and their latest passing artifacts for this implementation. Did not rerun the UI suite merely because this is a new report; runtime source was unchanged. The precise strength and limitations of those tests are discussed below.

**Comparison with all eight previous findings**

| Previous finding | Classification | Current implementation and evidence |
|---|---|---|
| 1. Selected identity versus displayed/actionable Park | **Fixed** | MapFeatureModel.selectedID derives from ParkDetailModel.park. selectPark resolves an accepted Park synchronously; the detail view and Directions consume that Park. See MapFeatureModel:20,127–137; ParkDetailModel:16–35; DiscoveryStateTests:95–132. |
| 2. Queued/stale detail-load cancellation | **Fixed** | The async detail-load operation no longer exists. Directions captures the current Park synchronously, owns its task, and checks cancellation before handoff and before publishing completion. A→B, queued dismissal/stop and delayed old failure are tested. See ParkDetailModel:24–41; DiscoveryStateTests:173–195. |
| 3. Duplicate result rebuilds | **Fixed** | setFilters only writes settings. Settings/catalog events enter one revision+query comparison. One owned task publishes one immutable ParkResults. Exact invocation counts and deliberately late completions are tested. See MapFeatureModel:90–125; DiscoveryStateTests:11–93. |
| 4. Camera/units trigger search/filter work | **Fixed** | The broad settings observation still wakes, but the effective-input gate returns before computation. Repeated camera/units/style/clustering/status changes are tested, rather than inferred from unchanged UI. |
| 5. Sheet geometry triggers marker reconciliation | **Fixed** | MapCoordinator:51–55 returns before sets, catalog scans and marker lookups unless annotationVersion/clustering changes. Fresh 393/5,000-record probes demonstrate zero marker lookups for 300 geometry updates. A separate order-only invalidation inefficiency remains; it is not a sheet-drag regression. |
| 6. SearchModel duplicate mutable query | **Fixed** | SearchModel was deleted. The only editable query is SettingsRepository.value.filters. ParkResults.input and requestedInput are provenance/comparison values, not independent writers. |
| 7. Excessive Discovery fragmentation | **Improved but still present** | The unnecessary stateful wrapper is gone. File count stays 23 because the background projection has a legitimate new owner. Sole-use Actions, Metadata and FilterSummary files remain optional colocation candidates. |
| 8. Weak catalog failure diagnostics | **Fixed** | Disk/repository boundaries emit fixed stage/reason values for decode, validation, hash, transport, timeout, throttling, storage and cancellation. Missing first-launch caches are quiet; accepted fallback remains intact. CatalogDiagnosticsTests checks actual categories. There is deliberately no remote telemetry system. |

None of those eight findings regressed. The presentation-fragmentation part of finding 7 is unchanged; the stateful-wrapper part improved.

**Seven strongest architectural qualities**

1. **One selected Park and one editable query.** The selectedID is computed, views forward intents, and accepted result publication is coherent. No view manually reconciles a separate count, result list and pin list.
2. **Explicit dependencies and a small composition root.** AppComposition constructs repositories/adapters and passes them through initializers. AppRouter is navigation state, not an application-wide business store. There is no service locator, event bus or custom singleton.
3. **An independent domain package.** BarkDomain imports Foundation only: immutable identities, coordinates, catalog facts, settings values and pure search/filter policy. No SwiftUI, UIKit, MapKit, Firebase, SwiftData or vendor behavior enters it. Private lookup constants are immutable.
4. **One catalog acceptance authority.** CatalogRepository owns revision ordering, accepted data/index, coalescing and retry policy. HTTP, validation and disk operations are separate concrete collaborators. Failed validation/commit preserves accepted data; atomic envelopes avoid mismatched metadata/payloads.
5. **Correct separation of data work and presentation work.** ParkResults computes off MainActor; count/list/pins derive from its completed projection. MapCoordinator's early invalidation gate makes sheet geometry independent of catalog size at the application reconciliation layer.
6. **Native capabilities with restrained abstractions.** MapKit owns clustering/reuse, Apple Maps owns directions, Core Location owns one-shot location. The code has no generic repository framework, base model, protocol-per-class design, custom routing backend or web event-bus imitation. Thumbnail placeholders have one replaceable view boundary.
7. **Task ownership is substantially more explicit.** Directions, projections, locate requests, manual refresh, catalog work and lifecycle stops have owners. Generation/request checks protect stale completion paths. New tests intentionally deliver obsolete results; they do not rely only on cancellation being obeyed by the mock.

**Seven remaining risks/smells, ranked**

1. **P2 — Result order unnecessarily invalidates every matching marker. Confirmed; small focused follow-up.**

   MapFeatureModel:111–114 increments annotationVersion when the ordered matching-ID array changes. MapCoordinator:56–73 then scans every match, asks MapKit for each view, and reconfigures materialized views. List ranking matters to the dropdown; pins depend on membership and park/appearance facts, not array order.

   Reproduction: clear the query, then enter a single space. Normalized search still matches every park, but its ranking falls back to source order instead of the empty-query alphabetical order. The same marker membership caused **393/5,000 lookups, zero actual additions and zero removals**, respectively; the reconciliation took about **0.75/5.09 ms** in the audit's Debug windowless-map probe. Thus the broad claim “only marker inputs trigger marker work” needs this qualification. A legitimate changed membership also reconfigures all retained matches, even when their facts did not change.

   Recommended scope: distinguish marker membership/facts/appearance from list order; preserve the current single result projection and ID/reuse logic. Add a same-membership/different-order regression. This does not justify a new diffing framework and does not block account work.

2. **P2 — Same-ID coordinate corrections do not invalidate selected-pin framing. Original finding; fixed in 0.2.6 above.**

   MapSelectionFraming:28–34 keys its last placement by ParkID, detent, camera request and visible band; it omits the selected coordinate. ParkAnnotation.update:15–22 correctly updates coordinates after accepted catalog changes, and details/Directions correctly update too. But the framing cache can return early and leave a corrected location off screen while low/medium still promises a visible selected pin.

   Audit probe: frame Park A at `(44.4, -68.2)` in medium, update that same annotation to `(45, -69)`, and apply unchanged geometry. Its screen point moved from approximately `(195, 239)` to `(-2406, -2506)` without reframing. This is an isolated MapKit/framing reproduction, not a claim that the live spreadsheet currently contains such a correction. The caller path is accepted catalog → new projection → annotation.update → unchanged framing key.

   Recommended scope: include coordinate change in framing invalidation and test it, while continuing to preserve user pans when park facts/coordinates are unchanged. No wrong-park Directions or data loss was found. This can be repaired in the next small map pass; it is not a Phase 3 dependency.

3. **P2 — Some test names/evidence imply more coverage than their assertions provide. Confirmed coverage gaps, not a failing suite.**

   DiscoveryUITests.expectPins:20–26 compares the map's accessibility value with the count label. Both are rendered directly from the same model result; this can pass even if actual annotations are wrong. Other tests do select a real pin and exercise real clusters, so coverage is not wholly a proxy, but full native membership agreement across filters is not proved by expectPins.

   DiscoveryPerformanceTests:20–47 uses a windowless MKMapView without the production delegate/reuse registration. Its overridden lookup/mutation methods strongly prove the early-return boundary, but do not measure visible marker allocations, cluster relayout, frame drops or view configure counts. Its heartbeat assertion spans five awaited computations and only requires progress, not a bound on the longest UI stall. The actual `@concurrent` source contract is the stronger isolation evidence. Timing output has no regression threshold.

   Older CatalogTests/AppShellTests still contain fixed 50/100/200/400 ms and 2-second waits. The stalled-response test catches any error and checks elapsed time, so an unrelated early transport failure can satisfy that assertion. AppShellTests:55–71 uses makeLive, ordinary preferences/cache paths and the configured endpoint instead of a fully isolated test graph. Several older tests/UI suites leave preferences behind; the new shared Discovery fixture cleans up its own resources, but teardown does not universally await every app-lifetime stop.

   Recommended scope: assert actual annotation membership, exact deadline error/coalescing request counts, and coordinate/order cases; isolate lifecycle test dependencies before attaching live account providers. Replace timing sleeps when touching those tests, not through a wholesale test-framework rewrite. Controlled continuations are useful but need release-on-failure cleanup so a failing assertion cannot strand a test task.

4. **P2 design constraint — Discovery and lifecycle are the likely future concentration points. Not currently God objects.**

   MapFeatureModel (191 lines) owns catalog observation, preferences projection, detail selection, camera intent/persistence, locate and imagery/connectivity presentation. MapCoordinator (135) bridges annotations, overlays, gestures, camera feedback and framing. AppLifecycle orders all foreground/background work. These are still cohesive enough for the implemented map and shell, but they must not become owners of UID transitions, outbox transactions, receipt processing, achievements, billing or trip mutations.

   Phase 3 should supply public/scoped values and narrow intents from actual account/store/sync owners. Public CatalogRepository must remain usable independently of auth and personal storage. The planned separate AccountSession/LocalStore/SyncEngine path is appropriate; copying the lightweight public-catalog cancellation pattern alone is not sufficient account isolation. An operation already committing public catalog data may finish safely; cross-account writes require the stronger UID/generation rules in the Phase 3 contract.

5. **P3 — The custom sheet is the most stateful presentation path. Review its owners before expanding it.**

   MapScreen:7–14 keeps focus, empty-results collapse, filter presentation, settled detent, measured height, search obstruction, retained tab overlap and the live above-medium flag. ParkDetailSheet owns drag translation/eligibility and scroll-at-top state; ParkSheetLayout computes sizes; ParkDetailView reports scroll position; MapSelectionFraming consumes geometry. These are different kinds of state, not separate selected-park authorities, but this is the hardest current flow to modify safely.

   detailHeight and aboveMedium come from the same geometry callback; aboveMedium is a redundant derived flag. Retaining tab overlap avoids a deliberate safe-area feedback loop when hiding tabs. searchHeight measures the full search/chips/dropdown stack, not just the text field. None of this currently requires catalog or account knowledge. Existing tests cover settled detents/rotation and prior recording evidence covers the held drag, but gesture cancellation, rotation during drag, and live geometry transitions are less directly asserted. Keep future account business decisions out of this path; do not replace it with an app-wide presentation coordinator.

6. **P3 — Three single-use view files add navigation cost without a strong ownership boundary. Unchanged presentation fragmentation.**

   FilterSummaryView is only used by FilterSheet. ParkDetailActions and ParkDetailMetadata are only used by ParkDetailView. Colocate them as private subview types in those owners when convenient. That would reduce Discovery from **23 to 20 files** without turning views into giant bodies: roughly 81 lines for FilterSheet+summary and 125 for ParkDetailView+actions+metadata before removing repeated imports. This is readability cleanup, not a functional prerequisite or a meaningful line-count optimization.

   Keep ParkThumbnailStrip (future image replacement), ParkDetailContent (full supplied facts/links), ParkDetailSheet (gesture mechanics), ParkSheetLayout (shared detent policy), MapSelectionFraming (independent native geometry tests), NativeMapView and separate annotation/cluster types. MapOverlayRenderer's 20-line styling boundary is optional but defensible; merging it is not an audit requirement.

7. **P3 — Small avoidable work remains outside the corrected hot path. Confirmed operations; user-visible impact not established.**

   ParkResults:25–30 reconstructs the full ID→Park dictionary and catalog-ID set for every effective query, although these depend only on the revision. ParkFilter:35–59 builds active/matching arrays and sorts again after search has already ranked IDs. WithinOneEdit converts words into Character arrays on comparisons. Those costs are now off MainActor and acceptable in the measured fixtures; do not trade them for a complex cache framework without evidence.

   SettingsRepository:22–26 encodes/saves the entire small preference struct on each changed keystroke and completed camera-region update. The broad settings observer still schedules a task and checks its input after unrelated writes; it no longer searches/filters. MapCoordinator.apply still sets map type and layout margins on presentation updates; those constant-size native calls are not zero work.

   HomeView:6–20 synchronously reads/decodes 406-byte education and 875-byte links resources on view construction. OfflineBasemapOverlay:6–21 eagerly reads the tile and decodes 138,160-byte geography when a coordinator is made, including when online imagery is used. SettingsModel reads 4–7 KB legal files on explicit taps. These are bounded, local MainActor operations, not synchronous network I/O. Home reconstruction can repeat them; first-map work is not covered by the geometry timing loop. Profile the first visible map/older phone before choosing a simple load-once or lazy boundary. Do not introduce generic Home/Asset managers just to remove every tiny read.

**State ownership and dependency direction**

| State | Authority | Other representations and judgment |
|---|---|---|
| Selected Park | ParkDetailModel.park | MapFeatureModel.selectedID is derived; MapKit selection and MapSelectionFraming.selection mirror presentation. No independent editable selection survives. The coordinate key omission is a cache invalidation defect, not another business authority. |
| Search/category/swag filters | SettingsRepository.value.filters | Field bindings and chips forward edits. requestedInput/ParkResults.input identify work; projection holds the last completed result. While a new query computes, the prior coherent projection remains briefly visible. No second editable search model. |
| Catalog | CatalogRepository accepted envelope and State | Disk current/previous, bundled fallback, search index, feature snapshots, results and annotations are validated persistence/derived read copies. Features cannot independently publish accepted revisions. Buffering newest one state bounds streams. |
| Sheet | MapScreen settled position, ParkDetailSheet temporary drag | Measured height/aboveMedium/overlap are presentation caches. Different owners handle settled versus in-progress layout; unnecessary to move into a repository. |
| Camera | MKMapView's actual viewport, with MapFeatureModel camera commands | cameraRequest is a one-shot command identified by UUID; lastRegion is an in-memory return position; SettingsRepository.camera is the durable position when enabled. These are distinct roles. NativeMapView restores lastRegion before an old command; Coordinator.cameraID avoids replaying it on every update. Turning memory persistence off does not need to erase the current session's visible region. |
| Device preferences | One SettingsRepository | SettingsModel/Discovery share it. Neither keeps an independently mutable settings copy; short-lived Binding edits are values written back to this owner. |
| Connectivity/imagery | NetworkMonitor path hint and Discovery's map presentation flags | A path hint does not claim catalog freshness. Imagery failure is separate from catalog transport failure; fallback follows those hints. It should not become an entitlement or sync authority. |

Dependency direction remains appropriate: app/features consume repositories and native adapters; data/platform work does not reach into unrelated feature models; BarkDomain is independently compiled. Most app-layer folder boundaries are conventions within one target, not compiler-enforced module boundaries. That is proportionate for this codebase.

AppComposition is the only owner of the full application graph. MapFeatureModel constructs its subordinate ParkDetailModel from an injected MapsHandoff, and MapCoordinator constructs its native presentation resources; those are local ownership decisions, not service lookup. HomeView knows AppRouter.Destination's routing vocabulary, a small app-layer coupling through an injected action. No Discovery→SettingsModel→Discovery cycle exists. Settings/Discovery share a repository as intended. Diagnostics contains fixed values and does not depend back on CatalogRepository; classification stays in the catalog owner.

No mutable global, custom static shared service, unnecessary singleton, force unwrap, `try!`, `fatalError`, unsafe cast, Firebase/database access from a SwiftUI view, or multi-system business button was found. The stateless redirect delegate's `@unchecked Sendable` is contained. Unique-key dictionaries rely on whole-catalog unique-ID validation; do not bypass that boundary when adding fixtures/imports. Domain public constructors are values, not a substitute for validating untrusted catalogs.

**Ten end-to-end user flows**

1. **Offline launch → map.** BarkRangerApp → AppComposition → AppLifecycle.sceneChanged → Discovery.start / Settings.load / network stream → queued polling waits previous catalogStop → StartupModel.start → CatalogRepository.loadLocal → DiskStore/Validator → accepted state/index. Startup reveals usable local data; RootView opens Home, and Home/router or an incoming map link opens MapScreen → NativeMapView/MapCoordinator. Catalog actor work and streams are the async boundaries; ParkResults performs the result projection off MainActor. Side effects are bounded local reads, path monitoring, optional configured freshness request, then native map construction. **Clean authority and fallback.** The default app opens Home rather than automatically selecting Map. Loader readiness means a valid catalog exists, not that every annotation has already rendered; direct-to-map launch may briefly await the first projection. Offline path discovery can arrive after startup begins; it does not erase local data.

2. **Type search → results/count/pins.** MapSearchBar Binding → MapScreen copies the current Query → MapFeatureModel.setFilters → SettingsRepository.update → observation callback → revision/query gate → owned resultTask → ParkResults.compute → ParkSearchIndex/ParkFilter → coherent projection → count/dropdown/MapCoordinator. Side effects: save the small device-preference value, cancel obsolete projection, reconcile real marker changes. **Clean, with measured residual costs.** No independent text or count state. Obsolete tasks are rejected even when the injected computation ignores cancellation. Ranking-only marker invalidation and per-query lookup construction remain as described above.

3. **Tap/drag map during search.** NativeMapView's simultaneous tap recognizer → MapCoordinator.shouldReceive reports touch-down → MapScreen collapses results and clears focus. Annotation/control touches are excluded from background dismissal; a completed background tap calls dismissPark, while a drag proceeds natively. Async work is normal UIKit/SwiftUI event delivery, not catalog loading. **Clean presentation-only intent.** Search/filter/result values stay intact; refocusing restores results. resultsCollapsed is needed for the special unfocused empty-results panel; it is not a second query. Programmatic camera changes do not invoke this touch path.

4. **Select A → B quickly → Directions.** Pin delegate or result selection → MapFeatureModel.selectPark resolves current accepted B → detail.show(B) cancels A's navigation → selectedID derives immediately → detail view shows B → synchronous navigate captures B → owned Task → MapsHandoff.openPark → UIApplication.open. A pin preserves zoom; a search result creates an explicit focus command. **The previous race is fixed.** The only side effect leaving the app is the deliberate Maps handoff. A request already submitted to iOS cannot be recalled, but a queued cancelled task cannot submit and a late A result cannot mutate B's busy/error state.

5. **Change filter → map/count/results.** FilterSheet toggles, chip removal or reset → setFilters → one SettingsRepository edit → same projection path as search. No view counts parks or updates markers manually. Opening FilterSheet first dismisses details and keyboard as related presentation work. **Clean.** setFilters also forces the unimplemented personal filter to `.all`; that documented Phase 2 normalization must be revisited when real visited/trip inputs arrive in Phase 4. A label-only change with identical ordered IDs does not reconcile pins.

6. **Pan/zoom → persisted camera.** Native MapKit regionDidChange → MapFeatureModel.cameraChanged stores lastRegion → if enabled, bounded AppSettings.Camera → SettingsRepository.update → preference observer wakes → input comparison returns. NativeMapView/MapCoordinator may receive a presentation update, but no changed camera command and no changed marker token means no result rebuild or annotation scan. **Clean feedback path, not recursive business logic.** The small settings write and native map-type/margin assignments remain; programmatic framing also produces the normal camera persistence feedback.

7. **Sheet low → medium → high → down.** MapScreen position/layout → ParkDetailSheet gesture translation/projected snap → ParkSheetLayout heights/presentation → ParkDetailView content/scroll → geometry callback to MapScreen → hide/show search/tabs and pass obstruction into NativeMapView → MapCoordinator → MapSelectionFraming. No repository write except camera persistence if framing moves the map. **Correctly isolated but the most involved presentation path.** The coordinator's marker gate returns before scanning parks. Settled detent, live height and measured chrome are intentionally different; geometry-only work does not filter results. High releases the pin visibility requirement. Coordinate changes and uncommon mid-drag transitions need the follow-up tests described above.

8. **Change marker/filter/display settings.** Home → router settings sheet → SettingsView.preference Binding → SettingsModel.update → shared SettingsRepository. Map style selects native imagery/overview; clustering invalidates annotation configuration; units/remember-position do not invalidate results. Filters edited/reset enter the one projection path. Async boundaries are observation and native view update, with no second settings store. **Clean responsibilities, broad observable granularity.** Units are stored but no Phase 2 distances require conversion. There are no fake visited/trip controls. Clustering changes legitimately touch markers; future personal badge inputs must participate in marker invalidation when implemented.

9. **Catalog refresh succeeds.** Lifecycle startup/foreground/reconnect/manual Settings intent → CatalogRepository.refresh checks shared cadence/backoff/in-flight owner → HTTP manifest/ETag and bounded payload request → Validator → DiskStore atomic envelope → accepted snapshot/index → subscriber state → selected Park refresh + one new result projection → markers update by ID. Network awaits allow actor reentrancy; accepted validation/commit/index construction is synchronous within the catalog actor. **Clean one-writer transaction boundary.** No view edits disk or resets camera/filters. Selected details can receive new facts before the background pin projection completes briefly; identity/Directions remain coherent. Same-revision status refresh causes no projection. At the original audit baseline, ordering-only scans and selected-coordinate framing were the remaining map edges. Coordinate framing is corrected in 0.2.6.

10. **Catalog malformed/slow/unavailable.** Same refresh owner; HTTP enforces same endpoint/redirect policy, size and whole-request deadline; validation rejects the complete bad revision; catch logs a fixed stage/reason, retains the accepted catalog and schedules bounded jittered backoff/Retry-After. Startup's separate decision task can reveal local records while slow refresh continues. Background lifecycle cancels and awaits the old catalog request before foreground scheduling resumes. **Safe fallback and better diagnosis.** The three-second loader decision still awaits catalog actor availability; it is not a hard real-time guarantee against every synchronous decode/OS scheduling delay. Transport categories are intentionally compact, not a detailed remote monitoring system.

**Ownership, lifetime and allocation review**

- Catalog streams keep newest one state, remove subscribers on termination with weak repository capture, and do not accumulate catalog history. Annotation cache is pruned against accepted catalog IDs and is bounded by the current catalog rather than every past query. Search retains an immutable index per accepted revision, not a query-result cache with unlimited keys.
- Discovery/Settings/lifecycle stream tasks strongly retain their owners while running. That is intentional for the app-owned graph, and explicit stop paths exist. A new weak-reference audit probe confirmed that a started Discovery model becomes deallocated after stop and stream completion. This does not substitute for a full Instruments leak audit. A future account-scoped graph must explicitly await teardown instead of relying on app lifetime.
- Catalog refreshID protects handle cleanup; catalogStop orders background cancellation ahead of restarted polling/startup. NetworkMonitor's generation ignores stopped callbacks. LocationClient's cancellation requestID protects a replacement request; the new tests cover that cancellation-handler race. Native CLLocationManager delegate callbacks themselves carry no request token; delayed native fixes/errors and real permission transitions still deserve device testing. No continuous tracking capability exists yet.
- ParkAnnotationView allocates layers/artwork views in init and updates state in configure/setSelected; its static badge path and shadow path are retained per reusable view. ParkClusterView allocates one path when configuring native cluster membership/width, not on every sheet update. There is no per-pin raster renderer or downloader. `UIImage(named:)` uses UIKit's image cache, so repeated configuration is not proof of a fresh logo decode/allocation every time. [Apple's UIImage initializer contract](https://developer.apple.com/documentation/uikit/uiimage/init(named:)) supports that distinction. Reconfiguration can still perform avoidable property/accessibility work; see finding 1.
- Platform singleton access is confined to expected APIs such as UIApplication.shared, UserDefaults.standard, Bundle.main and FileManager.default. Settings/Maps dependencies needed for tests are injectable. No mutable app-wide global container exists. Preview/test preference domains and several old test temporary resources need housekeeping; no unbounded production cache or confirmed production retain cycle was found.

**Measured performance and what it establishes**

The 393 records are the checked-in real fallback; 5,000 is a synthetic/public fixture, not production traffic. Results below are simulator measurements, not phone frame rates.

| Workload | 393 records | 5,000 records |
|---|---:|---:|
| Current Debug projection, per-query median range | 2.95–4.26 ms | 12.79–28.94 ms |
| Current optimized Release projection, per-query median range | **1.61–2.24 ms** | **6.63–14.01 ms** |
| Current Debug geometry loop, 300 updates | 45.15 ms total | 61.43 ms total |
| Marker lookups / annotation add-remove calls in that geometry loop | **0 / 0** | **0 / 0** |
| Order-only query change, extra lookups | 393 | 5,000 |
| Order-only query change, actual annotations added/removed | 0 / 0 | 0 / 0 |

Five samples per query cover empty, broad, specific, no-match and exact synthetic queries. MainActor progress was observed in every case. `ParkResults.compute` explicitly uses the [Swift SE-0461 @concurrent contract](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md), so its CPU work leaves the caller's actor. The progress assertion alone would not prove that all work was nonblocking.

A separate controlled before/after comparison used the actual `4be5d68` coordinator code, renamed in the audit-only test target, and the current coordinator against the same current model/catalog on the same simulator. This isolates the reconciliation change; it is not a benchmark of two complete app releases.

| Same 300 geometry updates | Old coordinator | Current coordinator |
|---|---:|---:|
| 393 records: marker lookups | 117,900 | 0 |
| 393 records: elapsed | 200.31 ms | 43.19 ms |
| 5,000 records: marker lookups | 1,500,000 | 0 |
| 5,000 records: elapsed | 1,907.80 ms | 46.13 ms |

This is objective improvement. Similarly, the previous audit measured two result passes per filter edit and one per camera/units update; the current exact-count regressions pass with one and zero respectively. The search algorithm itself was not replaced. The improvement is avoiding work and removing CPU work from MainActor, not a claim that every individual search algorithm became faster.

Initial annotation creation, changed-membership reconciliation, visible view configuration and native clustering still run on MainActor. Comparisons of matching-ID arrays also occur there when publishing a new projection. No full rendered-map stress trace or longest-main-thread-stall measurement was performed. The implementation is appropriate at the measured sizes; device profiling is still required before a release claim.

**What the tests now catch, and what they do not**

| Boundary | Evidence now | Gap/qualification |
|---|---|---|
| A→B selection and Directions | Synchronous selected/detail agreement, actual captured Maps URL, queued cancellation, late old failure while newer action busy | OS requests already submitted cannot be undone. No claim of exhausting all UIKit event interleavings. |
| Duplicate/unrelated computation | Invocation-count probe over real compute; settings reset, same revision/status, stop/restart | Input equality is the full query/revision. Normalized-equivalent text may still change labels/order and be a new input. |
| Stale background projection | Noncooperative held continuation released after a newer query or stop | Does not assert a maximum cancelled CPU time; cancellation checkpoints are between bounded stages. |
| Geometry marker work | Real overridden MapKit lookup/add-remove methods, 393/5,000 records | Windowless/delegate-free map does not measure visible allocations/frame timing. |
| Catalog failure fallback | Real loopback HTTP, corrupt disk, hash/shrink/commit failures, deadline/cancel cases and emitted diagnostics | Redirect/oversize/status variants and alias/retirement/entity-correction matrix could be asserted more directly. Native tests do not prove live publisher/IAM behavior. |
| Marker branding/reuse | Real annotation views, personal/selected reset, exact native cluster count, rendered attachments | Attachment generation is not pixel-diff regression detection. Personal badges are presentation inputs only until Phase 4. |
| Sheet/search interactions | Existing actual keyboard, map touch/drag, pin/cluster selection, detents, exposed-map dismissal, dark landscape and large-text tests | Count-label proxy is not full native membership; mid-drag assertions and new coordinate edge need stronger direct checks. |
| Lifetime/restart | Immediate background/foreground refresh, queued manual stop, location replacement, audit weak-reference release | No Instruments-wide proof of zero leaks; some older tests use live composition and sleeps. |

Fresh verification passed: **9 domain functions**, all **39 committed app test functions/methods** (36 Swift Testing plus 3 XCTest), the audit-only probes, and the optimized projection test's two record-count cases. The first audit-copy run reports 39 Swift Testing functions because it includes three added audit functions, plus the three existing XCTest methods. The comparison run reports four audit functions, including parameterized count cases; these are extra evidence, not new committed regression coverage. The two newly identified map issues were reproduced by probes asserting current behavior, not fixed by those probes.

**Files to merge, split or constrain**

| Decision | Files | Why |
|---|---|---|
| Likely colocate when touched | FilterSummaryView → FilterSheet; ParkDetailActions and ParkDetailMetadata → ParkDetailView | Remove three navigation hops; keep private subview types and current behavior. |
| Constrain, do not split preemptively | MapFeatureModel, MapCoordinator, MapScreen, AppLifecycle | Current responsibilities fit their feature/lifecycle, but no account/sync/scoring/purchase orchestration belongs inside Discovery. Extract only a concrete new responsibility when implemented. |
| Keep separate | ParkResults and domain search/filter; MapSelectionFraming; ParkDetailSheet/Layout/Content; thumbnail boundary; native annotation/cluster types | Real execution, geometry, media or native reuse boundaries; not mechanical splitting. |
| Leave coherent | CatalogRepository plus existing HTTP/Disk/Validator collaborators | Its 207 lines form one accepted-revision lifecycle. Splitting retry state into another manager would create more cross-owner coordination. |
| Later test organization | CatalogTests (329 lines) | It mixes transport, acceptance, startup, settings and map tests. Move cases into the already-existing relevant suites as those cases change; do not invent a suite file per assertion. |

The longest call chains are presentation plumbing, not tangled business workflows: sheet/scroll geometry across five owners; and camera delegate → persisted device preferences → observation → invalidation check → native update. Both have understandable termination conditions. The latter no longer performs result computation. Directions passes through a couple of sole-use view files without changing intent, supporting their colocation. SettingsModel.load is a subscription start rather than a one-time load, cameraChanged saves preferences, and setFilters normalizes unsupported personal filters; names/comments can be clarified when touched. There is no circular business-operation chain to dismantle.

**Before Phase 3, later, and leave alone**

**Must fix before Phase 3 starts: no confirmed blocker in the current implemented code.** User Phase 2 acceptance and explicit Phase 3 authorization still govern the sequence. A broad consolidation or architecture rewrite would add risk without unlocking accounts.

During Phase 3 implementation, account/session generations, scoped store ownership, one durable outbox, exact receipts and teardown must remain in the planned account/data owners. Do not put private state in the public CatalogRepository, make Discovery await auth, or add personal writes to SwiftUI button handlers. Replace the live-composition test dependency before tests begin initializing real account providers. Those are acceptance requirements for the new phase, not missing Phase 2 features.

Worth fixing in a small later pass: order-only marker invalidation, selected-coordinate framing, the targeted assertion gaps, and optional three-file colocation. Small bundled reads/per-query allocations are profile-driven work. Initial-map/older-device rendering, physical permissions, actual iOS 18.4 and live provider performance must be verified before release; none has been certified by simulator timings.

Explicitly leave alone: the composition root and domain package, typed IDs, single settings authority, catalog actor and atomic envelopes, one immutable result projection, native MapKit clustering/identity/reuse, safe Maps URL construction, fixed thumbnail replacement boundary, compact enum diagnostics and the new controlled late-completion tests. Do not add a migration framework, generic event/command bus, second query store, extra persistence cache or protocol layer as a response to this report.

**Final recommendation: GO for Phase 3 development with the bounded backlog above.** The current code is materially safer and more efficient than the original audit baseline. Its next architectural test is whether account/sync work stays outside Discovery; this audit does not grant those not-yet-built features a passing grade.

**Evidence and reproduction**

- Current source: `b0e5e67`; original audit source `60c5c41`; immediate pre-cleanup coordinator `4be5d68`.
- Fresh domain log: `/tmp/bark-followup-domain.log`.
- Disposable copy: `/tmp/BarkFollowupAuditSource`; existing 63 Swift runtime/test files match source byte-for-byte. Extra probes: `BarkRangerTests/FollowupAuditProbes.swift` and `PriorMapCoordinator.swift` in that copy only.
- Debug build/results: `/tmp/bark-followup-build.log`, `/tmp/bark-followup-tests.log`, `/tmp/BarkFollowupAudit.xcresult`. Additional comparison build/results: `/tmp/bark-followup-probe-build.log`, `/tmp/bark-followup-comparison.log`, `/tmp/BarkFollowupComparison.xcresult`.
- Release recheck: `/tmp/bark-followup-release-performance.log`, `/tmp/BarkFollowupReleasePerformance.xcresult`; used the already-built matching 0.2.5 optimized product in `/tmp/BarkFocusedCleanupRelease` with testability enabled. No new Release build is claimed for this audit.
- Reviewed prior matching UI evidence: `/tmp/BarkCleanupUIVerified.xcresult`, `/tmp/bark-cleanup-ui-verified.log`, and final lifecycle rerun in `/tmp/BarkCleanupComplete.xcresult`. Nine relevant UI scenarios previously passed; they were inspected, not rerun here.
- Start the checked-in loopback fixture server for app acceptance/count tests: `node 05-tools/scripts/serve-ios-catalog.js`. It serves public/synthetic data only. Use README commands with `-only-testing:BarkRangerTests`; select `FollowupAuditProbes` only against the disposable audit project. Release timing selection is `BarkRangerTests/DiscoveryPerformanceTests/projectionTimingsAndMainActorResponsiveness(count:)`.
- Build warnings-as-errors covered Swift compilation. Xcode also emitted its normal AppIntents metadata-extraction notice because this app does not link AppIntents; that is not a new Swift warning or failed check. Windowless MapKit tests emit platform renderer messages; no test failure was hidden.
- Temporary evidence can be removed by the OS; the substantive findings, numbers, scope and limitations are preserved in this report. No runtime refactoring was performed for that original audit; the later interaction patch is described above.
