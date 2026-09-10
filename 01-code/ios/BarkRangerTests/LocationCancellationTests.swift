import BarkDomain
import CoreLocation
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor
struct LocationCancellationTests {
    @Test func cancelledQueuedFixNeverStartsAndLaterFixRemainsUsable() async throws {
        let manager = ControlledLocationManager()
        let client = LocationClient(manager: manager)
        let queued = Task { try await client.currentFix() }
        queued.cancel()
        if case .success = await queued.result { Issue.record("Cancelled fix unexpectedly succeeded") }
        #expect(manager.requests == 0)
        let pending = Task { try await client.currentFix() }
        try await eventually { manager.requests == 1 }
        pending.cancel()
        if case .success = await pending.result { Issue.record("Cancelled fix unexpectedly succeeded") }
        let replacement = Task { try await client.currentFix() }
        try await eventually { manager.requests == 2 }
        client.locationManager(manager, didUpdateLocations: [CLLocation(latitude: 44, longitude: -68)])
        let fix = try await replacement.value
        #expect(fix.latitude == 44 && fix.longitude == -68)
    }

    @Test func cancellationAfterACompletedFixCannotCancelItsReplacement() async throws {
        let manager = ControlledLocationManager()
        let client = LocationClient(manager: manager)
        for iteration in 0..<20 {
            let old = Task { try await client.currentFix() }
            try await eventually { manager.requests == iteration * 2 + 1 }
            client.locationManager(manager, didUpdateLocations: [CLLocation(latitude: 44, longitude: -68)])
            old.cancel()
            let next = Task(priority: .high) { try await client.currentFix() }
            try await eventually { manager.requests == iteration * 2 + 2 }
            _ = await old.result
            await Task.yield()
            client.locationManager(manager, didUpdateLocations: [CLLocation(latitude: 40, longitude: -80)])
            let fix = try await next.value
            #expect(fix.latitude == 40 && fix.longitude == -80)
        }
    }
}

nonisolated private final class ControlledLocationManager: CLLocationManager {
    private let count = Mutex(0)
    var requests: Int { count.withLock { $0 } }
    override var authorizationStatus: CLAuthorizationStatus { .authorizedWhenInUse }
    override func requestLocation() { count.withLock { $0 += 1 } }
    override func stopUpdatingLocation() {}
}
