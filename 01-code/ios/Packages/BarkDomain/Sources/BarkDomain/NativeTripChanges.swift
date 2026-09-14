import Foundation

public struct NativeTripChanges: Codable, Equatable, Sendable {
    public typealias Cursor = NativeChangeCursor
    public typealias Query = NativeChangeQuery
    public let version: Int
    public let needsBootstrap: Bool
    public let items: [NativeTripMetadata]
    public let upper: NativeServerTime
    public let next: Cursor?
    public let retentionDays: Int

    public init(
        items: [NativeTripMetadata], upper: NativeServerTime, next: Cursor? = nil,
        needsBootstrap: Bool = false, retentionDays: Int = 89, version: Int = 1
    ) {
        self.version = version
        self.items = items
        self.upper = upper
        self.next = next
        self.needsBootstrap = needsBootstrap
        self.retentionDays = retentionDays
    }

    public func validate(for query: Query) throws {
        try query.validate()
        guard version == 1, retentionDays == 89, items.count <= 100,
            Set(items.map(\.id)).count == items.count
        else { throw Trip.Failure.malformed }
        if needsBootstrap {
            guard items.isEmpty, next == nil else { throw Trip.Failure.malformed }
            return
        }
        guard query.upper == nil || query.upper == upper else { throw Trip.Failure.malformed }
        var previous = query.after
        for value in items {
            try value.validate()
            guard value.updatedAt <= upper else { throw Trip.Failure.malformed }
            if let since = query.since, value.updatedAt < since { throw Trip.Failure.malformed }
            if let previous {
                guard
                    value.updatedAt > previous.updatedAt
                        || (value.updatedAt == previous.updatedAt && value.id > previous.id)
                else {
                    throw Trip.Failure.malformed
                }
            }
            previous = Cursor(updatedAt: value.updatedAt, id: value.id)
        }
        if let next {
            guard items.count == 100, next == previous else { throw Trip.Failure.malformed }
        }
    }
}
