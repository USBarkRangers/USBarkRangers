import BarkDomain
import Foundation
import Observation

/// One session snapshot: five leaders and the current user's published standing, never editable scores.
@MainActor @Observable final class LeaderboardModel {
    private(set) var entries: [LeaderboardEntry] = []
    private(set) var personal: LeaderboardStanding?
    private(set) var loading = false
    private(set) var notice: String?
    private(set) var loaded = false
    private(set) var personalUnavailable = false
    private var generation = UUID()
    private let legacyRepository: (any LeaderboardReading)?
    private var repository: (any LeaderboardReading)? { account.nativeLeaderboard ?? legacyRepository }
    private let account: AccountSession
    private var task: Task<Void, Never>?
    var currentUserID: String? { account.identity.map { repository?.entryID(uid: $0.uid) ?? $0.uid } }
    var currentUserName: String { account.profileState?.visible?.displayName ?? account.identity?.displayName ?? "You" }
    var isInTopFive: Bool { entries.contains { $0.id == currentUserID } }

    init(repository: (any LeaderboardReading)?, account: AccountSession) {
        self.legacyRepository = repository
        self.account = account
    }
    func loadIfNeeded() { if !loaded { refresh() } }
    func refresh() {
        guard task == nil else { return }
        guard let repository else {
            notice = "Leaderboard is unavailable in this build."
            return
        }
        let generation = generation
        let uid = account.identity?.uid
        loading = true
        notice = nil
        task = Task {
            defer {
                if self.generation == generation {
                    loading = false
                    task = nil
                }
            }
            do {
                let leaders = try await repository.topFive()
                guard isCurrent(generation, uid: uid) else { return }
                entries = leaders
                personal = nil
                personalUnavailable = false
                if let index = leaders.firstIndex(where: { $0.id == uid.map { repository.entryID(uid: $0) } }) {
                    personal = .init(entry: leaders[index], rank: index + 1)
                } else if let uid {
                    do {
                        let standing = try await repository.standing(uid: uid)
                        guard isCurrent(generation, uid: uid) else { return }
                        personal = standing
                    } catch {
                        guard isCurrent(generation, uid: uid) else { return }
                        personalUnavailable = true
                        notice = "Top five loaded. Your standing is unavailable; try refreshing."
                    }
                }
                // A cancelled personal lookup is incomplete and must retry when the screen reopens.
                loaded = true
            } catch {
                guard isCurrent(generation, uid: uid) else { return }
                notice = "Couldn't refresh the leaderboard. Try again when connected."
            }
        }
    }
    private func isCurrent(_ generation: UUID, uid: String?) -> Bool {
        !Task.isCancelled && self.generation == generation && account.identity?.uid == uid
    }
    func resetScope() {
        cancel()
        entries = []
        personal = nil
        personalUnavailable = false
        loaded = false
        notice = nil
    }
    func cancel() {
        if loading { loaded = false }
        generation = UUID()
        task?.cancel()
        task = nil
        loading = false
    }
}
