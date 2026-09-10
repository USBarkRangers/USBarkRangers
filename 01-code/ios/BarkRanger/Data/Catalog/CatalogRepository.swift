import BarkDomain
import Foundation

/// The sole catalog writer. Actor isolation serializes revision acceptance and coalesces refreshes.
actor CatalogRepository {
    enum Status: Sendable, Equatable { case saved, checking, fresh, offline, unavailable, notConfigured }
    enum Reason: Sendable { case startup, foreground, regular, reconnect, manual }
    struct State: Sendable {
        var snapshot: CatalogSnapshot?
        var index: ParkSearchIndex?
        var source: CatalogSource = .bundle
        var status: Status = .saved
        var checkedAt: Date?
    }
    private let disk: CatalogDiskStore
    private let client: CatalogHTTPClient?
    private let validator: CatalogValidator
    private var accepted: CatalogDiskStore.Envelope?
    private var state = State()
    private var observers: [UUID: AsyncStream<State>.Continuation] = [:]
    private var inFlight: Task<Void, Never>?
    private var etag: String?
    private var nextRegular = ContinuousClock.now
    private var nextRetry = ContinuousClock.now
    private var serverRetry = ContinuousClock.now
    private var failures = 0

    init(disk: CatalogDiskStore, client: CatalogHTTPClient?, validator: CatalogValidator = CatalogValidator())
    {
        self.disk = disk
        self.client = client
        self.validator = validator
    }
    func current() -> State { state }
    /// The lifecycle sleeps until this owner's next permitted request, not a separate retry policy.
    func nextRefreshDelay() -> Duration {
        guard client != nil else { return .seconds(60) }
        return max(.seconds(1), ContinuousClock.now.duration(to: max(nextRegular, nextRetry, serverRetry)))
    }
    func updates() -> AsyncStream<State> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<State>.makeStream(bufferingPolicy: .bufferingNewest(1))
        observers[id] = continuation
        continuation.yield(state)
        continuation.onTermination = { [weak self] _ in Task { await self?.removeObserver(id) } }
        return stream
    }
    private func removeObserver(_ id: UUID) { observers[id] = nil }
    private func publish() { for continuation in observers.values { continuation.yield(state) } }

    @discardableResult
    func loadLocal() -> State {
        guard state.snapshot == nil else { return state }
        for candidate in disk.loadCandidates().sorted(by: {
            $0.envelope.manifest.revision > $1.envelope.manifest.revision
        }) {
            guard
                let snapshot = try? validator.decodeAndValidate(
                    bytes: candidate.envelope.payload, manifest: candidate.envelope.manifest)
            else { continue }
            accepted = candidate.envelope
            state.snapshot = snapshot
            state.index = ParkSearchIndex(parks: snapshot.parks)
            state.source = candidate.source
            break
        }
        state.status = client == nil ? .notConfigured : .saved
        publish()
        return state
    }
    func noteOffline() {
        if inFlight == nil {
            state.status = .offline
            publish()
        }
    }
    func refresh(reason: Reason) async {
        if let inFlight {
            await inFlight.value
            return
        }
        guard let client else {
            state.status = .notConfigured
            publish()
            return
        }
        let now = ContinuousClock.now
        guard now >= serverRetry else { return }
        if reason != .manual && reason != .reconnect && reason != .startup && now < nextRegular { return }
        if now < nextRetry { return }
        // Reconnect can bypass regular cadence, but never a server Retry-After or rapid failure loop.
        let task = Task { await self.performRefresh(client) }
        inFlight = task
        await task.value
        inFlight = nil
    }
    func cancelRefresh() { inFlight?.cancel() }

    private func performRefresh(_ client: CatalogHTTPClient) async {
        _ = loadLocal()
        state.status = .checking
        publish()
        do {
            let deadline = ContinuousClock.now.advanced(by: .seconds(10))
            switch try await client.fetchManifest(etag: etag, deadline: deadline) {
            case .unchanged:
                guard accepted != nil else { throw CatalogHTTPClient.Failure.response }
            case .changed(let manifest, let newETag):
                try validator.validateManifest(manifest)
                if let accepted, manifest.revision == accepted.manifest.revision {
                    guard manifest == accepted.manifest else { throw CatalogValidator.Rejection.revision }
                } else {
                    if let accepted, manifest.revision < accepted.manifest.revision {
                        throw CatalogValidator.Rejection.revision
                    }
                    let bytes = try await client.download(manifest, deadline: deadline)
                    let snapshot = try validator.decodeAndValidate(
                        bytes: bytes, manifest: manifest, baseline: state.snapshot)
                    try Task.checkCancellation()
                    let envelope = CatalogDiskStore.Envelope(manifest: manifest, payload: bytes)
                    try disk.commit(envelope, previous: accepted)
                    accepted = envelope
                    state.snapshot = snapshot
                    state.index = ParkSearchIndex(parks: snapshot.parks)
                    state.source = .online
                }
                etag = newETag
            }
            try Task.checkCancellation()
            failures = 0
            state.status = .fresh
            state.checkedAt = Date()
            nextRegular = .now.advanced(by: .seconds(60))
            nextRetry = .now
        } catch {
            if Task.isCancelled {
                state.status = .saved
                publish()
                return
            }
            nextRegular = .now
            failures = min(failures + 1, 8)
            let delay = min(pow(2, Double(failures)), 300) + Double.random(in: 0...1)
            nextRetry = .now.advanced(by: .seconds(delay))
            if case CatalogHTTPClient.Failure.retryAfter(let seconds) = error {
                serverRetry = .now.advanced(by: .seconds(seconds))
            }
            state.status = .unavailable
        }
        publish()
    }
}
