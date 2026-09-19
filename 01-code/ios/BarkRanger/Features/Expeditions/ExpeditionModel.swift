import BarkDomain
import Foundation
import Observation

/// Screen intents and read projection only. Recorder, recovery files, route geometry and sync own their work.
@MainActor @Observable final class ExpeditionModel: AccountScoped {
    let account: AccountSession
    let trails: [Trail]
    let geometry: TrailRepository
    let recorder: WalkRecorder
    let health: HealthWorkoutImporter
    private(set) var notice: String?
    enum NoticeScope { case expedition, manualEntry, history }
    private var noticeScope = NoticeScope.expedition
    func notice(for scope: NoticeScope) -> String? { noticeScope == scope ? notice : nil }
    private(set) var busy = false
    private(set) var workouts: [HealthWorkoutImporter.Candidate] = []
    private var action: Task<Bool, Never>?
    private var generation = UUID()
    private(set) var history: NativeActivityHistory?
    var expedition: NativeExpeditionPresentation { .init(overview: account.nativeExpeditions?.overview) }
    var canEdit: Bool {
        account.dataAccess.canEditAccount && account.nativeExpeditions != nil && !busy
            && recorder.recording == nil
    }
    var selectionKnown: Bool { account.nativeExpeditions?.overview?.hasConfirmedSelection == true }
    var canRecord: Bool {
        canEdit && selectionKnown && account.nativeExpeditions?.overview?.selectionBlocked != true
    }
    var canChooseTrail: Bool { canRecord }
    var canClaim: Bool { canEdit && account.nativeExpeditions?.overview?.runHasPendingChanges == false }
    var conflicts: [UUID] { account.nativeExpeditions?.overview?.conflicts ?? [] }
    var completed: [NativeCompletedTrails.Item] { account.nativeExpeditions?.completed ?? [] }
    var pendingCount: Int { account.nativeExpeditions?.overview?.pendingIDs.count ?? 0 }
    init(
        account: AccountSession, recorder: WalkRecorder, geometry: TrailRepository,
        health: HealthWorkoutImporter
    ) {
        self.account = account
        self.recorder = recorder
        self.geometry = geometry
        self.health = health
        trails = (try? Trail.bundled()) ?? []
    }
    func assign(_ trail: Trail) {
        guard canChooseTrail, let selected = account.nativeExpeditions?.overview else { return }
        perform { repository in
            try await repository.assign(trail, selected: selected)
        }
    }
    func suggestedTrail() -> Trail? {
        let completed = Set(completed.map(\.id))
        var choices = trails.filter { !completed.contains($0.id) }
        if choices.isEmpty { choices = trails }
        if choices.count > 1 { choices.removeAll { $0.id == "grand_canyon_rim2rim" } }
        return choices.randomElement()
    }
    func logManual(miles: Double) {
        guard canRecord else { return }
        guard miles.isFinite, miles > 0, miles <= 15 else {
            noticeScope = .manualEntry
            notice = "Enter more than zero and up to 15 miles per entry."
            return
        }
        let now = Date()
        let run = expedition.runID
        let name = run == nil ? "Your walk" : expedition.name
        perform(scope: .manualEntry) {
            try await $0.commitWalk(
                WalkSummary(
                    source: .manual, startedAt: now, endedAt: now,
                    meters: miles * 1609.344, elapsedSeconds: 0, runID: run), trailName: name)
        }
    }
    func claim() {
        guard canClaim, let run = account.nativeExpeditions?.overview?.activeRun else {
            noticeScope = .expedition
            notice =
                "Let pending walks finish syncing before confirming this trail's completion."
            return
        }
        perform { try await $0.claim(run) }
    }
    func edit(_ walk: NativeActivityDraft, miles: Double, date: Date, trailName: String) async -> Bool {
        await perform(scope: .history) {
            try await $0.edit(walk, meters: miles * 1609.344, date: date, trailName: trailName)
        }?.value ?? false
    }
    func remove(_ walk: NativeActivityDraft) {
        perform(scope: .history) {
            try await $0.remove(walk)
        }
    }
    func resolve(_ review: NativeStore.ExpeditionConflictReview, keepLocal: Bool) {
        perform(allowReadOnly: !keepLocal) { try await $0.resolveConflict(review, keepLocal: keepLocal) }
    }
    func loadWorkouts() async {
        guard canRecord, !busy else { return }
        let token = generation
        noticeScope = .expedition
        notice = nil
        busy = true
        defer { if generation == token { busy = false } }
        let uid = account.identity?.uid
        do {
            let results = try await health.workouts()
            guard !Task.isCancelled, generation == token, account.identity?.uid == uid else { return }
            guard let repository = account.nativeExpeditions?.repository else { return }
            let imported = try await repository.importedIDs(results.map(\.id))
            guard !Task.isCancelled, generation == token, account.identity?.uid == uid else { return }
            workouts = results.filter { !imported.contains($0.id) }
            notice =
                workouts.isEmpty
                ? "No available walking or hiking workouts. Health may have no matching data or may limit access."
                : nil
        } catch {
            if generation == token, !Task.isCancelled {
                notice = "Health workouts are unavailable. Check Health access and device support."
            }
        }
    }
    func importWorkout(_ workout: HealthWorkoutImporter.Candidate) {
        guard canRecord else { return }
        let summary = workout.summary(runID: expedition.runID)
        let name = expedition.runID == nil ? "Your walk" : expedition.name
        perform { try await $0.commitWalk(summary, trailName: name) }
    }
    @discardableResult private func perform(
        allowReadOnly: Bool = false, scope: NoticeScope = .expedition,
        _ work: @escaping @Sendable (NativeExpeditionRepository) async throws -> Void
    ) -> Task<Bool, Never>? {
        guard action == nil, recorder.recording == nil,
            allowReadOnly || account.dataAccess.canEditAccount,
            let repository = account.nativeExpeditions?.repository, let uid = account.identity?.uid
        else { return nil }
        busy = true
        noticeScope = scope
        notice = nil
        let token = generation
        action = Task {
            defer {
                if generation == token {
                    busy = false
                    action = nil
                }
            }
            do {
                try Task.checkCancellation()
                try await work(repository)
                guard !Task.isCancelled, generation == token, account.identity?.uid == uid else {
                    return false
                }
                notice = "Saved on this iPhone"
                return true
            } catch {
                guard !Task.isCancelled, generation == token, account.identity?.uid == uid else {
                    return false
                }
                switch error {
                case NativeStore.Failure.queueFull:
                    notice =
                        "Saved changes need to finish syncing before another change can be added. Your history is retained."
                case NativeStore.Failure.unavailable:
                    notice =
                        "The selected data or account access changed. Review the current history and any sync notices, then retry."
                default: notice = "This change could not be saved. Your existing history is retained."
                }
                return false
            }
        }
        return action
    }
    func resetScope() {
        generation = UUID()
        action?.cancel()
        action = nil
        busy = false
        workouts = []
        notice = nil
        history?.stop()
        history = nil
    }
    func observeHistory() async {
        guard let feature = account.nativeExpeditions else { return }
        if history == nil { history = NativeActivityHistory(repository: feature.repository) }
        let reader = feature.beginHistory()
        defer { feature.endHistory(reader) }
        await history?.observe()
    }
}
