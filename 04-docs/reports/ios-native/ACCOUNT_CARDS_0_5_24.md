# Account cards — 0.5.24 (83)

## Change

Replaced the stacked Account form with the owner's reference layout: profile and membership cards, a Settings gear, and grouped Sync, Sign-in & Security, Manage Subscription, Data & Privacy, and Help & Support rows. Uses system light/dark surfaces and the existing adaptive accent. Text wraps at accessibility sizes; decorative icons have bounded columns.

Profile editing, security and deletion now have focused destinations. Pending Changes retains one Sync now action, never-sent Discard, offline editing information and the existing profile conflict decisions. The Account navigation stack resets on UID changes so an old account's form cannot remain open after sign-out or an account switch.

The avatar is a paw, not a photo-upload control. Profile-photo storage is not part of this change. Free read-only rules, Apple sign-in, subscription purchase/redemption, prices and the shared offline writer are unchanged.

## Engineering boundaries

- Removed `NativeAccountDetails`; its active conflict controls were moved, not duplicated or deleted.
- New views render the existing account projections and call existing feature owners. No new backend reads, writes, listeners, schema or billing changes. Opening Sync still observes the existing local pending projection.
- View responsibilities: landing/navigation, small card styling, profile card, membership card, detailed forms, conflict presentation. No new account model or sync implementation.
- Updated UI checks to navigate into the moved controls; retained the account test's existing scoped password-prompt handling. Unrelated working-tree changes, including the string catalog and all web/backend work, are excluded.

## Verification

- Simulator build-for-testing succeeded.
- 21 selected checks passed: all 6 NativeAccount UI checks plus AccountAction, AccountIsolation, NativePendingChanges and NativeAccountDeletion checks. This includes profile save/relaunch, trip save/relaunch, Free read-only access, pending actions, keyboard dismissal, sign-out and confirmed account deletion.
- New UI coverage exercises Free accounts in light/dark mode and Premium in light/dark at the largest accessibility text size. All destinations remain reachable, and signing out returns to the signed-out root without the previous profile.
- Inspected screenshots in addition to interaction results. Found decorative symbols overflowing their fixed columns at the largest text size and corrected their sizing.
- Account source formatting and staged whitespace checks passed.

Initial evidence: `/tmp/BarkAccountDesign.jByYEc/acceptance.log` and `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-2mil5dlx/Acceptance.xcresult`. Screenshots use disposable emulator accounts; no live user account or entitlement was changed.

## Final acceptance

- Final build 83 repeated the four-scenario layout/navigation check successfully after the icon fix. Inspected the new largest-text screenshots: decorative icons now stay inside their columns without overlapping text. Evidence: `/tmp/BarkAccountDesign.jByYEc/final-layout.log` and `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-ltzw91pc/Acceptance.xcresult`.
- 11 additional Apple account/presentation and app-shell checks passed, with no skips or failures. This includes verifying that an already Apple-linked account does not offer another sign-in button. These are local automated checks, not a new live Apple authentication or purchase. Evidence: `/tmp/BarkAccountDesign.jByYEc/AppleAndShell.xcresult`. Total: 32 distinct selected checks passed, plus the repeated four-scenario UI check.
- Clean Release build from commit `3d07bfa` succeeded; strict signature verification passed. Verified native Firebase project `bark-ranger-ios`, no device-emulator host, production App Attest and Apple sign-in entitlement.
- Updated the existing app on **cjs15pm** without uninstalling it. Device inventory confirms **0.5.24 (83)** and the launch succeeded at 13:47 EDT on September 15, 2026. Installation/launch evidence: `/tmp/BarkAccountDesign.jByYEc/phone-install.json`, `phone-launch.json`. Hands-on visual review on the physical phone remains with the owner; the automated interaction coverage ran on the Mac simulator.
- Code pushed to `USBarkRangers/USBarkRangers`, branch `codex/ios-native-setup`. [Native iOS checks](https://github.com/USBarkRangers/USBarkRangers/actions/runs/35003315728) were queued at handoff; the local results above are not a claim that hosted CI has finished.
- Stopped only this task's local emulator and catalog fixture processes. No web changes or cloud deployments.

Local simulator previews (disposable account data): [light](/Users/carterswarm/BarkRangerMap/output/account-cards-0.5.24.H0fWiH/light.png), [dark](/Users/carterswarm/BarkRangerMap/output/account-cards-0.5.24.H0fWiH/dark.png), [largest text](/Users/carterswarm/BarkRangerMap/output/account-cards-0.5.24.H0fWiH/largest-text-dark.png).
