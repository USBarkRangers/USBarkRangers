import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct NativeVisitQueueTests {
    /// The advertised ceiling. Today's catalog has 393 sites, so 500 is the contract's limit and
    /// not a reachable selection. The phone must accept 500, refuse 501, and produce a command
    /// that fits the transport limit. Resending identical sealed bytes after a lost reply is
    /// the mailroom's general contract and is covered by NativeMailroomTests.
    @Test func aFiveHundredVisitRemovalIsAcceptedFitsTheTransportLimitAndFiveHundredOneIsRefused()
        async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "bulk-owner")
        try await store.seedPremium()
        var removals: [NativeVisitChange] = []
        for index in 0..<501 {
            let id = String(format: "bulk-%03d", index)
            let park = Park(
                id: .init(rawValue: id), siteID: .init(rawValue: id),
                name: "A park with a realistic name \(index)",
                coordinate: try #require(Coordinate(latitude: 40, longitude: -80)))
            let draft = try NativeVisitDraft(
                park: park, id: UUID().uuidString.lowercased(), now: Date(), timeZone: .gmt, fix: nil)
            func target(_ revision: Int64) -> NativeVisitIntent.Target {
                .init(
                    visitID: draft.id, officialPlaceID: draft.officialPlaceID, siteID: draft.siteID,
                    visitRevision: revision, placeRevision: revision)
            }
            // A removal needs a visit the phone knows about; a pending mark provides it.
            try await store.stageNativeVisitOperation(
                .single(
                    .init(
                        intent: .init(
                            target: target(0),
                            edit: .mark(
                                happenedAtMs: draft.happenedAtMs, timeZone: draft.timeZone, proximity: nil)),
                        before: nil, after: draft)))
            removals.append(.init(intent: .init(target: target(1), edit: .remove), before: draft, after: nil))
        }
        await #expect(throws: (any Error).self) {
            try await store.stageNativeVisitOperation(.removeMany(removals))
        }
        #expect(try await store.pendingChanges().count == 501)
        let bulk = NativeVisitOperation.removeMany(Array(removals.prefix(500)))
        let id = try await store.stageNativeVisitOperation(bulk)
        let row = try #require(try await store.pendingChanges().last)
        #expect(row.id == id && row.title == "Remove 500 visits" && row.canDiscard)
        let bytes = try bulk.commandBytes(id: id, createdAtMs: 1_800_000_000_000)
        #expect(bytes.count < 400_000)
        try NativeCallableTransport.checkRequest(endpoint: "nativeCommand", bytes: bytes)
        print("BULK_500_CLIENT commandBytes=\(bytes.count)")
        await store.close()
    }

    @Test func blockedSiteAndBulkDependenciesDoNotBlockAnUnrelatedSite() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "queue-owner")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        func draft(_ id: String) throws -> NativeVisitDraft {
            let park = Park(
                id: .init(rawValue: id), siteID: .init(rawValue: id), name: id,
                coordinate: try #require(Coordinate(latitude: 40, longitude: -80)))
            return try NativeVisitDraft(park: park, id: "visit-\(id)", now: Date(), timeZone: .gmt, fix: nil)
        }
        func target(_ draft: NativeVisitDraft, revision: Int64) -> NativeVisitIntent.Target {
            .init(
                visitID: draft.id, officialPlaceID: draft.officialPlaceID, siteID: draft.siteID,
                visitRevision: revision, placeRevision: revision)
        }
        func mark(_ draft: NativeVisitDraft) -> NativeVisitOperation {
            .single(
                .init(
                    intent: .init(
                        target: target(draft, revision: 0),
                        edit: .mark(
                            happenedAtMs: draft.happenedAtMs,
                            timeZone: draft.timeZone, proximity: nil)), before: nil, after: draft))
        }
        let a = try draft("a")
        let b = try draft("b")
        let c = try draft("c")
        let aID = try await store.stageNativeVisitOperation(mark(a))
        var updated = a
        updated.happenedAtMs -= 1000
        try await store.stageNativeVisitOperation(
            .single(
                .init(
                    intent: .init(
                        target: target(a, revision: 1),
                        edit: .changeDate(happenedAtMs: updated.happenedAtMs, timeZone: updated.timeZone)),
                    before: a, after: updated)))
        let bID = try await store.stageNativeVisitOperation(mark(b))
        try await store.stageNativeVisitOperation(
            .removeMany([
                .init(
                    intent: .init(target: target(updated, revision: 2), edit: .remove), before: updated,
                    after: nil),
                .init(intent: .init(target: target(b, revision: 1), edit: .remove), before: b, after: nil),
            ]))
        let cID = try await store.stageNativeVisitOperation(mark(c))
        #expect(try await store.nextVisitSubmission()?.submission.id == aID)
        try await store.rejectVisitOperation(aID, code: "invalid")
        #expect(try await store.nextVisitSubmission()?.submission.id == bID)
        try await store.rejectVisitOperation(bID, code: "invalid")
        let last = try #require(try await store.nextVisitSubmission())
        #expect(last.submission.id == cID)
        #expect(try await store.visitQueue().count == 5)
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "queue-owner")
        #expect(try await reopened.nextVisitSubmission()?.submission == last.submission)
        #expect(try await reopened.visitOperation(aID).changes.first?.after == a)
        await reopened.close()
    }
}
