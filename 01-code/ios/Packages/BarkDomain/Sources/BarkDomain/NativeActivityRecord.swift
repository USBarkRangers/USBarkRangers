import Foundation

/// A current walk summary with independent identity and immutable source measurements.
/// J4/J5 add associations and private track references, never a GPS/Health/photo array.
public struct NativeActivityRecord: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let revision: Int64
    public let updatedAt: NativeServerTime
    public let details: Details?
    public var deleted: Bool { details == nil }

    public struct Details: Codable, Equatable, Sendable {
        public let source: WalkSummary.Source
        public let startedAtMs: Int64
        public let endedAtMs: Int64
        public let originalMeters: Double
        public let elapsedSeconds: Double
        public let runID: String?
        public let miles: Double
        public let happenedAtMs: Int64
        public let trailName: String
        public let recordedAt: NativeServerTime
        public var meters: Double { miles * 1609.344 }
        public var happenedAt: Date { Date(timeIntervalSince1970: Double(happenedAtMs) / 1000) }
        func validate() throws {
            try NativeRecordValidation.date(startedAtMs)
            try NativeRecordValidation.date(endedAtMs)
            try NativeRecordValidation.date(happenedAtMs)
            if let runID { try NativeRecordValidation.uuid(runID) }
            let duration = Double(endedAtMs - startedAtMs) / 1000
            guard (0...604_800).contains(duration), originalMeters.isFinite,
                originalMeters > 0, originalMeters <= 500_000,
                elapsedSeconds.isFinite, (0...(duration + 1)).contains(elapsedSeconds),
                miles.isFinite, (0...(500_000 / 1609.344 + 0.005)).contains(miles),
                !trailName.isEmpty, trailName.utf16.count <= 200
            else { throw NativeRecordValidation.Failure.malformed }
            if source == .manual {
                guard originalMeters <= 15 * 1609.344 + 0.01, meters <= 15 * 1609.344 + 0.01 else {
                    throw NativeRecordValidation.Failure.malformed
                }
            } else {
                // Initial displayed mileage is rounded to hundredths, while corrections
                // may use the original measurement. Allow only that known rounding gap.
                guard elapsedSeconds > 0, originalMeters / elapsedSeconds <= 8.94,
                    meters
                        <= max(
                            originalMeters + 0.01,
                            (originalMeters / 1609.344 * 100).rounded() / 100 * 1609.344)
                else { throw NativeRecordValidation.Failure.malformed }
            }
        }
    }
    public func validate() throws {
        try NativeRecordValidation.uuid(id)
        try NativeRecordValidation.revision(revision)
        try details?.validate()
        if let details, details.recordedAt > updatedAt { throw NativeRecordValidation.Failure.malformed }
    }
    enum CodingKeys: String, CodingKey { case schemaVersion, id, revision, updatedAt, deleted }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        guard try values.decode(Int.self, forKey: .schemaVersion) == 1 else {
            throw NativeRecordValidation.Failure.malformed
        }
        id = try values.decode(String.self, forKey: .id)
        revision = try values.decode(Int64.self, forKey: .revision)
        updatedAt = try values.decode(NativeServerTime.self, forKey: .updatedAt)
        details = try values.decode(Bool.self, forKey: .deleted) ? nil : Details(from: decoder)
        try validate()
    }
    public func encode(to encoder: any Encoder) throws {
        try validate()
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(1, forKey: .schemaVersion)
        try values.encode(id, forKey: .id)
        try values.encode(revision, forKey: .revision)
        try values.encode(updatedAt, forKey: .updatedAt)
        try values.encode(deleted, forKey: .deleted)
        try details?.encode(to: encoder)
    }
}
