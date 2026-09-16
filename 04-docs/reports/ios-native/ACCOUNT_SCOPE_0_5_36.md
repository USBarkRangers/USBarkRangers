AccountSession lifecycle refactor — iOS 0.5.36 (96), September 16, 2026.

The saved-pins startup regression is fixed. AccountScope owns the resources as one value; AccountSession remains the only identity/lifecycle owner. New resources are assembled locally and published together; a typed later-stage failure publishes the healthy completed resources. The outgoing scope clears before suspension, and all old resources finish draining before the next writer opens.

Signed Release build, signature verification, and installation succeeded on the connected iPhone 15 Pro Max. Automatic launch was denied because the device was locked; the owner can open the installed app. The owner requested to perform phone testing. The four manual checks at the end remain **pending owner verification**.

1. **`grep -c "let old" AccountSession.swift`: 9 → 0.**

2. **`grep -c "await old" AccountSession.swift`: 9 → 0.**

3. **`grep -c "generation == generation\|generation == self.generation" AccountSession.swift`: 12 → 1.** The remaining comparison is in `owns(_:)`. `isCurrent(_:)` combines it with cancellation where the old code checked both. The profile scheduler retains its generation-only admission checks and explicit cancellation checks around I/O; the observation loop and its error path still check both. Checks also remain after the outgoing drain, feature start, profile open, and before publishing a completed or failed activation. The helper consolidates comparisons; it does not remove stale-generation protection.

```swift
236:    private func owns(_ generation: UUID) -> Bool { self.generation == generation }
```

4. **`grep -c "foreground && connected && identity?.serverConfirmed == true"`: 4 → 1.** `featureNetworkAllowed` supplies the common feature predicate. The separate profile predicate remains exactly `foreground && connected && identity != nil`.

5. **activate: 152 → 37 lines**, counting its signature and closing brace.

6. **Required lifecycle edit sites inside AccountSession.swift: 8 → 2.** Before: property declaration; outgoing capture; synchronous nil assignment; drain await; opening block; requestSync; waitForSync; updateFeatureNetwork. After: (a) declare the new typed failure stage, and (b) add one opening registration that supplies start, close, sync request, wait, and network operations together. AccountScope carries those operations through the shared loops. A consumer can use the existing typed `session.feature(NewFeature.self)` accessor; a new named convenience property is optional. External feature implementation/cloud configuration is outside both counts. Profile, saved-pins, and guest-writer ordering remains special and explicit.

7. **Drain order: 11 / 11 steps identical.** `previousTask` and the editor checkpoint task are not scope members. Observation cancellation still occurs synchronously before the new scope task is created. The editor callback captures its checkpoint while the outgoing resources are available.

| Original lines 134–144 | Final execution sequence |
|---|---|
| `await previousTask?.value` | `await previousTask?.value` in activate |
| `await oldScheduler?.close()` | `await scheduler?.close()` in AccountScope.close |
| `await oldProfileObservation?.value` | `await observation?.value` |
| `await tripEditingDrain?.value` | `await drain?.value` passed as afterObservation |
| `await oldTrips?.close()` | registered trips close, first accountFeatures entry |
| `await oldVisits?.close()` | registered visits close, second entry |
| `await oldExpeditions?.close()` | registered expeditions close, third entry |
| `await oldLeaderboard?.close()` | registered leaderboard close, fourth entry when configured |
| `await oldSavedPins?.close()` | registered savedPins close |
| `await oldGuestStore?.close()` | `await guestStore?.close()` |
| `await oldProfile?.close()` | registered profile close |

The characterization checks record each real resource close after its await, assert the exact sequence with no duplicates, and cover both authenticated and guest scopes. A held editor checkpoint verifies presentation clears while the outgoing writer stays open and the next writer cannot yet publish.

8. **Existing message strings changed: 0. New message strings: 1.** The request simultaneously called for a saved-pins-specific startup message and unchanged existing strings; no such startup message existed. The owner deferred the implementation choice. All existing messages are preserved verbatim, with this one accurate addition: “Saved pins could not be opened. Your saved files are retained; keep the app installed and retry.” Message selection now reads the failure stage. Underlying DecodingError / NativeStore.Failure.corrupt classification is retained; later feature failures still leave working profile/trip access without marking the whole account corrupt. Guest startup uses its own stage to preserve the old general-storage recovery copy.

Before:

```swift
if self.nativeProfile != nil {
                        self.tripLibraryMessage =
                            self.nativeTrips == nil
                            ? "Trip storage could not be opened. Your saved files are retained; keep the app installed and retry."
                            : "Visit or walk storage could not be opened. Your files are retained; your profile and trips are available."
                        return
                    }
                    self.requiresStorageRecovery =
                        error is DecodingError
                        || (error as? NativeStore.Failure) == .corrupt
                    self.sessionMessage =
                        self.requiresStorageRecovery
                        ? "Your saved account needs a compatible app update or recovery. Keep this app installed; your saved files have not been replaced."
                        : "Your saved account data could not be opened. It has been kept for recovery."
```

After:

