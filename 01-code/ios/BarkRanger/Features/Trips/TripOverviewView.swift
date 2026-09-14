import BarkDomain
import SwiftUI

/// Read-only projection of the editor's current trip. Stable day/stop IDs leave room for future edit intents.
/// No route service, independent itinerary buffer, persistence or navigation owner lives here.
struct TripOverviewView: View {
    let trip: Trip

    var body: some View {
        let colors = TripDayColor.assignments(for: trip.days)
        let bookends = TripRoutePlan.bookendDays(in: trip)
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(Array(trip.days.enumerated()), id: \.element.id) { index, day in
                    TripOverviewDay(
                        day: day, number: index + 1, color: Color(uiColor: colors[index].color.uiColor),
                        start: index == bookends.start ? trip.start : nil,
                        finish: index == bookends.finish ? trip.end : nil)
                }
            }.padding(.bottom, 8)
        }.accessibilityIdentifier("trip-overview")
    }
}

/// One compact day owns its heading and location list; detailed itinerary rows remain in Planner.
private struct TripOverviewDay: View {
    let day: Trip.Day
    let number: Int
    let color: Color
    let start: Trip.Stop?
    let finish: Trip.Stop?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Day \(number)").font(.headline).foregroundStyle(color)
                Spacer()
                Text(day.date ?? "Date not set")
                    .font(.caption).foregroundStyle(.secondary)
            }.accessibilityAddTraits(.isHeader)
            if let start { Label("Start · \(start.name)", systemImage: "flag.fill").font(.subheadline) }
            if day.stops.isEmpty {
                Text("No locations yet").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(Array(day.stops.enumerated()), id: \.element.id) { index, stop in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)").font(.caption.bold()).monospacedDigit()
                        .frame(width: 24, height: 24)
                        .background(color.opacity(0.15), in: Circle())
                    Text(stop.name).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("trip-overview-stop-\(stop.id)")
            }
            if let finish {
                Label("Finish · \(finish.name)", systemImage: "flag.checkered").font(.subheadline)
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(color.opacity(0.65), lineWidth: 1.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trip-overview-day-\(day.id)")
    }
}
