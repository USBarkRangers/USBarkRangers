import BarkDomain
import Foundation

nonisolated struct NativeSavedPinCloud: Sendable {
    let transport: NativeCallableTransport
    struct Outcome: Codable, Sendable {
        let version: Int
        let operationID: UUID
        let status: String
        let confirmation: NativeSavedPin
        let revisions: Revisions
        struct Revisions: Codable, Sendable { let savedPin: Int64 }
        func validate() throws {
            try confirmation.validate()
            guard version == 1, status == "accepted", revisions.savedPin == confirmation.revision else {
                throw NativeCallableTransport.Failure.invalidReply
            }
        }
    }
    func submit(_ value: NativeStore.Submission) async throws -> Outcome {
        let outcome = try await transport.callBytes("nativeCommand", bytes: value.bytes, as: Outcome.self)
        try NativeCallableTransport.validateReply { try outcome.validate() }
        guard outcome.operationID == value.id else { throw NativeCallableTransport.Failure.invalidReply }
        return outcome
    }
    func changes(_ query: NativeChangeQuery) async throws -> NativeSavedPinChanges {
        struct Read: Encodable, Sendable {
            let kind = "savedPinChanges"
            let query: NativeChangeQuery
        }
        let value = try await transport.call(
            "nativeRead", input: Read(query: query), as: NativeSavedPinChanges.self)
        try NativeCallableTransport.validateReply { try value.validate(for: query) }
        return value
    }
}
