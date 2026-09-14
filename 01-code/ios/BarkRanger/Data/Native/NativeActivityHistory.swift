import BarkDomain
import Foundation
import Observation

/// Paged display snapshots owned by the history screen. Selections retain their
/// exact revision; page eviction never authorizes editing a different server value.
@MainActor @Observable final class NativeActivityHistory {
    let repository: NativeExpeditionRepository
    private(set) var items: [NativeActivityDraft] = []
    private(set) var loading = false
    private(set) var hasMore = true
    private(set) var message: String?
    private(set) var hasConfirmedPage = false
    private var cursor: NativeActivityPage.Cursor?
    private var loaded = false
    private var pageTask: Task<Void, Never>?
    private var generation = UUID()
    private var pageGeneration = UUID()

    init(repository: NativeExpeditionRepository) { self.repository = repository }
    func observe() async {
        let token = generation
        do {
            for await changes in try await repository.store.changes(matching: [.activityHistory]) {
                guard !Task.isCancelled, generation == token else { return }
                let reset = changes.contains(.activityHistoryReset)
                let removed = Set(
                    changes.compactMap { change -> String? in
                        if case .activity(let id) = change { return id }
                        return nil
                    })
                let value = try await repository.store.presentActivityHistory(
                    reset ? [] : items, changed: removed)
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
                    hasConfirmedPage = false
                }
                if !loaded { loadMore() }
            }
        } catch {
            if !Task.isCancelled, generation == token { message = "Saved walk history could not be read." }
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
                    all[record.id] = try NativeActivityDraft(record: record)
                }
                let value = try await repository.store.presentActivityHistory(Array(all.values))
                guard !Task.isCancelled, generation == token, pageGeneration == pageToken else { return }
                self.cursor = page.next
                hasMore = page.next != nil
                loaded = true
                hasConfirmedPage = true
                items = value
                message = nil
            } catch {
                if !Task.isCancelled, generation == token, pageGeneration == pageToken {
                    message = "More walks could not be loaded. Downloaded history is retained."
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
        hasConfirmedPage = false
        message = nil
    }
}

extension NativeStore {
    func presentActivityHistory(_ prior: [NativeActivityDraft], changed: Set<String> = []) throws
        -> [NativeActivityDraft]
    {
        try requireOpen()
        var items = Dictionary(uniqueKeysWithValues: prior.map { ($0.id, $0) })
        for id in changed {
            items[id] = try nativeActivity(id: id).flatMap { try NativeActivityDraft(record: $0) }
        }
        for record in try nativeActivityHistory() {
            if (items[record.id]?.revision ?? 0) <= record.revision {
                items[record.id] = try NativeActivityDraft(record: record)
            }
        }
        for entry in try expeditionQueue() {
            let operation = try expeditionOperation(entry.id)
            if let id = operation.action.activityID { items[id] = try operation.afterActivity() }
        }
        return items.values.sorted {
            $0.happenedAtMs == $1.happenedAtMs ? $0.id > $1.id : $0.happenedAtMs > $1.happenedAtMs
        }
    }
}
