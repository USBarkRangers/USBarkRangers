# ADR 0002 — Independent catalog, scoped personal store and exact receipts

Date: September 10, 2026. Status: Implemented for Phase 3 local development.

## Decision

Public catalog startup remains independent of Firebase, credentials and personal storage. CatalogRepository still owns validated public revisions. A missing native Firebase configuration or a personal-store failure cannot prevent bundled/saved parks from opening. Discovery receives neither Firebase references nor account workflows.

Firebase Auth/Keychain is the credential and remembered-UID authority. AccountSession owns one active UID lifetime, generation, personal-store observer and sync schedule. A UID change clears the published personal state/access immediately, cancels old work, awaits its shutdown and opens the next account. Captured old repositories retain their original store; they cannot address another account. Provider/callable actions also validate the initiating UID at their SDK/server boundaries.

SwiftData is the only durable personal cache/write queue. Schema 1 stores one account payload containing the last accepted server snapshot, concrete pending profile/mapStyle operations, exact receipts and read-order metadata. Each UID has a SHA-256-named directory, protected until first device unlock. No mutable ModelContext escapes LocalStore. There is no schema upgrade, web importer, generic event bus or migration service.

One payload makes a local projection plus outbox insertion an atomic transaction. Publishing follows successful save; errors roll back and retain the existing file. JSON-shaped current-format fields/IDs remain available, including unknown fields, unresolved visits, existing route order/notes/custom stops and both achievement representations. Small Visit/Trip/Expedition values are read-only projections, not independently stored feature state. Firestore uses memory cache and server-only reads; it never receives native direct writes.

LocalStore is a SwiftData ModelActor. Construction/loading explicitly leave MainActor. SwiftData's executor can inline synchronous work on its caller, so the three UI write methods in ProfileRepository explicitly use `@concurrent` before entering the store. The sync actor is already off MainActor. The performance regression test exercises this actual UI-to-repository boundary and records threads inside the save, rather than assuming that an actor name proves background execution. No custom executor or detached-task framework is introduced.

## Receipt protocol

Only `profile` and `mapStyle` operations exist. A durable intent contains UID, UUID, creation time, touched previous content and proposed value. Retries send that exact envelope. The server transaction checks identity, deletion tombstone, rate/field/access policy, previous touched content and any earlier receipt. Accepted writes patch only the appropriate current fields; server receipts cannot be written by clients.

Because existing web writers do not increment a new revision field, compare touched values rather than inventing a native-only revision authority. An accepted retry returns its exact prior receipt without applying the edit again. Reusing an ID with different content is rejected. Conflicts/rejections retain the user's local text and show the server value for an explicit choice. Rejected/conflicting receipts first advance only their touched baseline content; a subsequent accepted snapshot can advance it again. Resolution always uses that newest baseline, so choosing the server value cannot restore an older receipt value. A conflict retry gets a new operation ID; it cannot mutate the old operation's identity.

SyncEngine drains/acknowledges pending operations before fetching the latest server snapshot. This ordering matters when an accepted response was lost and the web later edited the same field: the old receipt must not overwrite that newer read. Read sequence barriers also reject a snapshot begun before an acknowledgement. Pending fields overlay accepted snapshots until resolved.

One cancellable worker serializes work per account. AccountSession coalesces changes arriving during a flush into another pass. Retries back off from two seconds to five minutes; idle foreground refresh is five minutes, with immediate foreground/reconnect/manual checks. Network availability is a hint, not server confirmation. Callable timeouts are 15 seconds for mutations and 30 seconds for existing-provider actions. Underlying Firebase requests may finish after task cancellation; UID/generation/cancellation checks reject their late results. Remote commits already accepted remain recoverable by the same receipt.

## Access and limits

EntitlementRepository publishes access derived from the active account's accepted baseline. Cache validity ends at the earliest supplied expiry or 30 days after server confirmation. An unavailable network does not revoke a still-valid cache. Expiry changes future paid operations, not stored history. Existing current server status rules are preserved; native cached access is conservatively bounded. Device camera/search/grouping/units/overview stay device-local; Premium Standard/Satellite preferences come from the personal store. Account appearance never copies into device defaults.

The concrete queue is capped at 128 intents; the server permits 128 new operations/hour and 256/day. Operations older than 30 days are visibly rejected. Receipts carry 60-day expiry; a later authorized deployment must enable Firestore TTL. Account deletion removes the UID’s receipt tree after committing profile deletion/tombstone and before deleting Auth, so cleanup failure can be retried safely. The retained web deletion entry point uses the same cleanup. Pagination refuses an incomplete 10,000-record collection rather than replacing saved history with a prefix. Known protected fields have no native operation. The retained web rules still allow their existing `walkPoints` contract; future Phase 4 scoring needs a separate coordinated review before adding native score writes.

## Tradeoffs and growth

An account payload rewrites more bytes than per-entity rows. Current users and two concrete edit types do not justify a generic distributed-sync engine. Measured 393/5,000-record personal snapshots remain off the UI thread. Before high-frequency visit/trip/recording writes arrive, measure actual payload growth and split only the data that requires independent write frequency. This is a future schema decision, not a speculative migration file now.

Saved-route reads follow the existing Premium server rules; previously cached trips survive access expiry. A free account on a fresh installation cannot retrieve protected saved routes without a later authorized server policy change. No claim of new free-access behavior is made.

Local emulators use a fixed demo project, synthetic accounts and provider stubs. They cannot send real emails, cancel real subscriptions or deploy through their configuration. Live Apple/Google/device verification requires the genuine registered iOS app and signing/provider setup. No customer data, production deployment or user migration occurs in Phase 3.

## References

- [Phase 3 implementation and testing](../reports/ios-native/PHASE_3.md)
- [Implemented file ownership](../../01-code/ios/ARCHITECTURE.md)
- [Firebase Auth for Apple platforms](https://firebase.google.com/docs/auth/ios/start)
- [Firebase Apple sign-in and token revocation](https://firebase.google.com/docs/auth/ios/apple)
- [Firebase emulator connections](https://firebase.google.com/docs/emulator-suite/connect_auth)
- [SwiftData ModelActor](https://developer.apple.com/documentation/swiftdata/modelactor)
- [Swift executor discussion](https://forums.swift.org/t/question-about-swiftdata-and-concurrency-interoperability/83097)
