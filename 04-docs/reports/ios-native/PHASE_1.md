# Phase 1 — Native foundation and app shell

September 10, 2026. Build **0.1.0 (1)**, branch `codex/ios-native-setup`, implementation commit `f055492`, based on setup commit `e6d0700`. The user explicitly started phase 1 with “do phase 1.” **Complete and awaiting user testing. User acceptance is pending.** Phase 2 has not started.

## What is implemented

The Hello, world! template has been replaced by a native SwiftUI Home screen using the existing Bark badge, five native tabs and a dismissible About sheet. Map, Trips, Passport and Account are clearly identified development previews. Home's Explore parks action opens the Map preview. No unfinished feature pretends to fetch parks, authenticate or save data.

The shell opens locally and becomes ready synchronously on its first active scene. It has no minimum spinner delay, network dependency, permission prompt, Firebase initialization or migration layer. Returning from background retains the selected tab; a fresh process begins at Home. Only public Home/About deep links are accepted. Unsupported links preserve existing navigation and never log their payload.

The shared Foundation package contains exact string ParkID/SiteID values, validated finite geographic coordinates and a minimal immutable Park. There is one composition root and one owner each for navigation, startup and lifecycle. Diagnostics accept fixed event names and duration measurements only. No unused service protocols or future feature files were scaffolded.

## Where each file belongs

The [implemented architecture and call map](../../../01-code/ios/ARCHITECTURE.md) describes every runtime and supporting file, its operations, callers and direct dependencies. Start there, then follow the app entry point.

| Responsibility | Files / direct path |
|---|---|
| Assembly | `BarkRangerApp.swift → AppComposition.makeLive()` constructs the graph once; forwards scene/URL events. |
| Lifecycle | `AppLifecycle.swift → StartupModel.start / Diagnostics.record`; duplicate scene events are ignored. No asynchronous work exists to cancel yet. |
| Navigation | `AppRouter.swift → Diagnostics`; owns typed tabs/sheet and validated URL dispatch. |
| Startup | `StartupModel.swift → Diagnostics.measure`; `StartupView.swift` observes loading/ready/recovery presentation. Recovery is a preview-only state until real fallible catalog work arrives. No fake retry button. |
| Screens | `RootView.swift → HomeView / StartupView / AppRouter`; local private future-screen and About layouts. `HomeView.swift` forwards supplied navigation actions. |
| Shared values | `Packages/BarkDomain/.../Park.swift → Foundation` only. Identifiers serialize as their original strings, never regenerated UUIDs or keyed wrapper objects. |
| Diagnostics | `Platform/Diagnostics.swift → OSLog / ContinuousClock`; no analytics/remote transport. |
| Verification | `AppShellTests.swift`, `AppShellUITests.swift`, package `ParkTests.swift`; test code is separate from shipped Swift source. |
| Project/resources | Existing Xcode project/shared scheme extended with local package and two test targets; Config xcconfigs/Info.plist, asset catalog and English string catalog. |
| Documentation | Native README, ARCHITECTURE, CONTRIBUTING, Config README, ADR 0001, this report and updated phase/file-map status. |
| CI | `.github/workflows/ios-checks.yml`; read-only checkout, pinned macOS/Xcode/actions, package and simulator checks, retained results, no deployment. |

See [run instructions](../../../01-code/ios/README.md), [configuration ownership](../../../01-code/ios/Config/README.md), and [ADR 0001](../../adr/0001-native-ios-and-firebase.md). The future [105-file plan](../../plans/ios-native-2026-09-09/SWIFT_FILE_MAP.md) remains a responsibility forecast, not implemented source.

## Verification evidence

Toolchain: **Xcode 26.6 (17F113), Apple Swift 6.3.3**, Swift 6 language mode and complete concurrency checking. Minimum deployment target remains **iOS 18.4**; available simulator runtime is **iOS 26.5**. iOS 18.4 runtime behavior and physical-device provisioning have not been verified.

| Check | Result |
|---|---|
| Foundation package tests | Passed: 3 Swift Testing functions, 6 parameterized cases. |
| App unit behavior | Passed: 8 Swift Testing functions, 22 parameterized cases, including rejected links and repeated lifecycle events. |
| Debug app and test-target compilation | Passed, including iPhone SE compilation from fresh derived data and GitHub’s clean iPhone 17 Pro build with Swift warnings treated as errors. |
| Release simulator build | Passed from separate clean derived data with Swift warnings treated as errors. |
| iPhone 17 Pro UI suite | All 4 UI tests passed. A focused final app-unit rerun also passed (8 functions / 22 cases, exit 0), resolving the earlier local test-host startup interruption. Hosted full-run result is recorded separately below. |
| iPhone SE (3rd generation) | Passed final overall run: 12 test functions / 26 cases, zero failures/skips. All 4 UI tests, including full light/dark accessibility audits and largest-text scrolling/actions, passed. |
| GitHub Actions | Passed on implementation commit `f055492`: package tests, clean app/test build, all 8 app-unit functions and all 4 UI tests (zero failures). [Verified GitHub run](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34438297644). |
| User acceptance / physical iPhone | Pending; no registration/provisioning changes made. |

