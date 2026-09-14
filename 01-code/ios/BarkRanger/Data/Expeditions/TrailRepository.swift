import BarkDomain
import Foundation

/// Bundled web trail geometry, loaded once off-main. No routing service or user coordinates are required.
actor TrailRepository {
    private struct Feature: Decodable {
        struct Geometry: Decodable { let coordinates: [[Double]] }
        let geometry: Geometry
    }
    private let url: URL?
    private var loaded: [String: [Coordinate]]?
    init(url: URL? = Bundle.main.url(forResource: "trail-geometry", withExtension: "json")) { self.url = url }
    func geometry(id: String) throws -> [Coordinate] {
        if loaded == nil {
            guard let url else { throw CocoaError(.fileNoSuchFile) }
            let features = try JSONDecoder().decode([String: Feature].self, from: Data(contentsOf: url))
            loaded = features.mapValues { feature in
                feature.geometry.coordinates.compactMap { pair in
                    guard pair.count >= 2 else { return nil }
                    return Coordinate(latitude: pair[1], longitude: pair[0])
                }
            }
        }
        return loaded?[id] ?? []
    }
    func position(id: String, fraction: Double) throws -> Coordinate? {
        let points = try geometry(id: id)
        guard let first = points.first else { return nil }
        let legs = zip(points, points.dropFirst()).map { $0.distance(to: $1) }
        var remaining = legs.reduce(0, +) * min(1, max(0, fraction))
        for (index, meters) in legs.enumerated() where meters > 0 {
            if remaining <= meters {
                let ratio = remaining / meters
                let a = points[index]
                let b = points[index + 1]
                return Coordinate(
                    latitude: a.latitude + (b.latitude - a.latitude) * ratio,
                    longitude: a.longitude + (b.longitude - a.longitude) * ratio)
            }
            remaining -= meters
        }
        return points.last ?? first
    }
}
