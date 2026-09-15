# Phase 6 — Apple purchases implementation and evidence

September 15, 2026. **In progress; not a completed cloud/device acceptance.**
This checkpoint backs up the purchase vertical slice and its shared lifecycle boundary.
The owner requested Mac-first verification and one final iPhone acceptance session.
Existing web code, users, billing and `barkrangermap-auth` are outside this work.

## Implemented

- One app-owned purchase coordinator, thin StoreKit adapter, typed native callable and
  shared Premium screen. Existing paid entry points use the same screen. One existing
  NativeStore writer and entitlement publisher; no second billing queue or per-screen
  Premium cache. StoreKit retains unfinished transactions until server confirmation.
- Server-issued account token, verified Apple signatures/current subscription status,
  immutable subscription ownership, duplicate/in-flight coalescing and account-switch
  fences. Genuine sandbox and production are distinct; sandbox cannot replace production.
  Local Xcode signatures are rejected by the live verification code.
- Purchase, restore and notification processing share one transactional entitlement writer.
  Deletion fences that writer and removes ownership rows; late events cannot recreate users.
  Near-expiry refresh is throttled; no scheduled billing reconciliation was added.
- Normal expiry preserves Bark's 40-day edit/45-day upload policy. Learned refunds and
  revocations remove access without a new grace period. Apple billing grace remains off.

New runtime boundary: **5 Swift files / 569 lines** and **5 JavaScript files / 380 lines**,
including comments and paywall accessibility fixes. Largest new file: purchase coordinator
265 lines. Additional existing-file edits wire navigation, entitlement policy and deletion.
This is required new billing functionality, not a code-reduction checkpoint.

## Apple configuration completed

- App `6812160476`, bundle `swarm.USBARKRANGERS`; group `22385849`.
- Product `swarm.USBARKRANGERS.premium.annual` (`6812171155`): one year, **USD $19.99**,
  **one-week free trial**, Family Sharing off. Initial availability is United States only.
  Trial starts September 15 with no campaign end date. Group/product English U.S.
  localization saved. No monthly installment plan, offer codes or win-back offer created.
- Dedicated IAP key `689KNVT36S`, named “Bark Ranger iOS purchases,” stored as version 1 of
  `NATIVE_APPLE_IAP_CREDENTIAL` in **bark-ranger-ios only**. Runtime has access to this secret;
  native deployer has metadata-view access. Private backup is outside Git/app resources,
  under the owner's private `.config/bark-ranger-ios/apple` directory (700/600 permissions).
  No private key bytes were printed or committed. No real payment or store submission.
- Last Business check: Paid Apps Agreement **Pending User Info**, banking/tax incomplete.
  Account holder must finish those; the assistant has not signed agreements or entered tax data.
- Production and sandbox notification URLs saved and confirmed after reloading App Store
  Connect: `https://us-east1-bark-ranger-ios.cloudfunctions.net/nativeAppleNotification`.
  Apple accepted the dedicated key in sandbox; the genuinely Apple-signed TEST notification
  passed the deployed signature verifier and Apple reported delivery **SUCCESS**.
  Production TEST returns HTTP 401 before release. Apple's Commerce Engineer confirms that
  production API access is locked until a production release:
  https://developer.apple.com/forums/thread/806452 . Production delivery remains a release
  acceptance gate; sandbox success is not described as production transaction proof.
- Native Firebase iOS registration now has team `V7Y6NA8G23` and App Store ID `6812160476`;
  App Attest is registered with a one-hour token lifetime. The Release signing entitlement
  selects production App Attest. Debug retains its private debug-token provider; Release
  never falls back to that provider. Actual hardware attestation is still a device check.

## Native deployment and live checks

- Deployed through `05-tools/scripts/deploy-native-ios.cjs bark-ranger-ios` with the scoped
  native deployer, exact native configuration/guard and native runtime identity. Created
  `nativePurchase` / `nativeAppleNotification`; updated native commands/read/deletion/cleanup
  and native indexes. No hosting or legacy backend deployment. Log: `/tmp/bark-phase6-deploy.log`.
