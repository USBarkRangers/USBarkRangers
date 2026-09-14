import BarkDomain
import Foundation

/// Site overlap is a dependency; a settled conflict at A must not block park B.
actor NativeVisitSync {
    typealias Result = NativeMailroom.QueueResult
    private let store: NativeStore
    private let cloud: NativeVisitCloud
    private let jobs = NativeSyncJobs<String, Result>()
    init(store: NativeStore, cloud: NativeVisitCloud) {
        self.store = store
        self.cloud = cloud
    }
    func synchronize() async throws -> Result {
        try await jobs.run("visits") {
            let stop = try await NativeMailroom.drain(
                store: self.store, next: { try await self.next() },
                reject: { try await self.store.rejectVisitOperation($0, code: $1) },
                continueAfterRejection: true)
            return try await self.result(stop)
        }
    }
    private func next() async throws -> NativeMailroom.Delivery? {
        guard let pending = try await store.nextVisitSubmission() else { return nil }
        return .init(command: pending.submission) { [cloud, store] in
            let references = pending.operation.changes.map { NativeVisitReference(target: $0.intent.target) }
            if pending.operation.isBulk {
                let outcome = try await cloud.submitBulk(pending.submission)
                let selected = try await cloud.selection(references)
                try Task.checkCancellation()
                try await store.acceptNativeBulkVisitOutcome(outcome, selection: selected)
            } else {
                let outcome = try await cloud.submit(pending.submission)
                guard let reference = references.first else { throw NativeStore.Failure.corrupt }
                let snapshot: NativeVisitSnapshot
                if let confirmed = outcome.confirmation {
                    guard confirmed.visitID == reference.visitID,
                        confirmed.officialPlaceID == reference.officialPlaceID
                    else {
                        throw NativeCallableTransport.Failure.invalidReply
                    }
                    snapshot = confirmed
                } else {
                    snapshot = try await cloud.visit(
                        id: reference.visitID, officialPlaceID: reference.officialPlaceID)
                }
                let selected = try NativeVisitSelection(snapshot: snapshot)
                try Task.checkCancellation()
                try await store.acceptNativeVisitOutcome(outcome, selection: selected)
            }
        }
    }
    private func result(_ stop: NativeMailroom.Stop) async throws -> Result {
        let queue = try await store.visitQueue()
        let access: Bool
        if case .blocked(let value) = stop { access = value } else { access = false }
        var earlierSites = Set<String>()
        var retry: Date?
        for entry in queue {
            if !entry.needsDecision, earlierSites.isDisjoint(with: entry.keys.siteIDs), !access {
                retry = min(retry ?? entry.retryAt, entry.retryAt)
            }
            earlierSites.formUnion(entry.keys.siteIDs)
        }
        if case .retry(let date) = stop { retry = retry.map { max($0, date) } }
        return .init(
            pendingCount: queue.count, needsDecision: queue.contains(where: \.needsDecision),
            retryAt: retry, requiresAccessRefresh: access)
    }
    func pause() async { await jobs.pause() }
    func resume() async throws { try await jobs.resume() }
    func stop() async {
        await jobs.close()
        await cloud.close()
    }
}
