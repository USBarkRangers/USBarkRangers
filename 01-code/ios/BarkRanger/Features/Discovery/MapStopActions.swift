import BarkDomain

/// Builds the same trip command row for a catalog park or custom place. No editable state or side effects on render.
enum MapStopActions {
    static func action(
        for selection: ParkDetailModel.Selection, model: RouteDaySheetViewModel,
        openDay: @escaping () -> Void
    ) -> ParkTripAction? {
        guard model.canEdit else { return nil }
        let stop = selection.stop
        let aliases: Set<ParkID>
        if case .park(let park) = selection { aliases = Set(park.aliases) } else { aliases = [] }
        // Bookend replacement is explicit; it must remain usable for round-trip start/finish places.
        let bookendTitle: String?
        switch model.editor.insertion?.destination {
        case .start: bookendTitle = "Set Trip Start"
        case .end: bookendTitle = "Set Trip Finish"
        default: bookendTitle = nil
        }
        if let title = bookendTitle {
            return .add(title: title, disabled: model.isWorking) {
                model.add(stop.newOccurrence(), aliases: aliases)
            }
        }
        if let trip = model.draft?.trip,
            let member = TripStopPolicy.membership(
                of: stop, aliases: aliases, in: trip,
                preferredDayID: model.target?.dayID)
        {
            let source = trip.days[member.dayIndex]
            let target = TripDayID(tripID: trip.id, dayID: source.id)
            let ordinary: Bool
            if case .day = member.destination { ordinary = true } else { ordinary = false }
            return .member(
                day: member.dayIndex + 1, disabled: model.isWorking,
                previous: ordinary && member.dayIndex > 0
                    ? {
                        move(member, offset: -1, trip: trip, model: model)
                    } : nil,
                next: ordinary && (member.dayIndex + 1 < trip.days.count || trip.days.count < 50)
                    ? {
                        move(member, offset: 1, trip: trip, model: model)
                    } : nil,
                remove: {
                    let edit: TripDayEdit
                    switch member.destination {
                    case .day: edit = .remove(member.stopID)
                    case .start: edit = .clearBookend(start: true)
                    case .end: edit = .clearBookend(start: false)
                    }
                    model.editor.apply(edit, to: target, success: "")
                },
                edit: {
                    model.select(target)
                    model.position = .high
                    openDay()
                })
        }
        let title = model.target == nil ? "Add to Trip" : "Add to Day \((model.dayIndex ?? 0) + 1)"
        return .add(title: title, disabled: model.isWorking) { model.add(stop, aliases: aliases) }
    }
    private static func move(
        _ member: TripStopPolicy.Membership, offset: Int, trip: Trip,
        model: RouteDaySheetViewModel
    ) {
        guard model.draft?.id == trip.id else { return }
        let source = trip.days[member.dayIndex]
        let index = member.dayIndex + offset
        let edit: TripDayEdit
        let target: TripDayID
        if trip.days.indices.contains(index) {
            let destination = trip.days[index]
            target = TripDayID(tripID: trip.id, dayID: destination.id)
            edit = .move(
                stop: member.stopID, from: source.id, before: nil,
                sourceOrder: source.stops.map(\.id), destinationOrder: destination.stops.map(\.id))
        } else if index == trip.days.count {
            target = TripDayID(tripID: trip.id, dayID: source.id)
            edit = .moveToNewDay(stop: member.stopID, day: .init(), expectedOrder: source.stops.map(\.id))
        } else {
            return
        }
        model.editor.apply(edit, to: target, success: "")
    }
}