- Real disposable-account acceptance passed, including purchase Auth/App Check enforcement,
  stable repeated context, free refresh, forged/Xcode-claimed unsigned proof rejection,
  owner/global private billing path denial, and existing trip/note/pin/visit persistence and
  duplicate protection. Log: `/tmp/bark-phase6-live-cloud-smoke.log`.
  This is not a genuine Apple transaction test or a physical App Attest test.
  Afterwards the exact disposable QA account was disabled, its temporary grant revoked,
  its debug registration removed and its private credential fixture deleted. Synthetic
  evidence documents remain; no owner account or owner entitlement was changed.

## Measured verification

- Native backend: **124 passed / 0 failed / 0 skipped**, Node 22 + Java 21, native
  Auth/Firestore/Functions emulators. Includes ownership, retries/lost acknowledgment,
  refund/out-of-order delivery, deletion race, private-path rules and ordinary-action costs.
  Log: `/tmp/bark-phase6-native-emulators.log`.
- Domain: **49 passed**, including shared Swift/JavaScript 40/45-day boundary fixtures.
- Purchase coordinator: **11 passed**, including held server response across sign-out,
  duplicate callback, confirmation failure/relaunch, no second purchase and refund publication.
- **Real StoreKit: 1 passed**, not a mocked substitute: annual price, seven-day trial,
  purchase/account token, unfinished redelivery, finish, restore, renewal and refund.
  Final 0.5.22 (81) result: `/tmp/BarkPhase6PurchaseFinal261.xcresult`,
  **12 passed / 0 failed / 0 skipped**. A failed Restore without a purchase now reports a
  restore failure, not the false claim that an Apple purchase awaits confirmation.
  Same app/test binary on iOS 26.5 fails before product loading with SKInternalErrorDomain
  Code 3 and storekitd “not installed for development”; iOS 26.1 succeeds. GitHub therefore
  runs this test in a separate required 26.1 job, while ordinary app/UI checks remain on 26.5.
  Restore this test to the main runtime after an Apple fix is reproduced, not by skipping it.
