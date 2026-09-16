MapCoordinator snapshot refactor — iOS 0.5.35 (95), September 16, 2026.

Code, automated verification, and device verification are complete. The signed Release app is installed and launched on the owner’s iPhone 15 Pro Max. The saved trip route was directly observed. After iPhone Mirroring’s click service returned `noWindowsAvailable`, the owner performed the four physical interaction checks and reported “all seem to work.” Physical interaction results below are owner-confirmed.

1. **Private fields.** The requested literal grep actually returns **14 before, 5 after**: it does not match `private weak var` or `private(set) var`. Including the two weak touch targets gives the stated 16 old fields; the annotation cache is separate. Final private mutable storage is **8 fields**: six transient UIKit fields, annotations, and rendered. The DEBUG configure observer is separately permitted instrumentation.

Before: `grep -n "private var" MapCoordinator.swift`

```text
9:    private var visible = Set<ParkID>()
10:    private var cameraID: UUID?
11:    private var annotationVersion: UInt64?
12:    private var clustering: Bool?
13:    private var renderedSelection: ParkID?
14:    private var overview: Bool?
15:    private var personal = PersonalParkProjection.Value()
16:    private var numberedStops: [ParkID: [Int]] = [:]
17:    private var rawStopNumbers: [ParkID: [Int]] = [:]
18:    private var numberingRevision: Int64?
21:    private var applying = false
22:    private var reduceMotion = false
23:    private var consumesMapTap = false
28:    private var tappedRoute: TripDayID?
```

After: `grep -n "private var" MapCoordinator.swift`

```text
72:    private var rendered: MapRenderState?
75:    private var applying = false
76:    private var reduceMotion = false
77:    private var consumesMapTap = false
82:    private var tappedRoute: TripDayID?
```

Complete final private mutable field list, including weak targets and annotation cache:

```swift
71:    private(set) var annotations: [ParkID: ParkAnnotation] = [:]
72:    private var rendered: MapRenderState?
75:    private var applying = false
76:    private var reduceMotion = false
77:    private var consumesMapTap = false
79:    private weak var tappedPark: ParkAnnotation?
80:    private weak var tappedPlace: PlaceAnnotation?
82:    private var tappedRoute: TripDayID?
```

2. **`grep -c "clusteringIdentifier" MapCoordinator.swift`: `0`.**

3. **`grep -c "grouping:" MapCoordinator.swift`: `0`.**

4. **Publication order:** `rendered = next` is line **96**; first reconcile call is line **100**. There is **1** assignment to rendered per apply. Every snapshot property is a `let`; no snapshot is modified afterward. The pure initializer uses domain/Foundation values and no MapKit type. Stop-number alias resolution reuses the preceding dictionary when the raw numbers and catalog revision match. The first apply preserves NativeMapView’s initial camera; subsequent requests compare previous and next request IDs.

5. **`model.` references inside reconcile bodies:** annotations **0**, markers **0**, stop numbers **0**, selection grouping **0**, overlays **0**. Total **0**. Marker appearance and grouping come only from the supplied snapshot.

6. **Task source diff:** exactly **1 runtime file** and **2 test files**. This scoped diff excludes the pre-existing unrelated working-tree changes and this evidence document. No listed protected runtime type was changed.

`git diff --stat f5aeb9c -- 01-code/ios/BarkRanger/Features/Discovery/MapCoordinator.swift 01-code/ios/BarkRangerTests/MapCoordinatorReconciliationTests.swift 01-code/ios/BarkRangerTests/NativeAdventureAppFixture.swift`

```text
 .../Features/Discovery/MapCoordinator.swift        | 262 +++++++++++++--------
 .../MapCoordinatorReconciliationTests.swift        |  77 +++++-
 .../NativeAdventureAppFixture.swift                |   2 +
 3 files changed, 236 insertions(+), 105 deletions(-)
```

7. **Single-apply configure count: 3 before → 2 after.** Same target park, clustering enabled, active day gains its second stop, exactly one apply. The synchronous re-enrollment delegate configures the pin, and the existing attached-view refresh configures it again. The explicit refresh preserves the path where a reused attached view receives no synchronous callback. A separate test exercises that path and measures **1** configure. The personal-appearance pass no longer redundantly configures a number-changing pin. Both remaining configurations use the same complete snapshot; neither renders old numbers or grouping. First enrollment with numbers already present is **1 enrollment**, with correct numbers/grouping in that initial callback. Simultaneous selection and numbering changes cause **1 removal + 1 addition** for the target.

