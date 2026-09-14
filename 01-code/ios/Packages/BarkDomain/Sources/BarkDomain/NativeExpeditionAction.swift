import Foundation

/// Only exact touched-entity preconditions, never the old profile's expedition blob.
public enum NativeExpeditionAction: Codable, Equatable, Sendable {
    case assign(trailID: String, runID: String, selectionRevision: Int64, expectedActiveRunID: String?)
    case record(NativeActivitySummary)
    case edit(activityID: String, revision: Int64, meters: Double, happenedAtMs: Int64, trailName: String)
    case remove(activityID: String, revision: Int64)
    case claim(runID: String, revision: Int64)

    public var activityID: String? {
        switch self {
        case .record(let summary): summary.activityID
        case .edit(let id, _, _, _, _), .remove(let id, _): id
        case .assign, .claim: nil
        }
    }
    public var runID: String? {
        switch self {
        case .assign(_, let id, _, _), .claim(let id, _): id
        case .record(let summary): summary.runID
        case .edit, .remove: nil
        }
    }
    public var expectedRevision: Int64 {
        switch self {
        case .assign(_, _, let revision, _), .edit(_, let revision, _, _, _),
            .remove(_, let revision), .claim(_, let revision):
            revision
        case .record: 0
        }
    }
    var kind: String {
        switch self {
        case .assign: "assignVirtualRun"
        case .record: "recordActivity"
        case .edit: "updateActivity"
        case .remove: "deleteActivity"
        case .claim: "claimVirtualRun"
        }
    }
    public func validate() throws {
        try NativeRecordValidation.revision(expectedRevision, allowZero: true)
        switch self {
        case .assign(let trail, let id, _, let previous):
            try NativeRecordValidation.identifier(trail)
            try NativeRecordValidation.uuid(id)
            if let previous { try NativeRecordValidation.uuid(previous) }
        case .record(let summary): try summary.validate()
        case .edit(let id, let revision, let meters, let date, let name):
            try NativeRecordValidation.uuid(id)
            try NativeRecordValidation.revision(revision)
            try NativeRecordValidation.date(date)
            guard meters.isFinite, (0...500_000).contains(meters), !name.isEmpty, name.utf16.count <= 200
            else {
                throw NativeRecordValidation.Failure.malformed
            }
        case .remove(let id, let revision), .claim(let id, let revision):
            try NativeRecordValidation.uuid(id)
            try NativeRecordValidation.revision(revision)
        }
    }
}
