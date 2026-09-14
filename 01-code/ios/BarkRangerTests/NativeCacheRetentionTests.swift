import BarkDomain
import Foundation
import SwiftData
import Synchronization
import Testing

@testable import BarkRanger

struct NativeCacheRetentionTests {
    @Test func cleanTripLimitProtectsActiveDirtyAndPendingContentAcrossRelaunch() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "cache")
        try await store.seedPremium()
        for id in ["active", "dirty", "pending"] {
            try await store.acceptTripSnapshot(nativeTripSnapshot(Trip(id: id, name: id), revision: 1))
            var draft = try #require(try await store.cachedTrip(id: id))
            if id != "active" { draft.trip.name += " unsynced" }
            _ = try await store.checkpointNativeDraft(draft, replacing: nil)
            if id == "pending" { _ = try await store.stageTripSave(draft) }
        }
        _ = try await store.openNativeDraft(id: "active")
        for i in 0..<105 {
            try await store.acceptTripSnapshot(
                nativeTripSnapshot(Trip(id: "clean-\(i)", name: "Trip"), revision: 1))
        }
        #expect(try await store.cachedContentIDs().count == 103)
        #expect(try await store.cachedTrip(id: "clean-0") == nil)
        #expect(try await store.cachedTrip(id: "clean-104") != nil)
        for id in ["active", "dirty", "pending"] {
            #expect(try await store.cachedTrip(id: id) != nil)
            #expect(try await store.currentNativeDraft(id: id) != nil)
        }
        let ids = try await store.pendingTripIDs()
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "cache")
        #expect(try await reopened.cachedContentIDs().count == 103)
        #expect(try await reopened.pendingTripIDs() == ids)
        #expect(try await reopened.currentNativeDraft(id: "dirty")?.trip.name == "dirty unsynced")
        #expect(try await reopened.nativeSelection().tripID == "active")
        await reopened.close()
    }

    @Test func bytePressureCountsCleanEditorCopiesAndFailedEvictionRollsBack() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let failing = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "bytes",
            beforeSave: { if failing.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        try await store.seedPremium()
        for id in ["a", "b", "active"] {
            try await store.acceptTripSnapshot(nativeTripSnapshot(Trip(id: id, name: id), revision: 1))
            _ = try await store.openNativeDraft(id: id)
        }
        // Exercise arithmetic at 64 MiB without generating 64 MiB of fake route text.
        // The real footprint writer is checked separately below with actual notes.
        try await store.cachePressureFixture()
        failing.withLock { $0 = true }
        await #expect(throws: (any Error).self) { try await store.trimCacheFixture() }
        #expect(try await store.cachedContentIDs() == ["a", "active", "b"])
        #expect(try await store.currentNativeDraft(id: "a") != nil)
        failing.withLock { $0 = false }
        try await store.trimCacheFixture()
        #expect(try await store.cachedContentIDs() == ["active", "b"])
        #expect(try await store.currentNativeDraft(id: "a") == nil)
        #expect(try await store.currentNativeDraft(id: "active") != nil)
        await store.close()
    }

    @Test func realCacheFootprintIncludesPlanningNotes() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "notes")
        let trip = Trip(
            id: "notes",
            days: [
                .init(stops: [
                    .init(
                        id: "stop", placeIdentity: .custom("place"),
                        name: "Place", coordinate: Coordinate(latitude: 40, longitude: -80),
                        notes: String(repeating: "n", count: 1000))
                ])
            ])
        try await store.acceptTripSnapshot(nativeTripSnapshot(trip, revision: 1))
        #expect(try await store.cacheFootprintIncludesNotes("notes"))
        await store.close()
    }
}

extension NativeStore {
    fileprivate func cachedContentIDs() throws -> [String] {
        var query = FetchDescriptor<NativeLocalSchema.TripContent>()
        query.propertiesToFetch = [\.id]
        return try modelContext.fetch(query).map(\.id).sorted()
    }
    fileprivate func cachePressureFixture() throws {
        for id in ["a", "b", "active"] {
            let row = try #require(try contentRow(id))
            row.byteCount = Self.tripCacheBytes / 2
        }
        try commit()
    }
    fileprivate func trimCacheFixture() throws {
        do {
            try stageCacheRetention()
            try commit()
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    fileprivate func cacheFootprintIncludesNotes(_ id: String) throws -> Bool {
        let row = try #require(try contentRow(id))
        return row.byteCount >= row.bytes.count + (row.readStamp?.count ?? 0) + 1000
    }
}
