import Foundation

/// Thin private place membership. Text and future media are separate, on-demand
/// records; removing membership cannot erase them. IDs are shared with trip places.
public struct NativeSavedPin: Codable, Equatable, Sendable {
    public struct Place: Codable, Equatable, Sendable {
        public let identity: PlaceIdentity
        public let name: String
        public let coordinate: Coordinate
        public let state: String
        public let subtitle: String
        public let stopID: String
        public let savedAtMs: Int64
        public init(
            identity: PlaceIdentity, name: String, coordinate: Coordinate, state: String,
            subtitle: String, stopID: String, savedAtMs: Int64
        ) {
            self.identity = identity
            self.name = name
            self.coordinate = coordinate
            self.state = state
            self.subtitle = subtitle
            self.stopID = stopID
            self.savedAtMs = savedAtMs
        }
        public func validate() throws {
            guard identity.isValid, coordinate.latitude.isFinite, coordinate.longitude.isFinite,
                abs(coordinate.latitude) <= 90, abs(coordinate.longitude) <= 180,
                (1...200).contains(name.utf16.count), state.utf16.count <= 100,
                subtitle.utf16.count <= 500, (0...253_402_300_799_999).contains(savedAtMs)
            else { throw NativeRecordValidation.Failure.malformed }
            switch identity {
            case .custom: break
            case .provider(let name, _) where name == "apple": break
            default: throw NativeRecordValidation.Failure.malformed
            }
            try NativeRecordValidation.identifier(stopID)
        }
    }
    public let schemaVersion: Int
    public let id: String
    public let revision: Int64
    public let saved: Bool
    public let place: Place
    public let updatedAt: NativeServerTime?
    public init(id: String, revision: Int64, saved: Bool, place: Place, updatedAt: NativeServerTime? = nil) {
        schemaVersion = 1
        self.id = id
        self.revision = revision
        self.saved = saved
        self.place = place
        self.updatedAt = updatedAt
    }
    public func validate() throws {
        try place.validate()
        guard schemaVersion == 1, id == place.identity.storageID,
            (1...9_007_199_254_740_991).contains(revision)
        else { throw NativeRecordValidation.Failure.malformed }
    }
}

public struct NativeSavedPinEdit: Codable, Equatable, Sendable {
    public let pinID: String
    public let saved: Bool
    public let place: NativeSavedPin.Place
    public init(saved: Bool, place: NativeSavedPin.Place) {
        pinID = place.identity.storageID
        self.saved = saved
        self.place = place
    }
    public func validate() throws {
        try place.validate()
        guard pinID == place.identity.storageID else { throw NativeRecordValidation.Failure.malformed }
    }
}

public struct NativeSavedPinChanges: Codable, Sendable {
    public let version: Int
    public let needsBootstrap: Bool
    public let items: [NativeSavedPin]
    public let upper: NativeServerTime
    public let next: NativeChangeCursor?
    public let retentionDays: Int?
    public func validate(for query: NativeChangeQuery) throws {
        try query.validate()
        guard version == 1, !needsBootstrap, retentionDays == nil, items.count <= 100,
            Set(items.map(\.id)).count == items.count, query.upper == nil || query.upper == upper
        else { throw NativeRecordValidation.Failure.malformed }
        var previous = query.after
        for item in items {
            try item.validate()
            guard let stamp = item.updatedAt, stamp <= upper
            else { throw NativeRecordValidation.Failure.malformed }
            if let since = query.since, stamp < since { throw NativeRecordValidation.Failure.malformed }
            if let previous,
                !(stamp > previous.updatedAt || (stamp == previous.updatedAt && item.id > previous.id))
            {
                throw NativeRecordValidation.Failure.malformed
            }
            previous = .init(updatedAt: stamp, id: item.id)
        }
        if let next, items.count != 100 || next != previous { throw NativeRecordValidation.Failure.malformed }
    }
}
