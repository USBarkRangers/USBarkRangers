import Foundation

/// Lossless bounded entity scan. The feature owns cache policy; this type owns only
/// server-time ordering and the page boundary shared by current native sync endpoints.
public struct NativeChangeCursor: Codable, Equatable, Sendable {
    public let updatedAt: NativeServerTime
    public let id: String
    public init(updatedAt: NativeServerTime, id: String) {
        self.updatedAt = updatedAt
        self.id = id
    }
}
public struct NativeChangeQuery: Codable, Equatable, Sendable {
    public let version: Int
    public let since: NativeServerTime?
    public let upper: NativeServerTime?
    public let after: NativeChangeCursor?
    public init(
        since: NativeServerTime? = nil, upper: NativeServerTime? = nil, after: NativeChangeCursor? = nil
    ) {
        version = 1
        self.since = since
        self.upper = upper
        self.after = after
    }
    public func validate() throws {
        guard version == 1 else { throw NativeRecordValidation.Failure.malformed }
        if let since, let upper, since > upper { throw NativeRecordValidation.Failure.malformed }
        if let after {
            try NativeRecordValidation.identifier(after.id)
            guard let upper, after.updatedAt <= upper else { throw NativeRecordValidation.Failure.malformed }
            if let since, after.updatedAt < since { throw NativeRecordValidation.Failure.malformed }
        }
    }
}
