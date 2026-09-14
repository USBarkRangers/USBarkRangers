import Foundation

extension Trip {
    /// A trip occurrence references a stable place; its title/coordinate are navigation snapshots.
    /// Notes here are an explicit draft working copy. Native saved notes live in their own records.
    public struct Stop: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public var placeIdentity: PlaceIdentity
        public var name: String
        public var coordinate: Coordinate?
        public var state: String
        public var city: String?
        public var category: ParkCategory?
        public var arrivalTime: String?
        public var visitMinutes: Double?
        public var notes: String

        public var parkID: ParkID? {
            if case .official(let id) = placeIdentity { return id }
            return nil
        }
        public var applePlaceID: String? {
            if case .provider("apple", let id) = placeIdentity { return id }
            return nil
        }
        public var customPlaceID: String? {
            if case .custom(let id) = placeIdentity { return id }
            return nil
        }

        public init(
            id: String = UUID().uuidString.lowercased(), placeIdentity: PlaceIdentity,
            name: String, coordinate: Coordinate?, state: String = "", city: String? = nil,
            category: ParkCategory? = nil, arrivalTime: String? = nil,
            visitMinutes: Double? = nil, notes: String = ""
        ) {
            self.id = id
            self.placeIdentity = placeIdentity
            self.name = name
            self.coordinate = coordinate
            self.state = state
            self.city = city
            self.category = category
            self.arrivalTime = arrivalTime
            self.visitMinutes = visitMinutes
            self.notes = notes
        }

        public init(park: Park) {
            self.init(placeIdentity: .official(park.id), name: park.name,
                coordinate: park.coordinate, state: park.state, category: park.category)
        }

        public init(name: String, coordinate: Coordinate) {
            self.init(placeIdentity: .custom(UUID().uuidString.lowercased()),
                name: name, coordinate: coordinate)
        }

        /// A round-trip bookend is another occurrence of the same place, not a new private pin.
        public func newOccurrence() -> Self {
            Self(placeIdentity: placeIdentity, name: name, coordinate: coordinate, state: state,
                city: city, category: category, arrivalTime: arrivalTime,
                visitMinutes: visitMinutes, notes: notes)
        }
    }
}
