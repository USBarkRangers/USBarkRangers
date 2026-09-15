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
  Complete shell regression is still running; its earlier binary reproduced the layout
  failure above, so the final commit must rerun the full suite in GitHub.
- Development-signed Release build and strict code signature verification passed with the
  correct team, Apple sign-in and production App Attest entitlement. This is not an App Store
  distribution archive. Final UI changes also rebuilt and passed strict signature verification:
  `/tmp/BarkPhase6Release/Build/Products/Release-iphoneos/BarkRanger.app`,
  build log `/tmp/bark-phase6-release-final-build.log`.
- Existing visit-cost test used wall-clock time; running before 04:00 UTC legitimately
  awarded a night badge (+1 write). Its baseline now uses yesterday at noon UTC, injected
  into both command and executor. **All existing exact cost assertions are unchanged.**

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

1. Finish full native/UI regression, paywall accessibility and Release build; push and require
   the final commit's GitHub jobs green. Local tests do not establish hosted CI success.
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
