import Foundation

/// Fixed-size server projections. Neither visit history nor profile fields are needed
/// to display points, state progress or already-earned badges.
public struct NativeProgress: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let revision: Int64
    public let sites: Int
    public let verifiedSites: Int
    public let walkPoints: Int
    public let states: [String: Int]
    public let verifiedStates: [String: Int]
    public let awards: [String: Award]
    public let streakCount: Int
    public let lastStreakDay: String?
    public let updatedAt: NativeServerTime
    public var points: Int { sites + verifiedSites + walkPoints }

    public struct Award: Codable, Equatable, Sendable {
        public let tier: Tier
        public let earnedAtMs: Int64
        public enum Tier: String, Codable, Sendable { case honor, verified }
        public var earnedAt: Date { Date(timeIntervalSince1970: Double(earnedAtMs) / 1000) }
    }
    public func validate() throws {
        try NativeRecordValidation.revision(revision)
        guard schemaVersion == 1, sites >= 0, verifiedSites >= 0, verifiedSites <= sites,
            walkPoints >= 0, streakCount >= 0,
            [sites, verifiedSites, walkPoints, streakCount].allSatisfy({
                $0 <= NativeRecordValidation.maximumInteger / 3
            })
        else { throw NativeRecordValidation.Failure.malformed }
        try NativeRecordValidation.stateCodes(Array(states.keys))
        try NativeRecordValidation.stateCodes(Array(verifiedStates.keys))
        guard states.values.allSatisfy({ (1...max(1, sites)).contains($0) }),
            verifiedStates.allSatisfy({ $0.value > 0 && $0.value <= (states[$0.key] ?? 0) }),
            awards.count <= 65,
            lastStreakDay.map({ $0.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil })
                ?? true
        else { throw NativeRecordValidation.Failure.malformed }
        for (id, award) in awards {
            try NativeRecordValidation.identifier(id)
            try NativeRecordValidation.revision(award.earnedAtMs, allowZero: true)
        }
    }
}

public struct NativePlaceProgress: Codable, Equatable, Sendable, Identifiable {
    public let schemaVersion: Int
    public let id: String
    public let officialPlaceID: String
    public let revision: Int64
    public let visitID: String?
    public let visitRevision: Int64?
    public let visited: Bool
    public let verified: Bool
    public let updatedAt: NativeServerTime
    public func validate() throws {
        try NativeRecordValidation.identifier(id)
        try NativeRecordValidation.identifier(officialPlaceID)
        try NativeRecordValidation.revision(revision)
        if let visitID { try NativeRecordValidation.identifier(visitID) }
        if let visitRevision { try NativeRecordValidation.revision(visitRevision) }
        guard schemaVersion == 1, visited == (visitID != nil), visited == (visitRevision != nil),
            visited || !verified
        else {
            throw NativeRecordValidation.Failure.malformed
        }
    }
}
