import BarkDomain
import Foundation
import Observation

/// Itinerary intents and planning. The draft session checkpoints; pure rules edit; adapters navigate.
@MainActor @Observable final class TripEditorModel {
    let account: AccountSession
    let catalog: CatalogRepository
    var routes: DayRouteService { activeTrip.routing.service }
    let activeTrip: ActiveTripSession
    var plan: TripRoutePlan? { activeTrip.plan }
    private let maps: MapsHandoff
    private var actionNotice: String?
    var draft: TripDraft? { activeTrip.draft }
    private var proposedTrip: Trip?
    private var proposalBase: Trip?
    private(set) var proposal: Trip? {
        get { proposalBase == draft?.trip ? proposedTrip : nil }
        set {
            proposedTrip = newValue
            proposalBase = newValue == nil ? nil : draft?.trip
        }
    }
    private(set) var notice: String? {
        get { actionNotice ?? activeTrip.notice }
        set { actionNotice = newValue }
    }
    /// Dismiss only the displayed confirmation; an older UI timer cannot clear newer feedback.
    func dismissDayUpdate(revision: Int) {
        guard activeTrip.editRevision == revision, notice == "Day updated" else { return }
        activeTrip.dismissNotice(revision: revision)
        notice = nil
    }
    private(set) var saving = false
    var isWorking: Bool { saving || activeTrip.isWorking }
    var checkpointPending: Bool { activeTrip.checkpointPending }
    private var actionConflict = false
    var checkpointConflict: Bool { actionConflict || activeTrip.checkpointConflict }
    var checkpointNeedsRetry: Bool { activeTrip.checkpointNeedsRetry }
    private struct Target {
        let uid: String?
        let generation: UUID
        let presentation: UUID
        let tripID: String?
        let revision: Int
    }
    private var presentation = UUID()
    private var actionID = UUID()
    private var action: Task<Void, Never>?
    private var generation = UUID()
    var canUsePremium: Bool { account.dataAccess.canEditAccount }
    var canEdit: Bool { account.dataAccess.canEditDrafts }
    var activeDay: Trip.Day? {
        draft?.trip.days.first { $0.id == draft?.activeDayID } ?? draft?.trip.days.first
    }
    var library: TripLibraryContent { account.nativeTrips?.library ?? TripLibraryContent() }
    var conflicts: [String] { account.nativeTrips?.conflicts ?? [] }
    init(
        activeTrip: ActiveTripSession, catalog: CatalogRepository, maps: MapsHandoff
    ) {
        self.account = activeTrip.account
        self.catalog = catalog
        self.maps = maps
        self.activeTrip = activeTrip
    }
    var canChangeTrip: Bool {
        account.nativeTrips?.repository != nil && !checkpointPending && !checkpointConflict && !saving
            && !activeTrip.isWorking
    }
    var availableTripID: String? {
        account.nativeTrips?.selectedID ?? library.rows.first?.id
    }
    @discardableResult func newTrip() -> Bool {
        guard canEdit else {
            notice = AccountDataAccess.readOnlyMessage
            return false
        }
        return selectDraft(TripDraft(trip: Trip(), nativeBase: .init()))
    }
    @discardableResult func selectDraft(_ draft: TripDraft) -> Bool {
        guard canChangeTrip else { return false }
        guard
            canEdit || draft == activeTrip.draft
        else {
            notice = AccountDataAccess.readOnlyMessage
            return false
        }
        guard open(draft) else { return false }
        requestCheckpoint()
        return true
    }
    func duplicateTrip() {
        guard canEdit, canChangeTrip, let draft else { return }
        var copy = TripDraft(trip: draft.trip.duplicate(), nativeBase: .init())
        copy.activeDayID = draft.activeDayID
        selectDraft(copy)
    }
    func resumeActive() async {
        guard !saving else { return }
        let previous = draft?.id
        await activeTrip.resume()
        if previous != draft?.id { proposal = nil }
    }
    @discardableResult func open(_ draft: TripDraft) -> Bool {
        guard !checkpointPending, !activeTrip.isWorking else {
            notice = "Wait for the current draft to finish saving."
            return false
        }
        presentation = UUID()
        actionConflict = false
        cancelAction()
        proposal = nil
        activeTrip.open(draft, replacing: library.drafts.contains { $0.id == draft.id } ? draft : nil)
        return true
    }
    func reloadCheckpoint() {
        activeTrip.reloadCheckpoint()
        actionConflict = false
        notice = nil
    }
    func selectTrip(_ id: String, completed: @escaping () -> Void = {}) {
        guard canChangeTrip else { return }
        run { _ in
            try await self.activeTrip.selectTrip(id: id, dayID: nil)
            self.proposal = nil
            completed()
        }
    }
    func rename(_ name: String) { edit { $0.trip.name = name } }
    func selectDay(_ id: String) {
        guard !saving else { return }
        if activeTrip.selectDay(id) { proposal = nil }
    }
    func setColor(_ color: String) {
        guard let target else { return }
        editDay(.color(color), target: target)
    }
    func addDay(after expectedDayID: String? = nil) {
        guard let target, expectedDayID == nil || target.dayID == expectedDayID else { return }
        editDay(.appendDay(.init()), target: target)
    }
    func removeDay(expectedDayID: String? = nil) {
        guard let target, expectedDayID == nil || target.dayID == expectedDayID else { return }
        editDay(.removeDay, target: target)
    }
    var target: TripDayID? {
        guard let draft, let day = activeDay else { return nil }
        return TripDayID(tripID: draft.id, dayID: day.id)
    }
    var dayIndex: Int? { draft?.trip.days.firstIndex { $0.id == activeDay?.id } }
    func stepDay(_ offset: Int) {
        guard let days = draft?.trip.days, let index = dayIndex, days.indices.contains(index + offset) else {
            return
        }
        selectDay(days[index + offset].id)
    }
    @discardableResult func addStop(
        _ stop: Trip.Stop, aliases: Set<ParkID> = [],
        destination: TripStopPolicy.Destination? = nil, after: String? = nil
    ) -> Bool {
        guard let day = activeDay else { return false }
        return edit(success: "Day updated") {
            $0.trip = try TripStopPolicy.adding(
                stop, aliases: aliases, to: $0.trip,
                destination: destination ?? .day(day.id), after: after)
        }
    }
    func clearBookend(_ start: Bool) { edit { if start { $0.trip.start = nil } else { $0.trip.end = nil } } }
    @discardableResult func editDay(_ change: TripDayEdit, target: TripDayID) -> Bool {
        guard target == self.target else { return false }
        return edit(success: "Day updated") {
            $0 = try change.applying(to: $0, target: target)
        }
    }
    /// Used by temporary forms: do not dismiss a rejected or unsaved edit, or a newer presentation.
    func awaitCheckpoint() async -> Bool {
        let target = currentTarget
        await activeTrip.waitForCheckpoint()
        return !Task.isCancelled && matches(target) && !checkpointPending && !checkpointConflict
    }
    func proposeOptimization(partition: Bool, hours: Double = 4, visitMinutes: Double = 30) {
        guard canUsePremium, let trip = draft?.trip else {
            notice = "Premium is required for optimization."
            return
        }
        let dayID = activeDay?.id
        run { target in
            let result = try await Self.optimize(
                trip, dayID: dayID, partition: partition, hours: hours, visitMinutes: visitMinutes)
            try Task.checkCancellation()
            guard self.matches(target), self.draft?.trip == trip else { return }
            self.proposal = result
            self.notice = "Suggested itinerary ready in Plan trip."
        }
    }
    @concurrent private static func optimize(
        _ trip: Trip, dayID: String?, partition: Bool, hours: Double, visitMinutes: Double
    ) async throws -> Trip {
        try partition
            ? TripOptimizer.partition(trip, hoursPerDay: hours, visitMinutes: visitMinutes)
            : TripOptimizer.optimize(trip, dayID: dayID)
    }
    func acceptOptimization() {
        guard let proposal else { return }
        edit { $0.trip = proposal }
        self.proposal = nil
    }
    func discardOptimization() { proposal = nil }
    func previewOnMap(_ open: @escaping (TripDayID) -> Void) {
        guard canUsePremium, let target else { return }
        afterCheckpoint { open(target) }
    }
    func searchOnMap(
        destination: TripStopPolicy.Destination, after: String? = nil,
        open: @escaping (StopSearchRequest) -> Void
    ) {
        guard canEdit, let draft, let scope = account.tripScope else { return }
        let request = StopSearchRequest(
            scope: scope, tripID: draft.id, destination: destination, after: after)
        afterCheckpoint { open(request) }
    }
    /// Both Map entry points require the exact accepted checkpoint, never a copied editable buffer.
    private func afterCheckpoint(_ open: @escaping () -> Void) {
        guard let repository = account.nativeTrips?.repository, let buffer = draft else { return }
        run { target in
            await self.activeTrip.waitForCheckpoint()
            try Task.checkCancellation()
            guard self.matches(target), !self.checkpointPending, !self.checkpointConflict else { return }
            let stored = try await repository.currentDraft(id: buffer.id)
            try Task.checkCancellation()
            guard self.matches(target) else { return }
            guard stored?.trip == buffer.trip, stored?.activeDayID == buffer.activeDayID else {
                throw TripDayEdit.Failure.changedDay
            }
            open()
        }
    }
    func navigateDay(google: Bool = false, part: Int = 0) {
        guard canUsePremium, let day = plan?.days.first(where: { $0.id == activeDay?.id })
        else {
            notice = "Premium is required for itinerary navigation."
            return
        }
        run { _ in
            if !(await self.maps.openDay(day, google: google, part: part)) {
                throw MapsHandoff.Failure.unavailable
            }
        }
    }
    func navigationParts(google: Bool) -> [MapsHandoff.RoutePart] {
        guard let day = plan?.days.first(where: { $0.id == activeDay?.id })
        else { return [] }
        return MapsHandoff.routeParts(day, google: google)
    }
    func save() {
        guard canUsePremium, draft != nil else {
            notice = "Sign in with Premium to save trips to your account."
            return
        }
        run { _ in
            await self.useCurrentParkIDs()
            try await self.activeTrip.saveDraftToAccount()
        }
    }
    /// A trip made before a catalog correction still names the park's old ID, which the account
    /// refuses. Runs inside the save action, so no other editor change interleaves with it.
    private func useCurrentParkIDs() async {
        guard let parks = await catalog.current().snapshot?.parks, var next = draft else { return }
        let current = Dictionary(
            parks.flatMap { park in park.aliases.map { ($0, park.id) } },
            uniquingKeysWith: { first, _ in first })
        next.trip = next.trip.usingCurrentParkIDs(current)
        if next != draft { activeTrip.replace(next, success: nil) }
    }
    /// Clears shared presentation only. Trips remain in the switcher, including for free accounts.
    func clearTrip() {
        guard draft != nil else { return }
        run { _ in
            try await self.activeTrip.clear()
            self.proposal = nil
        }
    }
    /// Permanent removal is exposed only through a confirmed swipe in the trip switcher.
    func reviewDeletion(_ id: String) async -> NativeTripRepository.DeletionSelection? {
        guard canChangeTrip, let repository = account.nativeTrips?.repository else { return nil }
        let scope = account.tripScope
        let row = library.rows.first { $0.id == id }
        do {
            let draft = try await repository.currentDraft(id: id)
            guard !Task.isCancelled, scope == account.tripScope else { return nil }
            if let draft { return .draft(draft) }
            if let revision = row?.contentRevision { return .saved(id: id, contentRevision: revision) }
        } catch { notice = "This trip could not be reviewed for removal. Try again." }
        return nil
    }
    func discardTrip(_ selection: NativeTripRepository.DeletionSelection) {
        guard canEdit, canChangeTrip else { return }
        run { _ in
            try await self.activeTrip.deleteTrip(selection)
            self.proposal = nil
        }
    }
    func resolve(_ review: NativeTripRepository.ConflictReview, keepLocal: Bool) {
        guard !keepLocal || canUsePremium else { return }
        run { _ in try await self.activeTrip.resolveConflict(review, keepLocal: keepLocal) }
    }
    @discardableResult private func edit(
        success: String? = nil, _ change: (inout TripDraft) throws -> Void
    ) -> Bool {
        guard var next = draft, !saving, !checkpointConflict, !activeTrip.isWorking else { return false }
        do {
            try change(&next)
            try next.trip.validate(allowEmptyName: true)
        } catch {
            notice =
                error is TripDayEdit.Failure
                ? "This stop is already in the trip, or the day changed. Review the itinerary."
                : "Trips allow 50 days, 500 stops and 1,000 characters of notes per day or stop."
            return false
        }
        guard next != draft else { return true }
        guard canEdit || next.trip == draft?.trip else {
            notice = AccountDataAccess.readOnlyMessage
            return false
        }
        proposal = nil
        activeTrip.replace(next, success: success)
        return true
    }
    func requestCheckpoint() { activeTrip.requestCheckpoint() }
    private var currentTarget: Target {
        Target(
            uid: account.identity?.uid, generation: generation, presentation: presentation,
            tripID: draft?.id, revision: activeTrip.editRevision)
    }
    private func matches(_ target: Target) -> Bool {
        target.uid == account.identity?.uid && target.generation == generation
            && target.presentation == presentation && target.tripID == draft?.id
            && target.revision == activeTrip.editRevision
    }
    private func run(_ work: @escaping @MainActor (Target) async throws -> Void) {
        guard action == nil, !activeTrip.isWorking else { return }
        let target = currentTarget
        let id = UUID()
        actionID = id
        saving = true
        notice = nil
        action = Task {
            defer {
                if self.actionID == id {
                    saving = false
                    action = nil
                }
            }
            do {
                try Task.checkCancellation()
                guard matches(target) else { return }
                try await work(target)
            } catch {
                if !Task.isCancelled, matches(target) {
                    actionConflict = error is TripDayEdit.Failure
                    notice =
                        checkpointConflict
                        ? "This draft changed on the map. Load the latest draft before continuing."
                        : "The trip action could not complete. Your draft is retained; check your access or try again."
                }
            }
        }
    }
    private func cancelAction() {
        actionID = UUID()
        action?.cancel()
        action = nil
        saving = false
    }
    func resetScope() {
        generation = UUID()
        actionConflict = false
        presentation = UUID()
        cancelAction()
        proposal = nil
        notice = nil
        saving = false
    }
}
