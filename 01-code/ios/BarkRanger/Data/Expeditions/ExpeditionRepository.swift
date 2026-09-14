import BarkDomain
import Foundation

/// Account-scoped expedition intents use the existing store and exact-receipt queue, never a parallel database.
nonisolated struct ExpeditionRepository: Sendable {
    let store: LocalStore
    @concurrent func apply(action: String, payload: UserValue, id: String = UUID().uuidString.lowercased())
        async throws
    {
        try await store.changeExpedition(action: action, payload: payload, id: id)
    }
    @concurrent func commitWalk(_ summary: WalkSummary) async throws {
        try await store.changeExpedition(action: "walk", payload: summary.value, id: summary.id)
    }
    @concurrent func resolve(id: String, keepLocal: Bool) async throws {
        try await store.resolveExpedition(id: id, keepLocal: keepLocal)
    }
}

extension LocalStore {
    func changeExpedition(action: String, payload: UserValue, id: String) throws {
        try Task.checkCancellation()
        try requireEditing()
        var next = try readSnapshot()
        // Recovery after staging but before deleting a recording file must not stage the same walk twice.
        if next.pending.contains(where: { $0.id == id }) { return }
        if action == "walk",
            Expedition(profile: next.visible.profile).fields["native_walk_ids"]?.array?
                .contains(.string(id)) == true
        {
            return
        }
        let operation = try ExpeditionPolicy.operation(
            action: action, payload: payload, snapshot: next.visible, id: id)
        guard next.pending.count < 128 else { throw Failure.queueFull }
        next.pending.append(PendingMutation(operation: operation))
        try save(next)
    }
    func resolveExpedition(id: String, keepLocal: Bool) throws {
        try Task.checkCancellation()
        var next = try readSnapshot()
        let pending = next.pending.filter { $0.operation.kind == .expedition }
        guard pending.first?.id == id, pending.first?.receipt != nil else { throw Failure.invalidChange }
        next.pending.removeAll { $0.operation.kind == .expedition }
        if keepLocal {
            try requireEditing()
            for item in pending {
                guard let action = item.operation.value.object?["action"]?.string,
                    let payload = item.operation.value.object?["payload"]
                else { throw Failure.invalidChange }
                let rebuilt = try ExpeditionPolicy.operation(
                    action: action, payload: payload, snapshot: next.visible)
                next.pending.append(PendingMutation(operation: rebuilt))
            }
        }
        try save(next)
    }
}
