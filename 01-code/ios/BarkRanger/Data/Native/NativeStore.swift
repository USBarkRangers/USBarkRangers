import BarkDomain
import CryptoKit
import Foundation
import SwiftData

/// The native account's sole transactional writer. Models and ModelContext never leave this actor.
@ModelActor actor NativeStore {
    enum Failure: Error {
        case closed, wrongScope, corrupt, unavailable, queueFull, invalidAcknowledgment, staleRead
    }
    struct ProfileView: Equatable, Sendable {
        let confirmed: NativeProfile?
        let visible: NativeProfile?
        let pendingCount: Int
        let pendingIDs: [UUID]
        let failureCode: String?
        let conflict: Bool
        let entitlement: NativeEntitlement?
    }
    var closed = false
    private(set) var isGuest = false
    var beforeSave: (@Sendable () throws -> Void)?
    #if DEBUG
        // Opt-in logical row measurement for integration checks. Never includes values,
        // and adds no model traversal or diagnostic logging in a shipping build.
        var commitObserver: (@Sendable ([String: Int]) -> Void)?
        var tripLibraryReadObserver: (@Sendable (Set<String>) -> Void)?
    #endif
    private var observers: [UUID: AsyncStream<ProfileView>.Continuation] = [:]
    enum Change: Hashable, Sendable {
        case library, tripLibraryPage, tripLibraryReset, tripDrafts, tripEditor
        case trip(String)
        case tripDeleted(String, Int64)
        case draft(String)
        case selection, pending
        case progress, markers, visitHistory, visitHistoryReset
        case visit(String)
        case expedition, activityHistory, activityHistoryReset, completedTrails, completionClaimed
        case activity(String)
    }
    private var entityObservers: [UUID: (Set<Change>, AsyncStream<Set<Change>>.Continuation)] = [:]

    @concurrent static func open(
        directory: URL, project: String, uid: String, guest: Bool = false,
        beforeSave: (@Sendable () throws -> Void)? = nil
    ) async throws -> NativeStore {
        guard ["bark-ranger-ios", "demo-bark-native"].contains(project), !uid.isEmpty else {
            throw Failure.wrongScope
        }
        let scope = "\(project):\(guest ? "guest" : "account"):\(uid)"
        let name = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        let folder = directory.appendingPathComponent("entities-v1").appendingPathComponent(name)
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let schema = Schema(versionedSchema: NativeLocalSchema.self)
        let configuration = ModelConfiguration(
            schema: schema, url: folder.appendingPathComponent("native.store"),
            cloudKitDatabase: .none)
        let container = try ModelContainer(for: schema, configurations: [configuration])
        let store = NativeStore(modelContainer: container)
        try await store.initialize(scope: scope, guest: guest, beforeSave: beforeSave)
        return store
    }

    private func initialize(scope: String, guest: Bool, beforeSave: (@Sendable () throws -> Void)?) throws {
        modelContext.autosaveEnabled = false
        self.beforeSave = beforeSave
        isGuest = guest
        var query = FetchDescriptor<NativeLocalSchema.Metadata>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1, rows.first == nil || rows.first?.key == scope else { throw Failure.wrongScope }
        if rows.isEmpty {
            modelContext.insert(NativeLocalSchema.Metadata(scope: scope))
            try commit()
        }
        _ = try profileView()  // Corrupt local data is an error, never a fresh/empty account.
    }

    func profileView() throws -> ProfileView {
        try requireOpen()
        let baseline = try profileRow().map { try JSONDecoder().decode(NativeProfile.self, from: $0.payload) }
        try baseline?.validate()
        let operations = try profileOperations()
        var visible = baseline
        for operation in operations {
            let edit = try JSONDecoder().decode(NativeProfileEdit.self, from: operation.intent)
            try edit.validate()
            visible = visible.map { edit.applying(to: $0) }
        }
        return ProfileView(
            confirmed: baseline, visible: visible, pendingCount: operations.count,
            pendingIDs: operations.compactMap { UUID(uuidString: $0.id) },
            failureCode: operations.first?.failureCode,
            conflict: operations.contains { $0.state == "conflict" || $0.state == "rejected" },
            entitlement: try readEntitlement())
    }

    func profileUpdates() throws -> AsyncStream<ProfileView> {
        let current = try profileView()
        let id = UUID()
        let (stream, continuation) = AsyncStream<ProfileView>.makeStream(bufferingPolicy: .bufferingNewest(1))
        observers[id] = continuation
        continuation.yield(current)
        continuation.onTermination = { [weak self] _ in Task { await self?.removeObserver(id) } }
        return stream
    }

    func acceptProfile(_ profile: NativeProfile) throws {
        try requireOpen()
        do {
            try upsert(profile)
            try commitProfileChange()
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    func profileRow() throws -> NativeLocalSchema.Profile? {
        var query = FetchDescriptor<NativeLocalSchema.Profile>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1 else { throw Failure.corrupt }
        if let row = rows.first {
            let value = try JSONDecoder().decode(NativeProfile.self, from: row.payload)
            try value.validate()
            guard row.key == "profile", row.revision == value.revision else { throw Failure.corrupt }
        }
        return rows.first
    }

    func upsert(_ profile: NativeProfile) throws {
        try profile.validate()
        let bytes = try JSONEncoder().encode(profile)
        if let row = try profileRow() {
            guard row.revision < profile.revision else {
                if row.revision == profile.revision && row.payload != bytes {
                    let current = try JSONDecoder().decode(NativeProfile.self, from: row.payload)
                    guard current == profile else { throw Failure.corrupt }
                }
                return
            }
            row.revision = profile.revision
            row.payload = bytes
        } else {
            modelContext.insert(NativeLocalSchema.Profile(revision: profile.revision, payload: bytes))
        }
    }

    func requireOpen() throws {
        try Task.checkCancellation()
        if closed { throw Failure.closed }
    }
    func commit() throws {
        do {
            try Task.checkCancellation()
            try beforeSave?()
            #if DEBUG
                var touched: [String: Int] = [:]
                if commitObserver != nil {
                    let models =
                        modelContext.insertedModelsArray + modelContext.changedModelsArray
                        + modelContext.deletedModelsArray
                    var seen = Set<PersistentIdentifier>()
                    for model in models where seen.insert(model.persistentModelID).inserted {
                        touched[String(describing: type(of: model)), default: 0] += 1
                    }
                }
            #endif
            try modelContext.save()
            #if DEBUG
                commitObserver?(touched)
            #endif
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func commitProfileChange() throws {
        // Build the projection before commit, so corrupt dependent rows cannot turn a durable
        // write into a reported failure. Successful publication itself is nonthrowing.
        let value = try profileView()
        try commit()
        for observer in observers.values { observer.yield(value) }
    }
    private func removeObserver(_ id: UUID) { observers.removeValue(forKey: id) }
    func changes(matching interests: Set<Change>) throws -> AsyncStream<Set<Change>> {
        try requireOpen()
        let id = UUID()
        let (stream, continuation) = AsyncStream<Set<Change>>.makeStream(bufferingPolicy: .bufferingNewest(1))
        entityObservers[id] = (interests, continuation)
        continuation.yield([])  // Initial invalidation, not a fabricated completion event.
        continuation.onTermination = { [weak self] _ in Task { await self?.removeEntityObserver(id) } }
        return stream
    }
    private func removeEntityObserver(_ id: UUID) { entityObservers.removeValue(forKey: id) }
    func publish(_ changes: Set<Change>) {
        // Invalidation, not record bodies. Preserve invalidated entity identities
        // when a busy history screen coalesces events, including deleted cache rows.
        for (interests, continuation) in entityObservers.values where !interests.isDisjoint(with: changes) {
            var pending = changes
            while case .dropped(let previous) = continuation.yield(pending) {
                if previous.isSubset(of: pending) { break }
                pending.formUnion(previous)
                if pending.count > 512 {
                    let activities = pending.contains {
                        if case .activity = $0 { return true }
                        return false
                    }
                    let trips = pending.contains {
                        switch $0 {
                        case .trip, .tripDeleted, .draft: return true
                        default: return false
                        }
                    }
                    pending = pending.filter {
                        switch $0 {
                        case .activity, .trip, .tripDeleted, .draft: return false
                        default: return true
                        }
                    }
                    if activities { pending.insert(.activityHistoryReset) }
                    if trips { pending.insert(.tripLibraryReset) }
                }
                // Once reset represents the discarded identities, do not keep
                // reinserting dropped IDs into a full one-element stream buffer.
                if pending.contains(.activityHistoryReset) || pending.contains(.tripLibraryReset) {
                    _ = continuation.yield(pending)
                    break
                }
            }
        }
    }
    func close() {
        closed = true
        for observer in observers.values { observer.finish() }
        observers.removeAll()
        for (_, continuation) in entityObservers.values { continuation.finish() }
        entityObservers.removeAll()
    }
}
