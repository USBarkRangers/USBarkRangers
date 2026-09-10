# Prompt 1 — Foundation and app shell

## Activation and objective

When the user says **“start phase 1,”** implement this phase only. Read [the shared execution contract](../IMPLEMENTATION_PHASES.md), repository instructions, [architecture](../ARCHITECTURE.md), and the relevant [Swift file map](../SWIFT_FILE_MAP.md) rows before editing. This is the reusable implementation prompt; writing this document does not activate it.

Build a small, runnable native iPhone app with a clear structure, predictable navigation, a composition root, local diagnostics and useful build checks. At the end the user can launch it on a simulator and, with available signing, their iPhone. The shell explicitly identifies future screens as unfinished development areas.

## Start by checking

1. Inspect current changes and repository instructions. Preserve the existing web app and every unrelated edit. Confirm the beta/production entry distinction from the current checkout.
2. Inspect the available Xcode, Swift, simulator runtimes and signing setup. Use a supported stable toolchain; record its exact version. The planning minimum is iOS 18.4. Do not silently raise it or select a beta toolchain.
3. Reuse approved Bark branding/assets. Set local bundle/configuration placeholders only where external identifiers are missing, visibly documenting them. Do not register app IDs, create Firebase projects or configure App Store Connect as a side effect.
4. Confirm the native directory is absent or inspect any newer implementation before creating files. Continue existing appropriate work instead of generating a second Xcode project.

## Files and boundaries

All native paths are under `01-code/ios/`. IDs below refer to the exact ownership/API map.

| Files to introduce | Implement now | Defer within those same files |
|---|---|---|
| D01 `Park.swift` | Stable ParkID/site/coordinate and basic immutable park value contract; keep it Foundation-only and Sendable. | Full publication decoding/validation belongs to phase 2. Do not create every domain file yet. |
| A01 `BarkRangerApp.swift` | One SwiftUI app entry, scene lifecycle and URL forwarding. | Firebase, tracking and purchase startup. |
| A02 `AppComposition.swift` | Constructor injection for the shell and deterministic previews. Objects have one obvious owner. | User-scope factories and repositories until needed. No global container lookup. |
| A03 `AppLifecycle.swift` | Foreground/background forwarding and cancellation of shell-owned work. | Network refresh in 2; account switching in 3; recording in 5. |
| A04 `AppRouter.swift` | Typed root destinations/sheets, dismissal, basic URL validation; unsupported destinations fail safely. | Feature-specific IDs/routes only as their features arrive. |
| A05–A06 `StartupModel.swift`, `StartupView.swift` | Shell readiness and a native loading/recovery presentation with no artificial delay. | Actual offline/network decision in 2. No pretend catalog fetch or fake progress percentage. |
| A07 `RootView.swift` | Accessible native navigation, shell tabs and injected destinations. Preserve state through ordinary tab/scene changes. | Real map/trips/passport/account screens. Small development placeholders stay local to RootView. |
| P17 `Diagnostics.swift` | Redacted OSLog events and a simple duration-measurement boundary. | Remote diagnostics/MetricKit decisions in 6. No analytics SDK expansion. |
| F12 `Home/HomeView.swift` | Welcome content and a clean entry to implemented shell navigation. | Full education/resource content in 2 and sharing actions in 5. |

Create the app project/shared scheme, `Packages/BarkDomain/Package.swift`, Base/Debug/Release configuration, minimal Info.plist, initial asset metadata/icon, localization catalog, and app/unit/UI test targets. Add only currently necessary settings. Create the Activity extension in phase 5 when it has real content; Firebase packages/configuration in phase 3; StoreKit configuration in phase 6. Do not add unused permission descriptions/capabilities now.

Create/update the native README, architecture walkthrough, contributing guidance, Config README and ADR 0001 with implemented facts. Add `.github/workflows/ios-checks.yml` for package tests, simulator build and shell tests on a supported pinned runner/toolchain. CI must not deploy, sign with invented credentials or depend on a developer's login. If hosted CI cannot run from this checkout, verify its commands locally and record the remote execution as pending.

## Implementation sequence and calls

1. Make the package and a buildable app target. Resolve target membership and Swift concurrency rules before adding screens.
2. Wire `BarkRangerApp → AppComposition → RootView`, with router/lifecycle/startup injected. RootView changes navigation through AppRouter. StartupView observes StartupModel. None of these read the filesystem, Firestore or sheets directly.
3. Add a simple first screen and predictable tabs/sheets. Use system safe areas, text styles, controls and dark/light appearance. Preserve the existing brand without custom browser-like navigation machinery.
4. Handle foreground/background and URLs without duplicate task creation. Reject malformed/unsupported links without crashing or navigating to private placeholders.
5. Add diagnostics and meaningful smoke tests, then write setup instructions using commands that actually worked. Keep the documented dependency graph short enough for a senior engineer to understand on the first page.

## AI verification before handoff

- Build the app and test targets for an installed iPhone simulator and run the Foundation package tests. Address new compiler/concurrency warnings; explain any toolchain warnings outside the codebase's control.
- Use `AppShellTests.swift` and `AppShellUITests.swift` for actual route/scene/launch behavior. Add only useful domain assertions where identity invariants are present; do not test synthesized getters just to fill a suite.
- Launch, switch tabs, present/dismiss a sheet and relaunch. Check no repeated startup work, permission prompts, network requirement or unexpected Firebase initialization.
- Check largest practical Dynamic Type, VoiceOver labels/reading order, light/dark appearance and small-phone safe areas for implemented controls.
- Verify a documented simulator build from clean derived data and that no private credentials, generated user data or unrelated changes entered the diff. Do not delete user-owned files to create a clean test environment.

## User testing checklist to include in the phase report

| User action | Expected result |
|---|---|
| Follow the short launch/install instructions. | The native app opens successfully; missing signing prerequisites are explicitly listed. |
| Launch in airplane mode. | The shell opens without waiting for network or asking to sign in. Park availability starts in phase 2. |
| Visit each tab, return Home, open/dismiss a sheet. | Navigation is consistent and unfinished areas are clearly identified. |
| Background, reopen, close and relaunch. | No crash, duplicate cover or stuck loading screen. |
| Try larger text and dark mode. | Controls remain readable and usable. |

## Completion and stop

Deliver the working shell, concise ownership walkthrough, actual build/test evidence and `04-docs/reports/ios-native/PHASE_1.md`. Identify what the user can test now and what is intentionally later. Compilation is mandatory for a completed phase; an unavailable toolchain/signing check is a named prerequisite, never a successful test.

Update the status table to awaiting user testing only when the implemented build is ready for it. Fix the user's phase-1 feedback next. **Do not start catalog, Firebase or phase 2 until the user explicitly starts phase 2.**
