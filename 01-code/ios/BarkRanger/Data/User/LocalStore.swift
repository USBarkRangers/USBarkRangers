import BarkDomain
import CryptoKit
import Foundation
import SwiftData

/// Sole personal-store writer. No ModelContext or mutable model escapes this actor.
@ModelActor actor LocalStore {
    enum Failure: Error { case closed, wrongAccount, invalidChange, unavailableAccess, queueFull, corrupt }
    private var state: PersonalState?
    private var closed = false
    private var observers: [UUID: AsyncStream<PersonalState>.Continuation] = [:]
    private var beforeSave: (@Sendable () throws -> Void)?

    @concurrent static func open(
        directory: URL, uid: String,
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
        try await store.load(uid: uid, beforeSave: beforeSave)
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
    private func load(uid: String, beforeSave: (@Sendable () throws -> Void)?) throws {
        modelContext.autosaveEnabled = false
        self.beforeSave = beforeSave
        let records = try modelContext.fetch(FetchDescriptor<LocalSchema.AccountRecord>())
        guard records.count <= 1 else { throw Failure.corrupt }
        if let record = records.first {
            let decoded = try JSONDecoder().decode(PersonalState.self, from: record.payload)
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
        continuation.yield(current)
        continuation.onTermination = { [weak self] _ in Task { await self?.removeObserver(id) } }
        return stream
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
    func commit(kind: UserMutation.Kind, value: UserValue, now: Date = Date()) throws {
        var next = try readSnapshot()
        guard next.pending.count < 128 else { throw Failure.queueFull }
        if kind == .profile {
            guard let name = value.string, (2...30).contains(name.utf16.count),
                name == name.trimmingCharacters(in: .whitespacesAndNewlines),
                !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                !name.contains("<"), !name.contains(">")
            else { throw Failure.invalidChange }
        } else {
            guard Entitlement(snapshot: next.baseline, now: now).premium else {
                throw Failure.unavailableAccess
            }
            guard ["default", "satellite"].contains(value.string ?? "") else { throw Failure.invalidChange }
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
    func acknowledge(_ receipt: MutationReceipt) throws {
        var next = try readSnapshot()
        guard receipt.operation.uid == next.baseline.uid else { throw Failure.wrongAccount }
        guard let index = next.pending.firstIndex(where: { $0.id == receipt.operation.id }) else { return }
        guard next.pending[index].operation == receipt.operation else { throw Failure.invalidChange }
        if receipt.outcome == .accepted {
            next.baseline.profile = receipt.operation.applying(to: next.baseline.profile)
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
            }
        }
        // A server read that began before this acknowledgement cannot undo the accepted edit.
        next.readSequence += 1
        next.acceptedSequence = next.readSequence
        try save(next)
    }
    func recordRetry(id: String, now: Date) throws {
        var next = try readSnapshot()
        guard let index = next.pending.firstIndex(where: { $0.id == id }) else { return }
        next.pending[index].attempts += 1
        next.pending[index].retryAt = now.addingTimeInterval(
            min(300, pow(2, Double(min(8, next.pending[index].attempts)))))
        try save(next)
    }
    /// Explicit resolution retains the latest local text until the user chooses which value to keep.
    func resolve(id: String, keepLocal: Bool) throws {
        var next = try readSnapshot()
        guard let pending = next.pending.first(where: { $0.id == id }), pending.receipt != nil else {
            return
        }
        let kind = pending.operation.kind
        let latest =
            next.pending.last(where: { $0.operation.kind == kind })?.operation.value
            ?? pending.operation.value
        next.pending.removeAll { $0.operation.kind == kind }
        if keepLocal {
            guard kind == .profile || Entitlement(snapshot: next.baseline).premium else {
                throw Failure.unavailableAccess
            }
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
        observers.values.forEach { $0.finish() }
        observers.removeAll()
    }
    private func save(_ next: PersonalState) throws {
        guard !closed else { throw Failure.closed }
        do {
            try beforeSave?()
            let bytes = try JSONEncoder().encode(next)
            if let record = try modelContext.fetch(FetchDescriptor<LocalSchema.AccountRecord>()).first {
                record.payload = bytes
            } else {
                modelContext.insert(LocalSchema.AccountRecord(uid: next.baseline.uid, payload: bytes))
            }
            try modelContext.save()
            state = next
            observers.values.forEach { $0.yield(next) }
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
