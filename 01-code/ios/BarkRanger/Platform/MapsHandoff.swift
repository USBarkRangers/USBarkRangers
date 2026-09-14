import BarkDomain
import MapKit
import UIKit

/// Apple Maps owns routing. Only canonical coordinates and a safely encoded display name leave this app.
@MainActor
struct MapsHandoff {
    enum Failure: Error { case unavailable }
    struct RoutePart: Identifiable {
        let id: Int
        let title: String
        let url: URL
    }
    private let open: (URL) async -> Bool
    init(open: @escaping (URL) async -> Bool = { await UIApplication.shared.open($0) }) { self.open = open }
    static func navigationURL(for park: Park) -> URL? { navigationURL(for: Trip.Stop(park: park)) }
    static func navigationURL(for stop: Trip.Stop) -> URL? {
        guard let coordinate = stop.coordinate else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "maps.apple.com"
        components.path = "/"
        components.queryItems = [
            URLQueryItem(name: "daddr", value: "\(coordinate.latitude),\(coordinate.longitude)"),
            URLQueryItem(name: "q", value: stop.name), URLQueryItem(name: "dirflg", value: "d"),
        ]
        return components.url
    }
    func openPark(_ park: Park) async -> Bool {
        await openStop(Trip.Stop(park: park))
    }
    func openStop(_ stop: Trip.Stop) async -> Bool {
        guard let url = Self.navigationURL(for: stop), !Task.isCancelled else { return false }
        return await open(url)
    }
    /// Continuations overlap at one endpoint. Every planned stop remains in its original order.
    static func routeParts(_ day: TripRoutePlan.Day, google: Bool) -> [RoutePart] {
        let maximum = google ? 5 : 14
        var parts: [RoutePart] = []
        var start = 0
        while start < day.points.count - 1 {
            let end = min(start + maximum, day.points.count)
            let stops = Array(day.points[start..<end])
            let coordinates = stops.compactMap(\.coordinate).map { "\($0.latitude),\($0.longitude)" }
            guard coordinates.count == stops.count else { return [] }
            var url = URLComponents()
            url.scheme = "https"
            url.host = google ? "www.google.com" : "maps.apple.com"
            url.path = google ? "/maps/dir/" : "/directions"
            if google {
                url.queryItems = [
                    .init(name: "api", value: "1"), .init(name: "origin", value: coordinates.first),
                    .init(name: "destination", value: coordinates.last),
                    .init(name: "travelmode", value: "driving"),
                    .init(
                        name: "waypoints", value: coordinates.dropFirst().dropLast().joined(separator: "|")),
                ]
            } else {
                url.queryItems = [
                    .init(name: "source", value: coordinates.first),
                    .init(name: "destination", value: coordinates.last),
                    .init(name: "mode", value: "driving"),
                ]
                url.queryItems? += coordinates.dropFirst().dropLast().map {
                    .init(name: "waypoint", value: $0)
                }
            }
            guard let encoded = url.url, encoded.absoluteString.count <= 2_048 else { return [] }
            parts.append(
                RoutePart(
                    id: parts.count,
                    title: "\(stops.first?.name ?? "Start") → \(stops.last?.name ?? "Finish")", url: encoded))
            start = end - 1
        }
        return parts
    }
    func openDay(_ day: TripRoutePlan.Day, google: Bool, part: Int = 0) async -> Bool {
        let parts = Self.routeParts(day, google: google)
        guard parts.indices.contains(part), !Task.isCancelled else { return false }
        return await open(parts[part].url)
    }
}

extension MKMapItem {
    /// Keep the iOS 18 deployment target while using the current MapKit initializer on newer phones.
    static func barkStop(_ coordinate: Coordinate) -> MKMapItem {
        let point = CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude)
        if #available(iOS 26, *) {
            return MKMapItem(
                location: CLLocation(latitude: point.latitude, longitude: point.longitude), address: nil)
        }
        return MKMapItem(placemark: MKPlacemark(coordinate: point))
    }
}
