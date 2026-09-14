import Foundation

/// Only the touched visit and official-site slot preimages. Payload encoding is explicit
/// so local identity/context never becomes an arbitrary server field patch.
public struct NativeVisitIntent: Codable, Equatable, Sendable {
    public struct Target: Codable, Equatable, Sendable {
        public let visitID: String
        public let officialPlaceID: String
        public let siteID: String
        public let visitRevision: Int64
        public let placeRevision: Int64
        public init(
            visitID: String, officialPlaceID: String, siteID: String, visitRevision: Int64,
            placeRevision: Int64
        ) {
            self.visitID = visitID
            self.officialPlaceID = officialPlaceID
            self.siteID = siteID
            self.visitRevision = visitRevision
            self.placeRevision = placeRevision
        }
    }
    public enum Edit: Codable, Equatable, Sendable {
        case mark(happenedAtMs: Int64, timeZone: String, proximity: NativeVisitRecord.Proximity?)
        case changeDate(happenedAtMs: Int64, timeZone: String)
        case remove
    }
    public let target: Target
    public let edit: Edit
    public init(target: Target, edit: Edit) {
        self.target = target
        self.edit = edit
    }
    public func validate() throws {
        try NativeRecordValidation.identifier(target.visitID)
        try NativeRecordValidation.identifier(target.officialPlaceID)
        try NativeRecordValidation.identifier(target.siteID)
        try NativeRecordValidation.revision(target.visitRevision, allowZero: true)
        try NativeRecordValidation.revision(target.placeRevision, allowZero: true)
        switch edit {
        case .mark(let at, let zone, let proximity):
            try validateDate(at, zone: zone)
            try proximity?.validate()
        case .changeDate(let at, let zone):
            try validateDate(at, zone: zone)
            guard target.visitRevision > 0 else { throw NativeRecordValidation.Failure.malformed }
        case .remove:
            guard target.visitRevision > 0 else { throw NativeRecordValidation.Failure.malformed }
        }
    }
    private func validateDate(_ at: Int64, zone: String) throws {
        guard (0...253_402_300_799_999).contains(at), zone.utf8.count <= 100,
            TimeZone(identifier: zone) != nil
        else {
            throw NativeRecordValidation.Failure.malformed
        }
    }
}
