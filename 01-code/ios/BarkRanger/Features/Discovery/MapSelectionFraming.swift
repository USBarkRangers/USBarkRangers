import BarkDomain
import MapKit

/// Pans a new selection above the medium sheet at a fixed zoom. Sheet motion never moves the camera.
final class MapSelectionFraming {
    private var selection: String?
    private var coordinate: Coordinate?
    private weak var map: MKMapView?
    private var displayLink: CADisplayLink?
    private var glide: Glide?
    var isAnimating: Bool { displayLink != nil }

    func apply(
        to map: MKMapView, annotation: (any MKAnnotation)?, cameraChanged: Bool = false,
        framingSheetHeight: CGFloat = 0, topObstruction: CGFloat = 0, animated: Bool = false,
        focusRegion: MKCoordinateRegion? = nil
    ) {
        guard let annotation else {
            cancel()
            selection = nil
            coordinate = nil
            return
        }
        guard
            let pointCoordinate = Coordinate(
                latitude: annotation.coordinate.latitude,
                longitude: annotation.coordinate.longitude)
        else { return }
        let identity: String
        if let park = annotation as? ParkAnnotation {
            identity = "park:" + park.park.id.rawValue
        } else if let place = annotation as? PlaceAnnotation {
            identity = "place:" + place.stop.id
        } else {
            return
        }
        let size = map.bounds.size
        guard size.width > 0, size.height > 0,
            cameraChanged || selection != identity || coordinate != pointCoordinate
        else { return }
        cancel()
        selection = identity
        coordinate = pointCoordinate
        if let focusRegion {
            focus(focusRegion, on: map, sheetHeight: framingSheetHeight, topObstruction: topObstruction)
            return
        }
        guard
            let camera = destination(
                on: map, coordinate: annotation.coordinate, sheetHeight: framingSheetHeight,
                topObstruction: topObstruction, camera: map.camera)
        else { return }
        guard animated else {
            Self.set(camera, on: map)
            return
        }
        self.map = map
        glide = Glide(
            from: MKMapPoint(map.centerCoordinate), camera: camera, started: CACurrentMediaTime(),
            coordinate: annotation.coordinate, sheetHeight: framingSheetHeight, topObstruction: topObstruction
        )
        // Native camera flights can pull back between equal-distance endpoints. Interpolate only
        // the ground center at display cadence; distance, pitch and heading remain fixed throughout.
        let targetProxy = TickTarget(owner: self)
        let link = CADisplayLink(target: targetProxy, selector: #selector(TickTarget.tick(_:)))
        displayLink = link
        link.add(to: .main, forMode: .common)
    }
    /// Touch-down, explicit replacement, dismissal and view teardown end this owner's pan.
    func cancel() {
        displayLink?.invalidate()
        displayLink = nil
        glide = nil
        map = nil
    }
    isolated deinit { displayLink?.invalidate() }

    private func tick(_ link: CADisplayLink) {
        guard let map, let glide else {
            cancel()
            return
        }
        let progress = min(1, max(0, (link.targetTimestamp - glide.started) / 0.3))
        let eased = progress * progress * (3 - 2 * progress)
        // Keyboard dismissal can resize MapKit during this same glide. Reproject the target in the
        // live viewport, keeping the captured zoom and the original animation deadline.
        let destination =
            destination(
                on: map, coordinate: glide.coordinate, sheetHeight: glide.sheetHeight,
                topObstruction: glide.topObstruction, camera: glide.camera) ?? glide.camera
        let end = MKMapPoint(destination.centerCoordinate)
        let world = MKMapRect.world.size.width
        var dx = end.x - glide.from.x
        if dx > world / 2 { dx -= world }
        if dx < -world / 2 { dx += world }
        let center = MKMapPoint(
            x: glide.from.x + dx * eased, y: glide.from.y + (end.y - glide.from.y) * eased
        ).coordinate
        let camera = MKMapCamera(
            lookingAtCenter: center, fromDistance: glide.camera.centerCoordinateDistance,
            pitch: glide.camera.pitch, heading: glide.camera.heading)
        if progress == 1 {
            cancel()
        }
        Self.set(camera, on: map)
    }
    /// A search changes zoom and framing in ONE region update. Setting its region and then panning
    /// immediately gives MapKit two competing annotation destinations during keyboard dismissal.
    private func focus(
        _ region: MKCoordinateRegion, on map: MKMapView, sheetHeight: CGFloat, topObstruction: CGFloat
    ) {
        let fitted = map.regionThatFits(region)
        let center = map.convert(map.centerCoordinate, toPointTo: map)
        let target = target(on: map, sheetHeight: sheetHeight, topObstruction: topObstruction)
        let scale = MKMapRect.world.width * fitted.span.longitudeDelta / 360 / map.bounds.width
        let point = MKMapPoint(fitted.center)
        let shifted = MKMapPoint(
            x: point.x + (center.x - target.x) * scale,
            y: point.y + (center.y - target.y) * scale
        ).coordinate
        UIView.performWithoutAnimation {
            map.setRegion(MKCoordinateRegion(center: shifted, span: fitted.span), animated: false)
        }
    }
    private func target(on map: MKMapView, sheetHeight: CGFloat, topObstruction: CGFloat) -> CGPoint {
        let bottomGap = map.window.map { $0.bounds.maxY - map.convert(map.bounds, to: $0).maxY } ?? 0
        let top = max(map.safeAreaInsets.top, topObstruction) + 64
        return CGPoint(
            x: map.bounds.midX,
            y: max(top, map.bounds.height - max(0, sheetHeight - bottomGap) - 40))
    }
    private func destination(
        on map: MKMapView, coordinate: CLLocationCoordinate2D, sheetHeight: CGFloat,
        topObstruction: CGFloat, camera: MKMapCamera
    ) -> MKMapCamera? {
        let target = target(on: map, sheetHeight: sheetHeight, topObstruction: topObstruction)
        let center = map.convert(map.centerCoordinate, toPointTo: map)
        let point = map.convert(coordinate, toPointTo: map)
        let shifted = CGPoint(x: center.x + point.x - target.x, y: center.y + point.y - target.y)
        let destination = map.convert(shifted, toCoordinateFrom: map)
        guard CLLocationCoordinate2DIsValid(destination) else { return nil }
        return MKMapCamera(
            lookingAtCenter: destination, fromDistance: camera.centerCoordinateDistance,
            pitch: camera.pitch, heading: camera.heading)
    }
    private static func set(_ camera: MKMapCamera, on map: MKMapView) {
        UIView.performWithoutAnimation { map.setCamera(camera, animated: false) }
    }
    private struct Glide {
        let from: MKMapPoint
        let camera: MKMapCamera
        let started: CFTimeInterval
        let coordinate: CLLocationCoordinate2D
        let sheetHeight: CGFloat
        let topObstruction: CGFloat
    }
    // CADisplayLink retains its target; the weak proxy prevents a timer/owner retain cycle.
    private final class TickTarget: NSObject {
        weak var owner: MapSelectionFraming?
        init(owner: MapSelectionFraming) { self.owner = owner }
        @objc func tick(_ link: CADisplayLink) { owner?.tick(link) }
    }
}
