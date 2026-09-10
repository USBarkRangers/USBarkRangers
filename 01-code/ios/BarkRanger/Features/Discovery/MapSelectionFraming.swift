import BarkDomain
import MapKit

/// Frames selection near the lower center of the settled sheet’s visible map, without changing zoom.
final class MapSelectionFraming {
    private var selection: ParkID?
    private var coordinate: Coordinate?
    private var position = ParkSheetPosition.low
    private var visibleBand = CGRect.zero

    func apply(
        to map: MKMapView, annotation: ParkAnnotation?, position: ParkSheetPosition, sheetHeight: CGFloat = 0,
        cameraChanged: Bool = false, framingSheetHeight: CGFloat = 0, topObstruction: CGFloat = 0,
        animated: Bool = false
    ) {
        guard let annotation, position != .high else {
            selection = nil
            map.layoutMargins = .init(top: 8, left: 8, bottom: 8, right: 8)
            return
        }
        let bottomGap = map.window.map { $0.bounds.maxY - map.convert(map.bounds, to: $0).maxY } ?? 0
        map.layoutMargins = .init(
            top: 8, left: 8, bottom: max(8, sheetHeight - bottomGap - map.safeAreaInsets.bottom + 8), right: 8
        )
        let size = map.bounds.size
        guard size.width > 0, size.height > 0 else { return }
        let bottom = size.height - max(0, framingSheetHeight - bottomGap) - 16
        let top = max(map.safeAreaInsets.top, topObstruction) + 64
        let band = CGRect(x: 0, y: top, width: size.width, height: max(0, bottom - top))
        guard
            cameraChanged || selection != annotation.park.id || coordinate != annotation.park.coordinate
                || self.position != position
                || visibleBand != band
        else { return }
        selection = annotation.park.id
        coordinate = annotation.park.coordinate
        self.position = position
        visibleBand = band
        // Use the settled detent, not live drag height, so the camera does not chase every drag frame.
        let targetY = position == .medium ? max(band.minY, band.maxY - 24) : band.minY + band.height * 0.72
        let target = CGPoint(x: band.midX, y: targetY)
        // MapKit centers its camera inside the margins. During a glide/resize, centerCoordinate's
        // screen position can still reflect the old margins, so derive the new inset center directly.
        let viewport = map.bounds.inset(by: map.layoutMargins)
        let center = CGPoint(x: viewport.midX, y: viewport.midY)
        let point = map.convert(annotation.coordinate, toPointTo: map)
        let shifted = CGPoint(x: center.x + point.x - target.x, y: center.y + point.y - target.y)
        // MapKit owns interruption/retargeting; no delayed animation can reselect an older park.
        map.setCenter(map.convert(shifted, toCoordinateFrom: map), animated: animated)
    }
}
