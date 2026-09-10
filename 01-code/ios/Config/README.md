# Configuration

The minimum deployment target is **iOS 18.4**; the tested toolchain is **Xcode 26.6 (17F113), Swift 6.3.3**, in Swift 6 language mode. `Base.xcconfig` owns platform/concurrency settings inherited by app/test targets. Debug/Release include Base and choose optimization/testability. The package owns its Swift language mode independently.

The app's bundle ID `swarm.USBARKRANGERS` and development team `V7Y6NA8G23` were retained from the user's original Xcode project. They are identifiers, not credentials. They have **not** been newly registered or verified for a physical device in phase 1. App-specific identity/version/signing settings live in the app target, separate from test bundle IDs.

Simulator checks use `CODE_SIGNING_ALLOWED=NO` and need no Apple login. For a personal device, select an available signing team in Xcode after verifying the intended bundle ID; a valid account, device trust/Developer Mode and provisioning are prerequisites. Do not enable automatic registration as part of an unattended build.

`Signing.local.xcconfig` is optional and ignored. Set `BARK_DEVELOPMENT_TEAM = your_verified_team_id` there to override the inherited team without editing shared project files. App and test targets resolve `DEVELOPMENT_TEAM` through that setting. Command-line overrides take precedence. Never check in signing certificates, profiles or credentials.

`Info.plist` registers only the public `barkranger` URL scheme, display name and orientations. It also declares a single scene and an empty native launch screen; Xcode supplies the generated bundle metadata. No location, motion, HealthKit, tracking, background activity, push, associated-domain or payment capability is requested.

Phase 1 is a local shell. It has no Firebase configuration, emulator connection, catalog endpoint, GoogleService-Info file, analytics SDK, or StoreKit product IDs. Phase 2 adds public catalog configuration; phase 3 adds guarded emulator configuration and later registered Firebase iOS values; phases 5–6 add only the native capabilities their real features need. Production Bark remains `barkrangermap-auth`; JDDM resources never belong here.