- The previous GitHub run `34924658674` passed **200 of 202** native checks, but failed the
  initial bootstrap waits in both NativeAccountFeatureEmulatorTests. The result call stacks
  locate lines 27/64; the first failed at 03:38:53.936 UTC, its function only began at
  03:38:54.586 and completed at 03:38:59.004. These startup waits now use the same bounded
  15s allowance as existing trip fixtures. No data assertion, edit timeout or exact-one-trip-
  download requirement was relaxed. The shared wait helper now reports its caller location.
  The full local rerun using CI's emulator setup now passes: **187 tests / 202 parameterized
  cases, 0 failures, 0 skips**. Exact-one-trip-download and native account UI pass.
  Result: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-grx9gutn/Acceptance.xcresult`.
  A new final-commit GitHub green is still required. The real StoreKit job on commit
  `38b373a` passed in GitHub run `34928275964`; the isolated native backend workflow also passed.
- Paywall accessibility review found a low-contrast section heading and inactive offer
  control; full shell review then caught a too-small new Upgrade target and clipped Trips
  empty-state content. Fixed the actual views: explicit primary heading color, omit the
  unavailable build's dead control, shared 44-point Upgrade target, scrollable/wrapping Trips
  empty state. No accessibility exclusions or weakened expectations were introduced.
  Premium navigation/large-text checks and existing full light/dark accessibility check pass
  together on iOS 26.1: `/tmp/BarkPhase6PremiumAccessible.xcresult` (2 tests, 0 failures).
  The same two checks also pass on the main iOS 26.5 runtime:
  `/tmp/BarkPhase6PremiumAccessible265.xcresult` (2 tests, 0 failures).
  That old-binary full shell run has now finished: **349 passed / 2 failed / 36 skipped**
  unique tests (**417 passed / 2 failed / 36 skipped** parameterized cases), at
  `/tmp/BarkPhase6FullShell.xcresult`. Its failures were the Trips hit target and Premium
  contrast issues fixed above; it is not evidence that the updated full suite passes.
  The final source must still pass the full suite in GitHub.
- Development-signed Release build and strict code signature verification passed with the
  correct team, Apple sign-in and production App Attest entitlement. This is not an App Store
  distribution archive. Final UI changes also rebuilt and passed strict signature verification:
  `/tmp/BarkPhase6Release/Build/Products/Release-iphoneos/BarkRanger.app`,
  build log `/tmp/bark-phase6-release-final-build.log`.
- Existing visit-cost test used wall-clock time; running before 04:00 UTC legitimately
  awarded a night badge (+1 write). Its baseline now uses yesterday at noon UTC, injected
  into both command and executor. **All existing exact cost assertions are unchanged.**

### September 15 CI follow-up — emulator isolation

- Native backend run `34934458357` passed on `a77cde6`. Native iOS run `34934458333`
  failed: **188 native tests passed / 1 failed / 0 skipped** (203 passed parameterized
  cases). The failing test was the first account feature's initial bootstrap wait, not
  a duplicate trip download. The separate StoreKit job failed during runtime installation
  with “Unable to connect to simulator” (70), before its test ran. Full shell did not run.
- Exported CI diagnostics show the fake `demo-bark-native` registration calling Google's
  live `exchangeDebugToken` endpoint at 06:10:38.201 UTC; no native function invocation
  occurred during that test's startup window. This proves an unwanted external dependency,
  not that every millisecond of the failure was spent in App Check. The failed assertion
  also removed its fixture directory before its active SQLite writer stopped.
- Debug now selects a local, deliberately invalid App Check marker only for the exact
  three-part demo registration. Live Debug still uses registered debug tokens; Release
  still requires App Attest. Factory installation precedes emulator Firebase creation.
  Regression coverage checks a forced SDK token refresh and independently mismatched
  project/app/key values. Failed fixture cleanup now drains and erases its isolated store
  before directory removal. Wait diagnostics report the actual caller. **No timeout,
  data assertion or exact-one-download expectation was weakened in this follow-up.**
- Workflow retry is limited to simulator runtime installation (three attempts); the
  required real StoreKit test itself still runs once and must pass.
- Updated local focused native SDK/account UI checks: **15 passed / 0 failed / 0 skipped**,
  including the exact-one-download check (0.91s), initial account bootstrap (0.93s), new
  SDK isolation check (0.014s), and account UI create/edit/relaunch/sign-out (86.10s).
  Result: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-rx_awvsg/Acceptance.xcresult`.
  The simulator log query for the demo Google's App Check URL returned no matches during
  this run; this is a scoped log check, not a whole-device network capture.
- Updated actual StoreKit 26.1 check: **1 passed / 0 failed / 0 skipped**, at
  `/tmp/BarkPhase6CIReview.7TKpNm/StoreKit261.xcresult`. This remains local Apple StoreKit
  simulation, not genuine Apple sandbox-to-backend proof.
- Updated development-signed Release build and strict signature verification passed.
  Production App Attest entitlement remains present; emulator factory/provider names and
  its marker are absent from the Release binary. No deployment or phone installation.
- Change size before report: **6 files, +125/-35 lines**, including the regression tests
  and runtime-setup fix. Reviewed source pushed as **`fa4b00f`**. Its isolated native backend
  [run 34942547494](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34942547494)
  passed **126 tests / 0 failures / 0 skips**; local deployment/CI-isolation checks passed
  **5/5** and Swift domain checks **49/49**.
