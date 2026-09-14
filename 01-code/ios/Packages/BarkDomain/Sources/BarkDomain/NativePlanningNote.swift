import CryptoKit
import Foundation

public struct NativePlanningNote: Codable, Equatable, Sendable {
    public enum Failure: Error { case incomplete, invalid }
    public let schemaVersion: Int
    public let revision: Int64
    public let tripID: String
    public let stopID: String
    public let placeID: String
    public let text: String
    public let linkedToTrip: Bool
    public let deleted: Bool

    public init(
        revision: Int64, tripID: String, stopID: String, placeID: String, text: String,
        linkedToTrip: Bool = true, deleted: Bool = false, schemaVersion: Int = 1
    ) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.tripID = tripID
        self.stopID = stopID
        self.placeID = placeID
        self.text = text
        self.linkedToTrip = linkedToTrip
        self.deleted = deleted
    }
    public var id: String { Self.id(tripID: tripID, stopID: stopID) }
    public func validate() throws {
        guard schemaVersion == 1, (1...9_007_199_254_740_991).contains(revision),
            !tripID.isEmpty, !stopID.isEmpty, text.utf16.count <= 1000,
            placeID.count == 64, placeID.allSatisfy({ "0123456789abcdef".contains($0) })
        else { throw Failure.invalid }
    }

    /// J1: this context is trip-stop planning, not a copy of a shared place journal note.
    /// A duplicate trip has a new tripID and intentionally independent planning notes.
    public static func id(tripID: String, stopID: String) -> String {
        let parts = [tripID, stopID].map { "\($0.utf8.count):\($0)" }.joined()
        return SHA256.hash(data: Data("bark-native-planning-note:\(parts)".utf8))
            .map { String(format: "%02x", $0) }.joined()
    }
}
