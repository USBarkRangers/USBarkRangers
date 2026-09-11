import Foundation

/// Only this phase's two operations. Expected content detects edits by web writers without revisions.
public struct UserMutation: Codable, Equatable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable { case profile, mapStyle }
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
        kind == .profile ? profile.profileContent : profile.mapStyleContent
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
        }
        return result
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
    public init(uid: String) { baseline = PersonalSnapshot(uid: uid) }
    public var visible: PersonalSnapshot {
        var result = baseline
        for pending in pending { result.profile = pending.operation.applying(to: result.profile) }
        return result
    }
}
