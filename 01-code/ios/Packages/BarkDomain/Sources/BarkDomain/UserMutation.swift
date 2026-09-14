import Foundation

/// Concrete personal intents. Expected touched content detects web edits without shared revision fields.
public struct UserMutation: Codable, Equatable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable { case profile, mapStyle, visits, trip, activity, expedition }
    public let id: String
    public let uid: String
    public let kind: Kind
    public let createdAt: Double
    public let expected: UserValue
    public let value: UserValue
    public init(
        uid: String, kind: Kind, expected: UserValue, value: UserValue,
        id: String = UUID().uuidString.lowercased(), now: Date = Date()
    ) {
        self.id = id
        self.uid = uid
        self.kind = kind
        self.expected = expected
        self.value = value
        createdAt = now.timeIntervalSince1970 * 1000
    }
    public func content(in profile: UserProfile) -> UserValue {
        switch kind {
        case .profile: profile.profileContent
        case .mapStyle: profile.mapStyleContent
        case .visits:
            .object(
                (expected.object ?? [:]).mapValues { _ in .null }.merging(
                    Visit.records(in: profile).reduce(into: [String: UserValue]()) { values, visit in
                        if expected.object?[visit.id] != nil { values[visit.id] = visit.record }
                    }, uniquingKeysWith: { _, new in new }))
        case .expedition: ExpeditionPolicy.content(profile)
        case .activity, .trip: .null
        }
    }
    public func content(in snapshot: PersonalSnapshot) -> UserValue {
        if kind == .trip {
            return snapshot.trips.first { $0.id == value.object?["id"]?.string }?.tripContent ?? .null
        }
        return content(in: snapshot.profile)
    }
    /// Block only overlapping entities; a conflict on one trip cannot stop a different trip's save.
    public var entityKeys: Set<String> {
        switch kind {
        case .visits: Set((value.object ?? [:]).keys.map { "visit:\($0)" })
        case .trip: ["trip:\(value.object?["id"]?.string ?? "invalid")"]
        default: [kind.rawValue]
        }
    }
    public func applying(to profile: UserProfile) -> UserProfile {
        var result = profile
        switch kind {
        case .profile:
            result.fields["displayName"] = value
            result.fields["username"] = value
        case .mapStyle:
            var settings = result.settings
            settings["mapStyle"] = value
            result.fields["settings"] = .object(settings)
        case .visits:
            let changes = value.object ?? [:]
            var visits = result.fields["visitedPlaces"]?.array ?? []
            visits.removeAll { item in item.object?["id"]?.string.map { changes[$0] != nil } ?? false }
            visits += changes.keys.sorted().compactMap { changes[$0] == .null ? nil : changes[$0] }
            result.fields["visitedPlaces"] = .array(visits)
        case .expedition:
            result =
                (try? ExpeditionPolicy.applying(
                    value, to: profile, now: Date(timeIntervalSince1970: createdAt / 1000))) ?? profile
        case .trip, .activity: break
        }
        return result
    }
    public func applying(to snapshot: PersonalSnapshot) -> PersonalSnapshot {
        var result = snapshot
        result.profile = applying(to: result.profile)
        if kind == .trip, let id = value.object?["id"]?.string {
            result.trips.removeAll { $0.id == id }
            if let record = value.object?["record"]?.object {
                result.trips.append(SavedRecord(id: id, fields: record))
            }
        }
        return result
    }
    public func replacingValue(_ value: UserValue, expected: UserValue) -> UserMutation {
        UserMutation(uid: uid, kind: kind, expected: expected, value: value)
    }
}

public struct MutationReceipt: Codable, Equatable, Sendable {
    public enum Outcome: String, Codable, Sendable { case accepted, conflict, rejected }
    public let operation: UserMutation
    public let outcome: Outcome
    public let current: UserValue
    public let reason: String?
    public init(operation: UserMutation, outcome: Outcome, current: UserValue, reason: String? = nil) {
        self.operation = operation
        self.outcome = outcome
        self.current = current
        self.reason = reason
    }
}

public struct PendingMutation: Codable, Equatable, Sendable, Identifiable {
    public var operation: UserMutation
    public var receipt: MutationReceipt?
    public var attempts: Int = 0
    public var retryAt: Date?
    public var id: String { operation.id }
    public init(operation: UserMutation) { self.operation = operation }
}

public struct PersonalState: Codable, Equatable, Sendable {
    public var baseline: PersonalSnapshot
    public var pending: [PendingMutation] = []
    public var readSequence: Int64 = 0
    public var acceptedSequence: Int64 = 0
    public var drafts: [LegacyTripDraft]?
    /// Nil in older stores; a partial download must never imply an empty or complete account library.
    public var tripLibrary: TripLibraryState?
    public var activeDraftID: String?
    /// Optional for older installed stores. Clearing a selection must not select a fallback trip on relaunch.
    public var activeTripCleared: Bool?
    public var selectedTripID: String? {
        activeTripCleared == true ? nil : activeDraftID ?? drafts?.last?.id ?? visible.trips.first?.id
    }
    /// Private handoff checkpoints in guest storage only; stripped from all published UI snapshots.
    public var guestDraftTransfers: [String: [LegacyTripDraft]]?
    public init(uid: String) { baseline = PersonalSnapshot(uid: uid) }
    public var visible: PersonalSnapshot {
        var result = baseline
        for pending in pending { result = pending.operation.applying(to: result) }
        return result
    }
}
