import BarkDomain
import MapKit

/// Keeps selection in the map band above the medium sheet and below search, without changing zoom.
final class MapSelectionFraming {
    private var selection: ParkID?
    private var position = ParkSheetPosition.low
    private var visibleBand = CGRect.zero

    func apply(
        to map: MKMapView, annotation: ParkAnnotation?, position: ParkSheetPosition, sheetHeight: CGFloat = 0,
        cameraChanged: Bool = false, maximumSheetHeight: CGFloat = 0, topObstruction: CGFloat = 0
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
        let bottom = size.height - max(0, maximumSheetHeight - bottomGap) - 16
        let top = max(map.safeAreaInsets.top, topObstruction) + 64
        let band = CGRect(x: 0, y: top, width: size.width, height: max(0, bottom - top))
        guard
            cameraChanged || selection != annotation.park.id || self.position != position
                || visibleBand != band
        else { return }
        selection = annotation.park.id
        self.position = position
        visibleBand = band
        // Reserve medium's map band up front, so dragging the sheet doesn't chase or cover its pin.
        let target = CGPoint(x: band.midX, y: band.midY)
        let center = map.convert(map.centerCoordinate, toPointTo: map)
        let point = map.convert(annotation.coordinate, toPointTo: map)
        let shifted = CGPoint(x: center.x + point.x - target.x, y: center.y + point.y - target.y)
        map.setCenter(map.convert(shifted, toCoordinateFrom: map), animated: false)
    }
}
