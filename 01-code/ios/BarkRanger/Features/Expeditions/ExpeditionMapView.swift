import BarkDomain
import MapKit
import SwiftUI

/// Immutable trail geometry and accepted recording segments only; does not own location or trip routes.
struct ExpeditionMapView: View {
    let model: ExpeditionModel
    private struct GeometryInput: Equatable {
        let uid: String?
        let trail: String?
        let fraction: Double
    }
    @State private var trail: [Coordinate] = []
    @State private var progress: Coordinate?
    @State private var error: String?
    private var segments: [[CLLocationCoordinate2D]] {
        Dictionary(grouping: model.recorder.points, by: \.segment).sorted { $0.key < $1.key }
            .map {
                $0.value.map {
                    CLLocationCoordinate2D(
                        latitude: $0.sample.coordinate.latitude, longitude: $0.sample.coordinate.longitude)
                }
            }
    }
    var body: some View {
        Map {
            if !trail.isEmpty {
                MapPolyline(
                    coordinates: trail.map {
                        CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                    }
                )
                .stroke(.orange, lineWidth: 5)
            }
            ForEach(Array(segments.enumerated()), id: \.offset) { _, points in
                MapPolyline(coordinates: points).stroke(.teal, lineWidth: 5)
            }
            if let progress {
                Annotation(
                    "Virtual progress",
                    coordinate: .init(latitude: progress.latitude, longitude: progress.longitude)
                ) {
                    Image(systemName: "pawprint.fill").padding(10).background(.regularMaterial, in: Circle())
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.expedition.name).font(.headline)
                Text(error ?? "Orange: virtual trail · Teal: your accepted GPS path. Gaps are not connected.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.regularMaterial)
        }
        .navigationTitle("Trail map").navigationBarTitleDisplayMode(.inline)
        .task(
            id: GeometryInput(
                uid: model.account.identity?.uid, trail: model.expedition.trailID,
                fraction: model.expedition.fraction)
        ) {
            guard let id = model.expedition.trailID else {
                trail = []
                progress = nil
                return
            }
            do {
                let geometry = try await model.geometry.geometry(id: id)
                let position = try await model.geometry.position(id: id, fraction: model.expedition.fraction)
                guard !Task.isCancelled else { return }
                trail = geometry
                progress = position
            } catch { self.error = "Trail geometry is unavailable; your recorded progress is retained." }
        }
    }
}
