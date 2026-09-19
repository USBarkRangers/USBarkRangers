import BarkDomain
import MapKit
import Observation
import SwiftUI

/// A presentation-only input to MapKit. It has no account writes, recorder controls or trip selection.
@MainActor @Observable final class MapExpeditionOverlay: AccountScoped {
    private(set) var lines: [[Coordinate]] = []
    private(set) var revision = UUID()
    private(set) var framing: UUID?
    private(set) var visible = false
    private var trail: [Coordinate] = []
    private var walk: [[Coordinate]] = []
    func show(trail: [Coordinate]) {
        self.trail = trail
        visible = true
        framing = UUID()
        publish()
    }
    func updateWalk(_ points: [RecordedPoint]) async {
        let segments = await Self.segments(points)
        guard !Task.isCancelled else { return }
        walk = segments
        if visible { publish() }
    }
    func hide() {
        visible = false
        lines = []
        revision = UUID()
        framing = nil
    }
    func resetScope() { clear() }
    func clear() {
        trail = []
        walk = []
        hide()
    }
    private func publish() {
        lines = [trail] + walk
        revision = UUID()
    }
    @concurrent private static func segments(_ points: [RecordedPoint]) async -> [[Coordinate]] {
        Dictionary(grouping: points, by: \.segment).sorted { $0.key < $1.key }.map {
            $0.value.map(\.sample.coordinate)
        }
    }
}
private struct ExpeditionOverlayKey: EnvironmentKey { static let defaultValue: MapExpeditionOverlay? = nil }
extension EnvironmentValues {
    var expeditionOverlay: MapExpeditionOverlay? {
        get { self[ExpeditionOverlayKey.self] }
        set { self[ExpeditionOverlayKey.self] = newValue }
    }
}

/// Rebuilds only when the overlay revision changes. Sheet, camera and settings updates do no path processing.
@MainActor final class MapExpeditionRenderer {
    nonisolated private final class Line: MKPolyline { var isTrail = false }
    private var revision: UUID?
    private var framing: UUID?
    private var lines: [Line] = []
    func apply(_ value: MapExpeditionOverlay?, on map: MKMapView) {
        guard revision != value?.revision else { return }
        map.removeOverlays(lines)
        lines = []
        revision = value?.revision
        for (index, points) in (value?.lines ?? []).enumerated() where points.count > 1 {
            let coordinates = points.map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
            }
            let line = Line(coordinates: coordinates, count: coordinates.count)
            line.isTrail = index == 0
            lines.append(line)
        }
        map.addOverlays(lines, level: .aboveLabels)
        if let request = value?.framing, request != framing, let line = lines.first {
            framing = request
            map.setVisibleMapRect(
                line.boundingMapRect, edgePadding: UIEdgeInsets(top: 140, left: 50, bottom: 170, right: 50),
                animated: false)
        }
    }
    func renderer(_ overlay: any MKOverlay) -> MKOverlayRenderer? {
        guard let line = overlay as? Line else { return nil }
        let renderer = MKPolylineRenderer(polyline: line)
        renderer.strokeColor = line.isTrail ? .systemOrange : .systemTeal
        renderer.lineWidth = 5
        renderer.lineCap = .round
        return renderer
    }
}
