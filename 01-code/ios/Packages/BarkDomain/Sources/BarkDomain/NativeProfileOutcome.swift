import Foundation

public struct NativeProfileOutcome: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable { case accepted, conflict }
    public struct Revisions: Codable, Equatable, Sendable {
        public let profile: Int64
        public let entitlement: Int64?
        public init(profile: Int64, entitlement: Int64? = nil) {
            self.profile = profile
            self.entitlement = entitlement
        }
    }
    public let version: Int
    public let operationID: UUID
    public let status: Status
    public let revisions: Revisions
    public init(operationID: UUID, status: Status, revisions: Revisions, version: Int = 1) {
        self.version = version
        self.operationID = operationID
        self.status = status
        self.revisions = revisions
    }
}