- The same source's [Native iOS run 34942547676](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34942547676)
  ultimately failed in the final app/UI suite. Its required **StoreKit job passed: 1 test / 0 failures**,
  including annual offer, purchase retention, restore, renewal and refund. Runtime setup
  succeeded without weakening or skipping the actual test; job `104294337415` recorded
  `TEST SUCCEEDED` at 07:54:28 UTC.
  The hosted **Native SDK and account UI** step passed at **08:11:18 UTC**: artifact confirms
  **190 tests / 205 cases, 0 failures / 0 skips**. Final app/UI: **352 tests / 420 cases
  passed, 1 failed, 37 skipped**. The sole failure is detailed below; overall CI is not green.
- Updated full local native regression **passed: 190 unique tests / 205 parameterized cases,
  0 failures / 0 skips**, completed 07:44:10 UTC. Evidence:
  `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-fc8jmy1c/Acceptance.xcresult`,
  log `/tmp/BarkPhase6CIReview.7TKpNm/native-full.log`. The same launched command proceeded
  to the full app/UI suite at `/tmp/BarkPhase6CIReview.7TKpNm/ShellFull.xcresult`, with
  `shell-full.log` in that directory. **Full local app/UI passed at 08:17:40 UTC: 353 unique
  tests / 421 parameterized cases, 0 failures, 37 skips.** Both previously failing
  accessibility/Premium checks passed in this full run, not just in isolation.
  Comparing exact test identifiers confirms **34 of those 37 skips passed in the separate
  native run**. The other three are unchanged opt-in live Apple place search, live catalog
  offline relaunch, and disposable live native cloud acceptance; this local run does not
  claim them. Live native cloud evidence remains separately recorded above. StoreKit runs
  as its separate required 26.1 check. These overlapping suite counts must not be summed
  as distinct tests. Native emulators are stopped. Final hosted app/UI success is pending.

### September 15 CI follow-up — cold share-sheet readiness

- Hosted failure: `PassportUITests.swift:55` immediately required “Save to Files” after
  the remote share container appeared. All four watermark corner/bounds checks and resizing
  passed. CI's exported screen recording ends with a dimmed photo and an empty remote
  share overlay: the container existed before Apple's activities had loaded. The product's
  JPEG is written before presentation; this is not evidence of a watermark-position defect.
- Reproduced the unchanged test on a newly created iOS 26.5 simulator: **0 passed / 1 failed**
  at the same immediate action assertion, after all watermark checks passed.
  Evidence: `/tmp/BarkWatermarkCI.6mQjxD/FreshBefore.xcresult`. Hosted artifacts are in
  `/tmp/BarkWatermarkCI.6mQjxD/BarkShell.xcresult`; the recording/frame are retained there.
- The test now waits for the exact “Save to Files” action and “JPEG Image” caption, each
  with a bounded 10-second condition wait. Neither required content nor any watermark,
  account or one-trip-download assertion is removed. No sleeps, retries-to-green,
  accessibility exclusions or shipping app/backend changes. Code delta: **1 test file,
  +8/-2 lines**. On a second freshly created simulator the changed test **passed 1/1,
  0 failures / 0 skips**: `/tmp/BarkWatermarkCI.6mQjxD/FreshAfter.xcresult`. The action/content
  readiness checks completed about 2.2 seconds after starting the action wait. The retained
  screenshot visibly shows “Save to Files” and “JPEG Image · 1.4 MB”. This is a reproduced
  cold-start test race with before/after evidence, not an assumption based only on a warm pass.
  Three unconditional complete repetitions on the existing main simulator also **passed
  3/3, 0 failures / 0 skips**: `/tmp/BarkWatermarkCI.6mQjxD/WarmAfter.xcresult`. These were
  fixed-count repetitions, not retry-until-success. Both temporary fresh simulators were
  removed after testing; their result bundles/attachments remain available. No user data
  or existing simulator was removed.
