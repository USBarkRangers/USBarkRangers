import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct PassportNavigationTests {
    @Test func nearbyLookupIsCoalescedCachedAndOldCompletionCannotRestoreClearedLocation() async throws {
        let map = try #require(Coordinate(latitude: 40, longitude: -80))
        let gps = try #require(Coordinate(latitude: 30, longitude: -81))
        var requests = 0
        var completion: CheckedContinuation<Coordinate, Never>?
        let model = NearbyStatesModel(
            locate: {
                requests += 1
                return await withCheckedContinuation { completion = $0 }
            }, mapCenter: { map })
        model.load()
        model.load()
        try await eventually { requests == 1 }
        #expect(model.reference == map)
        completion?.resume(returning: gps)
        try await eventually { !model.loading }
        #expect(model.reference == gps)
        model.load()
        #expect(requests == 1)
        model.reset()
        model.load()
        try await eventually { requests == 2 }
        model.reset()
        completion?.resume(returning: gps)
        await Task.yield()
        #expect(model.reference == nil && !model.loading)
    }

    @Test func nearbyFailureKeepsMapFallbackWithoutInventingLocation() async throws {
        let map = try #require(Coordinate(latitude: 40, longitude: -80))
        let model = NearbyStatesModel(mapCenter: { map })
        model.load()
        try await eventually { !model.loading }
        #expect(model.reference == map && model.notice != nil)
        let unavailable = NearbyStatesModel()
        unavailable.load()
        try await eventually { !unavailable.loading }
        #expect(unavailable.reference == nil && unavailable.notice != nil)
    }
}
