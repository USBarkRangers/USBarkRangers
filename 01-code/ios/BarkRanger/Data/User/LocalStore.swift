import BarkDomain
import CryptoKit
import Foundation
import SwiftData

/// Sole personal-store writer. No ModelContext or mutable model escapes this actor.
@ModelActor actor LocalStore {
    enum Failure: Error { case closed, wrongAccount, invalidChange, unavailableAccess, queueFull, corrupt }
    private var state: PersonalState?
    private var closed = false
    private var cloudRevisions: [String: UInt64] = [:]
    private(set) var isGuest = false
    private var observers: [UUID: AsyncStream<PersonalState>.Continuation] = [:]
    private var beforeSave: (@Sendable () throws -> Void)?

    @concurrent static func open(
        directory: URL, uid: String, isGuest: Bool = false,
        beforeSave: (@Sendable () throws -> Void)? = nil
    ) async throws -> LocalStore {
        guard !uid.isEmpty else { throw Failure.wrongAccount }
        let name = SHA256.hash(data: Data(uid.utf8)).map { String(format: "%02x", $0) }.joined()
        let folder = directory.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let schema = Schema(versionedSchema: LocalSchema.self)
        let config = ModelConfiguration(
            schema: schema, url: folder.appendingPathComponent("account.store"),
            cloudKitDatabase: .none)
        let container = try ModelContainer(for: schema, configurations: [config])
        let store = LocalStore(modelContainer: container)
        try await store.load(uid: uid, isGuest: isGuest, beforeSave: beforeSave)
        return store
    }
    @concurrent static func removeAccount(directory: URL, uid: String) async throws {
        guard !uid.isEmpty else { throw Failure.wrongAccount }
        let name = SHA256.hash(data: Data(uid.utf8)).map { String(format: "%02x", $0) }.joined()
        let folder = directory.appendingPathComponent(name, isDirectory: true)
        if FileManager.default.fileExists(atPath: folder.path) {
            try FileManager.default.removeItem(at: folder)
        }
    }
    private func load(uid: String, isGuest: Bool, beforeSave: (@Sendable () throws -> Void)?) throws {
        modelContext.autosaveEnabled = false
        self.beforeSave = beforeSave
        self.isGuest = isGuest
        let records = try modelContext.fetch(FetchDescriptor<LocalSchema.AccountRecord>())
        guard records.count <= 1 else { throw Failure.corrupt }
        if let record = records.first {
            let decoded = try PersonalPayload.decode(record.payload)
            guard record.uid == uid, decoded.baseline.uid == uid,
                decoded.pending.allSatisfy({ $0.operation.uid == uid })
            else { throw Failure.wrongAccount }
            guard decoded.pending.count <= 128, Set(decoded.pending.map(\.id)).count == decoded.pending.count,
                decoded.readSequence >= 0, (0...decoded.readSequence).contains(decoded.acceptedSequence),
                decoded.pending.allSatisfy({
                    UUID(uuidString: $0.id) != nil && $0.attempts >= 0
                        && ($0.receipt == nil || $0.receipt?.operation == $0.operation)
                })
            else { throw Failure.corrupt }
            state = decoded
        } else {
            try save(PersonalState(uid: uid))
        }
    }
    func readSnapshot() throws -> PersonalState {
        guard !closed, let state else { throw Failure.closed }
        return state
    }
    func updates() throws -> AsyncStream<PersonalState> {
        let current = try readSnapshot()
        let id = UUID()
        let (stream, continuation) = AsyncStream<PersonalState>.makeStream(
            bufferingPolicy: .bufferingNewest(1))
        observers[id] = continuation
        continuation.yield(published(current))
        continuation.onTermination = { [weak self] _ in Task { await self?.removeObserver(id) } }
        return stream
    }
    private func published(_ state: PersonalState) -> PersonalState {
        var result = state
        result.guestDraftTransfers = nil
        return result
    }
    private func removeObserver(_ id: UUID) { observers.removeValue(forKey: id) }
    func beginRead() throws -> Int64 {
        var next = try readSnapshot()
        next.readSequence += 1
        try save(next)
        return next.readSequence
    }
    func applyServerSnapshot(_ snapshot: PersonalSnapshot, sequence: Int64) throws {
        var next = try readSnapshot()
        guard snapshot.uid == next.baseline.uid else { throw Failure.wrongAccount }
        guard sequence > next.acceptedSequence, sequence <= next.readSequence else { return }
        next.baseline = snapshot
        next.acceptedSequence = sequence
        try save(next)
    }
    /// Apply a server delta atomically; drafts/outbox and unrelated collections remain intact.
    func applyCloudEvent(_ event: CloudUserEvent) throws {
        try Task.checkCancellation()
        var next = try readSnapshot()
        let change = event.change
        let newer = Set(
            change.keys.union(["all"]).filter {
                cloudRevisions[$0].map { $0 >= event.revision } == true
            })
        let accepted: CloudUserChange?
        if change.isInitial { accepted = change } else { accepted = change.excluding(newer) }
        guard let change = accepted else { return }
        next.baseline = try change.applying(to: next.baseline)
        next.tripLibrary = change.libraryState(after: next.tripLibrary)
        next.readSequence += 1
        next.acceptedSequence = next.readSequence
        try save(next)
        if change.isInitial { cloudRevisions.removeAll() }
        for key in change.keys { cloudRevisions[key] = event.revision }
    }
    func requireEditing(draft: Bool = false, now: Date = Date()) throws {
        let access = AccountDataAccess(
            entitlement: Entitlement(snapshot: try readSnapshot().baseline, now: now), isGuest: isGuest)
        guard draft ? access.canEditDrafts : access.canEditAccount else { throw Failure.unavailableAccess }
    }
    func commit(kind: UserMutation.Kind, value: UserValue, now: Date = Date()) throws {
        try requireEditing(now: now)
        var next = try readSnapshot()
        guard next.pending.count < 128 else { throw Failure.queueFull }
        switch kind {
        case .profile:
            guard let name = value.string, (2...30).contains(name.utf16.count),
                name == name.trimmingCharacters(in: .whitespacesAndNewlines),
                !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                !name.contains("<"), !name.contains(">")
            else { throw Failure.invalidChange }
        case .mapStyle:
            guard ["default", "satellite"].contains(value.string ?? "") else { throw Failure.invalidChange }
        case .visits, .trip, .activity, .expedition: throw Failure.invalidChange
        }
        let profile = next.visible.profile
        let operation = UserMutation(
            uid: next.baseline.uid, kind: kind,
            expected: kind == .profile ? profile.profileContent : profile.mapStyleContent,
            value: value, now: now)
        guard operation.applying(to: profile) != profile else { return }
        next.pending.append(PendingMutation(operation: operation))
        try save(next)
    }
    func acknowledge(_ receipt: MutationReceipt, cloudRevision: UInt64? = nil) throws {
        var next = try readSnapshot()
        guard receipt.operation.uid == next.baseline.uid else { throw Failure.wrongAccount }
        guard let index = next.pending.firstIndex(where: { $0.id == receipt.operation.id }) else { return }
        guard next.pending[index].operation == receipt.operation else { throw Failure.invalidChange }
        if receipt.outcome == .accepted {
            next.baseline = receipt.operation.applying(to: next.baseline)
            next.pending.remove(at: index)
        } else {
            next.pending[index].receipt = receipt
            // A conflict contains authoritative touched content too. Publish it to the baseline
            // now; a subsequent fresh read may advance it again before the user resolves.
            if receipt.operation.kind == .profile, let fields = receipt.current.object {
                for key in ["displayName", "username"] { next.baseline.profile.fields[key] = fields[key] }
            } else if receipt.operation.kind == .mapStyle {
                var settings = next.baseline.profile.settings
                settings["mapStyle"] = receipt.current
                next.baseline.profile.fields["settings"] = .object(settings)
            } else if receipt.operation.kind == .expedition, let fields = receipt.current.object {
                for key in ExpeditionPolicy.keys { next.baseline.profile.fields[key] = fields[key] }
            } else if receipt.operation.kind == .visits {
                next.baseline = receipt.operation.replacingValue(receipt.current, expected: .null).applying(
                    to: next.baseline)
            } else if receipt.operation.kind == .trip, let id = receipt.operation.value.object?["id"] {
                next.baseline = receipt.operation.replacingValue(
                    .object(["id": id, "record": receipt.current]), expected: .null
                )
                .applying(to: next.baseline)
            }
        }
        // A server read that began before this acknowledgement cannot undo the accepted edit.
        next.readSequence += 1
        next.acceptedSequence = next.readSequence
        try save(next)
        // Page/verification reads stamped before this receipt cannot undo its authoritative result.
        if let cloudRevision {
            for key in receipt.operation.entityKeys { cloudRevisions[key] = cloudRevision }
        }
    }
    func recordRetry(id: String, now: Date, notBefore: Date? = nil) throws {
        var next = try readSnapshot()
        guard let index = next.pending.firstIndex(where: { $0.id == id }) else { return }
        next.pending[index].attempts += 1
        next.pending[index].retryAt = now.addingTimeInterval(
            min(300, pow(2, Double(min(8, next.pending[index].attempts)))))
        if let notBefore, let backoff = next.pending[index].retryAt {
            next.pending[index].retryAt = max(backoff, notBefore)
        }
        try save(next)
    }
    /// Explicit resolution retains the latest local text until the user chooses which value to keep.
    func resolve(id: String, keepLocal: Bool) throws {
        var next = try readSnapshot()
        guard let pending = next.pending.first(where: { $0.id == id }), pending.receipt != nil else {
            return
        }
        let kind = pending.operation.kind
        if kind == .expedition {
            try resolveExpedition(id: id, keepLocal: keepLocal)
            return
        }
        if kind == .visits || kind == .trip || kind == .activity {
            try resolveAdventure(pending, keepLocal: keepLocal)
            return
        }
        let latest =
            next.pending.last(where: { $0.operation.kind == kind })?.operation.value
            ?? pending.operation.value
        next.pending.removeAll { $0.operation.kind == kind }
        if keepLocal {
            try requireEditing()
            next.pending.append(
                PendingMutation(
                    operation: UserMutation(
                        uid: next.baseline.uid, kind: kind,
                        expected: kind == .profile
                            ? next.baseline.profile.profileContent : next.baseline.profile.mapStyleContent,
                        value: latest)))
        }
        try save(next)
    }
    func close() {
        closed = true
        state = nil
        for observer in observers.values { observer.finish() }
        observers.removeAll()
    }
    func save(_ next: PersonalState) throws {
        guard !closed else { throw Failure.closed }
        do {
            try beforeSave?()
            let bytes = try PersonalPayload.encode(next)
            if let record = try modelContext.fetch(FetchDescriptor<LocalSchema.AccountRecord>()).first {
                record.payload = bytes
            } else {
                modelContext.insert(LocalSchema.AccountRecord(uid: next.baseline.uid, payload: bytes))
            }
            try modelContext.save()
            state = next
            for observer in observers.values { observer.yield(published(next)) }
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