- Fix pushed as **`a75e957`**. The full required
  [Native iOS run 34952712455](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34952712455)
  is not yet green; see the separate runner-launch failure below. Shipping app/backend source is
  unchanged from `fa4b00f`, whose backend workflow passed. This follow-up changes only
  Passport test readiness and this report; no deployment or phone install.

### September 15 CI follow-up — simulator test-runner launch

- Run `34952712455`, attempt 1: StoreKit passed again. Native SDK **179 tests / 194 cases
  passed, 0 assertion failures / 0 skips**, then the UI runner could not launch. Xcode records
  one runner infrastructure error; **no UI test executed**, and the final full app/UI step
  never ran. This run neither verifies nor disproves the share-sheet fix in hosted CI.
- The exported Xcode session log records successful installation of
  `BarkRangerUITests-Runner.app` at **09:48:34.925 UTC**, followed by launch at 09:48:34.926;
  at 09:48:47.863 CoreSimulator/FrontBoard reported the same runner identifier “unknown”.
  Evidence: `/tmp/BarkNativeCIRepeat.6xAMWa/BarkAccountChecks-oq96egdv/Acceptance.xcresult`
  and its exported `diagnostics` directory. This is an installation/launch registration
  failure before UI execution, not an observed app assertion failure.
- Requested **one unchanged rerun of the failed job (attempt 2)**, retaining the successful
  required StoreKit job. It rebuilds and runs the entire native and full app/UI checks.
  No app, test, timeout, assertion or workflow change was made for this infrastructure error.
  If the same launch failure recurs, investigate further rather than repeatedly retrying
  it into a green result. Overall workflow green remains required.

### September 15 CI follow-up — fixture readiness and late password UI

- Run `34952712455`, attempt 2 launched its UI runner successfully, but native acceptance
  **failed: 186 unique tests / 201 parameterized cases passed, 4 failures, 0 skips**.
  The four are profile SDK bootstrap, saved-pin app bootstrap, pending-visit account
  readiness, and account UI sign-out. StoreKit remains passed; full shell did not run.
  Evidence: `/tmp/BarkNativeAttempt2.tiE0uJ/BarkAccountChecks-ushieamx/Acceptance.xcresult`,
  exact attempt-2 artifact `10391818355`, with exported diagnostics alongside it.
- Pending-visit failure: `NativeOfflineAccountFixture.make()` returned after trips/profile
  published, before `AccountSession` finished its separate awaited visit/walk construction.
  The test immediately required `nativeVisits` and got nil. The fixture now waits for all
  signed-in native features, within its **unchanged 5s deadline**, and closes on setup
  failure. Shipping account construction remains independent; no production coupling added.
