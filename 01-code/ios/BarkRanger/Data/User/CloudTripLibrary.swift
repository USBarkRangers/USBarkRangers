import BarkDomain
@preconcurrency import FirebaseFirestore
import Foundation

/// One account's bounded trip reader. Records leave as events; LocalStore owns all retained content.
actor CloudTripLibrary {
    static let pageSize = 10
    nonisolated let events: AsyncThrowingStream<CloudUserEvent, Error>
    private let outgoing: AsyncThrowingStream<CloudUserEvent, Error>.Continuation
    private let collection: CollectionReference
    private let clock: CloudUserEventClock
    private let recordReads: @Sendable (Int) async -> Void
    private var recent: (any ListenerRegistration)?
    private var active: (any ListenerRegistration)?
    private var activeID: String?
    private var activeToken = UUID()
    private var recentIDs: Set<String>?
    private var recentRevision: UInt64 = 0
    private var cursor: DocumentSnapshot?
    private var hasMore = true
    private var pendingPage: (CloudUserEvent, DocumentSnapshot?, Bool)?
    private var scan = UUID()
    private var verifications: [UUID: Task<Void, Never>] = [:]
    private var worker: Task<Void, Never>?
    private var stopped = false
    #if DEBUG
        var listenerCount: Int { (recent == nil ? 0 : 1) + (active == nil ? 0 : 1) }
    #endif

    private enum Input: @unchecked Sendable {
        case recent(QuerySnapshot, UInt64)
        case active(DocumentSnapshot, UInt64, UUID)
        case activeFailure(any Error, UUID)
    }
    private let incoming: AsyncThrowingStream<Input, Error>.Continuation
    private let inputs: AsyncThrowingStream<Input, Error>

    init(db: Firestore, uid: String, clock: CloudUserEventClock,
         recordReads: @escaping @Sendable (Int) async -> Void) {
        collection = db.collection("users").document(uid).collection("savedRoutes")
        self.clock = clock
        self.recordReads = recordReads
        (events, outgoing) = AsyncThrowingStream.makeStream()
        (inputs, incoming) = AsyncThrowingStream.makeStream()
    }
    private var query: Query {
        collection.order(by: "createdAt", descending: true).order(by: FieldPath.documentID(), descending: true)
    }
    func start(activeID: String?) {
        guard recent == nil, !stopped else { return }
        self.activeID = activeID
        let incoming = incoming, clock = clock
        recent = query.limit(to: Self.pageSize).addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
            if let error { incoming.finish(throwing: error) }
            else if let snapshot, !snapshot.metadata.isFromCache {
                incoming.yield(.recent(snapshot, clock.next()))
            }
        }
        worker = Task { [weak self, inputs] in
            do {
                for try await input in inputs {
                    try Task.checkCancellation()
                    try await self?.receive(input)
                }
            } catch { await self?.fail(error) }
        }
    }
    private func receive(_ input: Input) async throws {
        guard !stopped else { return }
        switch input {
        case .recent(let snapshot, let revision):
            guard revision > recentRevision else { return }
            let first = recentIDs == nil
            let ids = snapshot.documents.map(\.documentID)
            let membershipChanged = recentIDs != Set(ids)
            let departed = (recentIDs ?? []).subtracting(ids)
            let documents = first ? snapshot.documents : snapshot.documentChanges.filter { $0.type != .removed }.map(\.document)
            // Historical field coverage is checked before rollout; reject bad typed timestamps too.
            guard snapshot.documents.allSatisfy({ $0.data()["createdAt"] is Timestamp }) else {
                throw CloudUserDecoder.Failure.incomplete
            }
            let records = try documents.map(CloudUserDecoder.record)
            recentRevision = revision
            recentIDs = Set(ids)
            if membershipChanged {
                // Restart the archive cursor when the head changes, never skip an unseen gap.
                // Already downloaded records stay in LocalStore and are deduplicated by ID.
                scan = UUID()
                pendingPage = nil
                cursor = snapshot.documents.last
                hasMore = snapshot.count == Self.pageSize
            }
            outgoing.yield(CloudUserEvent(change: .tripPage(CloudTripPage(
                id: UUID(), records: records, recentIDs: ids, hasMore: membershipChanged ? hasMore : nil)), revision: revision))
            bindActive()
            for id in departed { verifyExit(id) }
            await recordReads(first ? max(1, snapshot.count) : documents.count)
        case .active(let snapshot, let revision, let token):
            guard token == activeToken, snapshot.documentID == activeID else { return }
            outgoing.yield(try event(snapshot, revision: revision))
            await recordReads(1)
        case .activeFailure(let error, let token):
            guard token == activeToken else { return }
            throw error
        }
    }
    func selectActive(_ id: String?) {
        guard !stopped, id != activeID else { return }
        activeID = id
        bindActive()
    }
    private var observedID: String?
    private func bindActive() {
        guard let recentIDs else { return }
        let wanted = activeID.flatMap { recentIDs.contains($0) ? nil : $0 }
        guard wanted != observedID else { return }
        activeToken = UUID()
        active?.remove()
        active = nil
        observedID = wanted
        guard let wanted else { return }
        let incoming = incoming, clock = clock, token = activeToken
        active = collection.document(wanted).addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
            if let error { incoming.yield(.activeFailure(error, token)) }
            else if let snapshot, !snapshot.metadata.isFromCache {
                incoming.yield(.active(snapshot, clock.next(), token))
            }
        }
    }
    private func verifyExit(_ id: String) {
        let token = UUID(), revision = clock.next()
        let reference = collection.document(id)
        verifications[token] = Task { [weak self] in
            do {
                let result = try await CloudTripQuery.document(reference)
                try Task.checkCancellation()
                await self?.verified(result.snapshot, revision: revision)
            } catch {
                if !Task.isCancelled { await self?.fail(error) }
            }
            await self?.finishedVerification(token)
        }
    }
    private func finishedVerification(_ token: UUID) { verifications[token] = nil }
    private func verified(_ snapshot: DocumentSnapshot, revision: UInt64) async {
        guard !stopped else { return }
        do { outgoing.yield(try event(snapshot, revision: revision)) }
        catch { fail(error) }
        await recordReads(1)
    }
    private func event(_ snapshot: DocumentSnapshot, revision: UInt64) throws -> CloudUserEvent {
        let records = snapshot.exists ? [try CloudUserDecoder.record(snapshot)] : []
        return CloudUserEvent(change: .trips(upserts: records, removed: snapshot.exists ? [] : [snapshot.documentID]), revision: revision)
    }
    func nextPage() async throws -> CloudUserEvent? {
        try Task.checkCancellation()
        guard !stopped, recentIDs != nil else { throw CloudUserClient.Failure.incomplete }
        if let pendingPage { return pendingPage.0 }
        guard hasMore, let cursor else { return nil }
        let revision = clock.next()
        let scan = scan
        let result = try await CloudTripQuery.page(query.start(afterDocument: cursor).limit(to: Self.pageSize))
        try Task.checkCancellation()
        guard !stopped else { throw CancellationError() }
        guard self.scan == scan else { throw CloudUserClient.Failure.incomplete }
        let documents = result.snapshot.documents
        let more = documents.count == Self.pageSize
        let event = CloudUserEvent(change: .tripPage(CloudTripPage(
            id: UUID(), records: try documents.map(CloudUserDecoder.record), recentIDs: nil, hasMore: more)), revision: revision)
        pendingPage = (event, documents.last, more)
        await recordReads(max(1, documents.count))
        return event
    }
    func acceptPage(_ id: UUID) {
        guard let pendingPage, case .tripPage(let page) = pendingPage.0.change, page.id == id else { return }
        cursor = pendingPage.1
        hasMore = pendingPage.2
        self.pendingPage = nil
    }
    private func fail(_ error: any Error) { outgoing.finish(throwing: error) }
    func stop() async {
        guard !stopped else { return }
        stopped = true
        recent?.remove()
        active?.remove()
        recent = nil
        active = nil
        incoming.finish()
        let tasks = Array(verifications.values)
        verifications.removeAll()
        for task in tasks { task.cancel() }
        worker?.cancel()
        await worker?.value
        for task in tasks { await task.value }
        worker = nil
        pendingPage = nil
        cursor = nil
        outgoing.finish()
    }
}
