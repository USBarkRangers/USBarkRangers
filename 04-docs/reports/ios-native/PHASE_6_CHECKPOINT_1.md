# Phase 6 checkpoint 1 — Apple sign-in device acceptance

September 14, 2026. **Real linking verified; checkpoint not fully accepted yet.**
The unnecessary second Apple button is fixed in **0.5.21 (80)** and verified locally.
The signed build is ready, but `cjs15pm` currently reports unavailable; installation,
remaining device acceptance and the new commit's full GitHub CI remain gates.
Purchasing has not started. Existing web services, users, legacy Firebase configuration
and billing are untouched.

## What changed

- The existing Apple adapter owns one random nonce and request state, consumed once.
  Tokens and authorization codes are neither logged nor persisted. Successful callbacks
  use Apple's returned state to avoid mistaking an old reply for a newer request.
- The existing account model handles sign-in, explicit linking, reauthentication and
  confirmed deletion. It prevents competing form actions during the Apple sheet and
  checks cancellation/account identity across asynchronous boundaries.
- Apple-linked deletion requires fresh Apple reauthentication and authorization-code
  revocation **before** the existing native deletion lifecycle. Password confirmation
  alone cannot bypass this. Failure leaves local data intact; accepted cloud deletion
  remains owned by the existing session cleanup process.
- One shared native Apple button serves those intents. Linking consent explains account
  association and Hide My Email. Apple's first-use name goes to Firebase identity, not
  automatically to the public profile/leaderboard.
- Removed the adapter's unused cached authorization code. No second auth service,
  credential cache, storage writer, retry queue or new Firestore collection was added.

## Size and verification

Five changed runtime files: **552 → 710 lines (+158)**, including comments/formatting.
The account model is **214 → 278**; adapter **40 → 70**. Runtime file count is unchanged.
Tests add one 207-line file and nine net lines of shared test support. This checkpoint
adds required Apple behavior; it is not a code-reduction checkpoint.

Activation adds no runtime files: four source/configuration files changed, **15 lines
added / 21 removed (net -6)**, excluding this report. This consists of the capability,
entitlement, matching expectation and app/extension version bump; no second service.

- Start gate: [Native iOS CI passed on 16020fe](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34903360552).
- Initial focused checks: 18 tests / 29 cases passed; no skips.
- Expanded run reproduced one new cancellation failure: the model attempted revocation
  after cancellation during reauthentication. The production adapter already rejected
  canceled calls, but the model now stops before invoking that next step as well.
  The expectation was retained. Evidence: `/tmp/BarkAppleCheckpoint1LocalFinal.xcresult`.
- Final local unit run: **301 passed / 0 failed / 29 opt-in tests skipped**, including
  369 passing parameterized cases. The new Apple suite contributes 8 tests / 20 cases.
  Evidence: `/tmp/BarkAppleCheckpoint1Verified.xcresult` (Xcode 26.6, iOS 26.5 simulator).
