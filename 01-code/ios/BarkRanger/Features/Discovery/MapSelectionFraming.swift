import BarkDomain
import MapKit

/// Frames a new selection once above the medium sheet. Sheet motion never moves the camera.
final class MapSelectionFraming {
    private var selection: ParkID?
    private var coordinate: Coordinate?

    func apply(
        to map: MKMapView, annotation: ParkAnnotation?, cameraChanged: Bool = false,
        framingSheetHeight: CGFloat = 0, topObstruction: CGFloat = 0, animated: Bool = false
    ) {
        guard let annotation else {
            selection = nil
            coordinate = nil
            return
        }
        let size = map.bounds.size
        guard size.width > 0, size.height > 0,
            cameraChanged || selection != annotation.park.id || coordinate != annotation.park.coordinate
        else { return }
        selection = annotation.park.id
        coordinate = annotation.park.coordinate
        let bottomGap = map.window.map { $0.bounds.maxY - map.convert(map.bounds, to: $0).maxY } ?? 0
        let top = max(map.safeAreaInsets.top, topObstruction) + 64
        let target = CGPoint(
            x: size.width / 2, y: max(top, size.height - max(0, framingSheetHeight - bottomGap) - 40))
        let center = map.convert(map.centerCoordinate, toPointTo: map)
        let point = map.convert(annotation.coordinate, toPointTo: map)
        let shifted = CGPoint(x: center.x + point.x - target.x, y: center.y + point.y - target.y)
        let destination = map.convert(shifted, toCoordinateFrom: map)
        guard animated else {
            map.setCenter(destination, animated: false)
            return
        }
        // Retarget from the visible camera; native MapKit still owns gestures and interruption.
        UIView.animate(
            withDuration: 0.3, delay: 0,
            options: [.curveEaseInOut, .beginFromCurrentState, .allowUserInteraction]
        ) {
            map.setCenter(destination, animated: true)
        }
    }
}
