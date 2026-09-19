import Foundation

/// The independent steps of one feature pass. A step that ends in an isolatable remote
/// response failure is skipped alone; the first such failure is rethrown by `finish()` after
/// the other steps ran, so the pass still fails visibly and NativeFeatureSync arms no retry
/// for it. Every other error ends the pass at once, exactly as before.
nonisolated struct NativeIndependentSteps {
    private(set) var firstFailure: (any Error)?

    /// Returns false when the step was skipped because of an isolatable failure.
    @discardableResult
    mutating func run(_ step: () async throws -> Void) async throws -> Bool {
        do {
            try await step()
            return true
        } catch {
            // A cancelled call can surface as any error; cancellation always ends the pass.
            try Task.checkCancellation()
            guard NativeMailroom.isIsolatableRemoteResponseFailure(error) else { throw error }
            if firstFailure == nil { firstFailure = error }
            return false
        }
    }

    func finish() throws {
        if let firstFailure { throw firstFailure }
    }
}
