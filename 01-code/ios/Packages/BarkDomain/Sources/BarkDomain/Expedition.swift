import Foundation

/// A read-only projection of the existing account fields, shared by the feature and its policies.
public struct Expedition: Equatable, Sendable {
    public let profile: UserProfile
    public init(profile: UserProfile) { self.profile = profile }
    public var fields: [String: UserValue] { profile.fields["virtual_expedition"]?.object ?? [:] }
    public var trailID: String? { fields["active_trail"]?.string }
    public var runID: String? { fields["native_run_id"]?.string }
    public var name: String { fields["trail_name"]?.string ?? "Choose a virtual trail" }
    public var meters: Double { (fields["miles_logged"]?.expeditionNumber ?? 0) * 1609.344 }
    public var totalMeters: Double { (fields["trail_total_miles"]?.expeditionNumber ?? 0) * 1609.344 }
    public var lifetimeMeters: Double { (profile.fields["lifetime_miles"]?.expeditionNumber ?? 0) * 1609.344 }
    public var fraction: Double { totalMeters > 0 ? min(1, max(0, meters / totalMeters)) : 0 }
    public var history: [WalkHistoryRecord] {
        (fields["history"]?.array ?? []).enumerated().compactMap { index, value in
            value.object.map { WalkHistoryRecord(fields: $0, index: index) }
        }
    }
    public var completed: [[String: UserValue]] {
        (profile.fields["completed_expeditions"]?.array ?? []).compactMap(\.object)
    }
}

/// Legacy web records sometimes serialized numeric fields as text. New summary payloads stay strict numbers.
extension UserValue {
    var expeditionNumber: Double? {
        let value = number ?? string.flatMap(Double.init)
        return value.flatMap { $0.isFinite ? $0 : nil }
    }
}
