import BarkDomain
import UIKit

/// Apple Maps owns routing. Only canonical coordinates and a safely encoded display name leave this app.
@MainActor
struct MapsHandoff {
    private let open: (URL) async -> Bool
    init(open: @escaping (URL) async -> Bool = { await UIApplication.shared.open($0) }) { self.open = open }
    static func navigationURL(for park: Park) -> URL? {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "maps.apple.com"
        components.path = "/"
        components.queryItems = [
            URLQueryItem(name: "daddr", value: "\(park.coordinate.latitude),\(park.coordinate.longitude)"),
            URLQueryItem(name: "q", value: park.name), URLQueryItem(name: "dirflg", value: "d"),
        ]
        return components.url
    }
    func openPark(_ park: Park) async -> Bool {
        guard let url = Self.navigationURL(for: park) else { return false }
        return await open(url)
    }
}
