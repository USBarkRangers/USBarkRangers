import BarkDomain
import Foundation

nonisolated struct NativeExpeditionCloud: Sendable {
    let transport: NativeCallableTransport
    nonisolated private struct Read<Query: Encodable & Sendable>: Encodable, Sendable {
        let kind: String
        let query: Query
    }
    nonisolated private struct Selection: Encodable, Sendable {
        let version = 1
        let activityID: String?
        let runID: String?
    }
    nonisolated private struct History: Encodable, Sendable {
        let version = 1
        let before: NativeActivityPage.Cursor?
    }
    nonisolated private struct Claims: Encodable, Sendable {
        let version = 1
        let activityIDs: [String]
    }
    func current(activityID: String? = nil, runID: String? = nil) async throws -> NativeExpeditionSnapshot {
        let value = try await transport.call(
            "nativeRead",
            input: Read(kind: "expedition", query: Selection(activityID: activityID, runID: runID)),
            as: NativeExpeditionSnapshot.self)
        try value.validate(activityID: activityID, runID: runID)
        return value
    }
    func history(before cursor: NativeActivityPage.Cursor? = nil) async throws -> NativeActivityPage {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "activityHistory", query: History(before: cursor)),
            as: NativeActivityPage.self)
        try value.validate(after: cursor)
        return value
    }
    func changes(_ query: NativeChangeQuery) async throws -> NativeActivityChanges {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "activityChanges", query: query), as: NativeActivityChanges.self)
        try value.validate(for: query)
        return value
    }
    func claimedActivities(_ ids: [String]) async throws -> NativeActivityClaims {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "activityClaims", query: Claims(activityIDs: ids)),
            as: NativeActivityClaims.self)
        try value.validate(for: ids)
        return value
    }
    func completedTrails() async throws -> NativeCompletedTrails {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "completedTrails", query: ["version": 1]),
            as: NativeCompletedTrails.self)
        try value.validate()
        return value
    }
    func submit(_ submission: NativeStore.Submission) async throws -> NativeExpeditionOutcome {
        let value = try await transport.callBytes(
            "nativeCommand", bytes: submission.bytes, as: NativeExpeditionOutcome.self)
        try value.validate()
        guard value.operationID == submission.id else { throw NativeCallableTransport.Failure.invalidReply }
        return value
    }
}
