Sync rejection recovery and fault isolation, September 19, 2026. Built on `d510132`. No version bump.

Two problems in the native sync path, both the same shape as the account defects fixed the day before: retry paths were sound, but one terminal or unexpected state had no way out and stopped unrelated work. Both are fixed with tests. Nothing here has run on a physical iPhone.

1. A saved-pin operation the server refused blocked every later edit to that pin forever.
2. One server reply the phone could not accept stopped a whole feature pass, and in the visit and saved-pin lanes it blocked unrelated operations on every later pass.

## What was wrong and what changed

**1. A refused saved pin had no exit** (`81526ad`, `e70a320`). Delivery selects only queued or sealed heads, so a rejected head hid every later operation on the same pin. The pin kept showing the refused change as pending, Pending Changes offered no action, and only `premium-required` recovered (on renewal). It survived relaunch and sign-out.

- Pending Changes can discard a refused saved pin together with its never-sent suffix. The server answered and applied nothing, so this is safe. A sealed operation (outcome unknown) and other features' refused work, which have their own review screens, stay protected.
- This is a deliberate exception to "discard only never-sent rows". `premium-required` pins are included by owner decision: expiry never destroys paid work automatically, but an explicit Discard may. The row reads "Premium required · will retry if access returns" and the confirmation says the change could still sync if Premium is restored.
- No automatic self-heal on the next edit. Refused work requires an explicit resolution.

**2. The refusal vocabulary was hand-copied** (`2df3bdc`). Trips, visits and profile each held a literal copy of the mailroom's seven refusal codes, and walks a copy plus their three. They matched, but a code added only to the mailroom would have made those stores throw `corrupt` and resend the operation every pass. They now check `NativeMailroom.rejectionCodes`; walks are a union with it. Saved pins also ask for an access refresh when the server refuses access, as visits and walks already did.

**3. One bad reply ended a whole feature pass** (`5b42c43`). Each trip, visit and walk pass was one straight chain. One trip's bad acknowledgment, or one bad item in the ten-item library page, starved every other trip's uploads, and because a failed refresh is re-armed, it did so on every pass. A refused daily presence signal stayed requested and stopped the visit marker scan each time. A failed completed-trails read stopped the walk activity scan.

- `NativeIndependentSteps` runs the independent steps of a pass. A step that ends in an isolatable remote response failure is skipped alone. The first such failure is thrown at the end, so the pass still fails visibly and no retry is armed for it.
- Cancellation, an account change, local corruption, storage failure, network or service unavailability and unknown errors end the pass at once, as before.
- `NativeFeatureSync` is unchanged.

**4. The boundary between a bad reply and bad local data was not clean** (`5b43627`, `645fd8f`). The rule is now:

- A bad remote response is `invalidReply` and may be isolated.
- Bad local data is a storage or corruption error and ends the pass.

`DecodingError` means damaged local storage elsewhere in the app, and BarkDomain keeps its validation error internal, so the app could not tell a reply that broke its contract from a damaged local row. All 24 places where a freshly decoded reply is checked now report `invalidReply`: 21 through `NativeCallableTransport.validateReply` in the trip, visit, walk, saved-pin and purchase clouds, plus the profile and progress readers, which decode Firestore documents directly. Going the other way, four guards that reported the phone's own request faults as `invalidReply` now throw `NativeCallableTransport.Failure.invalidRequest` (unknown endpoint, body over 400 KB, a visit selection outside 1...500, a leaderboard standing asked for before the top five); the leaderboard's other-account case throws `accountChanged`. Every remaining `invalidReply` checks server-returned content.

**5. A bad reply to one operation blocked unrelated visits and pins** (`5a40563`). The drain rethrew without deferring, so the operation stayed sealed and due and the selector returned it first on every pass, with no backoff.

- Lanes that pass `isolatingRemoteResponseFailures` (visits and saved pins, whose selectors already skip a deferred operation without blocking unrelated entities) defer that one operation with the existing backoff and go on.
- Its outcome is unknown, so it stays sealed with the same bytes and is never marked rejected. That keeps the rule from item 1: rejected means the server applied nothing.
- A lane-wide stop (access refused, service unreachable) is reported as before and wins over the isolated failure. Otherwise the first such failure is thrown once the lane has nothing more to send.
- Trip and profile chains and the one-uncertain-walk rule do not opt in and behave exactly as before.

## The rules to keep

