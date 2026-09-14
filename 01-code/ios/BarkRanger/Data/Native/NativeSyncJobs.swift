import Foundation

enum NativeSyncAdmission: Error { case closed }

/// Scope-owned coalescing and cancel-and-drain. Waiting callers do not own a shared
/// job's cancellation; the account lifecycle explicitly pauses or closes this owner.
actor NativeSyncJobs<Key: Hashable & Sendable, Value: Sendable> {
    private struct Flight: Sendable {
        let id: UUID
        let task: Task<Value, Error>
    }
    private struct Drain: Sendable {
        let id: UUID
        let task: Task<Void, Never>
        let flightIDs: [Key: UUID]
    }
    private var flights: [Key: Flight] = [:]
    private var drain: Drain?
    private var suspended = false
    private var closed = false
    private var lifecycleIntent = UUID()

    func run(_ key: Key, operation: @escaping @Sendable () async throws -> Value) async throws -> Value {
        try Task.checkCancellation()
        guard !closed else { throw NativeSyncAdmission.closed }
        guard !suspended else { throw CancellationError() }
        let flight: Flight
        if let existing = flights[key] {
            flight = existing
        } else {
            flight = Flight(
                id: UUID(),
                task: Task {
                    try Task.checkCancellation()
                    let value = try await operation()
                    try Task.checkCancellation()
                    return value
                })
            flights[key] = flight
        }
        defer {
            // An old waiter resuming after pause/resume cannot erase a newer job.
            if flights[key]?.id == flight.id { flights.removeValue(forKey: key) }
        }
        let result = try await flight.task.value
        try Task.checkCancellation()
        return result
    }
    func pause() async {
        lifecycleIntent = UUID()
        suspended = true
        if let drain {
            await drain.task.value
            retire(drain)
            return
        }
        let retiring = flights
        let tasks = retiring.values.map(\.task)
        for task in tasks { task.cancel() }
        let next = Drain(
            id: UUID(),
            task: Task {
                for task in tasks { _ = try? await task.value }
            }, flightIDs: retiring.mapValues(\.id))
        drain = next
        await next.task.value
        retire(next)
    }
    func resume() async throws {
        guard !closed else { throw NativeSyncAdmission.closed }
        let intent = UUID()
        lifecycleIntent = intent
        if let drain {
            await drain.task.value
            retire(drain)
        }
        guard !closed else { throw NativeSyncAdmission.closed }
        // A newer pause request takes precedence over an older waiting resume.
        if lifecycleIntent == intent { suspended = false }
    }
    func close() async {
        closed = true
        await pause()
    }
    private func retire(_ completed: Drain) {
        // Retire only the jobs this completed drain owned. A newer pause/resume
        // cycle may already own different jobs under those same keys.
        for (key, id) in completed.flightIDs where flights[key]?.id == id {
            flights.removeValue(forKey: key)
        }
        if drain?.id == completed.id { drain = nil }
    }
}
