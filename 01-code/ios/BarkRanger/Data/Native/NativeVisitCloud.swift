import BarkDomain
import Foundation

nonisolated struct NativeVisitCloud: Sendable {
    let transport: NativeCallableTransport
    var progressReader: NativeProgressCloud? = nil
    nonisolated private struct Read<Query: Encodable & Sendable>: Encodable, Sendable {
        let kind: String
        let query: Query
    }
    nonisolated private struct VisitQuery: Encodable, Sendable {
        let version = 1
        let visitID: String
        let officialPlaceID: String
    }
    nonisolated private struct HistoryQuery: Encodable, Sendable {
        let version = 1
        let before: NativeVisitPage.Cursor?
    }
    nonisolated private struct SelectionQuery: Encodable, Sendable {
        let version = 1
        let visits: [Reference]
        struct Reference: Encodable, Sendable {
            let visitID: String
            let officialPlaceID: String
        }
    }
    func visit(id: String, officialPlaceID: String) async throws -> NativeVisitSnapshot {
        let value = try await transport.call(
            "nativeRead",
            input: Read(
                kind: "visit",
                query: VisitQuery(visitID: id, officialPlaceID: officialPlaceID)),
            as: NativeVisitSnapshot.self)
        try value.validate()
        guard value.visitID == id, value.officialPlaceID == officialPlaceID else {
            throw NativeCallableTransport.Failure.invalidReply
        }
        return value
    }
    func history(before cursor: NativeVisitPage.Cursor? = nil) async throws -> NativeVisitPage {
        let value = try await transport.call(
            "nativeRead",
            input: Read(
                kind: "visitHistory",
                query: HistoryQuery(before: cursor)), as: NativeVisitPage.self)
        try value.validate(after: cursor)
        return value
    }
    func progress() async throws -> NativeProgressSnapshot {
        if let value = try await progressReader?.current() { return value }
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "progress", query: ["version": 1]),
            as: NativeProgressSnapshot.self)
        try value.validate()
        return value
    }
    func close() async {
        await progressReader?.close()
        await transport.close()
    }
    /// A current-day presence signal, not authored offline history. The server's day
    /// guard makes it idempotent independently of transport receipt retention.
    func recordDay(_ day: String, timeZone: String) async throws -> NativeProgressSnapshot {
        struct Command: Encodable, Sendable {
            let version = 1
            let kind = "recordDailyActivity"
            let expectedRevision = 0
            let operationID: String
            let createdAtMs: Int64
            let payload: Payload
            struct Payload: Encodable, Sendable {
                let day: String
                let timeZone: String
            }
        }
        struct Outcome: Decodable, Sendable {
            let version: Int
            let operationID: String
            let status: String
            let revisions: Revisions
            struct Revisions: Decodable, Sendable { let progress: Int64 }
        }
        let id = UUID().uuidString.lowercased()
        let outcome = try await transport.call(
            "nativeCommand",
            input: Command(
                operationID: id, createdAtMs: NativeClientTime.milliseconds(Date()),
                payload: .init(day: day, timeZone: timeZone)), as: Outcome.self)
        guard outcome.version == 1, outcome.operationID == id, outcome.status == "accepted",
            outcome.revisions.progress >= 0
        else { throw NativeCallableTransport.Failure.invalidReply }
        let snapshot = try await progress()
        guard (snapshot.progress?.revision ?? 0) >= outcome.revisions.progress else {
            throw NativeCallableTransport.Failure.invalidReply
        }
        return snapshot
    }
    func markers(_ query: NativeChangeQuery) async throws -> NativePlaceProgressChanges {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "placeProgressChanges", query: query),
            as: NativePlaceProgressChanges.self)
        try value.validate(for: query)
        return value
    }
    func submit(_ submission: NativeStore.Submission) async throws -> NativeVisitOutcome {
        let value = try await transport.callBytes(
            "nativeCommand", bytes: submission.bytes, as: NativeVisitOutcome.self)
        try value.validate()
        guard value.operationID == submission.id else { throw NativeCallableTransport.Failure.invalidReply }
        return value
    }
    func selection(_ references: [NativeVisitReference]) async throws -> NativeVisitSelection {
        guard (1...500).contains(references.count) else { throw NativeCallableTransport.Failure.invalidReply }
        for reference in references { try reference.validate() }
        let query = SelectionQuery(
            visits: references.map { .init(visitID: $0.visitID, officialPlaceID: $0.officialPlaceID) })
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "visitSelection", query: query), as: NativeVisitSelection.self)
        try value.validate(for: references)
        return value
    }
    func submitBulk(_ submission: NativeStore.Submission) async throws -> NativeBulkVisitOutcome {
        let value = try await transport.callBytes(
            "nativeCommand", bytes: submission.bytes, as: NativeBulkVisitOutcome.self)
        try value.validate()
        guard value.operationID == submission.id else { throw NativeCallableTransport.Failure.invalidReply }
        return value
    }
}
