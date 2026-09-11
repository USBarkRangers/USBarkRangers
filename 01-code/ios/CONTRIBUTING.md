# Working on the native app

Start with [ARCHITECTURE.md](ARCHITECTURE.md), the repository `AGENTS.md`, the active [phase prompt](../../04-docs/plans/ios-native-2026-09-09/IMPLEMENTATION_PHASES.md), and the current phase report. Complete one phase, let the user test it, fix feedback, and wait for an explicit start of the next phase.

1. Keep native source in `01-code/ios/`. Preserve unrelated changes and the working web app. Use `codex/` branches and the `usbarkrangers` remote for this native work. Never push through the multi-remote `both` alias by habit.
2. Put immutable values and deterministic rules in BarkDomain; import Foundation only there. Use explicit `Sendable` values. Add public members only for a real caller.
3. Views render and forward actions. Models own decisions; the composition root wires dependencies. Add a protocol when a specific side effect needs substitution, not for every class. No global container, event bus, generic base model or broad Utilities file.
4. Create a file for a distinct responsibility, then update its ownership/call map. Do not create all future files or split a coherent 150-line type to hit a line budget. Remove a development placeholder when its feature replaces it.
5. Use native semantic controls/text styles, scrolling, safe areas and localizable strings. Preserve VoiceOver labels and Dynamic Type. Never put debugging credentials or backend details in user flows.
6. Run the domain tests and the app/unit/UI checks in the README for relevant changes. Test behavioral boundaries and failure paths. Do not add tests that merely restate synthesized getters.
7. Inspect the staged diff before committing. Exclude user Xcode state, derived data, signing credentials and unrelated edits. Do not deploy, modify real users/payments or provision providers as a side effect of implementation.

The Xcode source folders are synchronized with their matching targets. A new Swift file under `BarkRanger` joins the app; test code belongs under its test target folder. Keep non-resource configuration outside `BarkRanger`. The local package is independently testable without a simulator.

Swift 6 strict concurrency and the app's default MainActor isolation are enabled. Domain values have no default UI isolation. XCTest UI test methods explicitly use MainActor while their XCTestCase subclass remains nonisolated, matching XCTest's initializer boundary.

Keep logs constrained to the fixed event/operation vocabulary in Diagnostics. Do not add raw URLs, UIDs, GPS samples, tokens or free-form error descriptions to logs. No remote diagnostics transport is present.

Native refresh tests use the local catalog fixture server described in the README. Phase 3 adds synthetic emulator accounts and provider adapters that prevent real billing/support side effects; follow the [account testing runbook](../../04-docs/operations/NATIVE_ACCOUNT_TESTING.md). Ordinary tests keep accounts unavailable unless explicitly opted into that workflow. Follow the Firebase ownership guide before any future infrastructure change.

Use Xcode’s bundled `swift-format` with `.swift-format` for formatting; keep coherent operations together rather than splitting files to reduce physical line counts. Run catalog schema parity tests whenever the bundle or its publisher contract changes.
