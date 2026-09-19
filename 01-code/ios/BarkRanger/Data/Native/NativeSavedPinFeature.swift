import BarkDomain
import Foundation
import Observation

/// The existing scheduler/mailroom owns cancellation, coalescing, retries and
/// pending storage. This adapter supplies only membership delivery and change pages.
@MainActor @Observable final class NativeSavedPinFeature {
    let store: NativeStore
    private let cloud: NativeSavedPinCloud?
    private(set) var sync: NativeFeatureSync?
    private(set) var message: String?
    private var observation: Task<Void, Never>?
    private var scanRequested = false
    private var closed = false
    private let refreshAccess: @MainActor () -> Void
    init(
        store: NativeStore, cloud: NativeSavedPinCloud?,
        refreshAccess: @escaping @MainActor () -> Void = {}
    ) {
        self.store = store
        self.cloud = cloud
        self.refreshAccess = refreshAccess
    }
    func start() async throws {
        sync = NativeFeatureSync(
            label: "Saved pins",
            work: { [weak self] refresh in
                try await self?.synchronize(refresh: refresh)
            }, pause: {})
        observation = Task { [weak self, store] in
            do {
                for await _ in try await store.changes(matching: [.savedPins]) {
                    guard let self, !Task.isCancelled, !self.closed else { return }
                    if try await store.savedPinRetryAt() != nil { self.sync?.request() }
                }
            } catch {
                if !Task.isCancelled {
                    self?.message =
                        "Saved pin delivery could not read its queue. Pending changes are retained."
                }
            }
        }
    }
    private func synchronize(refresh: Bool) async throws -> Date? {
        guard let cloud else { return nil }
        let store = store
        let stop = try await NativeMailroom.drain(
            store: store,
            next: {
                guard let command = try await store.nextSavedPinSubmission() else { return nil }
                return .init(command: command) {
                    let outcome = try await cloud.submit(command)
                    try Task.checkCancellation()
                    try await store.acceptSavedPinOutcome(outcome)
                }
            }, reject: { try await store.rejectSavedPin($0, code: $1) }, continueAfterRejection: true)
        // Same as visits and walks: the server refused access, so stop trusting the local
        // entitlement now rather than at the next five-minute refresh.
        if case .blocked(let access) = stop, access { refreshAccess() }
        if refresh { scanRequested = true }
        if scanRequested {
            for _ in 0..<4 {
                let query = try await store.savedPinChangesQuery()
                let page = try await cloud.changes(query)
                try Task.checkCancellation()
                try await store.acceptSavedPinChanges(page, requested: query)
                if page.next == nil {
                    scanRequested = false
                    break
                }
            }
        }
        if scanRequested { return Date().addingTimeInterval(1) }
        switch stop {
        case .retry(let date): return date
        case .yielded: return Date()
        case .blocked(let access) where access: return nil
        default: return try await store.savedPinRetryAt()
        }
    }
    func close() async {
        closed = true
        observation?.cancel()
        await sync?.close()
        await observation?.value
        await cloud?.transport.close()
    }
}
