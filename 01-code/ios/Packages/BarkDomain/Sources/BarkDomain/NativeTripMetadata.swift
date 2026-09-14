import CryptoKit
import Foundation

/// Library/synchronization metadata only. A library page never decodes itinerary or note bodies.
public struct NativeTripMetadata: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let schemaVersion: Int
    public let revision: Int64
    public let contentRevision: Int64
    public let title: String?
    public let dayCount: Int?
    public let stopCount: Int?
    public let contentBytes: Int?
    public let deleted: Bool
    public let createdAt: NativeServerTime
    public let updatedAt: NativeServerTime

    public init(
        id: String, revision: Int64, contentRevision: Int64, title: String?, dayCount: Int?, stopCount: Int?,
        contentBytes: Int?, deleted: Bool = false, createdAt: NativeServerTime, updatedAt: NativeServerTime,
        schemaVersion: Int = 1
    ) {
        self.id = id
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.contentRevision = contentRevision
        self.title = title
        self.dayCount = dayCount
        self.stopCount = stopCount
        self.contentBytes = contentBytes
        self.deleted = deleted
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    public func validate() throws {
        guard !id.isEmpty, schemaVersion == 1, (1...9_007_199_254_740_991).contains(revision),
            (1...9_007_199_254_740_991).contains(contentRevision), createdAt <= updatedAt
        else { throw Trip.Failure.malformed }
        if !deleted {
            guard let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                title.utf16.count <= 100,
                let dayCount, (1...50).contains(dayCount), let stopCount, (0...502).contains(stopCount),
                let contentBytes, (0...350_000).contains(contentBytes)
            else { throw Trip.Failure.malformed }
        }
    }
}

/// The explicit saved preimage needed to distinguish dirty draft text from a later remote update.
/// It is bounded to this trip, not the account's note archive, and never becomes a second saved body.
public struct NativeTripBase: Codable, Equatable, Sendable {
    public var contentRevision: Int64
    public var notes: [String: NativePlanningNote]
    public var contentFingerprint: String?
    public init(
        contentRevision: Int64 = 0, notes: [String: NativePlanningNote] = [:],
        contentFingerprint: String? = nil
    ) {
        self.contentRevision = contentRevision
        self.notes = notes
        self.contentFingerprint = contentFingerprint
    }
    public static func fingerprint(_ trip: Trip) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return SHA256.hash(data: try encoder.encode(trip)).map { String(format: "%02x", $0) }.joined()
    }
    public func validate(tripID: String) throws {
        guard (0...9_007_199_254_740_991).contains(contentRevision), notes.count <= 502,
            contentFingerprint.map({ $0.count == 64 && $0.allSatisfy({ "0123456789abcdef".contains($0) }) })
                ?? true,
            contentRevision != 0 || (notes.isEmpty && contentFingerprint == nil)
        else { throw Trip.Failure.malformed }
        for (id, note) in notes {
            try note.validate()
            guard id == note.id, note.tripID == tripID, !note.deleted else { throw Trip.Failure.malformed }
        }
    }
}
