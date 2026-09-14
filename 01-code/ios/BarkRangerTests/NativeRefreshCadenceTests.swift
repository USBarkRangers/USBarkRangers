import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeRefreshCadenceTests {
    @Test func onlySuccessAdvancesFreshnessAndClockRollbackRevalidates() {
        let time = Date(timeIntervalSince1970: 1000)
        var cadence = NativeRefreshCadence()
        #expect(cadence.isDue(at: time))
        cadence.accepted(at: time)
        #expect(!cadence.isDue(at: time.addingTimeInterval(299)))
        #expect(cadence.isDue(at: time.addingTimeInterval(300)))
        #expect(cadence.isDue(at: time.addingTimeInterval(-1)))
        #expect(NativeRefreshCadence().isDue(at: time))
    }

    @Test func foregroundAndQueueWakesReuseFreshReadsButNeverSkipTheWorker() async {
        let state = State()
        let sync = NativeFeatureSync(
            label: "Example",
            work: { refresh in
                state.refreshes.append(refresh)
                return nil
            }, pause: {}, now: { state.time })
        sync.setAllowed(true)
        await sync.wait()
        sync.setAllowed(false)
        await sync.wait()
        sync.setAllowed(true)
        await sync.wait()
        sync.request()  // A pending save still enters the worker immediately.
        await sync.wait()
        #expect(state.refreshes == [true, false, false])
        state.time = state.time.addingTimeInterval(300)
        sync.request()
        await sync.wait()
        sync.request(refresh: true)
        await sync.wait()
        #expect(state.refreshes == [true, false, false, true, true])
        await sync.close()
    }

    @Test func failedRefreshDoesNotMakeDataFreshAndPausedWorkCannotRun() async {
        enum Failure: Error { case unavailable }
        let state = State()
        let sync = NativeFeatureSync(
            label: "Example",
            work: { refresh in
                state.refreshes.append(refresh)
                if state.fails { throw Failure.unavailable }
                return nil
            }, pause: {})
        sync.setAllowed(true)
        await sync.wait()
        #expect(sync.message != nil)
        sync.setAllowed(false)
        await sync.wait()
        sync.request(refresh: true)
        await sync.wait()
        #expect(state.refreshes == [true])
        state.fails = false
        sync.setAllowed(true)
        await sync.wait()
        #expect(state.refreshes == [true, true])
        #expect(sync.message == nil)
        await sync.close()
    }

    @Test(arguments: [true, false])
    func inFlightCancellationOrExplicitRefreshCannotLoseRevalidation(cancel: Bool) async throws {
        let state = State()
        let sync = NativeFeatureSync(
            label: "Example",
            work: { refresh in
                state.refreshes.append(refresh)
                if state.refreshes.count == 1 {
                    await withCheckedContinuation { state.continuation = $0 }
                }
                return nil
            }, pause: {})
        sync.setAllowed(true)
        try await eventually { state.continuation != nil }
        if cancel {
            sync.setAllowed(false)
            sync.setAllowed(true)
        } else {
            sync.request(refresh: true)
        }
        state.continuation?.resume()
        await sync.wait()
        #expect(state.refreshes == [true, true])
        await sync.close()
    }

    @MainActor private final class State {
        var time = Date(timeIntervalSince1970: 1000)
        var refreshes: [Bool] = []
        var fails = true
        var continuation: CheckedContinuation<Void, Never>?
    }
}
