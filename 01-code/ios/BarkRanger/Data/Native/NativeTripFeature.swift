import BarkDomain
import Foundation
import Observation

/// Account-owned trip resources, not an editor or identity owner. Holds only library
/// metadata; ActiveTripSession is the only owner of selected editable content.
@MainActor @Observable final class NativeTripFeature {
    let scope: String
    let repository: NativeTripRepository
    private(set) var library = TripLibraryContent()
    private(set) var conflicts: [String] = []
    private(set) var selectedID: String?
    private(set) var revision = 0
    private var localMessage: String?
    var message: String? { localMessage ?? sync?.message }
    private(set) var loading = false
    private(set) var hasMore: Bool
    private let worker: NativeTripSync?
    private var summaries: [NativeTripMetadata] = []
    private var cursor: NativeTripPage.Cursor?
    private var headLoaded = false
    private var observation: Task<Void, Never>?
    private var sync: NativeFeatureSync?
    private var pageTask: Task<Void, Never>?
    private var permitted = false
    private var closed = false
    private var changeScanPending = false
    private var pendingIDs: [String] = []
    private var localLists = NativeStore.TripLists(drafts: [], pending: [], conflicts: [])
    // Deletion floors only for previously displayed rows. They prevent an older page
    // reply reviving a removed row after its reconstructible disk metadata was evicted.
    private var removedRevisions: [String: Int64] = [:]

    init(scope: String, store: NativeStore, cloud: NativeTripCloud?) {
        self.scope = scope
        repository = NativeTripRepository(store: store, cloud: cloud)
        worker = cloud.map { NativeTripSync(store: store, cloud: $0) }
        hasMore = cloud != nil
        if let worker {
            sync = NativeFeatureSync(
                label: "Trips",
                work: { [weak self] refresh in
                    try await self?.synchronize(refresh: refresh)
                }, pause: { await worker.pause() })
        }
    }

    func start() async throws {
        let changes = try await repository.store.changes(
            matching: [.library, .tripLibraryReset, .tripDrafts, .tripEditor, .selection, .pending])
        summaries = try await repository.store.tripMetadataPage()
        try await reloadLocal(changes: [.tripDrafts, .selection, .pending])
        observation = Task { [weak self] in
            do {
                for await change in changes {
                    guard let self, !Task.isCancelled, !self.closed else { return }
                    if change.isEmpty { continue }
                    let previous = self.pendingIDs
                    try await self.reloadLocal(changes: change)
                    if !Set(self.pendingIDs).subtracting(previous).isEmpty {
                        self.requestSync()
                    }
                }
            } catch {
                guard let self, !Task.isCancelled, !self.closed else { return }
                self.localMessage = "Trips could not be read. Your saved files are retained."
            }
        }
    }

    private func reloadLocal(changes: Set<NativeStore.Change>) async throws {
        let previousSelection = selectedID
        let reset = changes.contains(.tripLibraryReset)
        if reset {
            // A reset also invalidates a page already in flight; it must not restore
            // the discarded page cursor after the bounded library reload.
            pageTask?.cancel()
            await pageTask?.value
        }
        let ids = Set(
            changes.compactMap { change -> String? in
                switch change {
                case .trip(let id), .draft(let id), .tripDeleted(let id, _): id
                default: nil
                }
            })
        // Drafts/outbox have fixed device bounds. A checkpoint never re-fetches the
        // metadata for every paged library row, nor publishes an unchanged library.
        let listsChanged = !changes.isDisjoint(with: [.library, .tripDrafts, .pending, .tripLibraryReset])
        let local =
            listsChanged
            ? try await repository.store.tripLocalLists() : localLists
        let selection =
            changes.contains(.selection) || reset
            ? try await repository.store.nativeSelection().tripID : selectedID
        let pending =
            changes.contains(.pending) || reset
            ? try await repository.store.tripPendingOperationIDs() : pendingIDs
        let presented = changes.contains(.library) ? Set(summaries.map(\.id) + local.drafts.map(\.id)) : []
        let metadataIDs = changes.contains(.tripLibraryPage) ? ids : ids.intersection(presented)
        let updates =
            changes.contains(.library) && !reset
            ? try await repository.store.tripMetadataUpdates(ids: metadataIDs) : .init()
        let replacement = reset ? try await repository.store.tripMetadataPage() : nil
        try Task.checkCancellation()
        guard !closed else { return }
        if let replacement {
            summaries = replacement
            removedRevisions = [:]
            cursor = nil
            headLoaded = false
            hasMore = repository.cloud != nil
        }
        if !updates.absentIDs.isEmpty { summaries.removeAll { updates.absentIDs.contains($0.id) } }
        if !updates.values.isEmpty { merge(updates.values) }
        for change in changes {
            guard case .tripDeleted(let id, let revision) = change,
                presented.contains(id) || removedRevisions[id] != nil,
                (summaries.first(where: { $0.id == id })?.revision ?? 0) <= revision
            else { continue }
            removedRevisions[id] = max(removedRevisions[id] ?? 0, revision)
            summaries.removeAll { $0.id == id }
        }
        selectedID = selection
        pendingIDs = pending
        localLists = local
        conflicts = local.conflicts
        if listsChanged {
            let next = TripLibraryContent(local: local, saved: summaries.filter { !$0.deleted })
            if next != library { library = next }
        }
        // This revision belongs to selected editor state, not unrelated library pagination.
        if previousSelection != selectedID || reset
            || selectedID.map({ ids.contains($0) }) == true
        {
            revision += 1
        }
    }

