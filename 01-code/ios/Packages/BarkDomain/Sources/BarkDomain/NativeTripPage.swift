import Foundation

public struct NativeTripPage: Codable, Equatable, Sendable {
    public struct Cursor: Codable, Equatable, Sendable {
        public let createdAt: NativeServerTime
        public let id: String
        public init(createdAt: NativeServerTime, id: String) {
            self.createdAt = createdAt
            self.id = id
        }
    }
    public let version: Int
    public let items: [NativeTripMetadata]
    public let readTime: NativeServerTime
    public let next: Cursor?
    public init(
        items: [NativeTripMetadata], readTime: NativeServerTime, next: Cursor? = nil, version: Int = 1
    ) {
        self.version = version
        self.items = items
        self.readTime = readTime
        self.next = next
    }
    public func validate() throws {
        guard version == 1, items.count <= 10, Set(items.map(\.id)).count == items.count else {
            throw Trip.Failure.malformed
        }
        for (index, value) in items.enumerated() {
            try value.validate()
            guard !value.deleted, value.updatedAt <= readTime else { throw Trip.Failure.malformed }
            if index > 0 {
                let previous = items[index - 1]
                guard
                    previous.createdAt > value.createdAt
                        || (previous.createdAt == value.createdAt && previous.id > value.id)
                else {
                    throw Trip.Failure.malformed
                }
            }
        }
        if let next {
            guard items.count == 10, next.id == items.last?.id, next.createdAt == items.last?.createdAt else {
                throw Trip.Failure.malformed
            }
        }
    }
}