- Native SDK/account UI: **5 passed / 0 failed / 0 skipped** against `demo-bark-native`
  using CI's native configuration, Node 22 and Java 21. Includes account creation,
  profile/appearance/relaunch/sign-out and disposable-account deletion through the UI.
  Evidence: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-wv98vu6t/Acceptance.xcresult`.
- Full native trip-feature suite: **6 passed / 0 failed / 0 skipped**, including
  `oneDemandOwnerReusesCachedDetailsAndRefreshesRemoteNotesOnlyWhileOpen()` with the
  unchanged exact-one-download requirement. Evidence:
  `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-g4ldkklk/Acceptance.xcresult`.
  The first method-only selection did not execute that Swift Testing case; the result
  bundle exposed the omission, so the full suite was run and its actual names checked.
- Domain suite: 48 passed. No backend runtime, rules or index changes in this checkpoint;
  ordinary data actions gain no new Firestore reads or writes.
- Activation checks on 0.5.20: **18 tests / 32 cases passed, 0 failed, 0 skipped** across
  `AppleAccountTests`, `AccountActionTests`, `AccountIsolationTests` and
  `NativeAccountDeletionTests`. Evidence: `/tmp/BarkApple0520Activation.xcresult`.
  The activation expectation changed from disabled to enabled because the provider and
  signed capability are now configured; unrelated safety expectations were not weakened.
- Signed physical-device build passed; strict code-signature verification passed. The
  binary and embedded provisioning profile both include `com.apple.developer.applesignin`
  `Default`, team `V7Y6NA8G23` and the exact main app ID. Embedded Firebase configuration
  targets only `bark-ranger-ios`. Swift formatting checks passed.
- Installed and launched **0.5.20 (79)** on the connected `cjs15pm` using Apple's device
  tools. This confirms installation/launch, not completion of Apple's consent flow.
- The owner subsequently reported completing Apple linking and signing in a second time.
  A read-only native Authentication lookup verified both `apple.com` and `password` on
  the original test account, created **2026-09-14 05:12:56 UTC**, with authentication at
  **2026-09-15 02:25:34 UTC**. Its existing development entitlement still matches that
  same UID and remains valid. **Correction:** the later screen investigation found a
  standalone reauthentication button. This proves successful linking, not necessarily
  sign-out/returning Apple sign-in; the second tap may have only reconfirmed identity.
  A deliberate sign-out/Apple sign-in/relaunch check is still required.
  Verification used **1 Auth lookup + 1 Firestore document read, 0 writes**. No tokens,
  Apple subject identifiers, email addresses or private document contents were logged.

Synthetic Apple credentials exercise local orchestration, not Apple's real token validation,
consent sheet, relay delivery or server revocation. Those still require device acceptance.
The new commit must also complete GitHub's full Native iOS workflow; the earlier green
start-gate run is not presented as validation of these new changes. At activation,
the foundation commit `ea49cb8`'s [full CI run](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34918092703)
was still running. The activation commit `d252f54`'s
[full CI run](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34920812352)
was still running when the button fix began. The 0.5.21 fix requires its own green run;
neither an earlier run nor local checks substitute for that gate.

## Second-button correction — 0.5.21 (80)

- Root cause: `AccountDeletionSection` always appended provider reauthentication controls
  below the deletion section. Once Apple was linked, that produced another identically
  labeled Apple button even when no protected action had been requested.
- Removed only that three-line block: **runtime section 53 → 50 lines (-3)**, no new
  runtime files or services. The destructive alert → fresh Apple confirmation → revocation
  → existing deletion lifecycle remains unchanged. Account linking and signed-out sign-in
  remain available in their intended locations.
- Added **one 60-line presentation test** and **one net line of test support**. It renders
  the real security/deletion views with synthetic identities and counts native
  `ASAuthorizationAppleIDButton` controls. No real Apple request or cloud mutation is made.
  Password-only accounts provide a positive control: exactly one linking button.
  Apple-only and Apple/password accounts must have zero unsolicited Apple buttons.
- Before the fix, the test reproduced **1 actual vs 0 expected** on an Apple-linked account:
  `/tmp/BarkAppleButtonBefore0521.xcresult`. After the fix, the same expectation passes.
  Before/after rendered attachments were visually inspected, not just the test exit status.
- Final focused checks: **19 tests / 33 cases passed, 0 failures, 0 skips**, including
  request/cancellation/account-isolation and deletion ordering/failure preservation checks:
  `/tmp/BarkApple0521Focused.xcresult`. Existing security expectations were not weakened.
- Native integration checks on the same 0.5.21 build: **10 passed, 0 failures, 0 skips**
  using CI's `demo-bark-native` configuration, Node 22 and Java 21. This includes both
  account-feature cases, all six trip-feature cases (including the unchanged exact-one-download
  requirement), account creation/edit/appearance/relaunch/sign-out UI, and disposable
  email-account deletion UI. Actual case names and counts were inspected in
  `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-ewp4e0hs/Acceptance.xcresult`.
  Emulator email-account deletion does not prove real Apple revocation.
- Signed 0.5.21 build and strict code-signature verification passed. Verified exact app/team,
  enabled Apple entitlement, build number 80 and embedded `bark-ranger-ios` configuration.
  Existing derived-data output directory is `/tmp/BarkDeviceApple0520`; its app now contains
  0.5.21 (80), not the previous build. Swift formatting and scoped diff checks passed.
- No backend runtime, rules/index changes or deployment were needed for this UI fix;
  ordinary reads/writes are unchanged. Products and StoreKit implementation remain untouched.
- Code and regression check pushed as **`fa025a5`**. Its
  [full GitHub CI](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34922283360)
  is pending, not green. Subsequent evidence-only documentation changes do not change the
  tested app/backend code. Local emulators and the temporary catalog server were stopped.

## Native-only configuration completed with owner approval

- Enabled the main bundle **`swarm.USBARKRANGERS`** as the primary Sign in with Apple App ID
  on paid team **`V7Y6NA8G23`**. Existing HealthKit configuration was preserved.
- Created Services ID **`swarm.USBARKRANGERS.signin`**, associated only with that primary
  app, domain `bark-ranger-ios.firebaseapp.com`, and return URL
  `https://bark-ranger-ios.firebaseapp.com/__/auth/handler`.
