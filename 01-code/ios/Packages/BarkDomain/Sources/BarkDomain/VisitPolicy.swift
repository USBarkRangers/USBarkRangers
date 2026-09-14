import Foundation

/// Visit validation and exact touched-record intents. No storage, location requests or UI side effects.
public enum VisitPolicy {
    public enum Failure: Error { case retired, invalidDate, poorLocation, outOfRange, unresolved }
    public static let proximityMeters = 25_000.0

    public static func evaluateProximity(park: Park, fix: LocationFix, now: Date) throws {
        guard fix.accuracy.isFinite, (0...5_000).contains(fix.accuracy),
            abs(fix.date.timeIntervalSince(now)) < 60
        else { throw Failure.poorLocation }
        guard fix.coordinate.distance(to: park.coordinate) <= proximityMeters else {
            throw Failure.outOfRange
        }
    }
}
