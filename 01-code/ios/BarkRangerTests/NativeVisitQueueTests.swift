import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct NativeVisitQueueTests {
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
