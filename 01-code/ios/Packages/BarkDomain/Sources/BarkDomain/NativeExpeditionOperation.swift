import Foundation

/// A command owns its small authored preimage, independent of history-cache eviction.
/// A stable activity identity is deliberately separate from a transport operation ID.
public struct NativeExpeditionOperation: Codable, Equatable, Sendable {
    public let action: NativeExpeditionAction
    public let beforeActivity: NativeActivityDraft?
    public let recordedTrailName: String?
    public init(
        action: NativeExpeditionAction, beforeActivity: NativeActivityDraft? = nil,
        recordedTrailName: String? = nil
    ) {
        self.action = action
        self.beforeActivity = beforeActivity
        self.recordedTrailName = recordedTrailName
    }
    public var selectedRunID: String? { action.runID ?? beforeActivity?.summary.runID }
    public func afterActivity() throws -> NativeActivityDraft? {
        switch action {
        case .record(let summary):
            guard let recordedTrailName else { throw NativeRecordValidation.Failure.malformed }
            return try .init(summary: summary, trailName: recordedTrailName)
        case .edit(_, _, let meters, let date, let name):
            guard let beforeActivity else { throw NativeRecordValidation.Failure.malformed }
            return try beforeActivity.corrected(meters: meters, happenedAtMs: date, trailName: name)
        case .remove, .assign, .claim: return nil
        }
    }
    public func validate() throws {
        try action.validate()
        try beforeActivity?.validate()
        switch action {
        case .edit(let id, let revision, _, _, _), .remove(let id, let revision):
            guard beforeActivity?.id == id, beforeActivity?.revision == revision,
                recordedTrailName == nil
            else { throw NativeRecordValidation.Failure.malformed }
        case .record:
            guard beforeActivity == nil, recordedTrailName != nil else {
                throw NativeRecordValidation.Failure.malformed
            }
        case .assign, .claim:
            guard beforeActivity == nil, recordedTrailName == nil else {
                throw NativeRecordValidation.Failure.malformed
            }
        }
        _ = try afterActivity()
        try keys.validate()
    }
    public func commandBytes(id: UUID, createdAtMs: Int64) throws -> Data {
        try validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(NativeExpeditionCommand(id: id, createdAtMs: createdAtMs, action: action))
    }

    /// A run's users order against assignments/completion that touch that same run.
    /// Only an unassigned recording depends on the empty selection slot. Historical
    /// edits to an abandoned/completed run must not lock today's trail selection.
    public struct Keys: Codable, Equatable, Sendable {
        public let reads: [String]
        public let writes: [String]
        public func conflicts(with other: Self) -> Bool {
            !Set(writes).isDisjoint(with: other.reads + other.writes)
                || !Set(reads).isDisjoint(with: other.writes)
        }
        public func validate() throws {
            guard reads.count <= 1, (1...3).contains(writes.count),
                reads == reads.sorted(), writes == writes.sorted(),
                Set(reads).count == reads.count, Set(writes).count == writes.count,
                Set(reads).isDisjoint(with: writes)
            else { throw NativeRecordValidation.Failure.malformed }
            for key in reads + writes {
                if key == "selection" { continue }
                let parts = key.split(separator: ":", omittingEmptySubsequences: false)
                guard parts.count == 2, ["activity", "run"].contains(String(parts[0])) else {
                    throw NativeRecordValidation.Failure.malformed
                }
                try NativeRecordValidation.uuid(String(parts[1]))
            }
        }
    }
    public var keys: Keys {
        var reads = Set<String>()
        var writes = Set<String>()
        if let id = action.activityID { writes.insert("activity:\(id)") }
        if let id = selectedRunID { writes.insert("run:\(id)") }
        switch action {
        case .assign(_, _, _, let previous):
            writes.insert("selection")
            if let previous { writes.insert("run:\(previous)") }
        case .claim: writes.insert("selection")
        case .record:
            if selectedRunID == nil { reads.insert("selection") }
        case .edit, .remove: break
        }
        return .init(reads: reads.sorted(), writes: writes.sorted())
    }
}
