import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func requireSavedPinOwner(_ scope: String) throws {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.Metadata>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard !isGuest, rows.count == 1, rows.first?.key == scope else { throw Failure.wrongScope }
    }
    func savedPinRow(_ id: String) throws -> NativeLocalSchema.SavedPin? {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.SavedPin>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1 else { throw Failure.corrupt }
        return rows.first
    }
    func savedPinOperations(_ id: String) throws -> [NativeLocalSchema.PendingOperation] {
        let key = "savedPin:" + id
        return try modelContext.fetch(
            FetchDescriptor<NativeLocalSchema.PendingOperation>(
                predicate: #Predicate { $0.entityKey == key }, sortBy: [SortDescriptor(\.sequence)]))
    }
    func savedPinValue(_ id: String) throws -> (place: SavedPlace?, pending: Bool) {
        guard let row = try savedPinRow(id) else { return (nil, false) }
        if let last = try savedPinOperations(id).last {
            let edit = try JSONDecoder().decode(NativeSavedPinEdit.self, from: last.intent)
            try edit.validate()
            guard edit.pinID == id else { throw Failure.corrupt }
            return (edit.saved ? SavedPlace(native: edit.place, notes: row.localNotes) : nil, true)
        }
        guard let bytes = row.confirmed else { return (nil, false) }
        let value = try JSONDecoder().decode(NativeSavedPin.self, from: bytes)
        try value.validate()
        guard value.id == id, value.revision == row.revision else { throw Failure.corrupt }
        return (value.saved ? SavedPlace(native: value.place, notes: row.localNotes) : nil, false)
    }
    @discardableResult func saveSavedPin(
        _ place: SavedPlace, saved: Bool = true, importing: Bool = false,
        now: Date = Date()
    ) throws -> SavedPlace {
        try requireOpen()
        guard !isGuest, place.id == place.stop.placeIdentity.storageID else { throw Failure.wrongScope }
        let existing = try savedPinRow(place.id)
        // Exactly-account-owned prelaunch files only. Never resurrect a cloud removal
        // or duplicate an already accepted import after an interrupted file retirement.
        if importing, let existing {
            if !place.notes.isEmpty && existing.localNotes != place.notes {
                guard existing.localNotes.isEmpty else { throw Failure.unavailable }
                existing.localNotes = place.notes
                try commit()
            }
            return try savedPinValue(place.id).place ?? place
        }
        let current = try savedPinValue(place.id)
        if saved, let current = current.place { return current }
        if !saved, current.place == nil { return place }
        let edit = NativeSavedPinEdit(saved: saved, place: try place.nativeValue)
        try edit.validate()
        try requireQueueCapacity()
        do {
            let sequence = try nextNativeSequence()
            let row =
                existing
                ?? NativeLocalSchema.SavedPin(id: place.id, sequence: sequence, localNotes: place.notes)
            if existing == nil { modelContext.insert(row) }
            row.changeSequence = sequence
            let operation = NativeLocalSchema.PendingOperation(
                id: UUID().uuidString.lowercased(),
                entityKey: "savedPin:" + place.id, sequence: sequence,
                createdAtMs: try NativeClientTime.milliseconds(now),
                intent: try JSONEncoder().encode(edit), predecessor: nil, expectedRevision: nil)
            operation.listSummary = try JSONEncoder().encode(SavedPinSummary(title: place.name, saved: saved))
            modelContext.insert(operation)
            try commit()
            publish([.savedPins, .pending])
            return place
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    struct SavedPinSummary: Codable {
        let title: String
        let saved: Bool
    }

    func stageSavedPin(_ value: NativeSavedPin) throws {
        try value.validate()
        let existing = try savedPinRow(value.id)
        if let existing, existing.revision >= value.revision {
            if existing.revision == value.revision, let bytes = existing.confirmed {
                let prior = try JSONDecoder().decode(NativeSavedPin.self, from: bytes)
                guard prior.id == value.id, prior.saved == value.saved, prior.place == value.place else {
                    throw Failure.invalidAcknowledgment
                }
            }
            return
        }
        let sequence = try nextNativeSequence()
        let row = existing ?? NativeLocalSchema.SavedPin(id: value.id, sequence: sequence)
        if existing == nil { modelContext.insert(row) }
        row.confirmed = try JSONEncoder().encode(value)
        row.revision = value.revision
        row.changeSequence = sequence
    }
    func savedPinChangesQuery() throws -> NativeChangeQuery {
        try requireOpen()
        guard let row = try savedPinCursor() else { return .init() }
        let value = try JSONDecoder().decode(NativeChangeQuery.self, from: row.request)
        try value.validate()
        return value
    }
    func acceptSavedPinChanges(_ page: NativeSavedPinChanges, requested: NativeChangeQuery) throws {
        try page.validate(for: requested)
        guard try savedPinChangesQuery() == requested else { throw Failure.staleRead }
        do {
            for item in page.items { try stageSavedPin(item) }
            let next =
                page.next.map { NativeChangeQuery(since: requested.since, upper: page.upper, after: $0) }
                ?? .init(since: page.upper)
            let bytes = try JSONEncoder().encode(next)
            if let row = try savedPinCursor() {
                row.request = bytes
            } else {
                modelContext.insert(NativeLocalSchema.SavedPinCursor(request: bytes))
            }
            try commit()
            publish([.savedPins])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    private func savedPinCursor() throws -> NativeLocalSchema.SavedPinCursor? {
        var query = FetchDescriptor<NativeLocalSchema.SavedPinCursor>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1, rows.first == nil || rows.first?.key == "savedPins" else {
            throw Failure.corrupt
        }
        return rows.first
    }
}
