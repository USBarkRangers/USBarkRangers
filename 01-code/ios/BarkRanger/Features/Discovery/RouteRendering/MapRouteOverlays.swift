import BarkDomain
import MapKit

/// Native overlay identity belongs to a trip/day/leg, never to its screen position or day number.
nonisolated final class DayRoutePolyline: MKPolyline {
    fileprivate(set) var owner: TripDayID?
    fileprivate(set) var isCasing = false
    fileprivate(set) var routeColor = TripDayColor.palette[0].uiColor
}

/// Geometry reconciliation, emphasis and screen-tolerant hit testing. No storage, routing or camera writes.
final class MapRouteOverlays {
    private struct Entry {
        let key: String
        let overlay: DayRoutePolyline
        let casing: DayRoutePolyline
    }
    private var entries: [String: Entry] = [:]
    private var renderers: [ObjectIdentifier: MKPolylineRenderer] = [:]
    private var version: UInt64?
    private var source: ObjectIdentifier?
    private var selection: TripDayID?
    var overlays: [DayRoutePolyline] {
        let lines = entries.values.map(\.overlay)
        return entries.values.map(\.casing) + lines.filter { $0.owner != selection }
            + lines.filter { $0.owner == selection }
    }

    func apply(_ routes: DayRouteService?, selection: TripDayID?, to map: MKMapView) {
        let nextSource = routes.map(ObjectIdentifier.init)
        let geometryChanged = source != nextSource || version != routes?.geometryVersion
        // Delegate requests during attachment must see the new selection, not the previous one.
        let selectionChanged = self.selection != selection
        self.selection = selection
        if geometryChanged {
            source = nextSource
            version = routes?.geometryVersion
            reconcile(routes, on: map)
        } else if selectionChanged {
            updateStyles()
        }
        if geometryChanged || selectionChanged { raiseSelection(in: map) }
    }
    /// Called after the model handles a completed tap, without waiting for a SwiftUI layout pass.
    func updateSelection(_ selection: TripDayID?, on map: MKMapView) {
        guard self.selection != selection else { return }
        self.selection = selection
        updateStyles()
        raiseSelection(in: map)
    }
    private func raiseSelection(in map: MKMapView) {
        guard let selection else { return }
        var lines = map.overlays.compactMap { $0 as? DayRoutePolyline }.filter { !$0.isCasing }
        let ordered = lines.filter { $0.owner != selection } + lines.filter { $0.owner == selection }
        for index in lines.indices where lines[index] !== ordered[index] {
            guard let other = lines[index...].firstIndex(where: { $0 === ordered[index] }) else { continue }
            map.exchangeOverlay(lines[index], with: lines[other])
            lines.swapAt(index, other)
        }
    }
    private func updateStyles() {
        for overlay in overlays { style(renderer(for: overlay), overlay: overlay) }
    }
    private func reconcile(_ routes: DayRouteService?, on map: MKMapView) {
        var next: [String: Entry] = [:]
        if let routes, let tripID = routes.tripID {
            for day in routes.days {
                for segment in day.segments {
                    guard let leg = routes.leg(segment) else { continue }
                    let id = "\(tripID):\(segment.id)"
                    let overlay: DayRoutePolyline
                    let casing: DayRoutePolyline
                    if let old = entries[id], old.key == segment.geometryKey {
                        overlay = old.overlay
                        casing = old.casing
                    } else {
                        overlay = DayRoutePolyline(
                            points: leg.polyline.points(), count: leg.polyline.pointCount)
                        overlay.owner = TripDayID(tripID: tripID, dayID: day.id)
                        casing = DayRoutePolyline(
                            points: leg.polyline.points(), count: leg.polyline.pointCount)
                        casing.owner = overlay.owner
                        casing.isCasing = true
                    }
                    overlay.routeColor = (TripDayColor.matching(day.color) ?? TripDayColor.palette[0]).uiColor
                    next[id] = Entry(key: segment.geometryKey, overlay: overlay, casing: casing)
                }
            }
        }
        let removed = entries.filter { next[$0.key]?.overlay !== $0.value.overlay }
            .flatMap { [$0.value.casing, $0.value.overlay] }
        let changed = next.filter { entries[$0.key]?.overlay !== $0.value.overlay }.map(\.value)
        entries = next
        let currentIDs = Set(overlays.map(ObjectIdentifier.init))
        renderers = renderers.filter { currentIDs.contains($0.key) }
        // Keep both native renderers owned here, including while MapKit has no materialized lookup.
        updateStyles()
        if !removed.isEmpty { map.removeOverlays(removed) }
        if !changed.isEmpty {
            let firstLine = map.overlays.first { ($0 as? DayRoutePolyline)?.isCasing == false }
            if let firstLine {
                for entry in changed {
                    map.insertOverlay(entry.casing, below: firstLine)
                }
                map.addOverlays(changed.map(\.overlay), level: .aboveLabels)
            } else {
                // A newly mounted map receives the complete saved route in one MapKit
                // transaction. Avoid visibly attaching one segment at a time on relaunch.
                map.addOverlays(
                    changed.map(\.casing) + changed.map(\.overlay), level: .aboveLabels)
            }
        }
    }
    func renderer(for overlay: DayRoutePolyline) -> MKPolylineRenderer {
        let id = ObjectIdentifier(overlay)
        if let renderer = renderers[id] { return renderer }
        let renderer = MKPolylineRenderer(polyline: overlay)
        renderer.lineCap = .round
        renderer.lineJoin = .round
        style(renderer, overlay: overlay)
        renderers[id] = renderer
        return renderer
    }
    private func style(_ renderer: MKPolylineRenderer, overlay: DayRoutePolyline) {
        let selected = selection != nil && overlay.owner == selection
        let emphasized = selection == nil || selected
        let opacity: CGFloat = overlay.isCasing ? (selected ? 1 : 0) : (emphasized ? 1 : 0.55)
        let color = (overlay.isCasing ? UIColor.white : overlay.routeColor)
            .withAlphaComponent(opacity)
        let width: CGFloat = (selected ? 9 : 6) + (overlay.isCasing ? 3 : 0)
        guard renderer.strokeColor != color || renderer.lineWidth != width else { return }
        renderer.strokeColor = color
        renderer.lineWidth = width
        // Standard MapKit vector rendering updates emphasis without custom bitmap draw work.
    }
    func target(at point: CGPoint, in map: MKMapView) -> TripDayID? {
        guard map.bounds.width > 0 else { return nil }
        let location = MKMapPoint(map.convert(point, toCoordinateFrom: map))
        let tolerance = map.visibleMapRect.width / map.bounds.width * 16
        var closest = tolerance * tolerance
        var target: TripDayID?
        for entry in entries.values {
            let overlay = entry.overlay
            guard overlay.boundingMapRect.insetBy(dx: -tolerance, dy: -tolerance).contains(location),
                overlay.pointCount > 1
            else { continue }
            let points = overlay.points()
            for index in 1..<overlay.pointCount {
                let distance = Self.squaredDistance(location, from: points[index - 1], to: points[index])
                if distance < closest || (abs(distance - closest) < 0.01 && overlay.owner == selection) {
                    closest = distance
                    target = overlay.owner
                }
            }
        }
        return target
    }
    static func squaredDistance(_ point: MKMapPoint, from a: MKMapPoint, to b: MKMapPoint) -> Double {
        let dx = b.x - a.x
        let dy = b.y - a.y
        let denominator = dx * dx + dy * dy
        let t =
            denominator == 0 ? 0 : max(0, min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator))
        let x = point.x - a.x - t * dx
        let y = point.y - a.y - t * dy
        return x * x + y * y
    }
}
