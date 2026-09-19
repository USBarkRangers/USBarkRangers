import BarkDomain
import Foundation

nonisolated struct NativeTripCloud: Sendable {
    let transport: NativeCallableTransport
    nonisolated private struct Read<Query: Encodable & Sendable>: Encodable, Sendable {
        let kind: String
        let query: Query
    }
    nonisolated private struct TripQuery: Encodable, Sendable {
        let version = 1
        let tripID: String
    }
    nonisolated private struct LibraryQuery: Encodable, Sendable {
        let version = 1
        let before: NativeTripPage.Cursor?
    }

    func trip(_ id: String) async throws -> NativeTripSnapshot {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "trip", query: TripQuery(tripID: id)), as: NativeTripSnapshot.self
        )
        try NativeCallableTransport.validateReply { try value.validate() }
        guard value.tripID == id else { throw NativeCallableTransport.Failure.invalidReply }
        return value
    }
    func library(before cursor: NativeTripPage.Cursor? = nil) async throws -> NativeTripPage {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "library", query: LibraryQuery(before: cursor)),
            as: NativeTripPage.self)
        try NativeCallableTransport.validateReply { try value.validate() }
        if let cursor, let first = value.items.first {
            guard
                first.createdAt < cursor.createdAt
                    || (first.createdAt == cursor.createdAt && first.id < cursor.id)
            else {
                throw NativeCallableTransport.Failure.invalidReply
            }
        }
        return value
    }
    func changes(_ query: NativeTripChanges.Query) async throws -> NativeTripChanges {
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "tripChanges", query: query), as: NativeTripChanges.self)
        try NativeCallableTransport.validateReply { try value.validate(for: query) }
        return value
    }
    func recovery(for trip: Trip) async throws -> NativeTripRecovery {
        let query = NativeTripRecovery.Query(trip: trip)
        let value = try await transport.call(
            "nativeRead", input: Read(kind: "tripRecovery", query: query), as: NativeTripRecovery.self)
        try NativeCallableTransport.validateReply { try value.validate(for: query) }
        return value
    }
    func submit(_ command: NativeStore.Submission) async throws -> NativeTripOutcome {
        let value = try await transport.callBytes(
            "nativeCommand", bytes: command.bytes, as: NativeTripOutcome.self)
        try NativeCallableTransport.validateReply { try value.validate() }
        guard value.operationID == command.id else { throw NativeCallableTransport.Failure.invalidReply }
        return value
    }
}