8. **Characterization-only commit:** `f5aeb9cb17f58272f026a8912bb06be52dbdb9f5`. All **5** tests passed on the original runtime code. Its only changed file is MapCoordinatorReconciliationTests.swift. The count comparison used this pre-refactor source plus the seven-line DEBUG observer instrumentation and measurement test retained in `output/map-render-state/baseline-observer.patch`; the verified baseline run passed **6** tests and printed `configureCount=3`.

9. **DiscoveryPerformanceTests:** **2 methods / 4 cases passed** before and after. Same simulator, Debug configuration, fixtures, and test source. For 300 geometry updates:

| Parks | Before ms | After ms | Marker lookups before/after | Add/remove calls before/after |
|---:|---:|---:|---:|---:|
| 393 | 46.118667 | 42.166542 | 0 / 0 | 0 / 0 |
| 5,000 | 47.516458 | 41.210500 | 0 / 0 | 0 / 0 |

Projection timings (median / maximum milliseconds) and main-actor ticks are below. These projections do not execute MapCoordinator and their implementation was unchanged. These single-run timings include ordinary simulator/scheduling variation; they are not a statistical speedup claim.

| Parks | Query | Before median / max ms | After median / max ms | Main-actor ticks before / after |
|---:|---|---:|---:|---:|
| 393 | empty | 5.975209 / 6.569292 | 6.461958 / 6.671625 | 1554 / 1887 |
| 393 | park | 8.067667 / 8.63575 | 8.2635 / 8.849459 | 2097 / 2623 |
| 393 | hulls cove | 5.697625 / 6.346208 | 4.363459 / 4.973125 | 1245 / 1347 |
| 393 | zzzzzzzzz | 6.02925 / 6.324875 | 5.422875 / 6.592 | 1551 / 1769 |
| 393 | Synthetic Park 4500 | 6.710292 / 8.122375 | 7.702166 / 9.188916 | 1745 / 2291 |
| 5000 | empty | 23.043334 / 25.266959 | 24.77425 / 28.495583 | 5441 / 7230 |
| 5000 | park | 27.943375 / 31.214542 | 33.38975 / 37.910125 | 7757 / 10088 |
| 5000 | hulls cove | 32.120625 / 34.447667 | 33.342958 / 35.104083 | 8789 / 9958 |
| 5000 | zzzzzzzzz | 36.770417 / 40.643625 | 45.693833 / 47.879459 | 10428 / 13480 |
| 5000 | Synthetic Park 4500 | 27.333166 / 28.50075 | 35.1915 / 39.894167 | 7641 / 11480 |

10. **Full passing suite list:** **47 test methods / 52 cases**, **0 unresolved failures**, **0 skipped checks**. The full run plus the focused rerun cover the final source. The initial full run had one fixture setup failure: account sign-in was attempted while asynchronous startup cleanup was still running. The test-only fixture now waits for `cleanupState == .ready`; no account runtime code changed. The focused rerun passed all nine new tests and all three PendingVisitMarkerTests methods, including the emulator-backed receipt path.

| Suite | Passed methods | Evidence |
|---|---:|---|
| MapCoordinatorReconciliationTests | 9 | `final-focused.xcresult` |
| MapSelectionFramingTests | 7 | `after.xcresult` |
| MapSelectionZoomTests | 3 | `after.xcresult` |
| MapColorProjectionTests | 2 | `after.xcresult` |
| PendingVisitMarkerTests | 3 | `final-focused.xcresult` |
| SettingsTests | 5 | `after.xcresult` |
| CatalogTests | 15 | `after.xcresult` |
| RouteDayInteractionTests | 1 | `after.xcresult` |
| DiscoveryPerformanceTests | 2 | `after.xcresult` |

Signed Release build: **succeeded**; code signature verification: **passed**; Firebase target: **bark-ranger-ios**; app version/build: **0.5.35 / 95**. Version values were supplied as build overrides so the Xcode project file was not changed by this task. Install and launch succeeded on the owner’s connected iPhone. Strict formatting and whitespace checks pass for the refactor and new tests.

Physical checks: **4 / 4 owner-confirmed** — grouping while zooming; selecting a clustered pin; adding and removing a stop from the open day; Airplane Mode with a cached route on screen. The owner’s response was “all seem to work.” The agent observed the installed app and saved route directly; the four interaction checks were performed by the owner.

Raw evidence is retained in `output/map-render-state`: original source, baseline observer patch, before/after results and logs, source-audit.txt, task-diff-stat.txt, runtime-sha256.txt, signed build log, install/launch receipts, and the final signed app. No production backend changes or deployments were made.
