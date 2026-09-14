import BarkDomain
import SwiftUI

/// One day, one timeline, three presentation heights. No map or road SDK work is performed here.
struct RouteDaySheet: View {
    @Bindable var model: RouteDaySheetViewModel
    let layout: MapSheetLayout
    let units: AppSettings.Units
    let addStop: () -> Void
    let heightChanged: (CGFloat) -> Void
    @State private var notes: RouteNoteDraft?
    @State private var draggingStop = false
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        MapBottomSheet(
            position: $model.position, layout: layout, label: "Route day size",
            identifier: "route-day-handle", heightChanged: heightChanged, draggingEnabled: !draggingStop
        ) { presentation in
            if let day = model.day, let index = model.dayIndex, let target = model.target,
                let trip = model.draft?.trip
            {
                let bookends = TripRoutePlan.bookendDays(in: trip)
                VStack(alignment: .leading, spacing: 10) {
                    header(day)
                    DayStatsRow(
                        day: day, plan: plan, legs: model.routes.legs, units: units,
                        isLoading: model.routes.isLoading, dayUpdated: model.notice == "Day updated"
                    )
                    .onTapGesture {
                        if model.position == .low { presentation.move(.medium) }
                    }
                    RouteDayTimeline(
                        target: target,
                        scope: model.account.tripScope ?? "", isWorking: model.isWorking,
                        legs: model.routes.legs, commit: { model.edit($0) },
                        day: day, plan: plan, detailed: presentation.position == .high,
                        units: units,
                        editNote: { stop in
                            openNote(stopID: stop.id, text: stop.notes)
                        },
                        addBelow: { stopID in
                            model.beginAdding(after: stopID)
                            addStop()
                        }, scrolling: presentation.allowsScrolling, atTopChanged: presentation.atTopChanged,
                        resetsScroll: model.position != .high,
                        start: index == bookends.start ? trip.start : nil,
                        finish: index == bookends.finish ? trip.end : nil,
                        bottomInset: (presentation.position == .high ? 0 : layout.bottomOverlap) + 24,
                        dragChanged: { draggingStop = $0 },
                        header: AnyView(
                            VStack(alignment: .leading, spacing: 12) {
                                if let notice = model.notice, notice != "Day updated" {
                                    Text(notice).font(.footnote).foregroundStyle(.tint)
                                }
                                routeStatus
                                RouteDayControls(model: model)
                            }),
                        notes: AnyView(
                            Group {
                                if presentation.position == .high, !day.notes.isEmpty {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("Day Notes").font(.headline)
                                        Text(day.notes).font(.body)
                                    }.accessibilityIdentifier("route-day-notes")
                                }
                            }), canEdit: model.canEdit
                    )
                    .opacity(presentation.expansion)
                    .accessibilityHidden(presentation.expansion < 0.1)
                    .allowsHitTesting(presentation.expansion >= 0.1)
                    .onChange(of: model.target) { _, _ in notes = nil }

                }
                .padding(.horizontal, 20)
                .accessibilityElement(children: .contain).accessibilityIdentifier("route-day-sheet")
            }
        }
        .sheet(item: $notes) { edit in
            RouteNoteEditor(draft: edit, isSaving: model.editor.isWorking, message: model.editor.notice) {
                value in
                guard model.target == edit.target else { return }
                model.edit(edit.change(value)) { notes = nil }
            }
        }
        .onAppear { if textSize.isAccessibilitySize { model.position = .high } }
    }
    private var plan: TripRoutePlan.Day? {
        model.activeTrip.plan?.days.first { $0.id == model.target?.dayID }
    }
    @ViewBuilder private func header(_ day: Trip.Day) -> some View {
        if let trip = model.draft?.trip {
            ItineraryDayHeader(
                trip: trip, day: day, busy: model.isWorking || model.activeTrip.checkpointConflict,
                dragging: draggingStop,
                select: { model.selectDay($0) }, addDay: { model.addDay(after: $0) },
                removeDay: { model.removeDay(expectedDayID: $0) },
                canEdit: model.canEdit,
                close: model.close
            ) { requestRemoval in
                ItineraryDayMenu(
                    trip: trip, day: day, busy: model.isWorking || model.activeTrip.checkpointConflict,
                    premium: model.premium,
                    addStop: {
                        model.beginAdding()
                        addStop()
                    },
                    editNotes: { openNote(stopID: nil, text: day.notes) },
                    setColor: { model.edit(.color($0)) },
                    optimize: {
                        model.position = .high
                        model.proposeOptimization()
                    },
                    navigationParts: { model.navigationParts(google: $0) },
                    navigate: { model.navigateDay(google: $0, part: $1) },
                    removeDay: requestRemoval)
            }.tint(
                Color(
                    uiColor: (TripDayColor.assignments(for: trip.days)
                        .first { $0.dayID == day.id }?.color ?? TripDayColor.palette[0]).uiColor))
        }
    }
    @ViewBuilder private var routeStatus: some View {
        if !model.premium {
            Text("Your day is saved locally. Premium enables road routes and account saving.").font(.footnote)
                .foregroundStyle(.secondary)
        } else if !model.routes.isLoading, let plan,
            plan.segments.contains(where: { model.routes.leg($0) == nil })
        {
            Text("Some road routes are unavailable. Connect and retry to update driving totals.").font(
                .footnote
            ).foregroundStyle(.secondary)
        }
    }
    private func openNote(stopID: String?, text: String) {
        guard let target = model.target else { return }
        model.editor.dismissNotice()
        notes = RouteNoteDraft(target: target, stopID: stopID, original: text)
    }
}
