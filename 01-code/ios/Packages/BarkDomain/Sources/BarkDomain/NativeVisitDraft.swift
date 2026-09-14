import Foundation

/// Recoverable local presentation, explicitly separate from a server-confirmed event.
/// A pending command owns this small value even when clean history cache is evicted.
public struct NativeVisitDraft: Codable, Equatable, Sendable, Identifiable {
    public private(set) var id: String
    public let officialPlaceID: String
    public let siteID: String
    public let name: String
    public let state: String
    public let coordinate: Coordinate
    public var happenedAtMs: Int64
    public var timeZone: String
    public var proximity: NativeVisitRecord.Proximity?
    public var verified: Bool { proximity != nil }
    public var happenedAt: Date { Date(timeIntervalSince1970: Double(happenedAtMs) / 1000) }

    public init?(record: NativeVisitRecord) {
        guard let details = record.details else { return nil }
        id = record.id
        officialPlaceID = record.officialPlaceID
        siteID = record.siteID
        name = details.name
        state = details.state
        coordinate = details.coordinate
        happenedAtMs = details.happenedAtMs
        timeZone = details.timeZone
        proximity = details.proximity
    }
    public init(park: Park, id: String, now: Date, timeZone: TimeZone, fix: LocationFix?) throws {
        guard !park.isRetired else { throw VisitPolicy.Failure.retired }
        if let fix { try VisitPolicy.evaluateProximity(park: park, fix: fix, now: now) }
        self.id = id
        officialPlaceID = park.id.rawValue
        siteID = park.siteID.rawValue
        name = park.name
        state = park.state
        coordinate = park.coordinate
        happenedAtMs = try Self.milliseconds(now)
        self.timeZone = timeZone.identifier
        proximity = try fix.map(NativeVisitRecord.Proximity.init)
        try validate()
    }
    public static func milliseconds(_ date: Date) throws -> Int64 {
        let value = date.timeIntervalSince1970 * 1000
        guard value.isFinite, (0...253_402_300_799_999).contains(value) else {
            throw VisitPolicy.Failure.invalidDate
        }
        return Int64(value)
    }
    public func recovered(as id: String, retainingProximity: Bool) -> Self {
        var copy = self
        copy.id = id
        if !retainingProximity { copy.proximity = nil }
        return copy
    }
    public func validate() throws {
        try NativeRecordValidation.identifier(id)
        try NativeRecordValidation.identifier(officialPlaceID)
        try NativeRecordValidation.identifier(siteID)
        guard !name.isEmpty, name.utf16.count <= 500, state.utf16.count <= 100,
            coordinate.latitude.isFinite, (-90...90).contains(coordinate.latitude),
            coordinate.longitude.isFinite, (-180...180).contains(coordinate.longitude),
            (0...253_402_300_799_999).contains(happenedAtMs), TimeZone(identifier: timeZone) != nil,
            timeZone.utf8.count <= 100
        else { throw NativeRecordValidation.Failure.malformed }
        try proximity?.validate()
    }
}

public struct NativeVisitChange: Codable, Equatable, Sendable {
    public let intent: NativeVisitIntent
    public let before: NativeVisitDraft?
    public let after: NativeVisitDraft?
    public init(intent: NativeVisitIntent, before: NativeVisitDraft?, after: NativeVisitDraft?) {
        self.intent = intent
        self.before = before
        self.after = after
    }
    public func validate() throws {
        try intent.validate()
        for value in [before, after].compactMap({ $0 }) {
            try value.validate()
            guard value.id == intent.target.visitID, value.officialPlaceID == intent.target.officialPlaceID,
                value.siteID == intent.target.siteID
            else { throw NativeRecordValidation.Failure.malformed }
        }
        guard (before == nil) == (intent.target.visitRevision == 0) else {
            throw NativeRecordValidation.Failure.malformed
        }
        switch intent.edit {
        case .mark(let at, let zone, let proximity):
            guard let after else { throw NativeRecordValidation.Failure.malformed }
            if var expected = before {
                guard !expected.verified, let proximity else {
                    throw NativeRecordValidation.Failure.malformed
                }
                expected.proximity = proximity
                guard after == expected else { throw NativeRecordValidation.Failure.malformed }
            } else {
                guard after.happenedAtMs == at, after.timeZone == zone, after.proximity == proximity else {
                    throw NativeRecordValidation.Failure.malformed
                }
            }
        case .changeDate(let at, let zone):
            guard var expected = before else { throw NativeRecordValidation.Failure.malformed }
            expected.happenedAtMs = at
            expected.timeZone = zone
            guard after == expected else { throw NativeRecordValidation.Failure.malformed }
        case .remove:
            guard before != nil, after == nil else { throw NativeRecordValidation.Failure.malformed }
        }
    }
}
