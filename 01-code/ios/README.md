# Bark Ranger for iPhone

Development workspace prepared September 10, 2026. This is the existing Xcode starter copied into Bark's repository; phase 1 implementation has not started.

## Open and run

Open `BarkRanger.xcodeproj`, select the shared **BarkRanger** scheme and an iPhone simulator, then Run. Setup was checked with Xcode 26.6 (17F113); the available simulator runtime is iOS 26.5. Deployment minimum: iOS 18.4. Language: Swift 6 with complete concurrency checking. Target: iPhone.

The initial view is Xcode's unchanged **Hello, world!** starter. `App/BarkRangerApp.swift` is the entry point and calls the temporary `ContentView.swift`. Phase 1 replaces that starter with the mapped composition, navigation and startup shell, adds the domain package and test targets, and expands this README.

The existing Desktop project's bundle identifier and signing team were preserved. Simulator verification does not validate device provisioning or register any new App Store/Firebase application.

## Start here

- [Six-phase plan](../../04-docs/plans/ios-native-2026-09-09/IMPLEMENTATION_PHASES.md)
- [Phase 1 prompt](../../04-docs/plans/ios-native-2026-09-09/prompts/PHASE_1_FOUNDATION.md)
- [Swift file ownership](../../04-docs/plans/ios-native-2026-09-09/SWIFT_FILE_MAP.md)

These three documents also appear in Xcode's **Planning** group. They are documentation references and are not bundled app resources.

GitHub destination: [USBarkRangers/USBarkRangers](https://github.com/USBarkRangers/USBarkRangers), setup branch `codex/ios-native-setup`. Use the `usbarkrangers` remote for this branch. The separate `both` remote pushes to multiple repositories and is not used for native setup.

The Desktop starter, its location simulation data, old web app and unrelated working-tree changes remain in place. There are no native features, Firebase SDKs, CI workflows or user migrations in this setup commit.

## Setup verification

The starter simulator build passed on September 10 using the shared scheme and iPhone 17 Pro (iOS 26.5). No Swift compiler errors were reported. Xcode emitted its metadata-extraction notice because this starter has no AppIntents dependency; no AppIntents feature is planned for setup. Physical-device provisioning remains unverified. Phase 1 will add the actual app shell and meaningful tests.
