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
    private let diagnostics: Diagnostics
    private var accepted: CatalogDiskStore.Envelope?
    private var state = State()
    private var observers: [UUID: AsyncStream<State>.Continuation] = [:]
    private var inFlight: Task<Void, Never>?
    private var refreshID: UUID?
    private var etag: String?
    private var nextRegular = ContinuousClock.now
    private var nextRetry = ContinuousClock.now
    private var serverRetry = ContinuousClock.now
    private var failures = 0

    init(
        disk: CatalogDiskStore, client: CatalogHTTPClient?, validator: CatalogValidator = CatalogValidator(),
        diagnostics: Diagnostics = Diagnostics()
    ) {
        self.disk = disk
        self.client = client
        self.validator = validator
        self.diagnostics = diagnostics
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
        for candidate in disk.loadCandidates(diagnostics: diagnostics).sorted(by: {
            $0.envelope.manifest.revision > $1.envelope.manifest.revision
        }) {
            do {
                let snapshot = try validator.decodeAndValidate(
                    bytes: candidate.envelope.payload, manifest: candidate.envelope.manifest)
                accepted = candidate.envelope
                state.snapshot = snapshot
                state.index = ParkSearchIndex(parks: snapshot.parks)
                state.source = candidate.source
                break
            } catch {
                diagnostics.catalogFailure(
                    Self.failureReason(error, at: .localValidation), at: .localValidation)
            }
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
        guard !Task.isCancelled else { return }
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
        let id = UUID()
        let task = Task { await self.performRefresh(client) }
        refreshID = id
        inFlight = task
        await task.value
        if refreshID == id {
            inFlight = nil
            refreshID = nil
        }
    }
    func cancelRefresh() async {
        guard let task = inFlight else { return }
        let id = refreshID
        task.cancel()
        await task.value
        if refreshID == id {
            inFlight = nil
            refreshID = nil
        }
    }

    private func performRefresh(_ client: CatalogHTTPClient) async {
        guard !Task.isCancelled else { return }
        _ = loadLocal()
        state.status = .checking
        publish()
        var stage = Diagnostics.CatalogStage.manifest
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
                    stage = .payload
                    let bytes = try await client.download(manifest, deadline: deadline)
                    let snapshot = try validator.decodeAndValidate(
                        bytes: bytes, manifest: manifest, baseline: state.snapshot)
                    try Task.checkCancellation()
                    let envelope = CatalogDiskStore.Envelope(manifest: manifest, payload: bytes)
                    stage = .commit
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
            diagnostics.catalogFailure(
                Self.failureReason(Task.isCancelled ? CancellationError() : error, at: stage), at: stage)
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
    /// Catalog-specific errors are classified here; the logger never depends on catalog services.
    nonisolated static func failureReason(_ error: any Error, at stage: Diagnostics.CatalogStage)
        -> Diagnostics.CatalogFailure
    {
        let reason: Diagnostics.CatalogFailure
        switch error {
        case is CancellationError: reason = .cancelled
        case let error as URLError:
            reason = error.code == .cancelled ? .cancelled : error.code == .timedOut ? .deadline : .network
        case CatalogHTTPClient.Failure.deadline: reason = .deadline
        case CatalogHTTPClient.Failure.response: reason = .response
        case CatalogHTTPClient.Failure.size: reason = .size
        case CatalogHTTPClient.Failure.retryAfter: reason = .retryAfter
        case CatalogHTTPClient.Failure.unavailable: reason = .network
        case CatalogValidator.Rejection.metadata: reason = .metadata
        case CatalogValidator.Rejection.hash: reason = .hash
        case CatalogValidator.Rejection.identity: reason = .identity
        case CatalogValidator.Rejection.fields: reason = .fields
        case CatalogValidator.Rejection.links: reason = .links
        case CatalogValidator.Rejection.removedIdentity: reason = .removedIdentity
        case CatalogValidator.Rejection.revision: reason = .revision
        case is DecodingError: reason = .decoding
        default: reason = stage == .commit ? .storage : .unknown
        }
        return reason
    }
}
