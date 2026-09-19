import BarkDomain
import Foundation
import Observation

/// Shared active-trip lifetime. TripDraftSession alone owns the editable buffer; routing is derived.
/// Map and Planner send intents here, never copy or independently select an active trip.
@MainActor @Observable final class ActiveTripSession {
    let account: AccountSession
    private let session: TripDraftSession
    typealias Save = (NativeTripRepository, String, TripDraft) async throws -> TripDraft
    private let saveAccountTrip: Save
    let routing: TripRoutingModel
    private(set) var dayIsSelected = false
    private(set) var isWorking = false
    private var scope: String?
    private var active = false
    private var connected = true
    private var generation = UUID()
    private var observationGeneration = UUID()
    private var synchronization: Task<Void, Never>?
    private var refreshRequested = false
    private var checkpointReload: Task<Void, Never>?
    private var saveOperation: UUID?
    private var recoveries: [String: TripDraftSession.Recovery] = [:]

    var draft: TripDraft? { scope == account.tripScope ? session.draft : nil }
    var tripID: String? { draft?.id }
    var editRevision: Int { session.revision }
    var checkpointPending: Bool { session.pending }
    var checkpointConflict: Bool { session.conflict }
    var checkpointNeedsRetry: Bool { session.needsRetry }
    var checkpointIsWriting: Bool { session.isWriting }
    var notice: String? { session.notice }
    var plan: TripRoutePlan? { routing.input == draft.map({ TripRouteInput($0.trip) }) ? routing.plan : nil }
    var target: TripDayID? {
        guard dayIsSelected, let draft, let day = draft.activeDayID else { return nil }
        return TripDayID(tripID: draft.id, dayID: day)
    }
    var visibleRoutes: DayRouteService? {
        guard let draft, routing.service.tripID == draft.id else { return nil }
        return routing.service
    }
    init(
        account: AccountSession, routes: DayRouteService,
        saveAccountTrip: @escaping Save = { try await $0.save(id: $1, matching: $2) },
        checkpointDraft: @escaping TripDraftSession.Checkpoint = {
            try await $0.checkpoint($1, replacing: $2)
        }
    ) {
        self.account = account
        self.saveAccountTrip = saveAccountTrip
        session = TripDraftSession(account: account, checkpointDraft: checkpointDraft)
        routing = TripRoutingModel(service: routes)
        scope = account.tripScope
        routes.reset(scope: scope)
        account.closeTripEditing = { [weak self] in
            guard let self else { return Task {} }
            return self.closeEditingScope()
        }
        account.prepareTripIdentityChange = { [weak self] in
            guard let self else { return }
            if self.session.needsRetry { self.session.requestCheckpoint() }
            await self.session.waitForCheckpoint()
            guard !self.session.pending else {
                throw IdentityChangeBlocked(
                    reason:
                        "Your latest trip edits could not be saved on this iPhone. Retry saving in Trips before changing accounts. Keep the app open to retain those edits."
                )
            }
        }
    }
    func open(_ next: TripDraft, replacing base: TripDraft?, selectDay: Bool = true) {
        guard !isWorking else { return }
        install(next, replacing: base, selectDay: selectDay)
    }
    private func install(_ next: TripDraft, replacing base: TripDraft?, selectDay: Bool) {
        if scope != account.tripScope { routing.reset(scope: account.tripScope) }
        scope = account.tripScope
        session.open(next, replacing: base)
        if selectDay { dayIsSelected = true }
        refreshRoutes()
    }
    func replace(_ next: TripDraft, success: String?) {
        guard !isWorking, !session.conflict, next.id == draft?.id else { return }
        guard account.dataAccess.canEditDrafts || next.trip == draft?.trip else { return }
        do { try next.trip.validate(allowEmptyName: true) } catch { return }
        let navigated = next.id != draft?.id || next.activeDayID != draft?.activeDayID
        session.replace(next, success: success)
        if navigated { dayIsSelected = true }
        refreshRoutes()
    }
    func highlightDay() { if draft != nil { dayIsSelected = true } }
    func closeDay() { dayIsSelected = false }
    @discardableResult func selectDay(_ id: String) -> Bool {
        guard !isWorking, !session.conflict, let draft else { return false }
        do {
            let next = try TripDayEdit.select.applying(to: draft, target: .init(tripID: draft.id, dayID: id))
            if next != draft { replace(next, success: nil) }
            highlightDay()
            return true
        } catch { return false }
    }
    /// External atomic edits drain the same checkpoint first, then adopt the accepted active draft.
    /// Holding this gate prevents Planner edits from racing a Map operation or Clear.
    private func perform(_ operation: (NativeTripRepository) async throws -> Void) async throws {
        guard !isWorking, let repository = account.nativeTrips?.repository else {
            throw NativeStore.Failure.unavailable
        }
        let generation = generation
        let uid = account.tripScope
        isWorking = true
        cancelSynchronization()
        defer {
            if self.generation == generation {
                isWorking = false
                refreshRoutes()
            }
        }
        await session.waitForCheckpoint()
        try Task.checkCancellation()
        guard self.generation == generation, uid == account.tripScope else {
            throw AccountFailure.accountChanged
        }
        guard !session.pending, !session.conflict else { throw TripDayEdit.Failure.changedDay }
        try await operation(repository)
        try Task.checkCancellation()
        guard self.generation == generation, uid == account.tripScope else {
            throw AccountFailure.accountChanged
        }
        let saved = try await repository.restoreActiveDraft()
        try Task.checkCancellation()
        guard self.generation == generation, uid == account.tripScope else {
            throw AccountFailure.accountChanged
        }
        adopt(saved)
    }
    func clear() async throws {
        let id = tripID
        try await perform { try await $0.clearActiveTrip(expectedID: id) }
    }
    func waitForCheckpoint() async { await session.waitForCheckpoint() }
    func requestCheckpoint() { session.requestCheckpoint() }
    func dismissNotice(revision: Int) {
        guard revision == session.revision else { return }
        session.notice = nil
    }
    func reloadCheckpoint() {
        guard !session.isWriting, !isWorking, let id = tripID,
            let repository = account.nativeTrips?.repository
        else { return }
        let generation = generation
        cancelSynchronization()
        checkpointReload = Task {
            defer {
                if !Task.isCancelled {
                    self.checkpointReload = nil
                    if self.active { self.requestRefresh() }
                }
            }
            do {
                let current = try await repository.currentDraft(id: id)
                guard !Task.isCancelled, self.generation == generation, self.tripID == id,
                    let current
                else { return }
                self.install(current, replacing: current, selectDay: true)
            } catch {
                if !Task.isCancelled, self.generation == generation {
                    self.session.notice = "This draft could not be loaded. Your edits are retained."
                }
            }
        }
    }