No compiler/concurrency warnings remain in app/package source. Xcode emits “Metadata extraction skipped. No AppIntents.framework dependency found.” for targets without AppIntents; this is a toolchain notice, not a reason to add an unused dependency. Simulator testing can also emit duplicate system accessibility-class and debugger-version diagnostics. A failed wrapper/test-host run is recorded as failed even if individual UI checks passed.

The accessibility checks use Apple's full audit at ordinary text size in light/dark appearance, plus a separate largest-accessibility-text navigation/scrolling test. The audit itself checks Dynamic Type support. The small-phone lower Home card must be scrolled clear of the translucent system tab bar before auditing its text; no audit issue types are disabled or blanket-filtered. Automated labels/traits checks supplement, rather than replace, a human VoiceOver pass.

### Reproduce the checks

From the repository root:

```sh
swift test --package-path 01-code/ios/Packages/BarkDomain

BARK_CHECK_DIR=$(mktemp -d /tmp/bark-native-check.XXXXXX)
xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath "$BARK_CHECK_DIR/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build-for-testing

xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath "$BARK_CHECK_DIR/DerivedData" \
  -resultBundlePath "$BARK_CHECK_DIR/ShellTests.xcresult" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test-without-building

xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BARK_CHECK_DIR/ReleaseDerivedData" \
  CODE_SIGNING_ALLOWED=NO SWIFT_TREAT_WARNINGS_AS_ERRORS=YES build
```

Local evidence is kept outside Git in `/tmp/bark-phase1/`: `package-tests.log`, `release-build.log`, `small-final-tests.log`, and `SmallFinalTests.xcresult`. The latter’s result summary reports Passed, 12 test functions and 26 device cases with zero failures/skips. `pro-final-tests.log` records the earlier unit-host startup interruption, separately from its passing UI tests. The subsequent focused `pro-unit-final-tests.log` / `ProUnitFinalTests.xcresult` run passed with exit 0 using `test-without-building -only-testing:BarkRangerTests` against iPhone 17 Pro and the same current build. Xcode also built and launched the app normally on iPhone 17 Pro; Home and landscape safe areas were visually inspected, then portrait restored. Exported iPhone SE screenshots confirm the dark palette and native controls. These are temporary machine-local evidence, not permanent repository artifacts. CI retains its result bundle for seven days. The successful hosted job took 12m 52s, including the fresh simulator startup; its four UI tests took 175s. No production deployment step ran.

## Your testing checklist

In Xcode select **BarkRanger → iPhone 17 Pro**, then **Command-R**. For a physical iPhone, first supply valid signing/provisioning and trust/Developer Mode; those prerequisites have not been tested here.

| Action | Expected result |
|---|---|
| Launch the app. | Home appears promptly with the Bark badge and Happy trails welcome; no permission prompt/sign-in. |
| On a provisioned iPhone, turn on airplane mode and cold-launch. | The shell opens immediately. Actual offline park data begins in phase 2. The physical airplane-mode check is yours to verify; no phone/network settings were changed here. |
| Tap Explore parks, then each bottom tab. | Correct tab/heading; future features visibly say Development preview. |
| Tap Back to Home; open the information button; tap Done or swipe the sheet down. | Home and the About sheet behave consistently; no stuck cover. |
| Select Trips, background, reopen, then close and relaunch. | Background return retains Trips; a fresh process starts on Home. |
| Enable dark mode and the largest text size. Scroll Home and each preview. | Text remains readable, bottom tabs stay usable, and Explore parks/Back to Home/Done remain reachable. |
| Turn on VoiceOver and traverse Home/About/tabs. | Descriptive labels, sensible reading order, decorative badge skipped; check actual spoken behavior. |
| Open `barkranger://about`, then `barkranger://home`. | About opens; Home link closes any sheet and returns Home. Account/unknown/query-bearing links do not navigate. |

Report any screen/action that behaves differently. Feedback stays in phase 1; phase 2 requires a separate explicit start.

## Actual size and preservation

Runtime Swift currently contains **10 files / 509 physical lines**, including comments and blank lines. The separate physical-line counts are shown below (comments and blank lines included; generated build output excluded). The deleted temporary ContentView had 24 lines. The original 41-line starter is replaced, not retained as a second app path: the native runtime grows by 468 lines for the real shell.

| Category | Files | Lines |
|---|---:|---:|
| App + domain runtime Swift | 10 | 509 |
| App/UI/package test Swift | 3 | 215 |
| Native package/build configuration, metadata, string catalog and ignore file | 14 | 1,106 |
| GitHub workflow | 1 | 54 |
| Badge/icon binaries | 2 | Not counted as source lines |

Documentation is excluded from runtime savings. The ownership map covers the native guides, this report, ADR and plan updates separately.

**Old web/backend runtime lines removed: 0.** The old app, Firebase rules/functions/hosting settings, users and payments remain untouched. The production entry still serves `index.v142.html`; the root development redirect still points to `index.v145.html`. No production deployment or customer move occurred. Unrelated support/rules/Discord working-tree changes were preserved and excluded from native commits.

The overall code-reduction estimate remains a forecast. Building this 509-line foundation does not establish the eventual replacement's feature parity, server savings or safe retirement of old code.

## Next boundary

Phase 1 is now **awaiting user testing**; all required implementation checks are complete. No Firebase, catalog publication, park map, sign-in, persistence, billing, tracking, migration, user-data conversion or future-phase implementation belongs in this handoff. The next action is your testing and phase-1 fixes.
