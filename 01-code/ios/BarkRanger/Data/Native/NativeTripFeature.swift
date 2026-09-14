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
    private(set) var message: String?
    private(set) var loading = false
    private(set) var hasMore: Bool
    private let worker: NativeTripSync?
    private var summaries: [NativeTripMetadata] = []
    private var cursor: NativeTripPage.Cursor?
    private var headLoaded = false
    private var observation: Task<Void, Never>?
    private var synchronization: Task<Void, Never>?
    private var pageTask: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var drain: Task<Void, Never>?
    private var permitted = false
    private var closed = false
    private var requested = false
    private var refreshRequested = false
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
                self.message = "Trips could not be read. Your saved files are retained."
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

    /// AccountSession supplies readiness/connectivity. No observer may reopen a paused scope.
    func setNetworkAllowed(_ allowed: Bool) {
        guard !closed, permitted != allowed else { return }
        permitted = allowed
        if allowed { requestSync(refresh: true) } else { pause() }
    }

    func requestSync(refresh: Bool = false) {
        guard permitted, !closed, let worker, let cloud = repository.cloud else { return }
        requested = true
        refreshRequested = refreshRequested || refresh
        guard synchronization == nil else { return }
        retry?.cancel()
        let previousDrain = drain
        synchronization = Task { [weak self] in
            await previousDrain?.value
            guard let self, !Task.isCancelled, !self.closed else { return }
            var retryAt: Date?
            do {
                try await worker.resume()
                repeat {
                    self.requested = false
                    let refresh = self.refreshRequested
                    self.refreshRequested = false
                    if refresh {
                        let page = try await cloud.library()
                        try Task.checkCancellation()
                        let accepted = try await self.repository.store.acceptTripLibraryPage(page)
                        try Task.checkCancellation()
                        self.merge(accepted)
                        if !self.headLoaded {
                            self.cursor = page.next
                            self.hasMore = page.next != nil
                            self.headLoaded = true
                        }
                    }
                    let ids = try await self.repository.store.pendingTripIDs()
                    for id in ids {
                        try Task.checkCancellation()
                        let result = try await worker.synchronize(id)
                        if case .retry(let date) = result { retryAt = min(retryAt ?? date, date) }
                    }
                    // Metadata invalidates exact cache stamps. The active editor's
                    // repository alone loads stale/missing detail, on demand. Foreground
                    // and selection changes must not independently download it again.
                    if refresh {
                        // Page/cursor commits are resumable. Selected content is useful first;
                        // a large archive never has to download before the editor opens.
                        for pageIndex in 0..<4 {
                            let query = try await self.repository.store.tripChangesQuery()
                            let page = try await cloud.changes(query)
                            try Task.checkCancellation()
                            if try await self.repository.store.acceptTripChanges(page, requested: query) {
                                if query.since == nil { try await self.reloadLibraryAfterRebuild(cloud) }
                                break
                            }
                            if pageIndex == 3 { self.refreshRequested = true }
                        }
                    }
                    try await self.reloadLocal(changes: [.tripDrafts, .pending, .selection])
                    self.message = nil
                } while self.requested && !Task.isCancelled
            } catch {
                guard !Task.isCancelled, !self.closed else { return }
                self.message = "Trip sync could not finish. Your drafts and saved changes are retained."
                if NativeProfileCloud.isTransient(error) { retryAt = Date().addingTimeInterval(30) }
            }
            guard !Task.isCancelled, !self.closed else { return }
            self.synchronization = nil
            if self.refreshRequested {
                self.scheduleRetry(at: Date().addingTimeInterval(1))
            } else if let retryAt {
                self.scheduleRetry(at: retryAt)
            }
        }
    }

    func loadMore() {
        guard !loading, hasMore, !closed else { return }
        guard permitted, let cloud = repository.cloud else {
            message = "Connect to the internet to load more trips. Downloaded trips are still available."
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
                self.message = nil
            } catch {
                if !Task.isCancelled, !self.closed {
                    self.message = "More trips could not be loaded. Try again."
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
    private func scheduleRetry(at date: Date) {
        retry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(1, date.timeIntervalSinceNow))) } catch { return }
            self?.requestSync()
        }
    }
    private func pause() {
        let sync = synchronization
        let page = pageTask
        sync?.cancel()
        page?.cancel()
        retry?.cancel()
        synchronization = nil
        requested = false
        let previous = drain
        let worker = worker
        drain = Task {
            await previous?.value
            await worker?.pause()
            await sync?.value
            await page?.value
        }
    }
    func close() async {
        closed = true
        permitted = false
        pause()
        observation?.cancel()
        await observation?.value
        await drain?.value
        await worker?.stop()
    }
    func waitForSync() async { await synchronization?.value }
}
