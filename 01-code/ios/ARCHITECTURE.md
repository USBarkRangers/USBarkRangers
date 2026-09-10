# Native architecture — implemented phase 1

This is the current code, not the future inventory. One iPhone app and one Foundation-only Swift package are sufficient. No backend or cloud dependency is initialized by this build.

```text
BarkRangerApp
  └─ AppComposition.makeLive()       creates one graph
       ├─ AppRouter                 tabs, sheet, validated public links
       ├─ StartupModel              synchronous shell readiness
       └─ AppLifecycle              scene transitions → StartupModel

RootView(router, startup)
  ├─ HomeView(open:)                 content → supplied router action
  ├─ native tabs + About sheet      navigation bindings → AppRouter
  └─ StartupView(model:)            renders launch state

Router / Startup / Lifecycle → Diagnostics → local OSLog
BarkDomain: Park / ParkID / SiteID / Coordinate → Foundation only
```

The app target links `BarkDomain`; the shell does not invent park data just to use it. The first consumer will be the phase-2 catalog. Swift 6 checks immutable domain values as `Sendable`. App navigation and startup use `@MainActor @Observable`; SwiftUI stores the composition in app-owned `@State` and receives individual dependencies through initializers. No view retrieves a global container.

## File ownership and calls

Paths are relative to this directory. Closely related enums and private layout stay with their owner.

| File | Responsibility and operations | Direct calls / callers |
|---|---|---|
| `BarkRanger/App/BarkRangerApp.swift` | Sole `@main`; owns graph, forwards scene and URL events. | Creates AppComposition; presents RootView; calls lifecycle.sceneChanged and router.handle. |
| `App/AppComposition.swift` (under `BarkRanger/`) | `makeLive`, `makePreview`, private `assemble`; constructs only the three shell owners and diagnostics. | Constructors only; app/previews call it. Never a service locator. |
| `App/AppLifecycle.swift` | `sceneChanged` ignores duplicates, starts shell on active; `stop` records background once. No async task exists to cancel yet. | StartupModel.start, Diagnostics.record; app calls it. Foreground task cancellation will be added with real phase-2 work. |
| `App/AppRouter.swift` | Typed Tab/Sheet/Destination; `open`, `dismissSheet`, `handle(url:)`; private rejection logging. A tab navigation action dismisses an existing sheet. | Diagnostics; RootView/Home actions and app URL forwarding call it. No domain/service calls yet. |
| `App/StartupModel.swift` | `start` moves loading → ready synchronously once, returning whether it did work. State is read-only outside its owner. | Diagnostics.measure; lifecycle calls start; RootView/StartupView observe. No timer or networking. |
| `App/StartupView.swift` | Loading/recovery presentation only; ready renders nothing. Recovery is previewable but cannot occur in phase 1 because no fallible work runs. | Reads StartupModel; no fake retry. A real retry belongs with phase-2 loading failures. |
| `App/RootView.swift` | Native TabView/NavigationStacks; chooses StartupView or shell; private development placeholders and About sheet. | HomeView and StartupView; router state/actions. Future feature files are not created empty. |
| `Features/Home/HomeView.swift` | Brand/welcome and Explore parks/About actions. | Supplied `(AppRouter.Destination) -> Void`; no side effects. |
| `Platform/Diagnostics.swift` | `record` accepts fixed event enums only; `measure` uses ContinuousClock and preserves returns/errors. Disabled instance for tests/previews. | Foundation/OSLog; shell owners call it. Logs never accept a URL, UID, location or arbitrary user text. |
| `Packages/BarkDomain/Sources/BarkDomain/Park.swift` | Exact string identities with single-string Codable; distinct site identity; finite, bounded Coordinate; immutable basic Park. | Foundation only. Catalog validation/aliases/display fields remain phase 2. Empty IDs are not normalized here; the future publisher/validator owns catalog validity. |

## Lifecycle and navigation decisions

There is no network request, disk read, permission prompt, database, recurring task or minimum loading interval in phase 1. The first active scene makes the shell ready immediately. Returning from background retains the same router/startup objects and selected tab. A new process begins on Home; persistent navigation is not implemented.

Only `barkranger://home` and `barkranger://about` (optionally a trailing slash) are accepted. Scheme/host casing is ignored. User info, ports, queries, fragments, encoded paths, additional path segments and unimplemented hosts are rejected without changing navigation. This custom scheme is a public navigation convenience, never proof of authentication. Universal links require later domain/entitlement setup.

Recovery currently exists solely as a presentation preview. It has no invented error trigger or retry that pretends to repair nonexistent data. Phase 2 adds actual catalog startup states and recovery operations in these same owners.

## Supporting files

| Path | Purpose |
|---|---|
| `BarkRanger.xcodeproj/project.pbxproj` | App/unit/UI targets, local package link and folder-based target membership. Source folders map to matching targets. Config stays outside app resources. |
| `BarkRanger.xcodeproj/xcshareddata/xcschemes/BarkRanger.xcscheme` | Shared run/build/profile and app/unit/UI test actions. |
| `BarkRanger.xcodeproj/project.xcworkspace/contents.xcworkspacedata` | Xcode's project workspace reference. |
| `Packages/BarkDomain/Package.swift` | Swift 6 library plus its pure unit test target; no downloaded packages. |
| `Config/{Base,Debug,Release}.xcconfig` | Shared platform/concurrency values and explicit debug/release overrides. |
| `Config/Info.plist` | Display name, public URL scheme, supported orientations; explicit single-scene/launch metadata plus bundle fields generated by Xcode. No permissions or capabilities. |
| `BarkRanger/Assets.xcassets` | Original Bark badge copied unchanged from web assets; adaptive teal accent; opaque 1024px native paw development icon. SF Symbols artwork is provisional release artwork. No personal images. |
| `BarkRanger/Localizable.xcstrings` | English source strings and future translation boundary. No claim of completed translations. |
| `BarkRangerTests/AppShellTests.swift` | Route validation/no-navigation on rejection, one-time startup, lifecycle identity, independent app scopes, diagnostics result/error behavior. |
| `BarkRangerUITests/AppShellUITests.swift` | Actual app navigation, URL delivery, sheet dismissal, relaunch/background and full accessibility audits in light/dark mode, plus largest-text scrolling and action reachability. |
| `Packages/BarkDomain/Tests/BarkDomainTests/ParkTests.swift` | Exact identity serialization, non-coercion and coordinate limits. |
| `.gitignore` | Generated Xcode/SPM output, user state and local signing overrides stay untracked. |
| `README.md`, `CONTRIBUTING.md`, `Config/README.md` | Run instructions, change boundaries and configuration ownership. |
| `../../.github/workflows/ios-checks.yml` (repository root) | Hosted simulator checks only, no deploy/signing secrets. |

The full proposed file map lives in [SWIFT_FILE_MAP.md](../../04-docs/plans/ios-native-2026-09-09/SWIFT_FILE_MAP.md). Its future APIs are not an instruction to add unused methods now. The implemented map above is authoritative for this build.