- Created dedicated key **`4ZK7M78JW3`** with only Sign in with Apple permission for that
  primary app. The one-download private key is backed up outside Git/app resources at
  `~/.config/bark-ranger-ios/apple/AuthKey_4ZK7M78JW3.p8` (directory mode 700, file 600).
  Key bytes were never printed, logged or committed.
- Created and verified Firebase Authentication's enabled `apple.com` provider through
  the native-scoped deployer, without owner-credential fallback. Google canonicalizes
  the resource as `projects/360077919845/defaultSupportedIdpConfigs/apple.com`;
  project number, Services ID, sole bundle ID, team and key ID were verified exactly.
  The private key was transmitted directly to the native provider's code-flow configuration.
  Firebase Console also shows Apple **Enabled**. No functions/rules/index deployment was
  needed because this checkpoint changes Authentication configuration, not those services.
- Registered only `noreply@bark-ranger-ios.firebaseapp.com` and
  `noreply@ios.usbarkrangersmap.com` with Apple's private email relay; both visibly show
  green SPF checks. Firebase's custom native sender verification is still in progress:
  its current template uses the first address. Actual relay delivery is not yet verified.
  No legacy sender or DNS record was changed in this activation.

## Remaining gate — do not start checkpoint 2 yet

1. Reconnect/unlock `cjs15pm`, install 0.5.21 (80), and confirm no extra Apple button appears
   on the linked account. Then deliberately sign out, cancel one Apple sign-in attempt,
   sign in with Apple, and relaunch; confirm saved content remains on the same account.
2. Verify actual cancellation, Hide My Email/relay delivery, reauthentication and explicitly
   authorized disposable-account deletion/revocation. Do not delete the owner's account
   or move its Apple sign-in to another account for acceptance testing.
3. Require the button-fix commit's full green CI and real-device acceptance before
   checkpoint 2 or release. An installed build and synthetic credentials are not acceptance.
4. App Store Connect is presenting Terms of Service; the owner must review/accept them.
   No agreement was accepted on the owner's behalf, and the app-record check remains
   blocked behind that page. This does not prevent local builds or the configured native
   Apple authentication flow.

## Owner's confirmed purchase choices — implementation remains checkpoint 2

**USD $19.99/year, seven-day free trial, Family Sharing off, Apple Billing Grace Period off
in both live and sandbox settings.** Current Premium is temporary test entitlement only,
not an Apple subscription. No products/settings were created or changed. Bark's separately
approved 40/45-day offline rules are unchanged. The web app stays untouched.

Implementation follows [Firebase's Apple authentication and revocation guidance](https://firebase.google.com/docs/auth/ios/apple).
