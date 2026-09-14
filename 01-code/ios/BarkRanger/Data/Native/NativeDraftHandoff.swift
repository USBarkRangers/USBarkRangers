import BarkDomain
import Foundation
import SwiftData

/// A recoverable local move, never an automatic account save/upload. Claim before
/// copying; acknowledge only after the destination commits. Both paths are device-owned.
nonisolated enum NativeDraftHandoff {
    @concurrent static func adopt(directory: URL, project: String, uid: String, into target: NativeStore)
        async throws
    {
        let source = try await NativeStore.open(
            directory: directory, project: project, uid: "guest-drafts", guest: true)
        do {
            let drafts = try await source.claimDeviceDrafts(for: uid)
            try await target.adoptDeviceDrafts(drafts, source: "guest")
            try await source.finishDeviceDraftHandoff(for: uid)
            await source.close()
        } catch {
            await source.close()
            throw error
        }
    }
}

extension NativeStore {
    func claimDeviceDrafts(for uid: String) throws -> [TripDraft] {
        try requireOpen()
        guard isGuest, !uid.isEmpty else { throw Failure.wrongScope }
        let query = FetchDescriptor<NativeLocalSchema.Draft>(
            predicate: #Predicate {
                $0.transferOwner == nil || $0.transferOwner == uid
            })
        do {
            let rows = try modelContext.fetch(query)
            let drafts = try rows.map { try JSONDecoder().decode(TripDraft.self, from: $0.bytes) }
            for row in rows { row.transferOwner = uid }
            if rows.contains(where: { $0.id == (try? selectionRow()?.tripID) }) {
                try stageNativeSelection(tripID: nil, dayID: nil)
            }
            try commit()
            return drafts
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func adoptDeviceDrafts(_ drafts: [TripDraft], source: String) throws {
        try requireOpen()
        do {
            var selected: String?
            for var draft in drafts {
                let key = source + ":" + draft.id
                let receipt = FetchDescriptor<NativeLocalSchema.DraftImport>(
                    predicate: #Predicate { $0.id == key })
                if try modelContext.fetchCount(receipt) > 0 { continue }
                try draft.trip.validate(allowEmptyName: true)
                draft.nativeBase = .init()
                if let existing = try draftRow(draft.id) {
                    // A collision is not permission to merge or discard personal notes.
                    guard try JSONDecoder().decode(TripDraft.self, from: existing.bytes) == draft else {
                        throw Failure.invalidAcknowledgment
                    }
                } else {
                    modelContext.insert(
                        NativeLocalSchema.Draft(
                            id: draft.id, editRevision: 1, title: draft.trip.name,
                            dayCount: draft.trip.days.count, stopCount: draft.trip.totalStops, dirty: true,
                            bytes: try JSONEncoder().encode(draft)))
                    selected = draft.id
                }
                modelContext.insert(NativeLocalSchema.DraftImport(key))
            }
            // Explicitly cleared selection is retained; only a brand-new scope adopts selection.
            if try selectionRow() == nil, let selected {
                let draft = drafts.first { $0.id == selected }
                try stageNativeSelection(tripID: selected, dayID: draft?.activeDayID)
            }
            try commit()
            if !drafts.isEmpty { publish([.selection, .library]) }
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func finishDeviceDraftHandoff(for uid: String) throws {
        try requireOpen()
        guard isGuest else { throw Failure.wrongScope }
        do {
            let query = FetchDescriptor<NativeLocalSchema.Draft>(
                predicate: #Predicate { $0.transferOwner == uid })
            for row in try modelContext.fetch(query) { modelContext.delete(row) }
            try commit()
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
