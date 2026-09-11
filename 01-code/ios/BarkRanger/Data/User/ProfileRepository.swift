import BarkDomain
import Foundation

/// UI write boundary: explicitly leave MainActor before entering SwiftData, whose executor can inline
/// synchronous work on its caller. The account lifetime owns observation and sync scheduling.
nonisolated struct ProfileRepository: Sendable {
    let store: LocalStore
    @concurrent func editDisplayName(_ name: String) async throws {
        try await store.commit(
            kind: .profile, value: .string(name.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
    @concurrent func saveMapAppearance(_ style: String) async throws {
        try await store.commit(kind: .mapStyle, value: .string(style))
    }
    @concurrent func resolve(_ id: String, keepLocal: Bool) async throws {
        try await store.resolve(id: id, keepLocal: keepLocal)
    }
}
