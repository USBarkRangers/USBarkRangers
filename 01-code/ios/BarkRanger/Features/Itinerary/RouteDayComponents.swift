import BarkDomain
import SwiftUI

/// Shared stop and drive-leg presentation for Planner and Map.
struct StopTimelineRow: View {
    let stop: Trip.Stop
    let number: Int
    let detailed: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)").font(.caption.bold()).monospacedDigit()
                .frame(width: 28, height: 28).background(.tint.opacity(0.15), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(stop.name).font(.subheadline.weight(.semibold)).lineLimit(detailed ? nil : 2).fixedSize(
                    horizontal: false, vertical: true)
                let locality = [stop.city, stop.state]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
                if !locality.isEmpty { Text(locality).font(.caption).foregroundStyle(.secondary) }
                if let arrival = stop.arrivalTime, !arrival.isEmpty {
                    Label(arrival, systemImage: "clock").font(.caption)
                }
                if let minutes = stop.visitMinutes, minutes.isFinite, minutes > 0 {
                    Text("Visit · \(minutes.formatted(.number.precision(.fractionLength(0)))) min").font(
                        .caption
                    ).foregroundStyle(.secondary)
                }
                if detailed, !stop.notes.isEmpty {
                    Text(stop.notes).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

struct DriveSegmentRow: View {
    let segment: TripRoutePlan.Segment
    let leg: DayRouteService.Leg?
    let detailed: Bool
    let units: AppSettings.Units
    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(.quaternary).frame(width: 2).frame(maxWidth: 28).frame(
                height: detailed ? 42 : 30)
            VStack(alignment: .leading, spacing: 3) {
                if let leg {
                    Label(
                        "\(RouteDayFormat.duration(leg.seconds)) · \(RouteDayFormat.distance(leg.meters, units: units))",
                        systemImage: "car.fill")
                } else {
                    Label("Road route unavailable", systemImage: "car")
                }
                if detailed { Text("\(segment.from.name) → \(segment.to.name)").lineLimit(2) }
            }.font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
    }
}

enum RouteDayFormat {
    static func duration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0, seconds < Double(Int.max) / 2 else { return "—" }
        let minutes = Int((seconds / 60).rounded())
        return minutes >= 60 ? "\(minutes / 60) hr \(minutes % 60) min" : "\(minutes) min"
    }
    static func distance(_ meters: Double, units: AppSettings.Units) -> String {
        String(
            format: "%.1f %@", units == .miles ? meters / 1609.344 : meters / 1000,
            units == .miles ? "mi" : "km")
    }
}
