Account deletion and sign-up hardening, September 18, 2026. Built on `6671d39`. No version bump.

Six defects in account code, each a single fault that left a user stuck with no way out. All six are fixed with tests. Nothing here has run on a physical iPhone; the device items at the end are still open.

## What was wrong and what changed

**1. Failed deletion cleanup blocked every sign-in.** If cleanup of a deleted account threw at launch, `AccountSession.start()` returned before subscribing to auth changes. Sign-in forms were disabled, the guest scope never opened, and one undecodable marker in `removals-v1` made that permanent.

- A failed cleanup is now a warning with **Retry device cleanup**. Auth and the guest scope always start.
- Only the deleted owner is fenced. `AccountSession.admitted` checks the marker's hashed filename, which holds even when the file's contents cannot be decoded, signs that owner out and never opens its stores.
- `resumeAccountRemoval` completes each request on its own. One owner's failure no longer strands another's.
- `NativeAccountRemovalFiles.pending` renames a marker it cannot trust to `.json.unreadable` and reports it once. It no longer throws.

**2. Apple deletion could stop between revoke and delete.** Revocation ran in the account screen's cancellable task. Leaving the screen at the wrong moment left a revoked, living account.

- `AccountSession.deleteAccount(appleAuthorizationCode:)` runs revoke and then delete inside the session's owned task. Dismissing a form cannot cancel it.
- The order stays revoke first. A revoked account that survives signs in with Apple again and retries. A deleted account can never revoke, and its authorization code is single-use.
- Consequence: if Apple revocation fails, an Apple-linked account cannot be deleted. The Apple key in the Firebase Auth provider configuration is therefore a launch requirement.

**3. A lost deletion reply left the account's files on the phone.** The cleanup marker was written after the server call, so a crash or lost reply in between meant nothing on the device knew to clean up.

- There is no write-ahead journal. A `requested` marker was considered and dropped: settling it means asking the server, and the server's two answers are each sufficient alone.
- One owned path, `AccountSession.removal(of:)`, now serves three triggers: the delete button, a server-confirmed profile with status `deleting`, and `AccountIdentity.removedByServer`.
- `AccountService` publishes `removedByServer` on `userNotFound` instead of signing out itself, so the session removes the local copy together with the sign-out.
- This also covers a deletion started on another device.

**4. One account feature failing to open stopped all later ones.** Trips open first, and opening trips included adopting guest drafts. An unreadable guest-drafts store therefore took out trips, visits, walks and the leaderboard for every account on the phone.

- `openScope` reports an account feature's failure and keeps opening the rest. Guest scope behaviour is unchanged.
- `adoptGuestDrafts` isolates the handoff. Drafts it cannot deliver stay claimed in the guest store for the next open, and the user is told they are kept on the iPhone.
- The trips message wins over the visit/walk message when both fail.

**5. A refused first profile command was a permanent dead end.** The server answers `invalid` when the phone clock runs more than five minutes ahead. The bootstrap row went to `rejected`, was never sent again, was never re-staged because one command was pending, could not be resolved because no confirmed profile existed, and could not be discarded because it had been sent. It survived relaunch.

- `NativeStore.stageBootstrap(replacingRefused:)` replaces a refused bootstrap on a forced refresh only: a new scope, **Sync now**, or the scheduler's existing five-minute cadence. A persistent refusal cannot become a send loop.
- It acts only when no profile row exists and every queued command is a bootstrap, so it cannot delete user edits.
- `ProfileView.conflict` is false when no confirmed profile exists. The review panel, whose buttons could do nothing in that state, no longer appears.
- `AccountSession.message` explains why the account looks empty and points at the date and time setting.

**6. A blocked sign-out showed a generic error.** When unsaved trip edits block an identity change, `ActiveTripSession` threw a private `LocalizedError` that `AccountModel.message` could not see.

- `IdentityChangeBlocked(reason:)` is now part of the `prepareTripIdentityChange` contract. The owner of the unsaved work words the reason and account forms show it as written.
- `AccountModel.message` still never surfaces arbitrary error descriptions.

One small presentation fix rides along: the "Account deletion requested" notice clears on the next real sign-in. It does not clear when the listener restores a remembered account, and a failed cleanup keeps its warning and retry.

## Rules this adds

