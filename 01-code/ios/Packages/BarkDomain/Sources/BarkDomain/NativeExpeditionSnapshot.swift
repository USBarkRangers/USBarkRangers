import Foundation

/// One consistent point read: current selection, an optional selected activity/run,
/// and at most three referenced run summaries. No account or activity archive graph.
public struct NativeExpeditionSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let activityID: String?
    public let runID: String?
    public let state: NativeExpeditionState?
    public let progress: NativeProgress?
    public let activity: NativeActivityRecord?
    public let activityClaimed: Bool
    public let runs: [NativeVirtualRun]
    public let readTime: NativeServerTime
    public func validate(activityID requestedActivity: String?, runID requestedRun: String?) throws {
        guard version == 1, activityID == requestedActivity, runID == requestedRun,
            runs.count <= 3, Set(runs.map(\.id)).count == runs.count
        else { throw NativeRecordValidation.Failure.malformed }
        if let activityID { try NativeRecordValidation.uuid(activityID) }
        if let runID { try NativeRecordValidation.uuid(runID) }
        try state?.validate()
        try progress?.validate()
        if let state, state.updatedAt > readTime { throw NativeRecordValidation.Failure.malformed }
        if let progress, progress.updatedAt > readTime { throw NativeRecordValidation.Failure.malformed }
        if let activity {
            try activity.validate()
            guard activity.id == activityID, activity.updatedAt <= readTime, activityClaimed, state != nil
            else {
                throw NativeRecordValidation.Failure.malformed
            }
        }
        if activityID == nil, activity != nil || activityClaimed {
            throw NativeRecordValidation.Failure.malformed
        }
        if activityClaimed, state == nil { throw NativeRecordValidation.Failure.malformed }
        let allowed = Set([state?.activeRunID, runID, activity?.details?.runID].compactMap { $0 })
        for run in runs {
            try run.validate()
            guard allowed.contains(run.id), run.updatedAt <= readTime else {
                throw NativeRecordValidation.Failure.malformed
            }
            if run.status == .active, run.id != state?.activeRunID {
                throw NativeRecordValidation.Failure.malformed
            }
        }
        let byID = Dictionary(uniqueKeysWithValues: runs.map { ($0.id, $0) })
        if let id = state?.activeRunID, byID[id]?.status != .active {
            throw NativeRecordValidation.Failure.malformed
        }
        if let id = activity?.details?.runID, byID[id] == nil {
            throw NativeRecordValidation.Failure.malformed
        }
    }
}
