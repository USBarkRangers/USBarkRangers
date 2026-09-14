import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct NativeVisitActionTests {
    @Test func datesUseCapturedRevisionsAndUpgradePreservesVisitDate() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "actions")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let now = Date()
        let coordinate = try #require(Coordinate(latitude: 40, longitude: -80))
        let park = Park(
            id: .init(rawValue: "park"), siteID: .init(rawValue: "site"), name: "Park", coordinate: coordinate
        )
        #expect(try await store.markNativeVisit(park: park, now: now, timeZone: .gmt) != nil)
        #expect(try await store.markNativeVisit(park: park, now: now, timeZone: .gmt) == nil)
        let first = try await store.nativeVisitWorkingState(siteID: "site", officialPlaceID: "park")
        #expect(first.visitRevision == 1 && first.placeRevision == 1)
        let earlier = now.addingTimeInterval(-86_400)
        try await store.changeNativeVisitDate(selected: first, date: earlier, timeZone: .gmt, now: now)
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.changeNativeVisitDate(selected: first, date: now, timeZone: .gmt, now: now)
        }
        let edited = try await store.nativeVisitWorkingState(siteID: "site", officialPlaceID: "park")
        #expect(edited.draft?.happenedAtMs == (try NativeVisitDraft.milliseconds(earlier)))
        let fix = LocationFix(coordinate: coordinate, accuracy: 10, date: now)
        try await store.markNativeVisit(park: park, fix: fix, now: now, timeZone: .gmt)
        let verified = try await store.nativeVisitWorkingState(siteID: "site", officialPlaceID: "park")
        #expect(verified.draft?.verified == true)
        #expect(verified.draft?.happenedAtMs == edited.draft?.happenedAtMs)
        #expect(try await store.markNativeVisit(park: park, fix: fix, now: now, timeZone: .gmt) == nil)
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.removeNativeVisits(selected: [edited])
        }
        try await store.removeNativeVisits(selected: [verified])
        let removed = try await store.nativeVisitWorkingState(siteID: "site", officialPlaceID: "park")
        #expect(removed.visitID == nil && removed.draft == nil && removed.placeRevision == 4)
        try await store.markNativeVisit(park: park, now: now, timeZone: .gmt)
        let again = try await store.nativeVisitWorkingState(siteID: "site", officialPlaceID: "park")
        #expect(again.visitID != first.visitID && again.visitRevision == 1 && again.placeRevision == 5)
        #expect(try await store.visitQueue().count == 5)
        await store.close()
    }
}
