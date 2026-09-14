import Foundation
import MapKit

/// Renderable road geometry, independent of editable trips and MapKit's non-persistable MKRoute.
struct RoadRoute {
    let polyline: MKPolyline
    let meters: Double
    let seconds: Double
    var fetchedAt: Date? = nil

    init(polyline: MKPolyline, meters: Double, seconds: Double) {
        self.polyline = polyline
        self.meters = meters
        self.seconds = seconds
    }
    init(_ route: MKRoute, fetchedAt: Date) {
        self.init(polyline: route.polyline, meters: route.distance, seconds: route.expectedTravelTime)
        self.fetchedAt = fetchedAt
    }
    init(_ snapshot: Snapshot) {
        let points = snapshot.points.map { MKMapPoint(x: $0.x, y: $0.y) }
        self.init(
            polyline: MKPolyline(points: points, count: points.count),
            meters: snapshot.meters, seconds: snapshot.seconds)
        fetchedAt = snapshot.fetchedAt
    }
    var memoryBytes: Int { polyline.pointCount * MemoryLayout<MKMapPoint>.stride + 256 }
    var snapshot: Snapshot? {
        guard let fetchedAt, (2...100_000).contains(polyline.pointCount) else { return nil }
        let points = UnsafeBufferPointer(start: polyline.points(), count: polyline.pointCount)
        return Snapshot(
            points: points.map { .init(x: $0.x, y: $0.y) }, meters: meters, seconds: seconds,
            fetchedAt: fetchedAt)
    }

    /// Only immutable numeric values cross to the disk actor; encoding and I/O never run on MainActor.
    nonisolated struct Snapshot: Codable, Sendable {
        struct Point: Codable, Sendable {
            let x: Double
            let y: Double
        }
        static let lifetime: TimeInterval = 30 * 24 * 60 * 60
        let points: [Point]
        let meters: Double
        let seconds: Double
        let fetchedAt: Date

        func isValid(at now: Date) -> Bool {
            let age = now.timeIntervalSince(fetchedAt)
            return age >= 0 && age < Self.lifetime && (2...100_000).contains(points.count)
                && meters.isFinite && meters >= 0 && seconds.isFinite && seconds >= 0
                && points.allSatisfy {
                    $0.x.isFinite && $0.y.isFinite
                        && (0...268_435_456).contains($0.x) && (0...268_435_456).contains($0.y)
                }
        }
    }
}
