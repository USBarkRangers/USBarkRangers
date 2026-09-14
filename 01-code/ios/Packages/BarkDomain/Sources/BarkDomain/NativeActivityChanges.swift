import Foundation

public struct NativeActivityChanges: Codable, Equatable, Sendable {
    public let version: Int
    public let needsBootstrap: Bool
    public let items: [NativeActivityRecord]
    public let upper: NativeServerTime
    public let next: NativeChangeCursor?
    public let retentionDays: Int
    public func validate(for query: NativeChangeQuery) throws {
        try query.validate()
        guard version == 1, retentionDays == 89, items.count <= 100,
            Set(items.map(\.id)).count == items.count
        else { throw NativeRecordValidation.Failure.malformed }
        if needsBootstrap {
            guard items.isEmpty, next == nil else { throw NativeRecordValidation.Failure.malformed }
            return
        }
        guard query.upper == nil || query.upper == upper else {
            throw NativeRecordValidation.Failure.malformed
        }
        var previous = query.after
        for item in items {
            try item.validate()
            guard item.updatedAt <= upper else { throw NativeRecordValidation.Failure.malformed }
            if let since = query.since, item.updatedAt < since {
                throw NativeRecordValidation.Failure.malformed
            }
            if let previous,
                !(item.updatedAt > previous.updatedAt
                    || (item.updatedAt == previous.updatedAt && item.id > previous.id))
            {
                throw NativeRecordValidation.Failure.malformed
            }
            previous = .init(updatedAt: item.updatedAt, id: item.id)
        }
        if let next, items.count != 100 || next != previous { throw NativeRecordValidation.Failure.malformed }
    }
}
