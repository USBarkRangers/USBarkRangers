import Foundation

/// A segmented distance accumulator. Rejected fixes, pauses and long gaps never create a connecting line.
public struct WalkDistancePolicy: Codable, Equatable, Sendable {
    public struct Sample: Codable, Equatable, Sendable {
        public let coordinate: Coordinate
        public let accuracy: Double
        public let date: Date
        public init(coordinate: Coordinate, accuracy: Double, date: Date) {
            self.coordinate = coordinate
            self.accuracy = accuracy
            self.date = date
        }
    }
    public enum Acceptance: String, Codable, Sendable {
        case anchor, movement, stationary, inaccurate, gap, speed, stale
    }
    public private(set) var anchor: Sample?
    public private(set) var meters: Double = 0
    public private(set) var segment = 0
    public init() {}
    public mutating func reanchor() {
        anchor = nil
        segment += 1
    }
    public mutating func accept(_ sample: Sample, now: Date) -> Acceptance {
        guard sample.date <= now.addingTimeInterval(5), now.timeIntervalSince(sample.date) < 120,
            anchor.map({ sample.date > $0.date }) ?? true
        else { return .stale }
        guard sample.accuracy.isFinite, sample.accuracy >= 0, sample.accuracy <= 40 else {
            reanchor()
            return .inaccurate
        }
        guard let previous = anchor else {
            anchor = sample
            return .anchor
        }
        let elapsed = sample.date.timeIntervalSince(previous.date)
        guard elapsed <= 120 else {
            reanchor()
            anchor = sample
            return .gap
        }
        let distance = previous.coordinate.distance(to: sample.coordinate)
        guard distance / elapsed <= 8.94 else {
            reanchor()
            anchor = sample
            return .speed
        }
        guard distance >= max(5, max(previous.accuracy, sample.accuracy) * 0.25) else { return .stationary }
        meters += distance
        anchor = sample
        return .movement
    }
}
