import Foundation

/// Small protected recovery checkpoint. Raw accepted coordinates are appended separately on-device.
public struct WalkRecording: Codable, Equatable, Sendable, Identifiable {
    public enum Phase: String, Codable, Sendable { case recording, paused, recovered, finishing }
    public let id: String
    public let uid: String
    public let source: WalkSummary.Source
    public let startedAt: Date
    public let runID: String?
    public let trailName: String
    public var phase: Phase = .recording
    public var distance = WalkDistancePolicy()
    public var motionMeters: Double = 0
    public var elapsedSeconds: Double = 0
    public var finishedAt: Date?
    public var checkpointAt: Date
    public var sampleBytes: UInt64 = 0
    public init(uid: String, source: WalkSummary.Source, runID: String?, trailName: String, now: Date) {
        id = UUID().uuidString.lowercased()
        self.uid = uid
        self.source = source
        self.runID = runID
        self.trailName = trailName
        startedAt = now
        checkpointAt = now
    }
    public var meters: Double { source == .pedometer ? motionMeters : distance.meters }
    public var summary: WalkSummary {
        let end = finishedAt ?? checkpointAt
        return WalkSummary(
            id: id, source: source, startedAt: startedAt, endedAt: end,
            meters: meters, elapsedSeconds: min(elapsedSeconds, max(0, end.timeIntervalSince(startedAt))),
            runID: runID)
    }
}

public struct RecordedPoint: Codable, Sendable, Equatable {
    public let sample: WalkDistancePolicy.Sample
    public let segment: Int
    public init(sample: WalkDistancePolicy.Sample, segment: Int) {
        self.sample = sample
        self.segment = segment
    }
}
