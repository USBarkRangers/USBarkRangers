import BarkDomain
import Foundation

/// Recoverable local copy, not a cloud mutation. Claims stay in guest storage until the target commits.
nonisolated enum GuestDraftHandoff {
    @concurrent static func adopt(directory: URL, uid: String, into target: LocalStore) async throws {
        let source = try await LocalStore.open(
            directory: directory.appendingPathComponent("GuestDrafts"), uid: "guest-drafts", isGuest: true)
        do {
            let drafts = try await source.claimGuestDrafts(for: uid)
            if !drafts.isEmpty {
                try await target.adoptGuestDrafts(drafts)
                try await source.finishGuestHandoff(for: uid)
            }
            await source.close()
        } catch {
            await source.close()
            throw error
        }
    }
}

extension LocalStore {
    func claimGuestDrafts(for uid: String) throws -> [LegacyTripDraft] {
        try Task.checkCancellation()
        guard isGuest, !uid.isEmpty else { throw Failure.wrongAccount }
        var next = try readSnapshot()
        if let drafts = next.drafts, !drafts.isEmpty {
            var claimed = next.guestDraftTransfers?[uid] ?? []
            claimed.append(contentsOf: drafts.filter { draft in !claimed.contains { $0.id == draft.id } })
            if next.guestDraftTransfers == nil { next.guestDraftTransfers = [:] }
            next.guestDraftTransfers?[uid] = claimed
            next.drafts = []
            next.activeDraftID = nil
            try save(next)
        }
        return next.guestDraftTransfers?[uid] ?? []
    }
    func adoptGuestDrafts(_ drafts: [LegacyTripDraft]) throws {
        try Task.checkCancellation()
        guard !isGuest else { throw Failure.wrongAccount }
        var next = try readSnapshot()
        var current = next.drafts ?? []
        for var draft in drafts where !current.contains(where: { $0.id == draft.id }) {
            try draft.trip.validate(allowEmptyName: true)
            draft.expected = .null  // Guest planning cannot supply a saved-account comparison receipt.
            current.append(draft)
        }
        guard current != next.drafts else { return }
        next.drafts = current
        if next.activeDraftID == nil, next.activeTripCleared != true { next.activeDraftID = current.last?.id }
        try save(next)  // No entitlement grant, baseline replacement or outbox entry.
    }
    func finishGuestHandoff(for uid: String) throws {
        try Task.checkCancellation()
        guard isGuest else { throw Failure.wrongAccount }
        var next = try readSnapshot()
        next.guestDraftTransfers?.removeValue(forKey: uid)
        try save(next)
    }
}
