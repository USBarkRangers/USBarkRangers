import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    /// Small queue metadata only; no trip bodies or pin text is decoded to select work.
    func savedPinHeads() throws -> [NativeLocalSchema.PendingOperation] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(sortBy: [SortDescriptor(\.sequence)])
        query.propertiesToFetch = [\.id, \.entityKey, \.sequence, \.state, \.nextAttemptAt, \.attempts]
        var seen = Set<String>()
        return try modelContext.fetch(query).filter {
            $0.entityKey.hasPrefix("savedPin:") && seen.insert($0.entityKey).inserted
        }
    }
    func savedPinRetryAt() throws -> Date? {
        try savedPinHeads().filter { ["queued", "sealed"].contains($0.state) }.map(\.nextAttemptAt).min()
    }
    func nextSavedPinSubmission(now: Date = Date()) throws -> Submission? {
        guard !isGuest,
            let row = try savedPinHeads().first(where: {
                ["queued", "sealed"].contains($0.state) && $0.nextAttemptAt <= now
            }), let id = UUID(uuidString: row.id)
        else { return nil }
        if let bytes = row.sealedBytes { return .init(id: id, bytes: bytes, attempts: row.attempts) }
        let edit = try JSONDecoder().decode(NativeSavedPinEdit.self, from: row.intent)
        try edit.validate()
        guard row.entityKey == "savedPin:" + edit.pinID, row.state == "queued" else { throw Failure.corrupt }
        struct Command: Encodable {
            let version = 1
            let kind = "setSavedPin"
            let expectedRevision = 0
            let operationID: String
            let createdAtMs: Int64
            let payload: NativeSavedPinEdit
        }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            let bytes = try encoder.encode(
                Command(operationID: row.id, createdAtMs: row.createdAtMs, payload: edit))
            guard bytes.count <= 16_384 else { throw Failure.corrupt }
            row.sealedBytes = bytes
            row.state = "sealed"
            try commit()
            return .init(id: id, bytes: bytes, attempts: row.attempts)
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func rejectSavedPin(_ id: UUID, code: String) throws {
        guard NativeMailroom.rejectionCodes.contains(code), let row = try operation(id),
            row.entityKey.hasPrefix("savedPin:"), row.state == "sealed"
        else { throw Failure.corrupt }
        row.state = "rejected"
        row.failureCode = code
        try commit()
        publish([.pending, .savedPins])
    }
    func acceptSavedPinOutcome(_ outcome: NativeSavedPinCloud.Outcome) throws {
        try requireOpen()
        try outcome.validate()
        guard let row = try operation(outcome.operationID), row.state == "sealed", row.sealedBytes != nil,
            row.entityKey == "savedPin:" + outcome.confirmation.id
        else { throw Failure.invalidAcknowledgment }
        let intent = try JSONDecoder().decode(NativeSavedPinEdit.self, from: row.intent)
        guard intent.saved == outcome.confirmation.saved,
            try savedPinOperations(intent.pinID).first?.id == row.id
        else { throw Failure.invalidAcknowledgment }
        do {
            try stageSavedPin(outcome.confirmation)
            // A later remote revision may already be cached. Removing this accepted
            // predecessor must still refresh the local pending-color projection.
            guard let pin = try savedPinRow(intent.pinID) else { throw Failure.corrupt }
            pin.changeSequence = try nextNativeSequence()
            modelContext.delete(row)
            try commit()
            publish([.pending, .savedPins])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
