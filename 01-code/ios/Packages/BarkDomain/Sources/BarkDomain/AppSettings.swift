import Foundation

/// Non-private device preferences. No membership, location permission, or cloud state.
public struct AppSettings: Codable, Equatable, Sendable {
    public enum MapStyle: String, Codable, CaseIterable, Sendable {
        case standard = "Standard"
        case satellite = "Satellite"
        case overview = "Offline overview"
    }
    public enum Units: String, Codable, CaseIterable, Sendable {
        case miles = "Miles"
        case kilometers = "Kilometers"
    }
    public struct Camera: Codable, Equatable, Sendable {
        public let center: Coordinate
        public let latitudeDelta: Double
        public let longitudeDelta: Double
        public init?(center: Coordinate, latitudeDelta: Double, longitudeDelta: Double) {
            guard latitudeDelta.isFinite, longitudeDelta.isFinite, (0.001...180).contains(latitudeDelta),
                (0.001...360).contains(longitudeDelta)
            else { return nil }
            self.center = center
            self.latitudeDelta = latitudeDelta
            self.longitudeDelta = longitudeDelta
        }
    }
    public var mapStyle: MapStyle = .standard
    public var units: Units = .miles
    public var clustering = true
    public var rememberMapPosition = true
    public var camera: Camera?
    public var filters = ParkFilter.Query()
    public init() {}
    public func sanitized() -> Self {
        var copy = self
        copy.filters.search = String(filters.search.prefix(200))
        if let camera,
            Camera(
                center: camera.center, latitudeDelta: camera.latitudeDelta,
                longitudeDelta: camera.longitudeDelta) == nil
        {
            copy.camera = nil
        }
        if !rememberMapPosition { copy.camera = nil }
        return copy
    }
}
