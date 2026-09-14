import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct NativeVisitConflictTests {
    @Test func choosingRemoteDiscardsOnlyTheExplicitConnectedBulkGroup() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "conflict")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        func park(_ id: String) throws -> Park {
            .init(
                id: .init(rawValue: id), siteID: .init(rawValue: id), name: id,
                coordinate: try #require(Coordinate(latitude: 40, longitude: -80)))
        }
        let aID = try #require(try await store.markNativeVisit(park: park("a")))
        try await store.markNativeVisit(park: park("b"))
        let a = try await store.nativeVisitWorkingState(siteID: "a", officialPlaceID: "a")
        let b = try await store.nativeVisitWorkingState(siteID: "b", officialPlaceID: "b")
        try await store.removeNativeVisits(selected: [a, b])
        let cID = try #require(try await store.markNativeVisit(park: park("c")))
        #expect(try await store.nextVisitSubmission()?.submission.id == aID)
        try await store.rejectVisitOperation(aID, code: "invalid")
        let group = try await store.visitConflictGroup(aID)
        #expect(group.entries.count == 3 && group.siteIDs == ["a", "b"])
        let refs = try JSONSerialization.jsonObject(with: JSONEncoder().encode(group.references))
        let data = try JSONSerialization.data(withJSONObject: [
            "version": 1, "requests": refs, "visits": [], "places": [], "progress": NSNull(),
            "readTime": ["seconds": Int64(Date().timeIntervalSince1970), "nanoseconds": 0],
        ])
        let selection = try JSONDecoder().decode(NativeVisitSelection.self, from: data)
        let review = try await store.reviewVisitConflict(group: group, selection: selection)
        #expect(review.localPlan.operations.count == 3)
        #expect(review.localPlan.operations.last?.value.isBulk == true)
        let resolution = try await store.resolveVisitConflict(review, choice: .keepRemote)
        #expect(resolution.replacementIDs.isEmpty)
        #expect(try await store.visitQueue().map(\.id) == [cID])
        #expect(try await store.nativeVisitWorkingState(siteID: "a", officialPlaceID: "a").draft == nil)
        #expect(try await store.nativeVisitWorkingState(siteID: "c", officialPlaceID: "c").draft != nil)
        #expect(try await store.nextVisitSubmission()?.submission.id == cID)
        await store.close()
    }
}
