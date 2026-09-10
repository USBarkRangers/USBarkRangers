import MapKit

/// Styling only. The coordinator owns overlay lifetime; this factory never loads or requests data.
enum MapOverlayRenderer {
    static func renderer(for overlay: any MKOverlay) -> MKOverlayRenderer {
        if let tile = overlay as? MKTileOverlay { return MKTileOverlayRenderer(tileOverlay: tile) }
        let renderer: MKOverlayPathRenderer
        if let polygon = overlay as? MKPolygon {
            renderer = MKPolygonRenderer(polygon: polygon)
        } else if let polygons = overlay as? MKMultiPolygon {
            renderer = MKMultiPolygonRenderer(multiPolygon: polygons)
        } else {
            return MKOverlayRenderer(overlay: overlay)
        }
        renderer.fillColor = UIColor(red: 0.93, green: 0.94, blue: 0.87, alpha: 1)
        renderer.strokeColor = UIColor(red: 0.38, green: 0.48, blue: 0.40, alpha: 1)
        renderer.lineWidth = 0.7
        return renderer
    }
}
