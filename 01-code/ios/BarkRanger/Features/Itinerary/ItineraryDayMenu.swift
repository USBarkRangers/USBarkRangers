import BarkDomain
import SwiftUI

/// The same six day intents in Planner and Map. Hosts supply edits; this view never saves or routes.
struct ItineraryDayMenu: View {
    let trip: Trip
    let day: Trip.Day
    let busy: Bool
    let premium: Bool
    let addStop: () -> Void
    let editNotes: () -> Void
    let setColor: (String) -> Void
    let optimize: () -> Void
    let navigationParts: (Bool) -> [MapsHandoff.RoutePart]
    let navigate: (Bool, Int) -> Void
    let removeDay: () -> Void

    var body: some View {
        Group {
            Button("Add Stop", action: addStop)
            Button(day.notes.isEmpty ? "Add Day Note" : "Edit Day Note", action: editNotes)
            colorPicker
            Button("Optimize Day", action: optimize).disabled(!premium || day.stops.count < 2)
            if !premium || (navigationParts(false).isEmpty && navigationParts(true).isEmpty) {
                Button("Open in Maps") { navigate(false, 0) }.disabled(true)
            } else {
                Menu("Open in Maps") {
                    navigationMenu(google: false)
                    navigationMenu(google: true)
                }
            }
            Button("Remove Day", role: .destructive, action: removeDay).disabled(trip.days.count <= 1)
        }.disabled(busy)
    }
    private var colorPicker: some View {
        let assignments = TripDayColor.assignments(for: trip.days)
        return Menu("Day Color") {
            Picker(
                "Day Color",
                selection: Binding(
                    get: {
                        assignments.first { $0.dayID == day.id }?.color.pickerColor.hex
                            ?? TripDayColor.palette[0].hex
                    },
                    set: { setColor($0) })
            ) {
                ForEach(TripDayColor.palette, id: \.hex) { color in
                    Label {
                        Text(color.name)
                    } icon: {
                        Image(uiImage: Self.swatch(for: color)).renderingMode(.original)
                    }.tag(color.hex)
                }
            }
        }
    }
    // Menu symbols otherwise inherit the current day's tint instead of each option's actual color.
    static func swatch(for color: TripDayColor) -> UIImage {
        UIImage(systemName: "circle.fill")?.withTintColor(color.uiColor, renderingMode: .alwaysOriginal)
            ?? UIImage()
    }
    private func navigationMenu(google: Bool) -> some View {
        Menu(google ? "Google Maps" : "Apple Maps") {
            ForEach(navigationParts(google)) { part in
                Button("Part \(part.id + 1): \(part.title)") { navigate(google, part.id) }
            }
        }.disabled(navigationParts(google).isEmpty)
    }
}
