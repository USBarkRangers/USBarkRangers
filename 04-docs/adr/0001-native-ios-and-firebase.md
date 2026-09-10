# ADR 0001 — Native Swift app with the existing Firebase platform

Date: September 10, 2026. Status: Accepted for the six-phase build; phase 1 implemented.

## Context

Bark Ranger needs a readable native iPhone codebase while the existing web app continues serving its users. The user wants to preserve accounts and features, keep server costs low and avoid a user-migration framework during construction. There are approximately 90 current users, including 63 paying users, according to the user.

## Decision

Use Swift/SwiftUI, one app target and a small Foundation-only BarkDomain package. Add the Live Activity extension only with real phase-5 content. Use native Apple frameworks in their relevant phases. Keep the existing JavaScript Firebase platform rather than introducing a Swift server and a second deployment/runtime for a small product. No backend runtime change is made in phase 1.

Build in `01-code/ios/` on a dedicated branch without replacing web source or deploying its backend. Use iOS 18.4 as the documented minimum and pin a stable toolchain (phase 1: Xcode 26.6, Swift 6.3.3, Swift 6 language mode). Native simulator CI uses no signing secrets and performs no deployment.

One composition root constructs explicit dependencies. Views render/forward actions; feature models coordinate; immutable Sendable values and pure rules live in BarkDomain. Add repositories, storage actors, scoped sync and narrow side-effect protocols only when an implemented feature needs them. Retain current server field formats through ordinary decoding, not a permanent old-user/new-user migration subsystem.

## Consequences

The first phase is only a native shell and has no provider/network requirement. The next phases must preserve the intended offline-first catalog behavior and existing account/payment semantics. Platform integration and backend changes require their own real test evidence; phase-1 compilation cannot establish future feature parity, operating cost savings or production readiness.

Actual user transfer, browser-only unsynced-data handling, backend retirement and rollout are separate plans after the six phases. No source deletion or deployed savings is claimed while the web app remains active. Journaling and user-data redesign are outside these phases.

## References

- [Six-phase execution contract](../plans/ios-native-2026-09-09/IMPLEMENTATION_PHASES.md)
- [Implemented native architecture](../../01-code/ios/ARCHITECTURE.md)
- [Firebase project ownership](../FIREBASE_PROJECT_OWNERSHIP.md)
- [Apple: SwiftUI Observation](https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro)
- [GitHub: macOS 26 runner/toolchain inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)
