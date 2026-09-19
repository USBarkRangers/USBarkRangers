import BarkDomain
import Foundation
import Observation

/// A derived passport snapshot and visit intents. The store owns visits; the server owns confirmed awards.
@MainActor @Observable final class PassportModel {
    nonisolated struct Input: Equatable, Sendable {
        let uid: String
        let progress: NativeProgress?
        let reference: Coordinate?
    }
    var input: Input? {
        guard account.identity != nil, let feature = account.nativeVisits else { return nil }
        return Input(
            uid: feature.scope, progress: feature.overview?.progress,
            reference: nearby.reference)
    }
    nonisolated struct Content: Sendable {
        let summary: AchievementPolicy.Summary
        let badges: [AchievementPolicy.Badge]
    }
    let account: AccountSession
    let catalog: CatalogRepository
    let leaderboard: LeaderboardModel
    let nearby: NearbyStatesModel
    private(set) var content: Content?
    private(set) var history: NativeVisitHistory?
    private(set) var notice: String?
    private(set) var working = false
    private var action: Task<Void, Never>?
    private var generation = UUID()
    init(
        account: AccountSession, catalog: CatalogRepository, leaderboard: LeaderboardModel,
        nearby: NearbyStatesModel = NearbyStatesModel()
    ) {
        self.account = account
        self.catalog = catalog
        self.leaderboard = leaderboard
        self.nearby = nearby
    }
    var canEdit: Bool { account.dataAccess.canEditAccount }
    var displayName: String {
        account.profileState?.visible?.displayName ?? account.identity?.displayName ?? "Bark Ranger"
    }
    var pendingCount: Int {
        account.nativeVisits?.overview?.pendingIDs.count ?? 0
    }
    var conflicts: [UUID] {
        account.nativeVisits?.overview?.conflicts ?? []
    }
    var streak: Int {
        account.nativeVisits?.overview?.progress?.streakCount ?? 0
    }
    /// Passport's navigation scope owns this subscription, including pushed history screens.
    /// Only accepted catalog revisions or changes to the scope's account-input task identity rebuild it.
    func observeProgress() async {
        let uid = account.identity?.uid
        let generation = generation
        guard uid != nil, let input else {
            content = nil
            return
        }
        if history == nil, let repository = account.nativeVisits?.repository {
            history = NativeVisitHistory(repository: repository)
        }
        var revision: Int64?
        for await state in await catalog.updates() {
            guard !Task.isCancelled, self.generation == generation, self.input == input else { return }
            guard let accepted = state.snapshot, revision != accepted.revision else { continue }
            do {
                let value = try await Self.derive(
                    progress: input.progress, catalog: accepted, reference: input.reference)
                let currentRevision = await catalog.current().snapshot?.revision
                guard !Task.isCancelled, self.generation == generation, self.input == input else { return }
                guard currentRevision == accepted.revision else { continue }
                content = value
                revision = accepted.revision
            } catch {
                if !Task.isCancelled, self.generation == generation {
                    notice = "Passport progress could not be loaded. Your original records are retained."
                }
            }
        }
    }
    @concurrent private static func derive(
        progress: NativeProgress?, catalog: CatalogSnapshot, reference: Coordinate?
    ) async throws
        -> Content
    {
        let summary = NativePassport.summary(progress: progress, catalog: catalog)
        let badges = try NativePassport.badges(progress: progress)
        return Content(
            summary: summary,
            badges: StateProgressOrder.ordered(badges, parks: catalog.parks, reference: reference))
    }
    func recordActivity() {
        guard canEdit else { return }
        account.nativeVisits?.recordActivity()
    }
    func remove(_ selected: [NativeVisitWorkingState], completed: @escaping () -> Void = {}) {
        guard canEdit else {
            notice = AccountDataAccess.readOnlyMessage
            return
        }
        guard let repository = account.nativeVisits?.repository else { return }
        run(completed: completed) { try await repository.remove(selected) }
    }
    func changeDate(_ selected: NativeVisitWorkingState, date: Date, completed: @escaping () -> Void = {}) {
        guard canEdit else {
            notice = AccountDataAccess.readOnlyMessage
            return
        }
        guard let repository = account.nativeVisits?.repository else { return }
        run(completed: completed) { try await repository.changeDate(selected: selected, date: date, timeZone: .current) }
    }
    func resolve(_ review: NativeStore.VisitConflictReview, keepLocal: Bool, allowManualRecreation: Bool = false) {
        guard !keepLocal || canEdit else { return }
        guard let repository = account.nativeVisits?.repository else { return }
        run {
            _ = try await repository.resolveConflict(review, choice: keepLocal
                ? .keepLocal(allowManualRecreation: allowManualRecreation) : .keepRemote)
        }
    }
    private func run(
        completed: @escaping () -> Void = {}, _ work: @escaping @MainActor () async throws -> Void
    ) {
        guard action == nil else { return }
        let generation = generation
        let uid = account.identity?.uid
        working = true
        notice = nil
        action = Task {
            do {
                try Task.checkCancellation()
                guard account.identity?.uid == uid else { throw AccountFailure.accountChanged }
                try await work()
                if !Task.isCancelled, self.generation == generation, account.identity?.uid == uid {
                    completed()
                }
            } catch {
                if !Task.isCancelled, self.generation == generation, account.identity?.uid == uid {
                    notice =
                        "The visit change could not be saved. Your original history is retained; check your account and try again."
                }
            }
            if self.generation == generation {
                working = false
                action = nil
            }
        }
    }
    func resetScope() {
        nearby.reset()
        generation = UUID()
        action?.cancel()
        action = nil
        content = nil
        history?.stop()
        history = nil
        notice = nil
        working = false
        leaderboard.resetScope()
    }
}
