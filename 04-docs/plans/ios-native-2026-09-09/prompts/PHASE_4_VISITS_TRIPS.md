# Prompt 4 — Visits, trips, passport and leaderboard

## Activation and objective

On an explicit **“start phase 4,”** read [the shared execution contract](../IMPLEMENTATION_PHASES.md), phase 3's accepted behavior/report, [Swift ownership](../SWIFT_FILE_MAP.md) and [backend ownership](../BACKEND_FILE_MAP.md). Fix open blocking account/sync defects first. Implement this phase only.

Deliver the daily Bark workflow: manual/GPS visits, reliable saved itineraries, route previews/handoff, passport progress, achievements and leaderboard. Reuse phase 3's durable storage and access decisions rather than adding a separate save/sync service for each feature.

## Source contracts to preserve

Inspect `checkinService.v141.js`, `visitMutationCoordinator.v141.js`, `tripPlannerCore.js`, `tripRoutePlan.js`, `gamificationLogic.js`, `barkConfig.js`, relevant map/route/export callers, functions/rules and existing regression fixtures. Preserve:

- Five free official visit slots under the existing account/access rules; manual/proximity evidence and original dates; permitted removals and upgrade behavior.
- Distinct physical-site scoring, one point for a manual site and two for proximity under current rules; never double-count multiple catalog records for the same site. The current 25 km proximity radius is a broad client observation, not server proof of visiting a gate.
- Trip IDs, up to 50 days, custom stops, notes up to 1,000 characters, day colors/order, start/end bookends, previous-day continuity, empty-day boundaries and adjacent duplicate handling.
- Current entitlement gates for planning/saving/optimization/search, removal rights after expiry, achievement IDs/tiers/earliest earned dates and historical score adjustments. Reconcile unclear guest behavior from source before changing it.

## File ownership

| Files | Operations for this phase |
|---|---|
| D12–D15; extend D03/D04/D06/D18 | Visit/access/proximity/merge rules, deterministic route plan, estimated optimizer and achievement/streak policy. Add concrete visit/trip/achievement operations to the existing envelope. |
| U04–U05; extend U07/U01–U02/U10–U12 | Visit and trip repositories; draft persistence and account saves; profile achievement/streak recording; new entities/operation cases in the same store and sync engine. |
| P06, P12, P14; extend P08/P13 | Paged leaderboard/rank reads; paid MapKit town/custom-place search; active-day route previews; one-shot check-in fix; multistop Apple Maps/optional Google handoff. |
| T01–T08 | Trip list/editor/day editor/stop picker, saved trips, route preview state and feature models. |
| V01–V06 | Passport, visit history/date/removal controls, achievement grid, leaderboard and their models. |
| M02/M05–M10/M12, RootView/router | Connect real visit/trip ID projections, annotation states, detail actions, personal filters and routes without duplicating data ownership. |

Add achievement definitions and trip/scoring fixtures with source provenance. Sharing/export entry points introduced in these screens should be clearly unavailable or omitted until phase 5; do not invent successful exports or instantiate future ExportModel/ShareCardView classes.

Backend: implement B09 visit and B10 trip handlers, extend B12 earned-achievement/streak operations and B25 scoring/projection. Reuse B07/B08's receipt/transaction pattern. Compute/validate score and earned outcomes against accepted data; a client-provided score or arbitrary badge list is not authoritative. Preserve existing `syncLeaderboardScore`, current collection formats and all old endpoints. No deployment/rule enforcement change against production.

## Implementation sequence and calls

