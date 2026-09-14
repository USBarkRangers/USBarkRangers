import BarkDomain
import SwiftUI

/// Shared navigation policy and chrome. Creating a day is possible only beyond the final day.
struct ItineraryDayHeader<Options: View>: View {
    let trip: Trip
    let day: Trip.Day
    let busy: Bool
    let dragging: Bool
    let select: (String) -> Void
    let addDay: (String) -> Void
    let removeDay: (String) -> Void
    var canEdit = true
    var close: (() -> Void)?
    @ViewBuilder let options: (_ requestRemoval: @escaping () -> Void) -> Options
    @State private var confirmation: DayConfirmation?
    private struct DayConfirmation {
        let dayID: String
        let adding: Bool
        var title: String { adding ? "Add a new day?" : "Remove this day and all of its stops?" }
    }

    private var index: Int { trip.days.firstIndex { $0.id == day.id } ?? 0 }
    private var isLast: Bool { index == trip.days.count - 1 }
    // Match the trailing controls on both sides so the title stays centered even with Map's close button.
    private var titleInset: CGFloat { 38 + (close != nil ? 38 : 0) }
    var body: some View {
        ZStack {
            HStack(spacing: 6) {
                Button {
                    select(trip.days[index - 1].id)
                } label: {
                    Image(systemName: "chevron.left").frame(width: 32, height: 44)
                }.disabled(busy || index == 0).accessibilityLabel("Previous day")
                Spacer(minLength: 0)
                Button {
                    if isLast {
                        confirmation = DayConfirmation(dayID: day.id, adding: true)
                    } else {
                        select(trip.days[index + 1].id)
                    }
                } label: {
                    Image(systemName: isLast ? "plus" : "chevron.right").frame(width: 32, height: 44)
                }
                .disabled(busy || (isLast && (!canEdit || dragging || trip.days.count >= 50)))
                .accessibilityLabel(isLast ? "Add day" : "Next day")
                if let close {
                    Button(action: close) {
                        Image(systemName: "xmark").font(.subheadline).frame(width: 32, height: 44)
                    }.accessibilityLabel("Close day")
                }
            }
            Menu {
                dayActions
            } label: {
                VStack(spacing: 3) {
                    HStack(spacing: 5) {
                        Text("Day \(index + 1)").font(.headline)
                        if canEdit {
                            Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(day.date ?? "Date not set")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(!canEdit)
            .accessibilityIdentifier("route-day-title")
            .accessibilityLabel("Day \(index + 1), \(day.date ?? "Date not set")")
            .accessibilityHint(canEdit ? "Opens day actions" : "")
            .padding(.horizontal, titleInset)
        }
        .alert(
            confirmation?.title ?? "",
            isPresented: Binding(
                get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }
            ), presenting: confirmation
        ) { request in
            Button("Cancel", role: .cancel) { confirmation = nil }
            Button(request.adding ? "Add Day" : "Remove Day", role: request.adding ? nil : .destructive) {
                // Clear before sending the intent; a second tap cannot replay a pending confirmation.
                confirmation = nil
                guard request.dayID == day.id else { return }
                if request.adding { addDay(request.dayID) } else { removeDay(request.dayID) }
            }
        }
        .onChange(of: day.id) { _, _ in confirmation = nil }
        .onChange(of: trip.id) { _, _ in confirmation = nil }
    }

    private var dayActions: some View {
        options { confirmation = DayConfirmation(dayID: day.id, adding: false) }
    }
}
