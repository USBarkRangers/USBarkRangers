# Native follow-up checkpoints

Owner authorized September 14, 2026. Start: `427b268`. iOS and `bark-ranger-ios` only; unrelated working-tree changes remain untouched.

1. Reproduce and correct contract drift; shared Swift/JavaScript fixtures and native-target CI. Verify and push.
2. Implement recent-auth, resumable account deletion and explicit trip-owned note cleanup. Never delete owner/beta accounts during verification. Verify disposable native accounts and push.
3. Synchronize account-owned saved pins while retaining offline/local browsing and pending/confirmed appearance. Preserve authored local data; no journal/media feature. Verify and push.
4. Remove mandatory post-save full downloads where canonical deltas suffice; direct small owner reads; retain authoritative access and duplicate protection. Compare the same action costs, verify and push.
5. Remove repeated full trip-queue validation from delivery's hot path. Preserve exact sealed requests, order and atomic acknowledgment. Verify and push.
6. Measure leaderboard behavior at 1K, 10K and 100K synthetic entries, without changing its algorithm. Begin locally; any cloud measurement must stay in the native project and the existing $10 development envelope, without mixing synthetic entries into the real leaderboard.

Each checkpoint gets a scoped commit, verified GitHub push and short evidence report. Stop for an unresolved verification failure, missing authority or significant product decision. No blanket custom-claims migration, receipt removal, old-web work or unrelated feature implementation.
