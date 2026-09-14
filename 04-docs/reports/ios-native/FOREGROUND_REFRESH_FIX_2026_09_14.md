# Native foreground and walk-history refresh fixes

Date: September 14, 2026. Scope: findings 1 and 2 from the hidden-cost review.

## Outcome

Implemented and verified locally. No backend contract, Firestore schema, rules, indexes, Firebase configuration, production account, web application or web database was changed. No deployment, GitHub push or physical-iPhone installation was performed in this task.

The original implementation reproduced both reported problems. Across three quiet foreground returns it made 18 native callable requests: three each of `library`, `tripChanges`, `progress`, `placeProgressChanges`, `expedition` and `completedTrails`. A separate reproduction fetched `activityChanges` after walk history had closed.

With the changes, the same three-return scenario makes **zero native callable requests and zero additional profile-document requests**. Closed walk history no longer continues querying its change feed, including when the account's explicit summary refresh runs. This is request-count evidence against local Firebase using the real native SDK adapters and backend handlers, not a production billing measurement or a claim that all app networking is free.

## Changes and ownership

- `NativeRefreshCadence` is a small account-lifetime value policy. Successful reads are reusable for five minutes. Failure does not advance freshness; a backwards clock change requires revalidation. It is neither a background timer nor a replacement for exact cache revisions.
- The existing visits/walks scheduler uses that policy but always enters its worker to drain pending saves. A queue wake, reconnect or foreground return does not bypass the outbox because a summary is fresh.
- Trips use the same policy in their existing owner. Pagination continuations, exact deletion evidence, dirty drafts and command confirmation are retained. A failed trip refresh now retains the refresh request and respects transient-error backoff rather than accidentally dropping the request.
- Profile synchronization reuses a recently accepted profile/access read. Initial account opening, explicit refresh and post-command confirmation still read the server. The server remains authoritative for paid access and writes; the existing entitlement-expiry publisher is unchanged.
- Returning to the foreground, reconnecting or changing tabs can revalidate expired summaries. There is no new continuously running polling loop. A fresh account lifetime does not inherit another account's freshness timestamps.
- Walk-history cursor storage no longer implies ongoing read demand. The screen holds a short-lived token while observing history. Closing it stops subsequent pages; opening it again reconciles changes, including remote deletion. A cancelled old view cannot remove a newer view's demand.
- Completed trails load when history or sharing requests them, after a local completion claim, or on explicit account refresh. Repeated requests reuse accepted data for five minutes. An unknown completion count is not exported as a fabricated zero.
- Access failures from visit/walk commands request profile/access revalidation only, instead of forcing every feature to refresh.
- A Debug-only integer counts profile-document requests for verification. It records no account identifiers, document contents, notes or coordinates and is excluded from Release.

The implementation keeps existing feature owners, durable outboxes and conflict handling. It does not introduce a new backend service, global data blob, listener framework or additional account-wide coordinator.

## Behavioral boundary

| Situation | Behavior after this change |
| --- | --- |
| Quiet foreground/reconnect within five minutes | Reuse successful summary reads; inspect/drain local queues |
| First account opening or expired summary | Revalidate summaries on the next refresh trigger |
| Explicit Account → Sync now | Force summary/profile/completion reads; do not load closed history |
| New local save while summaries are fresh | Submit the durable command and retain its authoritative confirmation |
| Open walk history | Load its requested page and reconcile any retained change cursor |
| Close walk history | Stop issuing subsequent history pages; an already-issued response may complete |
| Local expedition completion | Refresh the completed-trail list even inside the freshness window |
| New account scope | New freshness state and existing identity-isolated stores/workers |

Cross-device summaries can remain cached inside the five-minute window. Revalidation happens on the next trigger, not automatically at the five-minute boundary. Someone leaving the app continuously on the same screen without another trigger will not receive continuous live updates. Explicit Sync now bypasses the window. Commands still use exact revisions and server-side authorization; this change does not silently resolve conflicts or certify a local preimage as server state.

