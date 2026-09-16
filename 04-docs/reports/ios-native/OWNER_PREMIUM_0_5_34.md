# Permanent owner Premium — 0.5.34 (94)

September 15, 2026, America/New_York. The owner explicitly selected permanent
complimentary owner Premium for cswarm34@gmail.com across iOS devices and builds.
Scope: native iOS and bark-ranger-ios only.

## Account and implementation

- Read-only Auth lookup confirmed Apple and password sign-in are already linked to
  the same enabled native Bark account. No identity linking, password changes,
  account merging or Apple purchase was needed.
- Added a separate administrator-issued owner entitlement. The backend requires
  the exact authenticated UID to match ownerUID, schema 1, premium=true and an
  explicitly null expiration. The app accepts this protected server projection
  in Debug and Release, including persisted offline access. It has no Apple charge,
  renewal or expiration, and is never inferred from an email address.
- Apple transaction ownership and history still reconcile normally. Purchase and
  notification processing preserve an existing valid owner grant through renewals
  and refunds. Ordinary customers retain the existing Apple access rules.
- Premium displays Owner Premium and permanent complimentary access. Its annual
  purchase offer is hidden for the owner, and the purchase coordinator also refuses
  an unnecessary purchase. Restore and any existing Apple subscription management
  remain available. Existing subscriptions are not automatically canceled.
- No new cloud collection, endpoint, rule, listener, recurring job or per-action read.
  Account deletion removes the entitlement with the account. Recreating an account
  does not regrant access automatically; reinstalls and replacement phones using
  the same account retain access.

## Verification and delivery

- Native backend: 135 checks passed, zero failures/skips, against demo-bark-native.
  Added coverage for wrong-UID/invalid grants, normal paid edits, deletion fencing,
  preservation through Apple purchase/refund processing and other-account isolation.
- Domain: 51 tests passed in Debug and separately 51 in Release. Permanent access
  survives encoding/decoding and a far-future date; ordinary development grants
  remain disabled in Release.
- iOS purchase/offer checks: 19 passed, zero failures/skips. Includes owner purchase
  prevention, restore, persisted entitlement and coordinator recreation, alongside
  existing purchase/account-switch/offer protections.
- Exact-target/CI guards: 5 passed. Changed Swift files pass strict formatting;
  whitespace check passes. Debug simulator test build and signed device Release
  build both succeeded.
- Deployed only nativeCommand, nativePurchase and nativeAppleNotification through
  the native-only impersonated deployer, firebase.native.json and explicit
  bark-ranger-ios target. Read-back confirms all three ACTIVE with the separate
  native runtime identity. Existing web production was not deployed or altered.
- Verified the signed app's native Firebase registration, bundle identity and
  production App Attest setting. Installed over the existing app without uninstalling
  and launched on cjs15pm. Device inventory confirms 0.5.34 (94).
- After the compatible app was installed, the administrator helper replaced only
  the authorized account's development grant with owner access, using both profile
  and entitlement version preconditions. A separate server read verified source,
  owner identity, revision, premium=true and no expiration.
- The owner confirmed “it works” on the actual phone after installation and grant
  activation. iPhone Mirroring was unavailable while the phone was in use; no remote
  screenshot or automated physical UI check is claimed. No owner data was deleted
  or edited.

Evidence: output/owner-premium-0.5.34/ (backend/domain/build/deployment logs,
PurchaseChecks.xcresult, phone installation/launch/version receipts and the signed
installed app). Temporary build/package caches and the task's isolated deployment
configuration were removed; the local emulator suite shut down normally.
Unrelated pre-existing working-tree edits were preserved. This is a developer-signed
Release installation, not an App Store submission or distribution.
