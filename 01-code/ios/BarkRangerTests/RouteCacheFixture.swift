import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

/// Real polyline geometry without Apple requests; all disk tests own isolated temporary directories.
@MainActor enum RouteCacheFixture {
    static func trip(stops: Int = 2, offset: Int = 0) throws -> Trip {
        Trip(days: [
            .init(
                id: "day",
                stops: try (0..<stops).map { index in
                    .init(
                        name: "Stop \(index)",
                        coordinate: try #require(
                            Coordinate(latitude: 44, longitude: -80 + Double(index + offset) / 1000)))
                })
        ])
    }
    static func segment(_ offset: Int = 0) throws -> TripRoutePlan.Segment {
        try #require(TripRoutePlan.build(trip(offset: offset)).days.first?.segments.first)
    }
    static func route(_ segment: TripRoutePlan.Segment) -> MKRoute {
        let points = [segment.from, segment.to].compactMap(\.coordinate).map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
        return FixtureRoute(shape: MKPolyline(coordinates: points, count: points.count))
    }
    static func snapshot(_ index: Int = 0, at date: Date) throws -> RoadRoute.Snapshot {
        try #require(RoadRoute(route(segment(index)), fetchedAt: date).snapshot)
    }
    static func directory() -> URL {
        URL.temporaryDirectory.appendingPathComponent("route-cache-test-\(UUID())", isDirectory: true)
    }
}

nonisolated private final class FixtureRoute: MKRoute {
    private let shape: MKPolyline
    init(shape: MKPolyline) {
        self.shape = shape
        super.init()
    }
    override var polyline: MKPolyline { shape }
    override var distance: CLLocationDistance { 1_609.344 }
    override var expectedTravelTime: TimeInterval { 600 }
}
