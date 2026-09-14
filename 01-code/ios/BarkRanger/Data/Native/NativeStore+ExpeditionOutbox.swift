import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    /// Recorder cleanup may follow only a successful durable return. Repeating an
    /// identical handoff reuses its queued operation even after later corrections.
    @discardableResult func stageNativeExpeditionOperation(
        _ value: NativeExpeditionOperation, now: Date = Date()
    ) throws -> UUID {
        try requireOpen()
        try value.validate()
        let queue = try expeditionQueue()
        if case .record(let summary) = value.action {
            for entry in queue where entry.keys.writes.contains("activity:\(summary.activityID)") {
                if case .record(let existing) = try expeditionOperation(entry.id).action {
                    guard existing == summary else { throw Failure.invalidAcknowledgment }
                    return entry.id
                }
            }
        }
        // Replaying an already durable handoff above does not require renewed paid
        // access. New authored work does; no entitlement is fabricated for testing.
        guard !isGuest, try readEntitlement()?.permitsEditing(at: now) == true,
            try profileView().confirmed?.status == .active
        else { throw Failure.unavailable }
        if let before = value.beforeActivity {
            try requireActivityPreimage(before, queue: queue)
        }
        guard try modelContext.fetchCount(FetchDescriptor<NativeLocalSchema.PendingOperation>()) < 128 else {
            throw Failure.queueFull
        }
        do {
            let id = UUID()
            let milliseconds = try NativeClientTime.milliseconds(now)
            let bytes = try JSONEncoder().encode(value)
            guard bytes.count <= 16_384,
                try value.commandBytes(id: id, createdAtMs: milliseconds).count <= 8192
            else { throw Failure.queueFull }
            let row = NativeLocalSchema.PendingOperation(
                id: id.uuidString.lowercased(), entityKey: "expedition",
                sequence: try nextNativeSequence(), createdAtMs: milliseconds, intent: bytes,
                predecessor: nil, expectedRevision: nil)
            row.listSummary = try JSONEncoder().encode(value.keys)
            modelContext.insert(row)
            try commit()
            var changes: Set<Change> = [.pending, .expedition, .activityHistory]
            if let activityID = value.action.activityID { changes.insert(.activity(activityID)) }
            publish(changes)
            return id
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    private func requireActivityPreimage(
        _ before: NativeActivityDraft, queue: [ExpeditionQueueEntry]
    ) throws {
        let relevant = queue.filter { $0.keys.writes.contains("activity:\(before.id)") }
        guard !relevant.contains(where: \.needsDecision) else { throw Failure.unavailable }
        if let previous = relevant.last {
            guard try expeditionOperation(previous.id).afterActivity() == before else {
                throw Failure.unavailable
            }
        } else {
            guard let cached = try nativeActivity(id: before.id),
                try NativeActivityDraft(record: cached) == before
            else { throw Failure.unavailable }
        }
    }
    /// Individual history selections include pending authored values without loading
    /// or rewriting the activity archive or treating pending totals as server totals.
    func nativeActivityDraft(id: String) throws -> NativeActivityDraft? {
        try requireOpen()
        if let last = try expeditionQueue().last(where: { $0.keys.writes.contains("activity:\(id)") }) {
            return try expeditionOperation(last.id).afterActivity()
        }
        return try nativeActivity(id: id).flatMap { try NativeActivityDraft(record: $0) }
    }
}
