import BarkDomain
import Foundation

/// Thin saved-place presentation, independent of trip membership. Account bookmarks
/// sync through NativeStore; guests stay local. Journal text is never in map downloads.
nonisolated struct SavedPlace: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    let coordinate: Coordinate
    let subtitle: String
    let locality: String
    let appleID: String?
    let stopID: String
    let customPlaceID: String?
    let savedAt: Date
    // Reserved local note storage; this pass intentionally has no note editor or journal UI.
    // Never copy trip notes here or send this field when adding the place to a trip.
    var notes: String = ""

    init?(stop: Trip.Stop, subtitle: String, savedAt: Date = Date()) {
        guard let id = Self.identity(for: stop), let coordinate = stop.coordinate else { return nil }
        self.id = id
        self.name = stop.name
        self.coordinate = coordinate
        self.subtitle = subtitle
        self.locality = stop.state
        self.appleID = stop.applePlaceID
        self.stopID = stop.id
        self.customPlaceID = stop.customPlaceID
        self.savedAt = savedAt
    }

    /// A known provider identity deduplicates saves; arbitrary pins retain their original identity.
    /// J1: never fuzzy-merge nearby pins or derive private identity from a mutable label/coordinate.
    static func identity(for stop: Trip.Stop) -> String? {
        guard stop.parkID == nil, stop.coordinate != nil, stop.placeIdentity.isValid else { return nil }
        return stop.placeIdentity.storageID
    }

    /// A projection only, with a stable marker/stop identity. Local notes stay in this record.
    var stop: Trip.Stop {
        let identity: PlaceIdentity =
            appleID.map { .provider(name: "apple", id: $0) }
            ?? .custom(customPlaceID ?? "saved:" + id)
        return Trip.Stop(
            id: stopID, placeIdentity: identity,
            name: name, coordinate: coordinate, state: locality)
    }

    var nativeValue: NativeSavedPin.Place {
        get throws {
            .init(
                identity: stop.placeIdentity, name: name, coordinate: coordinate, state: locality,
                subtitle: subtitle, stopID: stopID, savedAtMs: try NativeClientTime.milliseconds(savedAt))
        }
    }
    init(native value: NativeSavedPin.Place, notes: String = "") {
        id = value.identity.storageID
        name = value.name
        coordinate = value.coordinate
        locality = value.state
        subtitle = value.subtitle
        stopID = value.stopID
        savedAt = Date(timeIntervalSince1970: Double(value.savedAtMs) / 1000)
        self.notes = notes
        switch value.identity {
        case .provider(_, let id):
            appleID = id
            customPlaceID = nil
        case .custom(let id):
            customPlaceID = id
            appleID = nil
        case .official:
            customPlaceID = nil
            appleID = nil  // Rejected by the wire validator.
        }
    }
}
