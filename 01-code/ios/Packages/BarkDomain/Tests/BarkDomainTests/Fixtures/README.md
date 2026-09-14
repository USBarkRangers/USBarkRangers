# Phase 4 compatibility fixtures

`phase4-contracts.json` is shared by Swift's AdventurePolicyTests and JavaScript's native-adventures.test.js. These are synthetic places, not invented catalog records or production users.

The expected route order comes from `01-code/app/engines/tripRoutePlan.js`: first/last populated days, continuity across empty days, bookends-only routing, and adjacent coordinate deduplication. JavaScript tests execute that original implementation against the same fixtures used by Swift.

Score cases preserve `calculateServerLeaderboardScore` in `01-code/functions/index.js`: distinct normalized name + coordinates, strongest evidence per site, one manual/two proximity points, and rounded-then-floored historical walk points.

Runtime achievement definitions are copied from the existing IDs/rules in `01-code/app/gamificationLogic.js`, including all 50 state badges. The Swift and backend resource copies must compare equal. Historical earned dates and stronger tiers survive, even if current criteria no longer match. Proximity remains the existing broad 25 km client observation; it is not certified gate attendance.

Native `nativeDayID`/`nativeStopID` fields identify editable rows. Older trips receive deterministic local identifiers derived from their original trip/day/stop position; their unknown fields survive their first native save. No production record is converted by opening the app.