- Account UI failure: the screenshot shows Apple's **Save Password?** sheet blocking the
  form, not a missing Sign out control. At the former 5s check, the exported accessibility
  hierarchy still showed an empty remote SafariViewService. Its logs show a configuration
  request beginning 10:22:24.924 UTC and ending 10:22:56.309. The test now installs a narrowly
  scoped password-saving interruption handler and scrolls the account form rather than the
  entire app (which also includes that sheet). It declines synthetic password saving through
  the owning service. No data, sign-out or one-download assertion was removed.
  This follows [Apple's interruption-monitor guidance](https://developer.apple.com/documentation/xctest/handling-ui-interruptions).
- **The two cloud failures are not claimed fixed.** In the failed run, the profile SDK
  connection to loopback Firestore was established at 10:20:23.249, but its server read
  returned “client is offline”; the saved-pin bootstrap then exceeded 5s. The available
  artifact does not establish why the SDK/server stalled. An unchanged local focused run
  passed **11 unique tests / 12 cases, 0 failures / 0 skips**, including both cloud cases
  (profile 0.24s; saved-pin model about 1s). Evidence:
  `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-w9u9xe8i/Acceptance.xcresult`.
  Neither cloud deadline nor network/data assertion is relaxed, and no retry-to-green added.
- Failed cloud fixtures previously deleted open SQLite databases (confirmed by CI's
  “vnode unlinked while in use” diagnostics). Both now await shutdown on failure before
  removing their own files. Profile stage markers and the emulator's Firestore log are
  retained for further diagnosis; markers contain no credentials or document contents.
- Updated Debug test build passed. The pending/account-switch test passed **20/20 fixed
  repetitions**, 0 failures, in `/tmp/BarkNativeFourFailures.vNruIz/Pending20Exact.xcresult`.
  An earlier selector-only invocation matched zero tests and is **not verification**.
  A newly created iOS 26.5 simulator passed the full account UI flow **1/1**, 0 skips:
  `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-_357lk8p/Acceptance.xcresult`.
  Its password sheet was already ready when addressed; this verifies fresh-device behavior,
  not a locally reproduced 32s Apple-service delay. Hosted confirmation is still required.
- Change size before this report: **5 test/CI files, +176/-119 lines** (net +57, mostly
  safe cleanup scopes and their indentation). **0 shipping app/backend files changed**.
  Full updated local native acceptance is running; log:
  `/tmp/BarkNativeFourFailures.vNruIz/native-full.log`. Do not call this run passed yet.
  Result target: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-2m8tuo99/Acceptance.xcresult`.
  Fix/report pushed as **`f00e156`**; required hosted successor
  [run 34962968565](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34962968565)
  is running. The disposable fresh simulator was removed after acceptance; result bundles
  and diagnostics were retained. No existing simulator or user data was erased.

### Purchase-boundary operation counts

Firestore emulator instrumentation; excludes transaction retries and Apple's external API cost.
No extra purchase calls are added to ordinary saves or free-account foregrounds without unfinished purchases.

| Action | Reads | Writes | Callable calls | Apple status calls |
| --- | ---: | ---: | ---: | ---: |
| First purchase context | 3 | 2 | 1 | 0 |
| Existing context | 3 | 0 | 1 | 0 |
| First accepted purchase (after context) | 9 | 4 | 1 | 1 |
| Replayed verified purchase | 9 | 2 | 1 | 1 |
| Refresh not due | 3 | 0 | 1 | 0 |

One small purchase document per user, token owner row, original-subscription owner rows and
one reusable rate-limit row. Ownership is intentionally not TTL-expired while the account
exists. Account deletion paginates those rows. No permanent row per notification or app open.

## Still required before claiming Phase 6 complete

1. Full local native/app UI, paywall accessibility, StoreKit and signed Release verification
   passed on shipping source `fa4b00f`. The subsequent `a75e957` test-only readiness fix is
   verified on fresh/warm simulators above. Hosted backend passed; require the new full
   Native iOS workflow green after the four-failure follow-up above. `34952712455` failed;
   local tests do not establish hosted CI success, and two cloud failures remain under review.
2. Native deployment, sandbox notification delivery and live Auth/App Check/rejection checks
   are complete. Verify production notification/API access once Apple's release gate opens.
3. Verify genuine Apple sandbox → native backend → app, then retire the temporary owner
   grant. Local StoreKit signatures cannot and must not substitute for this round trip.
4. Final iPhone session: Apple sign-in/relay/reauthentication, purchase/restore/relaunch,
   and explicitly authorized disposable-account deletion/revocation. No owner-account deletion.
5. Owner banking/tax completion and native legal/privacy approval. Bundled legal text is
   still explicitly labeled retained web-service text; it is not a release-ready native policy.
   Streamlined Purchasing is still Apple's default on; no App Store promotional offers are
   configured. Before offering accountless promotional entry points, disable that route or
   implement Apple's signed-in continuation; never weaken account-token ownership checks.

Known tradeoff retained from the approved plan: without polling, an unobserved refund can
remain cached until refresh; an offline device cannot learn a revocation. Sandbox notifications
are not retried by Apple. Production retries plus Restore/near-expiry refresh remain the policy.
