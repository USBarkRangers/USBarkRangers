import BarkDomain
import SwiftUI

enum ParkTripAction {
    case add(title: String, disabled: Bool, perform: () -> Void)
    case member(
        day: Int, disabled: Bool, previous: (() -> Void)?, next: (() -> Void)?, remove: () -> Void,
        edit: () -> Void)
}

/// Working park actions delegate one intent at a time; the horizontal row also fits the low sheet.
struct ParkDetailActions: View {
    let isOpeningMaps: Bool
    let directions: () -> Void
    var showInfo: (() -> Void)? = nil
    var adventure: ParkDetailModel? = nil
    var tripAction: ParkTripAction? = nil
    var savedPlaceAction: SavedPlaceButton? = nil
    @State private var confirmsRemoval = false
    @State private var removingVisit: NativeVisitWorkingState?
    @State private var reviewTask: Task<Void, Never>?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                if let savedPlaceAction { savedPlaceAction }
                if let tripAction {
                    switch tripAction {
                    case .add(let title, let disabled, let perform):
                        Button(action: perform) { Label(title, systemImage: "plus") }
                            .barkActionStyle(prominent: true).disabled(disabled)
                            .accessibilityIdentifier("add-to-route-day")
                    case .member(let day, let disabled, let previous, let next, let remove, let edit):
                        Menu {
                            Button("Edit Day \(day)", action: edit)
                            Button(day > 1 ? "Move to Day \(day - 1)" : "No previous day") { previous?() }
                                .disabled(previous == nil)
                            Button("Move to Day \(day + 1)") { next?() }.disabled(next == nil)
                            Button("Remove from Day \(day)", role: .destructive, action: remove)
                        } label: {
                            Label(
                                "Day \(day)", systemImage: "point.topleft.down.to.point.bottomright.curvepath"
                            )
                        }
                        .barkActionStyle().disabled(disabled)
                        .accessibilityIdentifier("park-trip-membership")
                    }
                }
                Button(action: directions) {
                    Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                }
                .barkActionStyle(prominent: true).disabled(isOpeningMaps)
                .accessibilityLabel("Directions in Apple Maps")
                if let showInfo {
                    Button(action: showInfo) { Label("Park Info", systemImage: "info.circle") }
                        .barkActionStyle().accessibilityHint("Expands the full park details")
                }
                if let adventure, adventure.supportsAdventures {
                    if adventure.canEditVisits {
                        Menu {
                            Button("Mark visited") { adventure.markVisit(usingLocation: false) }
                            Button("Check in with location") { adventure.markVisit(usingLocation: true) }
                            if adventure.isVisited {
                                Button("Remove visit", role: .destructive) {
                                    reviewTask?.cancel()
                                    reviewTask = Task {
                                        let selected = await adventure.reviewVisitRemoval()
                                        guard !Task.isCancelled else { return }
                                        removingVisit = selected
                                        confirmsRemoval = removingVisit != nil
                                    }
                                }
                            }
                        } label: {
                            Label(
                                adventure.isVisited ? "Visited" : "Record visit",
                                systemImage: adventure.isVisited ? "checkmark.circle" : "pawprint")
                        }
                        .barkActionStyle().disabled(adventure.isSavingVisit)
                        .confirmationDialog("Remove this saved visit?", isPresented: $confirmsRemoval) {
                            Button("Remove visit", role: .destructive) {
                                if let removingVisit { adventure.removeVisit(removingVisit) }
                                removingVisit = nil
                            }
                        }
                    }
                }
            }
            .controlSize(.large).buttonBorderShape(.capsule)
            .font(.subheadline.weight(.semibold)).fixedSize(horizontal: true, vertical: false)
        }
        .onChange(of: adventure?.visitScope) { _, _ in clearReview() }
        .onChange(of: adventure?.selection?.id) { _, _ in clearReview() }
        .onDisappear { clearReview() }
    }
    private func clearReview() {
        reviewTask?.cancel()
        reviewTask = nil
        removingVisit = nil
        confirmsRemoval = false
    }
}
