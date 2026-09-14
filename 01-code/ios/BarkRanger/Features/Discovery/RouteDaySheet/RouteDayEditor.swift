import BarkDomain
import Foundation
import Observation

/// Executes day-edit intents against the shared draft. Selection and road calculation live elsewhere.
@MainActor @Observable final class RouteDayEditor {
    struct Optimization {
        let expected: [String]
        let order: [String]
    }
    private(set) var notice: String?
    private(set) var isWorking = false
    private var proposedOrder: Optimization?
    private var proposalTarget: TripDayID?
    private var proposalBase: Trip?
    private(set) var optimization: Optimization? {
        get {
            proposalTarget == activeTrip.target && proposalBase == activeTrip.draft?.trip
                ? proposedOrder : nil
        }
        set {
            proposedOrder = newValue
            proposalTarget = newValue == nil ? nil : activeTrip.target
            proposalBase = newValue == nil ? nil : activeTrip.draft?.trip
        }
    }
    private(set) var insertion: StopSearchRequest?
    private let account: AccountSession
    private let activeTrip: ActiveTripSession
    private var revision = UUID()
    private var generation = UUID()
    private var action: Task<Void, Never>?
    private var noticeExpiry: Task<Void, Never>?

    init(account: AccountSession, activeTrip: ActiveTripSession) {
        self.account = account
        self.activeTrip = activeTrip
    }

    func prepareInsertion(_ request: StopSearchRequest) { insertion = request }
    func cancelInsertion() { insertion = nil }
    func add(
        _ stop: Trip.Stop, aliases: Set<ParkID>, tripID: String?,
        destination: TripStopPolicy.Destination?, completed: @escaping (String) -> Void
    ) {
        guard account.dataAccess.canEditDrafts else { return }
        let request = insertion
        let revision = revision
        let scope = account.tripScope
        perform {
            if let request, request.scope != scope { throw AccountFailure.accountChanged }
            try await self.activeTrip.addStop(stop, aliases: aliases,
                expectedTripID: request?.tripID ?? tripID,
                destination: request?.destination ?? destination, after: request?.after)
            try Task.checkCancellation()
            guard self.revision == revision, self.account.tripScope == scope else { return }
            self.insertion = nil
            if let id = self.activeTrip.tripID { completed(id) }
        }
    }
    func apply(
        _ change: TripDayEdit, to target: TripDayID, success: String = "Day updated",
        completed: @escaping () -> Void = {}
    ) {
        guard account.dataAccess.canEditDrafts else {
            notice = AccountDataAccess.readOnlyMessage
            return
        }
        let revision = revision
        perform {
            try await self.activeTrip.editDay(change, target: target)
            try Task.checkCancellation()
            guard self.revision == revision else { return }
            self.optimization = nil
            if !success.isEmpty { self.show(success) }
            completed()
        }
    }
    func clearTrip() {
        perform { try await self.activeTrip.clear() }
    }
    func navigate(_ day: TripRoutePlan.Day, maps: MapsHandoff, google: Bool, part: Int) {
        let revision = revision
        perform {
            guard self.revision == revision else { return }
            if !(await maps.openDay(day, google: google, part: part)) {
                throw MapsHandoff.Failure.unavailable
            }
        }
    }
    func propose(trip: Trip, target: TripDayID) {
        guard account.dataAccess.canEditAccount else { return }
        let revision = revision
        perform {
            let result = await Self.optimize(trip, dayID: target.dayID)
            try Task.checkCancellation()
            guard self.revision == revision, self.activeTrip.target == target else { return }
            guard self.activeTrip.draft?.trip == trip,
                let original = trip.days.first(where: { $0.id == target.dayID }),
                let day = result.days.first(where: { $0.id == target.dayID })
            else { throw TripDayEdit.Failure.changedDay }
            self.optimization = Optimization(expected: original.stops.map(\.id), order: day.stops.map(\.id))
        }
    }
    @concurrent private static func optimize(_ trip: Trip, dayID: String) async -> Trip {
        TripOptimizer.optimize(trip, dayID: dayID)
    }
    func dismissOptimization() { optimization = nil }
    func dismissNotice() {
        noticeExpiry?.cancel()
        noticeExpiry = nil
        notice = nil
    }
    /// An older write may finish for its original day, but cannot change a newly selected sheet.
    func invalidatePresentation() {
        revision = UUID()
        insertion = nil
        optimization = nil
        notice = nil
        noticeExpiry?.cancel()
        noticeExpiry = nil
    }
    private func show(_ message: String) {
        noticeExpiry?.cancel()
        notice = message
        noticeExpiry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            self?.notice = nil
            self?.noticeExpiry = nil
        }
    }
    private func perform(_ work: @escaping @MainActor () async throws -> Void) {
        guard action == nil else { return }
        let generation = generation
        let revision = revision
        let uid = account.identity?.uid
        noticeExpiry?.cancel()
        notice = nil
        isWorking = true
        action = Task {
            do {
                try Task.checkCancellation()
                guard self.account.identity?.uid == uid else { throw AccountFailure.accountChanged }
                try await work()
            } catch {
                if !Task.isCancelled, self.generation == generation, self.revision == revision {
                    if error is MapsHandoff.Failure {
                        self.notice = "Maps could not be opened. Please try again."
                    } else {
                        self.notice =
                            error is TripDayEdit.Failure
                            ? "This day changed. Review the latest stops and try again."
                            : "The change could not be saved. Your draft is retained; check access or storage and retry."
                    }
                }
            }
            guard self.generation == generation else { return }
            self.action = nil
            self.isWorking = false
        }
    }
    func cancel() {
        generation = UUID()
        action?.cancel()
        action = nil
        isWorking = false
        invalidatePresentation()
    }
}
