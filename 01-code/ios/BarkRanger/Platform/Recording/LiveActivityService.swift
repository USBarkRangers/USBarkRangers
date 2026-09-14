@preconcurrency import ActivityKit
import BarkDomain
import Foundation

@MainActor protocol WalkActivityDisplaying: AnyObject {
    func start(_ recording: WalkRecording) async
    func update(_ recording: WalkRecording, force: Bool) async
    func end() async
    func reconcile() async
}

/// A bounded optional display. Disabling or dismissing an activity never controls the recorder.
@MainActor final class LiveActivityService: WalkActivityDisplaying {
    private var activity: Activity<WalkActivityAttributes>?
    private var lastUpdate = Date.distantPast
    private var generation = UUID()
    func start(_ recording: WalkRecording) async {
        let old = activity
        activity = nil
        let token = UUID()
        generation = token
        if let old { await old.end(nil, dismissalPolicy: .immediate) }
        guard token == generation, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            activity = try Activity.request(
                attributes: WalkActivityAttributes(sessionID: recording.id, trailName: recording.trailName),
                content: Self.content(recording), pushType: nil)
            lastUpdate = Date()
        } catch {
            // Optional display failure leaves the protected recording and controls available.
        }
    }
    func update(_ recording: WalkRecording, force: Bool = false) async {
        guard let activity, activity.attributes.sessionID == recording.id else { return }
        guard activity.activityState == .active || activity.activityState == .stale else {
            self.activity = nil
            return
        }
        guard Self.shouldUpdate(activity.activityState, force: force, since: lastUpdate) else { return }
        lastUpdate = Date()
        await activity.update(Self.content(recording))
    }
    func end() async {
        generation = UUID()
        let old = activity
        activity = nil
        if let old { await old.end(nil, dismissalPolicy: .immediate) }
    }
    func reconcile() async {
        generation = UUID()
        activity = nil
        for leftover in Activity<WalkActivityAttributes>.activities {
            await leftover.end(nil, dismissalPolicy: .immediate)
        }
    }
    static func shouldUpdate(_ state: ActivityState, force: Bool, since: Date, now: Date = Date()) -> Bool {
        guard state == .active || state == .stale else { return false }
        return force || now.timeIntervalSince(since) >= 15
    }
    static func content(_ recording: WalkRecording, now: Date = Date()) -> ActivityContent<
        WalkActivityAttributes.ContentState
    > {
        ActivityContent(
            state: .init(
                meters: recording.meters, elapsedSeconds: recording.elapsedSeconds,
                activeSince: recording.phase == .recording
                    ? now.addingTimeInterval(-recording.elapsedSeconds) : nil,
                paused: recording.phase != .recording), staleDate: now.addingTimeInterval(90))
    }
}
