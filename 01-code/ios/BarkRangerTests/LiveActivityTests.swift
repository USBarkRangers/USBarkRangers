import ActivityKit
import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct LiveActivityTests {
    @Test func displayStopsExtrapolatingWhenPausedAndHasBoundedFreshness() {
        let now = Date(timeIntervalSince1970: 1_000)
        var recording = WalkRecording(uid: "synthetic", source: .gps, runID: nil, trailName: "Test", now: now)
        recording.elapsedSeconds = 30
        let active = LiveActivityService.content(recording, now: now)
        #expect(active.state.activeSince == now.addingTimeInterval(-30))
        #expect(active.staleDate == now.addingTimeInterval(90))
        recording.phase = .paused
        let paused = LiveActivityService.content(recording, now: now)
        #expect(paused.state.paused && paused.state.activeSince == nil)
        #expect(paused.state.elapsedSeconds == 30)
    }
    @Test func endedDisplaysCannotBeUpdatedAndStaleDisplaysCanRecoverWithoutPerFixUpdates() {
        let now = Date()
        for state: ActivityState in [.ended, .dismissed] {
            #expect(!LiveActivityService.shouldUpdate(state, force: true, since: .distantPast, now: now))
        }
        #expect(
            !LiveActivityService.shouldUpdate(
                .active, force: false, since: now.addingTimeInterval(-1), now: now))
        #expect(
            LiveActivityService.shouldUpdate(
                .stale, force: false, since: now.addingTimeInterval(-15), now: now))
        #expect(LiveActivityService.shouldUpdate(.active, force: true, since: now, now: now))
    }
}
