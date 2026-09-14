import BarkDomain
import Foundation
import Observation

/// Day-sheet navigation and presentation. ActiveTripSession owns the shared draft, selection and route lifetime.
@MainActor @Observable final class RouteDaySheetViewModel {
    struct Context: Equatable {
        let tripID: String
        var dayID: String?
    }
    let account: AccountSession
    var routes: DayRouteService { activeTrip.routing.service }
    let activeTrip: ActiveTripSession
    private var displayedTripID: String? { activeTrip.tripID }
    var context: Context? {
        guard let displayedTripID, draft != nil else { return nil }
        return Context(
            tripID: displayedTripID,
            dayID: activeTrip.target?.dayID)
    }
    var position = MapSheetPosition.low
    let editor: RouteDayEditor
    private(set) var isOpening = false
    private(set) var openingFailure: String?
    var notice: String? { openingFailure ?? editor.notice }
    var isWorking: Bool { isOpening || editor.isWorking || activeTrip.isWorking }
    private var generation = UUID()
    private var opening: Task<Void, Never>?
    private let maps: MapsHandoff
    var target: TripDayID? {
        guard let context, let dayID = context.dayID else { return nil }
        return TripDayID(tripID: context.tripID, dayID: dayID)
    }
    var visibleRoutes: DayRouteService? { activeTrip.visibleRoutes }
    var draft: TripDraft? { activeTrip.draft }
    var day: Trip.Day? { draft?.trip.days.first { $0.id == target?.dayID } }
    var dayIndex: Int? { draft?.trip.days.firstIndex { $0.id == target?.dayID } }
    var premium: Bool { account.dataAccess.canEditAccount }
    var canEdit: Bool { account.dataAccess.canEditDrafts }
    var choices: [TripLibraryContent.Row] { account.nativeTrips?.library.rows ?? [] }
    init(
        activeTrip: ActiveTripSession, maps: MapsHandoff = MapsHandoff()
    ) {
        self.account = activeTrip.account
        self.maps = maps
        self.activeTrip = activeTrip
        editor = RouteDayEditor(account: activeTrip.account, activeTrip: activeTrip)
    }
    func start() { activeTrip.start() }
    func open(tripID: String?, dayID: String? = nil, completed: @escaping () -> Void = {}) {
        guard account.nativeTrips?.repository != nil else { return }
        cancelOpening()
        let generation = generation
        editor.invalidatePresentation()
        isOpening = true
        openingFailure = nil
        opening = Task {
            do {
                try Task.checkCancellation()
                try await self.activeTrip.selectTrip(id: tripID, dayID: dayID)
                try Task.checkCancellation()
                self.activeTrip.highlightDay()
                self.position = .low
                completed()
            } catch {
                if !Task.isCancelled {
                    self.openingFailure = "This trip could not be opened. Please try again."
                }
            }
            guard !Task.isCancelled, self.generation == generation else { return }
            self.opening = nil
            self.isOpening = false
        }
    }
    func select(_ target: TripDayID) {
        guard target.tripID == displayedTripID else { return }
        // Route taps change the day, not the user's chosen sheet height (including after closing it).
        selectDay(target.dayID)
    }
    func selectDay(_ id: String) {
        editor.invalidatePresentation()
        openingFailure = nil
        activeTrip.selectDay(id)
    }
    func moveDay(_ offset: Int) {
        guard let days = draft?.trip.days, let index = dayIndex, days.indices.contains(index + offset) else {
            return
        }
        selectDay(days[index + offset].id)
    }
    func addDay(after expectedDayID: String) {
        guard target?.dayID == expectedDayID else { return }
        edit(.appendDay(.init()))
    }
    func removeDay(expectedDayID: String) {
        guard target?.dayID == expectedDayID else { return }
        edit(.removeDay)
    }
    private func cancelOpening() {
        opening?.cancel()
        opening = nil
        isOpening = false
    }
    func close() {
        cancelOpening()
        editor.invalidatePresentation()
        activeTrip.closeDay()
        openingFailure = nil
    }
    func clearMap() {
        close()
        editor.clearTrip()
    }
    func dayIndex(containing park: Park) -> Int? { draft?.trip.dayIndex(containing: park) }
    func contains(_ park: Park) -> Bool { dayIndex(containing: park) == dayIndex && dayIndex != nil }
    func remove(_ park: Park, from target: TripDayID) {
        guard target.tripID == draft?.id else { return }
        editor.apply(.removePark(Set([park.id] + park.aliases)), to: target)
    }
    func beginAdding(after stopID: String? = nil) {
        guard let target, let scope = account.tripScope else { return }
        editor.prepareInsertion(
            StopSearchRequest(
                scope: scope, tripID: target.tripID,
                destination: .day(target.dayID), after: stopID))
        position = .low
    }
    func beginAdding(_ request: StopSearchRequest, completed: @escaping () -> Void) {
        guard request.scope == account.tripScope else { return }
        let day: String?
        if case .day(let id) = request.destination { day = id } else { day = nil }
        open(tripID: request.tripID, dayID: day) {
            self.editor.prepareInsertion(request)
            completed()
        }
    }
    func add(_ park: Park, completed: @escaping () -> Void) {
        add(.init(park: park), aliases: Set(park.aliases), completed: completed)
    }
    func add(_ stop: Trip.Stop, aliases: Set<ParkID> = [], completed: @escaping () -> Void = {}) {
        let tripID = activeTrip.tripID
        let destination = target.map { TripStopPolicy.Destination.day($0.dayID) }
        editor.add(stop, aliases: aliases, tripID: tripID, destination: destination) { _ in
            completed()
        }
    }
    func edit(_ change: TripDayEdit, success: String = "Day updated", completed: @escaping () -> Void = {}) {
        guard let target else { return }
        editor.apply(change, to: target, success: success, completed: completed)
    }
    func navigationParts(google: Bool) -> [MapsHandoff.RoutePart] {
        guard let day = activeTrip.plan?.days.first(where: { $0.id == target?.dayID }) else { return [] }
        return MapsHandoff.routeParts(day, google: google)
    }
    func navigateDay(google: Bool, part: Int) {
        guard premium, let day = activeTrip.plan?.days.first(where: { $0.id == target?.dayID }) else {
            return
        }
        editor.navigate(day, maps: maps, google: google, part: part)
    }
    func proposeOptimization() {
        guard premium, let target, let trip = draft?.trip else { return }
        editor.propose(trip: trip, target: target)
    }
    func applyOptimization() {
        guard let proposal = editor.optimization else { return }
        edit(.order(proposal.order, expected: proposal.expected))
    }
    func connectivityChanged(_ connected: Bool) { activeTrip.connectivityChanged(connected) }
    func stop() {
        generation = UUID()
        cancelOpening()
        editor.cancel()
    }
    func resetScope() {
        stop()
        openingFailure = nil
        activeTrip.resetScope()
    }
}
