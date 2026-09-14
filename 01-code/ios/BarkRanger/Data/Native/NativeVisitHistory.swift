import BarkDomain
import Foundation
import Observation
import SwiftData

/// Only the history screen requests pages. Loaded rows are display snapshots;
/// edits must capture a matching typed selection from the writer before confirmation.
@MainActor @Observable final class NativeVisitHistory {
    nonisolated struct Item: Equatable, Sendable, Identifiable {
        let visit: NativeVisitDraft
        let revision: Int64
        var id: String { visit.id }
    }
    let repository: NativeVisitRepository
    private(set) var items: [Item] = []
    private(set) var loading = false
    private(set) var hasMore = true
    private(set) var message: String?
    private var cursor: NativeVisitPage.Cursor?
    private var loaded = false
    private var pageTask: Task<Void, Never>?
    private var generation = UUID()
    private var pageGeneration = UUID()

    init(repository: NativeVisitRepository) { self.repository = repository }
    func observe() async {
        let token = generation
        do {
            for await changes in try await repository.store.changes(matching: [.visitHistory]) {
                guard !Task.isCancelled, generation == token else { return }
                let reset = changes.contains(.visitHistoryReset)
                let value = try await repository.store.presentVisitHistory(reset ? [] : items)
                guard !Task.isCancelled, generation == token else { return }
                items = value
                if reset {
                    pageGeneration = UUID()
                    pageTask?.cancel()
                    pageTask = nil
                    loading = false
                    cursor = nil
                    hasMore = true
                    loaded = false
                }
                if !loaded { loadMore() }
            }
        } catch {
            if !Task.isCancelled, generation == token { message = "Saved visit history could not be read." }
        }
    }
    func loadMore() {
        guard pageTask == nil, hasMore else { return }
        let token = generation
        let pageToken = pageGeneration
        let cursor = cursor
        loading = true
        pageTask = Task {
            defer {
                if generation == token, pageGeneration == pageToken {
                    loading = false
                    pageTask = nil
                }
            }
            do {
                let page = try await repository.history(before: cursor)
                guard !Task.isCancelled, generation == token, pageGeneration == pageToken else { return }
                var all = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
                for record in page.items where (all[record.id]?.revision ?? 0) <= record.revision {
                    if let draft = NativeVisitDraft(record: record) {
                        all[record.id] = .init(visit: draft, revision: record.revision)
                    }
                }
                let value = try await repository.store.presentVisitHistory(Array(all.values))
                guard !Task.isCancelled, generation == token, pageGeneration == pageToken else { return }
                self.cursor = page.next
                hasMore = page.next != nil
                loaded = true
                items = value
                message = nil
            } catch {
                if !Task.isCancelled, generation == token, pageGeneration == pageToken {
                    message = "More visits could not be loaded. Downloaded history is retained."
                    loaded = true
                }
            }
        }
    }
    func stop() {
        generation = UUID()
        pageGeneration = UUID()
        pageTask?.cancel()
        pageTask = nil
        loading = false
        items = []
        cursor = nil
        loaded = false
        hasMore = true
        message = nil
    }
}

extension NativeStore {
    func presentVisitHistory(_ prior: [NativeVisitHistory.Item]) throws -> [NativeVisitHistory.Item] {
        try requireOpen()
        var items: [String: NativeVisitHistory.Item] = [:]
        // One bounded cache read, not a SQLite lookup per displayed archive row.
        // Official-site markers are a separate compact index, not visit history.
        var query = FetchDescriptor<NativeLocalSchema.Visit>()
        query.fetchLimit = 251
        let records = try modelContext.fetch(query).map(decodeVisit)
        guard records.count <= 250 else { throw Failure.corrupt }
        let cachedByID = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })
        var markers: [String: NativePlaceProgress] = [:]
        var after = ""
        while true {
            let page = try nativeMarkers(after: after)
            for marker in page { markers[marker.id] = marker }
            guard page.count == 100, let last = page.last else { break }
            after = last.id
        }
        let recent = records.filter { !$0.deleted }.sorted {
            let left = $0.details?.happenedAtMs ?? 0
            let right = $1.details?.happenedAtMs ?? 0
            return left == right ? $0.id > $1.id : left > right
        }.prefix(50).compactMap { record in
            NativeVisitDraft(record: record).map {
                NativeVisitHistory.Item(visit: $0, revision: record.revision)
            }
        }
        for item in prior + recent {
            let cached = cachedByID[item.id]
            if cached?.deleted == true { continue }
            let draft = cached.flatMap(NativeVisitDraft.init(record:)) ?? item.visit
            let revision = cached?.revision ?? item.revision
            if let marker = markers[draft.siteID],
                marker.visitID != draft.id || (marker.visitRevision ?? 0) > revision
            {
                continue
            }
            if (items[draft.siteID]?.revision ?? 0) <= revision {
                items[draft.siteID] = .init(visit: draft, revision: revision)
            }
        }
        // Each pending body is decoded once; no per-row replay of the whole queue.
        for entry in try visitQueue() {
            for change in try visitOperation(entry.id).changes {
                items[change.intent.target.siteID] = change.after.map {
                    .init(visit: $0, revision: change.intent.target.visitRevision + 1)
                }
            }
        }
        return items.values.sorted {
            $0.visit.happenedAtMs == $1.visit.happenedAtMs
                ? $0.id > $1.id : $0.visit.happenedAtMs > $1.visit.happenedAtMs
        }
    }
    func selectVisitHistory(_ items: [NativeVisitHistory.Item]) throws -> [NativeVisitWorkingState] {
        try requireOpen()
        let sites = Set(items.map { $0.visit.siteID })
        guard (1...500).contains(items.count), sites.count == items.count else { throw Failure.unavailable }
        let queue = try visitQueue()
        let pending = try visitPendingChanges(siteIDs: sites, queue: queue)
        let blocked = visitBlockedSites(queue)
        return try items.map { item in
            let draft = item.visit
            let current = try visitWorkingState(
                siteID: draft.siteID, officialPlaceID: draft.officialPlaceID,
                pending: pending[draft.siteID], needsDecision: blocked.contains(draft.siteID))
            guard current.visitID == draft.id, current.visitRevision == item.revision,
                current.draft == nil || current.draft == draft, !current.needsDecision
            else {
                throw Failure.unavailable
            }
            // Cache eviction is allowed. The displayed body is still bound to its
            // exact slot/event revision; never substitute a newer fetched body.
            return .init(
                officialPlaceID: current.officialPlaceID, siteID: current.siteID,
                visitID: current.visitID, visitRevision: current.visitRevision,
                placeRevision: current.placeRevision, draft: draft,
                pendingOperationID: current.pendingOperationID, needsDecision: false)
        }
    }
}

extension NativeVisitRepository {
    @concurrent func selectHistory(_ items: [NativeVisitHistory.Item]) async throws
        -> [NativeVisitWorkingState]
    {
        try Task.checkCancellation()
        do { return try await store.selectVisitHistory(items) } catch NativeStore.Failure.unavailable {
            guard let cloud, (1...500).contains(items.count) else { throw NativeStore.Failure.unavailable }
            let references = items.map {
                NativeVisitReference(
                    visitID: $0.id, officialPlaceID: $0.visit.officialPlaceID, siteID: $0.visit.siteID)
            }
            let selection = try await cloud.selection(references)
            try Task.checkCancellation()
            try await store.acceptNativeVisitSelection(selection, requested: references)
            return try await store.selectVisitHistory(items)
        }
    }
}
