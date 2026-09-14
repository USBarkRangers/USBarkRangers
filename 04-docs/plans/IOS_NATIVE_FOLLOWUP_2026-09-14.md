# Native follow-up checkpoints

Owner authorized September 14, 2026. Start: `427b268`. iOS and `bark-ranger-ios` only; unrelated working-tree changes remain untouched.

1. Reproduce and correct contract drift; shared Swift/JavaScript fixtures and native-target CI. Verify and push.
2. Implement recent-auth, resumable account deletion and explicit trip-owned note cleanup. Never delete owner/beta accounts during verification. Verify disposable native accounts and push.
3. Synchronize account-owned saved pins while retaining offline/local browsing and pending/confirmed appearance. Preserve authored local data; no journal/media feature. Verify and push.
4. Remove mandatory post-save full downloads where canonical deltas suffice; direct small owner reads; retain authoritative access and duplicate protection. Compare the same action costs, verify and push.
5. Remove repeated full trip-queue validation from delivery's hot path. Preserve exact sealed requests, order and atomic acknowledgment. Verify and push.
6. Measure leaderboard behavior at 1K, 10K and 100K synthetic entries, without changing its algorithm. Begin locally; any cloud measurement must stay in the native project and the existing $10 development envelope, without mixing synthetic entries into the real leaderboard.

Each checkpoint gets a scoped commit, verified GitHub push and short evidence report. Stop for an unresolved verification failure, missing authority or significant product decision. No blanket custom-claims migration, receipt removal, old-web work or unrelated feature implementation.

## Follow-up decisions — September 14

- Close the two failing iOS CI checks without relaxing the one-download contract; obtain a green complete GitHub run before installing the new iPhone build. Revert only the uncommitted native-file triggers in the legacy backend workflow; the isolated native replacement already covers them.
- **Custom claims are not implemented, by owner decision.** Replacing account-active/Premium document checks could save **1–2 reads on ordinary accepted saves**. This is potential additional saving, not part of the measured checkpoint-4 reductions. Keep authoritative document checks for now; Apple verification will update the existing entitlement, not introduce a claims migration.
- **Before journal implementation:** separate NativeStore responsibilities, starting from **4,521 lines across 47 files**. Extract pure validation/mapping and feature reconciliation policies from persistence orchestration; retain **one atomic storage writer and one shared mailroom**. Merely moving extensions into more files does not satisfy this item. Preserve account isolation, sealed retries and atomic acknowledgments; report responsibility and line-count changes. Do not turn this into a prerequisite rewrite for Apple subscriptions.
- Next feature: [updated Phase 6 — Apple-only subscriptions and sign-in](ios-native-2026-09-09/prompts/PHASE_6_PURCHASES_INTEGRATION.md). The owner reports paid Apple enrollment approved; provider, product and signing configuration still require verification.
