import Foundation
@preconcurrency import FirebaseFirestore
import Synchronization

/// Short-lived server reads with real listener removal on timeout/cancellation, including offline reads.
nonisolated enum CloudTripQuery {
    // SDK snapshots are immutable; mutable Firebase objects never reach domain/UI code.
    struct Page: @unchecked Sendable { let snapshot: QuerySnapshot }
    struct Document: @unchecked Sendable { let snapshot: DocumentSnapshot }

    static func page(_ query: Query) async throws -> Page {
        try await read { complete in
            query.addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                if let error { complete(.failure(error)) }
                else if let snapshot, !snapshot.metadata.isFromCache {
                    complete(.success(Page(snapshot: snapshot)))
                }
            }
        }
    }
    static func document(_ reference: DocumentReference) async throws -> Document {
        try await read { complete in
            reference.addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                if let error { complete(.failure(error)) }
                else if let snapshot, !snapshot.metadata.isFromCache {
                    complete(.success(Document(snapshot: snapshot)))
                }
            }
        }
    }
    private static func read<Value: Sendable>(
        register: (@escaping @Sendable (Result<Value, any Error>) -> Void) -> any ListenerRegistration
    ) async throws -> Value {
        let request = Request<Value>()
        let deadline = Task {
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            request.finish(.failure(URLError(.timedOut)))
        }
        defer { deadline.cancel() }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard request.begin(continuation) else { return }
                request.attach(register { request.finish($0) })
            }
        } onCancel: { request.finish(.failure(CancellationError())) }
    }

    private final class Request<Value: Sendable>: Sendable {
        private struct State {
            var result: Result<Value, any Error>?
            var continuation: CheckedContinuation<Value, any Error>?
            var listener: (any ListenerRegistration)?
        }
        private let state = Mutex(State())
        func begin(_ continuation: CheckedContinuation<Value, any Error>) -> Bool {
            let result = state.withLock { state -> Result<Value, any Error>? in
                if let result = state.result { return result }
                state.continuation = continuation
                return nil
            }
            if let result { continuation.resume(with: result); return false }
            return true
        }
        func attach(_ listener: any ListenerRegistration) {
            let finished = state.withLock { state in
                guard state.result == nil else { return true }
                state.listener = listener
                return false
            }
            if finished { listener.remove() }
        }
        func finish(_ result: Result<Value, any Error>) {
            let resources = state.withLock { state -> (CheckedContinuation<Value, any Error>?, (any ListenerRegistration)?) in
                guard state.result == nil else { return (nil, nil) }
                state.result = result
                let resources = (state.continuation, state.listener)
                state.continuation = nil
                state.listener = nil
                return resources
            }
            resources.1?.remove()
            resources.0?.resume(with: result)
        }
    }
}
