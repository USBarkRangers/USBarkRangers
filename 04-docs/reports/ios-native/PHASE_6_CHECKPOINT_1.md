# Phase 6 checkpoint 1 — Apple sign-in foundation

September 14, 2026. **Not accepted or enabled yet.** Local unit checks pass;
native Apple configuration and real-iPhone acceptance remain blocking gates. Purchasing
has not started. Existing web services, users, Firebase configuration and billing are untouched.

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

Synthetic Apple credentials exercise local orchestration, not Apple's real token validation,
consent sheet, relay delivery or server revocation. Those still require device acceptance.
The new commit must also complete GitHub's full Native iOS workflow; the earlier green
start-gate run is not presented as validation of these new changes.

## Remaining gate — do not start checkpoint 2 yet

1. Owner's Apple Developer login and team **V7Y6NA8G23** are confirmed. App ID
   **swarm.USBARKRANGERS** exists; Sign in with Apple is still unchecked. Confirm the
   native-only security change before enabling it and creating/configuring its dedicated
   service ID/key in **bark-ranger-ios** Firebase Authentication. Register the native mail
   sender for Apple's private relay. Keep private key material out of the app and GitHub.
2. Refresh entitlements/provisioning, build and verify real sign-in, cancellation, returning
   sign-in, Hide My Email, linking, reauthentication, sign-out/relaunch and disposable-account
   deletion/revocation. The owner's iPhone currently reports **unavailable**; reconnect and
   unlock it. Do not delete the owner's account for acceptance testing.
3. The shipping `appleSignIn` capability remains false. Enable it for device acceptance only
   once provider/signing setup is ready; checkpoint acceptance requires the actual device flow
   and green CI, not simply changing the flag.
4. Owner selected **20/year, seven-day trial, Family Sharing off**. Currency/exact price and
   billing grace duration need confirmation. TestFlight purchases are free Apple sandbox
   transactions; clarify that choice before setting up products. No products or pricing
   have been created or changed.

Implementation follows [Firebase's Apple authentication and revocation guidance](https://firebase.google.com/docs/auth/ios/apple).
