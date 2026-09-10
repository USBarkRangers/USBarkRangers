import MapKit

/// Bundled neutral tiles replace map imagery in overview mode; public-domain land supplies context.
nonisolated final class OfflineBasemapOverlay: MKTileOverlay {
    private let tile: Data?
    override init(urlTemplate: String?) {
        tile = Bundle.main.url(forResource: "offline-tile", withExtension: "png").flatMap {
            try? Data(contentsOf: $0)
        }
        super.init(urlTemplate: nil)
        canReplaceMapContent = true
    }
    override func loadTile(at path: MKTileOverlayPath, result: @escaping (Data?, (any Error)?) -> Void) {
        result(tile, nil)
    }
    static func loadOutlines(bundle: Bundle = .main) -> [any MKOverlay] {
        guard let url = bundle.url(forResource: "offline-land", withExtension: "geojson"),
            let data = try? Data(contentsOf: url), let objects = try? MKGeoJSONDecoder().decode(data)
        else { return [] }
        return objects.compactMap { $0 as? MKGeoJSONFeature }.flatMap(\.geometry).compactMap {
            $0 as? any MKOverlay
        }
    }
}