    /// AccountSession alone supplies readiness/connectivity.
    func setNetworkAllowed(_ allowed: Bool) {
        guard !closed else { return }
        permitted = allowed
        sync?.setAllowed(allowed)
        if !allowed { pageTask?.cancel() }
    }
    func requestSync(refresh: Bool = false) { sync?.request(refresh: refresh) }

    private func synchronize(refresh: Bool) async throws -> Date? {
        guard let worker, let cloud = repository.cloud else { return nil }
        try await worker.resume()
        let refresh = refresh || changeScanPending
        if refresh {
            let page = try await cloud.library()
            try Task.checkCancellation()
            let accepted = try await repository.store.acceptTripLibraryPage(page)
            try Task.checkCancellation()
            merge(accepted)
            if !headLoaded {
                cursor = page.next
                hasMore = page.next != nil
                headLoaded = true
            }
        }
        var retryAt: Date?
        for id in try await repository.store.pendingTripIDs() {
            try Task.checkCancellation()
            if case .retry(let date) = try await worker.synchronize(id) {
                retryAt = min(retryAt ?? date, date)
            }
        }
        // The selected editor alone downloads detail; summary refresh only invalidates stamps.
        if refresh {
            changeScanPending = true
            for _ in 0..<4 {
                let query = try await repository.store.tripChangesQuery()
                let page = try await cloud.changes(query)
                try Task.checkCancellation()
                if try await repository.store.acceptTripChanges(page, requested: query) {
                    if query.since == nil { try await reloadLibraryAfterRebuild(cloud) }
                    changeScanPending = false
                    break
                }
            }
        }
        try await reloadLocal(changes: [.tripDrafts, .pending, .selection])
        localMessage = nil
        if changeScanPending { return min(retryAt ?? .distantFuture, Date().addingTimeInterval(1)) }
        return retryAt
    }

    func loadMore() {
        guard !loading, hasMore, !closed else { return }
        guard permitted, let cloud = repository.cloud else {
            localMessage = "Connect to the internet to load more trips. Downloaded trips are still available."
            return
        }
        loading = true
        let cursor = cursor
        pageTask = Task {
            defer {
                self.loading = false
                self.pageTask = nil
            }
            do {
                let page = try await cloud.library(before: cursor)
                try Task.checkCancellation()
                let accepted = try await self.repository.store.acceptTripLibraryPage(page)
                try Task.checkCancellation()
                guard !self.closed else { return }
                self.merge(accepted)
                self.cursor = page.next
                self.hasMore = page.next != nil
                self.headLoaded = true
                try await self.reloadLocal(changes: [.tripDrafts, .pending, .selection])
                self.localMessage = nil
            } catch {
                if !Task.isCancelled, !self.closed {
                    self.localMessage = "More trips could not be loaded. Try again."
                }
            }
        }
    }

    private func reloadLibraryAfterRebuild(_ cloud: NativeTripCloud) async throws {
        // A completed replacement scan invalidates old presentation pages too.
        // Missing cache rows otherwise mean eviction, not deletion; don't infer
        // deletion from that ambiguity or keep a ghost from an expired tombstone.
        pageTask?.cancel()
        await pageTask?.value
        try Task.checkCancellation()
        loading = true
        defer { loading = false }
        let page = try await cloud.library()
        try Task.checkCancellation()
        let accepted = try await repository.store.acceptTripLibraryPage(page)
        try Task.checkCancellation()
        summaries = accepted
        removedRevisions = [:]
        cursor = page.next
        hasMore = page.next != nil
        headLoaded = true
    }

    private func merge(_ values: [NativeTripMetadata]) {
        var byID = Dictionary(uniqueKeysWithValues: summaries.map { ($0.id, $0) })
        for value in values
        where (byID[value.id]?.revision ?? 0) <= value.revision
            && (removedRevisions[value.id] ?? 0) < value.revision
        { byID[value.id] = value }
        summaries = byID.values.sorted {
            $0.createdAt == $1.createdAt ? $0.id > $1.id : $0.createdAt > $1.createdAt
        }
    }
    func close() async {
        closed = true
        permitted = false
        pageTask?.cancel()
        observation?.cancel()
        await sync?.close()
        await pageTask?.value
        await observation?.value
        await worker?.stop()
    }
    func waitForSync() async { await sync?.wait() }
}
