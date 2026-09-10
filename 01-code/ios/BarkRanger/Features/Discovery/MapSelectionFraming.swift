import BarkDomain
import MapKit

/// Uses one medium-safe selection anchor for both browsing heights, without changing zoom.
final class MapSelectionFraming {
    private var selection: ParkID?
    private var coordinate: Coordinate?
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
                || visibleBand != band
        else { return }
        selection = annotation.park.id
        coordinate = annotation.park.coordinate
        visibleBand = band
        // Low and medium share the same anchor; resizing the card must not replay a camera command.
        let targetY = max(band.minY, band.maxY - 24)
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
