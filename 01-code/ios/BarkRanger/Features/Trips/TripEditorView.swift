import BarkDomain
import SwiftUI

/// Two presentations of one editing session. Map continues to own road-preview presentation.
struct TripEditorView: View {
    @Bindable var model: TripEditorModel
    let units: AppSettings.Units
    let previewDay: (TripDayID) -> Void
    let switchTrip: () -> Void
    var search: (StopSearchRequest) -> Void = { _ in }
    @State private var section = TripEditorHeader.Section.planner
    @State private var draggingStop = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let draft = model.draft {
                TripEditorHeader(
                    model: model, section: $section, draggingStop: draggingStop, switchTrip: switchTrip,
                    search: search)
                GeometryReader { geometry in
                    ZStack {
                        // Keep the Planner mounted so switching views retains its scrolling and planning inputs.
                        ScrollView {
                            VStack(spacing: 16) {
                                PlannerDayCard(
                                    model: model, trip: draft.trip, units: units, dragging: $draggingStop,
                                    search: search
                                )
                                .frame(height: max(360, geometry.size.height * 0.7))
                                if model.canEdit {
                                    TripPlanningCard(model: model) { model.previewOnMap(previewDay) }
                                }
                            }.padding(.bottom, 8)
                        }
                        .accessibilityIdentifier("planner-cards")
                        .opacity(section == .planner ? 1 : 0)
                        .allowsHitTesting(section == .planner)
                        .accessibilityHidden(section != .planner)
                        if section == .overview { TripOverviewView(trip: draft.trip) }
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 8)
        .background(Color(uiColor: .systemGroupedBackground))
    }
}
