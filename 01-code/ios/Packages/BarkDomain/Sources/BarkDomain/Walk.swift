import Foundation

/// A summary carries no raw GPS or Health samples. Stable source IDs survive retries and imports.
public struct WalkSummary: Codable, Equatable, Sendable, Identifiable {
    public enum Source: String, Codable, CaseIterable, Sendable { case gps, pedometer, health, manual }
    public let id: String
    public let source: Source
    public let startedAt: Date
    public let endedAt: Date
    public let meters: Double
    public let elapsedSeconds: Double
    public let runID: String?
    public init(
        id: String = UUID().uuidString.lowercased(), source: Source, startedAt: Date,
        endedAt: Date, meters: Double, elapsedSeconds: Double, runID: String? = nil
    ) {
        self.id = id
        self.source = source
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.meters = meters
        self.elapsedSeconds = elapsedSeconds
        self.runID = runID
    }
}
