import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    /// Nil means no content changed. Repeating Save while the same intent is pending reuses its ID.
    @discardableResult func stageTripSave(_ draft: TripDraft, now: Date = Date()) throws -> UUID? {
        try requireNativeTripEditing()
        guard !isGuest, try currentNativeDraft(id: draft.id) == draft else { throw Failure.unavailable }
        var submitted = draft
        let pending = try tripOperations(draft.id)
        if let previous = pending.last {
            let intent = try JSONDecoder().decode(NativeTripIntent.self, from: previous.intent)
            if let prior = intent.savedDraft, prior.trip == draft.trip {
                guard let id = UUID(uuidString: previous.id) else { throw Failure.corrupt }
                return id
            }
            submitted.nativeBase = try intent.projectedBase(for: draft.trip)
        } else if try NativeTripBase.fingerprint(draft.trip) == draft.nativeBase?.contentFingerprint {
            return nil
        }
        let intent: NativeTripIntent =
            try NativeTripNotes(draft: submitted) == nil ? .save(submitted) : .notes(submitted)
        return try stageTripIntent(intent, pending: pending, now: now)
    }

    @discardableResult func stageTripDeletion(id: String, expectedRevision: Int64, now: Date = Date()) throws
        -> UUID
    {
        try requireNativeTripEditing()
        // A library action carries the revision reviewed before confirmation.
        // Cache eviction is not loss of that preimage; never fetch a newer revision
        // and reinterpret the confirmation against it.
        guard !isGuest, expectedRevision > 0, try currentNativeDraft(id: id) == nil else {
            throw Failure.unavailable
        }
        if let metadata = try metadataRow(id), metadata.contentRevision != expectedRevision {
            throw Failure.invalidAcknowledgment
        }
        let pending = try tripOperations(id)
        guard pending.isEmpty else { throw Failure.invalidAcknowledgment }
        return try stageTripIntent(
            .delete(tripID: id, contentRevision: expectedRevision), pending: pending, now: now)
    }

    private func stageTripIntent(
        _ intent: NativeTripIntent, pending: [NativeLocalSchema.PendingOperation], now: Date
    ) throws -> UUID {
        guard try modelContext.fetchCount(FetchDescriptor<NativeLocalSchema.PendingOperation>()) < 128 else {
            throw Failure.queueFull
        }
        do {
            let id = try insertTripIntent(intent, predecessor: pending.last?.id, now: now)
            if case .delete = intent, try selectionRow()?.tripID == intent.tripID {
                try stageNativeSelection(tripID: nil, dayID: nil)
            }
            try commit()
            publish([.pending, .library, .trip(intent.tripID), .selection])
            return id
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// Stages one validated operation. Admission, transaction commit and publication belong to the caller.
    func insertTripIntent(_ intent: NativeTripIntent, predecessor: String?, now: Date) throws -> UUID {
        try intent.validate()
        let milliseconds = now.timeIntervalSince1970 * 1000
        guard milliseconds.isFinite, (0...9_007_199_254_740_991).contains(milliseconds) else {
            throw Failure.corrupt
        }
        let bytes = try JSONEncoder().encode(intent)
        guard bytes.count <= 1_000_000 else { throw Failure.queueFull }
        let preview = NativeTripCommand(
            operationID: UUID(), createdAtMs: Int64(milliseconds),
            expectedRevision: intent.baseRevision, intent: intent)
        guard try JSONEncoder().encode(preview).count <= 400_000 else { throw Trip.Failure.sizeLimit }
        let id = UUID()
        let row = NativeLocalSchema.PendingOperation(
            id: id.uuidString.lowercased(), entityKey: "trip:\(intent.tripID)",
            sequence: try nextNativeSequence(), createdAtMs: Int64(milliseconds), intent: bytes,
            predecessor: predecessor, expectedRevision: predecessor == nil ? intent.baseRevision : nil)
        let summary: NativeTripListItem
        switch intent {
        case .save(let draft), .notes(let draft):
            summary = .init(trip: draft.trip)
            row.draftFingerprint = try NativeTripBase.fingerprint(draft.trip)
        case .delete(let tripID, _):
            summary = .init(id: tripID, title: "", dayCount: 0, stopCount: 0, deleted: true)
        }
        row.listSummary = try JSONEncoder().encode(summary)
        modelContext.insert(row)
        return id
    }

    func nextTripSubmission(id: String, now: Date = Date()) throws -> Submission? {
        try requireOpen()
        guard !isGuest, let row = try tripOperations(id).first,
            ["queued", "sealed"].contains(row.state), row.nextAttemptAt <= now
        else { return nil }
        guard row.predecessor == nil, let operationID = UUID(uuidString: row.id),
            let expected = row.expectedRevision
        else {
            throw Failure.corrupt
        }
        if let bytes = row.sealedBytes {
            return Submission(id: operationID, bytes: bytes, attempts: row.attempts)
        }
        do {
            let intent = try JSONDecoder().decode(NativeTripIntent.self, from: row.intent)
            let command = NativeTripCommand(
                operationID: operationID, createdAtMs: row.createdAtMs, expectedRevision: expected,
                intent: intent)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            let bytes = try encoder.encode(command)
            guard bytes.count <= 400_000 else { throw Trip.Failure.sizeLimit }
            row.sealedBytes = bytes
            row.state = "sealed"
            try commit()  // A retry never re-encodes or silently changes this envelope.
            return Submission(id: operationID, bytes: bytes, attempts: row.attempts)
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    func tripOperations(_ id: String) throws -> [NativeLocalSchema.PendingOperation] {
        let key = "trip:\(id)"
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.entityKey == key },
            sortBy: [SortDescriptor(\.sequence)])
        query.fetchLimit = 129
        let rows = try modelContext.fetch(query)
        guard rows.count <= 128 else { throw Failure.corrupt }
        for (index, row) in rows.enumerated() {
            guard UUID(uuidString: row.id) != nil, row.sequence > 0, row.attempts >= 0,
                row.predecessor == (index == 0 ? nil : rows[index - 1].id),
                ["queued", "sealed", "conflict", "rejected"].contains(row.state),
                (row.state == "queued") == (row.sealedBytes == nil),
                row.predecessor == nil || (row.state == "queued" && row.expectedRevision == nil)
            else { throw Failure.corrupt }
            let intent = try JSONDecoder().decode(NativeTripIntent.self, from: row.intent)
            try intent.validate()
            guard intent.tripID == id,
                row.expectedRevision == nil || row.expectedRevision == intent.baseRevision
            else { throw Failure.corrupt }
        }
        return rows
    }

}
