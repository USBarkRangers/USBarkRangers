import BarkDomain
import SwiftUI

/// Shared SwiftUI row content inside a native list with session-based drag/drop across days.
/// Only the drop commits an order intent; road geometry and the durable itinerary are never edited here.
struct RouteDayTimeline: View {
    let target: TripDayID
    let scope: String
    let isWorking: Bool
    let legs: [String: DayRouteService.Leg]
    let commit: (TripDayEdit) -> Void
    let day: Trip.Day
    let plan: TripRoutePlan.Day?
    let detailed: Bool
    let units: AppSettings.Units
    let editNote: (Trip.Stop) -> Void
    let addBelow: (String) -> Void

    let scrolling: Bool
    let atTopChanged: (Bool) -> Void
    var resetsScroll = false
    var start: Trip.Stop? = nil
    var finish: Trip.Stop? = nil
    var emptyMessage = "Drop a stop here, or tap a park on the map to add it."
    let bottomInset: CGFloat
    let dragChanged: (Bool) -> Void
    let header: AnyView
    let notes: AnyView
    var canEdit = true
    var surfaceColor: UIColor = .systemBackground

    var body: some View {
        Group {
            let incoming = Dictionary(
                (plan?.segments ?? []).map { ($0.to.id, $0) },
                uniquingKeysWith: { first, _ in first })
            RouteStopList(
                destination: .init(
                    scope: scope, target: target,
                    stops: day.stops, enabled: canEdit && !isWorking),
                scrolling: scrolling, bottomInset: bottomInset,
                atTopChanged: atTopChanged, dragChanged: dragChanged,
                commit: commit,
                header: AnyView(
                    VStack(alignment: .leading, spacing: 12) {
                        header
                        if let start {
                            Label("Start · \(start.name)", systemImage: "flag.fill").font(.subheadline)
                        }
                        if day.stops.isEmpty {
                            Text(canEdit ? emptyMessage : "No stops in this day.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }),
                footer: AnyView(
                    VStack(alignment: .leading, spacing: 12) {
                        if let segment = plan?.segments.last,
                            !day.stops.contains(where: { $0.id == segment.to.id })
                        {
                            DriveSegmentRow(
                                segment: segment, leg: legs[segment.geometryKey], detailed: detailed,
                                units: units)
                            if finish == nil {
                                Label("Finish · \(segment.to.name)", systemImage: "flag.checkered").font(
                                    .subheadline)
                            }
                        }
                        if let finish {
                            Label("Finish · \(finish.name)", systemImage: "flag.checkered").font(.subheadline)
                        }
                        notes
                    }), contentReady: plan != nil, resetsScroll: resetsScroll, surfaceColor: surfaceColor,
                layoutKey: { stop, number in
                    let segment = incoming[stop.id]
                    let leg = segment.flatMap { legs[$0.geometryKey] }
                    return .init(
                        stop: stop, number: number, segment: segment, seconds: leg?.seconds,
                        meters: leg?.meters, detailed: detailed, units: units, canEdit: canEdit)
                }
            ) { stop, number, showsDriveLeg in
                AnyView(
                    VStack(alignment: .leading, spacing: 2) {
                        if let segment = incoming[stop.id] {
                            DriveSegmentRow(
                                segment: segment, leg: legs[segment.geometryKey], detailed: detailed,
                                units: units
                            )
                            // Retain the measured row footprint while UIKit previews an uncommitted order.
                            .opacity(showsDriveLeg ? 1 : 0).accessibilityHidden(!showsDriveLeg)
                        }
                        HStack(alignment: .top, spacing: 4) {
                            StopTimelineRow(stop: stop, number: number + 1, detailed: detailed)
                            if canEdit {
                                RouteStopMenu(
                                    isWorking: isWorking, remove: { commit(.remove(stop.id)) }, stop: stop,
                                    editNote: { editNote(stop) },
                                    addBelow: { addBelow(stop.id) })
                            }
                        }.padding(.vertical, 6)
                    }
                    .contentShape(Rectangle()).accessibilityElement(children: .contain)
                    .accessibilityIdentifier("route-stop-\(stop.id)")
                    .accessibilityActions {
                        if canEdit, !isWorking, number > 0 {
                            Button("Move earlier") { move(stop.id, offset: -1) }
                        }
                        if canEdit, !isWorking, number + 1 < day.stops.count {
                            Button("Move later") { move(stop.id, offset: 1) }
                        }
                    })
            }
            .frame(maxHeight: .infinity)
            .overlay(alignment: .bottom) {
                LinearGradient(
                    colors: [Color(uiColor: surfaceColor).opacity(0), Color(uiColor: surfaceColor)],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 16).allowsHitTesting(false).accessibilityHidden(true)
            }
        }
    }
    private func move(_ id: String, offset: Int) {
        let expected = day.stops.map(\.id)
        guard let index = expected.firstIndex(of: id), expected.indices.contains(index + offset) else {
            return
        }
        var order = expected
        order.swapAt(index, index + offset)
        commit(.order(order, expected: expected))
    }
}

private struct RouteStopMenu: View {
    let isWorking: Bool
    let remove: () -> Void
    let stop: Trip.Stop
    let editNote: () -> Void
    let addBelow: () -> Void
    @State private var confirmsRemoval = false
    var body: some View {
        Menu {
            Button(stop.notes.isEmpty ? "Add Note" : "Edit Note", action: editNote)
            Button("Add Stop Below", action: addBelow)
            Button("Remove Stop", role: .destructive) { confirmsRemoval = true }
        } label: {
            Image(systemName: "ellipsis").frame(width: 36, height: 44)
        }
        .accessibilityLabel("Options for \(stop.name)").disabled(isWorking)
        .confirmationDialog("Remove \(stop.name) from this day?", isPresented: $confirmsRemoval) {
            Button("Remove Stop", role: .destructive) { remove() }
        }
    }
}
