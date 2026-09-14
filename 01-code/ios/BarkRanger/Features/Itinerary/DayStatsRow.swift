import BarkDomain
import SwiftUI

/// One stable summary row for both itinerary surfaces. Feedback never adds a row above the stops.
struct DayStatsRow: View {
    let day: Trip.Day
    let plan: TripRoutePlan.Day?
    let legs: [String: DayRouteService.Leg]
    let units: AppSettings.Units
    var isLoading = false
    var dayUpdated = false

    var body: some View {
        let segments = plan?.segments ?? []
        let known = segments.compactMap { legs[$0.geometryKey] }
        let complete = plan != nil && known.count == segments.count
        // Work for another day must not replace this day's completed driving total.
        let updating = isLoading && !complete
        HStack(spacing: 10) {
            Label(
                day.stops.count == 1 ? "1 stop" : "\(day.stops.count) stops",
                systemImage: "mappin.and.ellipse")
            ZStack {
                Label("Updating route…", systemImage: "car").hidden().accessibilityHidden(true)
                if updating {
                    HStack(spacing: 5) {
                        ProgressView().controlSize(.mini).accessibilityHidden(true)
                        Text("Updating route…")
                    }.accessibilityLabel("Updating road route")
                } else {
                    Label(
                        complete ? RouteDayFormat.duration(known.reduce(0) { $0 + $1.seconds }) : "—",
                        systemImage: "car")
                }
            }
            Text(
                complete
                    ? RouteDayFormat.distance(known.reduce(0) { $0 + $1.meters }, units: units)
                    : "— \(units == .miles ? "mi" : "km")"
            )
            .monospacedDigit()
            if dayUpdated {
                Text("Day updated")
                    .font(.caption2.weight(.medium)).foregroundStyle(.tint)
            }
        }
        .font(.caption.weight(.medium)).foregroundStyle(.secondary)
        .lineLimit(1).minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, alignment: .center)
        // Keep text, spinner and confirmation transitions from animating the surrounding layout.
        .transaction { $0.animation = nil }
        .accessibilityElement(children: .combine).accessibilityIdentifier("route-day-stats")
    }
}
