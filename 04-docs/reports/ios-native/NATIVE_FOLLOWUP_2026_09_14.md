# Native follow-up evidence — September 14, 2026

Scope: iOS and isolated native backend only. Starting checkpoint: `427b268`.
Unrelated pre-existing working-tree changes are excluded from every commit.

## 1 — Contract drift and CI

- Reproduction before the fix: the new shared fixture exposed 16 invalid inputs accepted by Swift. These included invalid IDs, oversized place labels, malformed dates/times, colors and visit durations. The JavaScript validator already rejected them.
- Fix: validate these fields in the existing `Trip.validate` boundary before saving an outbound intent. Use one checked-in JSON fixture from both real Swift and JavaScript command constructors, not separate test-only validators. Preserve the server's Gregorian calendar contract, including ISO year 0000.
- CI: replace the retired iOS emulator/config/seed with `firebase.native.json`, `demo-bark-native`, and the native profile, trip and adventure groups. Both workflows react to shared domain/fixture changes. A regression check protects the target selection.
- Checks: domain **47 passed** (one test contains 36 shared examples); backend unit **48 passed**; native backend integration/transport **28 passed**; CI/project isolation **4 passed**; both workflow files parse successfully. App ordinary suite **279 passed, 27 opt-in checks skipped**; those skips are not claimed as cloud-integration passes.
- Runtime size: iOS + domain Swift **25,701 → 25,736 lines (+35)**, **296 → 296 files**. Backend runtime unchanged. This checkpoint corrects validation; it is not presented as a code-reduction refactor.
- Simulator native trip/account acceptance: **94 passed, zero failures/skips**, using the real SDK, isolated emulators and current UI. Includes save, relaunch, pending changes, account isolation and offline-store cases. Evidence: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-1l528t2u/Acceptance.xcresult`. This is not physical-device or production latency acceptance.

## Remaining ordered work

2. Recent-auth account deletion, resumable cleanup and trip-owned note retention/cleanup.
3. Saved-pin cloud synchronization with local browsing and pending/confirmed state.
4. Reduce avoidable save/read work; measure identical actions before/after.
5. Remove repeated queue-wide trip validation from the hot path.
6. Leaderboard measurement at 1K/10K/100K; measurement only, no speculative rewrite.