1. Port pure policies against shared fixtures first. Keep `TripRoutePlan.build` independent of MapKit, UI and storage; it emits ordered segment IDs. Optimizer returns a proposed reordered trip with labeled estimated travel assumptions, never silently changes a saved route.
2. `ParkDetailModel → VisitRepository → VisitPolicy/LocalStore` stages a manual/date/remove/proximity operation atomically. A GPS quality/range result is separate from local/server save state. Same-site evidence upgrades preserve history and do not add a second slot or duplicate points.
3. `SyncEngine → applyUserMutation → visitMutations` applies exact touched-ID intent against current server state. Enforce cap and protected fields server-side too. Remove-selected is selected IDs, not replacing the whole visit list. Delayed web/native edits cannot resurrect an accepted deletion or erase unrelated additions silently.
4. `TripEditorModel → TripRepository` saves drafts per logical edit; account saves have stable IDs and conflict protection. Native lists render stable IDs rather than array positions. Editing notes/reordering/days/custom places survives termination and failed sync. A conflict keeps a recoverable local version and the server version with clear resolution choices.
5. `TripRoutePlan → RoutePreviewService → RoutePreviewModel` requests only selected/active-day legs with serial or low concurrency. Reuse unchanged segment results, cancel obsolete generations, respect throttling and show partial/unavailable legs honestly. Never fan out an entire 50-day itinerary automatically or display straight-line geometry as successful road routing.
6. `MapsHandoff.openDay` consumes the same route-plan order. Use current documented Apple URL capabilities and supported continuation groups when needed; preserve optional Google export behavior. Safe URL encoding, app launch failure and return to Bark are explicit results.
7. `PassportModel → AchievementPolicy` derives one summary from local visits/catalog/profile plus bounded rank input. Stage only changed earned records, keeping earliest dates/stronger tier. Backend writes changed leaderboard projection with accepted mutations; the UI reads pages/rank and does not repeatedly upload calculated totals. Rank-related badges cannot trigger refresh/write loops.
8. Connect all discovery visited/in-trip filters and markers to repository snapshots. Filter counts remain matching catalog records; passport progress remains distinct sites. Catalog updates must preserve trip stop identity and unresolved/retired visit history.

## AI verification

Run VisitPolicy, TripRoutePlan, TripOptimizer, AchievementPolicy, VisitRepository, TripRepository, MapsHandoff and RoutePreview tests plus relevant map/sync regressions. Add emulator contention tests with simulated current web writes and native operations. Share score/identity/entitlement fixtures across Swift and JavaScript.

Required cases: fifth/sixth visit, remove at cap, evidence upgrade, boundary/bad location, offline save/restart/receipt loss; empty/start-only/end-only/multiday/bookended trips; 50 days, long notes, custom stops and all stops preserved exactly once by optimization; duplicate submission/deletion/conflict; expiry while a local save is pending; canceled/throttled/partial routing; historical badge/date/streak and physical-site score parity. Test backend field validation and transaction read-before-write constraints, not only mocked dispatcher calls.

Use UI tests for account-and-visits, trip planner, passport/leaderboard and existing discovery behavior. Add focused assertions to the existing mapped suites if a new file would only mirror implementation. Measure route requests and sync writes for representative operations; no unnecessary re-fetching on tab changes. Inspect large text, non-color marker state, VoiceOver reorder actions and small-phone layout.

## User testing checklist

| User action | Expected result |
|---|---|
| Add/edit/remove visits offline, restart, then reconnect. | Intent survives and syncs once; pending/evidence states are distinct. |
| Reach the free limit and try one more visit; remove one and try again. | Client/server policy agrees, with clear explanation and preserved history. |
| Upgrade a manual visit using a suitable test/device location. | Stronger evidence appears without duplicate history/site credit. |
| Filter visited/unvisited/in-trip parks and inspect passport. | Pins/counts match the respective definitions; passport deduplicates physical sites. |
| Build a multiday trip with bookends/custom stops/notes, reorder and restart offline. | Draft identity, ordering and notes persist. |
| Save/reload, provoke a two-client conflict, then resolve it. | Neither version disappears silently. |
| Preview a day, simulate routing failure, open directions and return. | Valid itinerary remains; unavailable legs are labeled; handoff order matches the plan. |
| Earn an achievement, revisit screens and refresh leaderboard. | Score/date/tier remain correct; no duplicate award or refresh loop. |

## Completion and stop

Deliver phase 4's report with feature parity fixtures, saved-state/route evidence, current source counts and a practical test sequence using synthetic accounts. List phase-5 sharing/expedition actions still pending without describing them as shipped. Fix the user's visit/trip/passport findings in this phase. **Do not start phase 5 automatically.**
