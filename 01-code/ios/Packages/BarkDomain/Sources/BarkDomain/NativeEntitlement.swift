import Foundation

/// Server-confirmed access. Purchase proofs and Apple credentials never belong in this projection.
public struct NativeEntitlement: Codable, Equatable, Sendable {
    public enum Source: String, Codable, Sendable {
        case none
        case production = "app-store-production"
        case sandbox = "app-store-sandbox"
    }
    public let schemaVersion: Int
    public let revision: Int64
    public let premium: Bool
    public let source: Source
    public let validUntilMs: Int64?

    public init(revision: Int64, premium: Bool, source: Source, validUntilMs: Int64?, schemaVersion: Int = 1)
    {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.premium = premium
        self.source = source
        self.validUntilMs = validUntilMs
    }
    public func validate() throws {
        guard schemaVersion == 1, (1...9_007_199_254_740_991).contains(revision),
            validUntilMs.map({ (0...9_007_199_254_740_991).contains($0) }) ?? true
        else {
            throw NativeProfileEdit.Failure.invalid
        }
    }
    public func permitsEditing(at now: Date) -> Bool {
        // APPLE-ACTIVATION: remain fail-closed while enrollment/products are unavailable.
        // Sandbox acceptance needs an explicit isolated verification policy, not a relaxed
        // production check. A purchase result alone must never populate this projection.
        schemaVersion == 1 && premium && source == .production
            && validUntilMs.map { Double($0) > now.timeIntervalSince1970 * 1000 } == true
    }
}
