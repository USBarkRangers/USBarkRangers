import BarkDomain
import Foundation

/// Typed authored actions. The store is the only writer; network pages are bounded
/// and explicitly requested. No conversion through the old account-wide profile.
nonisolated struct NativeExpeditionRepository: Sendable {
    let store: NativeStore
    let cloud: NativeExpeditionCloud?

    func assign(_ trail: Trail, selected: NativeStore.ExpeditionOverview) async throws {
        try await store.assignNativeTrail(trail, matching: selected)
    }
    func claim(_ run: NativeVirtualRun) async throws { try await store.claimNativeRun(run) }

    /// The recording's original activity ID, interval and run attribution survive
    /// retries and account reopening. Never silently attach it to today's active run.
    func commitWalk(_ walk: WalkSummary, trailName: String) async throws {
        let summary = try NativeActivitySummary(walk)
        _ = try await store.stageNativeExpeditionOperation(
            .init(
                action: .record(summary),
                recordedTrailName: trailName))
    }
    func edit(_ selected: NativeActivityDraft, meters: Double, date: Date, trailName: String) async throws {
        guard date <= Date().addingTimeInterval(60) else { throw VisitPolicy.Failure.invalidDate }
        try await ensureSelected(selected)
        _ = try await store.stageNativeExpeditionOperation(
            .init(
                action: .edit(
                    activityID: selected.id,
                    revision: selected.revision, meters: meters,
                    happenedAtMs: NativeClientTime.milliseconds(date), trailName: trailName),
                beforeActivity: selected))
    }
    func remove(_ selected: NativeActivityDraft) async throws {
        try await ensureSelected(selected)
        _ = try await store.stageNativeExpeditionOperation(
            .init(
                action: .remove(
                    activityID: selected.id,
                    revision: selected.revision), beforeActivity: selected))
    }
    private func ensureSelected(_ selected: NativeActivityDraft) async throws {
        if try await store.nativeActivityDraft(id: selected.id) == selected { return }
        guard let cloud else { throw NativeStore.Failure.unavailable }
        try await store.acceptNativeExpedition(
            cloud.current(activityID: selected.id, runID: selected.summary.runID))
        guard try await store.nativeActivityDraft(id: selected.id) == selected else {
            throw NativeStore.Failure.unavailable
        }
    }
    func history(before: NativeActivityPage.Cursor?) async throws -> NativeActivityPage {
        guard let cloud else { throw NativeStore.Failure.unavailable }
        for _ in 0..<2 {
            let page = try await cloud.history(before: before)
            let changes = try await store.activityChangesQuery()
            let bootstrap = before == nil && changes == nil
            if try await store.acceptNativeActivityHistory(page, after: before, bootstrap: bootstrap) {
                return page
            }
        }
        throw NativeStore.Failure.unavailable
    }
    func importedIDs(_ ids: [String]) async throws -> Set<String> {
        let requested = Array(Set(ids))
        guard requested.count <= 100 else { throw NativeStore.Failure.unavailable }
        var known = try await store.knownNativeActivityIDs(Set(requested))
        let queue = try await store.expeditionQueue()
        for entry in queue {
            if case .record(let summary) = try await store.expeditionOperation(entry.id).action {
                known.insert(summary.activityID)
            }
        }
        let missing = requested.filter { !known.contains($0) }
        if !missing.isEmpty, let cloud {
            let result = try await cloud.claimedActivities(missing)
            try await store.acceptNativeActivityClaims(result, requested: missing)
            known.formUnion(result.claimedIDs)
        }
        return known
    }
}