```swift
private func reportOpenFailure(_ failure: ScopeOpenFailure) {
        let error = failure.underlying
        diagnostics.accountFailure(error, at: .openStore)
        switch failure.stage {
        case .trips:
            tripLibraryMessage =
                "Trip storage could not be opened. Your saved files are retained; keep the app installed and retry."
        case .profile, .guest, .savedPins:
            requiresStorageRecovery = error is DecodingError || (error as? NativeStore.Failure) == .corrupt
            if failure.stage == .savedPins {
                sessionMessage =
                    "Saved pins could not be opened. Your saved files are retained; keep the app installed and retry."
            } else {
                sessionMessage =
                    requiresStorageRecovery
                    ? "Your saved account needs a compatible app update or recovery. Keep this app installed; your saved files have not been replaced."
                    : "Your saved account data could not be opened. It has been kept for recovery."
            }
        default:
            tripLibraryMessage =
                "Visit or walk storage could not be opened. Your files are retained; your profile and trips are available."
        }
    }
```

9. **Saved-pins regression:** pre-refactor **failed with 4 assertions**; post-refactor **passed**. The old result was a trip-storage message, a still-assigned profile, and an open profile store. The final result is the saved-pins message, no trip error, no published profile/saved-pins feature, and a closed profile store. NativeSavedPinFeature.start currently declares throws but contains no throwing operation; the DEBUG hook injects a failure immediately at its startup boundary without modifying that protected type. The generic opened helper closes the failed pin feature, and openNativeProfile closes the profile writer. Additional passing cases cover corrupt/decoding/unavailable classification, retry, later-stage partial availability, guest rollback, and superseded activation.

10. **Task source diff: exactly 1 runtime file + 1 test file.** This scoped comparison is against the characterization commit. The evidence report is documentation; unrelated pre-existing work is preserved. None of the protected feature/service/composition/assembly files changed.

`git diff --stat b80236f -- 01-code/ios/BarkRanger/Platform/AccountSession.swift 01-code/ios/BarkRangerTests/AccountScopeLifecycleTests.swift`

```text
 .../ios/BarkRanger/Platform/AccountSession.swift   | 577 +++++++++++++--------
 .../AccountScopeLifecycleTests.swift               | 117 +++++
 2 files changed, 476 insertions(+), 218 deletions(-)
```

11. **Characterization commit:** `b80236f443589f59dfb1b34499bf5b6e50476c7c`; **6 methods / 7 cases passed** before the refactor. It includes the tests plus **48 lines of DEBUG-only observation/failure-injection support** in AccountSession, rather than tests alone. This was explained to the owner, who deferred the choice. Removing those DEBUG blocks produces the original Release lifecycle statements exactly; no production behavior was refactored in this commit. The separate saved-pins regression was added afterward and failed against that baseline.

12. **Full pass list: 94 methods / 144 cases, 0 failures, 0 skipped.** All requested suites and every suite backed by NativeOfflineAccountFixture are included. Native Auth, account-feature, and pending-visit integration ran against the isolated demo-bark-native Auth/Firestore/Functions emulators.

| Suite | Passed methods |
|---|---:|
| AccessStabilizationTests | 3 |
| AccountActionTests | 2 |
| AccountDiagnosticsTests | 2 |
| AccountEdgeCaseTests | 4 |
| AccountIsolationTests | 3 |
| AccountScopeLifecycleTests | 11 |
| AppShellTests | 12 |
| AppleAccountPresentationTests | 1 |
| AppleAccountTests | 12 |
| EntitlementTransitionTests | 2 |
| NativeAccountDeletionTests | 6 |
| NativeAccountFeatureEmulatorTests | 2 |
| NativeAuthLifecycleEmulatorTests | 4 |
| PendingVisitMarkerRenderingTests | 1 |
| PendingVisitMarkerTests | 3 |
| PurchaseOfferTests | 6 |
| PurchaseServiceTests | 13 |
| SavedPlaceStoreTests | 5 |
| ScopedSettingsTests | 2 |

`deleteAccount` and `resumeAccountRemoval` are verbatim unchanged. Guest namespacing remains `guest-drafts` / `guest: true`. NativeDraftHandoff.adopt remains immediately before trip feature start within the rollback-protected start closure. Entitlement projection, generation token replacement, and backend contracts remain unchanged. Strict formatting and whitespace checks pass. The signed artifact targets bark-ranger-ios; no backend deployment occurred. Version/build values were supplied as build overrides, preserving the unrelated project-file edits.

Phone checklist for the owner:

1. Switch A → B → A twice. Check name, trips, visits, saved pins, and Premium belong to the current account, with no stale previous-account presentation.
2. Attempt sign-in in Airplane Mode. Check that it handles the offline attempt without hanging, then reconnect and confirm sign-in and sync recover.
3. Force-quit during sign-in, then reopen. Check that the app recovers to the correct account or sign-in screen without mixed account data or an endless spinner.
4. On a disposable test account, request deletion. Check that the queued/completed message appears; reopen and confirm cleanup and subsequent sign-in work.

Raw evidence is retained in output/account-scope: original source, baseline and regression-before results, passing acceptance result/log, suite summaries, message/source audits, signed build log, install/launch receipts, and the signed 0.5.36 app. Phone checks are intentionally not marked passed by the agent.
