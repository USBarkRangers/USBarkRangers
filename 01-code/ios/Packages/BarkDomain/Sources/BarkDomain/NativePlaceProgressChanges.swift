import Foundation

public struct NativePlaceProgressChanges: Codable, Equatable, Sendable {
    public let version: Int
    public let needsBootstrap: Bool
    public let items: [NativePlaceProgress]
    public let upper: NativeServerTime
    public let next: NativeChangeCursor?
    public let retentionDays: Int?
    public func validate(for query: NativeChangeQuery) throws {
        try query.validate()
        // Official-site slots are retained after unmarking, so their deletion state
        // does not disappear at the visit-history tombstone horizon.
        guard version == 1, !needsBootstrap, retentionDays == nil, items.count <= 100,
            Set(items.map(\.id)).count == items.count, query.upper == nil || query.upper == upper
        else { throw NativeRecordValidation.Failure.malformed }
        var previous = query.after
        for item in items {
            try item.validate()
            guard item.updatedAt <= upper else { throw NativeRecordValidation.Failure.malformed }
            if let since = query.since, item.updatedAt < since {
                throw NativeRecordValidation.Failure.malformed
            }
            if let previous {
                guard
                    item.updatedAt > previous.updatedAt
                        || (item.updatedAt == previous.updatedAt && item.id > previous.id)
                else { throw NativeRecordValidation.Failure.malformed }
            }
            previous = .init(updatedAt: item.updatedAt, id: item.id)
        }
        if let next {
            guard items.count == 100, next == previous else { throw NativeRecordValidation.Failure.malformed }
        }
    }
}
