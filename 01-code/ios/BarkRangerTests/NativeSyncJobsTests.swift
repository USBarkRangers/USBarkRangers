import Foundation
import Testing

@testable import BarkRanger

struct NativeSyncJobsTests {
    @Test func pauseDrainsUncooperativeWorkAndResumeDoesNotReuseItsCancelledFlight() async throws {
        let jobs = NativeSyncJobs<String, Int>()
        let held = HeldWork()
        let first = Task { try await jobs.run("profile") { await held.run() } }
        await held.waitForStart()
        let pausing = Task { await jobs.pause() }
        // The owner has actually cancelled its child, but the child deliberately
        // remains alive until released. No scheduler-turn/sleep assumptions.
        await held.waitForCancellation()
        let resuming = Task { try await jobs.resume() }
        await held.release()
        await pausing.value
        try await resuming.value
        await #expect(throws: CancellationError.self) { try await first.value }
        let result = try await jobs.run("profile") { 2 }
        #expect(result == 2)
        await jobs.close()
        await #expect(throws: NativeSyncAdmission.closed) { try await jobs.run("profile") { 3 } }
        await #expect(throws: NativeSyncAdmission.closed) { try await jobs.resume() }
    }

    @Test func cancellingAWaiterDoesNotCancelTheSharedJob() async throws {
        let jobs = NativeSyncJobs<String, Int>()
        let held = HeldWork()
        let cancelled = Task { try await jobs.run("profile") { await held.run() } }
        await held.waitForStart()
        cancelled.cancel()
        let other = Task { try await jobs.run("other") { 7 } }
        #expect(try await other.value == 7)
        await held.release()
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        #expect(await held.calls == 1)
        await jobs.pause()
        await #expect(throws: CancellationError.self) { try await jobs.run("profile") { 8 } }
        try await jobs.resume()
        #expect(try await jobs.run("profile") { 9 } == 9)
        await jobs.close()
    }
}

private actor HeldWork {
    private var waiter: CheckedContinuation<Int, Never>?
    private var started: CheckedContinuation<Void, Never>?
    private var cancellationWaiter: CheckedContinuation<Void, Never>?
    private var cancelled = false
    private(set) var calls = 0
    func run() async -> Int {
        calls += 1
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                waiter = continuation
                started?.resume()
                started = nil
            }
        } onCancel: {
            Task { await self.acknowledgeCancellation() }
        }
    }
    func waitForStart() async {
        if waiter != nil { return }
        await withCheckedContinuation { started = $0 }
    }
    func release() {
        waiter?.resume(returning: 1)
        waiter = nil
    }
    func waitForCancellation() async {
        if cancelled { return }
        await withCheckedContinuation { cancellationWaiter = $0 }
    }
    private func acknowledgeCancellation() {
        cancelled = true
        cancellationWaiter?.resume()
        cancellationWaiter = nil
    }
}
