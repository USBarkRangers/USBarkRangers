import BarkDomain
import SwiftUI

/// Planner hosts the shared native itinerary. Day arrows remain outside the list during a held drag.
struct PlannerDayCard: View {
    let model: TripEditorModel
    let trip: Trip
    let units: AppSettings.Units
    @Binding var dragging: Bool
    var search: (StopSearchRequest) -> Void = { _ in }
    @State private var note: RouteNoteDraft?
    @State private var submission: Task<Void, Never>?
    @State private var submittedNote: String?
    @State private var noteError: String?
    var body: some View {
        if let day = model.activeDay, let index = model.dayIndex, let target = model.target {
            let bookends = TripRoutePlan.bookendDays(in: trip)
            let plan = model.plan?.days.first { $0.id == day.id }
            let legs = model.routes.tripID == trip.id ? model.routes.legs : [:]
            let color = Color(
                uiColor: (TripDayColor.assignments(for: trip.days)
                    .first { $0.dayID == day.id }?.color ?? TripDayColor.palette[0]).uiColor)
            VStack(alignment: .leading, spacing: 8) {
                ItineraryDayHeader(
                    trip: trip, day: day, busy: model.isWorking || model.checkpointConflict,
                    dragging: dragging,
                    select: { model.selectDay($0) }, addDay: { model.addDay(after: $0) },
                    removeDay: { model.removeDay(expectedDayID: $0) }, canEdit: model.canEdit
                ) { requestRemoval in
                    ItineraryDayMenu(
                        trip: trip, day: day, busy: model.isWorking || model.checkpointConflict,
                        premium: model.canUsePremium,
                        addStop: {
                            model.searchOnMap(destination: .day(day.id), open: search)
                        },
                        editNotes: { openNote(target: target, stop: nil, original: day.notes) },
                        setColor: { model.setColor($0) },
                        optimize: { model.proposeOptimization(partition: false) },
                        navigationParts: { model.navigationParts(google: $0) },
                        navigate: { model.navigateDay(google: $0, part: $1) },
                        removeDay: requestRemoval)
                }.tint(color)
                DayStatsRow(
                    day: day, plan: plan, legs: legs, units: units,
                    isLoading: model.routes.isLoading, dayUpdated: model.notice == "Day updated"
                )
                .task(id: model.notice == "Day updated" ? model.activeTrip.editRevision : nil) {
                    guard model.notice == "Day updated" else { return }
                    let revision = model.activeTrip.editRevision
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                    model.dismissDayUpdate(revision: revision)
                }
                .onDisappear {
                    model.dismissDayUpdate(revision: model.activeTrip.editRevision)
                }
                Divider().overlay(color.opacity(0.3))
                RouteDayTimeline(
                    target: target, scope: model.account.tripScope ?? "",
                    isWorking: model.isWorking || model.checkpointConflict,
                    legs: legs, commit: { model.editDay($0, target: target) },
                    day: day, plan: plan, detailed: true, units: units,
                    editNote: {
                        openNote(target: target, stop: $0.id, original: $0.notes)
                    },
                    addBelow: { model.searchOnMap(destination: .day(day.id), after: $0, open: search) },
                    scrolling: true, atTopChanged: { _ in },
                    start: index == bookends.start ? trip.start : nil,
                    finish: index == bookends.finish ? trip.end : nil,
                    emptyMessage: "Tap the day title to add a stop, or drop a stop here from another day.",
                    bottomInset: 12, dragChanged: { dragging = $0 },
                    header: AnyView(EmptyView()),
                    notes: AnyView(
                        Group {
                            if !day.notes.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Day Notes").font(.headline)
                                    Text(day.notes).font(.body)
                                }.accessibilityIdentifier("route-day-notes")
                            }
                        }), canEdit: model.canEdit, surfaceColor: .secondarySystemGroupedBackground
                )
            }
            .padding(.horizontal, 16).padding(.top, 10)
            .background(
                Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22)
            )
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(color.opacity(0.65), lineWidth: 1.5))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("planner-day-card")
            .sheet(item: $note) { draft in
                RouteNoteEditor(draft: draft, isSaving: submission != nil, message: noteError) { value in
                    guard model.target == draft.target, submission == nil else { return }
                    noteError = nil
                    // A failed disk checkpoint retains the edited buffer. Retry it without replaying the old note base.
                    if submittedNote == value && model.checkpointPending {
                        model.requestCheckpoint()
                    } else {
                        guard
                            model.editDay(draft.change(value, expected: submittedNote), target: draft.target)
                        else {
                            noteError = model.notice ?? "This note could not be saved. Review it and retry."
                            return
                        }
                        submittedNote = value
                    }
                    submission = Task {
                        let saved = await model.awaitCheckpoint()
                        guard !Task.isCancelled else { return }
                        if note?.id == draft.id {
                            if saved {
                                note = nil
                            } else {
                                noteError = model.notice ?? "This note could not be saved. Try again."
                            }
                        }
                        submission = nil
                    }
                }
            }
            .onChange(of: model.target) { _, _ in cancelForms() }
            .onChange(of: model.account.identity?.uid) { _, _ in cancelForms() }
            .onDisappear { cancelForms() }
        }
    }
    private func openNote(target: TripDayID, stop: String?, original: String) {
        submittedNote = nil
        noteError = nil
        note = RouteNoteDraft(target: target, stopID: stop, original: original)
    }
    private func cancelForms() {
        submission?.cancel()
        submission = nil
        note = nil
        submittedNote = nil
        noteError = nil
    }
}