## Verification evidence

Platform: iPhone 17 Pro simulator, iOS 26.5; dedicated loopback Firebase emulators for `demo-bark-native`, synthetic accounts only.

1. Added two regression checks before changing runtime code and built the original app. Both failed for the intended reason, rather than a setup error. The foreground failure captured the exact 18-call list; the closed-history failure captured `activityChanges`.
2. After implementation, the visits/walks/cost/recovery selection passed 15 test methods, with no failures or skips.
3. Native account/profile/worker checks passed 8 methods, including offline edits, lost replies and reviewed conflicts, with no failures or skips.
4. Trip feature, reconciliation, identity and cost checks passed 18 methods (19 parameterized executions), with no failures or skips. These cover remote note changes, exact detail invalidation, retained drafts and identity boundaries.
5. Freshness/cancellation checks passed 4 methods (5 executions): expiry, backwards clock changes, always-running queue work, force refresh, failed refresh, paused work, cancellation during a read and a force request arriving during another read.
6. Final request-cost rerun passed all 6 methods. It independently checks no additional profile-document requests, explicit refresh bypass, lazy completed trails, warm completion reuse, overlapping history-view demand and remote deletion on history reopening.
7. Final simulator build-for-testing succeeded. Formatting checks for the new policy/scheduler/feature/tests and `git diff --check` passed. The final tiny scheduler cleanup removed only a redundant assignment; the cost suite and cancellation suite were rerun afterward.

Evidence available on this Mac (temporary result bundles may later be cleaned by the OS):

- Before-change failures: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-jjz0t3zy/Acceptance.xcresult`
- Visits/walks/cost/recovery: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-9mzh94fo/Acceptance.xcresult`
- Profile/account: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-qxhw5q14/Acceptance.xcresult`
- Trips: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-019camrk/Acceptance.xcresult`
- Freshness/cancellation: `/tmp/BarkStableAnchor/Logs/Test/Test-BarkRanger-2026.09.14_02-40-38--0400.xcresult`
- Final cost rerun: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-gpjnzbtu/Acceptance.xcresult`
- Build logs: `/tmp/bark-refresh-before-build.log`, `/tmp/bark-refresh-final-build.log`

## Remaining work, in priority order

1. **Physical-device acceptance and source checkpoint:** these changes are not installed on the owner's iPhone or pushed to GitHub yet. Confirm foreground/background, offline edit/reconnect and visible-history navigation on the phone. A real-backend request/billing sample should follow; emulator counts do not establish a whole-user monthly bill.
2. **Note confirmation:** an existing stop-note save still confirms the full trip and its note documents. First notes, day notes and structural changes still use full-trip saves. Any narrower confirmation must preserve cross-device conflicts and untouched-note correctness. Not changed in this task.
3. **Large trip archive recovery:** absent/expired change cursors still scan the archive's metadata in bounded pages. Normal warm refresh is incremental; the total recovery cost still grows with account history. Not changed.
4. **Public-release security:** finish and verify release App Check integration and service-level enforcement for Authentication/direct Firestore access. Make the Identity Platform security/cost decision explicitly; do not remove protections merely to reduce reads. No configuration changed here.
5. **Retention and operational housekeeping:** define detached journal-note/account-deletion lifecycles and conservative deployment-image cleanup. Preserve reward anti-replay evidence and legitimate journal ownership. No data deleted here.
6. **Remaining bounded overview work:** first/expired summary refreshes still visit multiple feature endpoints, and progress can be read through more than one feature. This fix suppresses unnecessary repetition; it does not claim every cold refresh is minimal. Only consider combining these reads if measured benefit warrants the added coupling.
7. **Future photos and 100K-user readiness:** lazy images, bounded uploads, thumbnails, storage lifecycle and real load/capacity measurements remain future work. No photo feature, scale certification or cloud-spending guarantee is implied.

Leaderboard presentation, note-save semantics, paid-access enforcement, GPS recording and the old web application are unchanged.