- Every non-retryable outcome needs an exit. All six defects were a careful retry path next to a terminal state with none.
- `NativeProfile.MapStyle` and `NativeProfile.Status` are decoded as closed enums, and the profile and entitlement are read in the same call. Adding a map style or an account status on the server breaks profile and entitlement refresh on every older app version. Loosen the decode in a shipped release first.
- Storage ownership decides deletion. Account data kept in the account's `NativeStore`, or under the account's hashed folder that `NativeAccountRemovalFiles.eraseClosedAccount` removes, is erased with no hook, at launch, before any feature object exists. Put new account data there and there is nothing to forget. The `eraseAdditionalAccountData` closure in `AppComposition` is only for what cannot live there: in-memory buffers, shared caches such as the route cache, and stores with their own root such as saved places. `AppShellTests` asserts the composition installs it. On the server, data under `users/{uid}` is deleted automatically; anything outside it must be added to the list in `functions-native/accounts/deletion.js`.
- Account switching and account deletion stay separate mechanisms: `resetAccountScope` clears temporary screen state, the erase path permanently removes data. No shared protocol.
- Checked September 18: nothing account-owned is missed by deletion today. `UserDefaults` holds no uid-keyed data, and exports, imported photos and feedback attachments are random-named temp files removed after use.

## Follow-up the same night: one owner for account switching

`RootView` had two account-change hooks that reset different models, with no rule for which hook a reset belonged in, and no test could reach either. Deletion cleanup is a separate mechanism and is unchanged.

- `AppComposition` defines one `resetAccountScope` closure, next to where it constructs the models, and passes it to `AppLifecycle` at init. It holds the same six calls `RootView` used to make. A new account feature adds its line there. `AppLifecycle` never learns a model's name, and no feature model changed.
- A first version used an `AccountScoped` protocol with conformances and two wrappers. It was replaced the same night: it touched ten files for the same one-line cost per feature, and Swift cannot list conformers, so it caught nothing the closure does not.
- `AppLifecycle.accountChanged(_:)` runs the closure on a real change only. The first observed value is a baseline, which matches the old `.onChange` behaviour and keeps a trip restored at launch from being cancelled. It then activates purchases and the recorder for the current account, including at launch, as before.
- `RootView` keeps one trigger, `.task(id: uid)`. The scene-phase hooks stay in `RootView`: they are not account state and do not grow with features.
- Behaviour kept exactly: the block still calls `routeDay.stop()`, not the route-day sheet's fuller `resetScope()`. Whether that difference is intended is an open question, now visible in one place.

Verified: 377 unit tests run with the same environment failures as before and no new ones, two new tests for the baseline and change rules, and all six `AppShellUITests` against the real app. Not verified: signing in, switching and signing out through the UI, which needs the emulators or a device.

## Known limits, accepted

- An account signed out before either server answer arrives keeps its folder. No local record can prove the deletion, and nothing can ask the server on behalf of a signed-out account.
- A marker set aside as unreadable has an unknown owner, so that owner's folder stays unless the owner later appears as `removedByServer`.
- **Retry device cleanup** while a different account is recording a walk interrupts that walk. The recording recovers. Cleanup at launch runs before any account opens and does not have this problem.
- Disconnecting Apple in Sign-in & Security does not revoke Apple's authorization.

## Verification

Simulator only, iPhone 17 Pro, iOS 26.5, Debug.

- 58 tests in 9 suites pass: `AccountScopeLifecycleTests`, `AccountIsolationTests`, `AccountEdgeCaseTests`, `AppleAccountTests`, `NativeAccountDeletionTests`, `NativeMailroomTests`, `NativeStoreTests`, `NativeTripIdentityTests`, `ActiveTripSessionTests`.
- New tests: cancel during Apple revocation; lost reply settled by each server answer; unreadable marker beside a healthy one with an unrelated sign-in; unreadable guest drafts; refused bootstrap replaced on a forced refresh; refused setup explained to the user; deletion notice cleared on the next sign-in.
- Rewritten to the new contract: failed cleanup fences only its owner; a misnamed marker is set aside; one failed feature leaves the others open; trip start failure leaves visits, walks and standings open.
- `NativeTripIdentityTests.failedCheckpointBlocksSignOut…` was failing at `6671d39` and now passes.
- The refused-bootstrap dead end was first proven with a throwaway test that was not kept.

Not verified:

- The call to `stageBootstrap` in `NativeProfileSync.refreshIfNeeded` is reached only by the emulator-gated tests, which were not run.
- The full unit target was not rerun after the last changes. An earlier full run had failures unrelated to accounts: catalog and discovery suites need the local catalog server, and `StoreKitClientTests` hangs from the command line.

Pending owner verification on a physical iPhone:

1. App Attest against production.
2. Sign in with Apple, then delete: revocation succeeds and the account is removed.
3. Email account deletion with a fresh password confirmation.
4. Delete on one device, open the app on a second signed-in device: the second device signs out and removes its copy.
