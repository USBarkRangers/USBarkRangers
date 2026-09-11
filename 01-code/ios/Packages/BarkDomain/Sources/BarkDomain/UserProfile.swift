import Foundation

public struct UserProfile: Codable, Equatable, Sendable {
    public var fields: [String: UserValue]
    public init(fields: [String: UserValue] = [:]) { self.fields = fields }
    public var displayName: String {
        fields["displayName"]?.string ?? fields["username"]?.string ?? "Bark Ranger"
    }
    public var settings: [String: UserValue] { fields["settings"]?.object ?? [:] }
    public var profileContent: UserValue {
        .object(["displayName": fields["displayName"] ?? .null, "username": fields["username"] ?? .null])
    }
    public var mapStyleContent: UserValue { settings["mapStyle"] ?? .null }
}

/// Existing records remain read-only until their feature phase; original fields and IDs survive intact.
public struct SavedRecord: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let fields: [String: UserValue]
    public init(id: String, fields: [String: UserValue]) {
        self.id = id
        self.fields = fields
    }
}

public struct PersonalSnapshot: Codable, Equatable, Sendable {
    public let uid: String
    public var profile: UserProfile
    public var trips: [SavedRecord]
    public var achievements: [SavedRecord]
    public var unresolved: [String]
    public var confirmedAt: Date?
    public init(
        uid: String, profile: UserProfile = .init(), trips: [SavedRecord] = [],
        achievements: [SavedRecord] = [], unresolved: [String] = [], confirmedAt: Date? = nil
    ) {
        self.uid = uid
        self.profile = profile
        self.trips = trips
        self.achievements = achievements
        self.unresolved = unresolved
        self.confirmedAt = confirmedAt
    }
    public var visitCount: Int { profile.fields["visitedPlaces"]?.array?.count ?? 0 }
    public var achievementCount: Int {
        Set(achievements.map(\.id)).union(profile.fields["achievements"]?.object?.keys.map { $0 } ?? []).count
    }
    public var completedExpeditionCount: Int {
        (profile.fields["completed_expeditions"] ?? profile.fields["completedExpeditions"])?.array?.count ?? 0
    }
}
