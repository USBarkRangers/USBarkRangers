import ActivityKit
import Foundation

/// The only source shared by app and widget; no account identifiers, location samples or Firebase dependency.
nonisolated struct WalkActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var meters: Double
        var elapsedSeconds: Double
        var activeSince: Date?
        var paused: Bool
    }
    let sessionID: String
    let trailName: String
}