    /// Screens ask for complete operations; they never sequence repository calls around checkpoints.
    func selectTrip(id: String?, dayID: String?) async throws {
        try await perform { repository in
            let next = try await repository.openDraft(id: id)
            try Task.checkCancellation()
            if let dayID, !next.trip.days.contains(where: { $0.id == dayID }) {
                throw TripDayEdit.Failure.missingDay
            }
            if let dayID, dayID != next.activeDayID {
                try await repository.editDay(.init(tripID: next.id, dayID: dayID), edit: .select)
            }
        }
    }
    func addStop(
        _ stop: Trip.Stop, aliases: Set<ParkID>, expectedTripID: String?,
        destination: TripStopPolicy.Destination?, after: String?
    ) async throws {
        try await perform { repository in
            guard self.tripID == expectedTripID else { throw TripDayEdit.Failure.changedDay }
            _ = try await repository.addStop(
                stop, aliases: aliases, tripID: expectedTripID,
                destination: destination, after: after)
        }
    }
    func editDay(_ change: TripDayEdit, target: TripDayID) async throws {
        try await perform { repository in
            guard self.tripID == target.tripID else { throw TripDayEdit.Failure.changedDay }
            try await repository.editDay(target, edit: change)
        }
    }
    func deleteTrip(_ selection: NativeTripRepository.DeletionSelection) async throws {
        try await perform { repository in
            switch selection {
            case .draft(let draft): try await repository.delete(matching: draft)
            case .saved(let id, let revision):
                try await repository.delete(id: id, contentRevision: revision)
            }
        }
    }
    func resolveConflict(_ review: NativeTripRepository.ConflictReview, keepLocal: Bool) async throws {
        var recovered = false
        try await perform { repository in
            let result = try await repository.resolve(review, keepLocal: keepLocal)
            recovered = result.recoveredAsNewTrip
        }
        if recovered {
            session.notice = "The account trip was deleted. Your local work was saved as a new trip."
        }
    }
    func saveDraftToAccount() async throws {
        guard account.dataAccess.canEditAccount, let buffer = draft,
            let repository = account.nativeTrips?.repository
        else {
            throw NativeStore.Failure.unavailable
        }
        guard !isWorking, saveOperation == nil else { throw NativeStore.Failure.unavailable }
        let operation = UUID()
        saveOperation = operation
        let generation = generation
        let uid = account.tripScope
        let revision = session.revision
        defer { if saveOperation == operation { saveOperation = nil } }
        // A save belongs to its captured draft. Opening another trip can cancel its presentation,
        // but cannot undo a durable write or authorize the old completion to replace the new buffer.
        await session.waitForCheckpoint()
        try Task.checkCancellation()
        guard self.generation == generation, uid == account.tripScope else {
            throw AccountFailure.accountChanged
        }
        guard !session.pending, !session.conflict, session.revision == revision,
            let checkpointed = draft, checkpointed.trip == buffer.trip,
            checkpointed.activeDayID == buffer.activeDayID
        else { throw TripDayEdit.Failure.changedDay }
        let saved = try await saveAccountTrip(repository, buffer.id, checkpointed)
        try Task.checkCancellation()
        guard self.generation == generation, uid == account.tripScope else {
            throw AccountFailure.accountChanged
        }
        let latest = try await repository.currentDraft(id: buffer.id)
        try Task.checkCancellation()
        guard self.generation == generation, uid == account.tripScope else {
            throw AccountFailure.accountChanged
        }
        guard latest?.trip == saved.trip else { throw TripDayEdit.Failure.changedDay }
        guard draft?.id == buffer.id, session.revision == revision else { return }
        session.acceptSaved(saved)
        session.notice = "Saved on this iPhone. Your account confirms it when connected."
    }
    /// Read the store's latest accepted value, not an older queued UI publication.
    func resume() async {
        await checkpointReload?.value
        guard !Task.isCancelled else { return }
        requestRefresh()
        await synchronization?.value
    }
    /// Library and change-feed publications can describe the same revision while
    /// its detail is still downloading. Finish that read, then recheck cache-first;
    /// cancelling it discards a paid-for response and starts the same download again.
    private func requestRefresh() {
        refreshRequested = true
        guard synchronization == nil, checkpointReload == nil else { return }
        synchronization = Task { [weak self] in
            guard let self else { return }
            defer { if !Task.isCancelled { self.synchronization = nil } }
            while !Task.isCancelled, self.refreshRequested {
                self.refreshRequested = false
                await self.restoreActiveDraft()
            }
        }
    }
    private func cancelSynchronization() {
        synchronization?.cancel()
        synchronization = nil
        refreshRequested = false
        checkpointReload?.cancel()
        checkpointReload = nil
    }
    private func restoreActiveDraft() async {
        guard !isWorking, saveOperation == nil, !session.pending, !session.conflict,
            let repository = account.nativeTrips?.repository
        else { return }
        let generation = generation
        let revision = session.revision
        let uid = account.tripScope
        do {
            let next = try await repository.restoreActiveDraft()
            guard !Task.isCancelled, self.generation == generation, uid == account.tripScope,
                session.revision == revision, !session.pending, !session.conflict, !isWorking
            else { return }
            adopt(next)
        } catch {
            if !Task.isCancelled, self.generation == generation {
                session.notice = "The current trip could not be loaded. Your saved trips are retained."
            }
        }
    }
    private func adopt(_ next: TripDraft?) {
        guard next != draft else { return }
        if let next {
            if next.trip == draft?.trip, next.activeDayID == draft?.activeDayID {
                // Our server acknowledgment advances a preimage, not the editing
                // session. Keep save feedback, day focus and in-flight UI identity.
                session.acceptSaved(next)
            } else {
                install(next, replacing: next, selectDay: false)
            }
        } else {
            session.reset()
            dayIsSelected = false
            refreshRoutes()
        }
    }
    func start() {
        guard !active else { return }
        if scope != account.tripScope { resetScope() }
        active = true
        observe()
    }
    private func observe() {
        let generation = observationGeneration
        withObservationTracking {
            _ = account.nativeTrips?.revision
            _ = account.tripScope
            _ = account.entitlement.access
            _ = session.draft
            _ = session.pending
            _ = isWorking
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.active, self.observationGeneration == generation else { return }
                if self.scope != self.account.tripScope {
                    self.resetScope()
                    self.start()
                    return
                }
                self.observe()
            }
        }
        refreshRoutes()
        requestRefresh()
    }
    private func refreshRoutes() {
        routing.update(draft, permitted: active && connected && account.dataAccess.canEditAccount)
    }
    func connectivityChanged(_ connected: Bool) {
        let reconnected = connected && !self.connected
        self.connected = connected
        refreshRoutes()
        if reconnected, active {
            routing.service.retry()
            // Retry a previously unavailable selection even if no new metadata arrives
            // (for example an older trip outside the library head). The repository is
            // cache-first, so a current detail causes no network request here.
            requestRefresh()
        }
    }
    func stop() {
        active = false
        observationGeneration = UUID()
        cancelSynchronization()
        routing.stop()
    }
    private func closeEditingScope() -> Task<Void, Never> {
        let wasActive = active
        let previousScope = scope
        generation = UUID()
        stop()
        // The checkpoint task captured its repository at admission. Finish all of
        // its coalesced edits against that writer, never the next account's repository.
        if session.needsRetry { session.requestCheckpoint() }
        return Task {
            await self.session.waitForCheckpoint()
            // Auth can revoke a session without going through our sign-out button.
            // Hide its private edits immediately, but retain a failed checkpoint for
            // that same scope. Never silently discard it or expose it to another UID.
            if let previousScope, let recovery = self.session.recovery {
                self.recoveries[previousScope] = recovery
            }
            self.resetScope()
            if wasActive { self.start() }
        }
    }
    func forgetDeletedAccount(scope removedScope: String) throws {
        guard account.tripScope != removedScope else { throw AccountFailure.accountChanged }
        recoveries.removeValue(forKey: removedScope)
    }
    func resetScope() {
        generation = UUID()
        stop()
        session.reset()
        saveOperation = nil
        isWorking = false
        dayIsSelected = false
        scope = account.tripScope
        if let scope, let recovery = recoveries.removeValue(forKey: scope) {
            session.restore(recovery)
        }
        routing.reset(scope: scope)
    }
}
