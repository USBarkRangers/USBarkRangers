import Foundation

/// Retain accuracy and time so proximity policy can reject a stale or imprecise location.
public struct LocationFix: Equatable, Sendable {
    public let coordinate: Coordinate
    public let accuracy: Double
    public let date: Date
    public init(coordinate: Coordinate, accuracy: Double, date: Date) {
        self.coordinate = coordinate
        self.accuracy = accuracy
        self.date = date
    }
}

extension Coordinate {
    public func distance(to other: Coordinate) -> Double {
        let radians = Double.pi / 180
        let latitudeDelta = (other.latitude - latitude) * radians
        let longitudeDelta = (other.longitude - longitude) * radians
        let a =
            pow(sin(latitudeDelta / 2), 2)
            + cos(latitude * radians) * cos(other.latitude * radians) * pow(sin(longitudeDelta / 2), 2)
        return 6_371_000 * 2 * atan2(sqrt(max(0, a)), sqrt(max(0, 1 - a)))
    }
}
