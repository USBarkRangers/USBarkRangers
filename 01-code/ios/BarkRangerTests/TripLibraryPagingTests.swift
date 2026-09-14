import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct TripLibraryPagingTests {
    private func record(_ id: String, seconds: Double = 100) -> SavedRecord {
        var fields = Trip(id: id, name: id).content.object ?? [:]
        fields["createdAt"] = .object(["seconds": .number(seconds), "nanoseconds": .number(0)])
        fields["unknown"] = .string("Preserve")
        return SavedRecord(id: id, fields: fields)
    }
    private func page(_ records: [SavedRecord], more: Bool = true, recent: [String]? = nil, revision: UInt64) -> CloudUserEvent {
        .init(change: .tripPage(.init(id: UUID(), records: records, recentIDs: recent, hasMore: more)), revision: revision)
    }
    @Test func partialBootstrapAndReconnectPreserveArchivedDataDraftsOutboxAndClearedSelection() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "paging")
        try await store.seedPremium()
        let archived = record("archived")
        try await store.applyCloudEvent(.init(change: .trips(upserts: [archived], removed: []), revision: 1))
        let draft = LegacyTripDraft(trip: Trip(name: "Unsaved guest-origin draft"))
        try await store.saveDraft(draft)
        try await store.commit(kind: .profile, value: .string("Pending name"))
        try await store.clearActiveTrip(expectedID: draft.id)
        let before = try await store.readSnapshot()
        let head = record("recent", seconds: 200)
        var partial = before.baseline
        partial.trips = [head]
        for revision: UInt64 in [2, 20] {
            try await store.applyCloudEvent(.init(change: .bootstrap(partial, .init(recentIDs: [head.id], hasMore: true)), revision: revision))
            let state = try await store.readSnapshot()
            #expect(Set(state.baseline.trips.map(\.id)) == [archived.id, head.id])
            #expect(state.drafts == before.drafts && state.pending == before.pending)
            #expect(state.selectedTripID == nil && state.activeTripCleared == true)
            #expect(state.baseline.trips.first { $0.id == archived.id } == archived)
            #expect(state.tripLibrary?.hasMore == true)
        }
        await store.close()
        let reopened = try await LocalStore.open(directory: folder, uid: "paging")
        #expect(try await reopened.readSnapshot().baseline.trips.count == 2)
        #expect(try await reopened.readSnapshot().drafts == before.drafts)
        await reopened.close()
    }
    @Test func latePagesCannotUndoAcceptedEditsOrResurrectDeletedTrips() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "late-page")
        try await store.seedPremium()
        let old = record("old")
        try await store.applyCloudEvent(page([old], revision: 1))
        var trip = try Trip(record: old)
        trip.name = "New name"
        let repository = TripRepository(store: store)
        let draft = LegacyTripDraft(trip: trip, expected: old.tripContent)
        try await repository.saveDraft(draft)
        try await repository.save(id: draft.id)
        let operation = try #require(try await store.readSnapshot().pending.first?.operation)
        try await store.acknowledge(.init(operation: operation, outcome: .accepted, current: operation.expected), cloudRevision: 20)
        try await store.applyCloudEvent(page([old], revision: 10))
        #expect(try await store.readSnapshot().baseline.trips.first?.fields["tripName"] == .string("New name"))
        try await repository.delete(id: draft.id)
        let deletion = try #require(try await store.readSnapshot().pending.first?.operation)
        try await store.acknowledge(.init(operation: deletion, outcome: .accepted, current: deletion.expected), cloudRevision: 40)
        try await store.applyCloudEvent(page([old], more: false, revision: 30))
        #expect(try await store.readSnapshot().baseline.trips.isEmpty)
        #expect(try await store.readSnapshot().tripLibrary?.hasMore == false)
        await store.close()
    }
    @Test func windowEvictionIsNotDeletionAndMetadataCannotOverwriteAnIndependentPageEnd() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "window")
        let old = record("old"), new = record("new")
        try await store.applyCloudEvent(page([old], recent: [old.id], revision: 1))
        try await store.applyCloudEvent(.init(change: .tripPage(.init(
            id: UUID(), records: [new], recentIDs: [new.id], hasMore: nil)), revision: 30))
        try await store.applyCloudEvent(page([], more: false, revision: 20))
        let state = try await store.readSnapshot()
        #expect(Set(state.baseline.trips.map(\.id)) == [old.id, new.id])
        #expect(state.tripLibrary == TripLibraryState(recentIDs: [new.id], hasMore: false))
        try await store.applyCloudEvent(.init(change: .trips(upserts: [], removed: [old.id]), revision: 40))
        #expect(try await store.readSnapshot().baseline.trips == [new])
        await store.close()
    }
    @Test func sharedRowsPreferDraftsAndKeepTheRepositoryPageOrder() throws {
        let saved = try ["newest", "b", "a"].map {
            try #require(nativeTripSnapshot(Trip(id: $0, name: $0), revision: 1).metadata)
        }
        let local = NativeStore.TripLists(drafts: [.init(id: "a", title: "Unsaved edits", dayCount: 1, stopCount: 0)],
            pending: [], conflicts: [])
        let content = TripLibraryContent(local: local, saved: saved)
        #expect(content.rows.map(\.id) == ["a", "newest", "b"])
        #expect(content.rows.first?.name == "Unsaved edits")
        #expect(content.saved.allSatisfy { $0.contentRevision == 1 })
    }
    @Test func repeatedPageRequestsCoalesceAndPauseDiscardsLateReplies() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "controlled")
        let cloud = HeldTripCloud(record: record("next"))
        let engine = SyncEngine(store: store, cloud: cloud, uid: "controlled", allowsMutations: false)
        #expect(await engine.flush())
        let a = Task { try await engine.loadMoreTrips() }
        try await eventually { await cloud.requests == 1 }
        let b = Task { try await engine.loadMoreTrips() }
        await Task.yield()
        await cloud.release()
        try await a.value
        try await b.value
        #expect(await cloud.requests == 1)
        #expect(await cloud.accepted == 1)
        #expect(try await store.readSnapshot().baseline.trips.count == 1)
        let pending = Task { try await engine.loadMoreTrips() }
        try await eventually { await cloud.requests == 2 }
        let stopping = Task { await engine.pause() }
        await Task.yield()
        await cloud.release()
        await stopping.value
        _ = try? await pending.value
        #expect(await cloud.accepted == 1)
        await store.close()
    }
}

private actor HeldTripCloud: CloudUserTransport {
    let record: SavedRecord
    private var waiting: CheckedContinuation<Void, Never>?
    private(set) var requests = 0
    private(set) var accepted = 0
    init(record: SavedRecord) { self.record = record }
    func release() { waiting?.resume(); waiting = nil }
    func changes(uid: String, previous: PersonalSnapshot) async throws -> AsyncThrowingStream<CloudUserEvent, Error> {
        AsyncThrowingStream { $0.yield(.init(change: .bootstrap(previous, .init()), revision: 1)) }
    }
    func loadMoreTrips(uid: String) async throws -> CloudUserEvent? {
        requests += 1
        await withCheckedContinuation { waiting = $0 }
        return .init(change: .tripPage(.init(id: UUID(), records: [record], recentIDs: nil, hasMore: true)), revision: UInt64(requests + 1))
    }
    func acceptTripPage(uid: String, id: UUID) { accepted += 1 }
    func submit(_ operation: UserMutation) async throws -> MutationReceipt { throw CancellationError() }
    func reconcile(uid: String, operations: [UserMutation]) async throws -> [CloudUserEvent] { [] }
    func accountAction(_ action: ExistingAccountAction, uid: String) async throws -> URL? { nil }
}