- `NativeMailroom.isIsolatableRemoteResponseFailure` is true only when the remote request completed enough to give a definitive bad response for one independent operation or read, and continuing unrelated work cannot cause incorrect state to be accepted. It lists `invalidReply` (transport and profile cloud), the store's `invalidAcknowledgment` and `staleRead`, and any server failure other than `unavailable` and `rate-limited`. Never add network errors, cancellation, account changes, local corruption, storage failures or `DecodingError`.
- `validateReply` is only for a value that just arrived from the server. Request input and local rows keep their own errors.
- A new lane passes `isolatingRemoteResponseFailures` only if its selector already skips a deferred operation without blocking unrelated entities.

## Known consequences

- A failure-deferred operation looks like a lost reply to the lane's retry calculation. After a later clean pass, a timer is armed and the operation is retried at most about every five minutes while the app is foregrounded. Before this work it was resent on every pass with no backoff and blocked the lane. The queue row has no field to tell the two apart; avoiding the timer needs one.
- The "could not finish syncing" banner shows on passes where the bad operation is attempted, not on passes where it is still backing off.
- A walk whose reply cannot be accepted still has no backoff. That follows from the one-uncertain-walk rule, which was left alone.

## Verification

- Unit: 396 tests in 90 suites at `5a40563`, excluding `StoreKitClientTests` (hangs from the command line). 15 failures, all in six suites that need the local catalog fixture server on 127.0.0.1:8787, which was not running. Nothing in trips, visits, walks, pins, pending changes, leaderboard, the mailroom or the scheduler failed.
- New tests prove: the refused-pin block and its discard exit (fails against the old store files, passes with the change); the shared refusal set; the classifier table, including that no isolatable error is transient; later steps still run and the first failure is rethrown; every other error ends the pass; cancellation wins; the scheduler reports the failure once and does not rerun; wrong shape and broken contract both become `invalidReply`; a damaged local row never does; the phone's own request faults are never isolatable; a malformed change page leaves the trip cursor and library untouched; the drain defers only the failing pin, keeps its bytes, reports lane-wide stops as before, throws local faults at once, and leaves non-opted lanes unchanged.
- Emulator (`demo-bark-native`): backend transport test and seed pass. 54 SDK-level suites from the profile, trips and adventures checkpoints: 194 tests, 193 pass, none skipped. The one failure is `PassportConsistencyTests`, which needs the catalog fixture server. This run includes the real trip feature pass and the full saved-pin model against a live backend.
- Seven emulator tests failed on the first run. An A/B run against a clean worktree of `e70a320` (before any of the sync changes) failed the same seven at the same lines, so they predated this work. Both causes were races in the test fixtures, not app defects:
  - `AccountModel` ignores every action while the session is still checking device cleanup, exactly as the disabled buttons do. `NativeTripFeatureEmulatorTests` and `NativeSavedPinEmulatorTests` created their account before that finished, so no account ever existed. They now wait for `cleanupState == .ready`, as `NativeAccountFeatureEmulatorTests` already did.
  - The saved-pin test signed in again after its second sign-out before the listener had cleared the identity; email sign-in is ignored while an identity is present. It now waits, as its first sign-out already did.
- Not run: the four UI suites (`NativeAccountUITests`, `TripNavigationUITests`, `SavedPlacesUITests`, `NativeAdventureUITests`), the catalog-server suites, and anything on a physical device.

## Running the emulator suites

1. `xcodebuild build-for-testing -project BarkRanger.xcodeproj -scheme BarkRanger -destination 'platform=iOS Simulator,id=<booted>' -derivedDataPath <dir>`. The plain `test` action leaves no `.xctestrun`.
2. `node_modules/.bin/firebase emulators:exec --config firebase.native.json --project demo-bark-native <script>`, where the script runs, in order: `npm --prefix 01-code/functions-native run test:transport`, `node 05-tools/scripts/seed-native-profile-ui.cjs`, then `python3 05-tools/scripts/test-ios-accounts.py --native-profile --native-trips --native-adventures --products <dir>/Build/Products --destination '<same>'`.
3. To skip the UI suites, repeat `--only-testing BarkRangerTests/<Suite>` for each suite the runner lists. `NativeCloudAcceptanceTests` belongs to the live-cloud branch and makes the runner refuse its arguments.

## Left for later

- `NATIVE_DATA_ARCHITECTURE_RULES.md` (not yet committed) still says discard is never-sent only (its Discard paragraph and maintenance rule 9) and does not describe the `invalidReply` / `invalidRequest` boundary, the classifier, `NativeIndependentSteps` or the opt-in drain flag.
- The server answers `invalid` both for a phone clock more than five minutes ahead and for a malformed payload. The first would succeed later with the same bytes; the client cannot tell them apart.
- `Diagnostics.accountReason` files `invalidReply` and `invalidRequest` under `unknown`. Left for the telemetry chunk.
- `BarkDomain/MutationRejection.swift` is unused and speaks the retired backend's vocabulary; `ARCHITECTURE.md` still lists it.
