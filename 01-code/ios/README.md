# Bark Ranger for iPhone

Phase 1 builds the native shell: Home, five native tabs, an About sheet, public deep-link validation, immediate local launch and a small shared domain package. Upcoming features are visibly marked as development previews. The old web app and backend continue unchanged.

## Open and run

Open `BarkRanger.xcodeproj`, select the shared **BarkRanger** scheme and **iPhone 17 Pro** simulator, then press **Command-R**. Home should appear immediately. Switch tabs or open the information button to test navigation. No account, network connection or permission prompt is needed.

Toolchain: **Xcode 26.6 (17F113), Swift 6.3.3**, Swift 6 language mode with complete concurrency checking. Minimum app deployment target: **iOS 18.4**. The installed/tested runtime is **iOS 26.5**. A physical iPhone requires a valid signing account/profile, device trust and Developer Mode; provisioning has not been verified. See [Config/README.md](Config/README.md).

## Read the code

Start with [ARCHITECTURE.md](ARCHITECTURE.md): it maps every implemented file, function boundary and direct call. `BarkRangerApp → AppComposition → RootView / AppLifecycle` is the entire assembly path. [CONTRIBUTING.md](CONTRIBUTING.md) explains where new work belongs.

- `BarkRanger/App`: composition, navigation, scene handling and startup.
- `BarkRanger/Features/Home`: welcome content and navigation actions.
- `BarkRanger/Platform`: local diagnostics.
- `Packages/BarkDomain`: Foundation-only, Sendable park identities/coordinates/basic value.
- `BarkRangerTests`, `BarkRangerUITests` and package tests: behavior checks.
- `Config`: platform/build configuration and minimal app metadata.

The original badge is reused unchanged. The teal paw icon is development artwork made with the native `pawprint.fill` symbol; final App Store artwork is a later release task. The English string catalog is ready for future translations, not a claim of localization coverage.

## Reproduce checks

Run these commands from the repository root. The temporary directory is newly created; no existing simulator or user files are erased.

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
```

Use Xcode **Product → Test** (Command-U) for app unit/UI targets. Run `swift test` separately for the domain package. UI automation covers navigation, sheet dismissal, background/relaunch, deep links and accessibility. The phase report records actual simulator results and remaining manual checks. Xcode's skipped AppIntents metadata notice is expected because the shell has no AppIntents feature.

[Native CI](../../.github/workflows/ios-checks.yml) runs the same commands on `macos-26` with Xcode 26.6 selected explicitly. Action revisions are pinned, permissions are read-only, test evidence is retained for seven days, and no deployment occurs. Changing the toolchain requires rechecking its installed simulator runtime.

## Current phase and boundaries

- [Phase 1 report and your testing checklist](../../04-docs/reports/ios-native/PHASE_1.md)
- [Six-phase execution contract](../../04-docs/plans/ios-native-2026-09-09/IMPLEMENTATION_PHASES.md)
- [Full proposed Swift map](../../04-docs/plans/ios-native-2026-09-09/SWIFT_FILE_MAP.md)
- [Architecture decision](../../04-docs/adr/0001-native-ios-and-firebase.md)

Planning documents remain in Xcode's Planning group as documentation, not bundled resources. Phase 2 starts only on explicit instruction after your phase-1 testing. Parks/maps arrive in 2, accounts/sync in 3, visits/trips/passport in 4, recording/native activities in 5 and purchases/integration in 6. User transfer is a separate later plan.

GitHub destination: [USBarkRangers/USBarkRangers](https://github.com/USBarkRangers/USBarkRangers), branch `codex/ios-native-setup`, remote `usbarkrangers`. The `both` alias pushes to multiple repositories and is not used for this native branch. Do not deploy the old web app as a side effect of a native push.
